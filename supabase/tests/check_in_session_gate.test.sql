-- Story 19.6b: check-in gate, blocked attempts and session-required alert
-- (migration 0111), positive paths. Denial and grant paths live in
-- check_in_session_gate.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000340xx.
--
-- Concurrency limit: pgTAP runs one session, so true interleaving of two
-- callers cannot be exercised here. What is asserted instead is (a) two
-- sequential check_in() calls for one member give one *consumed* then one
-- *covered* with exactly one consumed session, and (b) the partial unique
-- index (member_id, covered_day) rejects a second consumed row for the day,
-- which is the backstop behind the member lock-then-recheck order.

begin;
select plan(49);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000034001', 'Gate Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000034011', 'Gate Gym On',  '00000000-0000-0000-0000-000000034001', 'active', true,  0),
  ('00000000-0000-0000-0000-000000034012', 'Gate Gym Off', '00000000-0000-0000-0000-000000034001', 'active', false, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000034021'), -- receptionist (on)
  ('00000000-0000-0000-0000-000000034031'), -- A paid session
  ('00000000-0000-0000-0000-000000034032'), -- B no session
  ('00000000-0000-0000-0000-000000034033'), -- C monthly plan (exempt)
  ('00000000-0000-0000-0000-000000034034'), -- D price 0 (exempt)
  ('00000000-0000-0000-0000-000000034035'), -- E paid + free tie
  ('00000000-0000-0000-0000-000000034036'), -- F offline scan accepted + replay
  ('00000000-0000-0000-0000-000000034037'), -- G offline scan outside window
  ('00000000-0000-0000-0000-000000034038'), -- H day boundary (direct calls)
  ('00000000-0000-0000-0000-000000034039'), -- I flag-off gym
  ('00000000-0000-0000-0000-00000003403a'), -- J same scan id denied twice
  ('00000000-0000-0000-0000-00000003403b'), -- K offline scan before session creation
  ('00000000-0000-0000-0000-00000003403c'), -- L stale open row, no session
  ('00000000-0000-0000-0000-00000003403d'); -- M non-stale open row, no session

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000034041', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034021', 'receptionist', 'Gate Receptionist', current_date),
  ('00000000-0000-0000-0000-000000034051', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034031', 'member', 'Gate A', current_date),
  ('00000000-0000-0000-0000-000000034052', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034032', 'member', 'Gate B', current_date),
  ('00000000-0000-0000-0000-000000034053', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034033', 'member', 'Gate C', current_date),
  ('00000000-0000-0000-0000-000000034054', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034034', 'member', 'Gate D', current_date),
  ('00000000-0000-0000-0000-000000034055', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034035', 'member', 'Gate E', current_date),
  ('00000000-0000-0000-0000-000000034056', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034036', 'member', 'Gate F', current_date),
  ('00000000-0000-0000-0000-000000034057', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034037', 'member', 'Gate G', current_date),
  ('00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034038', 'member', 'Gate H', current_date),
  ('00000000-0000-0000-0000-000000034059', '00000000-0000-0000-0000-000000034012', '00000000-0000-0000-0000-000000034039', 'member', 'Gate I', current_date),
  ('00000000-0000-0000-0000-00000003405a', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003403a', 'member', 'Gate J', current_date),
  ('00000000-0000-0000-0000-00000003405b', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003403b', 'member', 'Gate K', current_date),
  ('00000000-0000-0000-0000-00000003405c', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003403c', 'member', 'Gate L', current_date),
  ('00000000-0000-0000-0000-00000003405d', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003403d', 'member', 'Gate M', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000034061', '00000000-0000-0000-0000-000000034011', 'Gate PPS',     'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000034062', '00000000-0000-0000-0000-000000034011', 'Gate Monthly', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000034063', '00000000-0000-0000-0000-000000034011', 'Gate PPS 0',   'pay_per_session', 0,     'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000034064', '00000000-0000-0000-0000-000000034012', 'Gate PPS Off', 'pay_per_session', 2000,  'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034051', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034052', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034053', '00000000-0000-0000-0000-000000034062', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034054', '00000000-0000-0000-0000-000000034063', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034055', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034056', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034057', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034012', '00000000-0000-0000-0000-000000034059', '00000000-0000-0000-0000-000000034064', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405a', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405b', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405c', '00000000-0000-0000-0000-000000034061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405d', '00000000-0000-0000-0000-000000034061', 'active', current_date, null);

-- L: an open row older than the auto-timeout. M: an open row from 10 minutes ago.
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405c',
   now() - make_interval(hours => (select checkin_timeout_hours + 2 from gyms where id = '00000000-0000-0000-0000-000000034011'))),
  ('00000000-0000-0000-0000-0000000fb002', '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405d',
   now() - interval '10 minutes');

-- Sessions that are not bought at the desk: free-source rows (no FK yet).
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at) values
  -- F: created 3h ago, still usable
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034056', gen_random_uuid(), now() + interval '5 days', now() - interval '3 hours'),
  -- G: created long enough ago that an old offline scan is after creation
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034057', gen_random_uuid(), now() + interval '5 days', now() - interval '200 hours'),
  -- I (flag-off gym): must stay unconsumed
  ('00000000-0000-0000-0000-000000034012', '00000000-0000-0000-0000-000000034059', gen_random_uuid(), now() + interval '5 days', now() - interval '1 hour'),
  -- J: none (denied). K: created 1h ago
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-00000003405b', gen_random_uuid(), now() + interval '5 days', now() - interval '1 hour'),
  -- H: one usable session for the day-boundary calls
  ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034058', gen_random_uuid(), now() + interval '30 days', now() - interval '1 hour');

-- ============================================================================
-- Interface: signature and return type are unchanged.
-- ============================================================================
select is(
  (select pg_get_function_result('public.check_in(timestamptz, uuid)'::regprocedure)),
  'attendance_events',
  'check_in() still RETURNS attendance_events'
);

select is(
  (select proargnames from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure),
  array['p_scanned_at', 'p_client_scan_id'],
  'check_in() keeps its argument names'
);

-- ============================================================================
-- Paid sessions are bought at the desk (also exercises 19.4's path).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"receptionist"}', true);

select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000034051', 'cash') $$,
  'receptionist records a session payment for A'
);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000034055', 'cash') $$,
  'receptionist records a session payment for E'
);
reset role;

-- E: the free session lapses at exactly the same instant as the paid one.
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, created_at)
select '00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034055', gen_random_uuid(),
       s.usable_until, s.created_at - interval '1 minute'
from guest_sessions s
where s.member_id = '00000000-0000-0000-0000-000000034055' and s.payment_id is not null;

-- ============================================================================
-- A: usable session -> consumed; same day again -> covered.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select isnt((select check_in()), null, 'A with a usable session checks in (consumed)');
reset role;

select is(
  (select consumed_at is not null and covered_day = (now() at time zone 'Africa/Douala')::date
   from guest_sessions where member_id = '00000000-0000-0000-0000-000000034051'),
  true,
  'A''s session is consumed with the gym-local day as covered_day'
);

-- Close the open session so a second scan reaches the gate again.
update attendance_events set checked_out_at = now(), checkout_type = 'manual'
where member_id = '00000000-0000-0000-0000-000000034051';

set local role authenticated;
select isnt((select check_in()), null, 'A scans again the same day (covered)');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000034051' and consumed_at is not null),
  1,
  'the second same-day scan consumed nothing more'
);
select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000034051'),
  2,
  'both scans have an attendance row'
);

-- Unique index backstop: a second consumed row for the same day is refused.
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
     values ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034051', gen_random_uuid(),
             now() + interval '1 day', now(), (now() at time zone 'Africa/Douala')::date) $$,
  '23505',
  null,
  'the (member_id, covered_day) unique index refuses a second consumed session for the day'
);

-- ============================================================================
-- B: no usable session -> denied, attempt + one alert, no attendance row.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is((select check_in() is null), true, 'B without a session is denied (null)');
reset role;

select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000034052'),
  1,
  'a denied scan stores one session_attempts row'
);
select is(
  (select kind || '/' || coalesce(status::text, 'null') from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000034052' and dismissed_at is null),
  'session_required/null',
  'a denied scan raises one active session_required alert with null status'
);
select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000034052'),
  0,
  'a denied scan writes no attendance row'
);

set local role authenticated;
select is((select check_in() is null), true, 'B scans again and is denied again');
reset role;

select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000034052'),
  2,
  'a second denied scan without a scan id records a second attempt'
);
select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000034052' and kind = 'session_required' and dismissed_at is null),
  1,
  'still exactly one active session_required alert'
);

-- J: the same scan id twice is one attempt.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003403a","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is((select check_in(now() - interval '5 minutes', '00000000-0000-0000-0000-0000000fa001') is null), true, 'J offline scan denied');
select is((select check_in(now() - interval '5 minutes', '00000000-0000-0000-0000-0000000fa001') is null), true, 'J same scan id denied again');
reset role;

select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-00000003405a'),
  1,
  'a repeated scan id counts once'
);
select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-00000003405a' and kind = 'session_required' and dismissed_at is null),
  1,
  'J has one active session_required alert'
);

-- ============================================================================
-- Exempt: not Pay-per-session, or price 0 -> as before, nothing consumed.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034033","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select isnt((select check_in()), null, 'C on a monthly plan checks in (exempt)');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034034","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select isnt((select check_in()), null, 'D on a price 0 Pay-per-session plan checks in (exempt)');
reset role;

select is(
  (select count(*)::int from session_attempts
   where member_id in ('00000000-0000-0000-0000-000000034053', '00000000-0000-0000-0000-000000034054'))
  + (select count(*)::int from guest_sessions
     where member_id in ('00000000-0000-0000-0000-000000034053', '00000000-0000-0000-0000-000000034054')),
  0,
  'exempt members leave no attempt and no session'
);

-- ============================================================================
-- E: tie on usable_until -> the paid session is consumed first.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034035","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select isnt((select check_in()), null, 'E checks in');
reset role;

select is(
  (select bool_and((payment_id is not null) = (consumed_at is not null))
   from guest_sessions where member_id = '00000000-0000-0000-0000-000000034055'),
  true,
  'on a usable_until tie the paid session is consumed and the free one is kept'
);

-- ============================================================================
-- Offline scan time: trusted inside the window and after session creation.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034036","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is(
  (select (check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000000fa002')).checked_in_at = now() - interval '1 hour'),
  true,
  'F: an offline scan inside the window and after session creation keeps its scan time'
);
reset role;

set local role authenticated;
select is(
  (select (check_in(now() - interval '1 hour', '00000000-0000-0000-0000-0000000fa002')).id),
  (select id from attendance_events where member_id = '00000000-0000-0000-0000-000000034056'),
  'replaying the scan id returns the stored row'
);
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000034056' and consumed_at is not null),
  1,
  'the replay consumed nothing more'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034037","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is(
  (select (check_in(now() - make_interval(hours => (select checkin_timeout_hours + 2 from gyms where id = '00000000-0000-0000-0000-000000034011')),
                    '00000000-0000-0000-0000-0000000fa003')).checked_in_at = now()),
  true,
  'G: an offline scan older than the auto-timeout window is stamped with receipt time'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003403b","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is(
  (select (check_in(now() - interval '2 hours', '00000000-0000-0000-0000-0000000fa004')).checked_in_at = now()),
  true,
  'K: an offline scan before the covering session existed is stamped with receipt time'
);
reset role;

-- ============================================================================
-- Flag off: the 0110 path, no side effects.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034039","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034012","app_role":"member"}', true);
select isnt((select check_in()), null, 'I at a flag-off gym checks in');
reset role;

select is(
  (select count(*)::int from session_attempts where gym_id = '00000000-0000-0000-0000-000000034012')
  + (select count(*)::int from front_desk_alerts where gym_id = '00000000-0000-0000-0000-000000034012')
  + (select count(*)::int from guest_sessions
     where gym_id = '00000000-0000-0000-0000-000000034012' and consumed_at is not null),
  0,
  'flag off: no attempt, no alert, nothing consumed'
);

-- ============================================================================
-- Payment dismisses the member's active session_required alert.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000034052', 'cash') $$,
  'receptionist records B''s session payment'
);
reset role;

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000034052' and kind = 'session_required' and dismissed_at is null),
  0,
  'the payment dismissed B''s active session_required alert'
);
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000034052'),
  2,
  'dismissing the alert leaves the blocked attempts untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000034032","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select isnt((select check_in()), null, 'B checks in after paying');
reset role;

-- ============================================================================
-- Gym-local day boundary (Africa/Douala, UTC+1 all year): receipts at 23:50 and
-- 23:55 of tomorrow, then 00:10 of the day after.
-- ============================================================================
select is(
  (select outcome from private.consume_guest_session(
     '00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034011', ((((now() at time zone 'Africa/Douala')::date + 2)::timestamp) at time zone 'Africa/Douala') - interval '10 minutes')),
  'consumed',
  'H: 23:50 gym time consumes the session'
);
select is(
  (select outcome from private.consume_guest_session(
     '00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034011', ((((now() at time zone 'Africa/Douala')::date + 2)::timestamp) at time zone 'Africa/Douala') - interval '5 minutes')),
  'covered',
  'H: 23:55 gym time is covered by the same session'
);
select is(
  (select outcome from private.consume_guest_session(
     '00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034011', ((((now() at time zone 'Africa/Douala')::date + 2)::timestamp) at time zone 'Africa/Douala') + interval '10 minutes')),
  'denied',
  'H: 00:10 gym time is a new day and needs a new session'
);

insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
values ('00000000-0000-0000-0000-000000034011', '00000000-0000-0000-0000-000000034058', gen_random_uuid(), now() + interval '30 days');

select is(
  (select outcome from private.consume_guest_session(
     '00000000-0000-0000-0000-000000034058', '00000000-0000-0000-0000-000000034011', ((((now() at time zone 'Africa/Douala')::date + 2)::timestamp) at time zone 'Africa/Douala') + interval '10 minutes')),
  'consumed',
  'H: a new session covers the next gym-local day'
);
select is(
  (select array_agg(covered_day order by covered_day)::date[]::text from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000034058' and consumed_at is not null),
  array[(now() at time zone 'Africa/Douala')::date + 1, (now() at time zone 'Africa/Douala')::date + 2]::text,
  'H: the two consumed sessions cover consecutive gym-local days'
);

-- ============================================================================
-- L: stale open row + no session -> the auto-close commits with the denial.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003403c","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select is((select check_in() is null), true, 'L: stale open row and no session is denied (null)');
reset role;

select is(
  (select checkout_type from attendance_events where id = '00000000-0000-0000-0000-0000000fb001'),
  'auto',
  'L: the stale row was auto-closed and the close committed'
);
select is(
  (select count(*)::int from audit_log
   where action_type = 'attendance_stale_check_in_auto_closed'
     and target_entity_id = '00000000-0000-0000-0000-0000000fb001'),
  1,
  'L: the auto-close audit row exists'
);
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-00000003405c'),
  1,
  'L: one session_attempts row'
);
select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-00000003405c' and kind = 'session_required' and dismissed_at is null),
  1,
  'L: one active session_required alert'
);

-- ============================================================================
-- M: non-stale open row -> the existing raise, no attempt written.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003403d","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000034011","app_role":"member"}', true);
select throws_like(
  $$ select check_in() $$,
  '%already has an open check-in%',
  'M: a non-stale open check-in still raises'
);
reset role;

select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-00000003405d'),
  0,
  'M: no session_attempts row was written'
);

select * from finish();
rollback;
