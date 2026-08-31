-- Story 13.3: Member Plan View & Completion Tracking (FR-110) negative
-- coverage. Tests workout_plan_completions' RLS boundaries: cross-member,
-- cross-gym, non-assigned-coach, non-coach-role, and the
-- exercise-currently-in-plan insert guard.

begin;
select plan(10);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000018101', 'Plan Completion Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000018111', 'Plan Completion Negative Test Gym A', '00000000-0000-0000-0000-000000018101'),
  ('00000000-0000-0000-0000-000000018112', 'Plan Completion Negative Test Gym B', '00000000-0000-0000-0000-000000018101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000018121'), -- Gym A: receptionist (non-coach role)
  ('00000000-0000-0000-0000-000000018125'), -- Gym A: coach 1 (assigned to Member 1)
  ('00000000-0000-0000-0000-000000018126'), -- Gym A: coach 2 (unassigned to Member 1)
  ('00000000-0000-0000-0000-000000018127'), -- Gym A: member 1
  ('00000000-0000-0000-0000-000000018128'), -- Gym A: member 2 (target for cross-member insert attempt)
  ('00000000-0000-0000-0000-000000018131'); -- Gym B: coach

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000018144', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018121', 'receptionist', 'Negative Test Receptionist', current_date),
  ('00000000-0000-0000-0000-000000018145', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018125', 'coach', 'Negative Test Coach 1', current_date),
  ('00000000-0000-0000-0000-000000018146', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018126', 'coach', 'Negative Test Coach 2', current_date),
  ('00000000-0000-0000-0000-000000018147', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018127', 'member', 'Negative Test Member 1', current_date),
  ('00000000-0000-0000-0000-000000018148', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018128', 'member', 'Negative Test Member 2', current_date),
  ('00000000-0000-0000-0000-000000018151', '00000000-0000-0000-0000-000000018112', '00000000-0000-0000-0000-000000018131', 'coach', 'Negative Test Gym B Coach', current_date);

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000018161', '00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018147', '00000000-0000-0000-0000-000000018145', now() - interval '30 days', null);

-- Member 1's plan (one exercise: Squat), authored via the real RPC by Coach 1.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"coach"}',
  true
);
select set_config(
  'plan_completion_negative_test.plan_id',
  (select create_workout_plan(
    '00000000-0000-0000-0000-000000018147',
    'Member 1''s Plan',
    jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null))
  ))::text,
  true
);
reset role;

-- ============================================================================
-- (a) Member 1 cannot insert a completion for an exercise_id that is not
-- currently part of their plan (the exists(...) guard) -- Bench Press was
-- never added to this plan.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"member"}',
  true
);

select throws_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018111',
      '00000000-0000-0000-0000-000000018147',
      current_setting('plan_completion_negative_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Bench Press'),
      gen_random_uuid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "workout_plan_completions"',
  'Member 1 cannot insert a completion for an exercise_id not currently in their plan'
);

-- (b) Member 1 cannot insert a completion for another member's plan
-- (plan_id/member_id mismatch is RLS-rejected by the plan_id in (...) clause).
select throws_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018111',
      '00000000-0000-0000-0000-000000018127',
      current_setting('plan_completion_negative_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "workout_plan_completions"',
  'Member 1 cannot insert a completion row with a forged member_id belonging to a different member'
);

-- (b2) Member 1 cannot insert a completion carrying a forged gym_id (a real
-- gym -- Gym B -- that isn't their own) alongside their own correct
-- member_id/plan_id/exercise_id -- the `gym_id = (select gym_id from
-- members where id = member_id)` data-correctness clause.
select throws_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018112',
      '00000000-0000-0000-0000-000000018127',
      current_setting('plan_completion_negative_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "workout_plan_completions"',
  'Member 1 cannot insert a completion row with a forged gym_id that does not match their own member_id''s gym'
);
reset role;

-- ============================================================================
-- (c) Member 2 (a different member, no plan of their own) cannot read
-- Member 1's completions -- RLS-empty, not an error. Seed one completion
-- first, as postgres, to have something to fail to see.
-- ============================================================================
insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id) values
  ('00000000-0000-0000-0000-000000018111', '00000000-0000-0000-0000-000000018147', current_setting('plan_completion_negative_test.plan_id')::uuid, (select id from exercise_library where gym_id is null and name = 'Squat'), gen_random_uuid());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"member"}',
  true
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid),
  0,
  'a member not on the plan cannot read another member''s completions (RLS-empty)'
);
reset role;

-- ============================================================================
-- (d) A coach not currently assigned to Member 1 cannot read Member 1's
-- completions.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"coach"}',
  true
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid),
  0,
  'a coach not currently assigned to the member cannot read that member''s completions (RLS-empty)'
);
reset role;

-- ============================================================================
-- (e) A non-coach staff role (receptionist) cannot read the completions
-- either -- coach_read_assigned_workout_plan_completions' own
-- current_member_role() = 'coach' clause.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"receptionist"}',
  true
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid),
  0,
  'a non-coach staff role (receptionist) cannot read the member''s completions (RLS-empty)'
);
reset role;

-- ============================================================================
-- (f)-(g) Cross-gym isolation: Gym B's own coach, entirely uninvolved in Gym
-- A's data, is denied on both read and insert.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018131","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018112","app_role":"coach"}',
  true
);
select is(
  (select count(*)::int from workout_plan_completions where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid),
  0,
  'a coach from a different gym cannot read another gym''s completions (RLS-empty)'
);

select throws_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000018112',
      '00000000-0000-0000-0000-000000018147',
      current_setting('plan_completion_negative_test.plan_id')::uuid,
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "workout_plan_completions"',
  'a coach from a different gym cannot insert a completion row for another gym''s member'
);
reset role;

-- ============================================================================
-- (h) A completion is append-only: no update/delete grant exists at all
-- (Subtask 1.3), so even Member 1 attempting to change/remove their own
-- completion is rejected by Postgres' own privilege system before RLS is
-- ever consulted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018111","app_role":"member"}',
  true
);

select throws_ok(
  $$update workout_plan_completions set completed_at = now() where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid$$,
  '42501',
  'permission denied for table workout_plan_completions',
  'no update grant exists -- Member 1 cannot update their own completion row'
);

select throws_ok(
  $$delete from workout_plan_completions where plan_id = current_setting('plan_completion_negative_test.plan_id')::uuid$$,
  '42501',
  'permission denied for table workout_plan_completions',
  'no delete grant exists -- Member 1 cannot delete their own completion row'
);
reset role;

select * from finish();
rollback;
