-- Story 4.1: payment_providers RLS (deny-all for non-super-admin, super_admin
-- SELECT works) and both new SECURITY DEFINER functions
-- (0029_payment_provider_registry.sql). Session-simulation conventions match
-- tiers_and_gym_lifecycle_rls.test.sql.

begin;
select plan(15);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000701'), -- super_admin caller
  ('00000000-0000-0000-0000-000000000702'); -- owner, non-super-admin

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000304', 'Payment Provider Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000000402', 'Payment Provider Test Gym', '00000000-0000-0000-0000-000000000304', 'active', 30);

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000702', 'owner', 'Test Gym Owner');

-- Second registered provider, inactive -- lets activate_payment_provider's
-- switch-between-two-rows behavior be exercised (not just single-row seed data).
insert into payment_providers (provider_key, display_name, is_active)
values ('mockpay', 'MockPay (test fixture)', false);

-- This test needs a known "taramoney is active" starting state to exercise
-- the switch-between-two-providers path, independent of the real migration
-- seed's actual is_active value (which is `true` as of 2026-07-31 -- the
-- real spike passed against a stand-in TaraMoney business, see
-- docs/decisions.md). Set up directly, bypassing RLS (no role/session
-- simulation needed for fixture setup).
reset role;
update payment_providers set is_active = true where provider_key = 'taramoney';

-- ============================================================================
-- RLS: super_admin can SELECT; a non-super-admin session gets 0 rows, not an
-- exception (RLS SELECT semantics -- matches super_admin_read_tiers precedent).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","app_role":"super_admin"}',
  true
);

select ok(
  (select count(*) from payment_providers) >= 2,
  'super_admin can SELECT payment_providers and sees the seeded rows'
);

select throws_like(
  $$ insert into payment_providers (provider_key, display_name) values ('direct_insert', 'Should be blocked') $$,
  '%row-level security%',
  'even a super_admin session cannot INSERT directly -- activate_payment_provider() is the only sanctioned write path'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000402","app_role":"owner"}',
  true
);

select is(
  (select count(*) from payment_providers)::int, 0,
  'a non-super-admin session sees 0 rows from payment_providers -- deny-all, not an exception'
);

-- ============================================================================
-- activate_payment_provider(): rejects non-super-admin, rejects unknown key,
-- exactly-one-active invariant holds, audit-logged.
-- ============================================================================
select throws_like(
  $$ select activate_payment_provider('mockpay') $$,
  '%permission denied%',
  'a non-super_admin caller is rejected by activate_payment_provider()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","app_role":"super_admin"}',
  true
);

select throws_like(
  $$ select activate_payment_provider('does_not_exist') $$,
  '%unknown provider_key%',
  'activate_payment_provider() rejects an unknown provider_key'
);

select lives_ok(
  $$ select activate_payment_provider('mockpay') $$,
  'super_admin can activate a different, registered provider'
);

select is(
  (select provider_key from payment_providers where is_active)::text, 'mockpay',
  'mockpay is now the sole active provider'
);

select is(
  (select count(*) from payment_providers where is_active)::int, 1,
  'exactly one row is active after the switch -- idx_payment_providers_one_active holds'
);

select is(
  (select count(*) from payment_providers where provider_key = 'taramoney' and is_active)::int, 0,
  'the previously-active provider (taramoney) is now inactive'
);

select ok(
  exists (
    select 1 from audit_log
    where action_type = 'payment_provider_activated'
      and target_entity_id = 'mockpay'
      and (metadata ->> 'previous_provider_key') = 'taramoney'
      and (metadata ->> 'new_provider_key') = 'mockpay'
  ),
  'activating a different provider is audit-logged with actor, previous, and new provider (AC #7)'
);

-- Directly attempting to violate the one-active invariant at the raw SQL
-- level (bypassing RLS entirely via `reset role`, since payment_providers
-- has no UPDATE policy for any role -- the RPC is the only sanctioned write
-- path) is still blocked by the partial unique index -- proves the
-- invariant is DB-enforced, not just app/RPC-logic-enforced (AC #5).
reset role;
select throws_like(
  $$ update payment_providers set is_active = true where provider_key = 'taramoney' $$,
  '%idx_payment_providers_one_active%',
  'the partial unique index blocks a second row from being set is_active = true, even bypassing RLS'
);

-- ============================================================================
-- active_payment_provider(): any authenticated (gym-scoped) role can read the
-- current key; it does not expose the full table (AC #9).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000402","app_role":"owner"}',
  true
);

select is(
  (select active_payment_provider())::text, 'mockpay',
  'a non-super-admin, gym-scoped session can read the active provider key via active_payment_provider()'
);

select is(
  (select count(*) from payment_providers)::int, 0,
  'active_payment_provider() readability does not grant table-level SELECT -- still 0 rows via direct query'
);

-- Re-activating the already-active provider is a no-op: no duplicate audit
-- entry, no exception.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$ select activate_payment_provider('mockpay') $$,
  'reactivating the already-active provider is a no-op, not an error'
);

select is(
  (select count(*) from audit_log where action_type = 'payment_provider_activated')::int, 1,
  'reactivating the already-active provider does not write a second audit entry'
);

select * from finish();
rollback;
