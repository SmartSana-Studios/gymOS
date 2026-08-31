-- Story 13.2: Coach-Authored Workout Plans (FR-109, FR-110, FR-111
-- scaffolding, FR-122) negative coverage. Tests `create_workout_plan()`/
-- `update_workout_plan()`'s boundaries: assignment, role, tenant isolation,
-- the empty-exercises guard, the one-plan-per-member backstop, and the
-- FR-111 ownership-gate scaffolding this story builds ahead of Story 13.4.
-- Mirrors coach_portal_member_detail_session_notes.test.sql's fixture/
-- session-simulation conventions.

begin;
select plan(15);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000017101', 'Workout Plans Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000017111', 'Workout Plans Negative Test Gym A', '00000000-0000-0000-0000-000000017101'),
  ('00000000-0000-0000-0000-000000017112', 'Workout Plans Negative Test Gym B', '00000000-0000-0000-0000-000000017101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000017121'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000017122'), -- Gym A: manager
  ('00000000-0000-0000-0000-000000017123'), -- Gym A: supervisor
  ('00000000-0000-0000-0000-000000017124'), -- Gym A: receptionist
  ('00000000-0000-0000-0000-000000017125'), -- Gym A: coach 1 (assigned to Member 1)
  ('00000000-0000-0000-0000-000000017126'), -- Gym A: coach 2 (unassigned, later reassigned Member 1)
  ('00000000-0000-0000-0000-000000017127'), -- Gym A: member 1
  ('00000000-0000-0000-0000-000000017128'), -- Gym A: member 2 (unassigned to any coach, target for role-check tests)
  ('00000000-0000-0000-0000-000000017129'), -- Gym A: member 3 (assigned to coach 1, target for empty-exercises/cross-gym tests)
  ('00000000-0000-0000-0000-000000017131'); -- Gym B: coach

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000017141', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017121', 'owner', 'Negative Test Owner', current_date),
  ('00000000-0000-0000-0000-000000017142', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017122', 'manager', 'Negative Test Manager', current_date),
  ('00000000-0000-0000-0000-000000017143', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017123', 'supervisor', 'Negative Test Supervisor', current_date),
  ('00000000-0000-0000-0000-000000017144', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017124', 'receptionist', 'Negative Test Receptionist', current_date),
  ('00000000-0000-0000-0000-000000017145', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017125', 'coach', 'Negative Test Coach 1', current_date),
  ('00000000-0000-0000-0000-000000017146', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017126', 'coach', 'Negative Test Coach 2', current_date),
  ('00000000-0000-0000-0000-000000017147', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017127', 'member', 'Negative Test Member 1', current_date),
  ('00000000-0000-0000-0000-000000017148', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017128', 'member', 'Negative Test Member 2', current_date),
  ('00000000-0000-0000-0000-000000017149', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017129', 'member', 'Negative Test Member 3', current_date),
  ('00000000-0000-0000-0000-000000017151', '00000000-0000-0000-0000-000000017112', '00000000-0000-0000-0000-000000017131', 'coach', 'Negative Test Gym B Coach', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000017161', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017147', '00000000-0000-0000-0000-000000017145', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000017162', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017149', '00000000-0000-0000-0000-000000017145', now() - interval '30 days', null);

-- Gym A's own custom exercise, and Gym B's own custom exercise -- seeded
-- directly as postgres, matching shared_exercise_library.test.sql's own
-- fixture-seeding convention.
insert into exercise_library (id, gym_id, name) values
  ('00000000-0000-0000-0000-000000017171', '00000000-0000-0000-0000-000000017111', 'Negative Test Gym A Custom Exercise'),
  ('00000000-0000-0000-0000-000000017172', '00000000-0000-0000-0000-000000017112', 'Negative Test Gym B Custom Exercise');

-- Coach 1 authors Member 1's plan up front (as postgres, bypassing RLS) --
-- needed as the target for the "not assigned" SELECT-empty assertion below
-- and the one-plan-per-member unique-index assertion.
insert into workout_plans (id, gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0000-000000017181', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017147', '00000000-0000-0000-0000-000000017145', 'Member 1''s Existing Plan');
insert into workout_plan_exercises (id, gym_id, member_id, plan_id, exercise_id, order_index, sets, reps) values
  ('00000000-0000-0000-0000-000000017191', '00000000-0000-0000-0000-000000017111', '00000000-0000-0000-0000-000000017147', '00000000-0000-0000-0000-000000017181', '00000000-0000-0000-0000-000000017171', 0, 3, 10);

-- ============================================================================
-- (a) A coach NOT currently assigned to the member cannot call
-- create_workout_plan() -- Coach 2 (no assignment to Member 1 at all).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"coach"}',
  true
);

select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017147', 'Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%is not currently assigned%',
  'a coach not currently assigned to the member cannot call create_workout_plan()'
);

-- (b) ...and cannot SELECT the existing plan for that member either --
-- RLS-empty, not an error.
select is(
  (select count(*)::int from workout_plans where member_id = '00000000-0000-0000-0000-000000017147'),
  0,
  'a coach not currently assigned to the member sees zero rows for that member''s existing plan (RLS-empty)'
);

reset role;

-- ============================================================================
-- (c) Every non-Coach staff role is rejected by create_workout_plan() with
-- "caller is not a coach in this gym" -- the role-resolution check runs
-- before the assignment check, so Member 2 (unassigned to anyone) is a fine
-- target here.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"owner"}',
  true
);
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017148', 'Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not a coach in this gym%',
  'an owner-claim session cannot call create_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"manager"}',
  true
);
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017148', 'Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not a coach in this gym%',
  'a manager-claim session cannot call create_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"supervisor"}',
  true
);
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017148', 'Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not a coach in this gym%',
  'a supervisor-claim session cannot call create_workout_plan()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"receptionist"}',
  true
);
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017148', 'Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not a coach in this gym%',
  'a receptionist-claim session cannot call create_workout_plan()'
);

-- update_workout_plan() rejects a non-coach role too ("either RPC") -- one
-- representative role (receptionist, still the active session) suffices,
-- create_workout_plan()'s block above already exhausts all 4 roles.
select throws_like(
  $$select update_workout_plan('00000000-0000-0000-0000-000000017181', 'Forged Update', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not a coach in this gym%',
  'a receptionist-claim session cannot call update_workout_plan() either'
);
reset role;

-- ============================================================================
-- (d) create_workout_plan() with an empty p_exercises array is rejected --
-- Coach 1, for their assigned Member 3.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"coach"}',
  true
);

select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017149', 'Empty Plan', '[]'::jsonb)$$,
  '%at least one exercise is required%',
  'create_workout_plan() with an empty p_exercises array is rejected'
);

-- ============================================================================
-- (e) create_workout_plan() referencing another gym's custom exercise_id is
-- rejected -- the core tenant-isolation assertion the row-count check
-- exists for.
-- ============================================================================
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017149', 'Cross-Gym Exercise Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017172', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%one or more exercises are invalid for this gym%',
  'create_workout_plan() referencing another gym''s custom exercise_id is rejected'
);

-- ============================================================================
-- (f) A second create_workout_plan() call for a member who already has one
-- fails on idx_workout_plans_member_unique -- Coach 1, for Member 1 (already
-- has a plan, seeded above).
-- ============================================================================
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017147', 'Duplicate Plan Attempt', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%idx_workout_plans_member_unique%',
  'a second create_workout_plan() call for a member who already has a plan fails on idx_workout_plans_member_unique'
);

reset role;

-- ============================================================================
-- (g) The FR-111 scaffolding case: after Member 1 is reassigned from Coach 1
-- to Coach 2, Coach 2 (now is_assigned_coach() = true, but not
-- workout_plans.coach_id) is rejected by update_workout_plan()'s ownership
-- check -- proving the two-check design (Subtask 1.6) actually holds before
-- Story 13.4 exists to build the take-ownership UI around it.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"owner"}',
  true
);
select assign_coach('00000000-0000-0000-0000-000000017147', '00000000-0000-0000-0000-000000017146');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"coach"}',
  true
);

select throws_like(
  $$select update_workout_plan('00000000-0000-0000-0000-000000017181', 'Coach 2 Trying To Edit', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%caller is not the authoring coach for this plan%',
  'Coach 2 (newly assigned, not the authoring coach) is rejected by update_workout_plan()''s ownership check'
);

reset role;

-- ============================================================================
-- (h) The inverse of (g): Coach 1 -- still workout_plans.coach_id (the
-- authoring coach), unchanged since block (g) -- is no longer the *assigned*
-- coach for Member 1 (reassigned to Coach 2 above). update_workout_plan()'s
-- check 1 (coach_id match) passes, but check 2 (is_assigned_coach) must
-- independently reject -- proving the two-check design's other half, not
-- just its (g) counterpart.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017111","app_role":"coach"}',
  true
);

select throws_like(
  $$select update_workout_plan('00000000-0000-0000-0000-000000017181', 'Coach 1 Trying To Edit After Reassignment', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017171', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%member is not currently assigned to caller%',
  'Coach 1 (still the authoring coach, but reassigned away) is rejected by update_workout_plan()''s assignment check'
);

reset role;

-- ============================================================================
-- (i)-(k) Cross-gym isolation: Gym B's own coach, entirely uninvolved in Gym
-- A's data, is denied on all three surfaces -- the SELECT policy, the
-- create RPC's assignment check, and the update RPC's tenant-scoped plan
-- lookup. The Gym B coach/exercise fixtures were seeded up top but never
-- previously exercised by any assertion.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017131","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017112","app_role":"coach"}',
  true
);

-- (i) coach_read_assigned_workout_plan's gym_id scoping blocks a
-- different-gym coach from seeing Gym A's existing plan at all (RLS-empty,
-- not an error) -- distinct from (b)'s same-gym-but-unassigned case above.
select is(
  (select count(*)::int from workout_plans where id = '00000000-0000-0000-0000-000000017181'),
  0,
  'a coach from a different gym sees zero rows for another gym''s existing plan (RLS-empty)'
);

-- (j) create_workout_plan() for a Gym A member, called by a Gym B coach --
-- no coach_assignments row can link them across gyms, so this fails the
-- same assignment check (a) does, proving it also holds cross-gym.
select throws_like(
  $$select create_workout_plan('00000000-0000-0000-0000-000000017148', 'Cross-Gym Forged Plan', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017172', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%is not currently assigned%',
  'a coach from a different gym cannot call create_workout_plan() for another gym''s member'
);

-- (k) update_workout_plan()'s own tenant-scoped lookup (`where id = p_plan_id
-- and gym_id = v_gym_id`) rejects Gym A's plan id outright as "not found"
-- for a Gym B caller, independent of the ownership/assignment checks below
-- it in the function body.
select throws_like(
  $$select update_workout_plan('00000000-0000-0000-0000-000000017181', 'Cross-Gym Forged Update', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017172', 'sets', 3, 'reps', 10, 'note', null)))$$,
  '%not found%',
  'a coach from a different gym cannot call update_workout_plan() on another gym''s plan id'
);

reset role;

select * from finish();
rollback;
