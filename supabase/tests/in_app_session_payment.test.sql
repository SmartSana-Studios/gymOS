-- Story 19.5: in-app Tara Money session payment (migration 0109), positive
-- paths. Denial paths live in in_app_session_payment.negative.test.sql.
--
-- payment-webhook is not exercised: its confirmation path is simulated by
-- calling complete_verified_payment() as service_role, exactly what the
-- function's service client does.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000335xx.

begin;
select plan(37);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033501', 'In-app Session Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000033511', 'In-app Session Gym', '00000000-0000-0000-0000-000000033501', 'active', true);

insert into gym_payment_credentials (gym_id, provider_key, credentials_secret_id, business_id_masked)
values ('00000000-0000-0000-0000-000000033511', 'taramoney', gen_random_uuid(), '****1234');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033521'), -- member A: happy path, replay
  ('00000000-0000-0000-0000-000000033522'), -- member B: stale attempt
  ('00000000-0000-0000-0000-000000033523'), -- member C: late confirmation
  ('00000000-0000-0000-0000-000000033524'), -- member D: wrong_account
  ('00000000-0000-0000-0000-000000033525'), -- member E: reconciliation_mismatch
  ('00000000-0000-0000-0000-000000033526'), -- member F: staff_flagged
  ('00000000-0000-0000-0000-000000033527'), -- member G: provider_declined
  ('00000000-0000-0000-0000-000000033528'), -- member H: latest plan wins
  ('00000000-0000-0000-0000-000000033529'), -- member I: subscription renewal + desk
  ('00000000-0000-0000-0000-00000003352a'); -- receptionist

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000033531', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033521', 'member', 'IA A', current_date),
  ('00000000-0000-0000-0000-000000033532', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033522', 'member', 'IA B', current_date),
  ('00000000-0000-0000-0000-000000033533', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033523', 'member', 'IA C', current_date),
  ('00000000-0000-0000-0000-000000033534', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033524', 'member', 'IA D', current_date),
  ('00000000-0000-0000-0000-000000033535', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033525', 'member', 'IA E', current_date),
  ('00000000-0000-0000-0000-000000033536', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033526', 'member', 'IA F', current_date),
  ('00000000-0000-0000-0000-000000033537', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033527', 'member', 'IA G', current_date),
  ('00000000-0000-0000-0000-000000033538', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033528', 'member', 'IA H', current_date),
  ('00000000-0000-0000-0000-000000033539', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033529', 'member', 'IA I', current_date),
  ('00000000-0000-0000-0000-00000003353a', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-00000003352a', 'receptionist', 'IA Rec', current_date);

-- The registration fee is settled for every member unless a test says otherwise
-- (set as the migration owner; the pin covers client roles only).
update members set registration_fee_settled_at = now() where role = 'member' and gym_id = '00000000-0000-0000-0000-000000033511';

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000033541', '00000000-0000-0000-0000-000000033511', 'IA PPS 2000', 'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033542', '00000000-0000-0000-0000-000000033511', 'IA PPS 3500', 'pay_per_session', 3500,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033543', '00000000-0000-0000-0000-000000033511', 'IA Monthly',  'monthly',         15000, 'XAF', 'monthly', 30);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at)
select '00000000-0000-0000-0000-000000033511', m, '00000000-0000-0000-0000-000000033541', 'active', current_date, null, now()
from unnest(array[
  '00000000-0000-0000-0000-000000033531', '00000000-0000-0000-0000-000000033532', '00000000-0000-0000-0000-000000033533',
  '00000000-0000-0000-0000-000000033534', '00000000-0000-0000-0000-000000033535', '00000000-0000-0000-0000-000000033536',
  '00000000-0000-0000-0000-000000033537']::uuid[]) m;

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033538', '00000000-0000-0000-0000-000000033541', 'expired', current_date - 60, null, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033538', '00000000-0000-0000-0000-000000033542', 'active',  current_date, null, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033539', '00000000-0000-0000-0000-000000033543', 'expired', current_date - 60, current_date - 30, now());

-- Interface: no amount, no currency, no phone is a parameter.
select is(
  (select pronargs::int from pg_proc where oid = 'public.initiate_session_payment()'::regprocedure),
  0,
  'initiate_session_payment takes no arguments'
);

select is(
  (select proargnames from pg_proc where oid = 'public.initiate_session_payment()'::regprocedure),
  array['payment_id', 'provider_key'],
  'it returns the payment id and the provider key'
);

-- ============================================================================
-- Initiate (member A).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033521","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033511","app_role":"member"}', true);

select is(
  (select provider_key from initiate_session_payment()),
  'taramoney',
  'a member starts a Tara session payment and gets the provider key'
);
reset role;

select is(
  (select row(p.amount, p.currency, p.method::text, p.status::text, p.purpose, p.provider, p.subscription_id, p.actor_id, p.gym_id, p.voided_at)::text
   from payments p where p.member_id = '00000000-0000-0000-0000-000000033531'),
  row(2000, 'XAF', 'mobile_money', 'processing', 'session', 'taramoney', null::uuid,
      '00000000-0000-0000-0000-000000033521'::uuid, '00000000-0000-0000-0000-000000033511'::uuid, null::timestamptz)::text,
  'one processing session payment at the plan price and currency, actor = the member'
);

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033531'),
  0,
  'initiating creates no session'
);

-- Latest plan wins (member H): 3500, not the older 2000.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033528","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033511","app_role":"member"}', true);
select lives_ok($$ select initiate_session_payment() $$, 'member H initiates');
reset role;

select is(
  (select amount from payments where member_id = '00000000-0000-0000-0000-000000033538'),
  3500,
  'the amount comes from the latest subscription plan'
);

-- ============================================================================
-- Confirm (member A), replay.
-- ============================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment((select id from payments where member_id = '00000000-0000-0000-0000-000000033531'), 25)),
  null::uuid,
  'confirming a session payment returns null (no subscription)'
);
reset role;

select is(
  (select row(p.status::text, p.provider_fee_amount, p.flagged_reason)::text from payments p where p.member_id = '00000000-0000-0000-0000-000000033531'),
  row('verified', 25, null::text)::text,
  'the payment is verified with the provider fee, no reason'
);

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033531'
     and payment_id = (select id from payments where member_id = '00000000-0000-0000-0000-000000033531')
     and consumed_at is null and voided_at is null),
  1,
  'exactly one unconsumed session backed by the payment'
);

select is(
  (select g.usable_until from guest_sessions g where g.member_id = '00000000-0000-0000-0000-000000033531'),
  now() + make_interval(days => (select paid_session_validity_days from platform_session_config limit 1)),
  'usable_until is now plus the configured paid-session validity days'
);

select is(
  (select metadata - 'payment_id' - 'guest_session_id' from audit_log
   where action_type = 'session_payment_paid' and target_entity_id = '00000000-0000-0000-0000-000000033531'),
  '{"amount": 2000, "currency": "XAF", "method": "mobile_money", "fee_amount": 25}'::jsonb,
  'one session_payment_paid audit row with amount, currency, method, fee'
);

select is(
  (select count(*)::int from notifications where member_id = '00000000-0000-0000-0000-000000033531'),
  0,
  'a session payment queues no notification'
);

-- Replay: same confirmation again changes nothing.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment((select id from payments where member_id = '00000000-0000-0000-0000-000000033531'), 25);
reset role;

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033531'),
  1,
  'a redelivered confirmation leaves exactly one session'
);

select is(
  (select count(*)::int from audit_log where action_type = 'session_payment_paid' and target_entity_id = '00000000-0000-0000-0000-000000033531'),
  1,
  'a redelivered confirmation writes no second audit row'
);

-- ============================================================================
-- Stale attempt (member B): flagged, audited, a new one proceeds.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033551', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033532', 2000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-000000033522', 'session', now() - interval '30 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033522","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033511","app_role":"member"}', true);
select lives_ok($$ select initiate_session_payment() $$, 'a stale attempt does not block a new one');
reset role;

select is(
  (select row(status::text, flagged_reason)::text from payments where id = '00000000-0000-0000-0000-000000033551'),
  row('flagged', 'expired_attempt')::text,
  'the stale attempt is flagged expired_attempt'
);

select is(
  (select count(*)::int from audit_log where action_type = 'session_attempt_expired'
     and metadata ->> 'payment_id' = '00000000-0000-0000-0000-000000033551'),
  1,
  'the expiry is audited'
);

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000033532' and status = 'processing'),
  1,
  'one processing payment now exists for member B'
);

-- ============================================================================
-- Late confirmation (member C): flagged expired_attempt then success.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, flagged_reason) values
  ('00000000-0000-0000-0000-000000033552', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033533', 2000, 'XAF', 'mobile_money', 'flagged', 'taramoney', '00000000-0000-0000-0000-000000033523', 'session', 'expired_attempt');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-000000033552', 10);
reset role;

select is(
  (select row(status::text, flagged_reason)::text from payments where id = '00000000-0000-0000-0000-000000033552'),
  row('verified', 'late_confirmation')::text,
  'a late confirmation verifies the payment with reason late_confirmation'
);

select is(
  (select count(*)::int from guest_sessions where payment_id = '00000000-0000-0000-0000-000000033552'),
  1,
  'a late confirmation creates the session'
);

select is(
  (select metadata - 'guest_session_id' from audit_log
   where action_type = 'session_late_payment' and target_entity_id = '00000000-0000-0000-0000-000000033533'),
  '{"payment_id": "00000000-0000-0000-0000-000000033552", "amount": 2000, "currency": "XAF", "method": "mobile_money", "fee_amount": 10}'::jsonb,
  'the late payment is audited'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-000000033552', 10);
reset role;

select is(
  (select count(*)::int from guest_sessions where payment_id = '00000000-0000-0000-0000-000000033552'),
  1,
  'a redelivered late confirmation still leaves one session'
);

select is(
  (select count(*)::int from audit_log where action_type = 'session_late_payment' and target_entity_id = '00000000-0000-0000-0000-000000033533'),
  1,
  'a redelivered late confirmation writes no second audit row'
);

-- ============================================================================
-- Bad flags never yield a session and leave the row unchanged.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, flagged_reason) values
  ('00000000-0000-0000-0000-000000033553', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033534', 2000, 'XAF', 'mobile_money', 'flagged', 'taramoney', '00000000-0000-0000-0000-000000033524', 'session', 'wrong_account'),
  ('00000000-0000-0000-0000-000000033554', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033535', 2000, 'XAF', 'mobile_money', 'flagged', 'taramoney', '00000000-0000-0000-0000-000000033525', 'session', 'reconciliation_mismatch'),
  ('00000000-0000-0000-0000-000000033555', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033536', 2000, 'XAF', 'mobile_money', 'flagged', 'taramoney', '00000000-0000-0000-0000-000000033526', 'session', 'staff_flagged'),
  ('00000000-0000-0000-0000-000000033556', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033537', 2000, 'XAF', 'mobile_money', 'flagged', 'taramoney', '00000000-0000-0000-0000-000000033527', 'session', 'provider_declined');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment(id, 5) from payments where id between '00000000-0000-0000-0000-000000033553' and '00000000-0000-0000-0000-000000033556';
reset role;

select is(
  (select count(*)::int from guest_sessions where payment_id between '00000000-0000-0000-0000-000000033553' and '00000000-0000-0000-0000-000000033556'),
  0,
  'no session for wrong_account, reconciliation_mismatch, staff_flagged or provider_declined'
);

select is(
  (select string_agg(status::text || ':' || flagged_reason, ',' order by id) from payments
   where id between '00000000-0000-0000-0000-000000033553' and '00000000-0000-0000-0000-000000033556'),
  'flagged:wrong_account,flagged:reconciliation_mismatch,flagged:staff_flagged,flagged:provider_declined',
  'the four bad-flag rows are unchanged'
);

select is(
  (select count(*)::int from audit_log where action_type in ('session_payment_paid', 'session_late_payment')
     and target_entity_id in ('00000000-0000-0000-0000-000000033534', '00000000-0000-0000-0000-000000033535',
                              '00000000-0000-0000-0000-000000033536', '00000000-0000-0000-0000-000000033537')),
  0,
  'the bad-flag rows write no session audit'
);

-- ============================================================================
-- Subscription confirmation, then a desk action on the same member.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose) values
  ('00000000-0000-0000-0000-000000033557', '00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033539', 15000, 'XAF', 'mobile_money', 'processing', 'taramoney', null, 'subscription');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select isnt(
  (select complete_verified_payment('00000000-0000-0000-0000-000000033557', 100)),
  null::uuid,
  'a subscription confirmation still returns the new subscription id'
);
reset role;

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033539'),
  0,
  'a subscription confirmation creates no session'
);

-- ============================================================================
-- The helper's assertions (19.4 triage #2).
-- ============================================================================
select throws_like(
  $$ select private.create_guest_session_for_payment('00000000-0000-0000-0000-000000033551', '00000000-0000-0000-0000-000000033532', '00000000-0000-0000-0000-000000033511') $$,
  'invalid_session_payment:%',
  'the helper refuses a payment that is not verified'
);

select throws_like(
  $$ select private.create_guest_session_for_payment('00000000-0000-0000-0000-000000033557', '00000000-0000-0000-0000-000000033539', '00000000-0000-0000-0000-000000033511') $$,
  'invalid_session_payment:%',
  'the helper refuses a payment that is not a session payment'
);

select throws_like(
  $$ select private.create_guest_session_for_payment((select id from payments where member_id = '00000000-0000-0000-0000-000000033531'), '00000000-0000-0000-0000-000000033532', '00000000-0000-0000-0000-000000033511') $$,
  'invalid_session_payment:%',
  'the helper refuses a payment of another member'
);

select throws_like(
  $$ select private.create_guest_session_for_payment('00000000-0000-0000-0000-0000000335ff', '00000000-0000-0000-0000-000000033532', '00000000-0000-0000-0000-000000033511') $$,
  'invalid_session_payment:%',
  'the helper refuses an unknown payment'
);

-- ============================================================================
-- Lock order and the in-flight index.
-- ============================================================================
select ok(
  (select position('for update' in p.prosrc) between 1 and position('for no key update' in p.prosrc) - 1
          and position('for no key update' in p.prosrc) < position('update payments' in p.prosrc)
   from pg_proc p where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure),
  'complete_verified_payment locks the payment row, then the member row, before any write'
);

select ok(
  (select position('expire_stale_payment' in p.prosrc) between 1 and position('for no key update' in p.prosrc) - 1
   from pg_proc p where p.oid = 'public.initiate_session_payment()'::regprocedure),
  'initiate_session_payment flags expired attempts before the member lock'
);

select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, provider, purpose)
     values ('00000000-0000-0000-0000-000000033511', '00000000-0000-0000-0000-000000033538', 3500, 'XAF', 'mobile_money', 'processing', 'taramoney', 'session') $$,
  '23505',
  null,
  'the partial unique index blocks a second in-flight session payment'
);

select is(
  (select count(*)::int from pg_indexes where indexname = 'payments_one_inflight_session_per_member'),
  1,
  'the in-flight index exists'
);

select * from finish();
rollback;
