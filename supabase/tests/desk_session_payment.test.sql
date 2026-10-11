-- Story 19.4: desk session payment (migration 0108), positive paths. Denial
-- paths live in desk_session_payment.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000330xx.
--
-- Concurrency limit: pgTAP runs one session, so true interleaving of two
-- callers cannot be exercised here. What is asserted instead is (a) two
-- sequential calls for one member both succeed, (b) the function source takes
-- the payment-row expiry flag before the member row lock (the canonical order,
-- also pinned by 0108's own verify block), and (c) the lock is FOR NO KEY
-- UPDATE, so it does not conflict with FK-key lookups from guest_sessions.

begin;
select plan(38);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033001', 'Desk Session Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session) values
  ('00000000-0000-0000-0000-000000033011', 'Desk Session Gym', '00000000-0000-0000-0000-000000033001', 'active', true);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033021'), -- owner
  ('00000000-0000-0000-0000-000000033022'), -- manager
  ('00000000-0000-0000-0000-000000033023'), -- supervisor
  ('00000000-0000-0000-0000-000000033024'), -- receptionist
  ('00000000-0000-0000-0000-000000033025'), -- member: cash by receptionist
  ('00000000-0000-0000-0000-000000033026'), -- member: bank by manager
  ('00000000-0000-0000-0000-000000033027'), -- member: bank by supervisor
  ('00000000-0000-0000-0000-000000033028'), -- member: momo by owner
  ('00000000-0000-0000-0000-000000033029'), -- member: stale attempt
  ('00000000-0000-0000-0000-00000003302a'), -- member: double entry
  ('00000000-0000-0000-0000-00000003302b'); -- member: latest plan wins

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000033031', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033021', 'owner',        'DS Owner',        current_date),
  ('00000000-0000-0000-0000-000000033032', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033022', 'manager',      'DS Manager',      current_date),
  ('00000000-0000-0000-0000-000000033033', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033023', 'supervisor',   'DS Supervisor',   current_date),
  ('00000000-0000-0000-0000-000000033034', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033024', 'receptionist', 'DS Receptionist', current_date),
  ('00000000-0000-0000-0000-000000033035', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033025', 'member', 'DS Cash',    current_date),
  ('00000000-0000-0000-0000-000000033036', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033026', 'member', 'DS Bank Mgr', current_date),
  ('00000000-0000-0000-0000-000000033037', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033027', 'member', 'DS Bank Sup', current_date),
  ('00000000-0000-0000-0000-000000033038', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033028', 'member', 'DS Momo Own', current_date),
  ('00000000-0000-0000-0000-000000033039', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033029', 'member', 'DS Stale',    current_date),
  ('00000000-0000-0000-0000-00000003303a', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-00000003302a', 'member', 'DS Double',   current_date),
  ('00000000-0000-0000-0000-00000003303b', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-00000003302b', 'member', 'DS Latest',   current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000033041', '00000000-0000-0000-0000-000000033011', 'DS PPS 2000', 'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033042', '00000000-0000-0000-0000-000000033011', 'DS PPS 3500', 'pay_per_session', 3500,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033043', '00000000-0000-0000-0000-000000033011', 'DS Monthly',  'monthly',         15000, 'XAF', 'monthly', 30);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033035', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033036', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033037', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033038', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033039', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-00000003303a', '00000000-0000-0000-0000-000000033041', 'active', current_date, null, now()),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-00000003303b', '00000000-0000-0000-0000-000000033041', 'expired', current_date - 60, null, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-00000003303b', '00000000-0000-0000-0000-000000033042', 'active',  current_date, null, now() - interval '1 day');

-- Interface: neither the amount nor the currency is a parameter.
select is(
  (select proargnames from pg_proc where oid = 'public.record_session_payment(uuid, text, text)'::regprocedure),
  array['p_member_id', 'p_method', 'p_reason'],
  'record_session_payment takes no amount argument'
);

-- ============================================================================
-- Cash sale by a receptionist.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"receptionist"}', true);

select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033035', 'cash') $$,
  'receptionist can record a cash session payment (reason omitted)'
);

select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033038', 'manual_momo', '   ') $$,
  'receptionist can record a manual_momo session payment with a blank reason'
);
reset role;

select is(
  (select row(p.amount, p.currency, p.method::text, p.status::text, p.purpose, p.subscription_id, p.actor_id, p.voided_at, p.reason, p.gym_id)::text
   from payments p where p.member_id = '00000000-0000-0000-0000-000000033035'),
  row(2000, 'XAF', 'cash', 'verified', 'session', null::uuid,
      '00000000-0000-0000-0000-000000033024'::uuid, null::timestamptz, null::text,
      '00000000-0000-0000-0000-000000033011'::uuid)::text,
  'the payment is verified, plan price and currency, purpose session, no subscription, actor = caller, reason null'
);

select is(
  (select p.reason from payments p where p.member_id = '00000000-0000-0000-0000-000000033038'),
  null,
  'a blank reason is stored as null'
);

select is(
  (select row(g.gym_id, g.payment_id, g.loyalty_grant_id, g.consumed_at, g.covered_day, g.voided_at)::text
   from guest_sessions g where g.member_id = '00000000-0000-0000-0000-000000033035'),
  row('00000000-0000-0000-0000-000000033011'::uuid,
      (select p.id from payments p where p.member_id = '00000000-0000-0000-0000-000000033035'),
      null::uuid, null::timestamptz, null::date, null::timestamptz)::text,
  'one unconsumed guest_sessions row backed by the payment'
);

select is(
  (select g.usable_until from guest_sessions g where g.member_id = '00000000-0000-0000-0000-000000033035'),
  now() + interval '7 days',
  'usable_until is now plus the default 7 paid-session validity days'
);

select is(
  (select metadata - 'payment_id' - 'guest_session_id' from audit_log
   where action_type = 'session_payment_recorded' and target_entity_id = '00000000-0000-0000-0000-000000033035'),
  '{"amount": 2000, "currency": "XAF", "method": "cash", "reason": null}'::jsonb,
  'one session_payment_recorded audit row against the member with amount, currency, method, reason'
);

select is(
  (select (metadata ->> 'guest_session_id')::uuid from audit_log
   where action_type = 'session_payment_recorded' and target_entity_id = '00000000-0000-0000-0000-000000033035'),
  (select g.id from guest_sessions g where g.member_id = '00000000-0000-0000-0000-000000033035'),
  'the audit row carries the guest_session id'
);

select is(
  (select (metadata ->> 'payment_id')::uuid from audit_log
   where action_type = 'session_payment_recorded' and target_entity_id = '00000000-0000-0000-0000-000000033035'),
  (select p.id from payments p where p.member_id = '00000000-0000-0000-0000-000000033035'),
  'the audit row carries the payment id'
);

-- A session payment sends no push notification (the trigger allow-lists
-- subscription payments only).
select is(
  (select count(*)::int from notifications where member_id = '00000000-0000-0000-0000-000000033035'),
  0,
  'a session payment queues no notification'
);

-- ============================================================================
-- Bank transfer by manager, supervisor; owner; return value.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"manager"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033036', 'bank_transfer', '  Transfer receipt checked  ') $$,
  'manager can record a bank_transfer session payment'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"supervisor"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033037', 'bank_transfer') $$,
  'supervisor can record a bank_transfer session payment'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"owner"}', true);
select is(
  (select (s).member_id from (select record_session_payment('00000000-0000-0000-0000-00000003303b', 'cash', 'Owner sale') as s) q),
  '00000000-0000-0000-0000-00000003303b'::uuid,
  'owner can record a sale and the call returns the guest_sessions row'
);
reset role;

select is(
  (select p.reason from payments p where p.member_id = '00000000-0000-0000-0000-000000033036'),
  'Transfer receipt checked',
  'the stored reason is trimmed'
);

select is(
  (select p.amount from payments p where p.member_id = '00000000-0000-0000-0000-00000003303b' and p.purpose = 'session'),
  3500,
  'the amount comes from the latest subscription''s plan, not an earlier one'
);

select is(
  (select count(*)::int from guest_sessions where gym_id = '00000000-0000-0000-0000-000000033011'),
  5,
  'five sessions exist after five sales'
);

-- ============================================================================
-- Stale attempt: a processing session payment older than 10 minutes is flagged
-- expired_attempt, audited, and the new sale proceeds.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033051', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033039',
   2000, 'XAF', 'mtn_momo', 'processing', 'session', now() - interval '15 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033039', 'cash', 'Guest paid at the desk') $$,
  'a sale proceeds past a stale processing session payment'
);
reset role;

select is(
  (select row(p.status::text, p.flagged_reason)::text from payments p where p.id = '00000000-0000-0000-0000-000000033051'),
  row('flagged', 'expired_attempt')::text,
  'the stale attempt is flagged expired_attempt'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'session_attempt_expired' and target_entity_id = '00000000-0000-0000-0000-000000033039'),
  1,
  'the expiry is audited as session_attempt_expired'
);

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033039'),
  1,
  'the new sale created exactly one session'
);

-- ============================================================================
-- Double entry: two sales for one member both succeed.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003303a', 'cash') $$,
  'first desk sale for the member'
);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003303a', 'cash') $$,
  'a second desk sale for the same member is allowed'
);
reset role;

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-00000003303a'),
  2,
  'double entry yields two sessions'
);

select is(
  (select count(distinct payment_id)::int from guest_sessions where member_id = '00000000-0000-0000-0000-00000003303a'),
  2,
  'each session is backed by its own payment'
);

-- ============================================================================
-- The lapse comes from platform_session_config.
-- ============================================================================
update platform_session_config set paid_session_validity_days = 3;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033011","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003303a', 'cash') $$,
  'a sale after the platform validity changed'
);
reset role;

select is(
  (select min(usable_until) from guest_sessions where member_id = '00000000-0000-0000-0000-00000003303a'),
  now() + interval '3 days',
  'usable_until follows the configured paid_session_validity_days'
);

select is(
  (select count(*)::int from guest_sessions g
   where g.member_id = '00000000-0000-0000-0000-00000003303a' and g.usable_until = now() + interval '7 days'),
  2,
  'sessions created earlier keep their original lapse'
);

-- ============================================================================
-- Function shape and ACL.
-- ============================================================================
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=public']
   from pg_proc p where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure),
  'record_session_payment is SECURITY DEFINER with search_path = public'
);

select ok(
  (select position('expire_stale_payment' in p.prosrc) between 1 and position('for no key update' in p.prosrc) - 1
   from pg_proc p where p.oid = 'public.record_session_payment(uuid, text, text)'::regprocedure),
  'lock order: the payment-row expiry flag precedes the member FOR NO KEY UPDATE lock'
);

select ok(
  not has_function_privilege('anon', 'public.record_session_payment(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'private.create_guest_session_for_payment(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'private.expire_stale_payment(uuid, uuid, text)', 'execute'),
  'anon cannot execute the new functions'
);

select ok(
  has_function_privilege('authenticated', 'public.record_session_payment(uuid, text, text)', 'execute'),
  'authenticated can execute record_session_payment'
);

select ok(
  not has_function_privilege('authenticated', 'private.create_guest_session_for_payment(uuid, uuid, uuid)', 'execute'),
  'authenticated cannot execute the private session-creation function'
);

-- ============================================================================
-- The generalized expiry helper: the fee wrapper keeps its audit code.
-- ============================================================================
select is(
  (select p.prorettype::regtype::text from pg_proc p
   where p.oid = 'private.create_guest_session_for_payment(uuid, uuid, uuid)'::regprocedure),
  'guest_sessions',
  'the shared helper returns the guest_sessions row'
);

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033052', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033038',
   5000, 'XAF', 'mtn_momo', 'processing', 'registration_fee', now() - interval '20 minutes');

select lives_ok(
  $$ select private.expire_stale_registration_fee_payment('00000000-0000-0000-0000-000000033038', '00000000-0000-0000-0000-000000033011') $$,
  'the fee expiry wrapper still runs'
);

select is(
  (select row(p.status::text, p.flagged_reason)::text from payments p where p.id = '00000000-0000-0000-0000-000000033052'),
  row('flagged', 'expired_attempt')::text,
  'the wrapper flags a stale fee attempt exactly as before'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'registration_fee_attempt_expired' and target_entity_id = '00000000-0000-0000-0000-000000033038'),
  1,
  'the wrapper keeps the registration_fee_attempt_expired audit code'
);

-- A fresh attempt is left alone by the generic helper.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033053', '00000000-0000-0000-0000-000000033011', '00000000-0000-0000-0000-000000033036',
   2000, 'XAF', 'mtn_momo', 'processing', 'session', now() - interval '2 minutes');

select private.expire_stale_payment('00000000-0000-0000-0000-000000033036', '00000000-0000-0000-0000-000000033011', 'session');

select is(
  (select p.status::text from payments p where p.id = '00000000-0000-0000-0000-000000033053'),
  'processing',
  'a fresh attempt is not expired'
);

select * from finish();
rollback;
