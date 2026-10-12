-- Story 19.7: class attendance consumes a session (migration 0112), positive
-- paths. Denial and grant paths live in class_session_gate.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000350xx.
--
-- Concurrency limit: pgTAP runs one session, so interleaving of two callers
-- cannot be exercised. The class_sessions -> member lock order holds by
-- construction; the (member_id, covered_day) unique index is the backstop
-- (asserted in check_in_session_gate.test.sql).

begin;
select plan(39);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000035001', 'Class Gate Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000035011', 'Class Gate Gym On',  '00000000-0000-0000-0000-000000035001', 'active', true,  0),
  ('00000000-0000-0000-0000-000000035012', 'Class Gate Gym Off', '00000000-0000-0000-0000-000000035001', 'active', false, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000035021'), -- receptionist (on)
  ('00000000-0000-0000-0000-000000035022'), -- receptionist (off)
  ('00000000-0000-0000-0000-000000035023'), -- coach
  ('00000000-0000-0000-0000-000000035024'), -- coach (off gym)
  ('00000000-0000-0000-0000-000000035031'), -- A floor then class
  ('00000000-0000-0000-0000-000000035032'), -- B no session
  ('00000000-0000-0000-0000-000000035033'), -- C monthly
  ('00000000-0000-0000-0000-000000035034'), -- D coach-inclusive
  ('00000000-0000-0000-0000-000000035035'), -- E class-only
  ('00000000-0000-0000-0000-000000035036'), -- F price 0
  ('00000000-0000-0000-0000-000000035037'), -- G usable session, two classes
  ('00000000-0000-0000-0000-000000035038'), -- H flag-off gym
  ('00000000-0000-0000-0000-000000035039'), -- I re-mark
  ('00000000-0000-0000-0000-00000003503a'), -- J class then floor
  ('00000000-0000-0000-0000-00000003503b'); -- K expired subscription

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000035041', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035021', 'receptionist', 'CG Receptionist', current_date),
  ('00000000-0000-0000-0000-000000035042', '00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035022', 'receptionist', 'CG Receptionist Off', current_date),
  ('00000000-0000-0000-0000-000000035043', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035023', 'coach', 'CG Coach', current_date),
  ('00000000-0000-0000-0000-000000035044', '00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035024', 'coach', 'CG Coach Off', current_date),
  ('00000000-0000-0000-0000-000000035051', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035031', 'member', 'CG A', current_date),
  ('00000000-0000-0000-0000-000000035052', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035032', 'member', 'CG B', current_date),
  ('00000000-0000-0000-0000-000000035053', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035033', 'member', 'CG C', current_date),
  ('00000000-0000-0000-0000-000000035054', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035034', 'member', 'CG D', current_date),
  ('00000000-0000-0000-0000-000000035055', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035035', 'member', 'CG E', current_date),
  ('00000000-0000-0000-0000-000000035056', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035036', 'member', 'CG F', current_date),
  ('00000000-0000-0000-0000-000000035057', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035037', 'member', 'CG G', current_date),
  ('00000000-0000-0000-0000-000000035058', '00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035038', 'member', 'CG H', current_date),
  ('00000000-0000-0000-0000-000000035059', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035039', 'member', 'CG I', current_date),
  ('00000000-0000-0000-0000-00000003505a', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-00000003503a', 'member', 'CG J', current_date),
  ('00000000-0000-0000-0000-00000003505b', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-00000003503b', 'member', 'CG K', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000035061', '00000000-0000-0000-0000-000000035011', 'CG PPS',       'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000035062', '00000000-0000-0000-0000-000000035011', 'CG Monthly',   'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000035063', '00000000-0000-0000-0000-000000035011', 'CG PPS 0',     'pay_per_session', 0,     'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000035064', '00000000-0000-0000-0000-000000035012', 'CG PPS Off',   'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000035065', '00000000-0000-0000-0000-000000035011', 'CG Coach Inc', 'coach_inclusive', 20000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000035066', '00000000-0000-0000-0000-000000035011', 'CG Class Only', 'class_only',      9000,  'XAF', 'monthly', 30);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035051', '00000000-0000-0000-0000-000000035061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035052', '00000000-0000-0000-0000-000000035061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035053', '00000000-0000-0000-0000-000000035062', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035054', '00000000-0000-0000-0000-000000035065', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035055', '00000000-0000-0000-0000-000000035066', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035056', '00000000-0000-0000-0000-000000035063', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035057', '00000000-0000-0000-0000-000000035061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035058', '00000000-0000-0000-0000-000000035064', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035059', '00000000-0000-0000-0000-000000035061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-00000003505a', '00000000-0000-0000-0000-000000035061', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-00000003505b', '00000000-0000-0000-0000-000000035061', 'expired', current_date - 40, null);

-- Usable free-source sessions (no FK yet): A, G, H (flag-off gym), I, J.
insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until) values
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035051', gen_random_uuid(), now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035057', gen_random_uuid(), now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035058', gen_random_uuid(), now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035059', gen_random_uuid(), now() + interval '5 days'),
  ('00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-00000003505a', gen_random_uuid(), now() + interval '5 days');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000035071', '00000000-0000-0000-0000-000000035011', 'CG Class', '00000000-0000-0000-0000-000000035043', 20, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000035072', '00000000-0000-0000-0000-000000035012', 'CG Class Off', '00000000-0000-0000-0000-000000035044', 20, 'one_off', now() + interval '1 day');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035071', now() + interval '1 day'),
  ('00000000-0000-0000-0000-000000035082', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035071', now() + interval '2 days'),
  ('00000000-0000-0000-0000-000000035083', '00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035072', now() + interval '1 day');

-- Bookings: id 0000...3509xy, x = member letter index, y = session 1/2.
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000000350a1', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035051'), -- A
  ('00000000-0000-0000-0000-0000000350a2', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035052'), -- B
  ('00000000-0000-0000-0000-0000000350a3', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035053'), -- C
  ('00000000-0000-0000-0000-0000000350a4', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035054'), -- D
  ('00000000-0000-0000-0000-0000000350a5', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035055'), -- E
  ('00000000-0000-0000-0000-0000000350a6', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035056'), -- F
  ('00000000-0000-0000-0000-0000000350a7', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035057'), -- G class 1
  ('00000000-0000-0000-0000-0000000350b7', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035082', '00000000-0000-0000-0000-000000035057'), -- G class 2
  ('00000000-0000-0000-0000-0000000350a8', '00000000-0000-0000-0000-000000035012', '00000000-0000-0000-0000-000000035083', '00000000-0000-0000-0000-000000035058'), -- H
  ('00000000-0000-0000-0000-0000000350a9', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-000000035059'), -- I
  ('00000000-0000-0000-0000-0000000350aa', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-00000003505a'), -- J
  ('00000000-0000-0000-0000-0000000350ab', '00000000-0000-0000-0000-000000035011', '00000000-0000-0000-0000-000000035081', '00000000-0000-0000-0000-00000003505b'); -- K

-- ============================================================================
-- Interface
-- ============================================================================
select is(
  (select pg_get_function_result('public.mark_class_attendance(uuid)'::regprocedure)),
  'class_bookings',
  'mark_class_attendance() still RETURNS class_bookings'
);
select is(
  (select proargnames from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure),
  array['p_booking_id'],
  'mark_class_attendance() keeps its argument names'
);

-- ============================================================================
-- A: checks in on the floor (consumes), then is marked at a class (covered).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035031","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"member"}', true);
select isnt((select check_in()), null, 'A checks in on the floor (consumed)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a1')),
  null,
  'A is then marked at a class (covered): attended_at set'
);
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000035051' and consumed_at is not null),
  1,
  'floor then class used one session in total'
);
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000035051'),
  0,
  'A has no blocked attempt'
);

-- ============================================================================
-- J: marked at a class first (consumes), then checks in (covered).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350aa')),
  null,
  'J is marked at a class (consumed): attended_at set'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003503a","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"member"}', true);
select isnt((select check_in()), null, 'J then checks in on the floor (covered)');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-00000003505a' and consumed_at is not null),
  1,
  'class then floor used one session in total'
);

-- ============================================================================
-- G: two classes the same day use one session.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a7')),
  null,
  'G is marked at the first class'
);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350b7')),
  null,
  'G is marked at the second class the same day'
);
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000035057' and consumed_at is not null),
  1,
  'two classes the same day used one session'
);

-- ============================================================================
-- B: no usable session -> refusal committed, attended_at null.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select is(
  (select (m.id = '00000000-0000-0000-0000-0000000350a2' and m.attended_at is null)
   from mark_class_attendance('00000000-0000-0000-0000-0000000350a2') m),
  true,
  'B with no session gets the booking row back with attended_at null (no raise)'
);
reset role;

select is(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-0000000350a2'),
  null,
  'B''s booking is not attended'
);
select is(
  (select count(*)::int from session_attempts
   where member_id = '00000000-0000-0000-0000-000000035052'
     and source = 'class' and scan_id is not null
     and class_session_id = '00000000-0000-0000-0000-000000035081'),
  1,
  'the refusal stored one class attempt carrying the class session id'
);
select is(
  (select kind || '/' || coalesce(status::text, 'null') from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000035052' and dismissed_at is null),
  'session_required/null',
  'the refusal raised one active session_required alert'
);

-- A repeat refusal keeps one alert and records a second attempt.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select lives_ok(
  $$ select mark_class_attendance('00000000-0000-0000-0000-0000000350a2') $$,
  'a repeated refusal does not raise'
);
reset role;

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-000000035052' and kind = 'session_required' and dismissed_at is null),
  1,
  'a repeated refusal keeps one active alert'
);
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000035052'),
  2,
  'each refusal is its own attempt row'
);

-- ============================================================================
-- Exempt plan types: attended, nothing consumed, no attempt.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select isnt((select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a3')), null, 'monthly member is attended (exempt)');
select isnt((select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a4')), null, 'coach-inclusive member is attended (exempt)');
select isnt((select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a5')), null, 'class-only member is attended (exempt)');
select isnt((select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a6')), null, 'price-0 pay-per-session member is attended (exempt)');
reset role;

select is(
  (select count(*)::int from session_attempts
   where member_id in ('00000000-0000-0000-0000-000000035053', '00000000-0000-0000-0000-000000035054',
                       '00000000-0000-0000-0000-000000035055', '00000000-0000-0000-0000-000000035056')),
  0,
  'exempt members have no attempt rows'
);
select is(
  (select count(*)::int from guest_sessions
   where member_id in ('00000000-0000-0000-0000-000000035053', '00000000-0000-0000-0000-000000035054',
                       '00000000-0000-0000-0000-000000035055', '00000000-0000-0000-0000-000000035056')),
  0,
  'exempt members have no session rows'
);

-- ============================================================================
-- Expired member at a flag-on gym: the unchanged 0110 rejection runs first --
-- all-null composite, subscription_status alert, no attempt, no
-- session_required alert.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select is(
  (select id from mark_class_attendance('00000000-0000-0000-0000-0000000350ab')),
  null,
  'flag on, expired member: the all-null composite comes back (id null)'
);
reset role;

select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-00000003505b'
     and kind = 'subscription_status' and status = 'expired' and dismissed_at is null),
  1,
  'flag on, expired member: a subscription_status expired alert exists'
);
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-00000003505b'),
  0,
  'flag on, expired member: no session attempt'
);
select is(
  (select count(*)::int from front_desk_alerts
   where member_id = '00000000-0000-0000-0000-00000003505b' and kind = 'session_required'),
  0,
  'flag on, expired member: no session_required alert'
);

-- ============================================================================
-- Already-attended booking of a since-expired member: stored row, unchanged.
-- Member C (monthly) was marked attended above; expire the subscription now.
-- ============================================================================
update subscriptions set status = 'expired'
where member_id = '00000000-0000-0000-0000-000000035053';
update class_bookings set attended_at = '2001-01-01T00:00:00Z'
where id = '00000000-0000-0000-0000-0000000350a3';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select is(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a3')),
  '2001-01-01T00:00:00Z'::timestamptz,
  'since-expired member: re-mark returns the stored row with attended_at unchanged'
);
reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000035053'),
  0,
  'since-expired member: re-mark raised no alert'
);
select is(
  (select attended_at from class_bookings where id = '00000000-0000-0000-0000-0000000350a3'),
  '2001-01-01T00:00:00Z'::timestamptz,
  'since-expired member: the stored attended_at is untouched'
);

-- ============================================================================
-- Flag off: the 0110 path, no side effects, session untouched.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035012","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a8')),
  null,
  'flag off: attended'
);
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000035058' and consumed_at is not null),
  0,
  'flag off: the session is not consumed'
);
select is(
  (select count(*)::int from session_attempts where gym_id = '00000000-0000-0000-0000-000000035012'),
  0,
  'flag off: no attempt rows'
);

-- ============================================================================
-- Re-mark: the stored row comes back, nothing consumed, timestamp unchanged.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select isnt(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a9')),
  null,
  'I is marked once'
);
reset role;

-- now() is constant inside this transaction, so plant a sentinel to tell a
-- rewrite from a no-op.
update class_bookings set attended_at = '2000-01-01T00:00:00Z'
where id = '00000000-0000-0000-0000-0000000350a9';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000035021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000035011","app_role":"receptionist"}', true);
select is(
  (select attended_at from mark_class_attendance('00000000-0000-0000-0000-0000000350a9')),
  '2000-01-01T00:00:00Z'::timestamptz,
  're-mark returns the stored row with attended_at unchanged'
);
reset role;

select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000035059' and consumed_at is not null),
  1,
  're-mark consumed nothing more'
);

-- The re-mark of an attended booking recorded no attempt (and consumed
-- nothing, asserted above).
select is(
  (select count(*)::int from session_attempts where member_id = '00000000-0000-0000-0000-000000035059'),
  0,
  're-mark recorded no attempt'
);

select * from finish();
rollback;
