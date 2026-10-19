-- ============================================================================
-- SplitSmart: Restore missing profiles + harden profile creation
--   Repair migration (additive, idempotent)
--
-- Incident
--   One row was deleted by hand from public.profiles in the Supabase Table
--   Editor while the matching auth.users account stayed alive and logged in.
--   The account kept all of its data:
--       public.group_members   rows   (still present, never deleted)
--       public.expenses        rows
--       public.expense_shares  rows
--       public.settlements     rows
--   Nothing in this migration deletes or recreates groups, expenses, expense
--   shares, settlements or memberships -- it only re-inserts the missing
--   public.profiles row.
--
-- Why a missing profile row is so damaging here
--   public.list_group_members(target_group_id) reads members with an INNER
--   JOIN against public.profiles and is SECURITY DEFINER (used by the app for
--   the member directory, member counts, payer names, the split participant
--   list and balance labels). With the profile row gone, that function drops
--   the member from its result set, so:
--       * the affected user disappears from their OWN member list,
--       * a sole-member group reports 0 members -> "This group has no members
--         to split with yet" -> the user cannot add an expense at all,
--       * split participant ids exclude the user, so their own share is
--         never recorded and the ledger looks wrong,
--       * payer / balance labels render as "Unknown" or "Member",
--       * other members' member directory omits the user even though the raw
--         public.group_members row still exists.
--   Row-level security itself was NOT broken: is_group_member()/is_group_admin()
--   only read public.group_members, so the account could still SELECT its own
--   groups, expenses and settlements. The damage is the profiles-based join.
--
-- Contents
--   1. Backfill public.profiles for every auth.users account that has no
--      profile row, using the same name derivation as handle_new_user
--      (raw_user_meta_data.full_name, else the email local part).
--   2. Re-assert public.handle_new_user() (identical, correct definition) so
--      every future signup still creates a profile.
--   3. Recreate the on_auth_user_created trigger only if it is missing.
--
-- Safety
--   * Idempotent: re-running never duplicates a profile (ON CONFLICT DO NOTHING
--     + LEFT JOIN guard) and never touches financial or membership tables.
--   * No RLS change, no service-role key, no destructive statement.
--   * Step 1 runs first, so even if step 2/3 hit a privilege problem the data
--     repair still lands.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Restore the missing profile row(s) for existing Auth users.
--    Mirrors handle_new_user so the restored name matches what signup would
--    have written. full_name stays nullable in public.profiles, so a user with
--    neither metadata nor email still gets a row (just with a NULL name).
-- ---------------------------------------------------------------------------
insert into public.profiles (id, full_name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(u.email, '@', 1)
  )
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Re-assert the signup trigger function (already present in this project;
--    recreated here so the repair file is self-contained and any drift away
--    from the correct definition is reverted).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Make sure the trigger exists on auth.users. It only fires on INSERT into
--    auth.users (signup), so it can never repair a hand-deleted row -- that is
--    what step 1 does -- but it guarantees no future signup can end up with an
--    authenticated user that has no profile. Created only when absent, so this
--    is a no-op (and needs no extra privilege) when it is already there.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth'
       and c.relname = 'users'
       and t.tgname = 'on_auth_user_created'
       and not t.tgisinternal
  ) then
    raise notice 'on_auth_user_created already exists; leaving it in place';
  else
    create trigger on_auth_user_created
      after insert on auth.users
      for each row
      execute function public.handle_new_user();
    raise notice 'created missing trigger on_auth_user_created';
  end if;
end
$$;
