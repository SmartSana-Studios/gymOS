-- Story 12.2: Class Booking with Capacity Enforcement. Tests
-- book_class_session()/cancel_class_booking()
-- (0058_class_booking_with_capacity_enforcement.sql) -- both SECURITY
-- DEFINER RPCs, not raw RLS-gated INSERT/DELETE, so most assertions call
-- the functions directly under a simulated session. Fixture/session-
-- simulation conventions match check_in_one_open_session_enforcement.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`,
-- fixtures seeded up front as postgres, `reset role` before asserting on
-- committed table state).
--
-- Capacity-boundary coverage uses a dedicated capacity-1 class/session
-- (`Full Test Class` / session f1) rather than the general-purpose
-- capacity-10 class/session (a1) used for eligibility/cutoff/role coverage
-- -- keeps the "at capacity rejects, one below accepts" boundary proof
-- isolated from the headcount of unrelated assertions sharing a1.

begin;
select plan(45);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008001', 'Class Booking Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000008011', 'Class Booking Gym A', '00000000-0000-0000-0000-000000008001'),
  ('00000000-0000-0000-0000-000000008012', 'Class Booking Gym B', '00000000-0000-0000-0000-000000008001'),
  -- Review fix: Gym C carries a non-default cancellation cutoff (set below,
  -- after this insert relies on the column's 120-minute default), proving
  -- cancel_class_booking() reads gyms.class_booking_cancellation_cutoff_minutes
  -- dynamically rather than coincidentally matching a hardcoded value.
  ('00000000-0000-0000-0000-000000008013', 'Class Booking Gym C (Custom Cutoff)', '00000000-0000-0000-0000-000000008001');

update gyms set class_booking_cancellation_cutoff_minutes = 30 where id = '00000000-0000-0000-0000-000000008013';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008021'), -- Gym A: coach (class owner)
  ('00000000-0000-0000-0000-000000008022'), -- Gym A: active member #1
  ('00000000-0000-0000-0000-000000008023'), -- Gym A: active member #2 (Full Test Class pre-fill)
  ('00000000-0000-0000-0000-000000008024'), -- Gym A: active member #3
  ('00000000-0000-0000-0000-000000008025'), -- Gym A: expired-subscription member
  ('00000000-0000-0000-0000-000000008026'), -- Gym A: zero-subscription member
  ('00000000-0000-0000-0000-000000008027'), -- Gym A: expiring_soon-subscription member
  ('00000000-0000-0000-0000-000000008028'), -- Gym A: grace_period-subscription member
  ('00000000-0000-0000-0000-000000008029'), -- Gym A: receptionist (role-check rejection)
  ('00000000-0000-0000-0000-000000008030'), -- Gym A: manager (role-check rejection)
  ('00000000-0000-0000-0000-000000008031'), -- Gym A: owner (role-check rejection)
  ('00000000-0000-0000-0000-000000008032'), -- Gym B: member (cross-gym session-booking attempt)
  ('00000000-0000-0000-0000-000000008033'), -- Gym A: before-cutoff canceller
  ('00000000-0000-0000-0000-000000008034'), -- Gym A: after-cutoff-attempt member
  ('00000000-0000-0000-0000-000000008035'), -- Gym A: the freed-spot rebooker
  ('00000000-0000-0000-0000-000000008036'), -- Gym A: another-member's-booking canceller (rejected)
  ('00000000-0000-0000-0000-000000008037'), -- Gym B: coach (Gym B class owner)
  ('00000000-0000-0000-0000-000000008038'), -- Gym C: active member (non-default-cutoff coverage)
  ('00000000-0000-0000-0000-000000008039'); -- Gym C: coach (Gym C class owner)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008041', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', 'coach', 'Class Booking Gym A Coach'),
  ('00000000-0000-0000-0000-000000008042', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008022', 'member', 'Class Booking Gym A Active Member 1'),
  ('00000000-0000-0000-0000-000000008043', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008023', 'member', 'Class Booking Gym A Active Member 2'),
  ('00000000-0000-0000-0000-000000008044', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008024', 'member', 'Class Booking Gym A Active Member 3'),
  ('00000000-0000-0000-0000-000000008045', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008025', 'member', 'Class Booking Gym A Expired Member'),
  ('00000000-0000-0000-0000-000000008046', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008026', 'member', 'Class Booking Gym A No-Subscription Member'),
  ('00000000-0000-0000-0000-000000008047', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008027', 'member', 'Class Booking Gym A Expiring-Soon Member'),
  ('00000000-0000-0000-0000-000000008048', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008028', 'member', 'Class Booking Gym A Grace-Period Member'),
  ('00000000-0000-0000-0000-000000008049', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008029', 'receptionist', 'Class Booking Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000008050', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008030', 'manager', 'Class Booking Gym A Manager'),
  ('00000000-0000-0000-0000-000000008051', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008031', 'owner', 'Class Booking Gym A Owner'),
  ('00000000-0000-0000-0000-000000008052', '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008032', 'member', 'Class Booking Gym B Member'),
  ('00000000-0000-0000-0000-000000008053', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008033', 'member', 'Class Booking Gym A Before-Cutoff Canceller'),
  ('00000000-0000-0000-0000-000000008054', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008034', 'member', 'Class Booking Gym A After-Cutoff Member'),
  ('00000000-0000-0000-0000-000000008055', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008035', 'member', 'Class Booking Gym A Freed-Spot Rebooker'),
  ('00000000-0000-0000-0000-000000008056', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008036', 'member', 'Class Booking Gym A Other-Member Canceller'),
  ('00000000-0000-0000-0000-000000008057', '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008037', 'coach', 'Class Booking Gym B Coach'),
  ('00000000-0000-0000-0000-000000008058', '00000000-0000-0000-0000-000000008013', '00000000-0000-0000-0000-000000008038', 'member', 'Class Booking Gym C Member'),
  ('00000000-0000-0000-0000-000000008059', '00000000-0000-0000-0000-000000008013', '00000000-0000-0000-0000-000000008039', 'coach', 'Class Booking Gym C Coach');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000008061', '00000000-0000-0000-0000-000000008011', 'Class Booking Gym A Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000008062', '00000000-0000-0000-0000-000000008012', 'Class Booking Gym B Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000008064', '00000000-0000-0000-0000-000000008013', 'Class Booking Gym C Monthly', 'monthly', 15000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000008071', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008042', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008072', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008043', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008073', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008044', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008074', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008045', '00000000-0000-0000-0000-000000008061', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000008075', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008047', '00000000-0000-0000-0000-000000008061', 'expiring_soon', current_date - 25, current_date + 5),
  ('00000000-0000-0000-0000-000000008076', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008048', '00000000-0000-0000-0000-000000008061', 'grace_period', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000008077', '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008052', '00000000-0000-0000-0000-000000008062', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008078', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008053', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008079', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008054', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008080', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008055', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008081', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008056', '00000000-0000-0000-0000-000000008061', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000008083', '00000000-0000-0000-0000-000000008013', '00000000-0000-0000-0000-000000008058', '00000000-0000-0000-0000-000000008064', 'active', current_date, current_date + 30);

-- No-Subscription Member (8046): deliberately zero subscription rows,
-- exercising the null-status branch.

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000008091', '00000000-0000-0000-0000-000000008011', 'Booking Test Class', '00000000-0000-0000-0000-000000008041', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000008092', '00000000-0000-0000-0000-000000008012', 'Gym B Booking Test Class', '00000000-0000-0000-0000-000000008057', 5, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000008093', '00000000-0000-0000-0000-000000008011', 'Full Test Class', '00000000-0000-0000-0000-000000008041', 1, 'one_off', now() + interval '3 days'),
  -- Review fix fixtures: reschedule-guard coverage (blocked/allowed) and the
  -- non-default-cutoff class (Gym C).
  ('00000000-0000-0000-0000-000000008094', '00000000-0000-0000-0000-000000008011', 'Reschedule Blocked Test Class', '00000000-0000-0000-0000-000000008041', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000008095', '00000000-0000-0000-0000-000000008011', 'Reschedule Allowed Test Class', '00000000-0000-0000-0000-000000008041', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000008096', '00000000-0000-0000-0000-000000008013', 'Gym C Cutoff Test Class', '00000000-0000-0000-0000-000000008059', 10, 'one_off', now() + interval '3 days');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-0000000080a1', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008091', now() + interval '3 days'),  -- general-purpose session (eligibility/role/before-cutoff coverage)
  ('00000000-0000-0000-0000-0000000080a3', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008091', now() - interval '1 day'),   -- past session
  ('00000000-0000-0000-0000-0000000080a4', '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008092', now() + interval '3 days'),  -- Gym B session (cross-gym)
  ('00000000-0000-0000-0000-0000000080a5', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008091', now() + interval '1 hour'),  -- cutoff-boundary session (inside the 120-minute default cutoff)
  ('00000000-0000-0000-0000-0000000080a6', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008093', now() + interval '3 days'),  -- capacity-1 session (boundary test)
  -- Review fix fixtures:
  ('00000000-0000-0000-0000-0000000080a7', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008091', now() + interval '120 minutes'), -- exact cutoff-boundary session (now = scheduled_at - cutoff)
  ('00000000-0000-0000-0000-0000000080a8', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008094', now() + interval '3 days'),      -- reschedule-blocked session (pre-booked below)
  ('00000000-0000-0000-0000-0000000080aa', '00000000-0000-0000-0000-000000008013', '00000000-0000-0000-0000-000000008096', now() + interval '45 minutes');  -- Gym C session: outside its own 30-minute cutoff, inside the 120-minute default

-- Pre-fills the capacity-1 session to exactly capacity (1/1). Also
-- pre-books the reschedule-blocked session (a8) so materialize_class_sessions
-- /update_class()'s reschedule guard has something to block on.
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000000080b1', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-0000000080a6', '00000000-0000-0000-0000-000000008043'),
  ('00000000-0000-0000-0000-0000000080b2', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-0000000080a8', '00000000-0000-0000-0000-000000008042');

-- ============================================================================
-- (a) AC #1/#2: an active member books an under-capacity session -- succeeds.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'an active member can book an under-capacity session'
);

reset role;

select is(
  (select count(*)::int from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a1' and member_id = '00000000-0000-0000-0000-000000008042'),
  1,
  'exactly one class_bookings row exists for the active member''s booking'
);

-- ============================================================================
-- (b) A member cannot double-book the same session -- friendly pre-check
-- message, no second row inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%already booked this session%',
  'a member cannot double-book the same session (friendly pre-check message)'
);

reset role;

select is(
  (select count(*)::int from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a1' and member_id = '00000000-0000-0000-0000-000000008042'),
  1,
  'no second row was inserted for the attempted double-booking'
);

-- ============================================================================
-- (b2) The unique index itself rejects a forced duplicate insert at the raw
-- SQL level, independent of the RPC's own pre-check.
-- ============================================================================
select throws_like(
  $$insert into class_bookings (gym_id, class_session_id, member_id)
    values ('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-0000000080a1', '00000000-0000-0000-0000-000000008042')$$,
  '%idx_class_bookings_session_member%',
  'the unique index rejects a forced duplicate class_bookings row at the raw SQL level'
);

-- ============================================================================
-- (c) AC #2: booking a session already at capacity (1/1) is rejected --
-- "class is full" -- and no second row is inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a6')$$,
  '%class is full%',
  'booking a session already at capacity is rejected'
);

reset role;

select is(
  (select count(*)::int from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a6'),
  1,
  'the at-capacity session still has exactly 1 booking after the rejected attempt'
);

-- ============================================================================
-- (d) One below capacity accepts: cancel the capacity-1 session's only
-- booking, then a different member successfully books it (proves the
-- boundary is capacity-exclusive, not off-by-one).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select cancel_class_booking('00000000-0000-0000-0000-0000000080b1')$$,
  'cancelling the capacity-1 session''s only booking frees the spot'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a6')$$,
  'a session one below capacity accepts a new booking'
);

reset role;

select is(
  (select count(*)::int from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a6'),
  1,
  'the session is back to exactly 1 booking after the free-then-rebook sequence'
);

-- ============================================================================
-- (e) A member with an expired subscription cannot book.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%no active subscription%',
  'a member with an expired subscription cannot book'
);

reset role;

-- ============================================================================
-- (f) A member with zero subscription rows cannot book -- same rejection as
-- expired.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%no active subscription%',
  'a member with zero subscription rows cannot book, same as expired'
);

reset role;

-- ============================================================================
-- (g) AC #1: an expiring_soon member CAN book -- proves the broader
-- check_in()-style eligibility rule, not just the rejection half.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'a member with an expiring_soon subscription can book'
);

reset role;

-- ============================================================================
-- (h) AC #1: a grace_period member CAN book.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008028","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'a member with a grace_period subscription can book'
);

reset role;

-- ============================================================================
-- (i) A Receptionist/Manager/Owner cannot call book_class_session() at all
-- (role check, not RLS -- these RPCs have no role-conditional RLS to fall
-- back on).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008029","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%caller is not a member%',
  'a receptionist-claim session cannot call book_class_session()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008030","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"manager"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%caller is not a member%',
  'a manager-claim session cannot call book_class_session()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  '%caller is not a member%',
  'an owner-claim session cannot call book_class_session()'
);

reset role;

-- ============================================================================
-- (j) Booking a past session is rejected.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a3')$$,
  '%already started or passed%',
  'booking a session that has already started or passed is rejected'
);

reset role;

-- ============================================================================
-- (k) Booking a cross-gym session is rejected (uniform not-found).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a4')$$,
  '%not found%',
  'a Gym A member-claim session cannot book a Gym B session (uniform not-found)'
);

reset role;

-- ============================================================================
-- Cancellation coverage. Gym A's default cutoff is 120 minutes.
-- ============================================================================

-- (l) Before-cutoff cancel succeeds and the freed spot becomes immediately
-- bookable by another member. Session a1 (now + 3 days) is well outside the
-- 120-minute cutoff.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008033","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'setup: the before-cutoff canceller books session a1'
);

reset role;

create temp table booking_l as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a1' and member_id = '00000000-0000-0000-0000-000000008053';
-- Owned by postgres (created under `reset role` above); the upcoming
-- role-switched RPC calls below read from it via a subselect, so it needs
-- an explicit grant -- table ownership does not transfer with `set local role`.
grant select on booking_l to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008033","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select cancel_class_booking((select id from booking_l))$$,
  'cancelling a booking well before the cutoff succeeds'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008035","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'the freed spot from the cancelled booking is immediately bookable by another member'
);

reset role;

select is(
  (select count(*)::int from class_bookings where id = (select id from booking_l)),
  0,
  'the cancelled booking row no longer exists'
);

drop table booking_l;

-- (m) After-cutoff cancel is rejected -- session a5 is 1 hour out, inside
-- the 120-minute (2-hour) cutoff.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008034","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a5')$$,
  'setup: the after-cutoff member books session a5 (1 hour out)'
);

reset role;

create temp table booking_m as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a5' and member_id = '00000000-0000-0000-0000-000000008054';
grant select on booking_m to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008034","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select cancel_class_booking((select id from booking_m))$$,
  '%cancellation cutoff has passed%',
  'cancelling a booking past the cutoff (session 1 hour out, 120-minute cutoff) is rejected'
);

reset role;

select is(
  (select count(*)::int from class_bookings where id = (select id from booking_m)),
  1,
  'the booking still exists after the rejected after-cutoff cancel attempt'
);

drop table booking_m;

-- (n) Cancelling a nonexistent booking id is rejected (not-found).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select cancel_class_booking('00000000-0000-0000-0000-000000009999')$$,
  '%not found%',
  'cancelling a nonexistent booking id is rejected (not-found)'
);

reset role;

-- (o) Cancelling another member's booking is rejected -- same not-found
-- message, proving the collapsed-error convention holds.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a1')$$,
  'setup: another member books session a1 (target for the other-member-cancel test)'
);

reset role;

create temp table booking_o as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a1' and member_id = '00000000-0000-0000-0000-000000008044';
grant select on booking_o to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008036","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select cancel_class_booking((select id from booking_o))$$,
  '%not found%',
  'cancelling another member''s booking is rejected (not-found, same message as a nonexistent id)'
);

reset role;

select is(
  (select count(*)::int from class_bookings where id = (select id from booking_o)),
  1,
  'another member''s booking still exists after the rejected cancel attempt'
);

-- (p) Cancelling an already-cancelled booking is rejected (not-found, no
-- double-delete issue).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select cancel_class_booking((select id from booking_o))$$,
  'the booking''s own owner can cancel it (before-cutoff, sets up the already-cancelled case)'
);

select throws_like(
  $$select cancel_class_booking((select id from booking_o))$$,
  '%not found%',
  'cancelling an already-cancelled booking is rejected (not-found)'
);

reset role;

drop table booking_o;

-- ============================================================================
-- (q) Review fix: exact cancellation-cutoff boundary. Session a7 is
-- scheduled at exactly now() + 120 minutes (Gym A's default cutoff) --
-- `now() >= scheduled_at - cutoff` evaluates to `now() >= now()`, true, so
-- the cancellation must be rejected exactly at the boundary, not just
-- clearly-before/clearly-after (Dev Notes Testing Requirements, priority #3).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a7')$$,
  'setup: a member books the exact-cutoff-boundary session (now + 120 minutes)'
);

reset role;

create temp table booking_q as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a7' and member_id = '00000000-0000-0000-0000-000000008042';
grant select on booking_q to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select cancel_class_booking((select id from booking_q))$$,
  '%cancellation cutoff has passed%',
  'cancelling exactly at the cutoff boundary (now = scheduled_at - cutoff) is rejected -- the inclusive >= comparison'
);

reset role;

select is(
  (select count(*)::int from class_bookings where id = (select id from booking_q)),
  1,
  'the booking still exists after the rejected exact-boundary cancel attempt'
);

drop table booking_q;

-- ============================================================================
-- (r) Review fix: booking a truly nonexistent class_session_id (not just a
-- cross-gym one) is rejected -- Dev Notes asked for nonexistent-id/
-- wrong-gym/wrong-member to each be tested separately even though they
-- share one error message.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select book_class_session('00000000-0000-0000-0000-000000009997')$$,
  '%not found%',
  'booking a class_session_id that does not exist at all (not merely cross-gym) is rejected'
);

reset role;

-- ============================================================================
-- (s) Review fix: cancelling a real booking that belongs to a different gym
-- is rejected -- cancel_class_booking()'s not-found lookup collapses
-- nonexistent/wrong-gym/wrong-member into one message; wrong-gym specifically
-- was previously untested (only nonexistent-id and wrong-member were).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008012","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080a4')$$,
  'setup: the Gym B member books their own Gym B session (a4)'
);

reset role;

create temp table booking_s as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080a4' and member_id = '00000000-0000-0000-0000-000000008052';
grant select on booking_s to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select cancel_class_booking((select id from booking_s))$$,
  '%not found%',
  'a Gym A member cannot cancel a real booking that belongs to Gym B (wrong-gym not-found mode)'
);

reset role;

select is(
  (select count(*)::int from class_bookings where id = (select id from booking_s)),
  1,
  'the Gym B booking still exists after the rejected cross-gym cancel attempt'
);

drop table booking_s;

-- ============================================================================
-- (t) Review fix: cancel_class_booking() reads
-- gyms.class_booking_cancellation_cutoff_minutes dynamically. Gym C's
-- cutoff is 30 minutes (not the 120-minute default); session aa is 45
-- minutes out -- outside Gym C's 30-minute cutoff (so cancellable) but
-- would be inside the 120-minute default (so this would fail if the
-- function read a hardcoded 120 instead of the gym's own column).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008038","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008013","app_role":"member"}',
  true
);

select lives_ok(
  $$select book_class_session('00000000-0000-0000-0000-0000000080aa')$$,
  'setup: the Gym C member books their own session (45 minutes out)'
);

reset role;

create temp table booking_t as
select id from class_bookings where class_session_id = '00000000-0000-0000-0000-0000000080aa' and member_id = '00000000-0000-0000-0000-000000008058';
grant select on booking_t to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008038","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008013","app_role":"member"}',
  true
);

select lives_ok(
  $$select cancel_class_booking((select id from booking_t))$$,
  'cancelling 45 minutes before the session succeeds under Gym C''s 30-minute cutoff (proves the cutoff column is read dynamically, not hardcoded to the 120-minute default)'
);

reset role;

drop table booking_t;

-- ============================================================================
-- (u) Review fix: materialize_class_sessions(p_reschedule => true) is
-- blocked with a friendly exception when a future session has bookings,
-- instead of the unhandled FK-violation error the unguarded delete would
-- raise. Class 8094's only future session (a8) is pre-booked above.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select throws_like(
  $$select materialize_class_sessions('00000000-0000-0000-0000-000000008094', true)$$,
  '%cannot reschedule%existing bookings%',
  'rescheduling a class with a booked future session is blocked with a friendly exception'
);

reset role;

select is(
  (select count(*)::int from class_sessions where id = '00000000-0000-0000-0000-0000000080a8'),
  1,
  'the booked future session was not deleted by the blocked reschedule attempt'
);

-- ============================================================================
-- (v) Reschedule succeeds normally when no future session has bookings.
-- Class 8095 has zero class_sessions rows pre-inserted -- the reschedule
-- delete finds nothing, and re-materialization creates the one new session.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select materialize_class_sessions('00000000-0000-0000-0000-000000008095', true)$$,
  'rescheduling a class with no booked future sessions succeeds normally'
);

reset role;

select is(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0000-000000008095'),
  1,
  'the unbooked class was re-materialized to exactly one future session'
);

select * from finish();
rollback;
