-- Story 13.2: Coach-Authored Workout Plans (FR-109, FR-110, FR-122). Tests
-- `create_workout_plan()`/`update_workout_plan()` and the `workout_plans`/
-- `workout_plan_exercises` RLS policies (0080_coach_authored_workout_plans.sql).
-- Fixture/session-simulation conventions match
-- coach_portal_member_detail_session_notes.test.sql (Story 5.3): `set local
-- role authenticated` + `set_config('request.jwt.claims', ...)`, fixtures
-- seeded up front as the connecting role, `reset role` before switching
-- sessions.

begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000017001', 'Workout Plans Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000017011', 'Workout Plans Gym A', '00000000-0000-0000-0000-000000017001');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000017021'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000017024'), -- Gym A: coach 1
  ('00000000-0000-0000-0000-000000017027'), -- Gym A: member 1 (assigned to coach 1)
  ('00000000-0000-0000-0000-000000017028'); -- Gym A: member 2 (not assigned to coach 1)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000017071', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017021', 'owner', 'Workout Plans Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000017074', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017024', 'coach', 'Workout Plans Gym A Coach 1', current_date),
  ('00000000-0000-0000-0000-000000017077', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017027', 'member', 'Workout Plans Gym A Member 1', current_date),
  ('00000000-0000-0000-0000-000000017078', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017028', 'member', 'Workout Plans Gym A Member 2', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000017121', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017077', '00000000-0000-0000-0000-000000017074', now() - interval '30 days', null);

-- Gym A's own custom exercise entry (0079's own INSERT policy tested
-- separately, shared_exercise_library.test.sql) -- seeded directly as
-- postgres so the assertions below aren't coupled to that insert path.
insert into exercise_library (id, gym_id, name) values
  ('00000000-0000-0000-0000-000000017141', '00000000-0000-0000-0000-000000017011', 'Workout Plans Gym A Custom Exercise');

-- ============================================================================
-- (a) create_workout_plan(): as Coach 1, for their assigned Member 1, using
-- both a platform-default exercise_id (gym_id is null) and the gym's own
-- custom exercise_id, submitted in a specific order.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"coach"}',
  true
);

select set_config(
  'workout_plans_test.plan_id',
  (select create_workout_plan(
    '00000000-0000-0000-0000-000000017077',
    'Member 1''s Strength Plan',
    jsonb_build_array(
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', 'focus on depth'),
      jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017141', 'sets', 3, 'reps', 8, 'note', null)
    )
  ))::text,
  true
);

select isnt(
  current_setting('workout_plans_test.plan_id'),
  null,
  'create_workout_plan() returns a non-null uuid for Coach 1''s assigned Member 1'
);

select is(
  (select coach_id from workout_plans where id = current_setting('workout_plans_test.plan_id')::uuid),
  '00000000-0000-0000-0000-000000017074'::uuid,
  'the new workout_plans row''s coach_id is Coach 1''s own resolved members.id'
);

-- (b) exercises stored in the submitted order (order_index matches array
-- position -- 1-indexed, from `jsonb_array_elements(...) with ordinality`'s
-- own Postgres convention, used directly by the RPC with no adjustment).
select is(
  (select exercise_id from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid and order_index = 1),
  (select id from exercise_library where gym_id is null and name = 'Squat'),
  'the first submitted exercise is stored at order_index 1'
);

select is(
  (select exercise_id from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid and order_index = 2),
  '00000000-0000-0000-0000-000000017141'::uuid,
  'the second submitted exercise (the gym''s own custom entry) is stored at order_index 2'
);

reset role;

-- ============================================================================
-- (c) Member 1 (self) can read their own plan and its exercises.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('workout_plans_test.plan_id')::uuid),
  1,
  'Member 1 (self) can read their own workout_plans row'
);

select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid),
  2,
  'Member 1 (self) can read both of their own plan''s exercise rows'
);

reset role;

-- ============================================================================
-- (d) The assigned coach (Coach 1) can also read the plan and its exercises.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from workout_plans where id = current_setting('workout_plans_test.plan_id')::uuid),
  1,
  'the assigned coach (Coach 1) can read Member 1''s workout_plans row'
);

select is(
  (select count(*)::int from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid),
  2,
  'the assigned coach (Coach 1) can read both of Member 1''s plan exercise rows'
);

-- ============================================================================
-- (e) update_workout_plan(): as the same authoring coach, replaces the
-- exercise list -- delete-then-reinsert observed via a changed id set (same
-- plan_id), including a reorder (the two exercises swap positions).
-- ============================================================================
select set_config(
  'workout_plans_test.original_exercise_ids',
  (select string_agg(id::text, ',' order by id) from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid),
  true
);

select lives_ok(
  $$select update_workout_plan(
    current_setting('workout_plans_test.plan_id')::uuid,
    'Member 1''s Strength Plan (Updated)',
    jsonb_build_array(
      jsonb_build_object('exercise_id', '00000000-0000-0000-0000-000000017141', 'sets', 4, 'reps', 6, 'note', null),
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', 'focus on depth')
    )
  )$$,
  'update_workout_plan() succeeds without raising for the authoring coach'
);

select is(
  (select name from workout_plans where id = current_setting('workout_plans_test.plan_id')::uuid),
  'Member 1''s Strength Plan (Updated)',
  'update_workout_plan() updates the plan name'
);

select isnt(
  (select string_agg(id::text, ',' order by id) from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid),
  current_setting('workout_plans_test.original_exercise_ids'),
  'update_workout_plan() replaces the exercise rows (delete-then-reinsert produces a changed id set, same plan_id)'
);

select is(
  (select exercise_id from workout_plan_exercises where plan_id = current_setting('workout_plans_test.plan_id')::uuid and order_index = 1),
  '00000000-0000-0000-0000-000000017141'::uuid,
  'update_workout_plan()''s reorder is reflected -- the gym custom exercise now sits at order_index 1'
);

reset role;

select * from finish();
rollback;
