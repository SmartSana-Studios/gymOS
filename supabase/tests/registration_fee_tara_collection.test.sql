-- Story 18.3: Tara Money registration fee collection (migration 0100),
-- positive paths. The denial paths live in
-- registration_fee_tara_collection.negative.test.sql.
--
-- The payment-webhook Edge Function is not exercised here: its confirmation
-- path is simulated by calling complete_verified_payment() /
-- complete_flagged_payment() as service_role with a service-role JWT, which is
-- exactly what the function's service client does.
--
-- Fee gyms are seeded with `registration_fee` in the gym INSERT itself:
-- gyms.registration_fee is pinned against every UPDATE except
-- set_registration_fee()'s own, silently.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000313xx (letters a-e are hex).

begin;
select plan(70);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031380', 'RegFee Tara Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031391', 'RegFee Tara Gym', '00000000-0000-0000-0000-000000031380', 'active', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000313a1'), -- owner
  ('00000000-0000-0000-0000-0000000313a2'), -- receptionist
  ('00000000-0000-0000-0000-0000000313a3'), -- manager
  ('00000000-0000-0000-0000-0000000313a4'), -- supervisor
  ('00000000-0000-0000-0000-0000000313c1'), -- member 1: initiated by receptionist
  ('00000000-0000-0000-0000-0000000313c2'), -- member 2: initiated by manager
  ('00000000-0000-0000-0000-0000000313c3'), -- member 3: initiated by supervisor
  ('00000000-0000-0000-0000-0000000313c4'), -- member 4: initiated by owner
  ('00000000-0000-0000-0000-0000000313c5'), -- member 5: paid by Tara
  ('00000000-0000-0000-0000-0000000313c6'), -- member 6: declined by Tara
  ('00000000-0000-0000-0000-0000000313c7'), -- member 7: waiting
  ('00000000-0000-0000-0000-0000000313c8'), -- member 8: expired then Tara retry
  ('00000000-0000-0000-0000-0000000313c9'), -- member 9: expired then cash
  ('00000000-0000-0000-0000-0000000313ca'), -- member 10: expired then waive
  ('00000000-0000-0000-0000-0000000313cb'), -- member 11: expiry boundary
  ('00000000-0000-0000-0000-0000000313cc'), -- member 12: already paid by cash
  ('00000000-0000-0000-0000-0000000313cd'), -- member 13: settled, subscription branch control
  ('00000000-0000-0000-0000-0000000313ce'); -- member 14: awaiting, self-service renewal pin

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000000313b1', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313a1', 'owner',        'TC Owner',        current_date),
  ('00000000-0000-0000-0000-0000000313b2', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313a2', 'receptionist', 'TC Receptionist', current_date),
  ('00000000-0000-0000-0000-0000000313b3', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313a3', 'manager',      'TC Manager',      current_date),
  ('00000000-0000-0000-0000-0000000313b4', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313a4', 'supervisor',   'TC Supervisor',   current_date),
  ('00000000-0000-0000-0000-0000000313d1', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c1', 'member', 'TC Member 1',  current_date),
  ('00000000-0000-0000-0000-0000000313d2', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c2', 'member', 'TC Member 2',  current_date),
  ('00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c3', 'member', 'TC Member 3',  current_date),
  ('00000000-0000-0000-0000-0000000313d4', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c4', 'member', 'TC Member 4',  current_date),
  ('00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c5', 'member', 'TC Member 5',  current_date),
  ('00000000-0000-0000-0000-0000000313d6', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c6', 'member', 'TC Member 6',  current_date),
  ('00000000-0000-0000-0000-0000000313d7', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c7', 'member', 'TC Member 7',  current_date),
  ('00000000-0000-0000-0000-0000000313d8', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c8', 'member', 'TC Member 8',  current_date),
  ('00000000-0000-0000-0000-0000000313d9', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313c9', 'member', 'TC Member 9',  current_date),
  ('00000000-0000-0000-0000-0000000313da', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313ca', 'member', 'TC Member 10', current_date),
  ('00000000-0000-0000-0000-0000000313db', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313cb', 'member', 'TC Member 11', current_date),
  ('00000000-0000-0000-0000-0000000313dc', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313cc', 'member', 'TC Member 12', current_date),
  ('00000000-0000-0000-0000-0000000313dd', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313cd', 'member', 'TC Member 13', current_date),
  ('00000000-0000-0000-0000-0000000313de', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313ce', 'member', 'TC Member 14', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-0000000313f1', '00000000-0000-0000-0000-000000031391', 'TC Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- Member 13 is settled and renewing: the subscription branch control.
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-0000000313dd';
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-0000000313f2', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313dd', '00000000-0000-0000-0000-0000000313f1', 'expired', current_date - 60, current_date - 30);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000031391' and role = 'member' and registration_fee_settled_at is null),
  13,
  'fixture sanity: thirteen of the fourteen members start awaiting'
);

-- ============================================================================
-- Interface: the amount and the payer phone are not parameters.
-- ============================================================================
select is(
  (select pronargs::int from pg_proc where oid = 'public.initiate_registration_fee_payment(uuid)'::regprocedure),
  1,
  'initiate_registration_fee_payment takes only the member id -- no amount, no phone'
);

select is(
  (select proargnames from pg_proc where oid = 'public.initiate_registration_fee_payment(uuid)'::regprocedure),
  array['p_member_id', 'payment_id', 'provider_key'],
  'it returns the payment id and the provider key'
);

-- ============================================================================
-- Start: each staff role that may collect.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
create temp table tc_started as
  select * from initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1');
select is(
  (select count(*)::int from tc_started),
  1,
  'receptionist can start a Tara fee collection'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a3","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"manager"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d2') $$,
  'manager can start a Tara fee collection'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a4","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"supervisor"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d3') $$,
  'supervisor can start a Tara fee collection'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"owner"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d4') $$,
  'owner can start a Tara fee collection'
);
reset role;

select is(
  (select row(p.amount, p.currency, p.method, p.status::text, p.provider, p.purpose, p.subscription_id, p.actor_id, p.voided_at, p.reason, p.gym_id, p.provider_transaction_ref)::text
   from payments p where p.member_id = '00000000-0000-0000-0000-0000000313d1'),
  row(5000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee', null::uuid,
      '00000000-0000-0000-0000-0000000313a2'::uuid, null::timestamptz, null::text,
      '00000000-0000-0000-0000-000000031391'::uuid, null::text)::text,
  'the row is processing, mobile_money, taramoney, XAF, at exactly the gym fee, registration_fee, no subscription, actor = the caller, and no provider_transaction_ref (the initiate route refuses a row that already has one)'
);

select is(
  (select payment_id from tc_started),
  (select id from payments where member_id = '00000000-0000-0000-0000-0000000313d1'),
  'the RPC returns the new payment id'
);

select is(
  (select provider_key from tc_started),
  'taramoney',
  'the RPC returns the active provider key'
);

select is(
  (select array_agg(p.amount order by p.member_id) from payments p
   where p.member_id in ('00000000-0000-0000-0000-0000000313d1', '00000000-0000-0000-0000-0000000313d2',
                         '00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-0000000313d4')),
  array[5000, 5000, 5000, 5000],
  'every role started a collection at the gym fee'
);

select is(
  (select count(*)::int from members where id in ('00000000-0000-0000-0000-0000000313d1', '00000000-0000-0000-0000-0000000313d2',
                                                   '00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-0000000313d4')
     and registration_fee_settled_at is not null),
  0,
  'starting a collection does not settle the member: only the confirmation does'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches d join payments p on p.id = d.payment_id where p.purpose = 'registration_fee'),
  0,
  'starting a collection sends no notification'
);

-- ============================================================================
-- Paid: a confirmation settles the member and never creates a subscription.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d5');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment((select id from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee'), 125)),
  null::uuid,
  'complete_verified_payment on a fee payment returns null (no subscription)'
);
reset role;

select is(
  (select row(p.status::text, p.provider_fee_amount, p.subscription_id, p.purpose)::text from payments p where p.id = (select id from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee')),
  row('verified', 125, null::uuid, 'registration_fee')::text,
  'the fee payment is verified, carries the provider fee, and has no subscription'
);

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d5'),
  null,
  'the member is settled'
);

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-0000000313d5'),
  0,
  'no subscription was created for the paid member'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_paid' and target_entity_id = '00000000-0000-0000-0000-0000000313d5'),
  1,
  'one registration_fee_paid audit row exists'
);

select is(
  (select row(a.actor_display_name, a.actor_id, a.target_entity_type, a.gym_id, a.metadata->>'amount', a.metadata->>'payment_id')::text
   from audit_log a where a.action_type = 'registration_fee_paid' and a.target_entity_id = '00000000-0000-0000-0000-0000000313d5'),
  row('payment-webhook', null::uuid, 'member', '00000000-0000-0000-0000-000000031391'::uuid, '5000', (select id::text from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee'))::text,
  'the audit row is actor payment-webhook, targets the member, and carries the amount and payment id'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches d where d.payment_id = (select id from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee')),
  0,
  'the verified fee payment sends no notification'
);

-- Replay: the same confirmation twice is a no-op.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment((select id from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee'), 999)),
  null::uuid,
  'a replayed confirmation returns null'
);
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_paid' and target_entity_id = '00000000-0000-0000-0000-0000000313d5'),
  1,
  'the replay wrote no second audit row'
);

select is(
  (select provider_fee_amount from payments where id = (select id from payments where member_id = '00000000-0000-0000-0000-0000000313d5' and purpose = 'registration_fee')),
  125,
  'the replay did not rewrite the provider fee'
);

-- The 18.1 gate no longer rejects the settled member.
select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-0000000313f1', 'active', current_date, current_date + 30) $$,
  'a member settled by Tara can be given a subscription: the 18.1 gate no longer rejects it'
);

-- A paid member can no longer be charged or recorded.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select throws_like(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d5') $$,
  '%registration_fee_already_recorded%',
  'a verified fee row yields registration_fee_already_recorded for a second Tara attempt'
);
reset role;

-- ============================================================================
-- Declined: failure flags the row, sends nothing, and the retry is allowed.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d6');
reset role;

select set_config('tc.declined_id', (select id::text from payments where member_id = '00000000-0000-0000-0000-0000000313d6'), true);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$ select complete_flagged_payment(current_setting('tc.declined_id')::uuid) $$,
  'the failure confirmation runs'
);
reset role;

select is(
  (select status::text from payments where id = current_setting('tc.declined_id')::uuid),
  'flagged',
  'a declined collection is flagged'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d6'),
  null,
  'a declined collection leaves the member awaiting'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches d where d.payment_id = current_setting('tc.declined_id')::uuid),
  0,
  'a declined collection sends no notification'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d6') $$,
  'after a declined collection the Tara retry is allowed'
);
reset role;

select is(
  (select array_agg(status::text order by status::text) from payments where member_id = '00000000-0000-0000-0000-0000000313d6'),
  array['flagged', 'processing'],
  'the flagged row is kept and a new processing row sits beside it'
);

-- ============================================================================
-- Waiting: a processing row younger than ten minutes blocks everything.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a3","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"manager"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d7') $$,
  'setup: a collection is started for the waiting member'
);

select throws_like(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d7') $$,
  '%registration_fee_already_pending%',
  'a second Tara attempt while waiting is refused'
);
select throws_like(
  $$ select record_registration_fee('00000000-0000-0000-0000-0000000313d7', 'cash', 'Cash while the prompt is out') $$,
  '%registration_fee_already_pending%',
  'recording cash while waiting is refused'
);
select throws_like(
  $$ select waive_registration_fee('00000000-0000-0000-0000-0000000313d7', 'Waive while the prompt is out') $$,
  '%registration_fee_already_pending%',
  'waiving while waiting is refused'
);
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-0000000313d7'),
  1,
  'the refused calls wrote no second row'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d7'),
  null,
  'the refused calls left the member awaiting'
);

select is(
  (select status::text from payments where member_id = '00000000-0000-0000-0000-0000000313d7'),
  'processing',
  'the waiting row is still processing'
);

-- ============================================================================
-- Boundary: exactly ten minutes still waits; one second more has expired.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, created_at)
values ('00000000-0000-0000-0000-0000000313e1', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313db', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney',
        '00000000-0000-0000-0000-0000000313a2', 'registration_fee', now() - interval '10 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select throws_like(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313db') $$,
  '%registration_fee_already_pending%',
  'a row exactly ten minutes old is still waiting'
);
reset role;

update payments set created_at = now() - interval '10 minutes 1 second' where id = '00000000-0000-0000-0000-0000000313e1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313db') $$,
  'a row ten minutes and one second old has expired and the Tara retry proceeds'
);
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e1'),
  'flagged',
  'the expired row was flagged'
);

-- ============================================================================
-- Expired: Tara retry, cash and waive each flag the old row and proceed.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, created_at) values
  ('00000000-0000-0000-0000-0000000313e2', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313d8', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-0000000313a2', 'registration_fee', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-0000000313e3', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313d9', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-0000000313a2', 'registration_fee', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-0000000313e4', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313da', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-0000000313a2', 'registration_fee', now() - interval '11 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select lives_ok(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d8') $$,
  'an expired attempt does not block a new Tara attempt'
);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-0000000313d9', 'cash', 'Paid cash after the prompt expired') $$,
  'an expired attempt does not block recording cash'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a3","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"manager"}', true);
select lives_ok(
  $$ select waive_registration_fee('00000000-0000-0000-0000-0000000313da', 'Waived after the prompt expired') $$,
  'an expired attempt does not block a waive'
);
reset role;

select is(
  (select array_agg(status::text order by status::text) from payments where member_id = '00000000-0000-0000-0000-0000000313d8'),
  array['flagged', 'processing'],
  'Tara retry: the old row is flagged and a new processing row exists'
);
select is(
  (select array_agg(status::text order by status::text) from payments where member_id = '00000000-0000-0000-0000-0000000313d9'),
  array['flagged', 'verified'],
  'cash: the old row is flagged and a verified cash row exists'
);
select is(
  (select array_agg(status::text order by status::text) from payments where member_id = '00000000-0000-0000-0000-0000000313da'),
  array['flagged'],
  'waive: the old row is flagged and no new payment row exists'
);
select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313da'),
  null,
  'the waived member is settled'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_attempt_expired'
     and target_entity_id in ('00000000-0000-0000-0000-0000000313d8', '00000000-0000-0000-0000-0000000313d9', '00000000-0000-0000-0000-0000000313da', '00000000-0000-0000-0000-0000000313db')),
  4,
  'each expiry wrote one registration_fee_attempt_expired audit row'
);

select is(
  (select row(a.actor_id, a.target_entity_type, a.gym_id, a.metadata->>'payment_id')::text
   from audit_log a where a.action_type = 'registration_fee_attempt_expired' and a.target_entity_id = '00000000-0000-0000-0000-0000000313d8'),
  row('00000000-0000-0000-0000-0000000313a2'::uuid, 'member', '00000000-0000-0000-0000-000000031391'::uuid, '00000000-0000-0000-0000-0000000313e2')::text,
  'the expiry audit row names the actor, the member and the expired payment'
);

select is(
  (select count(*)::int from private.payment_notification_dispatches d join payments p on p.id = d.payment_id where p.purpose = 'registration_fee'),
  0,
  'expiring a fee attempt sends no notification'
);

-- A late success after flagging is not applied.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-0000000313e2'::uuid, 100)),
  null::uuid,
  'a late success for an expired (flagged) fee payment returns null'
);
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e2'),
  'flagged',
  'the late success did not move the flagged row to verified'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d8'),
  null,
  'the late success did not settle the member'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_paid' and target_entity_id = '00000000-0000-0000-0000-0000000313d8'),
  0,
  'the late success wrote no registration_fee_paid audit row'
);

-- ============================================================================
-- Already recorded by cash: a Tara attempt is refused.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-0000000313dc', 'cash', 'Paid cash at the desk') $$,
  'setup: the fee is recorded by cash'
);
select throws_like(
  $$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313dc') $$,
  '%registration_fee_already_recorded%',
  'a Tara attempt on a cash-paid member yields registration_fee_already_recorded'
);
reset role;

-- ============================================================================
-- The subscription branch is unchanged.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-0000000313e5', '00000000-0000-0000-0000-000000031391', '00000000-0000-0000-0000-0000000313dd', 15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'regfee-tara-sub-001');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select isnt(
  (select complete_verified_payment('00000000-0000-0000-0000-0000000313e5'::uuid, 450)),
  null::uuid,
  'a subscription payment still returns the new subscription id'
);
reset role;

select is(
  (select row(p.status::text, p.purpose, (p.subscription_id is not null))::text from payments p where p.id = '00000000-0000-0000-0000-0000000313e5'),
  row('verified', 'subscription', true)::text,
  'the subscription payment is verified and linked to the new subscription'
);

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-0000000313dd' and status = 'active'),
  1,
  'the renewal created one active subscription'
);

select is(
  (select count(*)::int from audit_log where action_type = 'subscription_payment_renewal' and target_entity_id = '00000000-0000-0000-0000-0000000313dd'),
  1,
  'the renewal wrote its subscription_payment_renewal audit row'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_paid' and target_entity_id = '00000000-0000-0000-0000-0000000313dd'),
  0,
  'a subscription payment writes no registration_fee_paid audit row'
);

-- ============================================================================
-- An awaiting member cannot self-initiate a renewal: no plan to renew.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313ce","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031391","app_role":"member"}', true);
select throws_like(
  $$ select initiate_member_payment() $$,
  '%no_active_plan%',
  'an awaiting member''s initiate_member_payment raises no_active_plan'
);
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-0000000313de'),
  0,
  'the awaiting member''s self-service attempt wrote no payment row'
);

-- ============================================================================
-- Hardening checks on the catalog.
-- ============================================================================
select is(
  (select prosecdef from pg_proc where oid = 'public.initiate_registration_fee_payment(uuid)'::regprocedure),
  true,
  'initiate_registration_fee_payment is SECURITY DEFINER'
);

select is(
  (select prosecdef from pg_proc where oid = 'private.expire_stale_registration_fee_payment(uuid, uuid)'::regprocedure),
  false,
  'the expiry helper is SECURITY INVOKER'
);

select is(
  has_function_privilege('authenticated', 'public.complete_verified_payment(uuid, integer)', 'execute'),
  false,
  'complete_verified_payment is not executable by authenticated'
);

select is(
  has_function_privilege('service_role', 'public.complete_verified_payment(uuid, integer)', 'execute'),
  true,
  'complete_verified_payment stays executable by service_role'
);

select is(
  has_function_privilege('anon', 'public.initiate_registration_fee_payment(uuid)', 'execute'),
  false,
  'anon cannot execute initiate_registration_fee_payment'
);

select is(
  has_function_privilege('authenticated', 'public.initiate_registration_fee_payment(uuid)', 'execute'),
  true,
  'authenticated can execute initiate_registration_fee_payment'
);

select * from finish();
rollback;
