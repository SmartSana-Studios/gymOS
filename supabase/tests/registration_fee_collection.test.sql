-- Story 18.2: registration fee collection and waiver (migration 0099),
-- positive paths. The denial paths live in
-- registration_fee_collection.negative.test.sql.
--
-- Fee gyms are seeded with `registration_fee` in the gym INSERT itself:
-- gyms.registration_fee is pinned against every UPDATE except
-- set_registration_fee()'s own, silently (see docs/decisions.md).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000312xx.

begin;
select plan(49);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031201', 'RegFee Collect Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031211', 'RegFee Collect Gym',  '00000000-0000-0000-0000-000000031201', 'active', 5000),
  ('00000000-0000-0000-0000-000000031212', 'RegFee Lowered Gym',  '00000000-0000-0000-0000-000000031201', 'active', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000031221'), -- owner
  ('00000000-0000-0000-0000-000000031222'), -- manager
  ('00000000-0000-0000-0000-000000031223'), -- supervisor
  ('00000000-0000-0000-0000-000000031224'), -- receptionist
  ('00000000-0000-0000-0000-000000031225'), -- member: recorded by receptionist
  ('00000000-0000-0000-0000-000000031226'), -- member: recorded by manager
  ('00000000-0000-0000-0000-000000031227'), -- member: recorded by supervisor
  ('00000000-0000-0000-0000-000000031228'), -- member: recorded by owner
  ('00000000-0000-0000-0000-000000031229'), -- member: waived by owner
  ('00000000-0000-0000-0000-00000003122a'), -- member: waived by supervisor
  ('00000000-0000-0000-0000-00000003122b'), -- member: waived by manager
  ('00000000-0000-0000-0000-00000003122c'), -- member: flagged retry
  ('00000000-0000-0000-0000-00000003122d'), -- member: fee payment notification checks
  ('00000000-0000-0000-0000-00000003122e'), -- member: subscription payment notification control
  ('00000000-0000-0000-0000-00000003122f'), -- member: processing fee payment notification checks
  ('00000000-0000-0000-0000-000000031241'), -- owner, lowered gym
  ('00000000-0000-0000-0000-000000031242'); -- member, lowered gym

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031251', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031221', 'owner',        'RC Owner',        current_date),
  ('00000000-0000-0000-0000-000000031252', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031222', 'manager',      'RC Manager',      current_date),
  ('00000000-0000-0000-0000-000000031253', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031223', 'supervisor',   'RC Supervisor',   current_date),
  ('00000000-0000-0000-0000-000000031254', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031224', 'receptionist', 'RC Receptionist', current_date),
  ('00000000-0000-0000-0000-000000031261', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031225', 'member', 'RC Rec Member',     current_date),
  ('00000000-0000-0000-0000-000000031262', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031226', 'member', 'RC Mgr Member',     current_date),
  ('00000000-0000-0000-0000-000000031263', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031227', 'member', 'RC Sup Member',     current_date),
  ('00000000-0000-0000-0000-000000031264', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031228', 'member', 'RC Own Member',     current_date),
  ('00000000-0000-0000-0000-000000031265', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031229', 'member', 'RC Waive Owner',    current_date),
  ('00000000-0000-0000-0000-000000031266', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122a', 'member', 'RC Waive Sup',      current_date),
  ('00000000-0000-0000-0000-000000031267', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122b', 'member', 'RC Waive Mgr',      current_date),
  ('00000000-0000-0000-0000-000000031268', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122c', 'member', 'RC Flagged Retry',   current_date),
  ('00000000-0000-0000-0000-000000031269', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122d', 'member', 'RC Notify Fee',      current_date),
  ('00000000-0000-0000-0000-00000003126a', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122e', 'member', 'RC Notify Sub',      current_date),
  ('00000000-0000-0000-0000-00000003126b', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003122f', 'member', 'RC Notify Proc',     current_date),
  ('00000000-0000-0000-0000-000000031281', '00000000-0000-0000-0000-000000031212', '00000000-0000-0000-0000-000000031241', 'owner',  'RC Owner Lowered',  current_date),
  ('00000000-0000-0000-0000-000000031282', '00000000-0000-0000-0000-000000031212', '00000000-0000-0000-0000-000000031242', 'member', 'RC Member Lowered', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000031291', '00000000-0000-0000-0000-000000031211', 'RC Monthly',         'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000031292', '00000000-0000-0000-0000-000000031212', 'RC Monthly Lowered', 'monthly', 15000, 'XAF', 'monthly', 30);

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000031211' and role = 'member' and registration_fee_settled_at is null),
  11,
  'fixture sanity: all eleven fee-gym members start awaiting'
);

-- ============================================================================
-- Interface: the amount is not a parameter.
-- ============================================================================
select is(
  (select proargnames from pg_proc where oid = 'public.record_registration_fee(uuid, text, text)'::regprocedure),
  array['p_member_id', 'p_method', 'p_reason'],
  'record_registration_fee takes no amount argument -- a client cannot choose it'
);

select is(
  (select proargnames from pg_proc where oid = 'public.waive_registration_fee(uuid, text)'::regprocedure),
  array['p_member_id', 'p_reason'],
  'waive_registration_fee takes only the member and a reason'
);

-- ============================================================================
-- Record: each staff role that may collect, each manual method.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"receptionist"}', true);

select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031261', 'cash', 'Paid in cash at the front desk') $$,
  'receptionist can record a cash registration fee'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"manager"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031262', 'manual_momo', 'Mobile money confirmed by phone') $$,
  'manager can record a manual_momo registration fee'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"supervisor"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031263', 'bank_transfer', 'Bank transfer receipt checked') $$,
  'supervisor can record a bank_transfer registration fee'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"owner"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031264', 'cash', '  Owner collected the fee  ') $$,
  'owner can record a registration fee'
);
reset role;

-- The payment row.
select is(
  (select row(p.amount, p.currency, p.method, p.status::text, p.purpose, p.subscription_id, p.actor_id, p.voided_at, p.reason, p.gym_id)::text
   from payments p where p.member_id = '00000000-0000-0000-0000-000000031261'),
  row(5000, 'XAF', 'cash', 'verified', 'registration_fee', null::uuid,
      '00000000-0000-0000-0000-000000031224'::uuid, null::timestamptz,
      'Paid in cash at the front desk', '00000000-0000-0000-0000-000000031211'::uuid)::text,
  'the fee row is verified, XAF, at exactly the gym fee, purpose registration_fee, no subscription, actor = the caller, not voided'
);

select is(
  (select p.reason from payments p where p.member_id = '00000000-0000-0000-0000-000000031264'),
  'Owner collected the fee',
  'the stored reason is trimmed'
);

select is(
  (select array_agg(p.method order by p.method) from payments p
   where p.member_id in ('00000000-0000-0000-0000-000000031261', '00000000-0000-0000-0000-000000031262',
                         '00000000-0000-0000-0000-000000031263', '00000000-0000-0000-0000-000000031264')),
  array['bank_transfer', 'cash', 'cash', 'manual_momo'],
  'each manual method was stored as given'
);

select is(
  (select count(*)::int from payments
   where gym_id = '00000000-0000-0000-0000-000000031211' and purpose = 'registration_fee' and amount = 5000),
  4,
  'every fee row carries the gym fee'
);

select is(
  (select count(*)::int from members
   where id in ('00000000-0000-0000-0000-000000031261', '00000000-0000-0000-0000-000000031262',
                '00000000-0000-0000-0000-000000031263', '00000000-0000-0000-0000-000000031264')
     and registration_fee_settled_at is not null),
  4,
  'recording the fee settled each member'
);

select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000031265' and registration_fee_settled_at is null),
  1,
  'positive control: a member nobody touched is still awaiting'
);

select is(
  (select metadata from audit_log
   where gym_id = '00000000-0000-0000-0000-000000031211' and action_type = 'registration_fee_recorded'
     and target_entity_id = '00000000-0000-0000-0000-000000031261'),
  jsonb_build_object('amount', 5000, 'currency', 'XAF', 'method', 'cash',
                     'reason', 'Paid in cash at the front desk',
                     'payment_id', (select id from payments where member_id = '00000000-0000-0000-0000-000000031261')),
  'a registration_fee_recorded audit row carries amount, currency, method, reason and the payment id'
);

select is(
  (select target_entity_type from audit_log
   where action_type = 'registration_fee_recorded' and target_entity_id = '00000000-0000-0000-0000-000000031261'),
  'member',
  'the audit row targets the member'
);

-- The 18.1 gate no longer rejects once the fee is recorded.
select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031261', '00000000-0000-0000-0000-000000031291', 'active', current_date, current_date + 30) $$,
  'after a recorded fee the first-subscription gate lets a subscription through'
);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031265', '00000000-0000-0000-0000-000000031291', 'active', current_date, current_date + 30) $$,
  'registration_fee_not_settled%',
  'positive control: the gate still rejects a member who has not paid'
);

-- The return value is the payment id.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"owner"}', true);
create temp table rf_returned as
  select record_registration_fee('00000000-0000-0000-0000-000000031269', 'cash', 'Returned id check on fee row') as id;
reset role;

select is(
  (select id from rf_returned),
  (select id from payments where member_id = '00000000-0000-0000-0000-000000031269'),
  'record_registration_fee returns the new payment id'
);

-- ============================================================================
-- Double record.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"receptionist"}', true);

select throws_like(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031261', 'cash', 'Second attempt at the same fee') $$,
  '%registration_fee_already_recorded%',
  'a second record for the same member is blocked'
);
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031261' and purpose = 'registration_fee'),
  1,
  'the blocked second record wrote no second fee row'
);

-- ============================================================================
-- One-fee-per-member index (the race backstop) and void interaction.
-- ============================================================================
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031262', 5000, 'XAF', 'cash', 'verified', 'registration_fee') $$,
  '23505',
  null,
  'the partial unique index rejects a second non-voided fee payment for a member'
);

select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031262', 5000, 'XAF', 'cash', 'flagged', 'registration_fee') $$,
  'the index ignores a flagged fee payment'
);

update payments set voided_at = now()
where member_id = '00000000-0000-0000-0000-000000031262' and status = 'verified' and purpose = 'registration_fee';

select isnt(
  (select voided_at from payments where member_id = '00000000-0000-0000-0000-000000031262' and status = 'verified'),
  null,
  'a non-client writer (migration role / future definer void) can set voided_at'
);

select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031262', 5000, 'XAF', 'cash', 'verified', 'registration_fee') $$,
  'once the earlier fee payment is voided a new non-voided one is allowed'
);

-- ============================================================================
-- Flagged retry through the RPC.
-- ============================================================================
insert into payments (gym_id, member_id, amount, currency, method, status, purpose, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031268', 5000, 'XAF', 'orange_money', 'flagged', 'registration_fee', 'taramoney', 'regfee-collect-flagged-001');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031268', 'cash', 'Retry after the failed Tara attempt') $$,
  'a prior flagged fee payment does not block a new record'
);
reset role;

select is(
  (select array_agg(status::text order by status::text) from payments
   where member_id = '00000000-0000-0000-0000-000000031268' and purpose = 'registration_fee'),
  array['flagged', 'verified'],
  'the flagged row is kept and a new verified row sits beside it'
);

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031268'),
  null,
  'the flagged-retry member is settled'
);

-- ============================================================================
-- Waive: owner, supervisor, manager.
-- ============================================================================
create temp table rf_payments_before as select count(*)::int as n from payments;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"owner"}', true);
select lives_ok(
  $$ select waive_registration_fee('00000000-0000-0000-0000-000000031265', 'Founding member, fee waived') $$,
  'owner can waive the registration fee'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"supervisor"}', true);
select lives_ok(
  $$ select waive_registration_fee('00000000-0000-0000-0000-000000031266', 'Staff relative, fee waived') $$,
  'supervisor can waive the registration fee'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"manager"}', true);
select lives_ok(
  $$ select waive_registration_fee('00000000-0000-0000-0000-000000031267', 'Promotion, fee waived') $$,
  'manager can waive the registration fee'
);
reset role;

select is(
  (select count(*)::int from members
   where id in ('00000000-0000-0000-0000-000000031265', '00000000-0000-0000-0000-000000031266', '00000000-0000-0000-0000-000000031267')
     and registration_fee_settled_at is not null),
  3,
  'waiving settled all three members'
);

select is(
  (select count(*)::int from payments) - (select n from rf_payments_before),
  0,
  'waiving writes no payment row'
);

select is(
  (select metadata from audit_log
   where action_type = 'registration_fee_waived' and target_entity_id = '00000000-0000-0000-0000-000000031265'),
  '{"reason": "Founding member, fee waived"}'::jsonb,
  'a registration_fee_waived audit row carries the reason'
);

select is(
  (select count(*)::int from audit_log
   where gym_id = '00000000-0000-0000-0000-000000031211' and action_type = 'registration_fee_waived'),
  3,
  'one waived audit row per waiver'
);

select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-000000031265', '00000000-0000-0000-0000-000000031291', 'active', current_date, current_date + 30) $$,
  'after a waiver the first-subscription gate lets a subscription through'
);

-- ============================================================================
-- Lowering the fee to 0 does not release awaiting members; waive still works.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031241","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031212","app_role":"owner"}', true);
select lives_ok($$ select set_registration_fee(0) $$, 'owner lowers the fee to 0');
reset role;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031282'),
  null,
  'lowering the fee to 0 does not release an awaiting member'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031241","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031212","app_role":"owner"}', true);
select lives_ok(
  $$ select waive_registration_fee('00000000-0000-0000-0000-000000031282', 'Fee was dropped, releasing this member') $$,
  'waive works on an awaiting member while the gym fee is 0'
);
reset role;

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031282'),
  null,
  'the waived member of the fee-0 gym is settled'
);

-- ============================================================================
-- The recorded amount follows the gym fee at the time, not a stale value.
-- ============================================================================
update members set registration_fee_settled_at = null where id = '00000000-0000-0000-0000-000000031261';
delete from subscriptions where member_id = '00000000-0000-0000-0000-000000031261';
update payments set voided_at = now() where member_id = '00000000-0000-0000-0000-000000031261';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"owner"}', true);
select lives_ok($$ select set_registration_fee(7500) $$, 'owner raises the fee to 7500');
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031261', 'cash', 'Collected again at the new fee') $$,
  'a member whose earlier fee payment was voided can be recorded again'
);
reset role;

select is(
  (select amount from payments where member_id = '00000000-0000-0000-0000-000000031261' and voided_at is null),
  7500,
  'the recorded amount is the gym fee read at record time'
);

-- ============================================================================
-- Notifications: fee payments send none; a subscription payment still does.
-- ============================================================================
select is(
  (select count(*)::int from private.payment_notification_dispatches d
   join payments p on p.id = d.payment_id where p.purpose = 'registration_fee'),
  0,
  'no N-04/N-05 dispatch row exists for any fee payment recorded above'
);

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000031301', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003126b', 5000, 'XAF', 'orange_money', 'processing', 'registration_fee', 'taramoney', 'regfee-collect-proc-001');
update payments set status = 'flagged' where id = '00000000-0000-0000-0000-000000031301';

select is(
  (select count(*)::int from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000031301'),
  0,
  'a fee payment moving processing to flagged sends no N-05'
);

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000031302', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003126a', 5000, 'XAF', 'orange_money', 'processing', 'taramoney', 'regfee-collect-proc-002');
update payments set status = 'flagged' where id = '00000000-0000-0000-0000-000000031302';

select is(
  (select notification_code from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000031302'),
  'N-05',
  'positive control: a subscription payment moving processing to flagged still sends N-05'
);

insert into payments (id, gym_id, member_id, amount, currency, method, status)
values ('00000000-0000-0000-0000-000000031303', '00000000-0000-0000-0000-000000031211', '00000000-0000-0000-0000-00000003126a', 15000, 'XAF', 'cash', 'verified');

select is(
  (select notification_code from private.payment_notification_dispatches where payment_id = '00000000-0000-0000-0000-000000031303'),
  'N-04',
  'positive control: a verified subscription payment insert still sends N-04'
);

select is(
  (select purpose from payments where id = '00000000-0000-0000-0000-000000031303'),
  'subscription',
  'a payment inserted without a purpose takes ''subscription'''
);

select is(
  (select count(*)::int from payments where purpose is distinct from 'registration_fee' and purpose is distinct from 'subscription'),
  0,
  'every payment row carries one of the two purposes'
);

-- ============================================================================
-- Renewals are unaffected by the new columns.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031211","app_role":"receptionist"}', true);
select lives_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000031265', 'cash', 'Renewal after a waived fee') $$,
  'confirm_renewal still works for a member whose fee was waived and who then got a subscription'
);
reset role;

select * from finish();
rollback;
