-- Story 19.7: class attendance session gate (migration 0112), denial and
-- grant paths. Positive paths: class_session_gate.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000351xx.

begin;
select plan(18);

-- Story 20.1: loyalty_grant_id now has an FK to a reward_granted ledger row.
create function pg_temp.mk_grant(p_gym uuid, p_member uuid) returns uuid
language sql security definer as $mk$
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id
$mk$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000035101', 'Class Gate Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000035111', 'Class Gate Neg Gym', '00000000-0000-0000-0000-000000035101', 'active', true, 0),
  ('00000000-0000-0000-0000-000000035112', 'Class Gate Neg Gym B', '00000000-0000-0000-0000-000000035101', 'active', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000035121'), -- member with an expired session
  ('00000000-0000-0000-0000-000000035122'), -- member with a voided session
  ('00000000-0000-0000-0000-000000035123'), -- receptionist
  ('00000000-0000-0000-0000-000000035124'), -- coach
  ('00000000-0000-0000-0000-000000035125'); -- gym B receptionist

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000035131', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035121', 'member', 'CGN Expired', current_date),
  ('00000000-0000-0000-0000-000000035132', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035122', 'member', 'CGN Voided', current_date),
  ('00000000-0000-0000-0000-000000035133', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035123', 'receptionist', 'CGN Receptionist', current_date),
  ('00000000-0000-0000-0000-000000035134', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035124', 'coach', 'CGN Coach', current_date),
  ('00000000-0000-0000-0000-000000035135', '00000000-0000-0000-0000-000000035112', '00000000-0000-0000-0000-000000035125', 'receptionist', 'CGN Receptionist B', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000035141', '00000000-0000-0000-0000-000000035111', 'CGN PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035131', '00000000-0000-0000-0000-000000035141', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035132', '00000000-0000-0000-0000-000000035141', 'active', current_date, null);

insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at) values
  ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035131', pg_temp.mk_grant('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035131'), now() - interval '1 minute', now() - interval '8 days');
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, voided_at) values
  ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035132', pg_temp.mk_grant('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035132'), now() + interval '3 days', now());

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000035151', '00000000-0000-0000-0000-000000035111', 'CGN Class', '00000000-0000-0000-0000-000000035134', 10, 'one_off', now() + interval '1 day');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035151', now() + interval '1 day');

insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-000000035171', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035131'),
  ('00000000-0000-0000-0000-000000035172', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035132');

-- ============================================================================
-- Unusable sessions are refused, not attended.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035111","app_role":"receptionist"}', true);
select is((select attended_at from mark_class_attendance('00000000-0000-0000-0000-000000035171')), null,
  'a lapsed session does not admit the member to class');
select is((select attended_at from mark_class_attendance('00000000-0000-0000-0000-000000035172')), null,
  'a voided session does not admit the member to class');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id in ('00000000-0000-0000-0000-000000035131', '00000000-0000-0000-0000-000000035132')
     and consumed_at is not null),
  0,
  'neither unusable session was consumed'
);
select is(
  (select count(*)::int from session_attempts where source = 'class' and gym_id = '00000000-0000-0000-0000-000000035111'),
  2,
  'both refusals committed a class attempt'
);

-- ============================================================================
-- Retry: once a usable session exists, the refused booking can be marked. The
-- refusal row stays; exactly one session is consumed.
-- ============================================================================
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until) values
  ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035131', pg_temp.mk_grant('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035131'), now() + interval '3 days');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035111","app_role":"receptionist"}', true);
select isnt((select attended_at from mark_class_attendance('00000000-0000-0000-0000-000000035171')), null,
  'a refused booking is attended once a usable session exists');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000035131' and consumed_at is not null),
  1,
  'the retry consumed exactly one session'
);
select is(
  (select count(*)::int from session_attempts
   where source = 'class' and member_id = '00000000-0000-0000-0000-000000035131'),
  1,
  'the earlier refusal attempt row is kept after the retry'
);

-- ============================================================================
-- Roles and tenancy are unchanged.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035111","app_role":"coach"}', true);
select throws_like(
  $$ select mark_class_attendance('00000000-0000-0000-0000-000000035171') $$,
  '%permission denied%',
  'a coach still cannot mark class attendance'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035112","app_role":"receptionist"}', true);
select throws_like(
  $$ select mark_class_attendance('00000000-0000-0000-0000-000000035171') $$,
  '%not found%',
  'a cross-gym booking id is not found'
);
reset role;

-- ============================================================================
-- Direct writes of attended_at are closed (column-level privilege).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035111","app_role":"receptionist"}', true);
select throws_ok(
  $$ update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000035171' $$,
  '42501', null, 'authenticated cannot UPDATE class_bookings.attended_at'
);
select throws_ok(
  $$ insert into class_bookings (gym_id, class_session_id, member_id, attended_at)
     values ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035133', now()) $$,
  '42501', null, 'authenticated cannot INSERT class_bookings carrying attended_at'
);
reset role;

set local role service_role;
select throws_ok(
  $$ update class_bookings set attended_at = now() where id = '00000000-0000-0000-0000-000000035171' $$,
  '42501', null, 'service_role cannot UPDATE class_bookings.attended_at'
);
select throws_ok(
  $$ insert into class_bookings (gym_id, class_session_id, member_id, attended_at)
     values ('00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035133', now()) $$,
  '42501', null, 'service_role cannot INSERT class_bookings carrying attended_at'
);

-- The e2e fixtures keep working: insert without attended_at, then delete.
select lives_ok(
  $$ insert into class_bookings (id, gym_id, class_session_id, member_id)
     values ('00000000-0000-0000-0000-000000035173', '00000000-0000-0000-0000-000000035111', '00000000-0000-0000-0000-000000035161', '00000000-0000-0000-0000-000000035133') $$,
  'service_role can still INSERT a booking without attended_at'
);
select lives_ok(
  $$ delete from class_bookings where id = '00000000-0000-0000-0000-000000035173' $$,
  'service_role can still DELETE a booking'
);
reset role;

select is(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-000000035172'),
  null,
  'attended_at stayed null through every direct-write attempt'
);

select ok(
  not has_column_privilege('authenticated', 'public.class_bookings', 'attended_at', 'UPDATE')
  and not has_column_privilege('service_role', 'public.class_bookings', 'attended_at', 'UPDATE'),
  'no client role holds UPDATE on attended_at'
);
select ok(
  has_table_privilege('authenticated', 'public.class_bookings', 'SELECT'),
  'authenticated keeps SELECT on class_bookings'
);

select * from finish();
rollback;
