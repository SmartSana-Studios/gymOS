-- Story 18.4: registration fee void and refund block (migration 0101), denial
-- paths. Positive paths and the revenue lines:
-- registration_fee_void_refund_revenue.test.sql.
--
-- Every denial is paired with a positive control (a call on the same payment
-- or in the same session that DOES land), because an unchanged row is
-- otherwise indistinguishable from a statement that never ran.
--
-- Fee gyms and the suspended gym are seeded in their INSERT: gyms.status and
-- gyms.registration_fee are silently pinned against a bare UPDATE.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000314xx.

begin;
select plan(56);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-0000000314c1', 'RegFee Void Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-0000000314c2', 'RVN Gym A',         '00000000-0000-0000-0000-0000000314c1', 'active',    5000),
  ('00000000-0000-0000-0000-0000000314c3', 'RVN Gym B',         '00000000-0000-0000-0000-0000000314c1', 'active',    5000),
  ('00000000-0000-0000-0000-0000000314c4', 'RVN Gym Suspended', '00000000-0000-0000-0000-0000000314c1', 'suspended', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000314d1'), -- owner A
  ('00000000-0000-0000-0000-0000000314d2'), -- supervisor A
  ('00000000-0000-0000-0000-0000000314d3'), -- manager A
  ('00000000-0000-0000-0000-0000000314d4'), -- receptionist A
  ('00000000-0000-0000-0000-0000000314d5'), -- coach A
  ('00000000-0000-0000-0000-0000000314d6'), -- owner B
  ('00000000-0000-0000-0000-0000000314d7'), -- owner suspended
  ('00000000-0000-0000-0000-0000000314e1'), -- m1: role matrix target
  ('00000000-0000-0000-0000-0000000314e2'), -- m2: reason target
  ('00000000-0000-0000-0000-0000000314e3'), -- m3: Tara fee
  ('00000000-0000-0000-0000-0000000314e4'), -- m4: active subscription
  ('00000000-0000-0000-0000-0000000314e5'), -- m5: expired subscription
  ('00000000-0000-0000-0000-0000000314e6'), -- m6: processing fee row
  ('00000000-0000-0000-0000-0000000314e7'), -- m7: flagged fee row
  ('00000000-0000-0000-0000-0000000314e8'), -- m8: subscription payment
  ('00000000-0000-0000-0000-0000000314e9'), -- m9: already voided
  ('00000000-0000-0000-0000-0000000314ea'), -- m10: double void target
  ('00000000-0000-0000-0000-0000000314eb'), -- B member
  ('00000000-0000-0000-0000-0000000314ec'), -- suspended gym member
  ('00000000-0000-0000-0000-0000000314ed'); -- m11: refund target

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000000314f1', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314d1', 'owner',        'RVN Owner A',        current_date),
  ('00000000-0000-0000-0000-0000000314f2', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314d2', 'supervisor',   'RVN Supervisor A',   current_date),
  ('00000000-0000-0000-0000-0000000314f3', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314d3', 'manager',      'RVN Manager A',      current_date),
  ('00000000-0000-0000-0000-0000000314f4', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314d4', 'receptionist', 'RVN Receptionist A', current_date),
  ('00000000-0000-0000-0000-0000000314f5', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314d5', 'coach',        'RVN Coach A',        current_date),
  ('00000000-0000-0000-0000-0000000314f6', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-0000000314d6', 'owner',        'RVN Owner B',        current_date),
  ('00000000-0000-0000-0000-0000000314f7', '00000000-0000-0000-0000-0000000314c4', '00000000-0000-0000-0000-0000000314d7', 'owner',        'RVN Owner Suspended', current_date),
  ('00000000-0000-0000-0000-000000031481', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e1', 'member', 'RVN A Member 1',  current_date),
  ('00000000-0000-0000-0000-000000031482', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e2', 'member', 'RVN A Member 2',  current_date),
  ('00000000-0000-0000-0000-000000031483', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e3', 'member', 'RVN A Member 3',  current_date),
  ('00000000-0000-0000-0000-000000031484', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e4', 'member', 'RVN A Member 4',  current_date),
  ('00000000-0000-0000-0000-000000031485', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e5', 'member', 'RVN A Member 5',  current_date),
  ('00000000-0000-0000-0000-000000031486', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e6', 'member', 'RVN A Member 6',  current_date),
  ('00000000-0000-0000-0000-000000031487', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e7', 'member', 'RVN A Member 7',  current_date),
  ('00000000-0000-0000-0000-000000031488', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e8', 'member', 'RVN A Member 8',  current_date),
  ('00000000-0000-0000-0000-000000031489', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314e9', 'member', 'RVN A Member 9',  current_date),
  ('00000000-0000-0000-0000-00000003148a', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ea', 'member', 'RVN A Member 10', current_date),
  ('00000000-0000-0000-0000-00000003148b', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-0000000314eb', 'member', 'RVN B Member',    current_date),
  ('00000000-0000-0000-0000-00000003148c', '00000000-0000-0000-0000-0000000314c4', '00000000-0000-0000-0000-0000000314ec', 'member', 'RVN S Member',    current_date),
  ('00000000-0000-0000-0000-00000003148d', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ed', 'member', 'RVN A Member 11', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-0000000314b1', '00000000-0000-0000-0000-0000000314c2', 'RVN Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- Fee payments, written directly (the migration role is not pinned), with the
-- members they settled.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, voided_at) values
  ('00000000-0000-0000-0000-0000000314a1', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031481', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a2', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031482', 5000, 'XAF', 'bank_transfer', 'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a3', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031483', 5000, 'XAF', 'mobile_money',  'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a4', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031484', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a5', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031485', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a6', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031486', 5000, 'XAF', 'mobile_money',  'processing', 'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a7', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031487', 5000, 'XAF', 'mobile_money',  'flagged',    'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314a8', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031488', 10000, 'XAF', 'cash',         'verified',   'subscription',     null),
  ('00000000-0000-0000-0000-0000000314a9', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031489', 5000, 'XAF', 'cash',          'verified',   'registration_fee', now()),
  ('00000000-0000-0000-0000-0000000314aa', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-00000003148a', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314ab', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-00000003148b', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314ac', '00000000-0000-0000-0000-0000000314c4', '00000000-0000-0000-0000-00000003148c', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  ('00000000-0000-0000-0000-0000000314ad', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-00000003148d', 5000, 'XAF', 'cash',          'verified',   'registration_fee', null),
  -- Subscription payments for the refund controls: one plain, one already voided.
  ('00000000-0000-0000-0000-0000000314ae', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031488', 10000, 'XAF', 'cash',         'verified',   'subscription',     null),
  ('00000000-0000-0000-0000-0000000314af', '00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031488', 10000, 'XAF', 'cash',         'verified',   'subscription',     now());

-- Settle the members whose fee was paid, then give two of them a subscription.
update members set registration_fee_settled_at = now()
where id in ('00000000-0000-0000-0000-000000031481', '00000000-0000-0000-0000-000000031482', '00000000-0000-0000-0000-000000031483',
             '00000000-0000-0000-0000-000000031484', '00000000-0000-0000-0000-000000031485', '00000000-0000-0000-0000-00000003148a',
             '00000000-0000-0000-0000-00000003148b', '00000000-0000-0000-0000-00000003148c', '00000000-0000-0000-0000-00000003148d');

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031484', '00000000-0000-0000-0000-0000000314b1', 'active',  current_date,       current_date + 30),
  ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-000000031485', '00000000-0000-0000-0000-0000000314b1', 'expired', current_date - 60,  current_date - 30);

select is(
  (select count(*)::int from payments where gym_id in ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-0000000314c4') and voided_at is not null),
  2,
  'fixture sanity: exactly two payments start voided'
);

-- ============================================================================
-- Role matrix on payment a1.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d3","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"manager"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'A manager tries to void') $$, '%permission denied%', 'a manager cannot void');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d4","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"receptionist"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'A receptionist tries to void') $$, '%permission denied%', 'a receptionist cannot void');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d5","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"coach"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'A coach tries to void') $$, '%permission denied%', 'a coach cannot void');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314e1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"member"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'A member tries to void their own fee') $$, '%permission denied%', 'a member cannot void');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'Owner claim with no gym') $$, '%permission denied%', 'an owner claim with no gym_id cannot void');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'No app_role on this session') $$, '%permission denied%', 'a claim with a gym_id but no app_role cannot void (fails closed)');
reset role;

select is(
  (select row(p.voided_at is null, m.registration_fee_settled_at is not null)::text
   from payments p join members m on m.id = p.member_id where p.id = '00000000-0000-0000-0000-0000000314a1'),
  row(true, true)::text,
  'the denied role-matrix calls changed neither the payment nor the member'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);
select lives_ok(
  $$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a1', 'Owner control call on the same payment') $$,
  'positive control: the owner can void the same payment'
);
reset role;

select isnt(
  (select voided_at from payments where id = '00000000-0000-0000-0000-0000000314a1'),
  null,
  'the control void landed'
);

-- ============================================================================
-- Suspended gym.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d7","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c4","app_role":"owner"}', true);
select throws_like(
  $$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314ac', 'Void inside a suspended gym') $$,
  '%is not active%',
  'a suspended gym''s owner cannot void'
);
reset role;

select is(
  (select row(p.voided_at is null, m.registration_fee_settled_at is not null)::text
   from payments p join members m on m.id = p.member_id where p.id = '00000000-0000-0000-0000-0000000314ac'),
  row(true, true)::text,
  'the suspended gym''s payment and member are unchanged'
);

-- ============================================================================
-- Reason checks, on payment a2.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);

select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', null) $$, '%reason is required%', 'a null reason is rejected');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', '') $$, '%reason is required%', 'an empty reason is rejected');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', '    ') $$, '%reason is required%', 'a space-only reason is rejected');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', E'\t\n \r') $$, '%reason is required%', 'a tab/newline-only reason is rejected as blank');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', repeat('x', 201)) $$, '%reason is too long%', 'a 201-character reason is rejected');
reset role;

select is(
  (select row(p.voided_at is null, m.registration_fee_settled_at is not null)::text
   from payments p join members m on m.id = p.member_id where p.id = '00000000-0000-0000-0000-0000000314a2'),
  row(true, true)::text,
  'the rejected reasons changed nothing'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);
select lives_ok(
  $$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a2', repeat('y', 200)) $$,
  'positive control: a 200-character reason is accepted'
);
reset role;

select is(
  (select char_length(metadata ->> 'reason') from audit_log
   where action_type = 'registration_fee_voided' and target_entity_id = '00000000-0000-0000-0000-000000031482'),
  200,
  'the audit row carries the full 200-character reason'
);

-- ============================================================================
-- Not voidable: every case answers not_found.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);

select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314ab', 'Cross-gym void attempt') $$, 'not_found: payment%', 'another gym''s fee payment is not found');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a8', 'Void a subscription payment') $$, 'not_found: payment%', 'a non-fee payment is not found');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a6', 'Void a processing fee row') $$, 'not_found: payment%', 'a processing fee payment is not found');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a7', 'Void a flagged fee row') $$, 'not_found: payment%', 'a flagged fee payment is not found');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a9', 'Void an already voided payment') $$, 'not_found: payment%', 'an already voided payment is not found');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314ff', 'Unknown payment id') $$, 'not_found: payment%', 'an unknown payment id is not found');

-- Double void.
select lives_ok($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314aa', 'First void of the pair') $$, 'setup: a payment is voided once');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314aa', 'Second void of the pair') $$, 'not_found: payment%', 'a second void of the same payment is not found');
reset role;

select is(
  (select count(*)::int from payments
   where id in ('00000000-0000-0000-0000-0000000314ab', '00000000-0000-0000-0000-0000000314a8', '00000000-0000-0000-0000-0000000314a6', '00000000-0000-0000-0000-0000000314a7')
     and voided_at is not null),
  0,
  'the cross-gym, subscription, processing and flagged payments were not voided'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_voided' and target_entity_id = '00000000-0000-0000-0000-00000003148a'),
  1,
  'the double void wrote one audit row, not two'
);

-- ============================================================================
-- Tara fee.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a3', 'Void a Tara fee') $$, '%tara_fee_cannot_be_voided%', 'a Tara Money fee payment cannot be voided');
reset role;

select is(
  (select row(p.voided_at is null, m.registration_fee_settled_at is not null)::text
   from payments p join members m on m.id = p.member_id where p.id = '00000000-0000-0000-0000-0000000314a3'),
  row(true, true)::text,
  'the Tara fee payment and its member are unchanged'
);

-- ============================================================================
-- Member already has a subscription, any status.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"supervisor"}', true);
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a4', 'Void with an active plan') $$, '%member_already_has_subscription%', 'a member with an active subscription cannot have the fee voided');
select throws_like($$ select void_registration_fee_payment('00000000-0000-0000-0000-0000000314a5', 'Void with an expired plan') $$, '%member_already_has_subscription%', 'a member with only an expired subscription cannot have the fee voided');
reset role;

select is(
  (select count(*)::int from payments p join members m on m.id = p.member_id
   where p.id in ('00000000-0000-0000-0000-0000000314a4', '00000000-0000-0000-0000-0000000314a5')
     and p.voided_at is null and m.registration_fee_settled_at is not null),
  2,
  'both members with a plan keep their live fee payment and stay settled'
);

-- ============================================================================
-- Refund block: the trigger, for every writer.
-- ============================================================================
select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id
   where p.gym_id in ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-0000000314c4')),
  0,
  'fixture sanity: no refund row exists yet'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d3","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"manager"}', true);

select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Refund a fee', '00000000-0000-0000-0000-0000000314d3') $$,
  '%registration_fee_not_refundable%',
  'a manager cannot refund a registration fee payment'
);
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314a9', 1000, 'Refund a voided fee', '00000000-0000-0000-0000-0000000314d3') $$,
  '%payment_voided_not_refundable%',
  'a manager cannot refund a voided fee payment'
);
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314af', 1000, 'Refund a voided subscription payment', '00000000-0000-0000-0000-0000000314d3') $$,
  '%payment_voided_not_refundable%',
  'a manager cannot refund a voided payment of any purpose'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"supervisor"}', true);
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Refund a fee', '00000000-0000-0000-0000-0000000314d2') $$,
  '%registration_fee_not_refundable%',
  'a supervisor cannot refund a registration fee payment'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"owner"}', true);
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Refund a fee', '00000000-0000-0000-0000-0000000314d1') $$,
  '%registration_fee_not_refundable%',
  'an owner cannot refund a registration fee payment'
);
reset role;

set local role service_role;
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Service role refund of a fee', '00000000-0000-0000-0000-0000000314d3') $$,
  '%registration_fee_not_refundable%',
  'the service role cannot refund a registration fee payment either'
);
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314a9', 1000, 'Service role refund of a voided fee', '00000000-0000-0000-0000-0000000314d3') $$,
  '%payment_voided_not_refundable%',
  'the service role cannot refund a voided payment either'
);
reset role;

select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Superuser refund of a fee', '00000000-0000-0000-0000-0000000314d3') $$,
  '%registration_fee_not_refundable%',
  'not even the table owner can refund a registration fee payment'
);

select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id
   where p.gym_id in ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314c3', '00000000-0000-0000-0000-0000000314c4')),
  0,
  'every blocked refund inserted nothing'
);

-- Positive control: a normal subscription payment refunds.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d3","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"manager"}', true);
select lives_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314a8', 1000, 'Subscription refund control', '00000000-0000-0000-0000-0000000314d3') $$,
  'positive control: the same manager can refund a verified subscription payment'
);
reset role;

-- ============================================================================
-- Refund block: the RLS clause on its own (trigger disabled in this
-- transaction; a BEFORE trigger would otherwise fire first and hide it).
-- ============================================================================
alter table refunds disable trigger block_fee_and_voided_refunds;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000314d3","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000314c2","app_role":"manager"}', true);

select throws_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ad', 1000, 'Policy-only fee refund', '00000000-0000-0000-0000-0000000314d3') $$,
  '42501',
  null,
  'with the trigger off, the insert policy alone rejects a refund of a fee payment'
);
select throws_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314a9', 1000, 'Policy-only voided fee refund', '00000000-0000-0000-0000-0000000314d3') $$,
  '42501',
  null,
  'with the trigger off, the insert policy alone rejects a refund of a voided fee payment'
);
select throws_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314af', 1000, 'Policy-only voided subscription refund', '00000000-0000-0000-0000-0000000314d3') $$,
  '42501',
  null,
  'with the trigger off, the insert policy alone rejects a refund of a voided subscription payment'
);
select lives_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-0000000314c2', '00000000-0000-0000-0000-0000000314ae', 1000, 'Policy-only control refund', '00000000-0000-0000-0000-0000000314d3') $$,
  'positive control: with the trigger off the policy still lets a subscription payment be refunded'
);
reset role;

alter table refunds enable trigger block_fee_and_voided_refunds;

select is(
  (select tgenabled::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'refunds' and t.tgname = 'block_fee_and_voided_refunds'),
  'O',
  'the refund block trigger is enabled again'
);

select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id
   where p.purpose = 'registration_fee' or p.voided_at is not null),
  0,
  'no refund row exists against a fee or voided payment'
);

-- ============================================================================
-- Catalog checks.
-- ============================================================================
select is_definer('private', 'block_fee_and_voided_refunds', '{}'::name[], 'the refund block trigger function is SECURITY DEFINER, so RLS cannot hide the payment from it');
select ok(
  not has_function_privilege('anon', 'private.block_fee_and_voided_refunds()', 'execute'),
  'anon cannot execute the refund block trigger function'
);
select ok(
  (select p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
   from pg_proc p where p.oid = 'public.void_registration_fee_payment(uuid, text)'::regprocedure),
  'void_registration_fee_payment carries the fail-closed suspension guard'
);
select ok(
  (select with_check like '%purpose <> ''registration_fee''%' and with_check like '%voided_at IS NULL%'
   from pg_policies where tablename = 'refunds' and policyname = 'manager_or_owner_insert_own_refunds'),
  'the refund insert policy names both the purpose and the voided clause'
);

select * from finish();
rollback;
