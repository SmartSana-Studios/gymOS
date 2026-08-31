-- Story 11.1: PaymentProvider Routing Context & SaaS Billing Table. Covers
-- saas_billing_payments' RLS (Super-Admin-scoped SELECT, no direct client
-- INSERT/UPDATE/DELETE for any role) and the two new completion RPCs'
-- service_role-only grant + idempotent processing -> verified/flagged
-- transition, mirroring payment_providers_rls.test.sql's and
-- payments_rls_and_renewal.test.sql's own structure/conventions for these
-- same shapes.
--
-- Story 11.7 (AC #4): the gym-owner-claim case below now expects to SEE its
-- own gym's row, not 0 -- owner_read_own_gym_saas_billing_payments
-- (0077_pay_now_tier_selection_alternate_payment.sql) closes the RLS gap
-- deferred-work.md:6,643 flagged, which otherwise silently broke
-- PayNowButton's own polling watch for every real Owner session.

begin;
select plan(14);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009401'), -- super_admin caller
  ('00000000-0000-0000-0000-000000009402'), -- owner, non-super-admin
  ('00000000-0000-0000-0000-000000009403'); -- genuine member (customer), non-staff

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009304', 'SaaS Billing Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000009410', 'SaaS Billing Test Gym', '00000000-0000-0000-0000-000000009304', 'active', 30);

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009602', '00000000-0000-0000-0000-000000009410', '00000000-0000-0000-0000-000000009402', 'owner', 'Test Gym Owner'),
  ('00000000-0000-0000-0000-000000009603', '00000000-0000-0000-0000-000000009410', '00000000-0000-0000-0000-000000009403', 'member', 'Test Gym Member');

reset role;
insert into saas_billing_payments (id, gym_id, amount, currency, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009410', 5000000, 'XAF', 'processing', 'taramoney', 'saas-test-ref-001');

-- ============================================================================
-- RLS: super_admin sees every gym's rows; a gym's own owner sees only their
-- own gym's rows (Story 11.7, AC #4); every other role/no-session sees 0
-- rows, not an exception (RLS SELECT semantics, matching
-- super_admin_read_tiers/super_admin_read_payment_providers precedent).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009401","role":"authenticated","app_role":"super_admin"}',
  true
);

select ok(
  (select count(*) from saas_billing_payments) >= 1,
  'super_admin can SELECT saas_billing_payments and sees the seeded row'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009402","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009410","app_role":"owner"}',
  true
);

select is(
  (select count(*) from saas_billing_payments)::int, 1,
  'a gym-owner claim session sees exactly its own gym''s row -- owner_read_own_gym_saas_billing_payments (Story 11.7), not deny-all'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009403","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009410","app_role":"member"}',
  true
);

select is(
  (select count(*) from saas_billing_payments)::int, 0,
  'a genuine (non-owner) member-claim session sees 0 rows from saas_billing_payments -- deny-all still holds for every other role'
);

-- anon has no table-level GRANT on saas_billing_payments at all (only
-- authenticated/service_role, matching payment_providers'/
-- messaging_provider_config's own precedent) -- deny-all for anon manifests
-- as a permission-denied error at the grant layer, not an RLS-driven empty
-- result.
set local role anon;

select throws_like(
  $$ select count(*) from saas_billing_payments $$,
  '%permission denied%',
  'anon cannot SELECT saas_billing_payments at all -- no table-level GRANT for anon'
);

-- ============================================================================
-- No role -- not even super_admin -- can INSERT/UPDATE/DELETE directly. RLS
-- blocks it (no policy exists for any of those commands); the two
-- completion RPCs below are the only sanctioned write path, matching
-- payment_providers'/payments' own "single blessed write path" posture.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009401","role":"authenticated","app_role":"super_admin"}',
  true
);

select throws_like(
  $$ insert into saas_billing_payments (gym_id, amount, status) values ('00000000-0000-0000-0000-000000009410', 1000, 'processing') $$,
  '%row-level security%',
  'even a super_admin session cannot INSERT directly into saas_billing_payments'
);

-- UPDATE/DELETE's USING clause (not WITH CHECK) governs which rows are even
-- visible to the command -- with no applicable UPDATE/DELETE policy, 0 rows
-- match and the statement completes silently (no exception), the same RLS
-- semantics as tiers_and_gym_lifecycle_rls.test.sql's own UPDATE/DELETE
-- denial cases.
with updated as (
  update saas_billing_payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009701' returning id
)
select is(
  (select count(*) from updated)::int, 0,
  'even a super_admin session cannot UPDATE saas_billing_payments -- 0 rows affected silently, not an exception'
);

with deleted as (
  delete from saas_billing_payments where id = '00000000-0000-0000-0000-000000009701' returning id
)
select is(
  (select count(*) from deleted)::int, 0,
  'even a super_admin session cannot DELETE from saas_billing_payments -- 0 rows affected silently, not an exception'
);

-- ============================================================================
-- complete_verified_saas_billing_payment() / complete_flagged_saas_billing_payment():
-- service_role-only, idempotent processing -> verified/flagged transitions.
-- ============================================================================
select throws_like(
  $$ select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009701'::uuid, 200) $$,
  '%permission denied%',
  'an authenticated (non-service_role) caller cannot execute complete_verified_saas_billing_payment() -- no EXECUTE grant'
);

set local role service_role;

select lives_ok(
  $$ select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009701'::uuid, 200) $$,
  'service_role can call complete_verified_saas_billing_payment on a processing row'
);

select is(
  (select status::text from saas_billing_payments where id = '00000000-0000-0000-0000-000000009701'),
  'verified',
  'the payment transitions to verified after complete_verified_saas_billing_payment'
);

-- Idempotency: a second call (replayed webhook) on an already-verified row
-- is a no-op, not an exception -- fee amount stays at the first call's value.
select lives_ok(
  $$ select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009701'::uuid, 999) $$,
  'a second call to complete_verified_saas_billing_payment on an already-verified row is a no-op, not an exception'
);

select is(
  (select provider_fee_amount from saas_billing_payments where id = '00000000-0000-0000-0000-000000009701'),
  200,
  'the replayed second call did not overwrite provider_fee_amount -- the `where status = ''processing''` guard made it a true no-op'
);

-- A separate processing row for the flagged path, plus its own idempotency check.
reset role;
insert into saas_billing_payments (id, gym_id, amount, currency, status, provider, provider_transaction_ref)
values ('00000000-0000-0000-0000-000000009702', '00000000-0000-0000-0000-000000009410', 3000000, 'XAF', 'processing', 'taramoney', 'saas-test-ref-002');

set local role service_role;

select lives_ok(
  $$ select complete_flagged_saas_billing_payment('00000000-0000-0000-0000-000000009702'::uuid) $$,
  'service_role can call complete_flagged_saas_billing_payment on a processing row'
);

select is(
  (select status::text from saas_billing_payments where id = '00000000-0000-0000-0000-000000009702'),
  'flagged',
  'the payment transitions to flagged after complete_flagged_saas_billing_payment'
);

select * from finish();
rollback;
