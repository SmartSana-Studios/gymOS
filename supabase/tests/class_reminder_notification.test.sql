-- Story 6.6: class-reminder transport (N-07) and run_class_reminder_job()'s
-- dispatch gates. Fixture/session-simulation conventions match
-- quiet_gym_alerts.test.sql (Story 6.5); class/session/booking fixture shape
-- matches class_booking_with_capacity_enforcement.test.sql (Story 12.2).

begin;
select plan(37);

-- ============================================================================
-- Task 1 RED contract: dispatch/delivery ledgers.
-- ============================================================================
select ok(
  to_regclass('private.class_reminder_dispatches') is not null,
  'private.class_reminder_dispatches exists'
);

select ok(
  to_regclass('private.class_reminder_deliveries') is not null,
  'private.class_reminder_deliveries exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.class_reminder_dispatches')),
  'class_reminder_dispatches has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.class_reminder_deliveries')),
  'class_reminder_deliveries has RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.class_reminder_dispatches')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%pending%queued%no_tokens%'
  ),
  'dispatch status is restricted to pending/queued/no_tokens'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.class_reminder_dispatches')
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%class_session_id%member_id%'
  ),
  'AC #8: the dispatch table has a natural-key unique(class_session_id, member_id) constraint'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'class_reminder_deliveries' and indexdef like '%status%'
  ),
  'the delivery ledger has a due-processing status index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'class_reminder_deliveries' and indexdef like '%push_request_id%'
  ),
  'the delivery ledger has a push-request correlation index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'class_reminder_deliveries' and indexdef like '%receipt_request_id%'
  ),
  'the delivery ledger has a receipt-request correlation index'
);

select ok(
  not has_table_privilege('authenticated', 'private.class_reminder_dispatches', 'SELECT')
  and not has_table_privilege('authenticated', 'private.class_reminder_deliveries', 'SELECT'),
  'authenticated cannot read the class-reminder ledgers'
);

select ok(
  has_table_privilege('service_role', 'private.class_reminder_dispatches', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'private.class_reminder_deliveries', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has the minimum server-side ledger access'
);

set local role service_role;
select throws_like(
  $$select private.send_class_reminder('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')$$,
  '%member or booking not found%',
  'an unknown member/session pair fails closed'
);
reset role;

-- ============================================================================
-- Fixtures
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009900', 'Class Reminder Test Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000009901', 'Class Reminder Active Gym',      '00000000-0000-0000-0000-000000009900', 'active'),
  ('00000000-0000-0000-0000-000000009902', 'Class Reminder Suspended Gym',   '00000000-0000-0000-0000-000000009900', 'suspended'),
  ('00000000-0000-0000-0000-000000009903', 'Class Reminder Deactivated Gym', '00000000-0000-0000-0000-000000009900', 'deactivated');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009910'), -- coach, Active Gym
  ('00000000-0000-0000-0000-000000009911'), -- coach, Suspended Gym
  ('00000000-0000-0000-0000-000000009912'), -- coach, Deactivated Gym
  ('00000000-0000-0000-0000-000000009921'), -- A: fires, no prior dispatch
  ('00000000-0000-0000-0000-000000009922'), -- C: session > 60 minutes out
  ('00000000-0000-0000-0000-000000009923'), -- D: session already started
  ('00000000-0000-0000-0000-000000009924'), -- E: opted out
  ('00000000-0000-0000-0000-000000009925'), -- F: cancelled booking
  ('00000000-0000-0000-0000-000000009926'), -- G: deactivated member
  ('00000000-0000-0000-0000-000000009927'), -- H: suspended gym
  ('00000000-0000-0000-0000-000000009928'), -- I: deactivated gym
  ('00000000-0000-0000-0000-000000009929'), -- J: staff role (owner), excluded despite a booking row
  ('00000000-0000-0000-0000-000000009930'), -- K: fires, preferred_language = 'fr' (AC #9)
  ('00000000-0000-0000-0000-000000009931'), -- L: fires, zero registered device tokens (no_tokens)
  ('00000000-0000-0000-0000-000000009932'), -- M: session at exactly the 60-minute boundary (inclusive, fires)
  ('00000000-0000-0000-0000-000000009933'); -- N: session just past the 60-minute boundary (does not fire yet)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009940', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009910', 'coach', 'Active Gym Coach'),
  ('00000000-0000-0000-0000-000000009941', '00000000-0000-0000-0000-000000009902', '00000000-0000-0000-0000-000000009911', 'coach', 'Suspended Gym Coach'),
  ('00000000-0000-0000-0000-000000009942', '00000000-0000-0000-0000-000000009903', '00000000-0000-0000-0000-000000009912', 'coach', 'Deactivated Gym Coach'),
  ('00000000-0000-0000-0000-000000009951', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009921', 'member', 'Fires No Prior'),
  ('00000000-0000-0000-0000-000000009952', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009922', 'member', 'More Than 60 Minutes Out'),
  ('00000000-0000-0000-0000-000000009953', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009923', 'member', 'Session Already Started'),
  ('00000000-0000-0000-0000-000000009954', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009924', 'member', 'Opted Out'),
  ('00000000-0000-0000-0000-000000009955', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009925', 'member', 'Cancelled Booking'),
  ('00000000-0000-0000-0000-000000009956', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009926', 'member', 'Deactivated Member'),
  ('00000000-0000-0000-0000-000000009957', '00000000-0000-0000-0000-000000009902', '00000000-0000-0000-0000-000000009927', 'member', 'Suspended Gym Member'),
  ('00000000-0000-0000-0000-000000009958', '00000000-0000-0000-0000-000000009903', '00000000-0000-0000-0000-000000009928', 'member', 'Deactivated Gym Member'),
  ('00000000-0000-0000-0000-000000009959', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009929', 'owner', 'Staff Member'),
  ('00000000-0000-0000-0000-000000009960', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009930', 'member', 'French Language'),
  ('00000000-0000-0000-0000-000000009961', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009931', 'member', 'No Device Tokens'),
  ('00000000-0000-0000-0000-000000009962', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009932', 'member', 'Exact 60 Minute Boundary'),
  ('00000000-0000-0000-0000-000000009963', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009933', 'member', 'Just Past 60 Minute Boundary');

-- member_preferences rows already exist (create_default_member_preferences
-- trigger, 0047) -- opted in by default. Only Member E needs an explicit
-- opt-out; Member G needs deactivated_at set directly.
update member_preferences set class_reminder_opted_out = true
where member_id = '00000000-0000-0000-0000-000000009954';

-- K: AC #9's per-member-language-preference branch (fr).
update users set preferred_language = 'fr'
where id = '00000000-0000-0000-0000-000000009930';

update members set deactivated_at = now()
where id = '00000000-0000-0000-0000-000000009956';

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000009970', '00000000-0000-0000-0000-000000009901', 'Reminder Test Class', '00000000-0000-0000-0000-000000009940', 10, 'one_off', now() + interval '59 minutes'),
  ('00000000-0000-0000-0000-000000009971', '00000000-0000-0000-0000-000000009902', 'Suspended Gym Class', '00000000-0000-0000-0000-000000009941', 10, 'one_off', now() + interval '45 minutes'),
  ('00000000-0000-0000-0000-000000009972', '00000000-0000-0000-0000-000000009903', 'Deactivated Gym Class', '00000000-0000-0000-0000-000000009942', 10, 'one_off', now() + interval '45 minutes');

insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '59 minutes'),  -- s_fire: A
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '90 minutes'),  -- s_future: C
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() - interval '5 minutes'),   -- s_past: D
  ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '45 minutes'),  -- s_optout: E
  ('00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '46 minutes'),  -- s_cancelled: F
  ('00000000-0000-0000-0000-00000000a006', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '47 minutes'),  -- s_deactivated_member: G
  ('00000000-0000-0000-0000-00000000a007', '00000000-0000-0000-0000-000000009902', '00000000-0000-0000-0000-000000009971', now() + interval '45 minutes'),  -- s_suspended_gym: H
  ('00000000-0000-0000-0000-00000000a008', '00000000-0000-0000-0000-000000009903', '00000000-0000-0000-0000-000000009972', now() + interval '45 minutes'),  -- s_deactivated_gym: I
  ('00000000-0000-0000-0000-00000000a009', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '48 minutes'),  -- s_staff: J
  ('00000000-0000-0000-0000-00000000a010', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '50 minutes'),  -- s_fr: K
  ('00000000-0000-0000-0000-00000000a011', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '52 minutes'),  -- s_no_tokens: L
  ('00000000-0000-0000-0000-00000000a012', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '60 minutes'),  -- s_boundary_exact: M (inclusive upper bound, must fire)
  ('00000000-0000-0000-0000-00000000a013', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009970', now() + interval '60 minutes' + interval '1 second');  -- s_boundary_over: N (just past, must not fire)

insert into class_bookings (id, gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000009951'), -- A
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000009952'), -- C
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000009953'), -- D
  ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000009954'), -- E
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000009955'), -- F (deleted below)
  ('00000000-0000-0000-0000-00000000b006', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a006', '00000000-0000-0000-0000-000000009956'), -- G
  ('00000000-0000-0000-0000-00000000b007', '00000000-0000-0000-0000-000000009902', '00000000-0000-0000-0000-00000000a007', '00000000-0000-0000-0000-000000009957'), -- H
  ('00000000-0000-0000-0000-00000000b008', '00000000-0000-0000-0000-000000009903', '00000000-0000-0000-0000-00000000a008', '00000000-0000-0000-0000-000000009958'), -- I
  ('00000000-0000-0000-0000-00000000b009', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a009', '00000000-0000-0000-0000-000000009959'), -- J
  ('00000000-0000-0000-0000-00000000b010', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a010', '00000000-0000-0000-0000-000000009960'), -- K
  ('00000000-0000-0000-0000-00000000b011', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a011', '00000000-0000-0000-0000-000000009961'), -- L
  ('00000000-0000-0000-0000-00000000b012', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a012', '00000000-0000-0000-0000-000000009962'), -- M
  ('00000000-0000-0000-0000-00000000b013', '00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-00000000a013', '00000000-0000-0000-0000-000000009963'); -- N

-- AC #4: cancellation is a class_bookings row DELETE (Story 12.2 design).
-- F's booking is removed before the dispatch job ever runs -- this falls out
-- naturally from the job reading live class_bookings rows, not from a
-- separate cancellation check.
delete from class_bookings where id = '00000000-0000-0000-0000-00000000b005';

insert into device_push_tokens (user_id, expo_push_token, platform) values
  ('00000000-0000-0000-0000-000000009921', 'ExponentPushToken[REMINDER-A]', 'android'),
  ('00000000-0000-0000-0000-000000009930', 'ExponentPushToken[REMINDER-K-FR]', 'ios'),
  ('00000000-0000-0000-0000-000000009932', 'ExponentPushToken[REMINDER-M-BOUNDARY]', 'android'),
  ('00000000-0000-0000-0000-000000009933', 'ExponentPushToken[REMINDER-N-OVER]', 'android');
  -- L (000...9931) deliberately gets no device_push_tokens row (no_tokens case).

-- ============================================================================
-- The dispatch job itself.
-- ============================================================================
-- Called under the default connecting (postgres) role, matching
-- run_quiet_gym_alert_job()'s precedent -- run_class_reminder_job() is
-- cron/direct-postgres only (no service_role grant), just like its sibling
-- job functions.
select lives_ok(
  $$select run_class_reminder_job()$$,
  'run_class_reminder_job() runs cleanly across every gym/booking gate'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009951'),
  1,
  'AC #1/#2: a booked session inside the 60-minute window with no prior dispatch fires exactly once'
);

-- AC #8: simulate the next cron tick. The single most important regression
-- this story must catch -- the natural-key on conflict do nothing must
-- prevent a second dispatch for the same (class_session_id, member_id) pair.
select lives_ok(
  $$select run_class_reminder_job()$$,
  'run_class_reminder_job() runs cleanly on a second (simulated) tick'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009951'),
  1,
  'AC #8: the same booking evaluated a second time produces no second dispatch row'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009952'),
  0,
  'AC #1: a booked session more than 60 minutes out has no dispatch yet'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009953'),
  0,
  'AC #1: a booked session that has already started or passed gets no dispatch'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009954'),
  0,
  'AC #3: an opted-out member is excluded even with a session inside the window'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009955'),
  0,
  'AC #4: a cancelled booking (deleted before the job ever ran) gets no dispatch'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009956'),
  0,
  'AC #6: a deactivated member is excluded even with an otherwise-eligible booking'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009957'),
  0,
  'AC #5: a suspended gym is skipped entirely, even with a would-be-eligible booking'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009958'),
  0,
  'AC #5: a deactivated gym is skipped entirely, even with a would-be-eligible booking'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009959'),
  0,
  'defense in depth: a staff-role member (owner) is excluded despite a booking row'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009962'),
  1,
  'AC #1: a session at exactly the 60-minute boundary fires (inclusive upper bound)'
);

select is(
  (select count(*)::int from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009963'),
  0,
  'AC #1: a session just past the 60-minute boundary does not fire yet'
);

-- ============================================================================
-- Push copy/payload shape.
-- ============================================================================
select is(
  (select status from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009951'),
  'queued',
  'a dispatch with a registered device token is queued, not no_tokens'
);

select is(
  (select status from private.class_reminder_dispatches where member_id = '00000000-0000-0000-0000-000000009961'),
  'no_tokens',
  'a dispatch for a member with zero registered device tokens is no_tokens, not queued'
);

select ok(
  (select q.url = 'https://exp.host/--/api/v2/push/send' and q.headers ->> 'Content-Type' = 'application/json'
   from net.http_request_queue q
   join private.class_reminder_deliveries d on d.push_request_id = q.id
   join private.class_reminder_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009951'),
  'N-07 request uses only the Expo endpoint and JSON content type'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Class reminder'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your class "Reminder Test Class" starts in 60 minutes.'
   from net.http_request_queue q
   join private.class_reminder_deliveries d on d.push_request_id = q.id
   join private.class_reminder_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009951'),
  'English N-07 copy is exact, with the class name interpolated'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-07'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,classSessionId}' = '00000000-0000-0000-0000-00000000a001'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,gymId}' = '00000000-0000-0000-0000-000000009901'
   from net.http_request_queue q
   join private.class_reminder_deliveries d on d.push_request_id = q.id
   join private.class_reminder_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009951'),
  'Expo payload data is keyed by classSessionId/gymId, camelCase, exact'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Rappel de cours'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre cours « Reminder Test Class » commence dans 60 minutes.'
   from net.http_request_queue q
   join private.class_reminder_deliveries d on d.push_request_id = q.id
   join private.class_reminder_dispatches x on x.id = d.dispatch_id
   where x.member_id = '00000000-0000-0000-0000-000000009960'),
  'AC #9: French N-07 copy is exact, with the class name interpolated, for a member with preferred_language = fr'
);

-- ============================================================================
-- Task 1's "Extend the shared delivery processor" bullet (AC #7): confirm
-- private.process_notification_deliveries() drains a class_reminder_deliveries
-- row exactly like the three precedent ledgers, reusing
-- cleanup_invalid_device_push_token() as-is.
-- ============================================================================
insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  '{"data":{"status":"error","message":"The device is not registered","details":{"error":"DeviceNotRegistered"}}}',
  false, null
from private.class_reminder_deliveries d
join private.class_reminder_dispatches x on x.id = d.dispatch_id
where x.member_id = '00000000-0000-0000-0000-000000009951';

set local role service_role;
select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'the shared processor handles a class-reminder-ledger ticket response'
);
reset role;

select is(
  (select d.status from private.class_reminder_deliveries d join private.class_reminder_dispatches x on x.id = d.dispatch_id where x.member_id = '00000000-0000-0000-0000-000000009951'),
  'device_not_registered',
  'a class-reminder-ledger DeviceNotRegistered ticket is terminal'
);

select is(
  (select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[REMINDER-A]'),
  0,
  'the shared processor reuses cleanup_invalid_device_push_token to remove the stale class-reminder token'
);

select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'the delivery processor cron entry still exists exactly once (not duplicated for the class-reminder ledger)'
);

select is(
  (select count(*)::int from cron.job where jobname = 'class_reminder_dispatcher'),
  1,
  'the class-reminder dispatcher cron entry exists exactly once'
);

select * from finish();
rollback;
