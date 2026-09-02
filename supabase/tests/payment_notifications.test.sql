-- Story 6.3: payment-scoped notification transport, the payments trigger's
-- N-04/N-05 firing/non-firing boundary, bilingual copy, and idempotency
-- coverage. Fixture and pg_net-inspection conventions match
-- subscription_lifecycle_notifications.test.sql (Story 6.2); RLS session
-- conventions match payments_rls_and_renewal.test.sql /
-- manual_payment_verification_queue.test.sql.

begin;
select plan(56);

-- Task 1 RED contract: internal logical-dispatch and per-device ledgers.
select ok(
  to_regclass('private.payment_notification_dispatches') is not null,
  'private.payment_notification_dispatches exists'
);

select ok(
  to_regclass('private.payment_notification_deliveries') is not null,
  'private.payment_notification_deliveries exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.payment_notification_dispatches')),
  'payment_notification_dispatches has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = to_regclass('private.payment_notification_deliveries')),
  'payment_notification_deliveries has RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.payment_notification_dispatches')
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (payment_id, notification_code)'
  ),
  'payment logical dispatches are unique by payment and notification code'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = to_regclass('private.payment_notification_dispatches')
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%N-04%N-05%'
  ),
  'payment logical dispatch notification codes are restricted to N-04/N-05'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'payment_notification_deliveries' and indexdef like '%status%'
  ),
  'payment delivery ledger has a due-processing status index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'payment_notification_deliveries' and indexdef like '%push_request_id%'
  ),
  'payment delivery ledger has a push-request correlation index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private' and tablename = 'payment_notification_deliveries' and indexdef like '%receipt_request_id%'
  ),
  'payment delivery ledger has a receipt-request correlation index'
);

select ok(
  not has_table_privilege('authenticated', 'private.payment_notification_dispatches', 'SELECT')
  and not has_table_privilege('authenticated', 'private.payment_notification_deliveries', 'SELECT'),
  'authenticated cannot read the payment notification ledgers'
);

select ok(
  has_table_privilege('service_role', 'private.payment_notification_dispatches', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'private.payment_notification_deliveries', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has the minimum server-side ledger access'
);

select throws_like(
  $$select private.send_payment_push_notification('00000000-0000-0000-0000-000000006601', 'N-99')$$,
  '%unsupported notification code%',
  'unknown payment notification codes fail closed'
);

-- ============================================================================
-- Fixtures
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006300', 'Payment Push Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000006301', 'Bastos Gym', '00000000-0000-0000-0000-000000006300');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000006310'), -- EN payer, webhook completion path
  ('00000000-0000-0000-0000-000000006311'), -- FR payer, manual verify path
  ('00000000-0000-0000-0000-000000006312'), -- unsupported-language payer, direct-verified-insert path
  ('00000000-0000-0000-0000-000000006313'), -- no-token payer
  ('00000000-0000-0000-0000-000000006314'), -- multi-device payer
  ('00000000-0000-0000-0000-000000006316'), -- automated webhook-failure payer
  ('00000000-0000-0000-0000-000000006317'), -- manual flag-for-review payer
  ('00000000-0000-0000-0000-000000006318'), -- FR automated webhook-failure payer
  ('00000000-0000-0000-0000-000000006320'); -- gym staff (owner) session

update users set preferred_language = 'fr' where id in (
  '00000000-0000-0000-0000-000000006311',
  '00000000-0000-0000-0000-000000006318'
);
update users set preferred_language = 'de' where id = '00000000-0000-0000-0000-000000006312';

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000006410', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006310', 'member', 'EN Payer'),
  ('00000000-0000-0000-0000-000000006411', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006311', 'member', 'FR Payer'),
  ('00000000-0000-0000-0000-000000006412', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006312', 'member', 'Fallback Payer'),
  ('00000000-0000-0000-0000-000000006413', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006313', 'member', 'No Token Payer'),
  ('00000000-0000-0000-0000-000000006414', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006314', 'member', 'Multi Device Payer'),
  ('00000000-0000-0000-0000-000000006416', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006316', 'member', 'Webhook Failure Payer'),
  ('00000000-0000-0000-0000-000000006417', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006317', 'member', 'Manual Review Payer'),
  ('00000000-0000-0000-0000-000000006418', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006318', 'member', 'FR Webhook Failure Payer'),
  ('00000000-0000-0000-0000-000000006420', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006320', 'owner', 'Gym Staff Owner');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000006500', '00000000-0000-0000-0000-000000006301', 'Payment Push Monthly', 'monthly', 15000, 'monthly', 30);

-- Prior expired subscription so complete_verified_payment()'s renewal branch
-- actually runs its second UPDATE (setting subscription_id) -- the exact
-- shape AC #4's double-fire guard must survive.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
values ('00000000-0000-0000-0000-000000006600', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006410', '00000000-0000-0000-0000-000000006500', 'expired', current_date - 40, current_date - 10, now() - interval '1 day');

insert into device_push_tokens (user_id, expo_push_token, platform) values
  ('00000000-0000-0000-0000-000000006310', 'ExponentPushToken[PAY-EN]', 'android'),
  ('00000000-0000-0000-0000-000000006311', 'ExponentPushToken[PAY-FR]', 'android'),
  ('00000000-0000-0000-0000-000000006312', 'ExponentPushToken[PAY-FALLBACK]', 'ios'),
  ('00000000-0000-0000-0000-000000006314', 'ExponentPushToken[PAY-MULTI-A]', 'android'),
  ('00000000-0000-0000-0000-000000006314', 'ExponentPushToken[PAY-MULTI-B]', 'ios'),
  ('00000000-0000-0000-0000-000000006316', 'ExponentPushToken[PAY-FAIL]', 'android'),
  ('00000000-0000-0000-0000-000000006318', 'ExponentPushToken[PAY-FAIL-FR]', 'android');

-- ============================================================================
-- AC #1 / #4 / #6: webhook completion path (complete_verified_payment(),
-- two-UPDATE shape) fires N-04 exactly once, with exact English copy and
-- camelCase paymentId/gymId/notificationCode data keys.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000006601', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006410', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'test-ref-6601');

set local role service_role;
select lives_ok(
  $$select complete_verified_payment('00000000-0000-0000-0000-000000006601'::uuid, 450)$$,
  'webhook completion (complete_verified_payment) succeeds'
);
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000006601'),
  'verified',
  'the payment transitioned to verified'
);

select isnt(
  (select subscription_id from payments where id = '00000000-0000-0000-0000-000000006601'),
  null,
  'complete_verified_payment''s second UPDATE backfilled subscription_id'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006601'),
  1,
  'N-04 dispatched exactly once despite complete_verified_payment''s two-UPDATE shape'
);

select is(
  (select notification_code from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006601'),
  'N-04',
  'the dispatched code is N-04'
);

select ok(
  (select q.url = 'https://exp.host/--/api/v2/push/send' and q.headers ->> 'Content-Type' = 'application/json'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006601'),
  'N-04 request uses only the Expo endpoint and JSON content type'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Payment confirmed'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your payment of 15000 XAF to Bastos Gym was confirmed.'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006601'),
  'English N-04 copy is exact'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-04'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,paymentId}' = '00000000-0000-0000-0000-000000006601'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,gymId}' = '00000000-0000-0000-0000-000000006301'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006601'),
  'Expo payload data is keyed by payment_id (not subscription_id), camelCase, exact'
);

-- Story 6.7: the same dispatch also writes a member-facing history row.
select ok(
  (select type = 'N-04' and title = 'Payment confirmed'
      and body = 'Your payment of 15000 XAF to Bastos Gym was confirmed.' and read_at is null
   from public.notifications where member_id = '00000000-0000-0000-0000-000000006410'),
  'N-04 dispatch also writes a matching, unread public.notifications row'
);

-- AC #4's second clause: an unrelated column-only UPDATE on the same
-- already-verified row must not trigger a stray notification.
select lives_ok(
  $$update payments set currency = currency where id = '00000000-0000-0000-0000-000000006601'$$,
  'an unrelated column-only UPDATE on an already-verified row succeeds'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006601'),
  1,
  'the column-only UPDATE creates no additional dispatch'
);

select is(
  (select count(*)::int from net.http_request_queue),
  1,
  'the column-only UPDATE queues no additional pg_net request'
);

-- ============================================================================
-- AC #1 / #6 / #8: manual Verification Queue staff-verify (pending ->
-- verified) fires N-04, keyed correctly by payment_id even though this is a
-- manual ledger entry whose subscription_id is permanently NULL.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000006602', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006411', 20000, 'XAF', 'cash', 'pending');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006320","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006301","app_role":"owner"}',
  true
);

select lives_ok(
  $$update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000006602'$$,
  'staff Verification Queue verify (pending -> verified) succeeds'
);
reset role;

select is(
  (select subscription_id from payments where id = '00000000-0000-0000-0000-000000006602'),
  null,
  'the manual ledger entry keeps subscription_id NULL by design'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006602' and notification_code = 'N-04'),
  1,
  'staff verify of a subscription_id-NULL manual ledger entry still dispatches N-04, keyed by payment_id'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Paiement confirmé'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre paiement de 20000 XAF à Bastos Gym a été confirmé.'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006602'),
  'preferred_language fr produces exact French N-04 copy'
);

-- ============================================================================
-- AC #1 / #6: a direct verified INSERT (mirrors the Inline Renewal Panel /
-- Open Payment Method / Subscriptions-page manual renewal pattern) fires
-- N-04 on TG_OP = 'INSERT'. Member's language is unsupported ('de') and
-- falls back to English.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000006603', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006412', 15000, 'XAF', 'mtn_momo', 'verified');

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006603' and notification_code = 'N-04'),
  1,
  'a direct verified INSERT (renewal-panel pattern) fires N-04 on TG_OP = INSERT'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Payment confirmed'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your payment of 15000 XAF to Bastos Gym was confirmed.'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006603'),
  'unsupported preferred_language (de) falls back to exact English N-04 copy'
);

-- ============================================================================
-- No-token and multi-device fan-out.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000006604', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006413', 15000, 'XAF', 'cash', 'verified');

select is(
  (select status from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006604'),
  'no_tokens',
  'a member with no device token is a safe, observable no_tokens no-op'
);

select is(
  (select count(*)::int from private.payment_notification_deliveries d join private.payment_notification_dispatches x on x.id = d.dispatch_id where x.payment_id = '00000000-0000-0000-0000-000000006604'),
  0,
  'a no-token dispatch creates no device delivery'
);

insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000006605', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006414', 15000, 'XAF', 'cash', 'verified');

select is(
  (select count(*)::int from private.payment_notification_deliveries d join private.payment_notification_dispatches x on x.id = d.dispatch_id where x.payment_id = '00000000-0000-0000-0000-000000006605'),
  2,
  'one logical N-04 event fans out once per registered device token'
);

-- ============================================================================
-- AC #2 / #3: the N-05 boundary -- the highest-value assertion in the whole
-- story. An automated webhook failure (processing -> flagged via the new
-- complete_flagged_payment()) fires N-05; a manual staff Flag for Review
-- (pending -> flagged) fires nothing.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000006606', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006416', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'test-ref-6606');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006320","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006301","app_role":"owner"}',
  true
);
select throws_like(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000006606'::uuid)$$,
  '%permission denied%',
  'an authenticated (non-service_role) caller cannot execute complete_flagged_payment -- no EXECUTE grant'
);
reset role;

set local role service_role;
select lives_ok(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000006606'::uuid)$$,
  'the new automated webhook-failure completion path succeeds'
);
reset role;

-- Story 7.1 (AC #3): complete_flagged_payment() now closes the audit gap
-- against its sibling complete_verified_payment() -- confirm the shape.
select ok(
  exists (
    select 1 from audit_log
    where action_type = 'payment_verification_failed'
      and gym_id = '00000000-0000-0000-0000-000000006301'
      and target_entity_id = '00000000-0000-0000-0000-000000006416'
      and target_entity_type = 'member'
      and metadata @> '{"payment_id": "00000000-0000-0000-0000-000000006606", "amount": 15000, "method": "orange_money"}'::jsonb
  ),
  'an automated processing -> flagged transition writes a payment_verification_failed audit record with the expected shape'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000006606'),
  'flagged',
  'the payment transitioned processing -> flagged'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006606' and notification_code = 'N-05'),
  1,
  'an automated processing -> flagged transition fires N-05 exactly once'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Payment failed'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Your payment to Bastos Gym could not be completed. Please try again or contact the front desk.'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-05'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006606'),
  'English N-05 copy and notificationCode are exact'
);

-- Story 6.7: the same N-05 dispatch also writes a matching history row.
select ok(
  (select type = 'N-05' and title = 'Payment failed'
      and body = 'Your payment to Bastos Gym could not be completed. Please try again or contact the front desk.'
   from public.notifications where member_id = '00000000-0000-0000-0000-000000006416'),
  'N-05 dispatch also writes a matching public.notifications row'
);

set local role service_role;
select lives_ok(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000006606'::uuid)$$,
  'a retried webhook delivery calling complete_flagged_payment again is a safe no-op (status already flagged)'
);
reset role;

select is(
  (select count(*)::int from public.notifications where member_id = '00000000-0000-0000-0000-000000006416' and type = 'N-05'),
  1,
  'the retried webhook does not duplicate the notifications history row either'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006606'),
  1,
  'the replayed failure delivery creates no duplicate N-05 dispatch'
);

select is(
  (select count(*)::int from audit_log where action_type = 'payment_verification_failed' and target_entity_id = '00000000-0000-0000-0000-000000006416'),
  1,
  'the retried no-op complete_flagged_payment call creates no duplicate payment_verification_failed audit record'
);

-- AC #6: French N-05 copy, same discipline as the N-04 fr/fallback assertions
-- above -- a separate automated webhook-failure payer keeps this independent
-- of the English N-05 fixture's own idempotency replay above.
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000006608', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006418', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'test-ref-6608');

set local role service_role;
select lives_ok(
  $$select complete_flagged_payment('00000000-0000-0000-0000-000000006608'::uuid)$$,
  'the automated webhook-failure completion path succeeds for the French payer'
);
reset role;

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006608' and notification_code = 'N-05'),
  1,
  'the French payer''s processing -> flagged transition fires N-05 exactly once'
);

select ok(
  (select convert_from(q.body, 'UTF8')::jsonb ->> 'title' = 'Échec du paiement'
      and convert_from(q.body, 'UTF8')::jsonb ->> 'body' = 'Votre paiement à Bastos Gym n''a pas pu être effectué. Veuillez réessayer ou contacter la réception.'
      and convert_from(q.body, 'UTF8')::jsonb #>> '{data,notificationCode}' = 'N-05'
   from net.http_request_queue q
   join private.payment_notification_deliveries d on d.push_request_id = q.id
   join private.payment_notification_dispatches x on x.id = d.dispatch_id
   where x.payment_id = '00000000-0000-0000-0000-000000006608'),
  'exact French N-05 copy and notificationCode'
);

-- Manual "Flag for Review" (Story 4.3, pending -> flagged) must stay silent:
-- this is the mechanism that distinguishes a human review action from an
-- automated webhook failure signal to the member.
insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000006607', '00000000-0000-0000-0000-000000006301', '00000000-0000-0000-0000-000000006417', 15000, 'XAF', 'cash', 'pending');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006320","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006301","app_role":"owner"}',
  true
);

select lives_ok(
  $$update payments set status = 'flagged' where id = '00000000-0000-0000-0000-000000006607'$$,
  'staff manual Flag for Review (pending -> flagged) succeeds'
);
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000006607'),
  'flagged',
  'the payment is flagged for internal review'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000006607'),
  0,
  'a manual internal Flag for Review sends no N-05 (or any) push notification'
);

-- ============================================================================
-- Task 5: the shared delivery processor also drains the payment ledger,
-- reusing private.cleanup_invalid_device_push_token() exactly as-is.
-- ============================================================================
select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'the shared processor safely skips payment deliveries whose pg_net response is absent'
);

insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
select d.push_request_id, 200, 'application/json', '{}'::jsonb,
  '{"data":{"status":"error","message":"The device is not registered","details":{"error":"DeviceNotRegistered"}}}',
  false, null
from private.payment_notification_deliveries d
join private.payment_notification_dispatches x on x.id = d.dispatch_id
where x.payment_id = '00000000-0000-0000-0000-000000006606';

select lives_ok(
  $$select private.process_notification_deliveries()$$,
  'the shared processor handles a payment-ledger ticket response'
);

select is(
  (select d.status from private.payment_notification_deliveries d join private.payment_notification_dispatches x on x.id = d.dispatch_id where x.payment_id = '00000000-0000-0000-0000-000000006606'),
  'device_not_registered',
  'a payment-ledger DeviceNotRegistered ticket is terminal'
);

select is(
  (select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[PAY-FAIL]'),
  0,
  'the shared processor reuses cleanup_invalid_device_push_token to remove the stale payment-notification token'
);

select is(
  (select count(*)::int from device_push_tokens where expo_push_token in ('ExponentPushToken[PAY-EN]', 'ExponentPushToken[PAY-FR]', 'ExponentPushToken[PAY-MULTI-A]', 'ExponentPushToken[PAY-MULTI-B]')),
  4,
  'payment-ledger token cleanup leaves unrelated users'' tokens untouched'
);

select is(
  (select count(*)::int from cron.job where jobname = 'notification_delivery_processor'),
  1,
  'the delivery processor cron entry still exists exactly once (not duplicated for the payment ledger)'
);

select * from finish();
rollback;
