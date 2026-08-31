-- Story 13.1: Shared Exercise Library (FR-112) negative coverage. Tests
-- coach_insert_own_gym_exercise_library's boundaries: only a Coach may
-- insert, only into their own gym, and never a platform-default (NULL
-- gym_id) row. A `with check` violation on INSERT raises a real
-- "row-level security" error (unlike a permissive-filter UPDATE's silent
-- 0-rows-affected), matching class_creation_scheduling.negative.test.sql's
-- established throws_like pattern.

begin;
select plan(9);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009901', 'Shared Exercise Library Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000009911', 'Shared Exercise Library Negative Test Gym A', '00000000-0000-0000-0000-000000009901'),
  ('00000000-0000-0000-0000-000000009912', 'Shared Exercise Library Negative Test Gym B', '00000000-0000-0000-0000-000000009901');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009921'), -- Gym A: owner
  ('00000000-0000-0000-0000-000000009922'), -- Gym A: manager
  ('00000000-0000-0000-0000-000000009923'), -- Gym A: supervisor
  ('00000000-0000-0000-0000-000000009924'), -- Gym A: receptionist
  ('00000000-0000-0000-0000-000000009925'), -- Gym A: coach
  ('00000000-0000-0000-0000-000000009926'); -- Gym A: member

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009931', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009921', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009922', 'manager', 'Negative Test Manager'),
  ('00000000-0000-0000-0000-000000009933', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009923', 'supervisor', 'Negative Test Supervisor'),
  ('00000000-0000-0000-0000-000000009934', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000009935', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009925', 'coach', 'Negative Test Coach'),
  ('00000000-0000-0000-0000-000000009936', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009926', 'member', 'Negative Test Member');

-- ============================================================================
-- (a) Every non-Coach staff role is RLS-denied on INSERT.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Owner Row')$$,
  '%row-level security%',
  'an owner-claim session cannot INSERT into exercise_library'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"manager"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Manager Row')$$,
  '%row-level security%',
  'a manager-claim session cannot INSERT into exercise_library'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009923","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"supervisor"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Supervisor Row')$$,
  '%row-level security%',
  'a supervisor-claim session cannot INSERT into exercise_library'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009924","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"receptionist"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Receptionist Row')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT into exercise_library'
);

reset role;

-- ============================================================================
-- (b) A Coach cannot insert a row with gym_id set to a different gym's id
-- (cross-tenant write attempt) -- `gym_id = private.gym_id()` in the
-- with-check rejects it, even though the caller genuinely is a Coach.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009925","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"coach"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009912', 'Cross-Gym Row')$$,
  '%row-level security%',
  'a Coach cannot INSERT a row scoped to a different gym''s id'
);

reset role;

-- ============================================================================
-- (c) A Coach cannot insert a platform-default row (gym_id null) directly --
-- only migration-seeded rows may be NULL-scoped. `gym_id = private.gym_id()`
-- rejects a NULL gym_id under SQL's three-valued NULL-comparison logic.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009925","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"coach"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values (null, 'Forged Platform Row')$$,
  '%row-level security%',
  'a Coach cannot INSERT a platform-default (NULL gym_id) row'
);

reset role;

-- ============================================================================
-- (d) anon has no grant on exercise_library at all.
-- ============================================================================
set local role anon;

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Anon Row')$$,
  '%permission denied%',
  'anon cannot INSERT into exercise_library (no table-level grant at all)'
);

reset role;

-- ============================================================================
-- (e) A Member session (not staff at all) is RLS-denied on INSERT, same as
-- every non-Coach staff role above -- the single most common non-staff
-- caller of this table, previously untested.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009926","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"member"}',
  true
);

select throws_like(
  $$insert into exercise_library (gym_id, name) values ('00000000-0000-0000-0000-000000009911', 'Forged Member Row')$$,
  '%row-level security%',
  'a member-claim session cannot INSERT into exercise_library'
);

reset role;

-- ============================================================================
-- (f) anon has no SELECT grant either -- symmetric to (d)'s anon-INSERT
-- coverage, previously untested.
-- ============================================================================
set local role anon;

select throws_like(
  $$select 1 from exercise_library limit 1$$,
  '%permission denied%',
  'anon cannot SELECT from exercise_library (no table-level grant at all)'
);

reset role;

select * from finish();
rollback;
