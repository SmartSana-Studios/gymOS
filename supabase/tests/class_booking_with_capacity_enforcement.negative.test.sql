-- Story 12.2 negative privilege contract: class_bookings has zero direct
-- write access for any role -- all writes go through the two SECURITY
-- DEFINER RPCs. SELECT is scoped to "own bookings only" for members and
-- "own gym, any member" for staff. Mirrors class_creation_scheduling
-- .negative.test.sql's shape; asserts each privilege individually rather
-- than a comma-joined any-of check.

begin;
select plan(11);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008101', 'Class Booking Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000008111', 'Class Booking Negative Test Gym A', '00000000-0000-0000-0000-000000008101'),
  ('00000000-0000-0000-0000-000000008112', 'Class Booking Negative Test Gym B', '00000000-0000-0000-0000-000000008101');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008121'), -- Gym A: member (owns booking a)
  ('00000000-0000-0000-0000-000000008122'), -- Gym A: another member (owns booking b, used to prove cross-member SELECT denial)
  ('00000000-0000-0000-0000-000000008123'), -- Gym A: receptionist
  ('00000000-0000-0000-0000-000000008124'), -- Gym A: coach (class owner)
  ('00000000-0000-0000-0000-000000008125'); -- Gym B: receptionist (cross-gym staff SELECT denial)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008131', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008121', 'member', 'Negative Test Member A'),
  ('00000000-0000-0000-0000-000000008132', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008122', 'member', 'Negative Test Member B'),
  ('00000000-0000-0000-0000-000000008133', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008123', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000008134', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008124', 'coach', 'Negative Test Coach'),
  ('00000000-0000-0000-0000-000000008135', '00000000-0000-0000-0000-000000008112', '00000000-0000-0000-0000-000000008125', 'receptionist', 'Negative Test Cross-Gym Receptionist');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000008141', '00000000-0000-0000-0000-000000008111', 'Negative Test Fixture Class', '00000000-0000-0000-0000-000000008134', 5, 'one_off', now() + interval '1 day');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000008151', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008141', now() + interval '1 day');

-- Fixture bookings, seeded as postgres (bypasses RLS): booking a (Member A)
-- and booking b (Member B), used to exercise SELECT scoping below.
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-000000008161', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008151', '00000000-0000-0000-0000-000000008131'),
  ('00000000-0000-0000-0000-000000008162', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008151', '00000000-0000-0000-0000-000000008132');

-- ============================================================================
-- No authenticated/anon session -- not even a Receptionist -- can directly
-- INSERT/UPDATE/DELETE class_bookings. Per-privilege assertions, matching
-- 0057's negative-test fix, not a comma-joined any-of check.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008111","app_role":"receptionist"}',
  true
);

select throws_like(
  $$insert into class_bookings (id, gym_id, class_session_id, member_id)
    values ('00000000-0000-0000-0000-000000008163', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008151', '00000000-0000-0000-0000-000000008131')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT into class_bookings -- no write policy exists for any role'
);

-- UPDATE/DELETE have no USING policy to violate (only INSERT raises a
-- row-level-security exception) -- 0 rows affected silently, matching
-- tiers_and_gym_lifecycle_rls.test.sql's own "0 rows affected silently,
-- not an exception" precedent for the same no-write-policy shape.
with attempted as (
  update class_bookings set member_id = '00000000-0000-0000-0000-000000008132' where id = '00000000-0000-0000-0000-000000008161'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s UPDATE on class_bookings affects 0 rows -- no write policy exists for any role'
);

with attempted as (
  delete from class_bookings where id = '00000000-0000-0000-0000-000000008161'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s DELETE on class_bookings affects 0 rows -- no write policy exists for any role'
);

reset role;

set local role anon;

select throws_like(
  $$insert into class_bookings (id, gym_id, class_session_id, member_id)
    values ('00000000-0000-0000-0000-000000008164', '00000000-0000-0000-0000-000000008111', '00000000-0000-0000-0000-000000008151', '00000000-0000-0000-0000-000000008131')$$,
  '%permission denied%',
  'anon cannot INSERT into class_bookings (no table-level grant at all)'
);

select throws_like(
  $$update class_bookings set member_id = '00000000-0000-0000-0000-000000008132' where id = '00000000-0000-0000-0000-000000008161'$$,
  '%permission denied%',
  'anon cannot UPDATE class_bookings (no table-level grant at all)'
);

select throws_like(
  $$delete from class_bookings where id = '00000000-0000-0000-0000-000000008161'$$,
  '%permission denied%',
  'anon cannot DELETE from class_bookings (no table-level grant at all)'
);

reset role;

-- ============================================================================
-- A member can SELECT only their own class_bookings rows, never another
-- member's.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008111","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from class_bookings where id = '00000000-0000-0000-0000-000000008161'),
  1,
  'Member A can SELECT their own class_bookings row'
);

select is(
  (select count(*)::int from class_bookings where id = '00000000-0000-0000-0000-000000008162'),
  0,
  'Member A cannot SELECT Member B''s class_bookings row'
);

reset role;

-- ============================================================================
-- A Receptionist/Manager/Owner can SELECT all of their own gym's
-- class_bookings, but a cross-gym staff session sees none.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008111","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from class_bookings where gym_id = '00000000-0000-0000-0000-000000008111'),
  2,
  'a same-gym receptionist can SELECT all of their gym''s class_bookings rows'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008112","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from class_bookings where gym_id = '00000000-0000-0000-0000-000000008111'),
  0,
  'a cross-gym receptionist sees zero of Gym A''s class_bookings rows'
);

reset role;

-- ============================================================================
-- Review fix: gym_staff_read_own_class_bookings deliberately excludes
-- `coach` (docs/decisions.md's RLS-bug-fix entry) -- the class's own coach,
-- same gym, gets zero rows. Previously only exercised indirectly (coach
-- seeded as classes.coach_id, never authenticated-as); this is the first
-- assertion that actually authenticates as the coach.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008111","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from class_bookings where gym_id = '00000000-0000-0000-0000-000000008111'),
  0,
  'a same-gym coach (even the class''s own coach) sees zero class_bookings rows -- deliberately excluded from gym_staff_read_own_class_bookings'
);

reset role;

select * from finish();
rollback;
