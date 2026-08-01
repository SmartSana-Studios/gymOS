-- Story 4.6: Real-Time Front-Desk Alert. Coverage for `front_desk_alerts`
-- (0034_real_time_front_desk_alert.sql) -- both the check_in() side effects
-- (alert insertion, the null-return contract, and the alert-insert ordering
-- fix) and the table's own RLS policies. Fixture/session-simulation style
-- mirrors check_in_one_open_session_enforcement.test.sql and
-- refund_recording.test.sql.

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009201', 'Front Desk Alert Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009211', 'Alert Test Gym A', '00000000-0000-0000-0000-000000009201', 30),
  ('00000000-0000-0000-0000-000000009212', 'Alert Test Gym B', '00000000-0000-0000-0000-000000009201', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009221'), -- Gym A: grace_period member (assertion a)
  ('00000000-0000-0000-0000-000000009222'), -- Gym A: expired member (assertion b)
  ('00000000-0000-0000-0000-000000009223'), -- Gym A: active member (assertion c)
  ('00000000-0000-0000-0000-000000009224'), -- Gym A: grace_period member, already has an open check-in (assertion d)
  ('00000000-0000-0000-0000-000000009225'), -- Gym A: owner (RLS)
  ('00000000-0000-0000-0000-000000009226'), -- Gym A: manager (RLS)
  ('00000000-0000-0000-0000-000000009227'), -- Gym A: receptionist (RLS)
  ('00000000-0000-0000-0000-000000009228'), -- Gym A: coach (RLS deny)
  ('00000000-0000-0000-0000-000000009229'); -- Gym B: owner (cross-gym RLS deny)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009241', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009221', 'member', 'Grace Alert Member'),
  ('00000000-0000-0000-0000-000000009242', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009222', 'member', 'Expired Alert Member'),
  ('00000000-0000-0000-0000-000000009243', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009223', 'member', 'Active Alert Member'),
  ('00000000-0000-0000-0000-000000009244', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009224', 'member', 'Grace Open-Checkin Member'),
  ('00000000-0000-0000-0000-000000009245', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009225', 'owner', 'Alert Gym A Owner'),
  ('00000000-0000-0000-0000-000000009246', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009226', 'manager', 'Alert Gym A Manager'),
  ('00000000-0000-0000-0000-000000009247', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009227', 'receptionist', 'Alert Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009248', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009228', 'coach', 'Alert Gym A Coach'),
  ('00000000-0000-0000-0000-000000009249', '00000000-0000-0000-0000-000000009212', '00000000-0000-0000-0000-000000009229', 'owner', 'Alert Gym B Owner');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009261', '00000000-0000-0000-0000-000000009211', 'Alert Gym A Monthly', 'monthly', 15000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000009271', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009241', '00000000-0000-0000-0000-000000009261', 'grace_period', current_date - 32, current_date - 2),
  ('00000000-0000-0000-0000-000000009272', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009242', '00000000-0000-0000-0000-000000009261', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000009273', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009243', '00000000-0000-0000-0000-000000009261', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009274', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009244', '00000000-0000-0000-0000-000000009261', 'grace_period', current_date - 32, current_date - 2);

-- Member 9244 already has an open, non-stale check-in (well within Gym A's
-- default 8-hour checkin_timeout_hours) -- exercises the alert-insert
-- ordering fix (assertion d).
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000009281', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009244', now() - interval '1 hour');

-- ============================================================================
-- (a) A grace_period member's check_in() call succeeds and produces exactly
-- one front_desk_alerts row -- status grace_period, dismissed_at null.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'a grace_period member can check in'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009241'),
  1,
  'exactly one front_desk_alerts row was inserted for the grace_period member'
);

select is(
  (select status from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009241')::text,
  'grace_period',
  'the alert row carries status = grace_period'
);

select is(
  (select dismissed_at from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009241'),
  null,
  'the new alert row is not dismissed'
);

-- ============================================================================
-- (b) An expired member's check_in() call returns null (no exception),
-- produces exactly one front_desk_alerts row (status expired), and zero
-- attendance_events rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select ok(
  (select check_in()) is null,
  'an expired member gets a null return on check-in (no exception)'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009242'),
  1,
  'exactly one front_desk_alerts row was inserted for the expired member'
);

select is(
  (select status from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009242')::text,
  'expired',
  'the alert row carries status = expired'
);

select is(
  (select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000009242'),
  0,
  'no attendance_events row was inserted for the expired member -- unchanged deny semantics'
);

-- ============================================================================
-- (b2) Review finding: the same expired member scanning again (still no
-- open-session lock ahead of this branch) does not produce a second alert
-- row -- idx_front_desk_alerts_one_active_per_member_status's on-conflict
-- guard keeps exactly one active, undismissed alert per member+status.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select ok(
  (select check_in()) is null,
  'a repeat check-in by the same expired member still gets a null return'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009242'),
  1,
  'a repeat check-in by the same expired member does not create a second front_desk_alerts row'
);

-- ============================================================================
-- (c) An active member's check_in() call succeeds and produces zero
-- front_desk_alerts rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select lives_ok(
  $$select check_in()$$,
  'an active member can check in'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009243'),
  0,
  'no front_desk_alerts row was inserted for the active member'
);

-- ============================================================================
-- (d) A grace_period member who already has a non-stale open check-in is
-- rejected the same way as before (unchanged behaviour) -- AND produces
-- zero front_desk_alerts rows. Proves the alert insert is placed after the
-- open-session lock's own raise exception, so it is never reached at all
-- for this case (not inserted-then-rolled-back).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"member"}',
  true
);

select throws_like(
  $$select check_in()$$,
  '%already has an open check-in%',
  'a grace_period member with an open, non-stale check-in is still rejected on a second check-in attempt'
);

reset role;

select is(
  (select count(*)::int from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009244'),
  0,
  'no front_desk_alerts row was inserted -- the alert insert is unreached, not inserted-then-rolled-back'
);

-- ============================================================================
-- RLS: owner/manager/receptionist SELECT their own gym's alerts (2 rows, from
-- (a) and (b) above -- (c) produced none, (d) was rejected before insert).
-- Coach and a cross-gym session see 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from front_desk_alerts),
  2,
  'an owner-claim session sees exactly its own gym''s 2 front_desk_alerts rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from front_desk_alerts),
  2,
  'a manager-claim session sees the same 2 rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009227","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from front_desk_alerts),
  2,
  'a receptionist-claim session sees the same 2 rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from front_desk_alerts),
  0,
  'a coach-claim session sees 0 alerts -- no AC/FR gives Coach front-desk-alert visibility'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009229","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009212","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from front_desk_alerts),
  0,
  'a Gym B owner-claim session sees 0 rows for Gym A''s alerts -- cross-gym read deny'
);

-- ============================================================================
-- RLS: owner/manager/receptionist can UPDATE (dismiss) their own gym's
-- alert row; coach cannot.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

select lives_ok(
  $$update front_desk_alerts set dismissed_at = now(), dismissed_by = '00000000-0000-0000-0000-000000009225' where member_id = '00000000-0000-0000-0000-000000009241'$$,
  'an owner-claim session can dismiss (UPDATE) their own gym''s alert row'
);

reset role;

select is(
  (select dismissed_at is not null from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009241'),
  true,
  'the alert row was actually dismissed'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009228","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"coach"}',
  true
);

with updated as (
  update front_desk_alerts set dismissed_at = now()
  where member_id = '00000000-0000-0000-0000-000000009242'
  returning id
)
select is((select count(*)::int from updated), 0, 'a coach-claim session cannot dismiss (UPDATE) an alert row -- 0 rows affected under RLS');

-- ============================================================================
-- Review finding: front_desk_alerts_protect_columns trigger rejects any
-- UPDATE touching a column other than dismissed_at/dismissed_by, even from
-- a role RLS otherwise permits to UPDATE the row at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

select throws_like(
  $$update front_desk_alerts set status = 'grace_period' where member_id = '00000000-0000-0000-0000-000000009242'$$,
  '%only dismissed_at/dismissed_by may be updated%',
  'an owner-claim session cannot rewrite an alert''s status via UPDATE, even though RLS permits the UPDATE itself'
);

-- ============================================================================
-- Review finding: dismissed_by is derived server-side from the caller's own
-- JWT by the trigger, ignoring whatever value the client sent -- closes a
-- spoofing gap where a session could attribute a dismissal to another user.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"manager"}',
  true
);

select lives_ok(
  $$update front_desk_alerts set dismissed_at = now(), dismissed_by = '00000000-0000-0000-0000-000000009228' where member_id = '00000000-0000-0000-0000-000000009242'$$,
  'a manager-claim session can dismiss member 9242''s alert (even while asserting a spoofed dismissed_by)'
);

reset role;

select is(
  (select dismissed_by from front_desk_alerts where member_id = '00000000-0000-0000-0000-000000009242'),
  '00000000-0000-0000-0000-000000009226'::uuid,
  'dismissed_by is overwritten server-side with the actual caller''s id, not the spoofed value the client sent'
);

-- ============================================================================
-- No role can INSERT directly -- only check_in() (SECURITY DEFINER) can, and
-- there is no table-level INSERT grant to `authenticated` at all (Task 1's
-- own deliberate omission), so even an owner-claim session is denied.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

select throws_like(
  $$ insert into front_desk_alerts (gym_id, member_id, status) values ('00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009243', 'expired') $$,
  '%permission denied%',
  'even an owner-claim session cannot INSERT into front_desk_alerts directly -- no table-level INSERT grant to authenticated'
);

select * from finish();
rollback;
