-- Story 4.15: Member Self-Service Renewal. Tests initiate_member_payment()
-- (0055_member_self_service_renewal.sql) -- a SECURITY DEFINER RPC mirroring
-- check_in()'s exact self-scoping shape, so assertions call the function
-- directly under a simulated session rather than asserting on INSERT
-- statements themselves. Session-simulation conventions match
-- check_in_one_open_session_enforcement.test.sql (`set local role
-- authenticated` + `set_config('request.jwt.claims', ...)`, fixtures seeded
-- up front as the connecting role, `reset role` before asserting on
-- committed table state).

begin;
select plan(23);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009301', 'Renewal Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009311', 'Renewal Gym A', '00000000-0000-0000-0000-000000009301', 30),
  ('00000000-0000-0000-0000-000000009312', 'Renewal Gym B', '00000000-0000-0000-0000-000000009301', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009321'), -- Gym A: Member 1, active plan (assertion a)
  ('00000000-0000-0000-0000-000000009322'), -- Gym A: Member 2, a different (pricier) plan (assertion b)
  ('00000000-0000-0000-0000-000000009323'), -- Gym B: Member, active plan (cross-tenant, assertion c)
  ('00000000-0000-0000-0000-000000009324'), -- Gym A: deactivated member (assertion d)
  ('00000000-0000-0000-0000-000000009325'), -- Gym A: owner (permission-denied, assertion e)
  ('00000000-0000-0000-0000-000000009326'), -- Gym A: coach (permission-denied, assertion e)
  ('00000000-0000-0000-0000-000000009327'), -- Gym A: zero-subscription member (assertion f)
  ('00000000-0000-0000-0000-000000009328'), -- Gym A: expired-subscription member (assertion g)
  ('00000000-0000-0000-0000-000000009329'); -- Gym A: active (not-yet-eligible) subscription member (assertion h)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009341', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009321', 'member', 'Renewal Gym A Member 1'),
  ('00000000-0000-0000-0000-000000009342', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009322', 'member', 'Renewal Gym A Member 2'),
  ('00000000-0000-0000-0000-000000009343', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009323', 'member', 'Renewal Gym B Member'),
  ('00000000-0000-0000-0000-000000009344', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009324', 'member', 'Renewal Gym A Deactivated Member'),
  ('00000000-0000-0000-0000-000000009345', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009325', 'owner', 'Renewal Gym A Owner'),
  ('00000000-0000-0000-0000-000000009346', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009326', 'coach', 'Renewal Gym A Coach'),
  ('00000000-0000-0000-0000-000000009347', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009327', 'member', 'Renewal Gym A No-Subscription Member'),
  ('00000000-0000-0000-0000-000000009348', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009328', 'member', 'Renewal Gym A Expired Member'),
  ('00000000-0000-0000-0000-000000009349', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009329', 'member', 'Renewal Gym A Active-Subscription Member');

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000009344';

-- Two distinct-priced plans in Gym A prove the join is scoped per-caller,
-- not just "any plan in this gym" -- Member 1 and Member 2 must each get
-- their own plan's price, never the other's.
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009361', '00000000-0000-0000-0000-000000009311', 'Renewal Gym A Plan 1', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000009362', '00000000-0000-0000-0000-000000009311', 'Renewal Gym A Plan 2', 'monthly', 25000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000009363', '00000000-0000-0000-0000-000000009312', 'Renewal Gym B Plan', 'monthly', 35000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000009371', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009341', '00000000-0000-0000-0000-000000009361', 'expiring_soon', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009372', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009342', '00000000-0000-0000-0000-000000009362', 'expiring_soon', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009373', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009343', '00000000-0000-0000-0000-000000009363', 'grace_period', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009374', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009344', '00000000-0000-0000-0000-000000009361', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0000-000000009375', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009348', '00000000-0000-0000-0000-000000009361', 'expired', current_date - 40, current_date - 10),
  ('00000000-0000-0000-0000-000000009376', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009349', '00000000-0000-0000-0000-000000009361', 'active', current_date, current_date + 30);

-- ============================================================================
-- (a) A member-claim session with a renewal-eligible (expiring_soon)
-- subscription succeeds, and the resulting payments row's
-- member_id/gym_id/amount/currency/method/status all match the caller's own
-- subscription/plan -- never a client-supplied value, since the RPC takes
-- no parameters.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

create temp table renewal_payment_1 as
select initiate_member_payment() as id;

reset role;

select is(
  (select member_id from payments where id = (select id from renewal_payment_1)),
  '00000000-0000-0000-0000-000000009341'::uuid,
  'the new payment row belongs to the calling member, not a client-supplied id'
);

select is(
  (select gym_id from payments where id = (select id from renewal_payment_1)),
  '00000000-0000-0000-0000-000000009311'::uuid,
  'the new payment row belongs to the calling member''s own gym'
);

select is(
  (select amount from payments where id = (select id from renewal_payment_1)),
  15000,
  'the new payment row''s amount is server-derived from the caller''s own plan price'
);

select is(
  (select currency from payments where id = (select id from renewal_payment_1)),
  'XAF',
  'the new payment row''s currency is server-derived from the caller''s own plan'
);

select is(
  (select method from payments where id = (select id from renewal_payment_1)),
  'mobile_money',
  'the new payment row''s method is mobile_money'
);

select is(
  (select status from payments where id = (select id from renewal_payment_1)),
  'processing'::payment_status,
  'the new payment row starts in processing status'
);

-- Review finding: without a duplicate-payment guard, a double-tap/retry
-- could create a second real processing row (and a second real USSD
-- prompt) for a member who already has one in flight. Member 1's row from
-- above is still `processing` at this point in the test.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%payment_already_pending%',
  'a member with an already-processing payment cannot initiate a second one'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009341' and status = 'processing'),
  1,
  'the duplicate attempt did not create a second processing row'
);

drop table renewal_payment_1;

-- ============================================================================
-- (b) A second member in the same gym, subscribed to a different plan, gets
-- their own plan's price -- never the first member's (cross-member
-- isolation within a single gym).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

create temp table renewal_payment_2 as
select initiate_member_payment() as id;

reset role;

select is(
  (select amount from payments where id = (select id from renewal_payment_2)),
  25000,
  'a second member in the same gym gets their own plan''s price, not the first member''s'
);

drop table renewal_payment_2;

-- ============================================================================
-- (c) A Gym B member-claim session only ever prices/routes against Gym B,
-- never Gym A, even with fixtures present in both gyms (cross-tenant).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009312","app_role":"member"}',
  true
);

create temp table renewal_payment_3 as
select initiate_member_payment() as id;

reset role;

select is(
  (select gym_id from payments where id = (select id from renewal_payment_3)),
  '00000000-0000-0000-0000-000000009312'::uuid,
  'a Gym B member''s payment is recorded against Gym B, not Gym A'
);

select is(
  (select amount from payments where id = (select id from renewal_payment_3)),
  35000,
  'a Gym B member is priced from Gym B''s own plan'
);

drop table renewal_payment_3;

-- ============================================================================
-- (d) A deactivated member is rejected, and no payments row is inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%member is deactivated%',
  'a deactivated member cannot initiate a self-service payment'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009344'),
  0,
  'no payments row was inserted for the deactivated member'
);

-- ============================================================================
-- (e) A non-member role (owner or coach) is rejected -- self-service only.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%permission denied%',
  'an owner-claim session cannot call initiate_member_payment()'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009345'),
  0,
  'no payments row was inserted for the rejected owner-claim session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009326","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"coach"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%permission denied%',
  'a coach-claim session cannot call initiate_member_payment()'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009346'),
  0,
  'no payments row was inserted for the rejected coach-claim session'
);

-- ============================================================================
-- (f) A member with zero subscription rows gets the distinguishable
-- no_active_plan exception, and no payments row is inserted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009327","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%no_active_plan%',
  'a member with zero subscription rows gets a distinguishable no_active_plan exception'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009347'),
  0,
  'no payments row was inserted for the zero-subscription member'
);

-- ============================================================================
-- (g) A member whose most-recent subscription is `expired` can still
-- initiate a self-service renewal payment -- `expired` is one of the three
-- renewal-eligible statuses this RPC's own status guard allows (assertion h
-- covers the statuses it rejects).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009328","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

select lives_ok(
  $$select initiate_member_payment()$$,
  'a member with an expired subscription can still initiate a self-service renewal payment'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009348' and status = 'processing'),
  1,
  'a processing payment row was inserted for the expired-subscription member'
);

-- ============================================================================
-- (h) Review finding: a member whose subscription is still `active` (not
-- yet expiring_soon/grace_period/expired) is rejected -- the Home CTA only
-- ever *offers* Renew for the three eligible statuses, but without this
-- guard the RPC itself would let any member session bypass that and
-- self-initiate a charge regardless of current plan health.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009329","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

select throws_like(
  $$select initiate_member_payment()$$,
  '%not_eligible_for_renewal%',
  'a member whose subscription is still active gets a distinguishable not_eligible_for_renewal exception'
);

reset role;

select is(
  (select count(*)::int from payments where member_id = '00000000-0000-0000-0000-000000009349'),
  0,
  'no payments row was inserted for the not-yet-eligible member'
);

select * from finish();
rollback;
