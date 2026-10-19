-- Review and apply this migration in Supabase. It is not run by the frontend.
-- Prerequisites: RLS must remain enabled on public.groups, public.group_members,
-- and public.profiles. The existing group creation trigger must add the creator
-- to public.group_members with the owner role.
-- The function intentionally exposes no phone number or other private profile fields.

create or replace function public.list_group_members(target_group_id uuid)
returns table (
  user_id uuid,
  role text,
  joined_at timestamptz,
  full_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    gm.user_id,
    gm.role::text,
    gm.joined_at,
    p.full_name,
    p.avatar_url
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  where gm.group_id = $1
    and exists (
      select 1
      from public.group_members caller_membership
      where caller_membership.group_id = $1
        and caller_membership.user_id = auth.uid()
    )
  order by gm.joined_at asc;
$$;

revoke all on function public.list_group_members(uuid) from public;
revoke all on function public.list_group_members(uuid) from anon;
grant execute on function public.list_group_members(uuid) to authenticated;
