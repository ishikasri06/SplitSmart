-- Stage 4: reusable, per-group invitation links (plus unified invite preview/accept)
-- ============================================================================
-- This migration is ADDITIVE and IDEMPOTENT. Run it once in the Supabase SQL
-- editor. It does NOT require re-running the earlier invitation migration and
-- does NOT modify or drop any existing object.
--
-- Why a separate table instead of reusing public.group_invitations:
--   * public.group_invitations has CHECK (invited_email IS NOT NULL OR
--     invited_phone IS NOT NULL), so an email-less reusable link cannot be
--     represented there without weakening that constraint.
--   * An email invitation is a one-shot record that becomes 'accepted' after
--     the first join. A reusable link must stay usable by many people, so it
--     needs its own lifetime (active / revoked / expired) and must NOT be marked
--     accepted when someone joins.
--   * Keeping them separate lets the existing email-specific functions and RLS
--     policies continue to work exactly as before.
--
-- Security properties:
--   * Only a SHA-256 hash of the secret token is stored (pgcrypto digest).
--   * Tokens are 32 random bytes from pgcrypto gen_random_bytes (192+ bits).
--   * Every function is SECURITY DEFINER with an empty search_path, checks
--     auth.uid(), and authorizes the caller with public.is_group_admin.
--   * The table has RLS enabled with NO policies, so it is reachable only
--     through the SECURITY DEFINER functions below. Direct table access is
--     revoked from anon/authenticated as a second layer.
--   * The preview exposes only the group name; no private group data leaks.
--   * Joining only inserts a membership row for the link's own group_id, so it
--     can never grant access to another group. Duplicate joins are no-ops.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Reusable invite-link record (one active link per group)
-- ---------------------------------------------------------------------------

create table if not exists public.group_invite_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  token_hash text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Only one ACTIVE link per group. (The token hash is globally unique.)
create unique index if not exists group_invite_links_active_key
  on public.group_invite_links (group_id)
  where status = 'active';

create unique index if not exists group_invite_links_token_hash_key
  on public.group_invite_links (token_hash);

create index if not exists group_invite_links_group_idx
  on public.group_invite_links (group_id);

alter table public.group_invite_links enable row level security;

-- No policies: only the SECURITY DEFINER functions may touch this table.
revoke all on table public.group_invite_links from anon;
revoke all on table public.group_invite_links from authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_group_invite_link: owner/admin mints (or reuses) the group's link.
--    Idempotent: if an active, unexpired link already exists it is returned and
--    no new token is minted. The raw token is returned exactly once, at
--    creation; only its SHA-256 hash is persisted.
--    NOTE: `expires_at` is also a RETURNS TABLE output name, so every column
--    reference to it below is table-qualified to avoid the 42702 ambiguity.
-- ---------------------------------------------------------------------------

create or replace function public.create_group_invite_link(p_group_id uuid)
returns table (
  link_id uuid,
  token text,
  expires_at timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_hash text;
  v_expires timestamptz;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create an invite link.';
  end if;

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can create invite links.';
  end if;

  -- Housekeeping: retire any stale active link for this group.
  update public.group_invite_links as l
     set status = 'expired'
   where l.group_id = p_group_id
     and l.status = 'active'
     and l.expires_at < now();

  -- Reuse the current active link instead of minting a new token.
  select l.id, l.expires_at
    into v_id, v_expires
    from public.group_invite_links l
   where l.group_id = p_group_id
     and l.status = 'active'
   limit 1;

  if v_id is not null then
    return query select v_id, null::text, v_expires, false;
    return;
  end if;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.group_invite_links
    (group_id, created_by, token_hash, status, expires_at)
  values
    (p_group_id, v_uid, v_hash, 'active', v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_group_invite_link: owner/admin reads the active link's metadata.
--    Never returns the raw token or its hash.
-- ---------------------------------------------------------------------------

create or replace function public.get_group_invite_link(p_group_id uuid)
returns table (
  link_id uuid,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can view the invite link.';
  end if;

  return query
    select l.id, l.status, l.expires_at, l.created_at
      from public.group_invite_links l
     where l.group_id = p_group_id
       and l.status = 'active'
       and l.expires_at >= now()
     limit 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. revoke_group_invite_link: owner/admin revokes the group's active link.
-- ---------------------------------------------------------------------------

create or replace function public.revoke_group_invite_link(p_group_id uuid)
returns void
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

  if not public.is_group_admin(p_group_id) then
    raise exception 'Only group owners and admins can revoke the invite link.';
  end if;

  update public.group_invite_links as l
     set status = 'revoked', revoked_at = now()
   where l.group_id = p_group_id
     and l.status = 'active';

  if not found then
    raise exception 'There is no active invite link to revoke.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_invite_preview: unified, anonymous-readable preview for BOTH an
--    email invitation and a reusable link. Adds a `kind` discriminator so the
--    frontend can distinguish them. Exposes only the group name.
-- ---------------------------------------------------------------------------

create or replace function public.get_invite_preview(p_token text)
returns table (
  invitation_id uuid,
  kind text,
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
  with h as (
    select pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex') as token_hash
  )
  select *
    from (
      select
        l.id as invitation_id,
        'link'::text as kind,
        l.group_id,
        g.name as group_name,
        null::text as invited_email,
        case
          when l.status = 'revoked' then 'revoked'
          when l.status = 'expired' or l.expires_at < now() then 'expired'
          else 'active'
        end as status,
        l.expires_at
      from public.group_invite_links l
      join public.groups g on g.id = l.group_id
      cross join h
      where l.token_hash = h.token_hash

      union all

      select
        i.id as invitation_id,
        'email'::text as kind,
        i.group_id,
        g.name as group_name,
        i.invited_email,
        case
          when i.status = 'pending' and i.expires_at < now() then 'expired'
          else i.status
        end as status,
        i.expires_at
      from public.group_invitations i
      join public.groups g on g.id = i.group_id
      cross join h
      where i.token_hash = h.token_hash
    ) r
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. accept_invite: unified acceptance that dispatches on the token type.
--    * Reusable link  -> join the link's group; the link stays active so many
--                        different authenticated users can use it.
--    * Email invite   -> delegated to the existing accept_group_invitation,
--                        which keeps enforcing the invited-email match.
--    Both paths require a signed-in, email-verified account.
--    `group_id` is a RETURNS TABLE output name, so `group_members.group_id`
--    is inert here (no bare reference) and the conflict target names the
--    unique constraint to avoid the 42702 ambiguity.
-- ---------------------------------------------------------------------------

create or replace function public.accept_invite(p_token text)
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
  v_link public.group_invite_links%rowtype;
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

  select l.*
    into v_link
    from public.group_invite_links l
   where l.token_hash = v_hash
   for update;

  if found then
    if v_link.status = 'revoked' then
      raise exception 'This invitation link has been revoked.';
    end if;

    if v_link.status = 'expired' or v_link.expires_at < now() then
      raise exception 'This invitation link has expired.';
    end if;

    if v_link.status <> 'active' then
      raise exception 'This invitation link is no longer valid.';
    end if;

    insert into public.group_members (group_id, user_id, role)
    values (v_link.group_id, v_uid, 'member')
    on conflict on constraint group_members_group_id_user_id_key do nothing;

    select g.name into v_group_name
      from public.groups g
     where g.id = v_link.group_id;

    return query select v_link.group_id, v_group_name;
    return;
  end if;

  -- Not a link token: fall back to the email-invitation path.
  return query
    select a.group_id, a.group_name
      from public.accept_group_invitation(p_token) a;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: revoke implicit PUBLIC access, then grant narrowly.
-- ---------------------------------------------------------------------------

revoke all on function public.create_group_invite_link(uuid) from public;
revoke all on function public.create_group_invite_link(uuid) from anon;
grant execute on function public.create_group_invite_link(uuid) to authenticated;

revoke all on function public.get_group_invite_link(uuid) from public;
revoke all on function public.get_group_invite_link(uuid) from anon;
grant execute on function public.get_group_invite_link(uuid) to authenticated;

revoke all on function public.revoke_group_invite_link(uuid) from public;
revoke all on function public.revoke_group_invite_link(uuid) from anon;
grant execute on function public.revoke_group_invite_link(uuid) to authenticated;

-- Preview must be readable before sign-in so the invitee sees the group name.
revoke all on function public.get_invite_preview(text) from public;
grant execute on function public.get_invite_preview(text) to anon, authenticated;

revoke all on function public.accept_invite(text) from public;
revoke all on function public.accept_invite(text) from anon;
grant execute on function public.accept_invite(text) to authenticated;
