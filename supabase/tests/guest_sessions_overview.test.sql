-- Story 19.10 (migration 0114), positive paths: the summary figures, the three
-- paged lists, recorder grouping with full-window totals, refund states and the
-- chip filter, the offline attempt time, and card/list agreement.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000370xx.

begin;
select plan(31);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000037001', 'Overview Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000037011', 'Overview Gym', '00000000-0000-0000-0000-000000037001', 'active', true, 0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000037021'), -- owner
  ('00000000-0000-0000-0000-000000037022'), -- manager
  ('00000000-0000-0000-0000-000000037023'), -- receptionist
  ('00000000-0000-0000-0000-000000037031'), -- member A
  ('00000000-0000-0000-0000-000000037032'), -- member B
  ('00000000-0000-0000-0000-000000037033'), -- member C
  ('00000000-0000-0000-0000-000000037024'); -- coach

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000037041', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037021', 'owner', 'Ov Owner', current_date),
  ('00000000-0000-0000-0000-000000037042', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037022', 'manager', 'Ov Manager', current_date),
  ('00000000-0000-0000-0000-000000037043', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037023', 'receptionist', 'Ov Receptionist', current_date),
  ('00000000-0000-0000-0000-000000037044', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037024', 'coach', 'Ov Coach', current_date),
  ('00000000-0000-0000-0000-000000037051', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037031', 'member', 'Ov Member A', current_date),
  ('00000000-0000-0000-0000-000000037052', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037032', 'member', 'Ov Member B', current_date),
  ('00000000-0000-0000-0000-000000037053', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037033', 'member', 'Ov Member C', current_date);

-- Six session payments: P1/P2 recorded by the owner, P3/P4 by the manager,
-- P5 through the in-app provider (member as actor), P6 unconsumed and refunded.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id, provider) values
  ('00000000-0000-0000-0000-000000037061', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', 5000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037021', null),
  ('00000000-0000-0000-0000-000000037062', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', 5000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037021', null),
  ('00000000-0000-0000-0000-000000037063', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', 3000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037022', null),
  ('00000000-0000-0000-0000-000000037064', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', 3000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037022', null),
  ('00000000-0000-0000-0000-000000037065', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', 4000, 'XAF', 'mobile_money', 'verified', 'session', '00000000-0000-0000-0000-000000037032', 'taramoney'),
  ('00000000-0000-0000-0000-000000037066', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', 2000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037021', null),
  -- Not counted: a subscription payment, an unverified session payment and a
  -- voided one.
  ('00000000-0000-0000-0000-000000037067', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', 9000, 'XAF', 'cash', 'verified', 'subscription', '00000000-0000-0000-0000-000000037021', null),
  ('00000000-0000-0000-0000-000000037068', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', 5000, 'XAF', 'cash', 'pending', 'session', '00000000-0000-0000-0000-000000037021', null);

insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until, consumed_at, covered_day, voided_at) values
  ('00000000-0000-0000-0000-000000037071', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', '00000000-0000-0000-0000-000000037061', now() + interval '5 days', now(), current_date, null),
  ('00000000-0000-0000-0000-000000037072', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', '00000000-0000-0000-0000-000000037062', now() + interval '5 days', null, null, null),
  ('00000000-0000-0000-0000-000000037073', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', '00000000-0000-0000-0000-000000037063', now() + interval '5 days', null, null, null),
  ('00000000-0000-0000-0000-000000037074', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', '00000000-0000-0000-0000-000000037064', now() + interval '5 days', null, null, null),
  ('00000000-0000-0000-0000-000000037075', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', '00000000-0000-0000-0000-000000037065', now() + interval '5 days', null, null, null),
  ('00000000-0000-0000-0000-000000037076', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', '00000000-0000-0000-0000-000000037066', now() + interval '5 days', null, null, now());

-- P1 was consumed and then refunded; P6 was refunded unconsumed (voided above).
insert into refunds (gym_id, payment_id, amount, reason, actor_id) values
  ('00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037061', 5000, 'after use', '00000000-0000-0000-0000-000000037021'),
  ('00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037066', 2000, 'unused', '00000000-0000-0000-0000-000000037021');

-- A class for the class-sourced attempt.
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000037081', '00000000-0000-0000-0000-000000037011', 'Ov Spin', '00000000-0000-0000-0000-000000037044', 10, 'one_off', now());
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-000000037082', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037081', now());

-- Three attempts by two members: one offline (scanned an hour ago), one class.
insert into session_attempts (id, gym_id, member_id, scan_id, source, scanned_at, class_session_id) values
  ('00000000-0000-0000-0000-000000037091', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', null, 'check_in', null, null),
  ('00000000-0000-0000-0000-000000037092', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', '00000000-0000-0000-0000-0000000370a1', 'check_in', now() - interval '1 hour', null),
  ('00000000-0000-0000-0000-000000037093', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', null, 'class', null, '00000000-0000-0000-0000-000000037082');
-- An old attempt outside this month.
insert into session_attempts (id, gym_id, member_id, source, created_at) values
  ('00000000-0000-0000-0000-000000037094', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', 'check_in', now() - interval '70 days');

-- Free sessions are 0 until Epic 20; one backdated paid row is outside the month.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id, created_at) values
  ('00000000-0000-0000-0000-000000037069', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', 7000, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037021', now() - interval '70 days');

-- Review fixtures. (b) a verified session payment and an attempt one hour
-- before gym-local midnight: in 'month' only when today is not the 1st (local),
-- never in 'today'. Its actor is null with no provider, so it groups as unknown
-- and leaves the owner/manager groups alone.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id, created_at)
select '00000000-0000-0000-0000-0000000370b1', g.id, '00000000-0000-0000-0000-000000037051', 1500, 'XAF', 'cash', 'verified', 'session', null,
       b.day_start - interval '1 hour'
from gyms g, private.gym_local_day_bounds(g.timezone, now()) b
where g.id = '00000000-0000-0000-0000-000000037011';

insert into session_attempts (id, gym_id, member_id, source, created_at)
select '00000000-0000-0000-0000-0000000370b3', g.id, '00000000-0000-0000-0000-000000037053', 'check_in',
       b.day_start - interval '1 hour'
from gyms g, private.gym_local_day_bounds(g.timezone, now()) b
where g.id = '00000000-0000-0000-0000-000000037011';

-- (c) a verified session payment that was voided: never counted or listed.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, actor_id, voided_at) values
  ('00000000-0000-0000-0000-0000000370b2', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', 2500, 'XAF', 'cash', 'verified', 'session', '00000000-0000-0000-0000-000000037021', now());

-- (a) free sessions (loyalty grant, no payment): voided, used, lapsed,
-- available, and one created outside the month.
insert into guest_sessions (id, gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, covered_day, voided_at, created_at) values
  ('00000000-0000-0000-0000-0000000370c1', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', gen_random_uuid(), now() + interval '30 days', null, null, now(), now()),
  ('00000000-0000-0000-0000-0000000370c2', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037052', gen_random_uuid(), now() + interval '30 days', now(), current_date, null, now()),
  ('00000000-0000-0000-0000-0000000370c3', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037053', gen_random_uuid(), now() - interval '1 day', null, null, null, now()),
  ('00000000-0000-0000-0000-0000000370c4', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', gen_random_uuid(), now() + interval '30 days', null, null, null, now()),
  ('00000000-0000-0000-0000-0000000370c5', '00000000-0000-0000-0000-000000037011', '00000000-0000-0000-0000-000000037051', gen_random_uuid(), now() + interval '30 days', null, null, null, now() - interval '70 days');

-- 1 when the "before local midnight" rows still fall in the current month.
create temp table fx as
select case when extract(day from (now() at time zone g.timezone)) > 1 then 1 else 0 end as extra
from gyms g where g.id = '00000000-0000-0000-0000-000000037011';
grant select on fx to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000037022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000037011","app_role":"manager"}', true);

-- Summary ---------------------------------------------------------------------
select is((select paid_count from guest_sessions_summary('month')), (6 + (select extra from fx))::bigint,
  'month: six verified session payments plus the one before local midnight (refunded ones included, voided and others excluded)');
select is((select blocked_count from guest_sessions_summary('month')), (3 + (select extra from fx))::bigint, 'month: three blocked attempts plus the one before local midnight');
select is((select blocked_count from guest_sessions_summary('today')), 3::bigint, 'today: the attempt before local midnight is excluded');
select is((select blocked_members from guest_sessions_summary('month')), (2 + (select extra from fx))::bigint, 'month: distinct members');
select is((select free_count from guest_sessions_summary('month')), 4::bigint, 'month: four free sessions, the one outside the month excluded');
select is((select free_count from guest_sessions_summary('today')), 4::bigint, 'today: same four free sessions');
select is((select paid_count from guest_sessions_summary('today')), 6::bigint, 'today: same paid count');

-- Paid list, grouped by recorder ----------------------------------------------
select is((select count(*)::int from list_guest_sessions_paid('month')), 6 + (select extra from fx), 'paid: six rows plus the before-midnight one');
select is((select max(total_count) from list_guest_sessions_paid('month')), (6 + (select extra from fx))::bigint, 'paid: total_count is the full set');
select is((select count(*)::int from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-0000000370b1'), (select extra from fx), 'paid: the before-midnight payment is in month only when still in the month');
select is((select count(*)::int from list_guest_sessions_paid('today') where payment_id = '00000000-0000-0000-0000-0000000370b1'), 0, 'paid: the before-midnight payment is not in today');
select is((select count(*)::int from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-0000000370b2'), 0, 'paid: a voided session payment is not listed');
select is(
  (select group_sessions from list_guest_sessions_paid('month') where recorder_name = 'Ov Owner' limit 1),
  3::bigint, 'paid: owner group has 3 sessions');
select is(
  (select group_total from list_guest_sessions_paid('month') where recorder_name = 'Ov Owner' limit 1),
  12000::bigint, 'paid: owner group totals 12000');
select is(
  (select group_total from list_guest_sessions_paid('month') where recorder_name = 'Ov Manager' limit 1),
  6000::bigint, 'paid: manager group totals 6000');
select is(
  (select recorder_kind from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-000000037065'),
  'tara', 'paid: provider payment with a member actor groups as Tara');
select is(
  (select recorder_name from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-000000037065'),
  null, 'paid: a Tara row carries no staff name');
select is(
  (select group_sessions from list_guest_sessions_paid('month', false, true, 2, 0) limit 1),
  2::bigint, 'paid: group totals survive paging (first page is the 2-row manager group)');
select is((select count(*)::int from list_guest_sessions_paid('month', false, true, 2, 4)), 2, 'paid: last page of 2');

-- Refund column and chip -------------------------------------------------------
select is(
  (select refund_state from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-000000037066'),
  'refunded', 'paid: unconsumed + voided is Refunded');
select is(
  (select refund_state from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-000000037061'),
  'refunded_after_use', 'paid: consumed + refund is Refunded after use');
select is(
  (select refund_state from list_guest_sessions_paid('month') where payment_id = '00000000-0000-0000-0000-000000037062'),
  'none', 'paid: untouched row has no refund state');
select is(
  (select array_agg(payment_id) from list_guest_sessions_paid('month', true)),
  array['00000000-0000-0000-0000-000000037061']::uuid[], 'chip: only the refunded-after-use row');

-- No grouping ------------------------------------------------------------------
select is(
  (select count(*)::int from list_guest_sessions_paid('month', false, false) where group_sessions is not null),
  0, 'group by None: no group totals');

-- Blocked attempts -------------------------------------------------------------
select is((select count(*)::int from list_session_attempts('month')), 3 + (select extra from fx), 'attempts: three rows plus the before-midnight one in the month');
select is(
  (select scanned_at is not null and attempt_time = scanned_at from list_session_attempts('month')
   where attempt_id = '00000000-0000-0000-0000-000000037092'),
  true, 'attempts: offline row shows the scan time');
select is(
  (select class_name from list_session_attempts('month') where attempt_id = '00000000-0000-0000-0000-000000037093'),
  'Ov Spin', 'attempts: class name resolved');

-- Free list is empty and consistent with the card -------------------------------
select is((select array_agg(status order by status) from list_free_guest_sessions('month')), array['available','lapsed','used','voided'], 'free: one row per status, outside-month row excluded');
select is((select max(total_count) from list_free_guest_sessions('month')), (select free_count from guest_sessions_summary('month')), 'free: list total equals the card figure');
select is((select count(*)::int from list_free_guest_sessions('month') where session_id = '00000000-0000-0000-0000-0000000370c5'), 0, 'free: the session earned outside the month is not listed');

-- Card equals list totals --------------------------------------------------------
select is(
  (select paid_count from guest_sessions_summary('month')),
  (select max(total_count) from list_guest_sessions_paid('month')),
  'card paid figure equals the Paid tab total');

select * from finish();
rollback;
