-- Story 11.9: Suspension Enforcement for Workout Plan Tables (NFR-018, AD-3).
--
-- Covers 0091_suspension_enforcement_for_workout_plans.sql: the
-- `tenant_active_gate` RESTRICTIVE policy newly applied to workout_plans,
-- workout_plan_exercises and workout_plan_completions, AND the in-function
-- private.current_gym_status() guard newly added to create_workout_plan(),
-- update_workout_plan() and take_ownership_of_workout_plan().
--
-- BOTH HALVES ARE TESTED SEPARATELY AND ON PURPOSE. RLS does not apply inside
-- a SECURITY DEFINER function, so the policy alone leaves all three RPCs wide
-- open -- proven empirically before 0091 was applied: with the three policies
-- in place and the gym suspended, a member's SELECT returned 0 rows and the
-- direct completions INSERT was refused, but take_ownership_of_workout_plan()
-- still succeeded and wrote. Sections A-C prove the policy half; Section E
-- proves the function half; deleting either set would leave a real hole green.
--
-- THE THREE DENIAL SHAPES (Story 11.9 Dev Notes §G). These fail DIFFERENTLY and
-- conflating them is the likeliest way to ship this broken:
--   1. Direct SELECT   -> silent RLS-empty. `is(count, 0)`, no error raised.
--   2. Direct INSERT on workout_plan_completions -> `authenticated` HAS an
--      INSERT grant there (0081:50-53), so the gate's WITH CHECK half fires:
--      42501 'new row violates row-level security policy for table "..."'.
--   3. Direct INSERT/UPDATE/DELETE elsewhere -> `authenticated` has NO such
--      grant on workout_plans / workout_plan_exercises (0080:62-66), so
--      Postgres refuses at the GRANT layer before RLS is ever consulted:
--      42501 'permission denied for table ...'. These assertions therefore do
--      NOT prove the gate -- they are here to pin the third shape so a future
--      reader does not "fix" them into the wrong idiom, and so that a grant
--      being widened later cannot silently open a write path. The familiar
--      "0 rows affected" CTE idiom is WRONG on these tables.
--   4. RPC denial -> throws_like '%is not active%' (the guard's raise).
--
-- Every zero-rows denial is paired with a positive control so it cannot pass
-- merely because the session is dead.
--
-- Session-simulation conventions match plan_handoff_on_coach_reassignment.test.sql
-- and tenant_suspension_enforcement.test.sql: fixtures first as the unrestricted
-- setup role, then `set local role authenticated` + 3-arg set_config() claims,
-- `reset role` to read back a write the gated session cannot see itself.
--
-- ⚠ The fixture gyms are inserted ALREADY suspended. You cannot suspend a gym
-- mid-file: private.protect_super_admin_only_gym_columns() (0014:33,51-53) is a
-- BEFORE UPDATE trigger that silently pins `status` back for any non-Super-Admin
-- caller while still reporting UPDATE 1. Section G's reversal therefore sets a
-- super_admin claim (which is what is_super_admin() actually reads) rather than
-- relying on the setup role's RLS bypass.

begin;
select plan(50);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000020201', 'Workout Suspension Test Tier', 6000, 60000, 30);

insert into gyms (id, name, tier_id, status, saas_billing_status, capacity) values
  ('00000000-0000-0000-0000-000000020211', 'Workout Suspension Gym (suspended)', '00000000-0000-0000-0000-000000020201', 'suspended', 'suspended', 25),
  ('00000000-0000-0000-0000-000000020212', 'Workout Suspension Gym (deactivated)', '00000000-0000-0000-0000-000000020201', 'deactivated', 'suspended', 25);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000020221'), -- suspended gym: coach 1 (authoring)
  ('00000000-0000-0000-0000-000000020222'), -- suspended gym: member A
  ('00000000-0000-0000-0000-000000020223'), -- deactivated gym: coach
  ('00000000-0000-0000-0000-000000020224'), -- deactivated gym: member
  ('00000000-0000-0000-0000-000000020225'), -- suspended gym: coach 2 (handoff target)
  ('00000000-0000-0000-0000-000000020226'), -- suspended gym: member B (coach 2's assignee)
  ('00000000-0000-0000-0000-000000020227'), -- suspended gym: owner
  ('00000000-0000-0000-0000-000000020228'), -- suspended gym: member C (NO plan -- see create_workout_plan note)
  ('00000000-0000-0000-0000-000000020229'); -- deactivated gym: member D (NO plan)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000020231', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020221', 'coach',  'Suspended Gym Coach 1', current_date),
  ('00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020222', 'member', 'Suspended Gym Member A', current_date),
  ('00000000-0000-0000-0000-000000020233', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020223', 'coach',  'Deactivated Gym Coach', current_date),
  ('00000000-0000-0000-0000-000000020234', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020224', 'member', 'Deactivated Gym Member', current_date),
  ('00000000-0000-0000-0000-000000020235', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020225', 'coach',  'Suspended Gym Coach 2', current_date),
  ('00000000-0000-0000-0000-000000020236', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020226', 'member', 'Suspended Gym Member B', current_date),
  ('00000000-0000-0000-0000-000000020237', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020227', 'owner',  'Suspended Gym Owner', current_date),
  ('00000000-0000-0000-0000-000000020238', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020228', 'member', 'Suspended Gym Member C', current_date),
  ('00000000-0000-0000-0000-000000020239', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020229', 'member', 'Deactivated Gym Member D', current_date);

-- idx_coach_assignments_active_member is UNIQUE on member_id WHERE ended_at is
-- null -- one active coach per member. Member B exists precisely so Section G
-- can exercise take_ownership_of_workout_plan() as a coach who is NOT the
-- author but IS the assignee, which is the real handoff shape.
insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0000-000000020241', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020231', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000020242', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020234', '00000000-0000-0000-0000-000000020233', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000020243', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020236', '00000000-0000-0000-0000-000000020235', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000020244', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020238', '00000000-0000-0000-0000-000000020231', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000020245', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020239', '00000000-0000-0000-0000-000000020233', now() - interval '30 days', null);

-- Plans are seeded DIRECTLY rather than through create_workout_plan(): the gyms
-- are already suspended, so after 0091 the RPC would (correctly) refuse. The
-- setup role bypasses RLS, so these land regardless of the new policy.
insert into workout_plans (id, gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0000-000000020251', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020231', 'Member A Strength Plan'),
  ('00000000-0000-0000-0000-000000020252', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020236', '00000000-0000-0000-0000-000000020231', 'Member B Handoff Plan'),
  ('00000000-0000-0000-0000-000000020253', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020234', '00000000-0000-0000-0000-000000020233', 'Deactivated Gym Plan');

insert into workout_plan_exercises (id, gym_id, member_id, plan_id, exercise_id, order_index, sets, reps) values
  ('00000000-0000-0000-0000-000000020261', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020251', (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10),
  ('00000000-0000-0000-0000-000000020262', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020236', '00000000-0000-0000-0000-000000020252', (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10),
  ('00000000-0000-0000-0000-000000020263', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020234', '00000000-0000-0000-0000-000000020253', (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10);

insert into workout_plan_completions (id, gym_id, member_id, plan_id, exercise_id) values
  ('00000000-0000-0000-0000-000000020271', '00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020251', (select id from exercise_library where gym_id is null and name = 'Squat')),
  ('00000000-0000-0000-0000-000000020272', '00000000-0000-0000-0000-000000020212', '00000000-0000-0000-0000-000000020234', '00000000-0000-0000-0000-000000020253', (select id from exercise_library where gym_id is null and name = 'Squat'));

-- ============================================================================
-- Section A: the policy half -- direct SELECT is silently empty for the
-- MEMBER's own session at a suspended gym.
--
-- ⚠ READ THE NEXT PARAGRAPH BEFORE TRUSTING THESE THREE ASSERTIONS.
-- They passed BEFORE 0091 was applied, and they are kept deliberately. The
-- self_read_own_workout_plan* policies read
-- `member_id in (select id from members where user_id = auth.uid())`, and
-- `members` has been gated since 0073 -- so at a suspended gym that subquery
-- is already empty and the member's own read was ALREADY transitively denied.
-- These assertions therefore pin real behaviour but do NOT prove 0091's policy.
-- Section B is what proves it: the coach and owner read paths go through
-- private.is_assigned_coach() and private.current_member_role(), both
-- SECURITY DEFINER, which bypass RLS entirely -- so those paths were genuinely
-- WIDE OPEN at a suspended gym until this migration. Verified by running this
-- file against the unguarded schema: tests 1-3 passed, the Section B ones did
-- not.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"member"}',
  true
);

select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020251')::int, 0, 'suspended gym: a member cannot read their own workout_plans row (self_read_own_workout_plan denied by the gate)');
select is((select count(*) from workout_plan_exercises where id = '00000000-0000-0000-0000-000000020261')::int, 0, 'suspended gym: a member cannot read their own workout_plan_exercises row');
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020271')::int, 0, 'suspended gym: a member cannot read their own workout_plan_completions row');

-- Positive control: without this, all three assertions above would also pass on
-- a session that simply cannot read anything at all.
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000020211')::int, 1, 'positive control: gyms itself stays readable while suspended -- the member session is alive, the three denials above are the gate');

-- AC #4: exercise_library is deliberately NOT gated. All 15 seeded rows are
-- platform defaults (gym_id is null) belonging to no tenant; gating this table
-- would subtract access to data that was never the suspended gym's.
select is((select count(*) from exercise_library where gym_id is null)::int, 15, 'AC #4 positive control: exercise_library stays fully readable while suspended -- the 15 platform-default rows are not the tenant''s to lose');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'exercise_library' and policyname = 'tenant_active_gate'),
  0,
  'AC #4: exercise_library carries no tenant_active_gate -- its ungated status is deliberate and asserted, not incidental'
);

-- ============================================================================
-- Section B: the gate is role-independent -- the COACH's session at the same
-- suspended gym is denied the same three rows through its own coach_read_*
-- policies.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"coach"}',
  true
);

select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020251')::int, 0, 'suspended gym: the authoring coach cannot read the plan they wrote either -- the gate is role-independent');
select is((select count(*) from workout_plan_exercises where id = '00000000-0000-0000-0000-000000020261')::int, 0, 'suspended gym: the authoring coach cannot read the plan''s exercises');
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020271')::int, 0, 'suspended gym: the authoring coach cannot read their assignee''s completions');
-- Positive control. These three are the load-bearing assertions in this file --
-- the coach path is one of only two that 0091 genuinely closed -- so they must
-- not be allowed to pass merely because the coach claim never resolved.
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000020211')::int, 1, 'positive control: the coach session is alive -- gyms stays readable while suspended, so the three zero-rows results above are the gate, not a dead session');

-- The Owner/Manager read path is a SECOND genuinely-open hole: its policies
-- gate on private.current_member_role(), which is SECURITY DEFINER and so
-- bypasses RLS on `members` -- meaning it was NOT transitively closed the way
-- the member's own self-read path was. These three failed before 0091.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020227","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"owner"}',
  true
);

select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020251')::int, 0, 'suspended gym: the Owner cannot read their own gym''s workout_plans row -- manager_or_owner_read_own_workout_plan gates on the SECURITY DEFINER current_member_role(), so this path was wide open before 0091');
select is((select count(*) from workout_plan_exercises where id = '00000000-0000-0000-0000-000000020261')::int, 0, 'suspended gym: the Owner cannot read their own gym''s workout_plan_exercises row');
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020271')::int, 0, 'suspended gym: the Owner cannot read their own gym''s workout_plan_completions row');
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000020211')::int, 1, 'positive control: the Owner session is alive -- gyms stays readable while suspended, so the three zero-rows results above are the gate, not a dead session');

-- ============================================================================
-- Section C: the policy half -- direct WRITES. Three different failure shapes,
-- see the header.
--
-- ⚠ NONE of these five assertions proves 0091's `with check` half, and an
-- earlier revision of this file claimed the completions INSERT did. It does not:
-- the permissive policy self_insert_own_workout_plan_completions (0081:82-87)
-- opens with `member_id in (select id from members where user_id = auth.uid())`,
-- and `members` has carried tenant_active_gate since 0073:117. At a suspended
-- gym that subquery is already empty, so the INSERT raised this exact 42501
-- before 0091 existed -- the same transitive mechanism Section A discloses for
-- the member's reads. Four of the five pin the GRANT layer instead, so a future
-- grant widening cannot silently open a path.
--
-- The `with check` half is therefore defence-in-depth with no independent
-- coverage here, and it only ever bites on this one table (0091:113-115). The
-- assertions that DO prove 0091 are Section B's staff reads and Section E's RPC
-- refusals. Closing this coverage gap needs a session whose permissive INSERT
-- policy passes while the gym is suspended, which no real role in this schema
-- has -- it is not a missing assertion so much as an unreachable one.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"member"}',
  true
);

-- Shape 2: the grant EXISTS, so an RLS message is what comes back rather than a
-- grant-layer one. Denied transitively through the already-gated `members`
-- subquery in the permissive policy -- see the section header; this does NOT
-- prove 0091's own with-check half.
select throws_ok(
  $$insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000020211',
      '00000000-0000-0000-0000-000000020232',
      '00000000-0000-0000-0000-000000020251',
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  '42501',
  'new row violates row-level security policy for table "workout_plan_completions"',
  'suspended gym: a member''s own valid completion INSERT is refused at the RLS layer (the grant exists, so RLS is what fires) -- transitively, via the gated `members` subquery in the permissive policy, not by 0091''s with-check half'
);

-- Shape 3: no grant at all -> refused at the grant layer, before RLS.
select throws_ok(
  $$insert into workout_plans (gym_id, member_id, coach_id, name) values ('00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020231', 'forged')$$,
  '42501',
  'permission denied for table workout_plans',
  'suspended gym: a direct workout_plans INSERT is refused at the GRANT layer -- authenticated has no INSERT grant, so this is not an RLS message and does not prove the gate'
);
select throws_ok(
  $$insert into workout_plan_exercises (gym_id, member_id, plan_id, exercise_id, order_index, sets, reps) values ('00000000-0000-0000-0000-000000020211', '00000000-0000-0000-0000-000000020232', '00000000-0000-0000-0000-000000020251', (select id from exercise_library where gym_id is null and name = 'Squat'), 2, 3, 10)$$,
  '42501',
  'permission denied for table workout_plan_exercises',
  'suspended gym: a direct workout_plan_exercises INSERT is refused at the GRANT layer'
);
select throws_ok(
  $$update workout_plans set name = 'forged' where id = '00000000-0000-0000-0000-000000020251'$$,
  '42501',
  'permission denied for table workout_plans',
  'suspended gym: a direct workout_plans UPDATE is refused at the GRANT layer -- the "0 rows affected" CTE idiom would be wrong here'
);
select throws_ok(
  $$delete from workout_plan_completions where id = '00000000-0000-0000-0000-000000020271'$$,
  '42501',
  'permission denied for table workout_plan_completions',
  'suspended gym: a direct workout_plan_completions DELETE is refused at the GRANT layer'
);

-- ============================================================================
-- Section D: a DEACTIVATED gym is denied by the same gate. 0091's policy uses
-- `= ''active''`, not `<> ''suspended''`, so both non-active states are covered
-- (decisions.md:300).
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020212","app_role":"member"}',
  true
);

select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020253')::int, 0, 'deactivated gym: a member cannot read their own workout_plans row -- `= active` excludes deactivated too, not just suspended');
select is((select count(*) from workout_plan_exercises where id = '00000000-0000-0000-0000-000000020263')::int, 0, 'deactivated gym: a member cannot read their own workout_plan_exercises row');
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020272')::int, 0, 'deactivated gym: a member cannot read their own workout_plan_completions row');
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000020212')::int, 1, 'positive control: gyms stays readable at the deactivated gym too');

-- ============================================================================
-- Section E: the FUNCTION half.
--
-- create_workout_plan() is called against Member C / Member D, who deliberately
-- have NO existing plan. idx_workout_plans_member_unique allows one plan per
-- member, so calling it for a member who already has one is refused by that
-- unique index rather than by the guard -- which would have masked the hole
-- entirely. Confirmed against the unguarded schema: with the original fixture
-- these two reported 'duplicate key value violates unique constraint', not
-- 'no exception thrown'. RLS does not apply inside a SECURITY DEFINER
-- function, so Sections A-D above prove nothing about these three. Before 0091
-- all three succeeded and WROTE at a fully suspended gym.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"coach"}',
  true
);

select throws_like(
  $$select create_workout_plan(
      '00000000-0000-0000-0000-000000020238',
      'Plan authored during suspension',
      jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null))
    )$$,
  '%is not active%',
  'suspended gym: create_workout_plan() is refused by the in-function guard -- RLS alone would not have stopped it'
);

select throws_like(
  $$select update_workout_plan(
      '00000000-0000-0000-0000-000000020251',
      'Renamed during suspension',
      jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 5, 'reps', 5, 'note', null))
    )$$,
  '%is not active%',
  'suspended gym: update_workout_plan() is refused by the in-function guard'
);

-- The guard sits ABOVE this function's `select ... for update` row lock, so a
-- suspended-gym caller never acquires it and never learns whether the plan
-- exists or who authored it.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"coach"}',
  true
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000020252')$$,
  '%is not active%',
  'suspended gym: take_ownership_of_workout_plan() is refused -- this is the one that still WROTE with the policy applied but no guard, so it is the load-bearing assertion of this file'
);

-- Same three at the DEACTIVATED gym.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020212","app_role":"coach"}',
  true
);
select throws_like(
  $$select create_workout_plan(
      '00000000-0000-0000-0000-000000020239',
      'Plan authored during deactivation',
      jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null))
    )$$,
  '%is not active%',
  'deactivated gym: create_workout_plan() is refused too'
);
select throws_like(
  $$select update_workout_plan(
      '00000000-0000-0000-0000-000000020253',
      'Renamed during deactivation',
      jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 5, 'reps', 5, 'note', null))
    )$$,
  '%is not active%',
  'deactivated gym: update_workout_plan() is refused too'
);
select throws_like(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000020253')$$,
  '%is not active%',
  'deactivated gym: take_ownership_of_workout_plan() is refused too'
);

-- ============================================================================
-- Section E2: the refusals wrote NOTHING. A guard that raises after a partial
-- write would still pass every throws_like above. Read back as the unrestricted
-- setup role, because the gated session cannot SELECT these tables at all.
-- ============================================================================
reset role;

select is(
  (select count(*) from workout_plans where gym_id = '00000000-0000-0000-0000-000000020211')::int,
  2,
  'refused create_workout_plan() wrote nothing -- the suspended gym still has exactly its 2 seeded plans'
);
select is(
  (select name from workout_plans where id = '00000000-0000-0000-0000-000000020251'),
  'Member A Strength Plan',
  'refused update_workout_plan() wrote nothing -- the plan name is untouched'
);
select is(
  (select count(*) from workout_plan_exercises where plan_id = '00000000-0000-0000-0000-000000020251')::int,
  1,
  'refused update_workout_plan() did not reach its `delete from workout_plan_exercises` -- the guard is above every write, not merely before the last one'
);
select is(
  (select coach_id from workout_plans where id = '00000000-0000-0000-0000-000000020252'),
  '00000000-0000-0000-0000-000000020231',
  'refused take_ownership_of_workout_plan() wrote nothing -- coach_id is still the original author'
);
select is(
  (select count(*) from workout_plans where gym_id = '00000000-0000-0000-0000-000000020212')::int,
  1,
  'deactivated gym: refused create_workout_plan() wrote nothing either'
);

-- ============================================================================
-- Section F: the NULL-status precondition, and why the fail-CLOSED branch is
-- NOT asserted behaviourally here.
--
-- The trap is real: private.current_gym_status() returns NULL for a claim
-- pointing at a gym row that does not exist, and with `<>` the comparison
-- yields NULL, the `if` never fires, and the function WRITES.
--
-- ⚠ But that branch is UNREACHABLE from all three RPCs, so no runtime assertion
-- in this file can cover it. Each function's non-STRICT coach lookup runs ABOVE
-- its guard and needs a `members` row at the claimed gym; members.gym_id has an
-- FK to gyms, so a gym whose status is NULL (i.e. one that does not exist)
-- can never also hold the caller's membership. Any claim that reaches the guard
-- necessarily has a real gyms row and therefore a non-NULL status.
--
-- A previous revision asserted this with throws_like(..., '%') and reported a
-- pass -- on `create_workout_plan: caller is not a coach in this gym`, raised
-- above the guard. It would have passed identically with the guard deleted or
-- regressed to `<>`, so it was removed rather than left as false confidence.
--
-- The `<>` regression IS caught, statically and by exact text, in two places:
--   * 0091's own post-condition DO block, which requires the literal
--     `current_gym_status() is distinct from 'active'` in all three bodies and
--     fails the migration at apply time otherwise;
--   * suspension_rpc_coverage.test.sql assertion 2, whose prosrc regex is exact.
-- The assertion below is kept because the precondition itself is worth pinning.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020299","app_role":"coach"}',
  true
);

select is(private.current_gym_status(), null, 'a gym_id claim pointing at a non-existent gym makes current_gym_status() NULL -- the precondition for the fail-open trap (the trap itself is unreachable from these RPCs; see above)');

-- ============================================================================
-- Section G: reversal (AC #3). The same previously-denied sessions succeed on
-- the very NEXT statement -- no reconnection, no token refresh -- because
-- private.current_gym_status() reads the gyms row live rather than anything
-- baked into the JWT. Every write is proven by a read-back, never by lives_ok
-- alone: a guard that silently swallowed its write would pass lives_ok.
--
-- The un-suspension sets a super_admin claim because that is literally what
-- private.is_super_admin() reads (a JWT claim, not a role), and the BEFORE
-- UPDATE trigger would otherwise pin `status` straight back.
-- ============================================================================
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000020291","role":"authenticated","app_role":"super_admin"}', true);
update gyms set status = 'active' where id = '00000000-0000-0000-0000-000000020211';

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-000000020211'),
  'active',
  'the reversal actually flipped gyms.status back to active (the BEFORE UPDATE trigger did not pin it back)'
);

-- The member session that was denied in Section A, resumed verbatim.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"member"}',
  true
);

select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020251')::int, 1, 'reversal: the same member session denied in Section A now reads their own plan -- next statement, no reconnect, no token refresh');
select is((select count(*) from workout_plan_exercises where id = '00000000-0000-0000-0000-000000020261')::int, 1, 'reversal: the same member session now reads their plan''s exercises');
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020271')::int, 1, 'reversal: the same member session now reads their own completions');

-- And the direct completions INSERT that Section C proved was refused.
select lives_ok(
  $$insert into workout_plan_completions (id, gym_id, member_id, plan_id, exercise_id, client_completion_id)
    values (
      '00000000-0000-0000-0000-000000020273',
      '00000000-0000-0000-0000-000000020211',
      '00000000-0000-0000-0000-000000020232',
      '00000000-0000-0000-0000-000000020251',
      (select id from exercise_library where gym_id is null and name = 'Squat'),
      gen_random_uuid()
    )$$,
  'reversal: the completion INSERT refused in Section C now succeeds'
);
select is((select count(*) from workout_plan_completions where id = '00000000-0000-0000-0000-000000020273')::int, 1, 'reversal: that completion INSERT actually landed -- read back, not merely lives_ok');

-- The coach session that was denied in Section E, resumed verbatim.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"coach"}',
  true
);

select lives_ok(
  $$select update_workout_plan(
      '00000000-0000-0000-0000-000000020251',
      'Renamed after reinstatement',
      jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 5, 'reps', 5, 'note', null))
    )$$,
  'reversal: update_workout_plan() refused in Section E now succeeds for the same coach session'
);

select set_config(
  'plan_suspension_test.new_plan_id',
  (select create_workout_plan(
    '00000000-0000-0000-0000-000000020238',
    'Plan authored after reinstatement',
    jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercise_library where gym_id is null and name = 'Squat'), 'sets', 3, 'reps', 10, 'note', null))
  ))::text,
  true
);

-- take_ownership_of_workout_plan(): coach 2, the assignee but not the author.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020211","app_role":"coach"}',
  true
);
select lives_ok(
  $$select take_ownership_of_workout_plan('00000000-0000-0000-0000-000000020252')$$,
  'reversal: take_ownership_of_workout_plan() refused in Section E now succeeds'
);

-- Read the three writes back as the setup role: a coach cannot SELECT some of
-- these rows itself, and a read-back is the whole point of this section.
reset role;

select is(
  (select name from workout_plans where id = '00000000-0000-0000-0000-000000020251'),
  'Renamed after reinstatement',
  'reversal: update_workout_plan()''s write actually LANDED -- lives_ok alone would not have caught a silently swallowed write'
);
select is(
  (select sets from workout_plan_exercises where plan_id = '00000000-0000-0000-0000-000000020251'),
  5::smallint,
  'reversal: update_workout_plan() rewrote the plan''s exercises too, not just its name'
);
select is(
  (select count(*) from workout_plans where id = current_setting('plan_suspension_test.new_plan_id')::uuid)::int,
  1,
  'reversal: create_workout_plan()''s write actually landed'
);
select is(
  (select count(*) from workout_plan_exercises where plan_id = current_setting('plan_suspension_test.new_plan_id')::uuid)::int,
  1,
  'reversal: create_workout_plan() wrote the plan''s exercise row too'
);
select is(
  (select coach_id from workout_plans where id = '00000000-0000-0000-0000-000000020252'),
  '00000000-0000-0000-0000-000000020235',
  'reversal: take_ownership_of_workout_plan()''s write actually landed -- coach_id is now coach 2'
);

-- The deactivated gym was never reinstated, so its denial must still hold. This
-- catches a reversal that accidentally flips the gate off globally.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020212","app_role":"member"}',
  true
);
select is((select count(*) from gyms where id = '00000000-0000-0000-0000-000000020212')::int, 1, 'positive control: the deactivated gym''s member session is alive after the reversal section''s role changes');
select is((select count(*) from workout_plans where id = '00000000-0000-0000-0000-000000020253')::int, 0, 'the deactivated gym is still denied after the other gym''s reversal -- the gate is per-gym, not global');

select * from finish();
rollback;
