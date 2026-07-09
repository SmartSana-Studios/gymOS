-- Story 1.6: tiers INSERT/UPDATE/DELETE RLS, gyms UPDATE RLS (status/tier/
-- cap-override), idx_tiers_name_unique, and the platform_metrics()/
-- gym_member_count() SECURITY DEFINER aggregate functions
-- (0011_super_admin_tier_gym_lifecycle.sql). Session-simulation conventions
-- match gyms_super_admin_rls.test.sql / rls_tenant_isolation.test.sql.

begin;
select plan(25);

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
-- Regression: an owner-claim session cannot update any gym, including
-- their own -- gym-settings self-service (FR-069) is a different table's
-- job, not this policy.
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
  (select count(*) from updated)::int, 0,
  'an owner-claim session cannot UPDATE their own gym -- 0 rows affected silently (RLS USING-clause semantics), not an exception'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000000401')::text, 'suspended',
  'the gym''s status is unchanged after the blocked owner-claim update attempt'
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
  (select total_gyms from platform_metrics())::int, 1,
  'platform_metrics() reports the correct total_gyms count'
);

select is(
  (select total_members from platform_metrics())::int, 1,
  'platform_metrics() reports the correct total_members count'
);

select is(
  (select total_payments_processed from platform_metrics())::int, 0,
  'platform_metrics() reports 0 total_payments_processed -- no verified payments seeded, matching this story''s Epic 4 note'
);

select is(
  (select suspended_gyms from platform_metrics())::int, 1,
  'platform_metrics() reports the correct suspended_gyms count'
);

select is(
  (select active_gyms from platform_metrics())::int, 0,
  'platform_metrics() reports the correct active_gyms count (the only gym is suspended)'
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
