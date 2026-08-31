-- Story 13.3: Member Plan View & Completion Tracking (FR-110). Tests
-- workout_plan_completions' RLS policies (0081_member_plan_view_completion_tracking.sql).
-- Fixture/session-simulation conventions match
-- coach_authored_workout_plans.test.sql (Story 13.2).

begin;
select plan(10);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000018001', 'Plan Completion Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000018011', 'Plan Completion Gym A', '00000000-0000-0000-0000-000000018001');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000018021'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000018024'), -- Gym A: coach 1
  ('00000000-0000-0000-0000-000000018027'); -- Gym A: member 1 (assigned to coach 1)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000018071', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018021', 'owner', 'Plan Completion Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000018074', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018024', 'coach', 'Plan Completion Gym A Coach 1', current_date),
  ('00000000-0000-0000-0000-000000018077', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018027', 'member', 'Plan Completion Gym A Member 1', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000018121', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018077', '00000000-0000-0000-0000-000000018074', now() - interval '30 days', null);

-- Coach 1 authors Member 1's plan via the real RPC (0080), two exercises:
-- Squat (order_index 1), Bench Press (order_index 2).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"coach"}',
  true
);

select set_config(
  'plan_completion_test.plan_id',
  (select create_workout_plan(
    '00000000-0000-0000-0000-000000018077',
    'Member 1''s Plan',
    jsonb_build_array(
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null),
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Bench Press'), 'sets', 3, 'reps', 8, 'note', null)
    )
  ))::text,
  true
);
reset role;

-- ============================================================================
-- (a) Member 1 can insert a completion for Squat, currently in their own
-- plan.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"member"}',
  true
);

select set_config('plan_completion_test.client_id_1', gen_random_uuid()::text, true);

select lives_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018011',
      '00000000-0000-0000-0000-000000018077',
      current_setting('plan_completion_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      current_setting('plan_completion_test.client_id_1')::uuid
    )$$,
  'Member 1 can insert a completion for an exercise currently in their own plan'
);

-- (b) The same member can read it back.
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_test.plan_id')::uuid),
  1,
  'Member 1 (self) can read their own completion'
);

-- (c) A second insert with the same client_completion_id is rejected by the
-- unique index (the idempotent-replay contract the mobile 23505-catch
-- depends on).
select throws_like(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018011',
      '00000000-0000-0000-0000-000000018077',
      current_setting('plan_completion_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      current_setting('plan_completion_test.client_id_1')::uuid
    )$$,
  '%idx_workout_plan_completions_client_id%',
  'a second insert with the same client_completion_id is rejected by the unique index'
);

-- (d) Multiple completions for the same (plan_id, exercise_id) pair are
-- allowed (no dedup-per-day constraint).
select lives_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018011',
      '00000000-0000-0000-0000-000000018077',
      current_setting('plan_completion_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  'a second, distinct completion for the same (plan_id, exercise_id) pair is allowed'
);

select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_test.plan_id')::uuid and exercise_id = (select id from exercise_library where gym_id is null and name = 'Squat')),
  2,
  'both Squat completions are stored, no dedup-per-day constraint'
);

reset role;

-- ============================================================================
-- (e) The assigned coach can read Member 1's completions too.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_test.plan_id')::uuid),
  2,
  'the assigned coach can read Member 1''s completions'
);

-- ============================================================================
-- (f) update_workout_plan() removes Bench Press from the plan entirely and
-- replaces it with Deadlift (a fresh row set, new workout_plan_exercises
-- ids, per 0080's delete-then-reinsert). A completion logged against Squat
-- (still present) must remain readable -- proving Subtask 1.1's design
-- actually survives a plan edit, not just that it was insertable before one.
-- ============================================================================
select lives_ok(
  $$select update_workout_plan(
    current_setting('plan_completion_test.plan_id')::uuid,
    'Member 1''s Plan (Updated)',
    jsonb_build_array(
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null),
      jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Deadlift'), 'sets', 1, 'reps', 5, 'note', null)
    )
  )$$,
  'update_workout_plan() succeeds, dropping Bench Press and adding Deadlift'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_test.plan_id')::uuid and exercise_id = (select id from exercise_library where gym_id is null and name = 'Squat')),
  2,
  'both Squat completions remain readable after the plan was edited (exercise_id survives the delete-then-reinsert)'
);
reset role;

-- ============================================================================
-- (g) Duplicate exercise_id within one plan (13.2's own accepted case):
-- Coach 1 edits the plan again so Squat appears twice. A completion logged
-- for that exercise_id is then associated with both workout_plan_exercises
-- rows when joined -- the documented, accepted shared-completion-state
-- limitation (Subtask 1.1), verified here rather than assumed.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"coach"}',
  true
);
select update_workout_plan(
  current_setting('plan_completion_test.plan_id')::uuid,
  'Member 1''s Plan (Duplicate Squat)',
  jsonb_build_array(
    jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 5, 'reps', 5, 'note', 'warm-up'),
    jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', 'working sets')
  )
);
reset role;

select is(
  (select count(*)::int
   from workout_plan_exercises wpe
   join workout_plan_completions wpc
     on wpc.plan_id = wpe.plan_id and wpc.exercise_id = wpe.exercise_id
   where wpe.plan_id = current_setting('plan_completion_test.plan_id')::uuid
     and wpe.exercise_id = (select id from exercise_library where gym_id is null and name = 'Squat')),
  4,
  'a single exercise_id''s completions join to both duplicate workout_plan_exercises rows (2 completions x 2 rows) -- the documented shared-completion-state limitation'
);

-- ============================================================================
-- (h) Deleting the plan itself cascades to its completions -- `plan_id
-- references workout_plans(id) on delete cascade`, per Subtask 1.2 ("there
-- is no meaningful completion without a plan"). No UI/RPC path deletes a
-- plan today, so this exercises the FK directly as an elevated role.
-- ============================================================================
delete from workout_plans where id = current_setting('plan_completion_test.plan_id')::uuid;

select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_test.plan_id')::uuid),
  0,
  'deleting the plan cascades to its completions (on delete cascade)'
);

select * from finish();
rollback;
