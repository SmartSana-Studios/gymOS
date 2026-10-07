-- Story 18.7: member app awaiting-fee blocked state and fee receipt. Mobile
-- only, no migration: this file pins the SERVER side that backs the client
-- gate (members.registration_fee_settled_at is readable by the member for the
-- gate; check_in / book_class_session / initiate_member_payment already refuse
-- a member with no subscription) and the data the receipt screens read.
--
-- Every denial is paired with a positive control (a settled member with a
-- subscription whose same call DOES land), because an unchanged row is
-- otherwise indistinguishable from a call that never ran.
--
-- The voided row stays readable by RLS on purpose: the mobile services filter
-- `voided_at is null`, no RLS change in this story.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000315xx.

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031580', 'RegFee MemberApp Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031592', 'MA Gym A', '00000000-0000-0000-0000-000000031580', 'active', 5000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000315c1'), -- awaiting member
  ('00000000-0000-0000-0000-0000000315c2'), -- settled member with a subscription and fee payments
  ('00000000-0000-0000-0000-0000000315a2'), -- coach
  ('00000000-0000-0000-0000-0000000315c3'); -- second awaiting member (renewal-path denial)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-0000000315b1', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315a2', 'coach', 'MA Coach', current_date),
  ('00000000-0000-0000-0000-0000000315d1', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315c1', 'member', 'MA Awaiting',  current_date),
  ('00000000-0000-0000-0000-0000000315d2', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315c2', 'member', 'MA Settled',    current_date),
  ('00000000-0000-0000-0000-0000000315d3', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315c3', 'member', 'MA Awaiting 2', current_date);

-- Both members above were created while the fee is 5000, so they start awaiting.
update members set registration_fee_settled_at = now() where id = '00000000-0000-0000-0000-0000000315d2';

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000031561', '00000000-0000-0000-0000-000000031592', 'MA Plan', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000031571', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315d2', '00000000-0000-0000-0000-000000031561', 'expiring_soon', current_date, current_date + 3);

-- A voided fee payment (older) and the live one, both with no subscription.
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose, voided_at, created_at) values
  ('00000000-0000-0000-0000-0000000315e1', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315d2', 5000, 'XAF', 'cash', 'verified', 'registration_fee', now(), now() - interval '2 days');
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000315e2', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-0000000315d2', 5000, 'XAF', 'cash', 'verified', 'registration_fee');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0000-000000031591', '00000000-0000-0000-0000-000000031592', 'MA Class', '00000000-0000-0000-0000-0000000315b1', 10, 'one_off', now() + interval '3 days');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0000-0000000315a1', '00000000-0000-0000-0000-000000031592', '00000000-0000-0000-0000-000000031591', now() + interval '3 days');

-- ============================================================================
-- The gate signal: an awaiting member reads their own row with a NULL settled-at.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000315c1","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031592","app_role":"member"}', true);

select is(
  (select registration_fee_settled_at is null from members where user_id = '00000000-0000-0000-0000-0000000315c1'),
  true,
  'an awaiting member reads their own row with registration_fee_settled_at NULL'
);

-- check_in() does not raise for a no-subscription member (0034): it returns NULL,
-- writes no attendance row and raises a front-desk alert instead.
select is((select (check_in()).id is null), true, 'an awaiting member gets no check-in (check_in returns NULL)');
select throws_like($$ select book_class_session('00000000-0000-0000-0000-0000000315a1') $$, '%no active subscription%', 'an awaiting member cannot book a class');
select throws_like($$ select initiate_member_payment() $$, '%no_active_plan%', 'an awaiting member cannot initiate a self-service payment');

-- ============================================================================
-- Positive controls: the settled member with a subscription lands each call.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000315c2","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031592","app_role":"member"}', true);

select is(
  (select registration_fee_settled_at is not null from members where user_id = '00000000-0000-0000-0000-0000000315c2'),
  true,
  'a settled member reads their own row with registration_fee_settled_at set'
);
select is((select (check_in()).id is not null), true, 'the settled member with a subscription can check in (control)');
select lives_ok($$ select book_class_session('00000000-0000-0000-0000-0000000315a1') $$, 'the settled member can book a class (control)');
select lives_ok($$ select initiate_member_payment() $$, 'the settled member can initiate a renewal payment (control)');

-- ============================================================================
-- Fee receipt data: a settled member reads their fee payment.
-- ============================================================================
select is(
  (select row(purpose, subscription_id is null, amount, currency, method)::text from payments where id = '00000000-0000-0000-0000-0000000315e2'),
  row('registration_fee', true, 5000, 'XAF', 'cash')::text,
  'the settled member reads the fee payment: purpose registration_fee, no subscription_id'
);
select is(
  (select count(*)::int from payments where purpose = 'registration_fee' and voided_at is null),
  1,
  'exactly one non-voided fee payment is visible (pins the data shape; the client filter itself is device-QA only)'
);
select is(
  (select voided_at is not null from payments where id = '00000000-0000-0000-0000-0000000315e1'),
  true,
  'a voided fee row is still readable by RLS (so the client must filter it; no RLS change)'
);
select is(
  (select count(*)::int from payments where id = '00000000-0000-0000-0000-0000000315e1' and voided_at is null),
  0,
  'the voided_at-is-null predicate excludes the voided row (pins data shape, not the client service)'
);

-- ============================================================================
-- Isolation: the awaiting member cannot read another member's fee payment.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000315c3","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031592","app_role":"member"}', true);
select is(
  (select count(*)::int from payments),
  0,
  'an awaiting member reads no payment rows (none of their own, none of another member''s)'
);
select throws_like($$ select initiate_member_payment() $$, '%no_active_plan%', 'a second awaiting member is also denied the self-service payment');
select is((select (check_in()).id is null), true, 'a second awaiting member also gets no check-in');

reset role;

select is(
  (select count(*)::int from attendance_events where member_id in ('00000000-0000-0000-0000-0000000315d1', '00000000-0000-0000-0000-0000000315d3')),
  0,
  'the denied check-ins wrote no attendance row for an awaiting member'
);

-- Nothing was written for either awaiting member by the denied calls.
select is(
  (select count(*)::int from payments where member_id in ('00000000-0000-0000-0000-0000000315d1', '00000000-0000-0000-0000-0000000315d3')),
  0,
  'the denied calls wrote no payment for an awaiting member'
);

select * from finish();
rollback;
