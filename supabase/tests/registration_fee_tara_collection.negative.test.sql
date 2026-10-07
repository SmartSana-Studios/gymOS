-- Story 18.3: Tara Money registration fee collection (migration 0100), denial
-- paths. Positive paths: registration_fee_tara_collection.test.sql.
--
-- Every denial is paired with a positive control (a call in the same session
-- or on the same member that DOES land), because several guards fail silently
-- and an unchanged row is otherwise indistinguishable from a call that never
-- ran. Every "nothing written" claim is checked on the payments table, and the
-- expiry flag is proven NOT to run on a denied call.
--
-- The suspended and fee-0 gyms are seeded in their INSERT: gyms.status and
-- gyms.registration_fee are silently pinned against a bare UPDATE.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000313xx (letters a-e are hex).

begin;
select plan(46);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031380', 'RegFee Tara Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031392', 'TCN Gym A',         '00000000-0000-0000-0000-000000031380', 'active',    5000),
  ('00000000-0000-0000-0000-000000031393', 'TCN Gym B',         '00000000-0000-0000-0000-000000031380', 'active',    7000),
  ('00000000-0000-0000-0000-000000031394', 'TCN Gym Suspended', '00000000-0000-0000-0000-000000031380', 'suspended', 3000),
  ('00000000-0000-0000-0000-000000031395', 'TCN Gym Zero',      '00000000-0000-0000-0000-000000031380', 'active',    0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000313a1'), -- receptionist A
  ('00000000-0000-0000-0000-0000000313a2'), -- coach A
  ('00000000-0000-0000-0000-0000000313a3'), -- owner B
  ('00000000-0000-0000-0000-0000000313a4'), -- owner suspended
  ('00000000-0000-0000-0000-0000000313a5'), -- owner zero
  ('00000000-0000-0000-0000-0000000313a6'), -- manager A
  ('00000000-0000-0000-0000-0000000313c1'), -- A member 1: the happy-path control
  ('00000000-0000-0000-0000-0000000313c2'), -- A member 2: deactivated
  ('00000000-0000-0000-0000-0000000313c3'), -- A member 3: settled by waiver
  ('00000000-0000-0000-0000-0000000313c4'), -- A member 4: expired attempt, denied-caller target
  ('00000000-0000-0000-0000-0000000313c5'), -- A member 5: young attempt
  ('00000000-0000-0000-0000-0000000313c6'), -- A member 6: pending-status fee row
  ('00000000-0000-0000-0000-0000000313c7'), -- A member 7: no provider
  ('00000000-0000-0000-0000-0000000313c8'), -- B member
  ('00000000-0000-0000-0000-0000000313c9'), -- suspended gym member
  ('00000000-0000-0000-0000-0000000313ca'); -- zero gym member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000000313b1', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313a1', 'receptionist', 'TCN Receptionist A', current_date),
  ('00000000-0000-0000-0000-0000000313b2', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313a2', 'coach',        'TCN Coach A',        current_date),
  ('00000000-0000-0000-0000-0000000313b3', '00000000-0000-0000-0000-000000031393', '00000000-0000-0000-0000-0000000313a3', 'owner',        'TCN Owner B',        current_date),
  ('00000000-0000-0000-0000-0000000313b4', '00000000-0000-0000-0000-000000031394', '00000000-0000-0000-0000-0000000313a4', 'owner',        'TCN Owner Suspended', current_date),
  ('00000000-0000-0000-0000-0000000313b5', '00000000-0000-0000-0000-000000031395', '00000000-0000-0000-0000-0000000313a5', 'owner',        'TCN Owner Zero',     current_date),
  ('00000000-0000-0000-0000-0000000313b6', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313a6', 'manager',      'TCN Manager A',      current_date),
  ('00000000-0000-0000-0000-0000000313d1', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c1', 'member', 'TCN A Member 1', current_date),
  ('00000000-0000-0000-0000-0000000313d2', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c2', 'member', 'TCN A Member 2', current_date),
  ('00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c3', 'member', 'TCN A Member 3', current_date),
  ('00000000-0000-0000-0000-0000000313d4', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c4', 'member', 'TCN A Member 4', current_date),
  ('00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c5', 'member', 'TCN A Member 5', current_date),
  ('00000000-0000-0000-0000-0000000313d6', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c6', 'member', 'TCN A Member 6', current_date),
  ('00000000-0000-0000-0000-0000000313d7', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313c7', 'member', 'TCN A Member 7', current_date),
  ('00000000-0000-0000-0000-0000000313d8', '00000000-0000-0000-0000-000000031393', '00000000-0000-0000-0000-0000000313c8', 'member', 'TCN B Member',   current_date),
  ('00000000-0000-0000-0000-0000000313d9', '00000000-0000-0000-0000-000000031394', '00000000-0000-0000-0000-0000000313c9', 'member', 'TCN S Member',   current_date),
  ('00000000-0000-0000-0000-0000000313da', '00000000-0000-0000-0000-000000031395', '00000000-0000-0000-0000-0000000313ca', 'member', 'TCN Z Member',   current_date);

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-0000000313d2';
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-0000000313d3';
-- A member created while the fee was 0 is settled; the fee was lowered afterwards, so release to awaiting
-- (as the migration role: the pin only covers client roles).
update members set registration_fee_settled_at = null where id = '00000000-0000-0000-0000-0000000313da';

-- An expired attempt on member 4 and a young one on member 5, both gym A.
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, actor_id, purpose, created_at) values
  ('00000000-0000-0000-0000-0000000313e1', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d4', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-0000000313a1', 'registration_fee', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000313e2', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d5', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', '00000000-0000-0000-0000-0000000313a1', 'registration_fee', now() - interval '2 minutes');
-- A fee row in `pending` status on member 6 (not processing, not flagged).
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000313e3', '00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d6', 5000, 'XAF', 'cash', 'pending', 'registration_fee');

-- ============================================================================
-- Role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"coach"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1') $$, '%permission denied%', 'a coach cannot start a Tara collection');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313c1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"member"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1') $$, '%permission denied%', 'a member cannot start a Tara collection for themselves');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","app_role":"receptionist"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1') $$, '%permission denied%', 'a receptionist claim with no gym_id cannot start a collection');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1') $$, '%permission denied%', 'a claim with a gym_id but no app_role cannot start a collection (fails closed)');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
set local role anon;
select throws_ok($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d1') $$, '42501', null, 'anon has no EXECUTE on the RPC');
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-0000000313d1'),
  0,
  'the denied role-matrix calls wrote no payment'
);

-- ============================================================================
-- Denied callers must not trigger the expiry flag either.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"coach"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d4') $$, '%permission denied%', 'a coach is denied on a member with an expired attempt');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-0000000313d4', 'cash', 'A coach tries to collect') $$, '%permission denied%', 'a coach is denied recording on the same member');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"receptionist"}', true);
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-0000000313d4', 'A receptionist tries to waive') $$, '%permission denied%', 'a receptionist is denied waiving the same member');

-- A gym B owner cannot reach gym A's member, and must not flag gym A's row.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a3","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031393","app_role":"owner"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d4') $$, '%not_found%', 'a gym B owner cannot start a collection for a gym A member');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-0000000313d4', 'cash', 'Cross gym attempt to collect') $$, '%not_found%', 'a gym B owner cannot record a fee for a gym A member');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-0000000313d4', 'Cross gym attempt to waive') $$, '%not_found%', 'a gym B owner cannot waive a gym A member');
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e1'),
  'processing',
  'the expired gym A row was not flagged by any denied or cross-gym call'
);

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_attempt_expired'),
  0,
  'no expiry audit row was written by the denied calls'
);

-- ============================================================================
-- Positive control for the same member: a receptionist of gym A flags it.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"receptionist"}', true);
select lives_ok($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d4') $$, 'positive control: the receptionist of the right gym starts a collection, flagging the expired attempt');
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e1'),
  'flagged',
  'positive control: the expired row is now flagged'
);

-- ============================================================================
-- Not startable: nothing is written.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"receptionist"}', true);

select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d2') $$, '%member_deactivated%', 'a deactivated member is refused');
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d3') $$, '%registration_fee_not_due%', 'a settled (waived) member is refused as not due');
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313b2') $$, '%not_found%', 'a staff row (role other than member) is not found');
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313ff') $$, '%not_found%', 'an unknown member id is not found');
select throws_like($$ select initiate_registration_fee_payment(null) $$, '%not_found%', 'a NULL member id is not found');
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d6') $$, '%registration_fee_already_recorded%', 'a non-voided fee row that is neither processing nor flagged reads as already recorded');
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d5') $$, '%registration_fee_already_pending%', 'a two-minute-old attempt is pending');
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e2'),
  'processing',
  'the refused calls left the young attempt processing'
);

select is(
  (select count(*)::int from payments where member_id in ('00000000-0000-0000-0000-0000000313d2', '00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-0000000313d6')),
  2,
  'no refused call added a payment row (only the two fixture rows exist)'
);

-- Fee 0.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a5","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031395","app_role":"owner"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313da') $$, '%registration_fee_not_configured%', 'a gym with fee 0 refuses a Tara collection');
reset role;

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000031395'),
  0,
  'the fee-0 refusal wrote no payment'
);

-- ============================================================================
-- Suspended gym: refused before any write, and the expiry flag does not run.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose, created_at)
values ('00000000-0000-0000-0000-0000000313e4', '00000000-0000-0000-0000-000000031394', '00000000-0000-0000-0000-0000000313d9', 3000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee', now() - interval '30 minutes');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a4","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031394","app_role":"owner"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d9') $$, '%is not active%', 'a suspended gym cannot start a collection');
select throws_like($$ select record_registration_fee('00000000-0000-0000-0000-0000000313d9', 'cash', 'Suspended gym collection') $$, '%is not active%', 'a suspended gym cannot record a fee');
select throws_like($$ select waive_registration_fee('00000000-0000-0000-0000-0000000313d9', 'Suspended gym waiver') $$, '%is not active%', 'a suspended gym cannot waive a fee');
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e4'),
  'processing',
  'a suspended gym''s expired attempt was not flagged by the refused calls'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d9'),
  null,
  'the suspended gym member is still awaiting'
);

-- A member's payment landing after suspension must still reconcile.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-0000000313e4'::uuid, 80) $$,
  'the webhook completion still works for a suspended gym (recovery path)'
);
reset role;

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-0000000313d9'),
  null,
  'the confirmation settled the suspended gym member'
);

-- ============================================================================
-- No active provider: nothing written; restoring it lets the call land.
-- ============================================================================
update payment_providers set is_active = false;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"receptionist"}', true);
select throws_like($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d7') $$, '%no_active_provider%', 'no active provider is refused');
reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-0000000313d7'),
  0,
  'the no-provider refusal wrote no payment'
);

update payment_providers set is_active = true where provider_key = 'taramoney';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"receptionist"}', true);
select lives_ok($$ select initiate_registration_fee_payment('00000000-0000-0000-0000-0000000313d7') $$, 'positive control: with the provider active again the same call lands');
reset role;

-- ============================================================================
-- Direct writes: staff cannot create a fee payment, call the webhook completion
-- or reach the expiry helper.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000313a6","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031392","app_role":"manager"}', true);

select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, provider, purpose)
     values ('00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d1', 5000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'registration_fee') $$,
  '42501', null,
  'a manager cannot insert a registration_fee payment through RLS'
);
select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status)
     values ('00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d1', 15000, 'XAF', 'cash', 'processing') $$,
  'positive control: the same manager can insert a processing subscription payment'
);

select throws_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-0000000313e2'::uuid, 0) $$,
  '42501', null,
  'staff cannot call complete_verified_payment'
);
select throws_ok(
  $$ select private.expire_stale_registration_fee_payment('00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-000000031392') $$,
  '42501', null,
  'staff cannot call the expiry helper directly'
);
reset role;

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-0000000313e2'),
  'processing',
  'the denied staff calls left the young attempt processing'
);

-- ============================================================================
-- The 18.3 gate: a member whose fee is only in flight is still awaiting, so
-- the first-subscription gate still rejects.
-- ============================================================================
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-0000000313f1', '00000000-0000-0000-0000-000000031392', 'TCN Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d5', '00000000-0000-0000-0000-0000000313f1', 'active', current_date, current_date + 30) $$,
  'registration_fee_not_settled%',
  'a member with a Tara collection still in flight is awaiting: the subscription gate rejects'
);
select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031392', '00000000-0000-0000-0000-0000000313d3', '00000000-0000-0000-0000-0000000313f1', 'active', current_date, current_date + 30) $$,
  'positive control: the gate lets a settled member through'
);

-- ============================================================================
-- Confirmation of a non-fee payment for an unrelated id is a harmless no-op.
-- ============================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-0000000313fe'::uuid, 0)),
  null::uuid,
  'confirming an unknown payment id is a no-op'
);
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'registration_fee_paid'),
  1,
  'only the one real confirmation (the suspended gym member) wrote a registration_fee_paid audit row'
);

select * from finish();
rollback;
