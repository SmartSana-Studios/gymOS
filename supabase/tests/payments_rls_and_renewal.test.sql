-- Story 4.2: closes the payments RLS gap that has existed since
-- 0005_payments.sql (deny-all only, no gym-staff policy ever added) and
-- tests complete_verified_payment()'s idempotent processing -> verified
-- transition (0030_payment_initiation_and_renewal.sql). Session-simulation
-- conventions match payment_providers_rls.test.sql/manual_renewal_reset.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- for RLS-gated paths; `set local role service_role` for the webhook's own
-- calling context, matching audit_log_immutable.test.sql's precedent for
-- simulating a real system caller rather than the superuser connecting role).

begin;
select plan(29);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Payments Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Payments Test Gym A', '00000000-0000-0000-0000-000000009001', 30),
  ('00000000-0000-0000-0000-000000009012', 'Payments Test Gym B', '00000000-0000-0000-0000-000000009001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009025'), -- Gym A member-role session (own account)
  ('00000000-0000-0000-0000-000000009026'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009031'), -- Payer's own user
  ('00000000-0000-0000-0000-000000009032'); -- Deactivated Payer's own user

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'owner', 'Payments Gym A Owner'),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'manager', 'Payments Gym A Manager'),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'receptionist', 'Payments Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'coach', 'Payments Gym A Coach'),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009025', 'member', 'Payments Gym A Member Session'),
  ('00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009026', 'owner', 'Payments Gym B Owner'),
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009031', 'member', 'Payer'),
  ('00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009032', 'member', 'Deactivated Payer');

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000009052';

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009011', 'Payments Test Monthly', 'monthly', 15000, 'monthly', 30);

-- Prior (expired) subscriptions so complete_verified_payment()'s "most
-- recent subscription" plan lookup has a real row to resolve plan_id from
-- -- mirrors renew_subscription()'s own fixture convention.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009071', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 40, current_date - 10, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009072', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 40, current_date - 10, now() - interval '1 day');

-- ============================================================================
-- RLS: owner/manager/receptionist can INSERT payments scoped to their own
-- gym; coach/member/cross-gym cannot (AC #7).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select lives_ok(
  $$ insert into payments (id, gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009081', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  'an owner-claim session can INSERT a payments row scoped to their own gym'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"manager"}',
  true
);

select lives_ok(
  $$ insert into payments (id, gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009084', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  'a manager-claim session can INSERT a payments row scoped to their own gym'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$ insert into payments (id, gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009085', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  'a receptionist-claim session can INSERT a payments row scoped to their own gym -- this story''s actual new capability'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  '%row-level security%',
  'a coach-claim session cannot INSERT into payments -- no INSERT policy grants coach'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  '%row-level security%',
  'a member-claim session cannot INSERT into payments'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"owner"}',
  true
);

select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'mtn_momo', 'processing') $$,
  '%row-level security%',
  'a Gym B owner-claim session cannot INSERT a payments row scoped to Gym A'
);

-- ============================================================================
-- RLS: SELECT is scoped to the caller's own gym; deny-all still holds for
-- coach/member (no gym-staff SELECT policy grants either -- AC #7).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000009011'),
  3,
  'an owner-claim session can SELECT payments scoped to their own gym (the 3 successful inserts above)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payments),
  0,
  'a Gym B owner-claim session sees 0 rows from Gym A''s payments -- cross-gym deny'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from payments),
  0,
  'a coach-claim session sees 0 rows from payments -- deliberately excluded, unlike gym_staff_read_own_subscriptions/members'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from payments),
  0,
  'a member-claim session sees 0 rows from payments -- member self-read is explicitly not added here (Story 4.9''s job)'
);

-- ============================================================================
-- complete_verified_payment(): service_role-only, idempotent processing ->
-- verified transition (AC #4/#5/#6).
-- ============================================================================
reset role;

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000009082', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'test-ref-idempotency-001');

insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000009083', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009052', 15000, 'XAF', 'orange_money', 'processing', 'taramoney', 'test-ref-deactivated-001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select throws_like(
  $$ select complete_verified_payment('00000000-0000-0000-0000-000000009082'::uuid, 450) $$,
  '%permission denied%',
  'an authenticated (non-service_role) caller cannot execute complete_verified_payment() -- no EXECUTE grant'
);

set local role service_role;

select ok(
  (select complete_verified_payment('00000000-0000-0000-0000-000000009082'::uuid, 450) is not null),
  'first call to complete_verified_payment on a processing row returns a new subscription id'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009082'),
  'verified',
  'the payment transitions to verified after complete_verified_payment'
);

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000009051'),
  2,
  'exactly one new subscriptions row was created by the first call (1 prior fixture + 1 new)'
);

select is(
  (select status::text from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  'active',
  'the new subscription row is active'
);

select is(
  (select plan_id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  '00000000-0000-0000-0000-000000009061',
  'the new subscription reuses the member''s most recent plan_id'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  current_date + 30,
  'the new subscription''s expiry_date is today + the plan''s duration_days (30)'
);

select is(
  (select p.subscription_id from payments p where p.id = '00000000-0000-0000-0000-000000009082'),
  (select s.id from subscriptions s where s.member_id = '00000000-0000-0000-0000-000000009051' order by s.created_at desc limit 1),
  'payments.subscription_id is set to the new subscription''s id (ER note: a renewal payment links to the subscription it renewed)'
);

select is(
  (select provider_fee_amount from payments where id = '00000000-0000-0000-0000-000000009082'),
  450,
  'provider_fee_amount is persisted from the p_fee_amount argument'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'subscription_payment_renewal'
     and target_entity_id = '00000000-0000-0000-0000-000000009051'
     and (metadata ->> 'payment_id') = '00000000-0000-0000-0000-000000009082'),
  1,
  'a subscription_payment_renewal audit_log entry was written'
);

-- AC #4's core idempotency assertion: a second (replayed/duplicate) delivery
-- for the same payment id finds the row already verified and performs no
-- further action.
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-000000009082'::uuid, 450)),
  null,
  'a second call with the same payment id returns null -- already verified, no-op'
);

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000009051'),
  2,
  'no second subscriptions row was created by the replayed call'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'subscription_payment_renewal'
     and (metadata ->> 'payment_id') = '00000000-0000-0000-0000-000000009082'),
  1,
  'no second audit_log entry was written by the replayed call'
);

-- ============================================================================
-- Deactivated member: the payment still transitions to verified (money was
-- real and received) but renewal is skipped -- status is never silently
-- reverted back to processing.
-- ============================================================================
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-000000009083'::uuid, 300)),
  null,
  'complete_verified_payment on a deactivated member''s payment returns null -- renewal skipped'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009083'),
  'verified',
  'the deactivated member''s payment still transitions to verified -- money was real and received'
);

select is(
  (select provider_fee_amount from payments where id = '00000000-0000-0000-0000-000000009083'),
  300,
  'the fee is still captured even though renewal was skipped'
);

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000009052'),
  1,
  'no new subscriptions row was created for a deactivated member'
);

select is(
  (select subscription_id from payments where id = '00000000-0000-0000-0000-000000009083'),
  null,
  'payments.subscription_id stays null since no renewal subscription was created'
);

-- Defensive: a nonexistent payment id is a no-op, not an exception.
select is(
  (select complete_verified_payment('00000000-0000-0000-0000-000000009999'::uuid, 100)),
  null,
  'complete_verified_payment on a nonexistent payment id returns null, not an exception'
);

select * from finish();
rollback;
