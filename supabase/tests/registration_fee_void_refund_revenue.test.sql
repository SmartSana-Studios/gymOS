-- Story 18.4: registration fee void, refund block and revenue line
-- (migration 0101), positive paths. The denial paths live in
-- registration_fee_void_refund_revenue.negative.test.sql.
--
-- The revenue figures are re-asserted after each fixture step, so every
-- exclusion is paired with the inclusion asserted just before it. Fee gyms and
-- the suspended gym are seeded in their INSERT: gyms.registration_fee and
-- gyms.status are silently pinned against a bare UPDATE.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000314xx.

begin;
select plan(57);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031401', 'RegFee Void Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, timezone, registration_fee) values
  ('00000000-0000-0000-0000-000000031411', 'RVR Gym A',         '00000000-0000-0000-0000-000000031401', 'active',    'Africa/Douala', 5000),
  ('00000000-0000-0000-0000-000000031412', 'RVR Gym B',         '00000000-0000-0000-0000-000000031401', 'active',    'Africa/Douala', 5000),
  ('00000000-0000-0000-0000-000000031413', 'RVR Gym Suspended', '00000000-0000-0000-0000-000000031401', 'suspended', 'Africa/Douala', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000031421'), -- owner A
  ('00000000-0000-0000-0000-000000031422'), -- supervisor A
  ('00000000-0000-0000-0000-000000031423'), -- receptionist A
  ('00000000-0000-0000-0000-000000031424'), -- manager A
  ('00000000-0000-0000-0000-000000031425'), -- coach A
  ('00000000-0000-0000-0000-000000031426'), -- owner B
  ('00000000-0000-0000-0000-000000031427'), -- owner suspended
  ('00000000-0000-0000-0000-000000031441'), -- A member 1: voided by owner, then collected again
  ('00000000-0000-0000-0000-000000031442'), -- A member 2: voided by supervisor
  ('00000000-0000-0000-0000-000000031443'), -- A member 3: fee stays, refund target
  ('00000000-0000-0000-0000-000000031444'), -- A member 4: subscription payer
  ('00000000-0000-0000-0000-000000031445'), -- A member 5: processing fee row
  ('00000000-0000-0000-0000-000000031446'), -- A member 6: flagged fee row
  ('00000000-0000-0000-0000-000000031447'), -- A member 7: fee row at month start
  ('00000000-0000-0000-0000-000000031448'), -- A member 8: fee row 1 minute before month start
  ('00000000-0000-0000-0000-000000031449'), -- A member 9: fee row at next month start
  ('00000000-0000-0000-0000-00000003144a'), -- A member 10: fee row 1 minute before next month start
  ('00000000-0000-0000-0000-00000003144b'), -- B member
  ('00000000-0000-0000-0000-00000003144c'); -- suspended gym member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031431', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031421', 'owner',        'RVR Owner A',        current_date),
  ('00000000-0000-0000-0000-000000031432', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031422', 'supervisor',   'RVR Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000031433', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031423', 'receptionist', 'RVR Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000031434', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031424', 'manager',      'RVR Manager A',      current_date),
  ('00000000-0000-0000-0000-000000031435', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031425', 'coach',        'RVR Coach A',        current_date),
  ('00000000-0000-0000-0000-000000031436', '00000000-0000-0000-0000-000000031412', '00000000-0000-0000-0000-000000031426', 'owner',        'RVR Owner B',        current_date),
  ('00000000-0000-0000-0000-000000031437', '00000000-0000-0000-0000-000000031413', '00000000-0000-0000-0000-000000031427', 'owner',        'RVR Owner Suspended', current_date),
  ('00000000-0000-0000-0000-000000031451', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031441', 'member', 'RVR A Member 1',  current_date),
  ('00000000-0000-0000-0000-000000031452', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031442', 'member', 'RVR A Member 2',  current_date),
  ('00000000-0000-0000-0000-000000031453', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031443', 'member', 'RVR A Member 3',  current_date),
  ('00000000-0000-0000-0000-000000031454', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031444', 'member', 'RVR A Member 4',  current_date),
  ('00000000-0000-0000-0000-000000031455', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031445', 'member', 'RVR A Member 5',  current_date),
  ('00000000-0000-0000-0000-000000031456', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031446', 'member', 'RVR A Member 6',  current_date),
  ('00000000-0000-0000-0000-000000031457', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031447', 'member', 'RVR A Member 7',  current_date),
  ('00000000-0000-0000-0000-000000031458', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031448', 'member', 'RVR A Member 8',  current_date),
  ('00000000-0000-0000-0000-000000031459', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031449', 'member', 'RVR A Member 9',  current_date),
  ('00000000-0000-0000-0000-00000003145a', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-00000003144a', 'member', 'RVR A Member 10', current_date),
  ('00000000-0000-0000-0000-000000031461', '00000000-0000-0000-0000-000000031412', '00000000-0000-0000-0000-00000003144b', 'member', 'RVR B Member',    current_date),
  ('00000000-0000-0000-0000-000000031462', '00000000-0000-0000-0000-000000031413', '00000000-0000-0000-0000-00000003144c', 'member', 'RVR S Member',    current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000031491', '00000000-0000-0000-0000-000000031411', 'RVR Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- Gym-local month bounds for "now", from the helper the revenue functions use.
create temp table rvr_bounds as
select month_start, next_month_start
from private.gym_local_month_bounds('Africa/Douala', now());

select is(
  (select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000031411' and role = 'member' and registration_fee_settled_at is null),
  10,
  'fixture sanity: all ten gym A members start awaiting'
);

select is(
  extract(hour from (select month_start from rvr_bounds) at time zone 'UTC')::int,
  23,
  'fixture sanity: the Africa/Douala month start is 23:00 UTC on the previous day, so the boundary rows below separate gym-local from UTC bucketing'
);

-- ============================================================================
-- Shape and privileges.
-- ============================================================================
select is(
  (select proargnames from pg_proc where oid = 'public.void_registration_fee_payment(uuid, text)'::regprocedure),
  array['p_payment_id', 'p_reason'],
  'void_registration_fee_payment takes only the payment and a reason'
);
select function_returns('public', 'void_registration_fee_payment', array['uuid', 'text']::name[], 'void', 'void_registration_fee_payment returns void');
select is_definer('public', 'void_registration_fee_payment', array['uuid', 'text']::name[], 'void_registration_fee_payment is SECURITY DEFINER');
select ok(
  not has_function_privilege('anon', 'public.void_registration_fee_payment(uuid, text)', 'execute'),
  'anon cannot execute void_registration_fee_payment'
);
select ok(
  has_function_privilege('authenticated', 'public.void_registration_fee_payment(uuid, text)', 'execute'),
  'authenticated can execute void_registration_fee_payment'
);

select has_function('public', 'gym_registration_fee_revenue_mtd', '{}'::name[], 'gym_registration_fee_revenue_mtd() exists and takes no arguments');
select function_returns('public', 'gym_registration_fee_revenue_mtd', '{}'::name[], 'bigint', 'gym_registration_fee_revenue_mtd() returns bigint');
select isnt_definer('public', 'gym_registration_fee_revenue_mtd', '{}'::name[], 'gym_registration_fee_revenue_mtd() is SECURITY INVOKER');
select volatility_is('public', 'gym_registration_fee_revenue_mtd', '{}'::name[], 'stable', 'gym_registration_fee_revenue_mtd() is STABLE');
select ok(
  not has_function_privilege('anon', 'public.gym_registration_fee_revenue_mtd()', 'execute'),
  'anon cannot execute gym_registration_fee_revenue_mtd()'
);
select ok(
  has_function_privilege('authenticated', 'public.gym_registration_fee_revenue_mtd()', 'execute'),
  'authenticated can execute gym_registration_fee_revenue_mtd()'
);
select ok(
  pg_get_functiondef('public.gym_registration_fee_revenue_mtd()'::regprocedure) like '%private.gym_local_month_bounds(%',
  'gym_registration_fee_revenue_mtd() takes its window from the shared helper, never inline month arithmetic'
);
select isnt_definer('public', 'gym_revenue_mtd', '{}'::name[], 'gym_revenue_mtd() is still SECURITY INVOKER');

-- ============================================================================
-- Setup: collect the fee for three members; add one subscription payment.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031423","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"receptionist"}', true);
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031451', 'cash', 'Setup fee for member 1') $$, 'setup: member 1 pays the fee');
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031452', 'bank_transfer', 'Setup fee for member 2') $$, 'setup: member 2 pays the fee');
select lives_ok($$ select record_registration_fee('00000000-0000-0000-0000-000000031453', 'manual_momo', 'Setup fee for member 3') $$, 'setup: member 3 pays the fee');
reset role;

insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0000-000000031471', '00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031454', 10000, 'XAF', 'cash', 'verified', now());

-- ============================================================================
-- Revenue, step by step, as the gym A owner.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"owner"}', true);

select is(gym_registration_fee_revenue_mtd(), 15000::bigint, 'three verified fee payments sum to 15000 on the fee line');
select is(gym_revenue_mtd(), 25000::bigint, 'verified non-voided fees stay in gym_revenue_mtd beside the subscription payment');

-- Processing and flagged fee rows count in neither.
reset role;
insert into payments (gym_id, member_id, amount, currency, method, status, purpose, provider) values
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031455', 5000, 'XAF', 'mobile_money', 'processing', 'registration_fee', 'taramoney'),
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031456', 5000, 'XAF', 'mobile_money', 'flagged',    'registration_fee', 'taramoney');
set local role authenticated;

select is(gym_registration_fee_revenue_mtd(), 15000::bigint, 'processing and flagged fee rows are not on the fee line');
select is(gym_revenue_mtd(), 25000::bigint, 'processing and flagged fee rows are not in gym_revenue_mtd');

-- Month window, at the non-UTC boundary (Douala month start is 23:00 UTC the day before).
reset role;
insert into payments (gym_id, member_id, amount, currency, method, status, purpose, created_at) values
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031457',  100, 'XAF', 'cash', 'verified', 'registration_fee', (select month_start from rvr_bounds)),
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031458',  200, 'XAF', 'cash', 'verified', 'registration_fee', (select month_start - interval '1 minute' from rvr_bounds)),
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031459',  400, 'XAF', 'cash', 'verified', 'registration_fee', (select next_month_start from rvr_bounds)),
  ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-00000003145a',  800, 'XAF', 'cash', 'verified', 'registration_fee', (select next_month_start - interval '1 minute' from rvr_bounds));
set local role authenticated;

select is(gym_registration_fee_revenue_mtd(), 15900::bigint, 'fee rows exactly at the gym-local month start and one minute before the next one are included; one minute before the start and exactly at the next start are not');
select is(gym_revenue_mtd(), 25900::bigint, 'gym_revenue_mtd takes the same fee rows in the same window');

-- Gym scoping.
reset role;
insert into payments (gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-000000031412', '00000000-0000-0000-0000-000000031461', 77000, 'XAF', 'cash', 'verified', 'registration_fee'),
  ('00000000-0000-0000-0000-000000031413', '00000000-0000-0000-0000-000000031462', 42000, 'XAF', 'cash', 'verified', 'registration_fee');
set local role authenticated;

select is(gym_registration_fee_revenue_mtd(), 15900::bigint, 'another gym''s fee payments are not in gym A''s fee line');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031426","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031412","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 77000::bigint, 'gym B''s owner sees gym B''s own fee line');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031427","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031413","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 0::bigint, 'a suspended gym''s owner gets a fee line of 0 although the gym holds a verified fee payment');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031425","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"coach"}', true);
select is(gym_registration_fee_revenue_mtd(), 0::bigint, 'a coach gets 0 on the fee line, not NULL');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031423","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"receptionist"}', true);
select is(gym_registration_fee_revenue_mtd(), 15900::bigint, 'a receptionist gets the owner''s fee line');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 0::bigint, 'a session with no gym_id claim gets 0 on the fee line, never NULL');
reset role;

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000031413' and purpose = 'registration_fee' and status = 'verified'),
  1,
  'positive control: the suspended gym does hold a verified fee payment'
);

-- ============================================================================
-- Void by the owner.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"owner"}', true);

select lives_ok(
  $$ select void_registration_fee_payment(
       (select id from payments where member_id = '00000000-0000-0000-0000-000000031451' and purpose = 'registration_fee'),
       '  Recorded for the wrong member  ') $$,
  'owner can void a manual fee payment of a member with no subscription'
);
reset role;

select is(
  (select row(p.status::text, p.amount, p.method, p.purpose, p.voided_at is not null)::text
   from payments p where p.member_id = '00000000-0000-0000-0000-000000031451'),
  row('verified', 5000, 'cash', 'registration_fee', true)::text,
  'the voided payment row is kept: still verified, same amount and method, voided_at set'
);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031451'),
  null,
  'voiding returned the member to awaiting'
);

select is(
  (select metadata from audit_log
   where gym_id = '00000000-0000-0000-0000-000000031411' and action_type = 'registration_fee_voided'
     and target_entity_id = '00000000-0000-0000-0000-000000031451'),
  jsonb_build_object('payment_id', (select id from payments where member_id = '00000000-0000-0000-0000-000000031451'),
                     'amount', 5000, 'method', 'cash', 'reason', 'Recorded for the wrong member'),
  'a registration_fee_voided audit row carries the payment id, amount, method and the trimmed reason'
);

select is(
  (select target_entity_type from audit_log
   where action_type = 'registration_fee_voided' and target_entity_id = '00000000-0000-0000-0000-000000031451'),
  'member',
  'the audit row targets the member'
);

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000031451'),
  1,
  'a void deletes nothing and adds no payment row'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 10900::bigint, 'the voided fee left the fee line');
select is(gym_revenue_mtd(), 20900::bigint, 'the voided fee left gym_revenue_mtd');

-- ============================================================================
-- Void by the supervisor.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031422","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"supervisor"}', true);
select lives_ok(
  $$ select void_registration_fee_payment(
       (select id from payments where member_id = '00000000-0000-0000-0000-000000031452' and purpose = 'registration_fee'),
       'Duplicate entry') $$,
  'supervisor can void a manual fee payment'
);
reset role;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031452'),
  null,
  'the supervisor''s void also returned the member to awaiting'
);

-- The voided members are gated again; a member who kept the fee is not.
select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031452', '00000000-0000-0000-0000-000000031491', 'active', current_date, current_date + 30) $$,
  'registration_fee_not_settled%',
  'a voided member is gated from a first subscription again'
);
select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031453', '00000000-0000-0000-0000-000000031491', 'active', current_date, current_date + 30) $$,
  'positive control: a member whose fee was not voided can still be given a subscription'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 5900::bigint, 'after two voids the fee line holds only the live fee payments');
select is(gym_revenue_mtd(), 15900::bigint, 'after two voids gym_revenue_mtd holds only the live payments');

-- ============================================================================
-- A voided member can be collected again.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031423","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_registration_fee('00000000-0000-0000-0000-000000031451', 'cash', 'Collected again after the void') $$,
  'a member whose fee payment was voided can have the fee collected again'
);
reset role;

select is(
  (select array_agg((p.voided_at is not null) order by p.voided_at is not null) from payments p
   where p.member_id = '00000000-0000-0000-0000-000000031451' and p.purpose = 'registration_fee'),
  array[false, true],
  'the member now has one voided and one live fee payment'
);
select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031451'),
  null,
  'the re-collected member is settled'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031421","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"owner"}', true);
select is(gym_registration_fee_revenue_mtd(), 10900::bigint, 'the re-collected fee is back on the fee line once');
select is(gym_revenue_mtd(), 20900::bigint, 'the re-collected fee is back in gym_revenue_mtd once');
reset role;

-- ============================================================================
-- Refunds: a subscription payment can still be refunded (positive control for
-- the blocks in the negative file), and a refund still reduces gym_revenue_mtd
-- but not the fee line.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031424","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031411","app_role":"manager"}', true);
select lives_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id)
     values ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031471', 1000, 'Subscription refund still allowed', '00000000-0000-0000-0000-000000031424') $$,
  'a manager can still refund a verified subscription payment'
);
select is(gym_revenue_mtd(), 19900::bigint, 'that refund reduces gym_revenue_mtd');
select is(gym_registration_fee_revenue_mtd(), 10900::bigint, 'and leaves the fee line alone');
reset role;

-- ============================================================================
-- Fee payments are never refunded, so a refunds row never exists for one.
-- ============================================================================
select is(
  (select count(*)::int from refunds r join payments p on p.id = r.payment_id where p.purpose = 'registration_fee'),
  0,
  'no refund row exists against any fee payment'
);

-- ============================================================================
-- Void is a correction, never a status change: the payments table is
-- otherwise untouched, and the one-fee-per-member index still holds.
-- ============================================================================
select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000031411', '00000000-0000-0000-0000-000000031451', 5000, 'XAF', 'cash', 'verified', 'registration_fee') $$,
  '23505',
  null,
  'after the re-collection the unique index again rejects a second live fee payment for the member'
);

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000031411' and voided_at is not null),
  2,
  'exactly the two voided payments carry voided_at'
);

select is(
  (select count(*)::int from audit_log where gym_id = '00000000-0000-0000-0000-000000031411' and action_type = 'registration_fee_voided'),
  2,
  'one voided audit row per void'
);

select * from finish();
rollback;
