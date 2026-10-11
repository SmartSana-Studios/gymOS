-- Story 19.6b: check-in gate (migration 0111), denial and grant paths.
-- Positive paths: check_in_session_gate.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000341xx.

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000034101', 'Gate Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000034111', 'Gate Neg Gym', '00000000-0000-0000-0000-000000034101', 'active', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000034121'), -- member with an expired session
  ('00000000-0000-0000-0000-000000034122'), -- member with a voided session
  ('00000000-0000-0000-0000-000000034123'), -- member with a staff-owned alert history
  ('00000000-0000-0000-0000-000000034124'); -- owner

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000034131', '00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034121', 'member', 'GN Expired', current_date),
  ('00000000-0000-0000-0000-000000034132', '00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034122', 'member', 'GN Voided', current_date),
  ('00000000-0000-0000-0000-000000034133', '00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034123', 'member', 'GN Third', current_date),
  ('00000000-0000-0000-0000-000000034134', '00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034124', 'owner', 'GN Owner', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000034141', '00000000-0000-0000-0000-000000034111', 'GN PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034131', '00000000-0000-0000-0000-000000034141', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034132', '00000000-0000-0000-0000-000000034141', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034133', '00000000-0000-0000-0000-000000034141', 'active', current_date, null);

-- An expired session and a voided session are not usable.
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at) values
  ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034131', gen_random_uuid(), now() - interval '1 minute', now() - interval '8 days');
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, voided_at) values
  ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034132', gen_random_uuid(), now() + interval '3 days', now());

-- ============================================================================
-- Unusable sessions are denied.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034111","app_role":"member"}', true);
select is((select check_in() is null), true, 'a lapsed session does not admit the member');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034111","app_role":"member"}', true);
select is((select check_in() is null), true, 'a voided session does not admit the member');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id in ('00000000-0000-0000-0000-000000034131', '00000000-0000-0000-0000-000000034132')
     and consumed_at is not null),
  0,
  'neither unusable session was consumed'
);
select is(
  (select count(*)::int from attendance_events
   where member_id in ('00000000-0000-0000-0000-000000034131', '00000000-0000-0000-0000-000000034132')),
  0,
  'no attendance row was written for either'
);

-- ============================================================================
-- Staff and non-members cannot use check_in().
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034111","app_role":"owner"}', true);
select throws_ok($$ select check_in() $$, 'permission denied', 'an owner session cannot call check_in()');
reset role;

-- ============================================================================
-- The session_attempts and the consumption surface are closed to clients.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034111","app_role":"owner"}', true);

select throws_ok(
  $$ insert into session_attempts (gym_id, member_id) values ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034133') $$,
  '42501', null, 'authenticated cannot insert session_attempts'
);
select throws_ok(
  $$ select * from private.consume_guest_session('00000000-0000-0000-0000-000000034133', '00000000-0000-0000-0000-000000034111', now()) $$,
  '42501', null, 'authenticated cannot call consume_guest_session()'
);

-- Direct writes on attendance_events are refused for authenticated.
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id) values ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034133') $$,
  '42501', null, 'authenticated cannot INSERT into attendance_events'
);
select throws_ok(
  $$ update attendance_events set checked_out_at = now() where gym_id = '00000000-0000-0000-0000-000000034111' $$,
  '42501', null, 'authenticated cannot UPDATE attendance_events'
);
select throws_ok(
  $$ delete from attendance_events where gym_id = '00000000-0000-0000-0000-000000034111' $$,
  '42501', null, 'authenticated cannot DELETE from attendance_events'
);
reset role;

set local role service_role;
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id) values ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034133') $$,
  '42501', null, 'service_role cannot INSERT into attendance_events'
);
select throws_ok(
  $$ update attendance_events set checked_out_at = now() $$,
  '42501', null, 'service_role cannot UPDATE attendance_events'
);
select throws_ok(
  $$ delete from attendance_events $$,
  '42501', null, 'service_role cannot DELETE from attendance_events'
);
reset role;

-- ============================================================================
-- A consumed session must name the day it covers.
-- ============================================================================
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at)
     values ('00000000-0000-0000-0000-000000034111', '00000000-0000-0000-0000-000000034133', gen_random_uuid(), now() + interval '1 day', now()) $$,
  '23514', null, 'a consumed guest_sessions row without covered_day violates the CHECK'
);

-- ============================================================================
-- Unconsumed state survives a refusal: a denied scan is not an exception, so
-- its attempt and alert commit (the gate returns null instead of raising).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034111","app_role":"member"}', true);
select is((select check_in() is null), true, 'a member with no sessions is refused with null, not an error');
reset role;

select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000034133')
  + (select count(*)::int from front_desk_alerts
     where member_id = '00000000-0000-0000-0000-000000034133' and kind = 'session_required' and dismissed_at is null),
  2,
  'the refusal committed one attempt and one active alert'
);

select * from finish();
rollback;
