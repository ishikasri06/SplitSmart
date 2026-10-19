-- Stage 3: Secure group invitations and member management.
-- Review and apply this migration manually in the Supabase SQL editor. The
-- frontend never runs SQL and never uses a service-role key.
--
-- Prerequisites already present in this project:
--   * public.is_group_member(uuid) and public.is_group_admin(uuid) exist.
--   * RLS is enabled on public.groups, public.group_members, public.profiles.
--   * A trigger adds the group creator to public.group_members as 'owner'.
--   * pgcrypto is installed in the "extensions" schema (Supabase default).
--
-- This migration:
--   1. Records how an invitation was accepted (accepted_at / accepted_by).
--   2. Prevents duplicate pending invitations for the same group + email.
--   3. Adds SECURITY DEFINER RPCs that validate every action server-side.
--
-- No RLS policy is weakened or disabled. Every function runs with an empty
-- search_path, checks auth.uid(), and is granted only where intended.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. group_invitations: acceptance bookkeeping + duplicate protection
-- ---------------------------------------------------------------------------

alter table public.group_invitations
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users (id) on delete set null;

create index if not exists group_invitations_group_status_idx
  on public.group_invitations (group_id, status);

-- Backing index for a unique pending invitation per (group, email).
create unique index if not exists group_invitations_pending_email_key
  on public.group_invitations (group_id, lower(btrim(invited_email)))
  where status = 'pending' and invited_email is not null;

-- ---------------------------------------------------------------------------
-- 2. create_group_invitation: owner/admin creates a token-based invite
--    Re-inviting the same email revokes the previous pending invite first,
--    so the token is always fresh and the unique index is never violated.
--    The raw token is returned exactly once and only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------

create or replace function public.create_group_invitation(
  p_group_id uuid,
  p_email text
)
returns table (
  invitation_id uuid,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_hash text;
  v_expires timestamptz := now() + interval '7 days';
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to invite members.';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can invite members.';
  end if;

  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  update public.group_invitations
     set status = 'revoked'
   where group_id = p_group_id
     and status = 'pending'
     and invited_email is not null
     and lower(btrim(invited_email)) = v_email;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.group_invitations
    (group_id, invited_by, invited_email, token_hash, status, expires_at)
  values
    (p_group_id, v_uid, v_email, v_hash, 'pending', v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_invitation_preview: safe, anonymous-readable invite details.
--    Exposes only the group name, the invited email, and the status.
-- ---------------------------------------------------------------------------

create or replace function public.get_invitation_preview(p_token text)
returns table (
  invitation_id uuid,
  group_id uuid,
  group_name text,
  invited_email text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.group_id,
    g.name,
    i.invited_email,
    case
      when i.status = 'pending' and i.expires_at < now() then 'expired'
      else i.status
    end,
    i.expires_at
  from public.group_invitations i
  join public.groups g on g.id = i.group_id
  where i.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. accept_group_invitation: verified signed-in user joins the group.
--    The invitation row is locked FOR UPDATE so two concurrent accepts cannot
--    both succeed. The account email must match the invited email.
-- ---------------------------------------------------------------------------

create or replace function public.accept_group_invitation(p_token text)
returns table (
  group_id uuid,
  group_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_confirmed timestamptz;
  v_hash text;
  v_inv public.group_invitations%rowtype;
  v_group_name text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to accept an invitation.';
  end if;

  select lower(u.email), u.email_confirmed_at
    into v_user_email, v_confirmed
    from auth.users u
   where u.id = v_uid;

  if v_user_email is null then
    raise exception 'Your account has no email address.';
  end if;

  if v_confirmed is null then
    raise exception 'Please verify your email address before accepting this invitation.';
  end if;

  v_hash := pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');

  select *
    into v_inv
    from public.group_invitations
   where token_hash = v_hash
   for update;

  if not found then
    raise exception 'This invitation link is not valid.';
  end if;

  if v_inv.status = 'accepted' then
    raise exception 'This invitation has already been accepted.';
  end if;

  if v_inv.status = 'revoked' then
    raise exception 'This invitation has been revoked.';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'This invitation is no longer valid.';
  end if;

  if v_inv.expires_at < now() then
    raise exception 'This invitation has expired.';
  end if;

  if v_inv.invited_email is null
     or lower(btrim(v_inv.invited_email)) <> v_user_email then
    raise exception 'This invitation was sent to a different email address.';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_inv.group_id, v_uid, 'member')
  on conflict (group_id, user_id) do nothing;

  update public.group_invitations
     set status = 'accepted',
         accepted_at = now(),
         accepted_by = v_uid
   where id = v_inv.id;

  select g.name into v_group_name
    from public.groups g
   where g.id = v_inv.group_id;

  return query select v_inv.group_id, v_group_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. revoke_group_invitation: owner/admin revokes a pending invite.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_group_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select group_id into v_group_id
    from public.group_invitations
   where id = p_invitation_id;

  if v_group_id is null then
    raise exception 'Invitation not found.';
  end if;

  if not public.is_group_admin(v_group_id) then
    raise exception 'Only group owners and admins can revoke invitations.';
  end if;

  update public.group_invitations
     set status = 'revoked'
   where id = p_invitation_id
     and status = 'pending';

  if not found then
    raise exception 'Only pending invitations can be revoked.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. list_group_invitations: owner/admin only. Never exposes token_hash.
-- ---------------------------------------------------------------------------

create or replace function public.list_group_invitations(p_group_id uuid)
returns table (
  invitation_id uuid,
  invited_email text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can view invitations.';
  end if;

  return query
    select
      i.id,
      i.invited_email,
      case
        when i.status = 'pending' and i.expires_at < now() then 'expired'
        else i.status
      end,
      i.created_at,
      i.expires_at,
      i.accepted_at
    from public.group_invitations i
   where i.group_id = p_group_id
   order by i.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. remove_group_member: members may leave; owners/admins may remove others.
--    A group can never be left without at least one owner.
--    Removing a membership never deletes financial rows (FKs point to
--    auth.users), preserving historical balances.
-- ---------------------------------------------------------------------------

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

  delete from public.group_members
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. set_group_member_role: only an owner may change roles, and an owner can
--    never demote the last remaining owner.
-- ---------------------------------------------------------------------------

create or replace function public.set_group_member_role(
  p_group_id uuid,
  p_user_id uuid,
  p_role text
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
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Invalid role.';
  end if;

  select role into v_requester_role
    from public.group_members
   where group_id = p_group_id and user_id = v_uid;

  if v_requester_role is null or v_requester_role <> 'owner' then
    raise exception 'Only a group owner can change member roles.';
  end if;

  select role into v_target_role
    from public.group_members
   where group_id = p_group_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'That person is not a member of this group.';
  end if;

  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.group_members
     where group_id = p_group_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'A group must keep at least one owner.';
    end if;
  end if;

  update public.group_members
     set role = p_role
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Privileges: revoke the implicit PUBLIC grant, then grant narrowly.
-- ---------------------------------------------------------------------------

revoke all on function public.create_group_invitation(uuid, text) from public;
revoke all on function public.create_group_invitation(uuid, text) from anon;
grant execute on function public.create_group_invitation(uuid, text) to authenticated;

-- The preview must be readable before sign-in so the invitee sees the group.
revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

revoke all on function public.accept_group_invitation(text) from public;
revoke all on function public.accept_group_invitation(text) from anon;
grant execute on function public.accept_group_invitation(text) to authenticated;

revoke all on function public.revoke_group_invitation(uuid) from public;
revoke all on function public.revoke_group_invitation(uuid) from anon;
grant execute on function public.revoke_group_invitation(uuid) to authenticated;

revoke all on function public.list_group_invitations(uuid) from public;
revoke all on function public.list_group_invitations(uuid) from anon;
grant execute on function public.list_group_invitations(uuid) to authenticated;

revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.remove_group_member(uuid, uuid) from anon;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

revoke all on function public.set_group_member_role(uuid, uuid, text) from public;
revoke all on function public.set_group_member_role(uuid, uuid, text) from anon;
grant execute on function public.set_group_member_role(uuid, uuid, text) to authenticated;
