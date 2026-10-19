-- Recurring Bills feature (additive, self-contained).
-- ============================================================================
-- Review and apply this migration manually in the Supabase SQL editor. The
-- frontend never runs SQL and never uses a service-role key.
--
-- Design notes / schema conflict check:
--   * A legacy `public.bills` table already exists but is unused by the app.
--     It cannot represent a payer, participant set, split method, schedule
--     end date, or paid/unpaid occurrence history, and it has no link to the
--     cloud expense ledger. Rather than alter an unrelated legacy table, this
--     migration adds two dedicated tables.
--   * Every generated payment is written through the EXISTING
--     public.create_group_expense function, so balances, expense history and
--     the paise-safe split logic stay identical to ordinary expenses.
--
-- Security properties:
--   * RLS is enabled on both new tables.
--     - recurring_bills: any member may SELECT; only the creator or a group
--       admin may DELETE. INSERT/UPDATE are intentionally NOT granted to
--       clients; all writes go through SECURITY DEFINER RPCs that validate
--       group membership, payer membership and participant membership.
--     - recurring_bill_occurrences: any member may SELECT; clients cannot
--       write (all writes happen inside record_recurring_bill_payment), which
--       makes duplicate payments impossible to bypass from the client.
--   * Every function runs with an empty search_path and checks auth.uid().
--   * No existing policy or function is modified or dropped.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. recurring_bills: the schedule/configuration (NOT an expense)
-- ---------------------------------------------------------------------------

create table if not exists public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  title text not null,
  amount numeric not null check (amount > 0),
  currency character(3) not null default 'INR',
  category text not null default 'Other',
  notes text,
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date date not null,
  end_date date,
  next_due_date date not null,
  paid_by uuid not null references auth.users (id),
  split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percentage')),
  participant_ids jsonb not null default '[]'::jsonb,
  split_values jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_bills_end_after_start
    check (end_date is null or end_date >= start_date)
);

create index if not exists recurring_bills_group_idx
  on public.recurring_bills (group_id);
create index if not exists recurring_bills_group_next_idx
  on public.recurring_bills (group_id, next_due_date);
create index if not exists recurring_bills_status_idx
  on public.recurring_bills (status);

-- ---------------------------------------------------------------------------
-- 2. recurring_bill_occurrences: one row per recorded payment. The UNIQUE
--    constraint is the authoritative duplicate-payment guard.
-- ---------------------------------------------------------------------------

create table if not exists public.recurring_bill_occurrences (
  id uuid primary key default gen_random_uuid(),
  recurring_bill_id uuid not null
    references public.recurring_bills (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  occurrence_date date not null,
  expense_id uuid references public.expenses (id) on delete set null,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint recurring_bill_occurrences_unique
    unique (recurring_bill_id, occurrence_date)
);

create index if not exists recurring_bill_occurrences_bill_idx
  on public.recurring_bill_occurrences (recurring_bill_id);
create index if not exists recurring_bill_occurrences_group_idx
  on public.recurring_bill_occurrences (group_id);
create index if not exists recurring_bill_occurrences_date_idx
  on public.recurring_bill_occurrences (occurrence_date);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.recurring_bills enable row level security;
alter table public.recurring_bill_occurrences enable row level security;

drop policy if exists "Members can read recurring bills" on public.recurring_bills;
create policy "Members can read recurring bills"
  on public.recurring_bills
  for select
  using (public.is_group_member(group_id));

drop policy if exists "Creator or admins can delete recurring bills" on public.recurring_bills;
create policy "Creator or admins can delete recurring bills"
  on public.recurring_bills
  for delete
  using ((created_by = (select auth.uid())) or public.is_group_admin(group_id));

drop policy if exists "Members can read recurring bill occurrences" on public.recurring_bill_occurrences;
create policy "Members can read recurring bill occurrences"
  on public.recurring_bill_occurrences
  for select
  using (public.is_group_member(group_id));

-- Occurrences and bills are never written directly by clients; no INSERT or
-- UPDATE policies exist on purpose. RPCs below are the only write path.

revoke all on table public.recurring_bills from anon;
revoke all on table public.recurring_bill_occurrences from anon;
revoke insert, update on table public.recurring_bills from authenticated;
revoke insert, update, delete on table public.recurring_bill_occurrences from authenticated;
grant select on table public.recurring_bills to authenticated;
grant select on table public.recurring_bill_occurrences to authenticated;

-- ---------------------------------------------------------------------------
-- 4. recurring_next_due: advance a due date by one period. Postgres already
--    clamps month-end correctly (e.g. Jan 31 + 1 month = Feb 28/29).
-- ---------------------------------------------------------------------------

create or replace function public.recurring_next_due(p_date date, p_frequency text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'weekly' then (p_date + interval '7 days')::date
    when 'monthly' then (p_date + interval '1 month')::date
    when 'quarterly' then (p_date + interval '3 months')::date
    when 'yearly' then (p_date + interval '1 year')::date
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. recurring_assert_config: shared validation for create/update. Internal
--    helper only (execute is not granted to clients).
-- ---------------------------------------------------------------------------

create or replace function public.recurring_assert_config(
  p_group_id uuid,
  p_title text,
  p_amount_paise bigint,
  p_category text,
  p_frequency text,
  p_start_date date,
  p_end_date date,
  p_paid_by uuid,
  p_split_type text,
  p_participant_ids jsonb,
  p_split_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_distinct int;
  v_bad int;
  v_sum numeric;
begin
  if p_title is null or length(trim(p_title)) not between 1 and 200 then
    raise exception 'Title must contain 1-200 characters';
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Amount must be positive';
  end if;

  if p_category is null or length(trim(p_category)) = 0 then
    raise exception 'Category is required';
  end if;

  if p_frequency is null or p_frequency not in ('weekly', 'monthly', 'quarterly', 'yearly') then
    raise exception 'Invalid frequency';
  end if;

  if p_split_type is null or p_split_type not in ('equal', 'exact', 'percentage') then
    raise exception 'Invalid split type';
  end if;

  if p_start_date is null then
    raise exception 'Start date is required';
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before the start date';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_paid_by
  ) then
    raise exception 'Payer must belong to this group';
  end if;

  if p_participant_ids is null or jsonb_typeof(p_participant_ids) <> 'array' then
    raise exception 'Provide participants';
  end if;

  select count(*) into v_count from jsonb_array_elements_text(p_participant_ids);
  if v_count < 1 or v_count > 100 then
    raise exception 'Provide between 1 and 100 participants';
  end if;

  select count(distinct value) into v_distinct
    from jsonb_array_elements_text(p_participant_ids);
  if v_distinct <> v_count then
    raise exception 'Duplicate participants are not allowed';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements_text(p_participant_ids) e
   where not exists (
     select 1 from public.group_members gm
     where gm.group_id = p_group_id and gm.user_id = e.value::uuid
   );
  if v_bad > 0 then
    raise exception 'Every participant must belong to this group';
  end if;

  if p_split_type = 'exact' then
    select coalesce(sum(value::numeric), 0) into v_sum
      from jsonb_each_text(coalesce(p_split_values, '{}'::jsonb));
    if exists (
      select 1 from jsonb_each_text(coalesce(p_split_values, '{}'::jsonb))
      where value::numeric < 0
    ) then
      raise exception 'Exact shares must be zero or greater';
    end if;
    if abs(v_sum - (p_amount_paise::numeric / 100)) > 0.005 then
      raise exception 'Exact shares must add up to the bill amount';
    end if;
  elsif p_split_type = 'percentage' then
    select coalesce(sum(value::numeric), 0) into v_sum
      from jsonb_each_text(coalesce(p_split_values, '{}'::jsonb));
    if exists (
      select 1 from jsonb_each_text(coalesce(p_split_values, '{}'::jsonb))
      where value::numeric < 0 or value::numeric > 100
    ) then
      raise exception 'Percentages must be between 0 and 100';
    end if;
    if abs(v_sum - 100) > 0.001 then
      raise exception 'Percentages must total 100';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. create_recurring_bill: any group member may create a recurring bill.
-- ---------------------------------------------------------------------------

create or replace function public.create_recurring_bill(
  p_group_id uuid,
  p_title text,
  p_amount_paise bigint,
  p_category text,
  p_frequency text,
  p_start_date date,
  p_end_date date,
  p_paid_by uuid,
  p_split_type text,
  p_participant_ids jsonb,
  p_split_values jsonb,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;

  perform public.recurring_assert_config(
    p_group_id, p_title, p_amount_paise, p_category, p_frequency,
    p_start_date, p_end_date, p_paid_by, p_split_type,
    p_participant_ids, p_split_values
  );

  insert into public.recurring_bills (
    group_id, created_by, title, amount, currency, category, notes,
    frequency, start_date, end_date, next_due_date, paid_by,
    split_type, participant_ids, split_values, status
  )
  values (
    p_group_id, v_uid, trim(p_title), p_amount_paise::numeric / 100, 'INR',
    trim(p_category), p_notes, p_frequency, p_start_date, p_end_date,
    p_start_date, p_paid_by, p_split_type,
    p_participant_ids, coalesce(p_split_values, '{}'::jsonb), 'active'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. update_recurring_bill: creator or admin only.
-- ---------------------------------------------------------------------------

create or replace function public.update_recurring_bill(
  p_bill_id uuid,
  p_title text,
  p_amount_paise bigint,
  p_category text,
  p_frequency text,
  p_start_date date,
  p_end_date date,
  p_paid_by uuid,
  p_split_type text,
  p_participant_ids jsonb,
  p_split_values jsonb,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_bill public.recurring_bills%rowtype;
  v_has_occurrence boolean;
  v_next date;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_bill
    from public.recurring_bills
   where id = p_bill_id
   for update;

  if not found then
    raise exception 'Recurring bill not found';
  end if;

  if not (v_bill.created_by = v_uid or public.is_group_admin(v_bill.group_id)) then
    raise exception 'Only the bill creator or a group admin can edit this bill';
  end if;

  perform public.recurring_assert_config(
    v_bill.group_id, p_title, p_amount_paise, p_category, p_frequency,
    p_start_date, p_end_date, p_paid_by, p_split_type,
    p_participant_ids, p_split_values
  );

  select exists (
    select 1 from public.recurring_bill_occurrences
    where recurring_bill_id = p_bill_id
  ) into v_has_occurrence;

  v_next := case when v_has_occurrence then v_bill.next_due_date else p_start_date end;

  update public.recurring_bills
     set title = trim(p_title),
         amount = p_amount_paise::numeric / 100,
         category = trim(p_category),
         notes = p_notes,
         frequency = p_frequency,
         start_date = p_start_date,
         end_date = p_end_date,
         next_due_date = v_next,
         paid_by = p_paid_by,
         split_type = p_split_type,
         participant_ids = p_participant_ids,
         split_values = coalesce(p_split_values, '{}'::jsonb),
         updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. set_recurring_bill_status: pause / resume / cancel (creator or admin).
--    Cancelling never touches previously generated expenses.
-- ---------------------------------------------------------------------------

create or replace function public.set_recurring_bill_status(
  p_bill_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_bill public.recurring_bills%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if p_status not in ('active', 'paused', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  select * into v_bill
    from public.recurring_bills
   where id = p_bill_id
   for update;

  if not found then
    raise exception 'Recurring bill not found';
  end if;

  if not (v_bill.created_by = v_uid or public.is_group_admin(v_bill.group_id)) then
    raise exception 'Only the bill creator or a group admin can change the status';
  end if;

  -- Resuming a bill whose schedule already ended marks it completed.
  if p_status = 'active'
     and v_bill.end_date is not null
     and v_bill.next_due_date > v_bill.end_date then
    p_status := 'completed';
  end if;

  update public.recurring_bills
     set status = p_status, updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. record_recurring_bill_payment: atomically claim an occurrence, create a
--    real expense via the existing create_group_expense, and advance the
--    schedule. The occurrence INSERT ... ON CONFLICT is the duplicate guard.
-- ---------------------------------------------------------------------------

create or replace function public.record_recurring_bill_payment(
  p_bill_id uuid,
  p_occurrence_date date,
  p_shares jsonb
)
returns table (expense_id uuid, next_due_date date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_bill public.recurring_bills%rowtype;
  v_occurrence_id uuid;
  v_expense_id uuid;
  v_amount_paise bigint;
  v_next date;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  select * into v_bill
    from public.recurring_bills
   where id = p_bill_id
   for update;

  if not found then
    raise exception 'Recurring bill not found';
  end if;

  if not public.is_group_member(v_bill.group_id) then
    raise exception 'You are not a member of this group';
  end if;

  if v_bill.status <> 'active' then
    raise exception 'Only active recurring bills can record payments';
  end if;

  if p_occurrence_date is null then
    raise exception 'Occurrence date is required';
  end if;

  if p_occurrence_date <> v_bill.next_due_date then
    raise exception 'This is not the current due date for the bill';
  end if;

  if v_bill.end_date is not null and p_occurrence_date > v_bill.end_date then
    raise exception 'This recurring bill has ended';
  end if;

  insert into public.recurring_bill_occurrences (
    recurring_bill_id, group_id, occurrence_date, recorded_by
  )
  values (p_bill_id, v_bill.group_id, p_occurrence_date, v_uid)
  on conflict (recurring_bill_id, occurrence_date) do nothing
  returning id into v_occurrence_id;

  if v_occurrence_id is null then
    raise exception 'This occurrence has already been recorded';
  end if;

  v_amount_paise := round(v_bill.amount * 100)::bigint;

  v_expense_id := public.create_group_expense(
    v_bill.group_id,
    v_bill.title,
    v_amount_paise,
    v_bill.category,
    v_bill.paid_by,
    p_occurrence_date,
    v_bill.notes,
    v_bill.split_type,
    p_shares
  );

  update public.recurring_bill_occurrences
     set expense_id = v_expense_id
   where id = v_occurrence_id;

  v_next := public.recurring_next_due(v_bill.next_due_date, v_bill.frequency);

  if v_bill.end_date is not null and v_next > v_bill.end_date then
    update public.recurring_bills
       set next_due_date = v_next, status = 'completed', updated_at = now()
     where id = p_bill_id;
  else
    update public.recurring_bills
       set next_due_date = v_next, updated_at = now()
     where id = p_bill_id;
  end if;

  return query select v_expense_id, v_next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Privileges: revoke the implicit PUBLIC grant, then grant narrowly.
-- ---------------------------------------------------------------------------

revoke all on function public.recurring_next_due(date, text) from public;
revoke all on function public.recurring_next_due(date, text) from anon;
revoke all on function public.recurring_next_due(date, text) from authenticated;

revoke all on function public.recurring_assert_config(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb) from public;
revoke all on function public.recurring_assert_config(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb) from anon;
revoke all on function public.recurring_assert_config(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb) from authenticated;

revoke all on function public.create_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) from public;
revoke all on function public.create_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) from anon;
grant execute on function public.create_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) to authenticated;

revoke all on function public.update_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) from public;
revoke all on function public.update_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) from anon;
grant execute on function public.update_recurring_bill(uuid, text, bigint, text, text, date, date, uuid, text, jsonb, jsonb, text) to authenticated;

revoke all on function public.set_recurring_bill_status(uuid, text) from public;
revoke all on function public.set_recurring_bill_status(uuid, text) from anon;
grant execute on function public.set_recurring_bill_status(uuid, text) to authenticated;

revoke all on function public.record_recurring_bill_payment(uuid, date, jsonb) from public;
revoke all on function public.record_recurring_bill_payment(uuid, date, jsonb) from anon;
grant execute on function public.record_recurring_bill_payment(uuid, date, jsonb) to authenticated;
