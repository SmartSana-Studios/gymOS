-- Story 13.1: Shared Exercise Library (FR-112). Tests the new
-- exercise_library table's RLS (0079_shared_exercise_library.sql) -- a plain
-- RLS-gated table, not a SECURITY DEFINER RPC, so every assertion here
-- simulates a session (`set local role authenticated` + `set_config` of
-- `request.jwt.claims`) and reads/writes the table directly. Fixture/
-- session-simulation conventions match class_attendance_marking.test.sql.

begin;
select plan(5);

-- Captured as postgres (superuser, no RLS applied) before any role switch --
-- the true platform-default count, so assertion (a) below isn't coupled to
-- a hardcoded literal that would silently drift if the seed list changes.
select set_config('exercise_library_test.platform_count', (select count(*)::int from exercise_library where gym_id is null)::text, true);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009801', 'Shared Exercise Library Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000009811', 'Shared Exercise Library Gym A', '00000000-0000-0000-0000-000000009801'),
  ('00000000-0000-0000-0000-000000009812', 'Shared Exercise Library Gym B', '00000000-0000-0000-0000-000000009801');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009821'), -- Gym A: coach
  ('00000000-0000-0000-0000-000000009822'), -- Gym A: member
  ('00000000-0000-0000-0000-000000009823'); -- Gym B: coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009831', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009821', 'coach', 'Exercise Library Gym A Coach'),
  ('00000000-0000-0000-0000-000000009832', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009822', 'member', 'Exercise Library Gym A Member'),
  ('00000000-0000-0000-0000-000000009833', '00000000-0000-0000-0000-000000009812', '00000000-0000-0000-0000-000000009823', 'coach', 'Exercise Library Gym B Coach');

-- Gym A's own custom entry, and Gym B's own custom entry, seeded directly as
-- postgres (superuser bypasses RLS), so the read assertions below aren't
-- coupled to the coach-insert path also under test.
insert into exercise_library (id, gym_id, name) values
  ('00000000-0000-0000-0000-000000009841', '00000000-0000-0000-0000-000000009811', 'Gym A Custom Row'),
  ('00000000-0000-0000-0000-000000009842', '00000000-0000-0000-0000-000000009812', 'Gym B Custom Row');

-- ============================================================================
-- (a) AC #1: a Coach session sees every platform-default row (gym_id is
-- null), exactly matching the true (superuser-visible) count captured above.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009821","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from exercise_library where gym_id is null),
  current_setting('exercise_library_test.platform_count')::int,
  'a Coach session sees every platform-default row'
);

reset role;

-- ============================================================================
-- (b) AC #2: a Coach session sees their own gym's custom row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009821","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from exercise_library where id = '00000000-0000-0000-0000-000000009841'),
  1,
  'a Coach session sees their own gym''s custom row'
);

reset role;

-- ============================================================================
-- (c) AC #2 (the core tenant-isolation assertion): a Coach session does NOT
-- see a different gym's custom row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009821","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from exercise_library where id = '00000000-0000-0000-0000-000000009842'),
  0,
  'a Coach session cannot see a different gym''s custom row'
);

reset role;

-- ============================================================================
-- (d) A Member session can also read platform-default + their own gym's
-- rows -- supports the future Story 13.3 read path.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009822","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from exercise_library where gym_id is null or gym_id = '00000000-0000-0000-0000-000000009811'),
  current_setting('exercise_library_test.platform_count')::int + 1,
  'a Member session sees platform defaults plus their own gym''s one custom row'
);

reset role;

-- ============================================================================
-- (e) AC #2: a Coach insert with gym_id matching their own claim succeeds,
-- and the new row is visible only within that gym -- not a different gym's
-- coach session.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009821","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"coach"}',
  true
);

insert into exercise_library (id, gym_id, name)
values ('00000000-0000-0000-0000-000000009843', '00000000-0000-0000-0000-000000009811', 'Coach-Inserted Row');

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009823","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009812","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from exercise_library where id = '00000000-0000-0000-0000-000000009843'),
  0,
  'a Coach-inserted row is visible only within its own gym, not a different gym''s coach session'
);

reset role;

select * from finish();
rollback;
