-- Story 1.5: private.is_super_admin() and the new Super Admin RLS policies
-- (0010_super_admin_gym_provisioning.sql). Session-simulation conventions
-- (`set local role`, `set_config('request.jwt.claims', ...)`) match
-- auth_hook_canary.test.sql / rls_tenant_isolation.test.sql.

begin;
select plan(23);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000201', 'Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-0000000000d1', 'SA RLS Gym A', '00000000-0000-0000-0000-000000000201', 30),
  ('00000000-0000-0000-0000-0000000000d2', 'SA RLS Gym B', '00000000-0000-0000-0000-000000000201', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'), -- super_admin caller
  ('00000000-0000-0000-0000-0000000000e2'), -- owner of gym A (seeded as postgres)
  ('00000000-0000-0000-0000-0000000000e3'), -- a would-be owner for the insert tests
  ('00000000-0000-0000-0000-0000000000e4'); -- a would-be non-owner for the reject test

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 'owner', 'Gym A Owner');

-- ============================================================================
-- private.is_super_admin(): never raises, true only for app_role=super_admin.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated","app_role":"super_admin"}',
  true
);
select ok(private.is_super_admin(), 'is_super_admin() is true for app_role=super_admin');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000d1","app_role":"owner"}',
  true
);
select ok(not private.is_super_admin(), 'is_super_admin() is false for app_role=owner');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);
select lives_ok(
  $$ select private.is_super_admin() $$,
  'is_super_admin() does not raise when app_role is entirely absent'
);
select ok(not private.is_super_admin(), 'is_super_admin() is false when app_role is absent');

-- ============================================================================
-- Super Admin session: full gyms/tiers visibility, gyms INSERT, owner-only
-- members INSERT.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated","app_role":"super_admin"}',
  true
);

-- Scoped to this test's own fixtures. The claim is "a super_admin sees gyms
-- belonging to more than one tenant, rather than being scoped to a single
-- gym_id like every other role" -- which counting this test's own two gyms
-- proves exactly. An unqualified `count(*) = 2` additionally asserted that
-- the entire database contains only these two gyms, which holds on a
-- pristine container and fails on any database that already has gyms in it.
-- The tiers assertion just below already reasons this way ("4 migration-
-- seeded defaults + 1 seeded by this test").
select is(
  (select count(*) from gyms
    where id in (
      '00000000-0000-0000-0000-0000000000d1', -- SA RLS Gym A
      '00000000-0000-0000-0000-0000000000d2'  -- SA RLS Gym B (a different tenant)
    ))::int, 2,
  'super_admin sees every gym across every tenant, not scoped to one gym_id'
);

select is(
  (select count(*) from tiers)::int, 5,
  -- 4 default tiers seeded by migrations (Hustle/Grind/Elite from
  -- 0010_super_admin_gym_provisioning.sql, FR-073; Free/Test from
  -- 0071_saas_subscription_lifecycle.sql, FR-139) + the 1 this test file
  -- inserts above.
  'super_admin can SELECT tiers (4 migration-seeded defaults + 1 seeded by this test)'
);

select lives_ok(
  $$ insert into gyms (id, name, tier_id, capacity) values ('00000000-0000-0000-0000-0000000000d3', 'SA RLS Gym C', '00000000-0000-0000-0000-000000000201', 30) $$,
  'super_admin can INSERT a gym'
);

select is(
  (select count(*) from gyms
    where id in (
      '00000000-0000-0000-0000-0000000000d1', -- SA RLS Gym A
      '00000000-0000-0000-0000-0000000000d2', -- SA RLS Gym B
      '00000000-0000-0000-0000-0000000000d3'  -- SA RLS Gym C, inserted just above
    ))::int, 3,
  'the newly inserted gym is visible to the same super_admin session'
);

select lives_ok(
  $$ insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e3', 'owner', 'New Owner') $$,
  'super_admin can INSERT a members row with role=owner'
);

select throws_like(
  $$ insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e4', 'coach', 'Sneaky Coach') $$,
  '%row-level security%',
  'super_admin INSERT of a members row with role != owner is rejected by the WITH CHECK clause'
);

-- These two assertions previously read `count(*) from members` = 2 and
-- `array_agg(name)` = exactly this file's two fixture owners. That assumed an
-- otherwise EMPTY database: any pre-existing owner row -- a local dev seed, a
-- leftover fixture -- made them fail with "have: 5 / want: 2" even though
-- nothing was wrong with the policy. The two claims being made are (a) only
-- owner-role rows are visible and (b) the scope is platform-wide rather than
-- session-scoped; both are expressible without counting unrelated rows, so
-- they are now written that way. Do not "simplify" them back to a bare count.

select is(
  (select count(*) from members where role <> 'owner')::int, 0,
  'super_admin sees ONLY owner-role members rows -- never a coach/receptionist/member row, whatever else exists in the database'
);

select is(
  (select array_agg(name order by name) from members where name in ('Gym A Owner', 'New Owner')),
  array['Gym A Owner', 'New Owner'],
  -- The role=owner SELECT scope is not "rows this session inserted" -- it is
  -- every owner row across every gym: the pre-seeded Gym A owner (seeded as
  -- postgres, before any RLS applied) AND the one just inserted above. Seeing
  -- BOTH is what proves that.
  'both owner rows are visible -- the pre-seeded one and the one just inserted -- confirming the SELECT scope is role=owner platform-wide, not "first row" or "rows this session created"'
);

-- ============================================================================
-- idx_gyms_name_unique: case-insensitive collision.
-- ============================================================================
select throws_like(
  $$ insert into gyms (name, tier_id, capacity) values ('sa rls gym a', '00000000-0000-0000-0000-000000000201', 10) $$,
  '%idx_gyms_name_unique%',
  'a gym name differing only in case from an existing gym is rejected by the unique index'
);

-- ============================================================================
-- super_admin_delete_orphaned_gyms: DELETE only reaches gyms with no
-- members yet -- added in code review after the original migration shipped
-- with zero DELETE policy on gyms, silently no-opping createGym's
-- compensating cleanup on every partial-failure path.
-- ============================================================================
with deleted as (
  delete from gyms where id = '00000000-0000-0000-0000-0000000000d2' returning id
)
select is(
  (select count(*) from deleted)::int, 1,
  'super_admin CAN delete a gym that has no members yet (Gym B -- the compensating-cleanup case)'
);

select is(
  (select count(*) from gyms where id = '00000000-0000-0000-0000-0000000000d2')::int, 0,
  'the deleted gym (Gym B) is actually gone, not just filtered from this session''s view'
);

with deleted as (
  delete from gyms where id = '00000000-0000-0000-0000-0000000000d3' returning id
)
select is(
  (select count(*) from deleted)::int, 0,
  'super_admin CANNOT delete a gym that already has a members row (Gym C, has an owner) -- the DELETE policy is scoped to orphaned gyms only, not a general delete grant'
);

select is(
  (select count(*) from gyms where id = '00000000-0000-0000-0000-0000000000d3')::int, 1,
  'Gym C still exists -- the blocked delete affected 0 rows silently, matching Postgres RLS USING-clause semantics (no error, just filtered), not an exception'
);

-- ============================================================================
-- Regression: a member/owner-claim session is unaffected by the new
-- super_admin-scoped policies -- still sees only their own gym (canary) and
-- 0 rows on tiers/members beyond what Stories 1.3/1.4 already established.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000d1","app_role":"owner"}',
  true
);

select is(
  (select count(*) from gyms)::int, 1,
  'an owner-claim session still sees exactly their own gym (canary), unaffected by the new super_admin gyms policy'
);

select is(
  (select id from gyms limit 1), '00000000-0000-0000-0000-0000000000d1'::uuid,
  'the one gym visible is their own gym, not any of the others super_admin can see'
);

select is(
  (select count(*) from tiers)::int, 0,
  'an owner-claim session still sees 0 tiers -- the new tiers SELECT policy is scoped to super_admin only'
);

-- Story 1.8 (0013_dashboard_shell_self_read.sql) adds
-- self_read_own_membership, which ORs with this file's super_admin-scoped
-- policies for the same command: an owner-claim session now sees exactly
-- their own membership row (previously 0, when no self-read policy existed
-- at all) -- not the New Owner row seeded above under a different user_id,
-- confirming self-read stays scoped to the caller's own identity, not a
-- roster-read.
select is(
  (select count(*) from members)::int, 1,
  'an owner-claim session sees exactly 1 members row -- their own (self_read_own_membership, Story 1.8), not the platform-wide super_admin-scoped visibility'
);

select is(
  (select name from members limit 1), 'Gym A Owner',
  'the one visible row is their own row, not the New Owner row seeded under a different user_id'
);

select throws_like(
  $$ insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e4', 'owner', 'Impersonating Owner') $$,
  '%row-level security%',
  'a non-super_admin session cannot INSERT a members row even with role=owner -- the WITH CHECK requires is_super_admin() too, not just the role value'
);

select * from finish();
rollback;
