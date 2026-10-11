-- Story 19.4: desk session payment (migration 0108), denial paths. Positive
-- paths: desk_session_payment.test.sql.
--
-- Every denial asserts that nothing was written; the positive control for each
-- group is the lives_ok on a member who is eligible.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000331xx.

begin;
select plan(33);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000033101', 'Desk Session Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee) values
  ('00000000-0000-0000-0000-000000033111', 'DSN Gym A',         '00000000-0000-0000-0000-000000033101', 'active',    true,  0),
  ('00000000-0000-0000-0000-000000033112', 'DSN Gym Off',       '00000000-0000-0000-0000-000000033101', 'active',    false, 0),
  ('00000000-0000-0000-0000-000000033113', 'DSN Gym Suspended', '00000000-0000-0000-0000-000000033101', 'suspended', true,  0),
  ('00000000-0000-0000-0000-000000033114', 'DSN Gym Fee',       '00000000-0000-0000-0000-000000033101', 'active',    true,  5000),
  ('00000000-0000-0000-0000-000000033115', 'DSN Gym B',         '00000000-0000-0000-0000-000000033101', 'active',    true,  0);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000033121'), -- owner A
  ('00000000-0000-0000-0000-000000033122'), -- receptionist A
  ('00000000-0000-0000-0000-000000033123'), -- coach A
  ('00000000-0000-0000-0000-000000033124'), -- member A (eligible)
  ('00000000-0000-0000-0000-000000033125'), -- member A (monthly)
  ('00000000-0000-0000-0000-000000033126'), -- member A (no subscription)
  ('00000000-0000-0000-0000-000000033127'), -- member A (price 0)
  ('00000000-0000-0000-0000-000000033128'), -- member A (pending session payment)
  ('00000000-0000-0000-0000-000000033129'), -- member A (processing session payment)
  ('00000000-0000-0000-0000-00000003312a'), -- member A (deactivated)
  ('00000000-0000-0000-0000-00000003312b'), -- owner off gym
  ('00000000-0000-0000-0000-00000003312c'), -- member off gym
  ('00000000-0000-0000-0000-00000003312d'), -- owner suspended gym
  ('00000000-0000-0000-0000-00000003312e'), -- member suspended gym
  ('00000000-0000-0000-0000-00000003312f'), -- owner fee gym
  ('00000000-0000-0000-0000-000000033130'), -- member fee gym (awaiting)
  ('00000000-0000-0000-0000-000000033131'), -- member gym B
  ('00000000-0000-0000-0000-000000033132'), -- user with no membership
  ('00000000-0000-0000-0000-000000033133'), -- deactivated receptionist A
  ('00000000-0000-0000-0000-000000033134'); -- member A (eligible, second control)

insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  ('00000000-0000-0000-0000-000000033141', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033121', 'owner',        'DSN Owner A',        current_date, null),
  ('00000000-0000-0000-0000-000000033142', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033122', 'receptionist', 'DSN Receptionist A', current_date, null),
  ('00000000-0000-0000-0000-000000033143', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033123', 'coach',        'DSN Coach A',        current_date, null),
  ('00000000-0000-0000-0000-000000033144', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033124', 'member',       'DSN Eligible',       current_date, null),
  ('00000000-0000-0000-0000-000000033145', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033125', 'member',       'DSN Monthly',        current_date, null),
  ('00000000-0000-0000-0000-000000033146', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033126', 'member',       'DSN No Sub',         current_date, null),
  ('00000000-0000-0000-0000-000000033147', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033127', 'member',       'DSN Price Zero',     current_date, null),
  ('00000000-0000-0000-0000-000000033148', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033128', 'member',       'DSN Pending',        current_date, null),
  ('00000000-0000-0000-0000-000000033149', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033129', 'member',       'DSN Processing',     current_date, null),
  ('00000000-0000-0000-0000-00000003314a', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-00000003312a', 'member',       'DSN Deactivated',    current_date, now()),
  ('00000000-0000-0000-0000-00000003314b', '00000000-0000-0000-0000-000000033112', '00000000-0000-0000-0000-00000003312b', 'owner',        'DSN Owner Off',      current_date, null),
  ('00000000-0000-0000-0000-00000003314c', '00000000-0000-0000-0000-000000033112', '00000000-0000-0000-0000-00000003312c', 'member',       'DSN Member Off',     current_date, null),
  ('00000000-0000-0000-0000-00000003314d', '00000000-0000-0000-0000-000000033113', '00000000-0000-0000-0000-00000003312d', 'owner',        'DSN Owner Susp',     current_date, null),
  ('00000000-0000-0000-0000-00000003314e', '00000000-0000-0000-0000-000000033113', '00000000-0000-0000-0000-00000003312e', 'member',       'DSN Member Susp',    current_date, null),
  ('00000000-0000-0000-0000-00000003314f', '00000000-0000-0000-0000-000000033114', '00000000-0000-0000-0000-00000003312f', 'owner',        'DSN Owner Fee',      current_date, null),
  ('00000000-0000-0000-0000-000000033150', '00000000-0000-0000-0000-000000033114', '00000000-0000-0000-0000-000000033130', 'member',       'DSN Awaiting',       current_date, null),
  ('00000000-0000-0000-0000-000000033151', '00000000-0000-0000-0000-000000033115', '00000000-0000-0000-0000-000000033131', 'member',       'DSN Member B',       current_date, null),
  ('00000000-0000-0000-0000-000000033153', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033133', 'receptionist', 'DSN Deact Recep',    current_date, now()),
  ('00000000-0000-0000-0000-000000033154', '00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033134', 'member',       'DSN Eligible 2',     current_date, null);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000033161', '00000000-0000-0000-0000-000000033111', 'DSN PPS 2000', 'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033162', '00000000-0000-0000-0000-000000033111', 'DSN PPS 0',    'pay_per_session', 0,     'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000033163', '00000000-0000-0000-0000-000000033111', 'DSN Monthly',  'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000033164', '00000000-0000-0000-0000-000000033112', 'DSN Off PPS',  'pay_per_session', 2000,  'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033144', '00000000-0000-0000-0000-000000033161', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033145', '00000000-0000-0000-0000-000000033163', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033147', '00000000-0000-0000-0000-000000033162', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033148', '00000000-0000-0000-0000-000000033161', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033149', '00000000-0000-0000-0000-000000033161', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-00000003314a', '00000000-0000-0000-0000-000000033161', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033154', '00000000-0000-0000-0000-000000033161', 'active', current_date, null),
  ('00000000-0000-0000-0000-000000033112', '00000000-0000-0000-0000-00000003314c', '00000000-0000-0000-0000-000000033164', 'active', current_date, null);

insert into payments (gym_id, member_id, amount, currency, method, status, purpose, created_at) values
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033148', 2000, 'XAF', 'mtn_momo', 'pending',    'session', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033149', 2000, 'XAF', 'mtn_momo', 'processing', 'session', now() - interval '2 minutes');

-- Baseline counts, compared at the end of each group.
create temp table baseline as
select (select count(*) from payments where purpose = 'session') as pay,
       (select count(*) from guest_sessions) as sess,
       (select count(*) from audit_log where action_type = 'session_payment_recorded') as aud;
grant select on baseline to authenticated;

-- ============================================================================
-- Role refusals.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"coach"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash') $$,
  'permission denied%', 'a coach is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"member"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash') $$,
  'permission denied%', 'a member cannot buy their own session through the desk RPC');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033132","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"owner"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash') $$,
  'permission denied%', 'a caller with no membership is refused even with a forged role claim');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033133","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"receptionist"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash') $$,
  'permission denied%', 'a deactivated receptionist is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"receptionist"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'bank_transfer') $$,
  'permission denied%', 'a receptionist cannot record a bank transfer');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'mtn_momo') $$,
  '%invalid_method%', 'an automated method is not a desk method');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', null) $$,
  '%invalid_method%', 'a null method is refused');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash', repeat('x', 201)) $$,
  '%reason is too long%', 'a 201-character reason is refused');

-- ============================================================================
-- Member and plan refusals (receptionist, gym A).
-- ============================================================================
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033145', 'cash') $$,
  'plan_not_per_session:%', 'a member whose latest plan is monthly is refused');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033146', 'cash') $$,
  'plan_not_per_session:%', 'a member with no subscription is refused');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033147', 'cash') $$,
  'session_price_not_set:%', 'a pay-per-session plan at price 0 is refused');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033148', 'cash') $$,
  'session_payment_already_in_progress:%', 'a pending session payment blocks a desk sale');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033149', 'cash') $$,
  'session_payment_already_in_progress:%', 'a fresh processing session payment blocks a desk sale');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003314a', 'cash') $$,
  'member_deactivated:%', 'a deactivated member is refused');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033151', 'cash') $$,
  'not_found:%', 'a member of another gym is not found');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033143', 'cash') $$,
  'not_found:%', 'a staff member id is not found');

select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-0000000331ff', 'cash') $$,
  'not_found:%', 'an unknown id is not found');
reset role;

select is(
  (select row(
     (select count(*) from payments where purpose = 'session'),
     (select count(*) from guest_sessions),
     (select count(*) from audit_log where action_type = 'session_payment_recorded'))::text),
  (select row(pay, sess, aud)::text from baseline),
  'no refusal wrote a payment, a session or an audit row'
);

select is(
  (select count(*)::int from payments
   where purpose = 'session' and status in ('pending', 'processing')
     and member_id in ('00000000-0000-0000-0000-000000033148', '00000000-0000-0000-0000-000000033149')),
  2,
  'the in-flight rows were left untouched'
);

-- Positive control: the same receptionist, an eligible member.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'cash') $$,
  'control: an eligible member is sold a session by the same receptionist');
reset role;

select is(
  (select count(*)::int from guest_sessions where gym_id = '00000000-0000-0000-0000-000000033111'),
  1,
  'control: exactly one session exists after the refusals and the one sale'
);

-- ============================================================================
-- Gym-level refusals.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003312b","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033112","app_role":"owner"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003314c', 'cash') $$,
  'charging_disabled:%', 'a gym with charging off is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003312d","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033113","app_role":"owner"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003314e', 'cash') $$,
  '%is not active%', 'a suspended gym is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003312f","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033114","app_role":"owner"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033150', 'cash') $$,
  'registration_fee_not_settled:%', 'a member awaiting the registration fee is refused');

-- Cross-gym: gym A's owner naming gym B's member through gym A's claim.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"owner"}', true);
select throws_like(
  $$ select record_session_payment('00000000-0000-0000-0000-00000003314c', 'cash') $$,
  'not_found:%', 'an owner cannot sell a session to another gym''s member');
reset role;

select is(
  (select count(*)::int from guest_sessions
   where gym_id in ('00000000-0000-0000-0000-000000033112', '00000000-0000-0000-0000-000000033113',
                    '00000000-0000-0000-0000-000000033114', '00000000-0000-0000-0000-000000033115')),
  0,
  'no session exists in the off, suspended, fee or other gyms'
);

-- ============================================================================
-- Privileges and direct writes.
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.record_session_payment(uuid, text, text)', 'execute'),
  'anon cannot call record_session_payment'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"receptionist"}', true);
select throws_ok(
  $$ select private.create_guest_session_for_payment(gen_random_uuid(), '00000000-0000-0000-0000-000000033144', '00000000-0000-0000-0000-000000033111') $$,
  '42501', null, 'a client cannot call the private session-creation function');

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
     values ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033144',
             (select id from payments where purpose = 'session' limit 1), now() + interval '7 days') $$,
  '42501', null, 'a client cannot insert a guest_sessions row directly');

select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000033111', '00000000-0000-0000-0000-000000033144', 2000, 'XAF', 'cash', 'verified', 'session') $$,
  '42501', null, 'a client cannot insert a session payment directly');
reset role;

-- A second sale for the same eligible member is not refused: a verified
-- session payment is not "in flight".
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000033122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000033111","app_role":"receptionist"}', true);
select lives_ok(
  $$ select record_session_payment('00000000-0000-0000-0000-000000033144', 'manual_momo', 'Second visit paid') $$,
  'a verified earlier session does not block a new sale');
reset role;

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033144'),
  2,
  'two sessions after the double entry');

select is(
  (select count(*)::int from guest_sessions where member_id = '00000000-0000-0000-0000-000000033154'),
  0,
  'an untouched eligible member has no session');

select * from finish();
rollback;
