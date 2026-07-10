-- Story 1.9: Gym Branding & Operational Settings. New RLS policies from
-- 0014_gym_settings_owner_access.sql -- owner_update_own_gym on `gyms`, and
-- owner_select_own_gym_logo/owner_insert_own_gym_logo/owner_update_own_gym_logo/
-- owner_delete_own_gym_logo on `storage.objects`. Session-simulation
-- conventions match dashboard_shell_self_read_rls.test.sql: fixture rows
-- seeded up front as the connecting role, then `set local role authenticated`
-- + `set_config('request.jwt.claims', ...)` per simulated session.
--
-- This is the first pgTAP test in this project touching `storage.objects`.
-- The session-simulation convention extends cleanly. A SELECT policy on
-- `storage.objects` turned out to be required, not optional: `uploadGymLogo`'s
-- `upsert: true` makes Storage write via `INSERT ... ON CONFLICT DO UPDATE`,
-- and Postgres's RLS enforcement for that statement shape needs a SELECT
-- policy to resolve the conflict target's visibility -- confirmed hands-on
-- against the real Storage HTTP API (a plain INSERT succeeded with only
-- INSERT/UPDATE policies in place; the same write with `x-upsert: true` failed
-- RLS until `owner_select_own_gym_logo` was added). This pgTAP file still
-- verifies existence via `reset role` (bypassing RLS entirely) rather than the
-- inserting session's own SELECT visibility, matching
-- audit_log_immutable.test.sql's post-assertion `reset role` pattern --
-- simplest and most direct, even though the owner session could now also see
-- its own row directly.
--
-- Cross-tenant/cross-role UPDATE-denial checks use a CTE `returning`
-- clause on the UPDATE itself (rls_tenant_isolation.test.sql's pattern),
-- not a follow-up SELECT -- a follow-up SELECT under a claim that can't see
-- the target row at all (e.g. a different gym's owner) would return NULL
-- from "no visible row", not because the UPDATE differs from expected.

begin;
select plan(15);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000005001', 'Settings Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000005011', 'Settings Gym A', '00000000-0000-0000-0000-000000005001', 30),
  ('00000000-0000-0000-0000-000000005012', 'Settings Gym B', '00000000-0000-0000-0000-000000005001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000005021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000005022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000005023'), -- Gym B owner
  ('00000000-0000-0000-0000-000000005024'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000005025'); -- Gym A coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000005031', '00000000-0000-0000-0000-000000005011', '00000000-0000-0000-0000-000000005021', 'owner', 'Gym A Owner'),
  ('00000000-0000-0000-0000-000000005032', '00000000-0000-0000-0000-000000005011', '00000000-0000-0000-0000-000000005022', 'manager', 'Gym A Manager'),
  ('00000000-0000-0000-0000-000000005033', '00000000-0000-0000-0000-000000005012', '00000000-0000-0000-0000-000000005023', 'owner', 'Gym B Owner'),
  ('00000000-0000-0000-0000-000000005034', '00000000-0000-0000-0000-000000005011', '00000000-0000-0000-0000-000000005024', 'receptionist', 'Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000005035', '00000000-0000-0000-0000-000000005011', '00000000-0000-0000-0000-000000005025', 'coach', 'Gym A Coach');

insert into storage.buckets (id, name, public)
values ('gym-logos', 'gym-logos', true)
on conflict (id) do nothing;

-- ============================================================================
-- Owner can UPDATE their own gym's settings columns.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"owner"}',
  true
);

update gyms
set name = 'Settings Gym A Renamed', primary_color = '#123456', timezone = 'UTC',
    grace_period_days = 7, capacity = 42, alert_auto_dismiss_minutes = 45
where id = '00000000-0000-0000-0000-000000005011';

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000005011'),
  'Settings Gym A Renamed',
  'an owner-claim session can update its own gym''s settings columns'
);

select is(
  (select primary_color from gyms where id = '00000000-0000-0000-0000-000000005011'),
  '#123456',
  'the primary_color update is reflected'
);

-- ============================================================================
-- Manager/receptionist/coach sessions at the same gym cannot UPDATE it --
-- RLS UPDATE policies fail silently (0 rows affected, not an error).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"manager"}',
  true
);

with attempted as (
  update gyms set name = 'Manager Attempted Rename'
  where id = '00000000-0000-0000-0000-000000005011'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a manager-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000005011'),
  'Settings Gym A Renamed',
  'the gym row is unchanged after the denied manager UPDATE attempt'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"receptionist"}',
  true
);

with attempted as (
  update gyms set name = 'Receptionist Attempted Rename'
  where id = '00000000-0000-0000-0000-000000005011'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"coach"}',
  true
);

with attempted as (
  update gyms set name = 'Coach Attempted Rename'
  where id = '00000000-0000-0000-0000-000000005011'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a coach-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

-- ============================================================================
-- An owner session at a different gym cannot UPDATE gym A's row --
-- cross-tenant regression, matching every prior story's tenant-isolation test.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005012","app_role":"owner"}',
  true
);

with attempted as (
  update gyms set name = 'Cross-Tenant Rename Attempt'
  where id = '00000000-0000-0000-0000-000000005011'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session at a different gym cannot update gym A''s row (0 rows affected)'
);

reset role;
select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000005011'),
  'Settings Gym A Renamed',
  'gym A''s row is unchanged after the denied cross-tenant UPDATE attempt (verified as the connecting role, bypassing RLS visibility)'
);

-- ============================================================================
-- storage.objects: an owner session can insert into its own gym's folder,
-- but not into another gym's folder.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"owner"}',
  true
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('gym-logos', '00000000-0000-0000-0000-000000005011/logo.png', auth.uid())$$,
  'an owner session can insert into gym-logos/<own-gym-id>/logo.png'
);

select throws_like(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('gym-logos', '00000000-0000-0000-0000-000000005012/logo.png', auth.uid())$$,
  '%row-level security%',
  'the same owner session cannot insert into gym-logos/<other-gym-id>/logo.png'
);

reset role;
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000005011/logo.png'),
  1,
  'the owner''s own-gym logo insert exists (verified as the connecting role, bypassing RLS visibility)'
);

-- ============================================================================
-- storage.objects: an owner session can UPDATE/DELETE its own gym's logo
-- file, but not another gym's (owner_update_own_gym_logo,
-- owner_delete_own_gym_logo).
-- ============================================================================
insert into storage.objects (bucket_id, name, owner)
values
  ('gym-logos', '00000000-0000-0000-0000-000000005012/logo.png', null),
  ('gym-logos', '00000000-0000-0000-0000-000000005011/logo-delete-test.png', null);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000005011","app_role":"owner"}',
  true
);

select lives_ok(
  $$update storage.objects set metadata = '{"size": 1}'::jsonb
    where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000005011/logo.png'$$,
  'an owner session can UPDATE its own gym''s logo file'
);

with attempted as (
  update storage.objects set metadata = '{"size": 1}'::jsonb
  where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000005012/logo.png'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'the same owner session cannot UPDATE another gym''s logo file (0 rows affected)'
);

-- Supabase's storage.protect_objects_delete trigger blocks raw DELETEs on
-- storage.objects by default (statement-level guard against accidental
-- orphaned-object data loss) -- this session-local setting is the documented
-- opt-out for exercising the real RLS DELETE policy directly via pgTAP,
-- matching how the Storage API itself is expected to set it internally.
select set_config('storage.allow_delete_query', 'true', true);

with deleted as (
  delete from storage.objects
  where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000005011/logo-delete-test.png'
  returning id
)
select is(
  (select count(*)::int from deleted),
  1,
  'an owner session can DELETE its own gym''s logo file'
);

with attempted_delete as (
  delete from storage.objects
  where bucket_id = 'gym-logos' and name = '00000000-0000-0000-0000-000000005012/logo.png'
  returning id
)
select is(
  (select count(*)::int from attempted_delete),
  0,
  'the same owner session cannot DELETE another gym''s logo file (0 rows affected)'
);

select * from finish();
rollback;
