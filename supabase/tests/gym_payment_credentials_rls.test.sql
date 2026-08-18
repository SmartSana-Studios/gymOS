-- Story 4.13: gym_payment_credentials RLS (deny-all for every role, including
-- the connecting gym's own Owner) and the 3 new SECURITY DEFINER functions
-- (0052_gym_payment_credentials.sql). Session-simulation conventions match
-- payment_providers_rls.test.sql.
--
-- Story 4.14: extended with the 2 new service-role-only credential-decrypt
-- RPCs (0054_flow_a_gym_routing.sql) -- the first in this codebase granted
-- with no session-derived gym scoping, so `authenticated` (any role,
-- including the connecting gym's own Owner) must be provably unable to call
-- either -- plus business_id_plain's uniqueness constraint.

begin;
select plan(36);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000901'), -- owner, gym A
  ('00000000-0000-0000-0000-000000000902'), -- manager, gym A
  ('00000000-0000-0000-0000-000000000903'), -- owner, gym B
  ('00000000-0000-0000-0000-000000000904'); -- owner, gym C

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000306', 'GPC Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000000405', 'GPC Test Gym A', '00000000-0000-0000-0000-000000000306', 'active', 30),
  ('00000000-0000-0000-0000-000000000406', 'GPC Test Gym B', '00000000-0000-0000-0000-000000000306', 'active', 30),
  ('00000000-0000-0000-0000-000000000407', 'GPC Test Gym C', '00000000-0000-0000-0000-000000000306', 'active', 30);

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000901', 'owner', 'Owner A'),
  ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000902', 'manager', 'Manager A'),
  ('00000000-0000-0000-0000-000000000703', '00000000-0000-0000-0000-000000000406', '00000000-0000-0000-0000-000000000903', 'owner', 'Owner B'),
  ('00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000407', '00000000-0000-0000-0000-000000000904', 'owner', 'Owner C');

-- ============================================================================
-- get_gym_payment_connection_status(): zero rows = not connected, for any
-- role, before any connection exists.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

select is(
  (select count(*) from get_gym_payment_connection_status('taramoney'))::int, 0,
  'get_gym_payment_connection_status returns 0 rows before any connection exists'
);

-- ============================================================================
-- connect_gym_payment_credentials(): rejects non-owner and a different gym's
-- owner; succeeds for this gym's own owner.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000902","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"manager"}', true);

select throws_like(
  $$ select connect_gym_payment_credentials('taramoney', 'key', 'biz', 'secret') $$,
  '%permission denied%',
  'a manager (non-owner) session is rejected by connect_gym_payment_credentials() -- the auth check runs before the provider_key existence check, so even an unknown provider_key would still surface as permission denied for a non-owner'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

select throws_like(
  $$ select connect_gym_payment_credentials('does_not_exist', 'key', 'biz', 'secret') $$,
  '%unknown provider_key%',
  'connect_gym_payment_credentials() rejects an unknown provider_key for an owner too'
);

select throws_like(
  $$ select connect_gym_payment_credentials('taramoney', '  ', 'biz', 'secret') $$,
  '%must not be blank%',
  'connect_gym_payment_credentials() rejects a blank/whitespace-only credential value'
);

select lives_ok(
  $$ select connect_gym_payment_credentials('taramoney', 'apikey-abc', 'businessid-1234', 'secret-xyz') $$,
  'gym A''s own owner can connect'
);

select is(
  (select business_id_masked from get_gym_payment_connection_status('taramoney'))::text, '•••• 1234',
  'get_gym_payment_connection_status returns the masked business id after connecting'
);

select ok(
  exists (
    select 1 from audit_log
    where action_type = 'gym_payment_credentials_connected'
      and gym_id = '00000000-0000-0000-0000-000000000405'
      and target_entity_id = 'taramoney'
      and (metadata ->> 'business_id_masked') = '•••• 1234'
      and metadata ? 'provider_key'
      -- NFR-017: metadata must never contain the raw credential values.
      and not (metadata::text ilike '%apikey-abc%')
      and not (metadata::text ilike '%secret-xyz%')
  ),
  'connecting is audit-logged with the masked business id, never the raw credentials (NFR-017)'
);

-- ============================================================================
-- Deny-all table access: no role, including the connecting owner, can read
-- gym_payment_credentials directly (only the 3 RPCs above are the access
-- path) -- and cannot see the underlying Vault secret either.
-- ============================================================================
select is(
  (select count(*) from gym_payment_credentials)::int, 0,
  'gym A''s own owner sees 0 rows from gym_payment_credentials directly -- deny-all, not an exception'
);

select throws_like(
  $$ select count(*) from vault.decrypted_secrets $$,
  '%permission denied%',
  'an authenticated session cannot read vault.decrypted_secrets directly, even the connecting owner'
);

-- ============================================================================
-- Cross-tenant isolation: gym B's owner sees no connection for gym A.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000903","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000406","app_role":"owner"}', true);

select is(
  (select count(*) from get_gym_payment_connection_status('taramoney'))::int, 0,
  'gym B''s owner gets 0 rows -- gym A''s connection is not visible cross-tenant'
);

-- No p_gym_id parameter exists on connect_gym_payment_credentials() -- there
-- is no mechanism to even attempt "connecting on behalf of another gym";
-- gym B's owner calling it always resolves to gym B's own gym_id via
-- private.gym_id() (never client-supplied) and connects gym B's own
-- account. What this proves is isolation, not rejection: it must not
-- disturb gym A's already-connected row.
select lives_ok(
  $$ select connect_gym_payment_credentials('taramoney', 'key-b', 'businessid-5678', 'secret-b') $$,
  'gym B''s own owner can independently connect gym B''s own account'
);

select is(
  (select business_id_masked from get_gym_payment_connection_status('taramoney'))::text, '•••• 5678',
  'gym B sees only its own freshly-connected masked business id'
);

reset role;
select is(
  (select count(*) from gym_payment_credentials)::int, 2,
  'gym A and gym B now each have their own independent row -- gym B connecting did not overwrite or merge with gym A''s'
);

-- ============================================================================
-- get_gym_payment_connection_status(): readable by Manager/Receptionist too,
-- not just Owner (AC #3 covers "a member or receptionist").
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000902","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"manager"}', true);

select is(
  (select business_id_masked from get_gym_payment_connection_status('taramoney'))::text, '•••• 1234',
  'a manager (non-owner) session of the connecting gym can still read the connection status'
);

-- ============================================================================
-- Reconnect (upsert): same row, secret replaced not orphaned.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

reset role;
select credentials_secret_id as secret_id_1 from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000000405' \gset

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

select lives_ok(
  $$ select connect_gym_payment_credentials('taramoney', 'apikey-new', 'businessid-9999', 'secret-new') $$,
  'reconnecting (upsert) succeeds'
);

reset role;
select is(
  (select count(*) from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000000405')::int, 1,
  'reconnecting does not create a second row -- upsert, not insert'
);

select is(
  (select credentials_secret_id = :'secret_id_1' from gym_payment_credentials where gym_id = '00000000-0000-0000-0000-000000000405'),
  true,
  'reconnecting replaces the same Vault secret (vault.update_secret), not a new one'
);

-- ============================================================================
-- disconnect_gym_payment_credentials(): removes the row and the Vault
-- secret; idempotent no-op when nothing is connected.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

select lives_ok(
  $$ select disconnect_gym_payment_credentials('taramoney') $$,
  'gym A''s own owner can disconnect'
);

select is(
  (select count(*) from get_gym_payment_connection_status('taramoney'))::int, 0,
  'get_gym_payment_connection_status returns 0 rows after disconnecting'
);

reset role;
select is(
  (select count(*) from vault.secrets where id = :'secret_id_1')::int, 0,
  'the underlying Vault secret is actually deleted, not just the gym_payment_credentials row'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000901","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"owner"}', true);

select lives_ok(
  $$ select disconnect_gym_payment_credentials('taramoney') $$,
  'disconnecting again (nothing connected) is an idempotent no-op, not an error'
);

-- ============================================================================
-- Review fix (Story 4.13): disconnect_gym_payment_credentials() rejects a
-- non-owner session too -- previously only connect_gym_payment_credentials()
-- had this coverage, even though both RPCs share the identical auth check.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000902","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000405","app_role":"manager"}', true);

select throws_like(
  $$ select disconnect_gym_payment_credentials('taramoney') $$,
  '%permission denied%',
  'a manager (non-owner) session is rejected by disconnect_gym_payment_credentials()'
);

-- ============================================================================
-- Review fix (Story 4.13): a business_id of 4 characters or fewer must not
-- be fully revealed by the masking -- right(x, 4) alone would show 100% of
-- a value this short despite the "••••" prefix visually implying redaction.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000904","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000407","app_role":"owner"}', true);

select lives_ok(
  $$ select connect_gym_payment_credentials('taramoney', 'key-c', 'ab', 'secret-c') $$,
  'gym C''s owner can connect with a short (2-character) business id'
);

select is(
  (select business_id_masked from get_gym_payment_connection_status('taramoney'))::text, '••••',
  'a business_id of 4 characters or fewer is never partially revealed by the mask'
);

-- ============================================================================
-- Story 4.14: the 2 new service-role-only credential-decrypt RPCs. Gym C
-- (just connected above, business_id_plain = 'ab', the same short value
-- used for the masking test) is reused as the fixture -- a real connection
-- already exists, no new setup needed.
-- ============================================================================
select throws_like(
  $$ select * from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000000407', 'taramoney') $$,
  '%permission denied%',
  'an authenticated session (even the connecting gym''s own Owner) cannot call get_gym_payment_credentials_for_service -- service_role only'
);

select throws_like(
  $$ select * from get_gym_payment_credentials_by_business_id('ab', 'taramoney') $$,
  '%permission denied%',
  'an authenticated session cannot call get_gym_payment_credentials_by_business_id -- service_role only'
);

select throws_like(
  $$ select mark_gym_payment_credentials_needs_attention('00000000-0000-0000-0000-000000000407', 'taramoney') $$,
  '%permission denied%',
  'an authenticated session cannot call mark_gym_payment_credentials_needs_attention -- service_role only'
);

reset role;
set local role service_role;

select is(
  (select api_key from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000000407', 'taramoney'))::text,
  'key-c',
  'service_role can call get_gym_payment_credentials_for_service and receives the decrypted apiKey'
);

select is(
  (select gym_id from get_gym_payment_credentials_by_business_id('ab', 'taramoney'))::text,
  '00000000-0000-0000-0000-000000000407',
  'service_role can call get_gym_payment_credentials_by_business_id and it resolves the correct gym_id from the plain businessId'
);

select is(
  (select count(*)::int from get_gym_payment_credentials_for_service('00000000-0000-0000-0000-000000000999', 'taramoney')),
  0,
  'get_gym_payment_credentials_for_service returns 0 rows for a gym with no connection at all'
);

reset role;

-- ============================================================================
-- Story 4.14: mark_gym_payment_credentials_needs_attention() and its
-- interaction with get_gym_payment_connection_status()'s new needs_attention
-- column, and with a reconnect clearing it back to false.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000904","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000407","app_role":"owner"}', true);

select is(
  (select needs_attention from get_gym_payment_connection_status('taramoney')),
  false,
  'get_gym_payment_connection_status: needs_attention starts false for a freshly-connected gym'
);

reset role;
set local role service_role;
select mark_gym_payment_credentials_needs_attention('00000000-0000-0000-0000-000000000407', 'taramoney');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000904","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000407","app_role":"owner"}', true);

select is(
  (select needs_attention from get_gym_payment_connection_status('taramoney')),
  true,
  'mark_gym_payment_credentials_needs_attention() flips needs_attention to true, visible via get_gym_payment_connection_status'
);

select lives_ok(
  $$ select connect_gym_payment_credentials('taramoney', 'key-c-2', 'ab', 'secret-c-2') $$,
  'gym C''s owner can reconnect after a needs_attention flag'
);

select is(
  (select needs_attention from get_gym_payment_connection_status('taramoney')),
  false,
  'a successful reconnect clears needs_attention back to false'
);

-- ============================================================================
-- Story 4.14: business_id_plain uniqueness (per provider_key) -- a second
-- gym cannot connect using a business id another gym already has.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000903","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000406","app_role":"owner"}', true);

select throws_like(
  $$ select connect_gym_payment_credentials('taramoney', 'key-b-dup', 'ab', 'secret-b-dup') $$,
  '%idx_gym_payment_credentials_provider_business_id%',
  'a second gym cannot connect using a business_id another gym (under the same provider_key) already has -- the partial unique index rejects it'
);

reset role;
set local role service_role;

select is(
  (select count(*)::int from get_gym_payment_credentials_by_business_id('this-business-id-does-not-exist', 'taramoney')),
  0,
  'get_gym_payment_credentials_by_business_id returns 0 rows for an unrecognized businessId'
);

reset role;

select * from finish();
rollback;
