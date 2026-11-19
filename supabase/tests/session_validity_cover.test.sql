-- Story 28.1: the session record (migration 0177). Columns, the cover CHECK, the deferred visit trigger, the rebuilt covered-day CHECK and
-- one-per-member-day index, the normalising trigger, the consume function's whole_day stamp, the audit metadata, tenant isolation of the cover
-- columns, and (last, because it drops a constraint) the backfill statement.
--
-- guest_sessions has no client write path: every writer here is the table owner, as the SECURITY DEFINER functions are.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002803xx.

begin;
select plan(66);

create function pg_temp.mk_grant(p_gym uuid, p_member uuid) returns uuid
language sql security definer as $mk$
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id
$mk$;

-- A free-source session row (unconsumed) for a member; returns its id.
create function pg_temp.mk_session(p_gym uuid, p_member uuid) returns uuid
language sql as $mk$
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
  values (p_gym, p_member, pg_temp.mk_grant(p_gym, p_member), now() + interval '5 days') returning id
$mk$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000280301', 'Cover Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000280311', 'Cover Gym A', '00000000-0000-0000-0000-000000280301', 'active', true, 0),
  ('00000000-0000-0000-0000-000000280312', 'Cover Gym B', '00000000-0000-0000-0000-000000280301', 'active', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000280321'), -- owner A
  ('00000000-0000-0000-0000-000000280322'), -- member 1 (A)
  ('00000000-0000-0000-0000-000000280323'), -- member 2 (A)
  ('00000000-0000-0000-0000-000000280324'), -- member 3 (A)
  ('00000000-0000-0000-0000-000000280325'), -- member 4 (A)
  ('00000000-0000-0000-0000-000000280326'), -- owner B
  ('00000000-0000-0000-0000-000000280327'), -- coach A
  ('00000000-0000-0000-0000-000000280328'), -- member 5 (A)
  ('00000000-0000-0000-0000-000000280329'); -- member B1 (B)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000280331', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280321', 'owner',  'Cover Owner A',  current_date),
  ('00000000-0000-0000-0000-000000280332', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280322', 'member', 'Cover M1',       current_date),
  ('00000000-0000-0000-0000-000000280333', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280323', 'member', 'Cover M2',       current_date),
  ('00000000-0000-0000-0000-000000280334', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280324', 'member', 'Cover M3',       current_date),
  ('00000000-0000-0000-0000-000000280335', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280325', 'member', 'Cover M4',       current_date),
  ('00000000-0000-0000-0000-000000280336', '00000000-0000-0000-0000-000000280312', '00000000-0000-0000-0000-000000280326', 'owner',  'Cover Owner B',  current_date),
  ('00000000-0000-0000-0000-000000280337', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280327', 'coach',  'Cover Coach A',  current_date),
  ('00000000-0000-0000-0000-000000280338', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280328', 'member', 'Cover M5',       current_date),
  ('00000000-0000-0000-0000-000000280339', '00000000-0000-0000-0000-000000280312', '00000000-0000-0000-0000-000000280329', 'member', 'Cover MB1',      current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000280361', '00000000-0000-0000-0000-000000280311', 'Cover PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280332', '00000000-0000-0000-0000-000000280361', 'active', current_date, null);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000280371', '00000000-0000-0000-0000-000000280311', 'Cover Class', '00000000-0000-0000-0000-000000280337', 20, 'one_off', now() + interval '1 day');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000280381', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280371', now() + interval '1 day');
insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-0000002803b1', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280381', '00000000-0000-0000-0000-000000280333'),
  ('00000000-0000-0000-0000-0000002803b2', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280381', '00000000-0000-0000-0000-000000280334');

-- Closed attendance rows for M2 (two visits the same day) and one for M3; the visit rows below point at them.
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type) values
  ('00000000-0000-0000-0000-0000002803a1', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333', now() - interval '4 hours', now() - interval '3 hours', 'manual'),
  ('00000000-0000-0000-0000-0000002803a2', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333', now() - interval '2 hours', now() - interval '1 hour',  'manual'),
  ('00000000-0000-0000-0000-0000002803a3', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280334', now() - interval '2 hours', now() - interval '1 hour',  'manual');

-- ============================================================================
-- Shape: the columns, the foreign keys, the indexes.
-- ============================================================================
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'guest_sessions'
     and column_name in ('validity_mode', 'covered_kind', 'covered_booking_id', 'covered_attendance_id')),
  array['covered_attendance_id', 'covered_booking_id', 'covered_kind', 'validity_mode'],
  'guest_sessions carries the four cover columns (covered_attendance_id is 0175''s, reused)'
);
select is(
  (select count(*)::int from pg_constraint
   where conrelid = 'public.guest_sessions'::regclass and contype = 'f' and confdeltype = 'a'
     and confrelid in ('public.class_bookings'::regclass, 'public.attendance_events'::regclass)),
  2,
  'the booking and attendance foreign keys do not cascade a delete into a consumed session'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname in
     ('guest_sessions_covered_booking_id_unique', 'guest_sessions_covered_attendance_id_unique')),
  2,
  'both cover-id unique indexes exist'
);
select ok(
  (select indexdef from pg_indexes where indexname = 'guest_sessions_one_consumed_per_member_day') like '%validity_mode = ''whole_day''%',
  'the one-per-member-day index is rebuilt for whole_day rows only'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'guest_sessions_consumed_has_covered_day')
    like '%validity_mode IS DISTINCT FROM ''whole_day''%',
  'the covered-day CHECK is rebuilt for whole_day rows only'
);
select is(
  (select count(*)::int from pg_constraint where conname = 'guest_sessions_cover_matches_kind'), 1, 'the cover CHECK exists'
);
select is(
  (select tgdeferrable::text || ':' || tginitdeferred::text from pg_trigger where tgname = 'guest_sessions_visit_has_attendance'),
  'true:true',
  'the visit-needs-attendance trigger is DEFERRABLE INITIALLY DEFERRED'
);

-- ============================================================================
-- The cover CHECK, case by case (each refusal is a 23514; each acceptance is a control).
-- ============================================================================
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day') $$,
  'an unconsumed row with no cover columns is accepted'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, validity_mode)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day', 'whole_day') $$,
  '23514', null, 'an unconsumed row with a validity_mode is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, covered_kind)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day', 'visit') $$,
  '23514', null, 'an unconsumed row with a covered_kind is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, covered_booking_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             '00000000-0000-0000-0000-0000002803b1') $$,
  '23514', null, 'an unconsumed row with a booking id is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             '00000000-0000-0000-0000-0000002803a3') $$,
  '23514', null, 'an unconsumed row with an attendance id is refused'
);

-- day
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, validity_mode, covered_kind)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), current_date - 30, 'whole_day', 'day') $$,
  'a consumed day row is whole_day with a covered_day'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, validity_mode, covered_kind)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), current_date - 31, 'single_use', 'day') $$,
  '23514', null, 'a day row that is single_use is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'whole_day', 'day') $$,
  '23514', null, 'a whole_day day row with no covered_day is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, validity_mode, covered_kind, covered_booking_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), current_date - 32, 'whole_day', 'day', '00000000-0000-0000-0000-0000002803b1') $$,
  '23514', null, 'a day row with a booking id is refused'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day', now()) $$,
  '23514', null, 'a consumed row with no kind, no mode and no day is refused (a NULL cannot slip through the CHECK)'
);

-- visit
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333'), now() + interval '1 day',
             now(), 'single_use', 'visit', '00000000-0000-0000-0000-0000002803a1') $$,
  'a consumed visit row is single_use with an attendance id and no covered_day'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id, covered_day)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'single_use', 'visit', '00000000-0000-0000-0000-0000002803a3', current_date) $$,
  '23514', null, 'a visit row with a covered_day is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id, covered_booking_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'single_use', 'visit', '00000000-0000-0000-0000-0000002803a3', '00000000-0000-0000-0000-0000002803b1') $$,
  '23514', null, 'a visit row with a booking id is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'whole_day', 'visit', '00000000-0000-0000-0000-0000002803a3') $$,
  '23514', null, 'a visit row that is whole_day is refused'
);

-- class
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_booking_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280334',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280334'), now() + interval '1 day',
             now(), 'single_use', 'class', '00000000-0000-0000-0000-0000002803b2') $$,
  'a consumed class row is single_use with a booking id'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'single_use', 'class') $$,
  '23514', null, 'a class row without a booking id is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_booking_id, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'single_use', 'class', '00000000-0000-0000-0000-0000002803b1', '00000000-0000-0000-0000-0000002803a3') $$,
  '23514', null, 'a class row with an attendance id is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_booking_id, covered_day)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'single_use', 'class', '00000000-0000-0000-0000-0000002803b1', current_date) $$,
  '23514', null, 'a class row with a covered_day is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_booking_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333'), now() + interval '1 day',
             now(), 'single_use', 'class', '00000000-0000-0000-0000-0000002803b2') $$,
  '23505', null, 'a booking covers at most one session (unique covered_booking_id)'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333'), now() + interval '1 day',
             now(), 'single_use', 'visit', '00000000-0000-0000-0000-0000002803a1') $$,
  '23505', null, 'an attendance row covers at most one session (0175 unique index, unchanged)'
);

-- ============================================================================
-- The rebuilt unique index: whole_day still one per day; single_use visits may repeat.
-- ============================================================================
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_day)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'whole_day', 'day', current_date - 40) $$,
  'control: one consumed whole_day row for a member and day'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_day)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), 'whole_day', 'day', current_date - 40) $$,
  '23505', null, 'a second consumed whole_day row for the same member and day is refused'
);
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
             now(), current_date - 40) $$,
  '23505', null, 'the same, written by a legacy writer with no mode (the normalising trigger makes it whole_day)'
);
select lives_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_attendance_id)
     values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280333'), now() + interval '1 day',
             now(), 'single_use', 'visit', '00000000-0000-0000-0000-0000002803a2') $$,
  'a second consumed single_use visit row for the same member and day is accepted'
);
select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000280333' and covered_kind = 'visit' and consumed_at is not null),
  2,
  'two single_use visit rows stand for the one member and day'
);

-- ============================================================================
-- The deferred trigger: a consumed visit row needs its attendance id by commit.
-- ============================================================================
select throws_ok(
  $$ do $d$ begin
       insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind)
       values ('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
               pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'), now() + interval '1 day',
               now(), 'single_use', 'visit');
       set constraints guest_sessions_visit_has_attendance immediate;
     end $d$ $$,
  '23514', null, 'a visit row consumed and never given an attendance id fails when the deferred check runs (at commit)'
);
select lives_ok(
  $$ do $d$
     declare v_id uuid;
     begin
       v_id := pg_temp.mk_session('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335');
       -- the 28.2 order: consume first, set the attendance id after, in the same transaction
       update guest_sessions set consumed_at = now(), validity_mode = 'single_use', covered_kind = 'visit' where id = v_id;
       update guest_sessions set covered_attendance_id = '00000000-0000-0000-0000-0000002803a3' where id = v_id;
       set constraints guest_sessions_visit_has_attendance immediate;
       -- leave the table as it was: release the row (the normalising trigger clears the cover columns)
       update guest_sessions set consumed_at = null where id = v_id;
     end $d$ $$,
  'consuming a visit row and setting the attendance id afterwards in the same transaction passes the deferred check'
);
-- control: the ordinary rows left behind satisfy the check at this point
set constraints guest_sessions_visit_has_attendance immediate;
select pass('every visit row in the table has its attendance id (the deferred check runs clean)');

-- ============================================================================
-- The normalising trigger.
-- ============================================================================
select lives_ok(
  $$ insert into guest_sessions (id, gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day)
     values ('00000000-0000-0000-0000-0000002803c1', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338',
             pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338'), now() + interval '1 day',
             now(), current_date - 50) $$,
  'a legacy insert (consumed_at and covered_day, no mode) is accepted'
);
select is(
  (select validity_mode || ':' || covered_kind from guest_sessions where id = '00000000-0000-0000-0000-0000002803c1'),
  'whole_day:day',
  'it is stored as whole_day / day'
);
select lives_ok(
  $$ do $d$
     declare v_id uuid;
     begin
       v_id := pg_temp.mk_session('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338');
       update guest_sessions set consumed_at = now(), covered_day = current_date - 51 where id = v_id;
     end $d$ $$,
  'a legacy update (consumed_at and covered_day on an unconsumed row) is accepted'
);
select is(
  (select count(*)::int from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000280338' and covered_day = current_date - 51
     and validity_mode = 'whole_day' and covered_kind = 'day'),
  1,
  'it is stored as whole_day / day too'
);

-- Release (the Epic 27 void): every cover column is cleared when consumed_at goes back to null.
update guest_sessions set consumed_at = null
where id = '00000000-0000-0000-0000-0000002803c1';
select is(
  (select row(consumed_at, validity_mode, covered_kind, covered_day, covered_attendance_id, covered_booking_id) is not distinct from row(null::timestamptz, null::text, null::text, null::date, null::uuid, null::uuid)
   from guest_sessions where id = '00000000-0000-0000-0000-0000002803c1'),
  true,
  'releasing a consumed day row clears mode, kind and covered_day, and the CHECK still holds'
);

-- void_staff_check_in's own release statement (0175): consumed_at, covered_day and covered_attendance_id set to null, nothing else.
insert into guest_sessions (id, gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, covered_attendance_id)
values ('00000000-0000-0000-0000-0000002803c2', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338',
        pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338'), now() + interval '1 day',
        now(), current_date - 52, null);
update guest_sessions set consumed_at = null, covered_day = null, covered_attendance_id = null
where id = '00000000-0000-0000-0000-0000002803c2';
select is(
  (select row(consumed_at, validity_mode, covered_kind, covered_day, covered_attendance_id, covered_booking_id) is not distinct from row(null::timestamptz, null::text, null::text, null::date, null::uuid, null::uuid)
   from guest_sessions where id = '00000000-0000-0000-0000-0000002803c2'),
  true,
  'the void statement of 0175 leaves an unconsumed row with no cover column'
);

-- Releasing a consumed visit row and a consumed class row by consumed_at alone clears the ids as well.
update guest_sessions set consumed_at = null
where covered_attendance_id = '00000000-0000-0000-0000-0000002803a2' or covered_booking_id = '00000000-0000-0000-0000-0000002803b2';
select is(
  (select count(*)::int from guest_sessions
   where covered_attendance_id = '00000000-0000-0000-0000-0000002803a2' or covered_booking_id = '00000000-0000-0000-0000-0000002803b2'),
  0,
  'releasing a visit row and a class row by consumed_at alone clears their ids'
);
select is(
  (select count(*)::int from guest_sessions where consumed_at is null and (validity_mode is not null or covered_kind is not null
     or covered_day is not null or covered_attendance_id is not null or covered_booking_id is not null)),
  0,
  'no unconsumed row carries a cover column'
);

-- ============================================================================
-- private.consume_guest_session: unchanged contract, plus the whole_day / day stamp. audit_session_consumed carries them.
-- ============================================================================
select is(
  pg_get_function_result('private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure),
  'TABLE(outcome text, session_created_at timestamp with time zone, session_id uuid)',
  'the consume function keeps its signature and its three result columns'
);

select pg_temp.mk_session('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280332');

select is(
  (select outcome from private.consume_guest_session('00000000-0000-0000-0000-000000280332', '00000000-0000-0000-0000-000000280311', now())),
  'consumed',
  'the consume function consumes a usable session'
);
select is(
  (select validity_mode || ':' || covered_kind || ':' || (covered_day is not null)::text from guest_sessions
   where member_id = '00000000-0000-0000-0000-000000280332' and consumed_at is not null),
  'whole_day:day:true',
  'the consumed row is whole_day / day with a covered_day'
);
select is(
  (select outcome from private.consume_guest_session('00000000-0000-0000-0000-000000280332', '00000000-0000-0000-0000-000000280311', now())),
  'covered',
  'a second call the same day is covered and consumes nothing more'
);
select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000280332' and consumed_at is not null),
  1,
  'exactly one consumed session for the day'
);
select is(
  (select outcome from private.consume_guest_session('00000000-0000-0000-0000-000000280333', '00000000-0000-0000-0000-000000280311', now())),
  'exempt',
  'a member with no pay-per-session plan is exempt (unchanged)'
);
select is(
  (select metadata - 'guest_session_id' - 'consumed_at' - 'covered_day' from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000280332'),
  '{"source": "free", "payment_id": null, "validity_mode": "whole_day", "covered_kind": "day"}'::jsonb,
  'the session_consumed audit row carries validity_mode and covered_kind next to source and payment_id'
);
select ok(
  (select metadata ? 'covered_day' and metadata ? 'consumed_at' from audit_log
   where action_type = 'session_consumed' and target_entity_id = '00000000-0000-0000-0000-000000280332'),
  'and still carries covered_day and consumed_at'
);

-- ============================================================================
-- Tenant isolation of the cover columns (NFR-001).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280311","app_role":"owner"}', true);
select ok(
  (select count(*) from guest_sessions where covered_kind = 'day') > 0,
  'the owner of gym A reads cover columns of gym A''s sessions'
);
select is(
  (select count(*)::int from guest_sessions where gym_id <> '00000000-0000-0000-0000-000000280311'),
  0,
  'and none of another gym''s'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280326","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280312","app_role":"owner"}', true);
select is(
  (select count(*)::int from guest_sessions where covered_kind is not null or validity_mode is not null),
  0,
  'the owner of gym B sees no cover column of gym A'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280311","app_role":"member"}', true);
select is(
  (select count(distinct member_id)::int from guest_sessions),
  1,
  'member 1 sees only their own rows'
);
select is(
  (select validity_mode || ':' || covered_kind from guest_sessions where consumed_at is not null),
  'whole_day:day',
  'including their own row''s cover columns'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280329","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280312","app_role":"member"}', true);
select is(
  (select count(*)::int from guest_sessions),
  0,
  'a member of gym B sees no session of gym A'
);
reset role;

-- The write grants are unchanged: no client role can write guest_sessions.
select ok(
  not has_table_privilege('authenticated', 'public.guest_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.guest_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.guest_sessions', 'DELETE'),
  'no client write grant on guest_sessions'
);
select ok(
  not has_function_privilege('anon', 'private.guest_sessions_normalise_cover()', 'execute')
  and not has_function_privilege('authenticated', 'private.guest_sessions_normalise_cover()', 'execute')
  and not has_function_privilege('anon', 'private.guest_sessions_check_visit_has_attendance()', 'execute')
  and not has_function_privilege('authenticated', 'private.guest_sessions_check_visit_has_attendance()', 'execute'),
  'the two new trigger functions are not executable by any client role'
);

-- ============================================================================
-- The backfill. LAST, because it drops the cover CHECK to build the pre-migration state. The statement is 0177's, verbatim.
-- ============================================================================
select is(
  (select count(*)::int from guest_sessions where consumed_at is not null and (validity_mode is null or covered_kind is null)),
  0,
  'after the migration no consumed row lacks a mode (production rows before this test file ran)'
);

alter table guest_sessions drop constraint guest_sessions_cover_matches_kind;
alter table guest_sessions disable trigger guest_sessions_normalise_cover;

delete from guest_sessions where consumed_at is not null;

insert into guest_sessions (id, gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, voided_at, created_at) values
  ('00000000-0000-0000-0000-0000002803d1', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338',
   pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280338'),
   '2026-06-20T10:00:00Z', '2026-06-10T09:00:00Z', '2026-06-10', null, '2026-06-01T08:00:00Z'),
  ('00000000-0000-0000-0000-0000002803d2', '00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335',
   pg_temp.mk_grant('00000000-0000-0000-0000-000000280311', '00000000-0000-0000-0000-000000280335'),
   '2026-06-21T10:00:00Z', '2026-06-11T09:00:00Z', '2026-06-11', '2026-06-12T09:00:00Z', '2026-06-02T08:00:00Z');

create temp table bf_before as
  select id, consumed_at, covered_day, usable_until, voided_at, md5(row(consumed_at, covered_day, usable_until, voided_at)::text) as h
  from guest_sessions where consumed_at is not null;

select is((select count(*)::int from bf_before), 2, 'two consumed rows before the backfill (one voided)');
select is(
  (select count(*)::int from guest_sessions where consumed_at is not null and validity_mode is null),
  2,
  'before the backfill both lack a mode'
);

update public.guest_sessions
set validity_mode = 'whole_day', covered_kind = 'day'
where consumed_at is not null;

select is(
  (select count(*)::int from guest_sessions where consumed_at is not null),
  (select count(*)::int from bf_before),
  'the consumed row count is unchanged by the backfill'
);
select is(
  (select count(*)::int from guest_sessions where consumed_at is not null and (validity_mode is distinct from 'whole_day' or covered_kind is distinct from 'day')),
  0,
  'every consumed row (voided or not) is whole_day / day'
);
select is(
  (select count(*)::int from guest_sessions g join bf_before b on b.id = g.id
   where md5(row(g.consumed_at, g.covered_day, g.usable_until, g.voided_at)::text) <> b.h),
  0,
  'no covered_day, consumed_at, usable_until or voided_at value changed'
);
select is(
  (select count(*)::int from guest_sessions where consumed_at is null and (validity_mode is not null or covered_kind is not null)),
  0,
  'an unconsumed row is left alone'
);

select * from finish();
rollback;
