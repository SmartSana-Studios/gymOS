-- Story 13.4: Plan Handoff on Coach Reassignment (FR-111, FR-055) negative
-- coverage. Tests `take_ownership_of_workout_plan()`/
-- `get_workout_plan_viewer_context()`'s boundaries and confirms the new
-- Owner/Manager read grant's deliberately-narrow role list (Supervisor and
-- Receptionist excluded). Mirrors coach_authored_workout_plans.negative.test.sql's
-- fixture/session-simulation conventions.

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000019101', 'Plan Handoff Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000019111', 'Plan Handoff Negative Test Gym A', '00000000-0000-0000-0000-000000019101'),
  ('00000000-0000-0000-0000-000000019112', 'Plan Handoff Negative Test Gym B', '00000000-0000-0000-0000-000000019101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000019121'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000019122'), -- Gym A: manager
  ('00000000-0000-0000-0000-000000019123'), -- Gym A: supervisor
  ('00000000-0000-0000-0000-000000019124'), -- Gym A: receptionist
  ('00000000-0000-0000-0000-000000019125'), -- Gym A: coach 1 (assigned, authoring)
  ('00000000-0000-0000-0000-000000019126'), -- Gym A: coach 3 (never assigned to Member 1)
  ('00000000-0000-0000-0000-000000019127'), -- Gym A: member 1
  ('00000000-0000-0000-0000-000000019131'); -- Gym B: coach

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000019141', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019121', 'owner', 'Negative Test Owner', current_date),
  ('00000000-0000-0000-0000-000000019142', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019122', 'manager', 'Negative Test Manager', current_date),
  ('00000000-0000-0000-0000-000000019143', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019123', 'supervisor', 'Negative Test Supervisor', current_date),
  ('00000000-0000-0000-0000-000000019144', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019124', 'receptionist', 'Negative Test Receptionist', current_date),
  ('00000000-0000-0000-0000-000000019145', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019125', 'coach', 'Negative Test Coach 1', current_date),
  ('00000000-0000-0000-0000-000000019146', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019126', 'coach', 'Negative Test Coach 3', current_date),
  ('00000000-0000-0000-0000-000000019147', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019127', 'member', 'Negative Test Member 1', current_date),
  ('00000000-0000-0000-0000-000000019151', '00000000-0000-0000-0000-000000019112', '00000000-0000-0000-0000-000000019131', 'coach', 'Negative Test Gym B Coach', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000019161', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019147', '00000000-0000-0000-0000-000000019145', now() - interval '30 days', null);

-- Coach 1 authors Member 1's plan directly (as postgres, bypassing RLS) --
-- matches coach_authored_workout_plans.negative.test.sql's own fixture
-- convention.
insert into workout_plans (id, gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0000-000000019181', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019147', '00000000-0000-0000-0000-000000019145', 'Member 1''s Existing Plan');
insert into workout_plan_exercises (id, gym_id, member_id, plan_id, exercise_id, order_index, sets, reps) values
  ('00000000-0000-0000-0000-000000019191', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019147', '00000000-0000-0000-0000-000000019181', (select id from exercise_library where gym_id is null and name = 'Squat'), 0, 3, 10);
insert into workout_plan_completions (id, gym_id, member_id, plan_id, exercise_id) values
  ('00000000-0000-0000-0000-000000019201', '00000000-0000-0000-0000-000000019111', '00000000-0000-0000-0000-000000019147', '00000000-0000-0000-0000-000000019181', (select id from exercise_library where gym_id is null and name = 'Squat'));

-- ============================================================================
-- (a) take_ownership_of_workout_plan() is rejected for a coach who is NOT
-- the member's current assignment (Coach 3, never assigned to Member 1) --
-- raises, no row updated.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"coach"}',
  true
);

select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%member is not currently assigned to caller%',
  'take_ownership_of_workout_plan() is rejected for a coach not currently assigned to the plan''s member'
);

reset role;

select is(
  (select coach_id from workout_plans where id = '00000000-0000-0000-0000-000000019181'),
  '00000000-0000-0000-0000-000000019145'::uuid,
  'the rejected take_ownership_of_workout_plan() call left workout_plans.coach_id unchanged'
);

-- ============================================================================
-- (b) take_ownership_of_workout_plan() is rejected for every non-coach
-- staff role.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"owner"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%caller is not a coach in this gym%',
  'an owner-claim session cannot call take_ownership_of_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"manager"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%caller is not a coach in this gym%',
  'a manager-claim session cannot call take_ownership_of_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"supervisor"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%caller is not a coach in this gym%',
  'a supervisor-claim session cannot call take_ownership_of_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"receptionist"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%caller is not a coach in this gym%',
  'a receptionist-claim session cannot call take_ownership_of_workout_plan()'
);
reset role;

-- ============================================================================
-- (c) take_ownership_of_workout_plan() is rejected cross-gym -- a Gym B
-- coach targeting Gym A's plan id, the function's own tenant-scoped lookup
-- ("where id = p_plan_id and gym_id = v_gym_id") reports not-found before
-- reaching the assignment check.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019131","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019112","app_role":"coach"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000019181')$$,
  '%not found%',
  'take_ownership_of_workout_plan() is rejected cross-gym'
);

-- ============================================================================
-- (d) get_workout_plan_viewer_context() is rejected cross-gym -- still the
-- active Gym B session above. Its own tenant-scoped plan lookup
-- ("where id = p_plan_id and gym_id = v_gym_id") reports not-found before
-- ever reaching the permission-denied assignment check below it, the same
-- ordering take_ownership_of_workout_plan() (c) already exhibits.
-- ============================================================================
select throws_like(
  $$select * from get_workout_plan_viewer_context('00000000-0000-0000-0000-000000019181')$$,
  '%not found%',
  'get_workout_plan_viewer_context() is rejected cross-gym'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"coach"}',
  true
);
select throws_like(
  $$select * from get_workout_plan_viewer_context('00000000-0000-0000-0000-000000019181')$$,
  '%permission denied%',
  'get_workout_plan_viewer_context() is rejected for a same-gym coach not currently assigned to the plan''s member'
);
reset role;

-- ============================================================================
-- (e) get_workout_plan_viewer_context() is rejected for Owner and Manager
-- (they never call it -- Task 2.1's own short-circuit; this is the
-- defensive backstop the function itself must still enforce).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"owner"}',
  true
);
select throws_like(
  $$select * from get_workout_plan_viewer_context('00000000-0000-0000-0000-000000019181')$$,
  '%permission denied%',
  'get_workout_plan_viewer_context() is rejected for an owner-claim session'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"manager"}',
  true
);
select throws_like(
  $$select * from get_workout_plan_viewer_context('00000000-0000-0000-0000-000000019181')$$,
  '%permission denied%',
  'get_workout_plan_viewer_context() is rejected for a manager-claim session'
);
reset role;

-- ============================================================================
-- (f) A Receptionist cannot SELECT workout_plans/workout_plan_exercises/
-- workout_plan_completions for a member they don't otherwise have
-- coach/owner/manager access to -- confirms the new grant's deliberately-
-- narrow ['owner','manager'] role list.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Receptionist cannot SELECT the plan'
);
select is(
  (select count(*)::int from workout_plan_exercises where plan_id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Receptionist cannot SELECT the plan''s exercises'
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Receptionist cannot SELECT the plan''s completion row'
);
reset role;

-- ============================================================================
-- (g) Same as (f), for Supervisor -- matching manager_or_owner_read_own_session_notes'
-- own precedent, not widened to Supervisor unlike Story 12.3's grant.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019111","app_role":"supervisor"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Supervisor cannot SELECT the plan'
);
select is(
  (select count(*)::int from workout_plan_exercises where plan_id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Supervisor cannot SELECT the plan''s exercises'
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = '00000000-0000-0000-0000-000000019181'),
  0,
  'a Supervisor cannot SELECT the plan''s completion row'
);
reset role;

select * from finish();
rollback;
