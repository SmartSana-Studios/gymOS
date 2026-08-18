-- Story 6.5: quiet-gym-alert transport, the private.gym_occupancy_band()
-- shared-helper refactor, the rate-limit/opt-in/gym-status/opening-hours
-- dispatch gates, and the shared delivery processor's third branch.
-- Fixture and pg_net-inspection conventions match
-- payment_notifications.test.sql (Story 6.3); occupancy-band session
-- conventions match occupancy_display_admin_attendance_page.test.sql
-- (Story 3.6).

begin;
select plan(41);

-- ============================================================================
-- Task 1 RED contract: dispatch/delivery ledgers, opening-hours columns,
-- shared occupancy helper.
-- ============================================================================
select ok(
  to_regclass('private.quiet_gym_alert_dispatches') is not null,
  'private.quiet_gym_alert_dispatches exists'
);

select ok(
  to_regclass('private.quiet_gym_alert_deliveries') is not null,
  'private.quiet_gym_alert_deliveries exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.quiet_gym_alert_dispatches')),
  'quiet_gym_alert_dispatches has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.quiet_gym_alert_deliveries')),
  'quiet_gym_alert_deliveries has RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.quiet_gym_alert_dispatches')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%pending%queued%no_tokens%'
  ),
  'dispatch status is restricted to pending/queued/no_tokens'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'quiet_gym_alert_dispatches' and indexdef like '%member_id%sent_at%'
  ),
  'the dispatch table has the rate-limit read-path index on (member_id, sent_at)'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'quiet_gym_alert_deliveries' and indexdef like '%status%'
  ),
  'the delivery ledger has a due-processing status index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'quiet_gym_alert_deliveries' and indexdef like '%push_request_id%'
  ),
  'the delivery ledger has a push-request correlation index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'quiet_gym_alert_deliveries' and indexdef like '%receipt_request_id%'
  ),
  'the delivery ledger has a receipt-request correlation index'
);

select ok(
  not has_table_privilege('authenticated', 'private.quiet_gym_alert_dispatches', 'SELECT')
  and not has_table_privilege('authenticated', 'private.quiet_gym_alert_deliveries', 'SELECT'),
  'authenticated cannot read the quiet-gym-alert ledgers'
);

select ok(
  has_table_privilege('service_role', 'private.quiet_gym_alert_dispatches', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'private.quiet_gym_alert_deliveries', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has the minimum server-side ledger access'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name = 'opening_time'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gyms' and column_name = 'closing_time'
  ),
  'gyms gained nullable opening_time/closing_time columns'
);

set local role service_role;
select throws_like(
  $$select private.send_quiet_gym_alert('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%member not found%',
  'an unknown member id fails closed'
);
reset role;

-- ============================================================================
-- Fixtures
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009700', 'Quiet Gym Alert Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status, capacity, timezone) values
  ('00000000-0000-0000-0000-000000009701', 'Low Band Gym',      '00000000-0000-0000-0000-000000009700', 'active',      10, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000009702', 'Medium Band Gym',   '00000000-0000-0000-0000-000000009700', 'active',       2, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000009703', 'Busy Band Gym',     '00000000-0000-0000-0000-000000009700', 'active',       1, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000009704', 'Suspended Gym',     '00000000-0000-0000-0000-000000009700', 'suspended',   10, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000009705', 'Deactivated Gym',   '00000000-0000-0000-0000-000000009700', 'deactivated', 10, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000009708', 'Null Capacity Gym', '00000000-0000-0000-0000-000000009700', 'active',    null, 'Africa/Douala');

-- Opening-hours fixtures (AC #5). "Outside": a fixed 10-minute window on the
-- opposite half of the clock from the current UTC hour, guaranteed to never
-- contain "now" and never cross midnight (no wraparound ambiguity). "Inside":
-- the entire day, trivially always containing "now" -- both are deterministic
-- regardless of the wall-clock time the suite runs at.
insert into gyms (id, name, tier_id, status, capacity, timezone, opening_time, closing_time) values (
  '00000000-0000-0000-0000-000000009706', 'Hours Outside Window Gym', '00000000-0000-0000-0000-000000009700', 'active', 10, 'UTC',
  case when extract(hour from (now() at time zone 'UTC')) < 12 then time '13:00:00' else time '01:00:00' end,
  case when extract(hour from (now() at time zone 'UTC')) < 12 then time '13:10:00' else time '01:10:00' end
);
insert into gyms (id, name, tier_id, status, capacity, timezone, opening_time, closing_time) values (
  '00000000-0000-0000-0000-000000009707', 'Hours Inside Window Gym', '00000000-0000-0000-0000-000000009700', 'active', 10, 'UTC',
  '00:00:00', '23:59:59.999999'
);

-- Overnight (wraparound) opening-hours fixture (AC #5 regression): opening_time
-- > closing_time, e.g. a real 22:00-06:00 quiet-hours window, where a plain
-- BETWEEN can never be satisfied. Deterministic regardless of wall-clock time:
-- excludes only a 1-minute sliver on the opposite half of the clock from "now"
-- (mirroring the Outside/Inside fixtures' own determinism technique), so "now"
-- always falls inside this window.
insert into gyms (id, name, tier_id, status, capacity, timezone, opening_time, closing_time) values (
  '00000000-0000-0000-0000-000000009709', 'Overnight Window Gym', '00000000-0000-0000-0000-000000009700', 'active', 10, 'UTC',
  case when extract(hour from (now() at time zone 'UTC')) < 12 then time '13:00:00' else time '01:00:00' end,
  case when extract(hour from (now() at time zone 'UTC')) < 12 then time '12:59:00' else time '00:59:00' end
);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009711'), -- A: fires, no prior dispatch
  ('00000000-0000-0000-0000-000000009712'), -- B: 2 prior dispatches in 24h, blocked
  ('00000000-0000-0000-0000-000000009713'), -- C: 1 prior dispatch 1h ago, blocked by 3h gap
  ('00000000-0000-0000-0000-000000009714'), -- D: 1 prior dispatch 5h ago, fires again
  ('00000000-0000-0000-0000-000000009715'), -- E: opted out
  ('00000000-0000-0000-0000-000000009716'), -- F: deactivated
  ('00000000-0000-0000-0000-000000009717'), -- G: medium band, excluded
  ('00000000-0000-0000-0000-000000009718'), -- H: busy band, excluded
  ('00000000-0000-0000-0000-000000009719'), -- I: suspended gym, excluded
  ('00000000-0000-0000-0000-000000009720'), -- J: deactivated gym, excluded
  ('00000000-0000-0000-0000-000000009721'), -- K: outside opening hours, excluded
  ('00000000-0000-0000-0000-000000009722'), -- L: inside opening hours, fires
  ('00000000-0000-0000-0000-000000009723'), -- M: null-capacity band-parity session
  ('00000000-0000-0000-0000-000000009724'), -- N: overnight opening-hours window, fires
  ('00000000-0000-0000-0000-000000009725'); -- O: staff role (owner), excluded despite opt-in

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009731', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009711', 'member', 'Fires No Prior'),
  ('00000000-0000-0000-0000-000000009732', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009712', 'member', 'Rate Limited By Count'),
  ('00000000-0000-0000-0000-000000009733', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009713', 'member', 'Rate Limited By Gap'),
  ('00000000-0000-0000-0000-000000009734', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009714', 'member', 'Fires Again After Gap'),
  ('00000000-0000-0000-0000-000000009735', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009715', 'member', 'Opted Out'),
  ('00000000-0000-0000-0000-000000009736', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009716', 'member', 'Deactivated Member'),
  ('00000000-0000-0000-0000-000000009737', '00000000-0000-0000-0000-000000009702', '00000000-0000-0000-0000-000000009717', 'member', 'Medium Band Member'),
  ('00000000-0000-0000-0000-000000009738', '00000000-0000-0000-0000-000000009703', '00000000-0000-0000-0000-000000009718', 'member', 'Busy Band Member'),
  ('00000000-0000-0000-0000-000000009739', '00000000-0000-0000-0000-000000009704', '00000000-0000-0000-0000-000000009719', 'member', 'Suspended Gym Member'),
  ('00000000-0000-0000-0000-000000009740', '00000000-0000-0000-0000-000000009705', '00000000-0000-0000-0000-000000009720', 'member', 'Deactivated Gym Member'),
  ('00000000-0000-0000-0000-000000009741', '00000000-0000-0000-0000-000000009706', '00000000-0000-0000-0000-000000009721', 'member', 'Outside Hours Member'),
  ('00000000-0000-0000-0000-000000009742', '00000000-0000-0000-0000-000000009707', '00000000-0000-0000-0000-000000009722', 'member', 'Inside Hours Member'),
  ('00000000-0000-0000-0000-000000009743', '00000000-0000-0000-0000-000000009708', '00000000-0000-0000-0000-000000009723', 'member', 'Null Capacity Member'),
  ('00000000-0000-0000-0000-000000009744', '00000000-0000-0000-0000-000000009709', '00000000-0000-0000-0000-000000009724', 'member', 'Overnight Hours Member'),
  ('00000000-0000-0000-0000-000000009745', '00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009725', 'owner', 'Staff Member');

-- member_preferences rows already exist (create_default_member_preferences
-- trigger, 0047) -- opted in by default. Only Member E needs an explicit
-- opt-out; Member F needs deactivated_at set directly.
update member_preferences set quiet_gym_alerts_opted_out = true
where member_id = '00000000-0000-0000-0000-000000009735';

update members set deactivated_at = now()
where id = '00000000-0000-0000-0000-000000009736';

-- Checked-in occupancy fixtures: one open attendance_events row per
-- band/gate-testing gym, sized against each gym's small capacity above so no
-- filler members are needed (1/10 = 10% low, 1/2 = 50% medium, 1/1 = 100% busy).
insert into attendance_events (gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009731', now()),
  ('00000000-0000-0000-0000-000000009702', '00000000-0000-0000-0000-000000009737', now()),
  ('00000000-0000-0000-0000-000000009703', '00000000-0000-0000-0000-000000009738', now()),
  ('00000000-0000-0000-0000-000000009706', '00000000-0000-0000-0000-000000009741', now()),
  ('00000000-0000-0000-0000-000000009707', '00000000-0000-0000-0000-000000009742', now()),
  ('00000000-0000-0000-0000-000000009709', '00000000-0000-0000-0000-000000009744', now());

-- Pre-existing dispatch rows for the rate-limit gate (AC #4). Inserted
-- directly (service_role/table-owner access) -- the point under test is
-- run_quiet_gym_alert_job()'s read of this table, not send_quiet_gym_alert's
-- own insert path (already covered by the "fires" assertions below).
insert into private.quiet_gym_alert_dispatches (member_id, gym_id, sent_at, status) values
  ('00000000-0000-0000-0000-000000009732', '00000000-0000-0000-0000-000000009701', now() - interval '20 hours', 'queued'),
  ('00000000-0000-0000-0000-000000009732', '00000000-0000-0000-0000-000000009701', now() - interval '10 hours', 'queued'),
  ('00000000-0000-0000-0000-000000009733', '00000000-0000-0000-0000-000000009701', now() - interval '1 hour', 'queued'),
  ('00000000-0000-0000-0000-000000009734', '00000000-0000-0000-0000-000000009701', now() - interval '5 hours', 'queued');

insert into device_push_tokens (user_id, expo_push_token, platform) values
  ('00000000-0000-0000-0000-000000009711', 'ExponentPushToken[QUIET-A]', 'android');

-- ============================================================================
-- AC #3: private.gym_occupancy_band() and member_occupancy_band() agree,
-- including the null-capacity case -- proof the refactor is behavior
-- preserving.
-- ============================================================================
set local role service_role;
select is(
  private.gym_occupancy_band('00000000-0000-0000-0000-000000009701'),
  'low',
  'private.gym_occupancy_band() returns low at 1/10 (10%%) checked in'
);
select is(
  private.gym_occupancy_band('00000000-0000-0000-0000-000000009708'),
  null::text,
  'private.gym_occupancy_band() returns null for a gym with no capacity configured'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009711","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009701","app_role":"member"}',
  true
);
select is(
  member_occupancy_band(),
  'low',
  'member_occupancy_band() delegates to the shared helper and still returns low'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009723","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009708","app_role":"member"}',
  true
);
select is(
  member_occupancy_band(),
  null::text,
  'member_occupancy_band() still returns null for a gym with no capacity configured'
);
reset role;

-- ============================================================================
-- The dispatch job itself.
-- ============================================================================
-- Called under the default connecting (postgres) role, matching
-- subscription_lifecycle_cron.test.sql's precedent -- run_quiet_gym_alert_job()
-- is cron/direct-postgres only (no service_role grant), just like its
-- sibling job functions.
select lives_ok(
  $$select run_quiet_gym_alert_job()$$,
  'run_quiet_gym_alert_job() runs cleanly across every gym/member gate'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009731'),
  1,
  'AC #2: an opted-in, non-deactivated member in a Low-band gym with no prior dispatch fires exactly once'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009732'),
  2,
  'AC #4: a member already at 2 dispatches in the rolling 24h window gets no third dispatch'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009733'),
  1,
  'AC #4: a member whose most recent dispatch was under 3 hours ago is blocked by the minimum-gap gate'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009734'),
  2,
  'AC #4: a member whose most recent dispatch was over 3 hours ago (and under the 2/24h cap) fires again'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009735'),
  0,
  'an opted-out member is excluded even in a Low-band gym'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009736'),
  0,
  'a deactivated member is excluded even when opted in and the gym is Low-band'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009737'),
  0,
  'a Medium-band gym dispatches nothing regardless of opt-in state'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009738'),
  0,
  'a Busy-band gym dispatches nothing regardless of opt-in state'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009739'),
  0,
  'AC #6: a suspended gym is skipped entirely, even with a would-be-eligible member'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009740'),
  0,
  'AC #6: a deactivated gym is skipped entirely, even with a would-be-eligible member'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009741'),
  0,
  'AC #5: a gym with both opening/closing hours configured, current time outside the window, dispatches nothing'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009742'),
  1,
  'AC #5: a gym with both opening/closing hours configured, current time inside the window, still fires'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009744'),
  1,
  'AC #5 regression: an overnight opening-hours window (opening_time > closing_time) still fires when the current local time falls inside it'
);

select is(
  (select count(*)::int from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009745'),
  0,
  'a gym staff member (role != member) is excluded from N-06 delivery even when opted in and the gym is Low-band'
);

-- ============================================================================
-- AC #7/#8: the send function's push request/delivery shape and exact copy.
-- ============================================================================
select is(
  (select status from private.quiet_gym_alert_dispatches where member_id = '00000000-0000-0000-0000-000000009731'),
  'queued',
  'a dispatch with a registered device token is queued, not no_tokens'
);

select ok(
  (select q.url = 'https://exp.host/--/api/v2/push/send' and q.headers ->> 'Content-Type' = 'application/json'
   from net.http_request_queue q
   join private.quiet_gym_alert_deliveries d on d.push_request_id = q.id
   join private.quiet_gym_alert_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009731'),
  'N-06 request uses only the Expo endpoint and JSON content type'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Your gym is quiet right now'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'It''s a great time to train at Low Band Gym — occupancy is low.'
   from net.http_request_queue q
   join private.quiet_gym_alert_deliveries d on d.push_request_id = q.id
   join private.quiet_gym_alert_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009731'),
  'English N-06 copy is exact'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-06'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,memberId}' = '00000000-0000-0000-0000-000000009731'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,gymId}' = '00000000-0000-0000-0000-000000009701'
   from net.http_request_queue q
   join private.quiet_gym_alert_deliveries d on d.push_request_id = q.id
   join private.quiet_gym_alert_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009731'),
  'Expo payload data is keyed by memberId/gymId, camelCase, exact'
);

-- ============================================================================
-- Task 1's "Extend the shared delivery processor" bullet (AC #7): confirm
-- private.process_notification_deliveries() drains a quiet_gym_alert_deliveries
-- row exactly like the two precedent ledgers, reusing
-- cleanup_invalid_device_push_token() as-is.
-- ============================================================================
insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  '{"data":{"status":"error","message":"The device is not registered","details":{"error":"DeviceNotRegistered"}}}',
  false, null
from private.quiet_gym_alert_deliveries d
join private.quiet_gym_alert_dispatches x on x.id = d.dispatch_id
where x.member_id = '00000000-0000-0000-0000-000000009731';

set local role service_role;
select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'the shared processor handles a quiet-gym-alert-ledger ticket response'
);
reset role;

select is(
  (select d.status from private.quiet_gym_alert_deliveries d join private.quiet_gym_alert_dispatches x on x.id = d.dispatch_id where x.member_id = '00000000-0000-0000-0000-000000009731'),
  'device_not_registered',
  'a quiet-gym-alert-ledger DeviceNotRegistered ticket is terminal'
);

select is(
  (select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[QUIET-A]'),
  0,
  'the shared processor reuses cleanup_invalid_device_push_token to remove the stale quiet-gym-alert token'
);

select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'the delivery processor cron entry still exists exactly once (not duplicated for the quiet-gym-alert ledger)'
);

select is(
  (select count(*)::int from cron.job where jobname = 'quiet_gym_alert_dispatcher'),
  1,
  'the quiet-gym-alert dispatcher cron entry exists exactly once'
);

select * from finish();
rollback;
