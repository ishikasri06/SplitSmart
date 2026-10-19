-- Personal expenses, in-app notifications, and the leave-with-balance guard.
-- ============================================================================
-- Review and apply this migration manually in the Supabase SQL editor. The
-- frontend never runs SQL and never uses a service-role key.
--
-- This migration is ADDITIVE and SELF-CONTAINED. It does not drop any existing
-- table, column, policy, trigger, or function. The only existing function it
-- replaces is public.remove_group_member, whose signature is unchanged so its
-- existing grants (authenticated) are preserved.
--
-- Contents:
--   1. public.personal_expenses  - expenses that never belong to a group.
--   2. public.notifications      - per-recipient, read/unread in-app alerts.
--   3. Preference + notification helper functions (SECURITY DEFINER only).
--   4. AFTER INSERT/UPDATE/DELETE triggers that fan notifications out to the
--      relevant group members, excluding the actor and honoring preferences.
--   5. public.group_member_net_balance + a leave/remove guard inside
--      public.remove_group_member so a non-zero net balance blocks removal.
--
-- Security properties:
--   * new tables have RLS enabled and are scoped to auth.uid().
--   * anon is revoked entirely on the new tables; authenticated gets the
--     minimum set of privileges (no INSERT/DELETE on notifications).
--   * notifications can only be written by SECURITY DEFINER functions owned by
--     the migration role; clients cannot forge or delete them.
--   * The notification helpers/trigger functions are not executable by clients.
-- ============================================================================


-- ============================================================================
-- 1. Personal (non-group) expenses
-- ============================================================================

create table if not exists public.personal_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  amount numeric not null check (amount > 0),
  currency character(3) not null default 'INR' check (currency = 'INR'),
  category text not null default 'Other',
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_expenses_user_date_idx
  on public.personal_expenses (user_id, expense_date desc);

alter table public.personal_expenses enable row level security;

drop policy if exists "Users read own personal expenses" on public.personal_expenses;
create policy "Users read own personal expenses"
  on public.personal_expenses for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users add own personal expenses" on public.personal_expenses;
create policy "Users add own personal expenses"
  on public.personal_expenses for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update own personal expenses" on public.personal_expenses;
create policy "Users update own personal expenses"
  on public.personal_expenses for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users delete own personal expenses" on public.personal_expenses;
create policy "Users delete own personal expenses"
  on public.personal_expenses for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.personal_expenses from anon;
revoke all on public.personal_expenses from authenticated;
grant select, insert, update, delete on public.personal_expenses to authenticated;

create or replace function public.touch_personal_expenses_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists personal_expenses_set_updated_at on public.personal_expenses;
create trigger personal_expenses_set_updated_at
  before update on public.personal_expenses
  for each row execute function public.touch_personal_expenses_updated_at();


-- ============================================================================
-- 2. In-app notifications
-- ============================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text,
  group_id uuid references public.groups (id) on delete cascade,
  group_name text,
  type text not null check (type in (
    'expense_created',
    'expense_updated',
    'expense_deleted',
    'settlement_recorded',
    'invitation_received'
  )),
  title text not null,
  body text,
  amount numeric,
  entity_type text,
  entity_id uuid,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_user_dedupe_key unique (user_id, dedupe_key)
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Recipients may read and mark their own notifications read. There is
-- deliberately no INSERT/DELETE policy: those are only performed by the
-- SECURITY DEFINER helpers below.
drop policy if exists "Recipients read own notifications" on public.notifications;
create policy "Recipients read own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Recipients update own notifications" on public.notifications;
create policy "Recipients update own notifications"
  on public.notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select, update on public.notifications to authenticated;


-- ============================================================================
-- 3. Preference + notification helper functions (internal)
-- ============================================================================

-- Returns whether p_user wants a notification of the given kind. Unknown or
-- missing preference rows default to true (matching the app defaults).
create or replace function public.user_wants_notification(p_user uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind = 'invitations' then
      coalesce(
        (select up.notify_invitations
           from public.user_preferences up
          where up.user_id = p_user),
        true
      )
    else
      coalesce(
        (select up.notify_activity
           from public.user_preferences up
          where up.user_id = p_user),
        true
      )
  end;
$$;

-- Fans a single activity notification out to every other member of the group.
-- The actor, anyone who disabled the matching preference, and duplicate events
-- (same dedupe key) are all skipped. Failures never block the caller.
create or replace function public.notify_group_activity(
  p_group_id uuid,
  p_actor uuid,
  p_type text,
  p_title text,
  p_body text,
  p_amount numeric,
  p_entity_type text,
  p_entity_id uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_name text;
  v_actor_name text;
begin
  if p_actor is null or p_entity_id is null then
    return;
  end if;

  select g.name into v_group_name
    from public.groups g
   where g.id = p_group_id;

  select p.full_name into v_actor_name
    from public.profiles p
   where p.id = p_actor;

  insert into public.notifications (
    user_id, actor_id, actor_name, group_id, group_name,
    type, title, body, amount, entity_type, entity_id, dedupe_key
  )
  select
    gm.user_id,
    p_actor,
    v_actor_name,
    p_group_id,
    v_group_name,
    p_type,
    p_title,
    p_body,
    p_amount,
    p_entity_type,
    p_entity_id,
    p_type || ':' || p_entity_id::text
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id <> p_actor
    and public.user_wants_notification(gm.user_id, p_kind)
  on conflict (user_id, dedupe_key) do nothing;
exception
  when others then
    -- A notification must never break the underlying expense/settlement write.
    raise warning 'notify_group_activity skipped: %', sqlerrm;
end;
$$;


-- ============================================================================
-- 4. Triggers that emit notifications
-- ============================================================================

create or replace function public.notify_expense_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_group_activity(
    new.group_id,
    coalesce(auth.uid(), new.created_by),
    'expense_created',
    'New expense added',
    new.title,
    new.amount,
    'expense',
    new.id,
    'activity'
  );
  return new;
end;
$$;

create or replace function public.notify_expense_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only notify on a meaningful change, to avoid noise and duplicate alerts.
  if new.title is not distinct from old.title
     and new.amount is not distinct from old.amount
     and new.paid_by is not distinct from old.paid_by
     and new.category is not distinct from old.category
     and new.expense_date is not distinct from old.expense_date
     and new.split_type is not distinct from old.split_type
     and new.notes is not distinct from old.notes then
    return new;
  end if;

  perform public.notify_group_activity(
    new.group_id,
    coalesce(auth.uid(), new.created_by),
    'expense_updated',
    'Expense updated',
    new.title,
    new.amount,
    'expense',
    new.id,
    'activity'
  );
  return new;
end;
$$;

create or replace function public.notify_expense_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_group_activity(
    old.group_id,
    coalesce(auth.uid(), old.created_by),
    'expense_deleted',
    'Expense deleted',
    old.title,
    old.amount,
    'expense',
    old.id,
    'activity'
  );
  return old;
end;
$$;

create or replace function public.notify_settlement_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payer text;
  v_receiver text;
begin
  select p.full_name into v_payer
    from public.profiles p
   where p.id = new.paid_by;

  select p.full_name into v_receiver
    from public.profiles p
   where p.id = new.paid_to;

  perform public.notify_group_activity(
    new.group_id,
    coalesce(auth.uid(), new.paid_by),
    'settlement_recorded',
    'Settlement recorded',
    coalesce(v_payer, 'A member') || ' paid ' || coalesce(v_receiver, 'a member'),
    new.amount,
    'settlement',
    new.id,
    'activity'
  );
  return new;
end;
$$;

create or replace function public.notify_invitation_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_actor uuid := coalesce(auth.uid(), new.invited_by);
  v_group_name text;
  v_actor_name text;
begin
  if new.invited_email is null then
    return new;
  end if;

  select u.id into v_invitee
    from auth.users u
   where lower(u.email) = lower(new.invited_email)
   limit 1;

  if v_invitee is null or v_invitee = v_actor then
    return new;
  end if;

  -- No need to notify somebody who is already in the group.
  if exists (
    select 1 from public.group_members gm
     where gm.group_id = new.group_id
       and gm.user_id = v_invitee
  ) then
    return new;
  end if;

  if not public.user_wants_notification(v_invitee, 'invitations') then
    return new;
  end if;

  select g.name into v_group_name
    from public.groups g
   where g.id = new.group_id;

  select p.full_name into v_actor_name
    from public.profiles p
   where p.id = v_actor;

  insert into public.notifications (
    user_id, actor_id, actor_name, group_id, group_name,
    type, title, body, entity_type, entity_id, dedupe_key
  )
  values (
    v_invitee,
    v_actor,
    v_actor_name,
    new.group_id,
    v_group_name,
    'invitation_received',
    'Group invitation',
    coalesce(v_actor_name, 'Someone') || ' invited you to ' || coalesce(v_group_name, 'a group'),
    'invitation',
    new.id,
    'invitation_received:' || new.id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
exception
  when others then
    raise warning 'notify_invitation_received skipped: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_expense_created_notify on public.expenses;
create trigger on_expense_created_notify
  after insert on public.expenses
  for each row execute function public.notify_expense_inserted();

drop trigger if exists on_expense_updated_notify on public.expenses;
create trigger on_expense_updated_notify
  after update on public.expenses
  for each row execute function public.notify_expense_updated();

drop trigger if exists on_expense_deleted_notify on public.expenses;
create trigger on_expense_deleted_notify
  after delete on public.expenses
  for each row execute function public.notify_expense_deleted();

drop trigger if exists on_settlement_notify on public.settlements;
create trigger on_settlement_notify
  after insert on public.settlements
  for each row execute function public.notify_settlement_recorded();

drop trigger if exists on_invitation_notify on public.group_invitations;
create trigger on_invitation_notify
  after insert on public.group_invitations
  for each row execute function public.notify_invitation_received();


-- ============================================================================
-- 5. Leave-with-balance guard
-- ============================================================================

-- Signed net balance for a single member of a group, using the same convention
-- as the frontend: positive means they are owed money, negative means they owe.
--   paid expenses - their shares + settlements they paid - settlements received
create or replace function public.group_member_net_balance(
  p_group_id uuid,
  p_user_id uuid
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(e.amount) from public.expenses e
       where e.group_id = p_group_id and e.paid_by = p_user_id
    ), 0)
    - coalesce((
      select sum(s.share_amount)
        from public.expense_shares s
        join public.expenses e2 on e2.id = s.expense_id
       where e2.group_id = p_group_id and s.user_id = p_user_id
    ), 0)
    + coalesce((
      select sum(st.amount) from public.settlements st
       where st.group_id = p_group_id and st.paid_by = p_user_id
    ), 0)
    - coalesce((
      select sum(st.amount) from public.settlements st
       where st.group_id = p_group_id and st.paid_to = p_user_id
    ), 0);
$$;

-- Replaces the previous definition with an outstanding-balance guard, while
-- preserving every existing rule (owner checks, admin checks, last-owner rule).
create or replace function public.remove_group_member(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_requester_role text;
  v_target_role text;
  v_owner_count int;
  v_net numeric;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  if p_user_id = v_uid then
    select role into v_target_role
      from public.group_members
     where group_id = p_group_id and user_id = v_uid;

    if v_target_role is null then
      raise exception 'You are not a member of this group.';
    end if;

    if v_target_role = 'owner' then
      select count(*) into v_owner_count
        from public.group_members
       where group_id = p_group_id and role = 'owner';

      if v_owner_count <= 1 then
        raise exception 'Assign another owner before leaving this group.';
      end if;
    end if;

    v_net := public.group_member_net_balance(p_group_id, v_uid);

    if abs(v_net) > 0.005 then
      raise exception using
        message = format(
          'You have an outstanding balance of %s in this group. Settle up before leaving.',
          to_char(abs(v_net), 'FM99999999990.00')
        ),
        errcode = 'P0001';
    end if;

    delete from public.group_members
     where group_id = p_group_id and user_id = v_uid;
    return;
  end if;

  select role into v_requester_role
    from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  if v_requester_role is null or not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can remove members.';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'That person is not a member of this group.';
  end if;

  if v_target_role = 'owner' then
    if v_requester_role <> 'owner' then
      raise exception 'Only an owner can remove another owner.';
    end if;

    select count(*) into v_owner_count
      from public.group_members
     where group_id = p_group_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'A group must keep at least one owner.';
    end if;
  end if;

  v_net := public.group_member_net_balance(p_group_id, p_user_id);

  if abs(v_net) > 0.005 then
    raise exception using
      message = format(
        'This member has an outstanding balance of %s and cannot be removed until it is settled.',
        to_char(abs(v_net), 'FM99999999990.00')
      ),
      errcode = 'P0001';
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;


-- ============================================================================
-- 6. Grants (internal helpers stay private; clients only get safe entries)
-- ============================================================================

-- Internal-only: never callable by API roles.
revoke all on function public.user_wants_notification(uuid, text) from public;
revoke all on function public.user_wants_notification(uuid, text) from anon;
revoke all on function public.user_wants_notification(uuid, text) from authenticated;

revoke all on function public.notify_group_activity(uuid, uuid, text, text, text, numeric, text, uuid, text) from public;
revoke all on function public.notify_group_activity(uuid, uuid, text, text, text, numeric, text, uuid, text) from anon;
revoke all on function public.notify_group_activity(uuid, uuid, text, text, text, numeric, text, uuid, text) from authenticated;

revoke all on function public.notify_expense_inserted() from public;
revoke all on function public.notify_expense_inserted() from anon;
revoke all on function public.notify_expense_inserted() from authenticated;

revoke all on function public.notify_expense_updated() from public;
revoke all on function public.notify_expense_updated() from anon;
revoke all on function public.notify_expense_updated() from authenticated;

revoke all on function public.notify_expense_deleted() from public;
revoke all on function public.notify_expense_deleted() from anon;
revoke all on function public.notify_expense_deleted() from authenticated;

revoke all on function public.notify_settlement_recorded() from public;
revoke all on function public.notify_settlement_recorded() from anon;
revoke all on function public.notify_settlement_recorded() from authenticated;

revoke all on function public.notify_invitation_received() from public;
revoke all on function public.notify_invitation_received() from anon;
revoke all on function public.notify_invitation_received() from authenticated;

revoke all on function public.touch_personal_expenses_updated_at() from public;
revoke all on function public.touch_personal_expenses_updated_at() from anon;
revoke all on function public.touch_personal_expenses_updated_at() from authenticated;

-- Read-only helper used by the frontend for a friendly pre-check. Group members
-- can already read one another's expenses and settlements, so a member's net
-- balance is not newly sensitive.
revoke all on function public.group_member_net_balance(uuid, uuid) from public;
revoke all on function public.group_member_net_balance(uuid, uuid) from anon;
grant execute on function public.group_member_net_balance(uuid, uuid) to authenticated;

-- remove_group_member keeps its existing signature and authenticated grant.
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.remove_group_member(uuid, uuid) from anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
