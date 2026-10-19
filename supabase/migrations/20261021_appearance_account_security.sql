-- ============================================================================
-- SplitSmart: Appearance + Account security
--   Stage 8 (additive, self-contained)
--
-- Contents
--   1. user_preferences.theme_mode  (Light / Dark / System, default 'system')
--   2. Safe account-deletion policy + functions
--        * internal report helper (never callable by API roles)
--        * public.my_account_deletion_status()  (own account only)
--        * public.delete_own_account_data(uuid) (service-role only)
--
-- Design notes
--   Deleting an auth user is only safe when it does not damage OTHER people's
--   data. The live schema makes this explicit:
--     - expense_shares.user_id            ON DELETE CASCADE  (would remove the
--       user's shares and silently change other members' balances)
--     - expenses.paid_by / created_by     ON DELETE NO ACTION (blocks the delete)
--     - settlements.paid_by / paid_to     ON DELETE NO ACTION
--     - recurring_bills.paid_by           ON DELETE NO ACTION
--     - groups.created_by / group_invitations.invited_by  ON DELETE NO ACTION
--   Therefore the policy is:
--     * Groups where the user is the SOLE member are deleted in full (nothing
--       belongs to anyone else), which cascades their expenses/shares/
--       settlements/recurring bills/invitations/links/notifications.
--     * Non-financial "created_by" metadata in groups that survive is reassigned
--       to a remaining owner/member (ownership transfer of metadata only).
--     * If the user still shares financial records with anyone (still a member
--       of a multi-member group, or holds expenses/shares/settlements/recurring
--       bills in a group that is not being fully deleted), deletion is BLOCKED
--       with instructions. Shared expense history and other members' balances
--       are never modified.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Appearance preference
-- ----------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists theme_mode text not null default 'system';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_preferences_theme_mode_supported'
      and conrelid = 'public.user_preferences'::regclass
  ) then
    alter table public.user_preferences
      add constraint user_preferences_theme_mode_supported
      check (theme_mode in ('system', 'light', 'dark'));
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. Internal deletion report (blockers + what would be removed)
--    Never granted to anon/authenticated; only service_role may execute.
-- ----------------------------------------------------------------------------
create or replace function public._account_deletion_report(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sole_ids uuid[];
  v_blockers jsonb := '[]'::jsonb;
  v_sole_groups jsonb := '[]'::jsonb;
  v_shared_memberships int;
  v_financial int;
begin
  if p_user_id is null then
    return jsonb_build_object('can_delete', false, 'blockers', '[]'::jsonb,
      'message', 'No account was specified.');
  end if;

  -- Groups the user belongs to and is the only member of.
  select coalesce(array_agg(g.id), '{}'::uuid[])
    into v_sole_ids
    from public.groups g
   where (select count(*) from public.group_members m2 where m2.group_id = g.id) = 1
     and exists (
       select 1 from public.group_members m
        where m.group_id = g.id and m.user_id = p_user_id
     );

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)), '[]'::jsonb)
    into v_sole_groups
    from public.groups g
   where g.id = any (v_sole_ids);

  -- Blocker A: still a member of a shared (multi-member) group.
  select count(*) into v_shared_memberships
    from public.group_members m
    join public.groups g on g.id = m.group_id
   where m.user_id = p_user_id
     and not (g.id = any (v_sole_ids));

  if v_shared_memberships > 0 then
    select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
             'group_id', g.id,
             'group_name', g.name,
             'reason', 'You are still a member. Settle up, then leave this group (and hand over ownership if you are the last owner).'
           )), '[]'::jsonb)
      into v_blockers
      from public.group_members m
      join public.groups g on g.id = m.group_id
     where m.user_id = p_user_id
       and not (g.id = any (v_sole_ids));
  end if;

  -- Blocker B: shared financial records in groups that will not be deleted.
  select count(*) into v_financial
    from (
      select e.group_id from public.expenses e
       where e.paid_by = p_user_id and not (e.group_id = any (v_sole_ids))
      union
      select e.group_id from public.expense_shares s
        join public.expenses e on e.id = s.expense_id
       where s.user_id = p_user_id and not (e.group_id = any (v_sole_ids))
      union
      select st.group_id from public.settlements st
       where (st.paid_by = p_user_id or st.paid_to = p_user_id)
         and not (st.group_id = any (v_sole_ids))
      union
      select rb.group_id from public.recurring_bills rb
       where rb.paid_by = p_user_id and not (rb.group_id = any (v_sole_ids))
    ) refs;

  if v_financial > 0 then
    select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
             'group_id', g.id,
             'group_name', g.name,
             'reason', 'This group still holds shared expense history that involves you. The amounts are preserved for the other members, so your account cannot be deleted until these records are settled and removed by a group owner.'
           )), '[]'::jsonb)
      into v_blockers
      from public.groups g
     where g.id in (
        select e.group_id from public.expenses e
         where e.paid_by = p_user_id and not (e.group_id = any (v_sole_ids))
        union
        select e.group_id from public.expense_shares s
          join public.expenses e on e.id = s.expense_id
         where s.user_id = p_user_id and not (e.group_id = any (v_sole_ids))
        union
        select st.group_id from public.settlements st
         where (st.paid_by = p_user_id or st.paid_to = p_user_id)
           and not (st.group_id = any (v_sole_ids))
        union
        select rb.group_id from public.recurring_bills rb
         where rb.paid_by = p_user_id and not (rb.group_id = any (v_sole_ids))
     );
  end if;

  return jsonb_build_object(
    'can_delete', jsonb_array_length(v_blockers) = 0,
    'sole_member_groups', v_sole_groups,
    'blockers', v_blockers,
    'message', case
      when jsonb_array_length(v_blockers) = 0 then
        'Your account and private data can be deleted safely. Groups you own alone will be removed; no other member''s data is affected.'
      else
        'Your account cannot be deleted yet because it is still linked to shared groups or shared expense history. Resolve the items below first.'
    end
  );
end;
$$;

revoke all on function public._account_deletion_report(uuid) from public;
revoke all on function public._account_deletion_report(uuid) from anon;
revoke all on function public._account_deletion_report(uuid) from authenticated;


-- ----------------------------------------------------------------------------
-- 3. Client-facing status preview (own account only)
-- ----------------------------------------------------------------------------
create or replace function public.my_account_deletion_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  return public._account_deletion_report(v_uid);
end;
$$;

revoke all on function public.my_account_deletion_status() from public;
revoke all on function public.my_account_deletion_status() from anon;
grant execute on function public.my_account_deletion_status() to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Perform deletion (service-role only, invoked by the delete-account edge
--    function after it has verified the caller's JWT)
-- ----------------------------------------------------------------------------
create or replace function public.delete_own_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_sole_ids uuid[];
  v_deleted_groups int := 0;
  v_reassigned int := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'No account was specified.');
  end if;

  v_report := public._account_deletion_report(p_user_id);

  if not (v_report ->> 'can_delete')::boolean then
    return jsonb_build_object(
      'ok', false,
      'error', v_report ->> 'message',
      'blockers', v_report -> 'blockers'
    );
  end if;

  select coalesce(array_agg(g.id), '{}'::uuid[])
    into v_sole_ids
    from public.groups g
   where (select count(*) from public.group_members m2 where m2.group_id = g.id) = 1
     and exists (
       select 1 from public.group_members m
        where m.group_id = g.id and m.user_id = p_user_id
     );

  -- 4a. Reassign non-financial "created_by" metadata in groups that survive,
  --     so nobody else's group is removed. Target = an owner, else any member.
  update public.groups g
     set created_by = coalesce(
           (select m.user_id from public.group_members m
             where m.group_id = g.id and m.role = 'owner'
             order by m.joined_at limit 1),
           (select m.user_id from public.group_members m
             where m.group_id = g.id
             order by m.joined_at limit 1)
         )
   where g.created_by = p_user_id
     and not (g.id = any (v_sole_ids))
     and exists (select 1 from public.group_members m where m.group_id = g.id);
  get diagnostics v_reassigned = row_count;

  update public.expenses e
     set created_by = coalesce(
           (select m.user_id from public.group_members m
             where m.group_id = e.group_id and m.role = 'owner'
             order by m.joined_at limit 1),
           (select m.user_id from public.group_members m
             where m.group_id = e.group_id
             order by m.joined_at limit 1)
         )
   where e.created_by = p_user_id
     and not (e.group_id = any (v_sole_ids));

  update public.recurring_bills rb
     set created_by = coalesce(
           (select m.user_id from public.group_members m
             where m.group_id = rb.group_id and m.role = 'owner'
             order by m.joined_at limit 1),
           (select m.user_id from public.group_members m
             where m.group_id = rb.group_id
             order by m.joined_at limit 1)
         )
   where rb.created_by = p_user_id
     and not (rb.group_id = any (v_sole_ids));

  update public.group_invite_links l
     set created_by = coalesce(
           (select m.user_id from public.group_members m
             where m.group_id = l.group_id and m.role = 'owner'
             order by m.joined_at limit 1),
           (select m.user_id from public.group_members m
             where m.group_id = l.group_id
             order by m.joined_at limit 1)
         )
   where l.created_by = p_user_id
     and not (l.group_id = any (v_sole_ids));

  -- 4b. Remove invitations the user issued. Non-financial metadata.
  delete from public.group_invitations where invited_by = p_user_id;

  -- 4c. Remove legacy/unused bills the user created.
  delete from public.bills where created_by = p_user_id;

  -- 4d. Delete groups the user owned alone. Cascades all related rows.
  select count(*) into v_deleted_groups
    from public.groups g where g.id = any (v_sole_ids);
  delete from public.groups g where g.id = any (v_sole_ids);

  -- 4e. Delete the user's own private rows. Most cascade with the auth user,
  --     but we remove them here so the account data is gone even if the auth
  --     deletion is retried or performed separately.
  delete from public.personal_expenses where user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.user_preferences where user_id = p_user_id;
  delete from public.group_members where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'deleted_groups', v_deleted_groups,
    'reassigned_owners', v_reassigned
  );
end;
$$;

revoke all on function public.delete_own_account_data(uuid) from public;
revoke all on function public.delete_own_account_data(uuid) from anon;
revoke all on function public.delete_own_account_data(uuid) from authenticated;
grant execute on function public.delete_own_account_data(uuid) to service_role;
