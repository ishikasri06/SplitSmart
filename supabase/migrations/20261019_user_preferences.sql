-- Settings / user preferences (additive, self-contained).
-- ============================================================================
-- Review and apply this migration manually in the Supabase SQL editor. The
-- frontend never runs SQL and never uses a service-role key.
--
-- Design notes:
--   * Preferences live in a dedicated table keyed by the signed-in user rather
--     than in public.profiles, keeping identity data and app settings separate.
--   * Currency is intentionally limited to INR. SplitSmart stores and computes
--     every amount in rupees (paise-safe arithmetic), and the schema has no
--     per-expense currency conversion, so multi-currency is a much larger change.
--     Storing the preference now keeps the data model ready without pretending
--     that other currencies are supported.
--
-- Security properties:
--   * RLS is enabled. A user can only SELECT / INSERT / UPDATE their own row.
--   * anon is revoked entirely; authenticated only gets select/insert/update.
--   * No existing table, policy, or function is modified or dropped.
-- ============================================================================

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  currency character(3) not null default 'INR',
  default_split_method text not null default 'equal'
    check (default_split_method in ('equal', 'exact', 'percentage')),
  notify_recurring_bills boolean not null default true,
  notify_invitations boolean not null default true,
  notify_activity boolean not null default true,
  reminder_lead_days integer not null default 3
    check (reminder_lead_days in (1, 3, 7)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_currency_supported check (currency in ('INR'))
);

alter table public.user_preferences enable row level security;

drop policy if exists "Users can read own preferences" on public.user_preferences;
create policy "Users can read own preferences"
  on public.user_preferences
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own preferences" on public.user_preferences;
create policy "Users can insert own preferences"
  on public.user_preferences
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own preferences" on public.user_preferences;
create policy "Users can update own preferences"
  on public.user_preferences
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_preferences from anon;
revoke all on table public.user_preferences from authenticated;
grant select, insert, update on table public.user_preferences to authenticated;

-- Keep updated_at accurate on every change.
create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_user_preferences_updated_at() from public;
revoke all on function public.touch_user_preferences_updated_at() from anon;
revoke all on function public.touch_user_preferences_updated_at() from authenticated;

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_user_preferences_updated_at();
