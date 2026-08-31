-- Story 13.4: Plan Handoff on Coach Reassignment (FR-111, FR-055). Tests
-- the new Owner/Manager read grants, `take_ownership_of_workout_plan()`,
-- and `get_workout_plan_viewer_context()` (0082_plan_handoff_on_coach_reassignment.sql).
-- Fixture built via `assign_coach()` (0039), not hand-crafted
-- `coach_assignments` rows -- matches every prior story's own fixture
-- discipline. Session-simulation conventions match
-- coach_authored_workout_plans.test.sql (Story 13.2).

begin;
select plan(18);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000019001', 'Plan Handoff Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000019011', 'Plan Handoff Gym A', '00000000-0000-0000-0000-000000019001');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000019021'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000019022'), -- Gym A: manager
  ('00000000-0000-0000-0000-000000019024'), -- Gym A: coach 1 (original author)
  ('00000000-0000-0000-0000-000000019025'), -- Gym A: coach 2 (newly assigned)
  ('00000000-0000-0000-0000-000000019027'); -- Gym A: member 1

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000019071', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019021', 'owner', 'Plan Handoff Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000019072', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019022', 'manager', 'Plan Handoff Gym A Manager', current_date),
  ('00000000-0000-0000-0000-000000019074', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019024', 'coach', 'Plan Handoff Gym A Coach 1', current_date),
  ('00000000-0000-0000-0000-000000019075', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019025', 'coach', 'Plan Handoff Gym A Coach 2', current_date),
  ('00000000-0000-0000-0000-000000019077', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019027', 'member', 'Plan Handoff Gym A Member 1', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000019121', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019077', '00000000-0000-0000-0000-000000019074', now() - interval '30 days', null);

-- ============================================================================
-- (a) Coach 1 authors Member 1's plan.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select set_config(
  'plan_handoff_test.plan_id',
  (select create_workout_plan(
    '00000000-0000-0000-0000-000000019077',
    'Member 1''s Strength Plan',
    jsonb_build_array(
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null)
    )
  ))::text,
  true
);

-- (b) get_workout_plan_viewer_context() for the authoring coach, before any
-- reassignment: is_authoring_coach true, author_name null.
select is(
  (select is_authoring_coach from get_workout_plan_viewer_context(current_setting('plan_handoff_test.plan_id')::uuid)),
  true,
  'get_workout_plan_viewer_context() reports is_authoring_coach = true for the authoring coach'
);

select is(
  (select author_name from get_workout_plan_viewer_context(current_setting('plan_handoff_test.plan_id')::uuid)),
  null,
  'get_workout_plan_viewer_context() reports author_name = null for the authoring coach (no handoff banner needed)'
);

reset role;

-- Seed a completion row directly (bypassing RLS, as postgres) -- needed as
-- the Owner/Manager completions-visibility target below.
insert into workout_plan_completions (id, gym_id, member_id, plan_id, exercise_id) values
  ('00000000-0000-0000-0000-000000019191', '00000000-0000-0000-0000-000000019011', '00000000-0000-0000-0000-000000019077', current_setting('plan_handoff_test.plan_id')::uuid, (select id from exercise_library where gym_id is null and name = 'Squat'));

-- ============================================================================
-- (c) Owner reassigns Member 1 from Coach 1 to Coach 2 via assign_coach()
-- (0039) -- not a hand-crafted coach_assignments row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);
select assign_coach('00000000-0000-0000-0000-000000019077', '00000000-0000-0000-0000-000000019075');
reset role;

-- ============================================================================
-- (d) Regression-lock: the reassigned-away coach (Coach 1) can no longer
-- SELECT the plan or its exercises (Subtask 1.1 point 2 -- prove it stays
-- true, don't just assume).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  0,
  'the reassigned-away coach (Coach 1) can no longer SELECT the plan'
);

select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  0,
  'the reassigned-away coach (Coach 1) can no longer SELECT the plan''s exercises'
);

reset role;

-- ============================================================================
-- (e) Regression-lock: the new coach (Coach 2) can already SELECT the plan
-- and its exercises (Subtask 1.1 point 1 -- current-assignment-scoped RLS,
-- no code change needed for this half).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'the new coach (Coach 2) can SELECT the plan'
);

select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'the new coach (Coach 2) can SELECT the plan''s exercises'
);

-- (f) get_workout_plan_viewer_context() for the reassigned coach, before
-- taking ownership: is_authoring_coach false, author_name is Coach 1's name.
select is(
  (select is_authoring_coach from get_workout_plan_viewer_context(current_setting('plan_handoff_test.plan_id')::uuid)),
  false,
  'get_workout_plan_viewer_context() reports is_authoring_coach = false for the reassigned coach before taking ownership'
);

select is(
  (select author_name from get_workout_plan_viewer_context(current_setting('plan_handoff_test.plan_id')::uuid)),
  'Plan Handoff Gym A Coach 1',
  'get_workout_plan_viewer_context() resolves the previous (authoring) coach''s name for the reassigned coach'
);

reset role;

-- ============================================================================
-- (g) Owner and Manager can each SELECT the plan, its exercises, and the
-- completion row (the new AC #1 grant, Subtask 1.2).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Owner can SELECT the plan'
);
select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Owner can SELECT the plan''s exercises'
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Owner can SELECT the plan''s completion row'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Manager can SELECT the plan'
);
select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Manager can SELECT the plan''s exercises'
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'Manager can SELECT the plan''s completion row'
);

reset role;

-- ============================================================================
-- (h) The member's own SELECT is unaffected by the reassignment (Subtask
-- 1.1 point 3).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  1,
  'the member''s own SELECT of their plan is unaffected by the coach reassignment'
);

reset role;

-- ============================================================================
-- (i) take_ownership_of_workout_plan() called by the new (currently
-- assigned) coach succeeds and updates workout_plans.coach_id.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000019025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000019011","app_role":"coach"}',
  true
);

select lives_ok(
  $$select take_ownership_of_workout_plan(current_setting('plan_handoff_test.plan_id')::uuid)$$,
  'take_ownership_of_workout_plan() succeeds for the currently-assigned (new) coach'
);

select is(
  (select coach_id from workout_plans where id = current_setting('plan_handoff_test.plan_id')::uuid),
  '00000000-0000-0000-0000-000000019075'::uuid,
  'take_ownership_of_workout_plan() updates workout_plans.coach_id to the caller'
);

-- (j) After taking ownership, update_workout_plan() now succeeds for that
-- same coach -- proves the two RPCs compose (0080's existing
-- v_existing_coach_id != v_coach_id check now passes).
select lives_ok(
  $$select update_workout_plan(
    current_setting('plan_handoff_test.plan_id')::uuid,
    'Member 1''s Strength Plan (Updated By Coach 2)',
    jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 4, 'reps', 8, 'note', null))
  )$$,
  'update_workout_plan() now succeeds for Coach 2 after taking ownership'
);

reset role;

select * from finish();
rollback;
