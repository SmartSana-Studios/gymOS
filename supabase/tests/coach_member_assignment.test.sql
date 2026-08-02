-- Story 5.1: Coach Member Assignment. Tests `assign_coach()`
-- (0039_coach_member_assignment.sql) -- a SECURITY DEFINER RPC, not a raw
-- RLS-policy-gated INSERT, so most write-path assertions call the function
-- directly under a simulated session rather than asserting on INSERT/UPDATE
-- statements themselves (matches manual_renewal_reset.test.sql's own
-- convention for `renew_subscription()`). Session-simulation conventions
-- match member_management_rls.test.sql: fixture rows seeded up front as the
-- connecting role, then `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)` per simulated session.
-- Table-state assertions after each call use `reset role` first
-- (coach_assignments has no SELECT policy for Receptionist/Coach, only
-- Manager/Owner's manager_or_owner_read_own_coach_assignments -- the
-- connecting/superuser role bypasses RLS entirely to inspect real committed
-- state).

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000013001', 'Coach Assignment Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000013011', 'Coach Assignment Gym A', '00000000-0000-0000-0000-000000013001', 30),
  ('00000000-0000-0000-0000-000000013012', 'Coach Assignment Gym B', '00000000-0000-0000-0000-000000013001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000013021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000013022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000013023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000013024'), -- Gym A coach 1
  ('00000000-0000-0000-0000-000000013025'), -- Gym A coach 2
  ('00000000-0000-0000-0000-000000013026'), -- Gym A member 1
  ('00000000-0000-0000-0000-000000013027'), -- Gym A member 2
  ('00000000-0000-0000-0000-000000013028'), -- Gym B owner
  ('00000000-0000-0000-0000-000000013031'); -- Gym B coach 1

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000013071', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013021', 'owner', 'Coach Assignment Gym A Owner'),
  ('00000000-0000-0000-0000-000000013072', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013022', 'manager', 'Coach Assignment Gym A Manager'),
  ('00000000-0000-0000-0000-000000013073', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013023', 'receptionist', 'Coach Assignment Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000013074', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013024', 'coach', 'Coach Assignment Gym A Coach 1'),
  ('00000000-0000-0000-0000-000000013075', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013025', 'coach', 'Coach Assignment Gym A Coach 2'),
  ('00000000-0000-0000-0000-000000013076', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013026', 'member', 'Coach Assignment Gym A Member 1'),
  ('00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013027', 'member', 'Coach Assignment Gym A Member 2'),
  ('00000000-0000-0000-0000-000000013078', '00000000-0000-0000-0000-000000013012', '00000000-0000-0000-0000-000000013028', 'owner', 'Coach Assignment Gym B Owner'),
  ('00000000-0000-0000-0000-000000013081', '00000000-0000-0000-0000-000000013012', '00000000-0000-0000-0000-000000013031', 'coach', 'Coach Assignment Gym B Coach 1');

-- ============================================================================
-- (a) Owner-claim session assigns Coach 1 to Member 1, who has no current
-- coach -- AC #1.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select assign_coach('00000000-0000-0000-0000-000000013076', '00000000-0000-0000-0000-000000013074')$$,
  'an owner-claim session can assign a coach to a member with no current coach'
);

reset role;

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  1,
  'Member 1 now has exactly 1 coach_assignments row'
);

select is(
  (select coach_id from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  '00000000-0000-0000-0000-000000013074',
  'the new row assigns Coach 1'
);

select is(
  (select ended_at from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  null,
  'the new assignment is active (ended_at is null)'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'coach_assigned'
     and target_entity_id = '00000000-0000-0000-0000-000000013076'
     and metadata->>'coach_id' = '00000000-0000-0000-0000-000000013074'
     and metadata->>'previous_coach_id' is null),
  1,
  'an audit_log row was written with action_type = coach_assigned and no previous_coach_id'
);

-- ============================================================================
-- (b) Manager-claim session reassigns Member 1 to Coach 2 -- AC #2: the prior
-- assignment is ended (ended_at set), not deleted; a new active row exists.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"manager"}',
  true
);

select lives_ok(
  $$select assign_coach('00000000-0000-0000-0000-000000013076', '00000000-0000-0000-0000-000000013075')$$,
  'a manager-claim session can reassign Member 1 to Coach 2'
);

reset role;

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  2,
  'Member 1 now has 2 coach_assignments rows -- the prior row was ended, not deleted'
);

select is(
  (select ended_at is not null from coach_assignments
   where member_id = '00000000-0000-0000-0000-000000013076' and coach_id = '00000000-0000-0000-0000-000000013074'),
  true,
  'the Coach 1 row now has a non-null ended_at'
);

select is(
  (select ended_at from coach_assignments
   where member_id = '00000000-0000-0000-0000-000000013076' and coach_id = '00000000-0000-0000-0000-000000013075'),
  null,
  'the new Coach 2 row is active (ended_at is null)'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'coach_reassigned'
     and target_entity_id = '00000000-0000-0000-0000-000000013076'
     and metadata->>'coach_id' = '00000000-0000-0000-0000-000000013075'
     and metadata->>'previous_coach_id' = '00000000-0000-0000-0000-000000013074'),
  1,
  'an audit_log row was written with action_type = coach_reassigned and previous_coach_id = Coach 1'
);

-- ============================================================================
-- (c) A receptionist-claim session cannot call assign_coach().
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select assign_coach('00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013074')$$,
  '%permission denied%',
  'a receptionist-claim session cannot call assign_coach()'
);

-- ============================================================================
-- (d) A coach-claim session cannot call assign_coach().
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"coach"}',
  true
);

select throws_like(
  $$select assign_coach('00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013075')$$,
  '%permission denied%',
  'a coach-claim session cannot call assign_coach()'
);

-- ============================================================================
-- (e) A member-claim session cannot call assign_coach().
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"member"}',
  true
);

select throws_like(
  $$select assign_coach('00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013075')$$,
  '%permission denied%',
  'a member-claim session cannot call assign_coach()'
);

-- ============================================================================
-- (f) Cross-tenant: a Gym A owner-claim session targeting a Gym B member id
-- gets the uniform not-found message, not a distinguishable "wrong gym"
-- error (tenant-isolation-enumeration-avoidance, same style as
-- renew_subscription's own test coverage).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"owner"}',
  true
);

select throws_like(
  $$select assign_coach((select id from members where name = 'Coach Assignment Gym B Owner'), '00000000-0000-0000-0000-000000013074')$$,
  '%assign_coach: member % not found%',
  'a Gym A owner-claim session targeting a Gym B member id gets the uniform not-found message'
);

-- ============================================================================
-- (g) Cross-tenant: a Gym A owner-claim session targeting a Gym B coach id
-- gets the same uniform not-found message.
-- ============================================================================
select throws_like(
  $$select assign_coach('00000000-0000-0000-0000-000000013077', (select id from members where name = 'Coach Assignment Gym B Coach 1'))$$,
  '%assign_coach: coach % not found%',
  'a Gym A owner-claim session targeting a Gym B coach id gets the uniform not-found message'
);

-- ============================================================================
-- (h) p_coach_id pointing at a members row whose role is 'member' (not
-- 'coach') is rejected the same way as a nonexistent coach id.
-- ============================================================================
select throws_like(
  $$select assign_coach('00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013076')$$,
  '%assign_coach: coach % not found%',
  'assign_coach rejects a p_coach_id whose role is ''member'', not ''coach'''
);

-- ============================================================================
-- (i) Partial unique index (idx_coach_assignments_active_member) is the real
-- backstop, not just assign_coach()'s own end-then-insert ordering: a raw
-- INSERT bypassing the function entirely (as service_role, for a member that
-- already has an active assignment) raises a unique violation.
-- ============================================================================
set local role service_role;
select throws_like(
  $$insert into coach_assignments (gym_id, member_id, coach_id)
    values ('00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013076', '00000000-0000-0000-0000-000000013074')$$,
  '%duplicate key value violates unique constraint "idx_coach_assignments_active_member"%',
  'a raw INSERT for a member that already has an active assignment violates idx_coach_assignments_active_member'
);
reset role;

-- ============================================================================
-- (j) manager_or_owner_read_own_coach_assignments: Owner/Manager can SELECT
-- Member 1's full assignment history (AC #3); Receptionist/Coach sessions
-- (no SELECT policy covers them yet -- Story 5.2's job) get zero rows; a Gym
-- B owner session sees zero rows for a Gym A member (tenant isolation).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  2,
  'an owner-claim session can SELECT Member 1''s full 2-row assignment history'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  2,
  'a manager-claim session can also SELECT Member 1''s full assignment history'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from coach_assignments),
  0,
  'a receptionist-claim session sees 0 coach_assignments rows -- no SELECT policy covers this role yet'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from coach_assignments),
  0,
  'a coach-claim session sees 0 coach_assignments rows -- this role''s own narrower self-read is Story 5.2''s job'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013028","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013012","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013076'),
  0,
  'a Gym B owner-claim session sees 0 rows for Gym A''s Member 1 -- tenant isolation'
);

-- ============================================================================
-- (k) Write-path deny-all shape: coach_assignments has the standard
-- full-CRUD grant to `authenticated` (mirroring job_runs, 0008) but zero RLS
-- write policies. A direct INSERT still raises a real "row-level security"
-- error -- WITH CHECK's implicit `false` when no policy applies, since
-- INSERT has no existing row of its own to silently filter against (unlike
-- UPDATE/DELETE, per rls_tenant_isolation.test.sql's own documented
-- distinction) -- but it is the RLS-flavored error every other table's
-- INSERT-denial test in this codebase expects
-- (throws_like('%row-level security%'), e.g. member_management_rls.test.sql),
-- not a bare grant-level "permission denied for table" error a SELECT-only
-- grant would have produced instead. A direct UPDATE, by contrast, is
-- silently filtered to 0 affected rows -- no error, same as every other
-- table's write-path deny-all shape.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000013021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000013011","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into coach_assignments (gym_id, member_id, coach_id)
    values ('00000000-0000-0000-0000-000000013011', '00000000-0000-0000-0000-000000013077', '00000000-0000-0000-0000-000000013074')$$,
  '%row-level security%',
  'a direct authenticated INSERT into coach_assignments raises the RLS-flavored error, not a grant-level "permission denied for table" error'
);

with attempted as (
  update coach_assignments set ended_at = now()
  where member_id = '00000000-0000-0000-0000-000000013076' and coach_id = '00000000-0000-0000-0000-000000013075'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a direct authenticated UPDATE on coach_assignments affects 0 rows -- silently denied, not an error (unlike INSERT)'
);

reset role;
select is(
  (select ended_at from coach_assignments
   where member_id = '00000000-0000-0000-0000-000000013076' and coach_id = '00000000-0000-0000-0000-000000013075'),
  null,
  'Member 1''s active Coach 2 assignment is unaffected -- the direct-UPDATE bypass attempt above did not actually change it'
);

select is(
  (select count(*)::int from coach_assignments where member_id = '00000000-0000-0000-0000-000000013077'),
  0,
  'Member 2 still has no coach_assignments row -- the direct-INSERT bypass attempt above did not actually write anything'
);

select * from finish();
rollback;
