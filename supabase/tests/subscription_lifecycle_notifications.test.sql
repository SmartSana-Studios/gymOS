-- Story 6.2: subscription lifecycle notification transport, lifecycle
-- dispatch, Expo ticket/receipt processing, and idempotency coverage.

begin;
select plan(80);

-- Task 1 RED contract: internal logical-dispatch and per-device ledgers.
select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net is installed'
);

select ok(
  to_regclass('private.notification_dispatches') is not null,
  'private.notification_dispatches exists'
);

select ok(
  to_regclass('private.notification_deliveries') is not null,
  'private.notification_deliveries exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.notification_dispatches')),
  'notification_dispatches has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.notification_deliveries')),
  'notification_deliveries has RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.notification_dispatches')
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (subscription_id, notification_code)'
  ),
  'logical dispatches are unique by subscription and notification code'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.notification_dispatches')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%N-01%N-02%N-03%'
  ),
  'logical dispatch notification codes are restricted to N-01/N-02/N-03'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'notification_deliveries'
      and indexdef like '%status%'
  ),
  'delivery ledger has a due-processing status index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'notification_deliveries'
      and indexdef like '%push_request_id%'
  ),
  'delivery ledger has a push-request correlation index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'notification_deliveries'
      and indexdef like '%receipt_request_id%'
  ),
  'delivery ledger has a receipt-request correlation index'
);

select ok(
  not has_table_privilege('authenticated', 'private.notification_dispatches', 'SELECT')
  and not has_table_privilege('authenticated', 'private.notification_deliveries', 'SELECT'),
  'authenticated cannot read internal notification ledgers'
);

select ok(
  has_table_privilege('service_role', 'private.notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'private.notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has the minimum server-side ledger access'
);

-- Task 2 contract: all message inputs are derived from the subscription.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006201', 'Lifecycle Push Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000006202', 'Bonamoussadi Gym', '00000000-0000-0000-0000-000000006201'),
  ('00000000-0000-0000-0000-000000006203', 'Akwa Gym', '00000000-0000-0000-0000-000000006201');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000006210'),
  ('00000000-0000-0000-0000-000000006211'),
  ('00000000-0000-0000-0000-000000006212'),
  ('00000000-0000-0000-0000-000000006213');

update users set preferred_language = 'fr' where id = '00000000-0000-0000-0000-000000006211';
update users set preferred_language = 'de' where id = '00000000-0000-0000-0000-000000006212';

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000006220', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006210', 'member', 'English Member'),
  ('00000000-0000-0000-0000-000000006221', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006211', 'member', 'French Member'),
  ('00000000-0000-0000-0000-000000006222', '00000000-0000-0000-0000-000000006203', '00000000-0000-0000-0000-000000006212', 'member', 'Fallback Member'),
  ('00000000-0000-0000-0000-000000006223', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006213', 'member', 'No Token Member'),
  ('00000000-0000-0000-0000-000000006224', '00000000-0000-0000-0000-000000006203', '00000000-0000-0000-0000-000000006210', 'member', 'English Member Second Gym');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000006230', '00000000-0000-0000-0000-000000006202', 'Lifecycle Monthly One', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000006231', '00000000-0000-0000-0000-000000006203', 'Lifecycle Monthly Two', 'monthly', 10000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000006240', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006220', '00000000-0000-0000-0000-000000006230', 'active', current_date - 30, current_date + 7),
  ('00000000-0000-0000-0000-000000006241', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006221', '00000000-0000-0000-0000-000000006230', 'expiring_soon', current_date - 30, current_date + 1),
  ('00000000-0000-0000-0000-000000006242', '00000000-0000-0000-0000-000000006203', '00000000-0000-0000-0000-000000006222', '00000000-0000-0000-0000-000000006231', 'grace_period', current_date - 30, current_date - 4),
  ('00000000-0000-0000-0000-000000006243', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006223', '00000000-0000-0000-0000-000000006230', 'active', current_date - 30, current_date + 7),
  ('00000000-0000-0000-0000-000000006244', '00000000-0000-0000-0000-000000006203', '00000000-0000-0000-0000-000000006224', '00000000-0000-0000-0000-000000006231', 'active', current_date - 30, current_date + 7);

insert into device_push_tokens (user_id, expo_push_token, platform) values
  ('00000000-0000-0000-0000-000000006210', 'ExponentPushToken[EN-A]', 'android'),
  ('00000000-0000-0000-0000-000000006210', 'ExponentPushToken[EN-B]', 'ios'),
  ('00000000-0000-0000-0000-000000006211', 'ExponentPushToken[FR-A]', 'android'),
  ('00000000-0000-0000-0000-000000006212', 'ExponentPushToken[FALLBACK-A]', 'ios');

select throws_like(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006240', 'N-99')$$,
  '%unsupported notification code%',
  'unknown lifecycle notification codes fail closed'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006240', 'N-01')$$,
  'N-01 dispatch succeeds using subscription-derived inputs'
);

select is(
  (select status from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006240'),
  'queued',
  'a token-backed logical dispatch is marked queued'
);

select is(
  (select count(*)::int from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006240'),
  2,
  'one logical event fans out once per registered device token'
);

select ok(
  (select bool_and(q.url = 'https://exp.host/--/api/v2/push/send' and q.headers ->> 'Content-Type' = 'application/json')
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240'),
  'N-01 requests use only the Expo endpoint and JSON content type'
);

select ok(
  (select bool_and(
      convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Membership expiring — 7 days'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your Bonamoussadi Gym membership expires in 7 days.'
    )
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240'),
  'English N-01 copy is exact on every device request'
);

select is(
  (select array_agg(convert_from(q.body, 'UTF8')::jsonb ->> 'to' order by convert_from(q.body, 'UTF8')::jsonb ->> 'to')
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240'),
  array['ExponentPushToken[EN-A]', 'ExponentPushToken[EN-B]']::text[],
  'the logical event targets both and only the member user''s tokens'
);

select ok(
  (select bool_and(
      convert_from(q.body, 'UTF8')::jsonb ->> 'sound' = 'default'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-01'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,subscriptionId}' = '00000000-0000-0000-0000-000000006240'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,gymId}' = '00000000-0000-0000-0000-000000006202'
    )
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240'),
  'Expo payload contains sound and the required camelCase lifecycle data'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006240', 'N-01')$$,
  'rerunning an existing logical dispatch is a safe no-op'
);

select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006240'), 1, 'rerun does not duplicate the logical dispatch');
select is((select count(*)::int from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006240'), 2, 'rerun does not duplicate per-device deliveries');
select is((select count(*)::int from net.http_request_queue), 2, 'rerun issues no additional pg_net request');

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006241', 'N-02')$$,
  'French N-02 dispatch succeeds'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Abonnement bientôt expiré — 1 jour'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre abonnement à Bonamoussadi Gym expire demain.'
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006241'),
  'preferred_language fr produces exact French N-02 copy'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006242', 'N-03')$$,
  'unsupported-language N-03 dispatch succeeds with fallback'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Membership expired'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your Akwa Gym membership has expired. Renew to restore access.'
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006242'),
  'unsupported language falls back to exact English N-03 copy'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006243', 'N-01')$$,
  'a member with no token is a safe no-op'
);

select is(
  (select status from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006243'),
  'no_tokens',
  'a no-token result remains observable and deterministic'
);

select is(
  (select count(*)::int from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006243'),
  0,
  'a no-token dispatch creates no device delivery'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006244', 'N-01')$$,
  'the same platform user can receive a separately gym-scoped lifecycle event'
);

select ok(
  (select bool_and(
      convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your Akwa Gym membership expires in 7 days.'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,gymId}' = '00000000-0000-0000-0000-000000006203'
    )
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006244'),
  'multi-gym membership copy and payload use the subscription gym'
);

-- Task 3 contract: asynchronous ticket/receipt processing and exact-token
-- cleanup. Responses are injected into pg_net's local response ledger; the
-- surrounding transaction prevents any real network request from leaving.
select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006244', 'N-02')$$,
  'a second logical code provides missing/malformed response fixtures'
);

select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'processor safely skips pending deliveries whose pg_net response is absent'
);

select is(
  (select count(*)::int
   from private.notification_deliveries d
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006244'
     and x.notification_code = 'N-02'
     and d.status = 'push_pending'),
  2,
  'missing response rows leave deliveries pending without error'
);

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  case d.expo_push_token
    when 'ExponentPushToken[EN-A]' then '{"data":{"status":"ok","id":"ticket-en-a"}}'
    else '{"data":{"status":"ok","id":"ticket-en-b"}}'
  end,
  false, null
from private.notification_deliveries d
join private.notification_dispatches x on x.id = d.dispatch_id
where x.subscription_id = '00000000-0000-0000-0000-000000006240';

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  '{"data":{"status":"error","message":"The device is not registered","details":{"error":"DeviceNotRegistered"}}}',
  false, null
from private.notification_deliveries d
join private.notification_dispatches x on x.id = d.dispatch_id
where x.subscription_id = '00000000-0000-0000-0000-000000006241';

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  '{"data":{"status":"error","message":"Payload too large","details":{"error":"MessageTooBig"}}}',
  false, null
from private.notification_deliveries d
join private.notification_dispatches x on x.id = d.dispatch_id
where x.subscription_id = '00000000-0000-0000-0000-000000006242';

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id,
  case d.expo_push_token when 'ExponentPushToken[EN-A]' then 503 else 200 end,
  'application/json', '{}'::jsonb,
  case d.expo_push_token when 'ExponentPushToken[EN-A]' then '{"error":"unavailable"}' else 'not-json' end,
  false, null
from private.notification_deliveries d
join private.notification_dispatches x on x.id = d.dispatch_id
where x.subscription_id = '00000000-0000-0000-0000-000000006244'
  and x.notification_code = 'N-01';

select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'processor handles accepted tickets and independent failures without aborting later rows'
);

select ok(
  (select d.status = 'receipt_pending' and d.expo_ticket_id = 'ticket-en-a' and d.receipt_request_id is not null
   from private.notification_deliveries d
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240'
     and d.expo_push_token = 'ExponentPushToken[EN-A]'),
  'accepted ticket is persisted as receipt_pending, not delivered'
);

select ok(
  (select q.url = 'https://exp.host/--/api/v2/push/getReceipts'
      and convert_from(q.body, 'UTF8')::jsonb = '{"ids":["ticket-en-a"]}'::jsonb
   from net.http_request_queue q
   join private.notification_deliveries d on d.receipt_request_id = q.id
   where d.expo_ticket_id = 'ticket-en-a'),
  'accepted ticket queues the documented Expo receipt lookup'
);

select is(
  (select d.status from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006240' and d.expo_push_token = 'ExponentPushToken[EN-B]'),
  'receipt_pending',
  'each accepted ticket independently waits for its receipt'
);

select is(
  (select d.status from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006241'),
  'device_not_registered',
  'ticket DeviceNotRegistered is terminal'
);

select is((select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[FR-A]'), 0, 'ticket DeviceNotRegistered removes the matching token');
select is((select count(*)::int from device_push_tokens where expo_push_token in ('ExponentPushToken[EN-A]', 'ExponentPushToken[EN-B]', 'ExponentPushToken[FALLBACK-A]')), 3, 'ticket cleanup leaves unrelated users'' tokens untouched');

select ok(
  (select d.status = 'failed' and d.error_code = 'MessageTooBig'
   from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006242'),
  'non-DeviceNotRegistered Expo ticket errors remain observable failures'
);

select is((select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[FALLBACK-A]'), 1, 'non-cleanup Expo errors retain the token');

select ok(
  (select d.status = 'failed' and d.error_code = 'HTTP_503'
   from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006244'
     and x.notification_code = 'N-01' and d.expo_push_token = 'ExponentPushToken[EN-A]'),
  'HTTP failure is terminal and observable'
);

select ok(
  (select d.status = 'failed' and d.error_code = 'MALFORMED_RESPONSE'
   from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006244'
     and x.notification_code = 'N-01' and d.expo_push_token = 'ExponentPushToken[EN-B]'),
  'malformed Expo JSON fails only its own delivery row'
);

select is(
  (select count(*)::int from private.notification_deliveries d join private.notification_dispatches x on x.id = d.dispatch_id where x.subscription_id = '00000000-0000-0000-0000-000000006244' and x.notification_code = 'N-02' and d.status = 'push_pending'),
  2,
  'missing responses remain pending while other rows are processed'
);

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.receipt_request_id, 200, 'application/json', '{}'::jsonb,
  case d.expo_ticket_id
    when 'ticket-en-a' then '{"data":{"ticket-en-a":{"status":"ok"}}}'
    else '{"data":{"ticket-en-b":{"status":"error","message":"Device gone","details":{"error":"DeviceNotRegistered"}}}}'
  end,
  false, null
from private.notification_deliveries d
where d.expo_ticket_id in ('ticket-en-a', 'ticket-en-b');

select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'processor handles successful and DeviceNotRegistered receipts independently'
);

select is((select status from private.notification_deliveries where expo_ticket_id = 'ticket-en-a'), 'delivered', 'successful receipt marks the delivery delivered');
select is((select status from private.notification_deliveries where expo_ticket_id = 'ticket-en-b'), 'device_not_registered', 'receipt DeviceNotRegistered is terminal');

select ok(
  (select count(*) from device_push_tokens where expo_push_token = 'ExponentPushToken[EN-B]') = 0
  and (select count(*) from device_push_tokens where expo_push_token = 'ExponentPushToken[EN-A]') = 1,
  'receipt cleanup deletes only the exact stale token'
);

select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'notification delivery processor cron entry exists exactly once'
);

select ok(
  (select schedule = '* * * * *' and username = 'postgres' from cron.job where jobname = 'notification_delivery_processor'),
  'delivery processor runs every minute as postgres'
);

-- Complete the reviewed six-message copy matrix. Re-register a fresh French
-- token because the processor contract intentionally cleaned up FR-A above.
insert into device_push_tokens (user_id, expo_push_token, platform)
values ('00000000-0000-0000-0000-000000006211', 'ExponentPushToken[FR-B]', 'android');

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006241', 'N-01')$$,
  'French N-01 dispatch succeeds'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Abonnement bientôt expiré — 7 jours'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre abonnement à Bonamoussadi Gym expire dans 7 jours.'
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006241' and x.notification_code = 'N-01'),
  'preferred_language fr produces exact French N-01 copy'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006240', 'N-02')$$,
  'English N-02 dispatch succeeds'
);

select ok(
  (select bool_and(convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Membership expiring — 1 day'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your Bonamoussadi Gym membership expires tomorrow.')
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006240' and x.notification_code = 'N-02'),
  'English fallback produces exact English N-02 copy'
);

select lives_ok(
  $$select private.send_push_notification('00000000-0000-0000-0000-000000006241', 'N-03')$$,
  'French N-03 dispatch succeeds'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Abonnement expiré'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre abonnement à Bonamoussadi Gym a expiré. Renouvelez-le pour rétablir votre accès.'
   from net.http_request_queue q
   join private.notification_deliveries d on d.push_request_id = q.id
   join private.notification_dispatches x on x.id = d.dispatch_id
   where x.subscription_id = '00000000-0000-0000-0000-000000006241' and x.notification_code = 'N-03'),
  'preferred_language fr produces exact French N-03 copy'
);

-- Task 4 contract: preserve Story 3.1 transitions while emitting only exact
-- lifecycle events. These fixtures are independent of the direct-dispatch
-- contract above.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006250', 'Lifecycle Job Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, grace_period_days)
values ('00000000-0000-0000-0000-000000006251', 'Lifecycle Job Gym', '00000000-0000-0000-0000-000000006250', 3);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000006260'),
  ('00000000-0000-0000-0000-000000006261'),
  ('00000000-0000-0000-0000-000000006262'),
  ('00000000-0000-0000-0000-000000006263'),
  ('00000000-0000-0000-0000-000000006264'),
  ('00000000-0000-0000-0000-000000006265'),
  ('00000000-0000-0000-0000-000000006266'),
  ('00000000-0000-0000-0000-000000006267'),
  ('00000000-0000-0000-0000-000000006268');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000006270', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006260', 'member', 'Exact N01'),
  ('00000000-0000-0000-0000-000000006271', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006261', 'member', 'Late N01'),
  ('00000000-0000-0000-0000-000000006272', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006262', 'member', 'Exact N02'),
  ('00000000-0000-0000-0000-000000006273', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006263', 'member', 'Late Active N02'),
  ('00000000-0000-0000-0000-000000006274', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006264', 'member', 'Newly Expired'),
  ('00000000-0000-0000-0000-000000006275', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006265', 'member', 'Already Expired'),
  ('00000000-0000-0000-0000-000000006276', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006266', 'member', 'Grace Boundary'),
  ('00000000-0000-0000-0000-000000006277', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006267', 'member', 'No Token N01'),
  ('00000000-0000-0000-0000-000000006278', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006268', 'member', 'Pay Per Session');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000006280', '00000000-0000-0000-0000-000000006251', 'Lifecycle Job Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000006281', '00000000-0000-0000-0000-000000006251', 'Lifecycle Job Session', 'pay_per_session', 1000, 'monthly', null);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000006290', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006270', '00000000-0000-0000-0000-000000006280', 'active', current_date - 30, current_date + 7),
  ('00000000-0000-0000-0000-000000006291', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006271', '00000000-0000-0000-0000-000000006280', 'active', current_date - 30, current_date + 6),
  ('00000000-0000-0000-0000-000000006292', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006272', '00000000-0000-0000-0000-000000006280', 'expiring_soon', current_date - 30, current_date + 1),
  ('00000000-0000-0000-0000-000000006293', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006273', '00000000-0000-0000-0000-000000006280', 'active', current_date - 30, current_date + 1),
  ('00000000-0000-0000-0000-000000006294', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006274', '00000000-0000-0000-0000-000000006280', 'grace_period', current_date - 30, current_date - 4),
  ('00000000-0000-0000-0000-000000006295', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006275', '00000000-0000-0000-0000-000000006280', 'expired', current_date - 30, current_date - 5),
  ('00000000-0000-0000-0000-000000006296', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006276', '00000000-0000-0000-0000-000000006280', 'grace_period', current_date - 30, current_date - 3),
  ('00000000-0000-0000-0000-000000006297', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006277', '00000000-0000-0000-0000-000000006280', 'active', current_date - 30, current_date + 7),
  ('00000000-0000-0000-0000-000000006298', '00000000-0000-0000-0000-000000006251', '00000000-0000-0000-0000-000000006278', '00000000-0000-0000-0000-000000006281', 'active', current_date - 30, null);

insert into device_push_tokens (user_id, expo_push_token, platform) values
  ('00000000-0000-0000-0000-000000006260', 'ExponentPushToken[JOB-N01]', 'android'),
  ('00000000-0000-0000-0000-000000006261', 'ExponentPushToken[JOB-LATE]', 'android'),
  ('00000000-0000-0000-0000-000000006262', 'ExponentPushToken[JOB-N02]', 'ios'),
  ('00000000-0000-0000-0000-000000006263', 'ExponentPushToken[JOB-LATE-N02]', 'android'),
  ('00000000-0000-0000-0000-000000006264', 'ExponentPushToken[JOB-N03]', 'ios');

create temp table lifecycle_counts_before as
select
  (select count(*)::int from private.notification_dispatches where subscription_id::text like '00000000-0000-0000-0000-00000000629%') as dispatches,
  (select count(*)::int from net.http_request_queue) as requests;

select lives_ok($$select run_subscription_lifecycle_job()$$, 'extended lifecycle job executes against notification fixtures');

select is((select status from subscriptions where id = '00000000-0000-0000-0000-000000006290')::text, 'expiring_soon', 'exact +7 active row transitions to expiring_soon');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006290' and notification_code = 'N-01'), 1, 'exact +7 transition emits N-01');
select is((select status from subscriptions where id = '00000000-0000-0000-0000-000000006291')::text, 'expiring_soon', 'late +6 row still advances lifecycle state');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006291'), 0, 'late +6 row receives no retroactive N-01');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006292' and notification_code = 'N-02'), 1, 'existing expiring-soon exact +1 row emits N-02');

select ok(
  (select status = 'expiring_soon' from subscriptions where id = '00000000-0000-0000-0000-000000006293')
  and (select count(*) from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006293' and notification_code = 'N-02') = 1,
  'late active exact +1 row advances state and emits only the current N-02 event'
);

select is((select status from subscriptions where id = '00000000-0000-0000-0000-000000006294')::text, 'expired', 'elapsed-grace row transitions to expired');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006294' and notification_code = 'N-03'), 1, 'newly expired transition emits N-03');
select is((select count(*)::int from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006295'), 0, 'already-expired row emits no N-03');

select ok(
  (select status = 'grace_period' from subscriptions where id = '00000000-0000-0000-0000-000000006296')
  and (select count(*) from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006296') = 0,
  'exact grace boundary stays in grace and emits no N-03'
);

select is((select status from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006297' and notification_code = 'N-01'), 'no_tokens', 'exact +7 no-token row records deterministic no_tokens N-01');

select ok(
  (select status = 'active' from subscriptions where id = '00000000-0000-0000-0000-000000006298')
  and (select count(*) from private.notification_dispatches where subscription_id = '00000000-0000-0000-0000-000000006298') = 0,
  'pay-per-session subscription remains untouched and unnotified'
);

select is((select count(*)::int from private.notification_dispatches where subscription_id::text like '00000000-0000-0000-0000-00000000629%'), 5, 'first job run creates exactly the five eligible logical events');
select is((select count(*)::int from net.http_request_queue) - (select requests from lifecycle_counts_before), 4, 'first job run queues one request for each token-backed eligible event');

create temp table lifecycle_counts_after as
select
  (select count(*)::int from private.notification_dispatches where subscription_id::text like '00000000-0000-0000-0000-00000000629%') as dispatches,
  (select count(*)::int from net.http_request_queue) as requests;

select lives_ok($$select run_subscription_lifecycle_job()$$, 'same-day lifecycle rerun completes without error');
select is((select count(*)::int from private.notification_dispatches where subscription_id::text like '00000000-0000-0000-0000-00000000629%'), (select dispatches from lifecycle_counts_after), 'same-day rerun adds no logical dispatches');
select is((select count(*)::int from net.http_request_queue), (select requests from lifecycle_counts_after), 'same-day rerun adds no pg_net requests');

select ok(
  (select schedule = '0 1 * * *' and username = 'postgres' from cron.job where jobname = 'subscription_lifecycle'),
  'original 02:00 Africa/Douala lifecycle schedule and postgres owner are preserved'
);

select is(
  (select count(*)::int from job_runs where job_name = 'subscription_lifecycle' and status = 'success'),
  2,
  'both lifecycle invocations retain success job logging'
);

select * from finish();
rollback;
