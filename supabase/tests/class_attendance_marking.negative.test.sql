-- Story 12.3: Class Attendance Marking negative coverage. Two things this
-- migration touches at the table level (not exercised by
-- mark_class_attendance() itself): (1) attended_at still has no direct
-- write path for authenticated/anon -- class_bookings' zero-UPDATE-policy
-- contract from Story 12.2 is unchanged, only a column was added; (2) the
-- widened gym_staff_read_own_class_bookings policy now lets a Supervisor
-- SELECT their own gym's rows, but a cross-gym Supervisor still sees none.
-- Kept as its own file rather than extended into
-- class_booking_with_capacity_enforcement.negative.test.sql -- that file's
-- own fixtures/plan already close over Story 12.2's role set; this story's
-- Supervisor-specific coverage reads more naturally scoped to its own
-- migration's fixtures.

begin;
select plan(7);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008301', 'Class Attendance Negative Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000008311', 'Class Attendance Negative Test Gym A', '00000000-0000-0000-0000-000000008301'),
  ('00000000-0000-0000-0000-000000008312', 'Class Attendance Negative Test Gym B', '00000000-0000-0000-0000-000000008301');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008321'), -- Gym A: coach (class owner)
  ('00000000-0000-0000-0000-000000008322'), -- Gym A: member (booking owner)
  ('00000000-0000-0000-0000-000000008323'), -- Gym A: receptionist (direct-UPDATE attempt)
  ('00000000-0000-0000-0000-000000008324'), -- Gym A: supervisor (widened-RLS SELECT)
  ('00000000-0000-0000-0000-000000008325'), -- Gym B: supervisor (cross-gym SELECT denial)
  ('00000000-0000-0000-0000-000000008326'), -- Gym A: owner (direct-UPDATE attempt, review fix)
  ('00000000-0000-0000-0000-000000008327'); -- Gym A: manager (direct-UPDATE attempt, review fix)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008331', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008321', 'coach', 'Negative Test Coach'),
  ('00000000-0000-0000-0000-000000008332', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008322', 'member', 'Negative Test Member'),
  ('00000000-0000-0000-0000-000000008333', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008323', 'receptionist', 'Negative Test Receptionist'),
  ('00000000-0000-0000-0000-000000008334', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008324', 'supervisor', 'Negative Test Supervisor'),
  ('00000000-0000-0000-0000-000000008335', '00000000-0000-0000-0000-000000008312', '00000000-0000-0000-0000-000000008325', 'supervisor', 'Negative Test Cross-Gym Supervisor'),
  ('00000000-0000-0000-0000-000000008336', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008326', 'owner', 'Negative Test Owner'),
  ('00000000-0000-0000-0000-000000008337', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008327', 'manager', 'Negative Test Manager');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000008341', '00000000-0000-0000-0000-000000008311', 'Negative Test Attendance Class', '00000000-0000-0000-0000-000000008331', 5, 'one_off', now() + interval '1 day');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000008351', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008341', now() + interval '1 day');

insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-000000008361', '00000000-0000-0000-0000-000000008311', '00000000-0000-0000-0000-000000008351', '00000000-0000-0000-0000-000000008332');

-- ============================================================================
-- No authenticated session -- not even a Receptionist -- can directly
-- UPDATE class_bookings.attended_at. class_bookings has zero UPDATE
-- policies for authenticated (Story 12.2); adding the column did not add
-- one.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008311","app_role":"receptionist"}',
  true
);

with attempted as (
  update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000008361'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session cannot directly UPDATE class_bookings.attended_at -- 0 rows affected, no write policy exists'
);

reset role;

-- ============================================================================
-- Review fix: the RPC's role check was proven for owner/manager/supervisor
-- (pgTAP class_attendance_marking.test.sql, assertion set (j)), but the
-- table-level zero-UPDATE-policy contract was only ever independently
-- proven for receptionist/anon above -- owner/manager were only ever
-- exercised through the RPC path. Prove they're equally blocked from a
-- direct UPDATE, so a future migration accidentally scoping a permissive
-- UPDATE policy to just one role wouldn't slip past either test file.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008326","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008311","app_role":"owner"}',
  true
);

with attempted as (
  update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000008361'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session cannot directly UPDATE class_bookings.attended_at -- 0 rows affected, no write policy exists'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008327","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008311","app_role":"manager"}',
  true
);

with attempted as (
  update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000008361'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a manager-claim session cannot directly UPDATE class_bookings.attended_at -- 0 rows affected, no write policy exists'
);

reset role;

set local role anon;

select throws_like(
  $$update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000008361'$$,
  '%permission denied%',
  'anon cannot UPDATE class_bookings.attended_at (no table-level grant at all)'
);

reset role;

select is(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-000000008361'),
  null,
  'attended_at remains unset after every direct-write attempt was blocked'
);

-- ============================================================================
-- AC #1 proof: a Supervisor session can now SELECT class_bookings rows for
-- their own gym -- the RLS widening this migration adds.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008311","app_role":"supervisor"}',
  true
);

select is(
  (select count(*)::int from class_bookings where id = '00000000-0000-0000-0000-000000008361'),
  1,
  'a same-gym Supervisor can now SELECT class_bookings rows -- proves the widened gym_staff_read_own_class_bookings policy'
);

reset role;

-- ============================================================================
-- A cross-gym Supervisor session still sees none -- the widening is
-- gym-scoped, not role-only.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008312","app_role":"supervisor"}',
  true
);

select is(
  (select count(*)::int from class_bookings where id = '00000000-0000-0000-0000-000000008361'),
  0,
  'a cross-gym Supervisor sees zero of Gym A''s class_bookings rows'
);

reset role;

select * from finish();
rollback;
