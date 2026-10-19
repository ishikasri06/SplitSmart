-- ============================================================================
-- SplitSmart: hand over group.create_by when a member leaves / is removed
--   Fix migration (additive, idempotent)
--
-- Problem
--   public.groups RLS grants SELECT with:
--       (created_by = auth.uid()) OR public.is_group_member(id)
--   and DELETE with:
--       (created_by = auth.uid())
--   public.groups.created_by was never updated when the creator left a group.
--   After transferring ownership and leaving, the departed user still matched
--   "created_by = auth.uid()", so the group kept appearing in their Groups tab
--   and group selector even though their public.group_members row was gone --
--   and they could still DELETE the group they no longer belonged to.
--
-- Fix
--   Keep every RLS policy exactly as it is. Instead, make
--   public.remove_group_member() hand over the non-financial created_by
--   metadata when the removed user was its target, using the same rule as
--   public.delete_own_account_data(): prefer a remaining owner, else the
--   longest-standing remaining member. Once created_by points at a member,
--   the departed user no longer matches either policy.
--
-- What this migration does NOT do
--   * It never deletes a group, expense, share, settlement or invitation.
--   * It never changes membership, roles or financial data.
--   * It leaves all policies, grants and triggers untouched.
--
-- Safety
--   * Additive and idempotent: create or replace + a conditional backfill that
--     only touches groups whose created_by is not a current member.
--   * The last-owner rule and the outstanding-balance guard are preserved.
--   * SECURITY DEFINER + search_path = '' as before; execute stays with
--     authenticated only.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Backfill any group whose created_by already points at a non-member.
--    (Repairs groups left behind before this migration was applied.)
-- ----------------------------------------------------------------------------

update public.groups g
   set created_by = coalesce(
         (select m.user_id
            from public.group_members m
           where m.group_id = g.id and m.role = 'owner'
           order by m.joined_at
           limit 1),
         (select m.user_id
            from public.group_members m
           where m.group_id = g.id
           order by m.joined_at
           limit 1)
       )
 where exists (select 1 from public.group_members m where m.group_id = g.id)
   and not exists (
     select 1
       from public.group_members m
      where m.group_id = g.id
        and m.user_id = g.created_by
   );


-- ----------------------------------------------------------------------------
-- 2. remove_group_member: identical rules to 20261020, plus the created_by
--    hand-over after the membership row is deleted (self-leave and admin
--    removal alike).
-- ----------------------------------------------------------------------------

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

    -- Hand the non-financial created_by metadata to a remaining member, so the
    -- departed user no longer matches the groups SELECT/DELETE policies.
    update public.groups g
       set created_by = coalesce(
             (select m.user_id
                from public.group_members m
               where m.group_id = g.id and m.role = 'owner'
               order by m.joined_at
               limit 1),
             (select m.user_id
                from public.group_members m
               where m.group_id = g.id
               order by m.joined_at
               limit 1)
           )
     where g.id = p_group_id
       and g.created_by = p_user_id
       and exists (select 1 from public.group_members m where m.group_id = g.id);

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

  update public.groups g
     set created_by = coalesce(
           (select m.user_id
              from public.group_members m
             where m.group_id = g.id and m.role = 'owner'
             order by m.joined_at
             limit 1),
           (select m.user_id
              from public.group_members m
             where m.group_id = g.id
             order by m.joined_at
             limit 1)
         )
   where g.id = p_group_id
     and g.created_by = p_user_id
     and exists (select 1 from public.group_members m where m.group_id = g.id);
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. Re-assert the narrow grants (idempotent).
-- ----------------------------------------------------------------------------

revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.remove_group_member(uuid, uuid) from anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
