-- Story 12.3: Class Attendance Marking. Tests mark_class_attendance()
-- (0068_class_attendance_marking.sql) -- a SECURITY DEFINER RPC, not raw
-- RLS-gated UPDATE, so most assertions call the function directly under a
-- simulated session. Fixture/session-simulation conventions match
-- class_booking_with_capacity_enforcement.test.sql (`set local role
-- authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded
-- up front as postgres, `reset role` before asserting on committed table
-- state).

begin;
select plan(22);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008201', 'Class Attendance Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000008211', 'Class Attendance Gym A', '00000000-0000-0000-0000-000000008201'),
  ('00000000-0000-0000-0000-000000008212', 'Class Attendance Gym B', '00000000-0000-0000-0000-000000008201');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008221'), -- Gym A: coach (class owner)
  ('00000000-0000-0000-0000-000000008222'), -- Gym A: active member (booking a)
  ('00000000-0000-0000-0000-000000008223'), -- Gym A: expiring_soon member (booking b)
  ('00000000-0000-0000-0000-000000008224'), -- Gym A: grace_period member (booking c)
  ('00000000-0000-0000-0000-000000008225'), -- Gym A: expired member (booking d)
  ('00000000-0000-0000-0000-000000008226'), -- Gym A: zero-subscription member (booking e)
  ('00000000-0000-0000-0000-000000008227'), -- Gym A: re-mark member (booking f)
  ('00000000-0000-0000-0000-000000008228'), -- Gym A: receptionist (acting staff)
  ('00000000-0000-0000-0000-000000008229'), -- Gym A: manager (role-check acceptance)
  ('00000000-0000-0000-0000-000000008230'), -- Gym A: supervisor (role-check acceptance + AC #1 widened RLS)
  ('00000000-0000-0000-0000-000000008231'), -- Gym A: owner (role-check acceptance)
  ('00000000-0000-0000-0000-000000008232'), -- Gym A: coach (role-check rejection)
  ('00000000-0000-0000-0000-000000008233'), -- Gym A: member (role-check rejection)
  ('00000000-0000-0000-0000-000000008234'); -- Gym B: receptionist (cross-gym not-found)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008241', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008221', 'coach', 'Class Attendance Gym A Coach'),
  ('00000000-0000-0000-0000-000000008242', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008222', 'member', 'Class Attendance Active Member'),
  ('00000000-0000-0000-0000-000000008243', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008223', 'member', 'Class Attendance Expiring-Soon Member'),
  ('00000000-0000-0000-0000-000000008244', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008224', 'member', 'Class Attendance Grace-Period Member'),
  ('00000000-0000-0000-0000-000000008245', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008225', 'member', 'Class Attendance Expired Member'),
  ('00000000-0000-0000-0000-000000008246', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008226', 'member', 'Class Attendance No-Subscription Member'),
  ('00000000-0000-0000-0000-000000008247', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008227', 'member', 'Class Attendance Re-Mark Member'),
  ('00000000-0000-0000-0000-000000008248', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008228', 'receptionist', 'Class Attendance Receptionist'),
  ('00000000-0000-0000-0000-000000008249', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008229', 'manager', 'Class Attendance Manager'),
  ('00000000-0000-0000-0000-000000008250', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008230', 'supervisor', 'Class Attendance Supervisor'),
  ('00000000-0000-0000-0000-000000008251', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008231', 'owner', 'Class Attendance Owner'),
  ('00000000-0000-0000-0000-000000008252', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008232', 'coach', 'Class Attendance Role-Check Coach'),
  ('00000000-0000-0000-0000-000000008253', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008233', 'member', 'Class Attendance Role-Check Member'),
  ('00000000-0000-0000-0000-000000008254', '00000000-0000-0000-0000-000000008212', '00000000-0000-0000-0000-000000008234', 'receptionist', 'Class Attendance Gym B Receptionist');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000008261', '00000000-0000-0000-0000-000000008211', 'Class Attendance Gym A Monthly', 'monthly', 15000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000008271', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008242', '00000000-0000-0000-0000-000000008261', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008272', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008243', '00000000-0000-0000-0000-000000008261', 'expiring_soon', current_date - 25, current_date + 5),
  ('00000000-0000-0000-0000-000000008273', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008244', '00000000-0000-0000-0000-000000008261', 'grace_period', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000008274', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008245', '00000000-0000-0000-0000-000000008261', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000008275', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008247', '00000000-0000-0000-0000-000000008261', 'active', current_date, current_date + 30);

-- No-Subscription Member (8246): deliberately zero subscription rows,
-- exercising the null-status branch.

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000008291', '00000000-0000-0000-0000-000000008211', 'Attendance Test Class', '00000000-0000-0000-0000-000000008241', 10, 'one_off', now() + interval '3 days');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-000000008291', now() + interval '3 days');

insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000000082b1', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008242'), -- booking a: active
  ('00000000-0000-0000-0000-0000000082b2', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008243'), -- booking b: expiring_soon
  ('00000000-0000-0000-0000-0000000082b3', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008244'), -- booking c: grace_period
  ('00000000-0000-0000-0000-0000000082b4', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008245'), -- booking d: expired
  ('00000000-0000-0000-0000-0000000082b5', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008246'), -- booking e: zero-subscription
  ('00000000-0000-0000-0000-0000000082b6', '00000000-0000-0000-0000-000000008211', '00000000-0000-0000-0000-0000000082a1', '00000000-0000-0000-0000-000000008247'); -- booking f: active, used for re-mark idempotency

-- ============================================================================
-- (a) AC #2: an active member's booking can be marked attended -- returns
-- the updated row with attended_at set.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000082b1')),
  null,
  'marking an active member''s booking attended returns a row with attended_at set'
);

reset role;

select isnt(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-0000000082b1'),
  null,
  'the active member''s booking has attended_at persisted'
);

-- ============================================================================
-- (b) AC #3: expiring_soon and grace_period members can also be marked
-- attended -- proves the broader check_in()-style eligibility rule, not a
-- stricter active-only filter.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000082b2')),
  null,
  'an expiring_soon member''s booking can be marked attended'
);

select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000082b3')),
  null,
  'a grace_period member''s booking can be marked attended'
);

reset role;

-- ============================================================================
-- (c) AC #3/#4: an expired-status member's booking is rejected -- returns
-- null, attended_at stays unset, and exactly one 'expired' front_desk_alerts
-- row is inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select is(
  (select mark_class_attendance('00000000-0000-0000-0000-0000000082b4')),
  null,
  'marking an expired-status member''s booking returns null'
);

reset role;

select is(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-0000000082b4'),
  null,
  'the expired member''s booking has attended_at left unchanged (still null)'
);

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000008245' and status = 'expired'),
  1,
  'exactly one expired front_desk_alerts row was inserted for the rejected expired-status member'
);

-- ============================================================================
-- (d) A zero-subscription member's booking is rejected the same way as
-- expired (null v_status maps to an 'expired' alert).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select is(
  (select mark_class_attendance('00000000-0000-0000-0000-0000000082b5')),
  null,
  'marking a zero-subscription member''s booking returns null, same as expired'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000008246' and status = 'expired'),
  1,
  'a zero-subscription member''s rejection also inserts an expired front_desk_alerts row'
);

-- ============================================================================
-- (e) A second attempt on the same already-alerted expired member does not
-- insert a duplicate alert -- the existing on-conflict dedup, same as
-- check_in().
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select is(
  (select mark_class_attendance('00000000-0000-0000-0000-0000000082b4')),
  null,
  'a repeated attempt on the same already-alerted expired member still returns null'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000008245' and status = 'expired'),
  1,
  'a repeated attempt does not insert a duplicate front_desk_alerts row (on-conflict dedup)'
);

-- ============================================================================
-- (f) AC #2 scope note: re-marking an already-attended booking is idempotent
-- -- no error, attended_at updates to a new timestamp.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b6')$$,
  'the first mark-attendance call on booking f succeeds'
);

reset role;

-- Review fix: `now()` is transaction-scoped in Postgres (constant across
-- this whole pgTAP file's single wrapping transaction), so comparing
-- attended_at before/after the second call can never actually distinguish
-- "the update ran again" from "it was a no-op" -- both would show the same
-- timestamp regardless. Instead, force attended_at to a distinguishable
-- sentinel value between the two calls (as postgres, bypassing RLS/the
-- RPC) and assert the second mark-attendance call overwrites it -- a
-- regression that silently no-ops re-marking (e.g. an accidental
-- `where attended_at is null` guard) would leave the sentinel in place and
-- fail this assertion.
update class_bookings set attended_at = '2000-01-01T00:00:00Z'
where id = '00000000-0000-0000-0000-0000000082b6';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b6')$$,
  're-marking an already-attended booking is idempotent, no error raised'
);

reset role;

select isnt(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-0000000082b6'),
  '2000-01-01T00:00:00Z'::timestamptz,
  're-marking an already-attended booking actually re-writes attended_at, not a silent no-op'
);

-- ============================================================================
-- (g) Marking a nonexistent booking id is rejected (not-found).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select mark_class_attendance('00000000-0000-0000-0000-000000009999')$$,
  '%not found%',
  'marking a nonexistent booking id is rejected as not-found'
);

reset role;

-- ============================================================================
-- (h) A cross-gym booking id is rejected with the same not-found message --
-- a Gym B session attempting to mark a Gym A booking.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008234","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008212","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  '%not found%',
  'a cross-gym booking id is rejected as not-found, same message as a nonexistent id'
);

reset role;

-- ============================================================================
-- (i) Role check: coach and member sessions cannot call
-- mark_class_attendance() at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008232","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"coach"}',
  true
);

select throws_like(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  '%permission denied%',
  'a coach-role session cannot call mark_class_attendance()'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008233","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"member"}',
  true
);

select throws_like(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  '%permission denied%',
  'a member-role session cannot call mark_class_attendance()'
);

reset role;

-- ============================================================================
-- (j) Role check: Manager, Supervisor, and Owner sessions can all call
-- mark_class_attendance() successfully -- Receptionist already proven above
-- (assertion (a)).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008229","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"manager"}',
  true
);

select lives_ok(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  'a Manager session can call mark_class_attendance()'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008230","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  'a Supervisor session can call mark_class_attendance() -- proves the widened role check'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008231","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008211","app_role":"owner"}',
  true
);

select lives_ok(
  $$select mark_class_attendance('00000000-0000-0000-0000-0000000082b1')$$,
  'an Owner session can call mark_class_attendance()'
);

reset role;

-- ============================================================================
-- (k) AC #4: class attendance never writes to attendance_events -- zero rows
-- exist for any of this suite's fixture members throughout the whole run.
-- ============================================================================
select is(
  (select count(*)::int from attendance_events where member_id in (
    '00000000-0000-0000-0000-000000008242',
    '00000000-0000-0000-0000-000000008243',
    '00000000-0000-0000-0000-000000008244',
    '00000000-0000-0000-0000-000000008245',
    '00000000-0000-0000-0000-000000008246',
    '00000000-0000-0000-0000-000000008247'
  )),
  0,
  'mark_class_attendance() never writes to attendance_events, regardless of accept/reject outcome'
);

select * from finish();
rollback;
