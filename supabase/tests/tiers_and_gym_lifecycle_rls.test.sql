-- Story 1.6: tiers INSERT/UPDATE/DELETE RLS, gyms UPDATE RLS (status/tier/
-- cap-override), idx_tiers_name_unique, and the platform_metrics()/
-- gym_member_count() SECURITY DEFINER aggregate functions
-- (0011_super_admin_tier_gym_lifecycle.sql). Session-simulation conventions
-- match gyms_super_admin_rls.test.sql / rls_tenant_isolation.test.sql.

begin;
select plan(29);

-- ============================================================================
-- platform_metrics() baseline, captured BEFORE this file seeds anything.
--
-- Unlike every other assertion here, platform_metrics() reports database-wide
-- aggregates and takes no arguments, so there is no WHERE clause that can
-- scope it to this test's own fixtures. Asserting absolute values
-- (total_gyms = 1) therefore asserted that the entire database contained
-- exactly one gym -- true only against a freshly-migrated container, and a
-- false failure against any database that already holds data. The assertions
-- below instead check this test's own *delta* against this baseline, which is
-- the actual claim being made ("seeding one suspended gym with one member
-- moves these counters by exactly this much") and holds on any database state.
--
-- Stored in transaction-local GUCs rather than a temp table because the
-- snapshot has to be taken inside a super_admin session -- platform_metrics()
-- raises 'permission denied' otherwise -- and the `authenticated` role cannot
-- be assumed to hold TEMP privilege on the database.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated","app_role":"super_admin"}',
  true
);

select
  set_config('gymos_test.pm_total_gyms', total_gyms::text, true),
  set_config('gymos_test.pm_total_members', total_members::text, true),
  set_config('gymos_test.pm_total_payments', total_payments_processed::text, true),
  set_config('gymos_test.pm_active_gyms', active_gyms::text, true),
  set_config('gymos_test.pm_suspended_gyms', suspended_gyms::text, true)
from platform_metrics();

reset role;

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000301', 'Lifecycle Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000000401', 'Lifecycle Gym A', '00000000-0000-0000-0000-000000000301', 'active', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000501'), -- super_admin caller
  ('00000000-0000-0000-0000-000000000502'); -- owner of Gym A

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000502', 'owner', 'Gym A Owner');

-- ============================================================================
-- tiers: super_admin can INSERT/UPDATE/DELETE.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$ insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000000302', 'New Tier', 1000, 10000, 10) $$,
  'super_admin can INSERT a tier'
);

select lives_ok(
  $$ update tiers set monthly_price = 2000 where id = '00000000-0000-0000-0000-000000000302' $$,
  'super_admin can UPDATE a tier'
);

select is(
  (select monthly_price from tiers where id = '00000000-0000-0000-0000-000000000302')::int, 2000,
  'the tier update actually took effect'
);

with deleted as (
  delete from tiers where id = '00000000-0000-0000-0000-000000000302' returning id
)
select is(
  (select count(*) from deleted)::int, 1,
  'super_admin can DELETE a tier not in use by any gym'
);

-- ----------------------------------------------------------------------------
-- idx_tiers_name_unique: case-insensitive collision.
-- ----------------------------------------------------------------------------
select throws_like(
  $$ insert into tiers (name, monthly_price, annual_price, member_cap) values ('lifecycle test tier', 1000, 10000, 10) $$,
  '%idx_tiers_name_unique%',
  'a tier name differing only in case from an existing tier is rejected by the unique index'
);

-- ----------------------------------------------------------------------------
-- FK backstop: a tier with a gym still referencing it cannot be deleted even
-- by super_admin -- AC #2's friendly count-naming copy is an app-layer
-- concern (deleteTier's pre-check), not something pgTAP needs to assert;
-- this only proves the raw DB-level backstop still blocks it.
-- ----------------------------------------------------------------------------
select throws_like(
  $$ delete from tiers where id = '00000000-0000-0000-0000-000000000301' $$,
  '%violates foreign key constraint%',
  'super_admin CANNOT delete a tier that a gym still references -- the FK constraint is the backstop'
);

-- ============================================================================
-- gyms UPDATE: super_admin can change status/tier_id/member_cap_override.
-- ============================================================================
select lives_ok(
  $$ update gyms set status = 'suspended' where id = '00000000-0000-0000-0000-000000000401' $$,
  'super_admin can UPDATE a gym''s status'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000000401')::text, 'suspended',
  'the status update actually took effect'
);

select lives_ok(
  $$ update gyms set member_cap_override = 50 where id = '00000000-0000-0000-0000-000000000401' $$,
  'super_admin can UPDATE a gym''s member_cap_override'
);

select is(
  (select member_cap_override from gyms where id = '00000000-0000-0000-0000-000000000401')::int, 50,
  'the cap override update actually took effect'
);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000303', 'Reassignment Target Tier', 3000, 30000, 40);

select lives_ok(
  $$ update gyms set tier_id = '00000000-0000-0000-0000-000000000303' where id = '00000000-0000-0000-0000-000000000401' $$,
  'super_admin can UPDATE a gym''s tier_id'
);

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000000401')::text, '00000000-0000-0000-0000-000000000303',
  'the tier_id update actually took effect'
);

-- ============================================================================
-- Regression, updated by Story 1.9: `owner_update_own_gym`
-- (0014_gym_settings_owner_access.sql) now lets an owner-claim session
-- UPDATE its own gym row at all (gym-settings self-service, FR-069) -- so
-- the row itself is matched/returned here, unlike before Story 1.9 when no
-- owner UPDATE policy on `gyms` existed and this returned 0 rows. What's
-- still protected is the `status` column specifically: Story 1.9's
-- `protect_super_admin_only_gym_columns` trigger silently pins
-- status/tier_id/member_cap_override back to their prior values for any
-- non-super_admin session, closing the column-level gap a purely row-level
-- RLS policy can't -- asserted directly below.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000401","app_role":"owner"}',
  true
);

with updated as (
  update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000000401' returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'an owner-claim session CAN update its own gym row (Story 1.9''s owner_update_own_gym) -- the row is matched, even though the status value itself does not change'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000000401')::text, 'suspended',
  'the gym''s status column is unchanged -- protect_super_admin_only_gym_columns silently pins it back for a non-super_admin session'
);

-- The trigger protects three Super Admin-only columns, but only `status` was
-- asserted above -- close the gap for `tier_id`/`member_cap_override` too.
with updated as (
  update gyms
  set tier_id = '00000000-0000-0000-0000-000000000301', member_cap_override = 999
  where id = '00000000-0000-0000-0000-000000000401'
  returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'an owner-claim session''s UPDATE attempting to change tier_id/member_cap_override is still matched (row-level policy allows the write)'
);

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000000401')::text, '00000000-0000-0000-0000-000000000303',
  'the gym''s tier_id is unchanged -- protect_super_admin_only_gym_columns pins it back for a non-super_admin session'
);

select is(
  (select member_cap_override from gyms where id = '00000000-0000-0000-0000-000000000401')::int, 50,
  'the gym''s member_cap_override is unchanged -- protect_super_admin_only_gym_columns pins it back for a non-super_admin session'
);

update gyms set created_at = now() + interval '1 year'
where id = '00000000-0000-0000-0000-000000000401';

-- `now()` is frozen for the whole test transaction, so comparing directly
-- against `now()` would spuriously pass/fail depending on fixture-insert
-- timing -- compare against a bound well short of the "+1 year" value the
-- update attempted instead, which correctly distinguishes "pinned back" from
-- "shifted a year forward" regardless of when this transaction started.
select ok(
  (select created_at from gyms where id = '00000000-0000-0000-0000-000000000401') < now() + interval '6 months',
  'the gym''s created_at is unchanged -- protect_super_admin_only_gym_columns pins it back unconditionally (still in the past, not shifted a year into the future)'
);

select throws_like(
  $$ insert into tiers (name, monthly_price, annual_price, member_cap) values ('Owner Tier', 1000, 10000, 10) $$,
  '%row-level security%',
  'an owner-claim session cannot INSERT a tier'
);

-- UPDATE's USING clause (not WITH CHECK) governs which rows are even
-- visible to update -- with no applicable policy, 0 rows match and the
-- statement completes silently (no exception), the same RLS semantics as
-- the gyms UPDATE-denial case above.
with updated as (
  update tiers set monthly_price = 1 where id = '00000000-0000-0000-0000-000000000301' returning id
)
select is(
  (select count(*) from updated)::int, 0,
  'an owner-claim session cannot UPDATE a tier -- 0 rows affected silently, not an exception'
);

with deleted as (
  delete from tiers where id = '00000000-0000-0000-0000-000000000301' returning id
)
select is(
  (select count(*) from deleted)::int, 0,
  'an owner-claim session cannot DELETE a tier -- 0 rows affected silently, not an exception'
);

-- ============================================================================
-- platform_metrics(): super_admin gets correct aggregates; non-super_admin
-- caller is rejected, not silently given null/wrong data.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000501","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (select total_gyms from platform_metrics())::int,
  current_setting('gymos_test.pm_total_gyms')::int + 1,
  'platform_metrics() reports the correct total_gyms count (baseline + this test''s one gym)'
);

select is(
  (select total_members from platform_metrics())::int,
  current_setting('gymos_test.pm_total_members')::int + 1,
  'platform_metrics() reports the correct total_members count (baseline + this test''s one member)'
);

select is(
  (select total_payments_processed from platform_metrics())::int,
  current_setting('gymos_test.pm_total_payments')::int,
  'platform_metrics() total_payments_processed is unmoved -- no verified payments seeded, matching this story''s Epic 4 note'
);

select is(
  (select suspended_gyms from platform_metrics())::int,
  current_setting('gymos_test.pm_suspended_gyms')::int + 1,
  'platform_metrics() reports the correct suspended_gyms count (baseline + this test''s now-suspended gym)'
);

select is(
  (select active_gyms from platform_metrics())::int,
  current_setting('gymos_test.pm_active_gyms')::int,
  'platform_metrics() reports the correct active_gyms count -- unmoved from baseline, since this test''s only gym is suspended'
);

select is(
  (select gym_member_count('00000000-0000-0000-0000-000000000401'::uuid))::int, 1,
  'gym_member_count() reports the correct member count for a specific gym, reachable despite the members SELECT policy being role=owner-scoped only'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000502","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000401","app_role":"owner"}',
  true
);

select throws_like(
  $$ select * from platform_metrics() $$,
  '%permission denied%',
  'a non-super_admin caller is rejected by platform_metrics(), not given null or wrong data'
);

select throws_like(
  $$ select gym_member_count('00000000-0000-0000-0000-000000000401'::uuid) $$,
  '%permission denied%',
  'a non-super_admin caller is rejected by gym_member_count() too'
);

select * from finish();
rollback;
