-- Stage 3 fix: "column reference \"group_id\" is ambiguous"
-- ----------------------------------------------------------------------------
-- Symptom (Supabase SQL editor / app):
--   Accepting a group invitation failed with
--     ERROR: 42702: column reference "group_id" is ambiguous
--
-- Root cause:
--   public.accept_group_invitation is declared with
--     returns table (group_id uuid, group_name text)
--   In PL/pgSQL those RETURNS TABLE columns are OUT parameters, i.e. variables
--   named `group_id` and `group_name` that are in scope for the whole body.
--   The membership insert used
--     on conflict (group_id, user_id) do nothing
--   where `group_id` is simultaneously the OUT variable and the
--   public.group_members.group_id column, so the planner cannot resolve it.
--
-- Why an alias does not fix it:
--   Postgres does not permit table-alias qualification inside an ON CONFLICT
--   inference list (`on conflict (gm.group_id, ...)` is a syntax error), and the
--   clash is with the OUT parameter name, which also cannot be renamed without
--   changing the function's return signature (that would break the frontend,
--   which reads group_id / group_name). The correct, minimal fix is therefore
--   to name the unique constraint as the conflict target instead of listing the
--   ambiguous columns.
--
-- Scope:
--   This migration only replaces public.accept_group_invitation. All existing
--   behaviour is preserved exactly:
--     * SECURITY DEFINER + empty search_path
--     * auth.uid() sign-in requirement
--     * verified-email (email_confirmed_at) requirement
--     * invited-email match
--     * SHA-256 invitation-token hashing via extensions.digest
--     * FOR UPDATE row lock (prevents concurrent double-accept)
--     * status + expiry validation
--     * idempotent membership insert (ON CONFLICT DO NOTHING)
--     * invitation status update (accepted / accepted_at / accepted_by)
--   No RLS policy, grant scope, or authorization check is weakened or changed.

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

  select i.*
    into v_inv
    from public.group_invitations i
   where i.token_hash = v_hash
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

  -- Fixed: name the unique constraint instead of the ambiguous column list.
  -- The constraint public.group_members_group_id_user_id_key is
  -- UNIQUE (group_id, user_id) and is what prevents duplicate memberships.
  insert into public.group_members (group_id, user_id, role)
  values (v_inv.group_id, v_uid, 'member')
  on conflict on constraint group_members_group_id_user_id_key do nothing;

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

-- CREATE OR REPLACE preserves the existing ACL, but re-asserting the intended
-- privileges keeps this patch safe to run on its own (idempotent either way).
revoke all on function public.accept_group_invitation(text) from public;
revoke all on function public.accept_group_invitation(text) from anon;
grant execute on function public.accept_group_invitation(text) to authenticated;
