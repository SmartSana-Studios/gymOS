-- Story 4.4: run_payment_reconciliation_job()'s detection logic, called
-- directly (not via real cron timing, same convention as
-- subscription_lifecycle_cron.test.sql), plus RLS coverage for the two new
-- tables (payment_webhook_events: pure deny-all; payment_discrepancies:
-- gym-scoped, staff-only, with the missing_internal_record/gym_id-null row
-- structurally invisible even to its own gym's staff -- see docs/decisions.md).
-- The failure branch (job_runs 'failure' row + audit_log write) is
-- intentionally NOT covered here, same accepted gap as 3.1's own test file.
--
-- Story 4.14: extended with the 4th category (wrong_account_settlement,
-- FR-137) -- unlike missing_internal_record, this one IS gym-attributable,
-- so it's visible under the same RLS policy as stale_processing/
-- amount_mismatch (see the updated per-role counts below).

begin;
select plan(28);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009501', 'Reconciliation Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009511', 'Reconciliation Test Gym A', '00000000-0000-0000-0000-000000009501', 30),
  ('00000000-0000-0000-0000-000000009512', 'Reconciliation Test Gym B', '00000000-0000-0000-0000-000000009501', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009521'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009522'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009523'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009524'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009526'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009551'), -- Gym A payer
  ('00000000-0000-0000-0000-000000009552'); -- Gym B payer (Story 4.14: now used, see p7 below)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009541', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009521', 'owner', 'Reconciliation Gym A Owner'),
  ('00000000-0000-0000-0000-000000009542', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009522', 'manager', 'Reconciliation Gym A Manager'),
  ('00000000-0000-0000-0000-000000009543', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009523', 'receptionist', 'Reconciliation Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009544', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009524', 'coach', 'Reconciliation Gym A Coach'),
  ('00000000-0000-0000-0000-000000009546', '00000000-0000-0000-0000-000000009512', '00000000-0000-0000-0000-000000009526', 'owner', 'Reconciliation Gym B Owner'),
  ('00000000-0000-0000-0000-000000009561', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009551', 'member', 'Reconciliation Gym A Payer'),
  ('00000000-0000-0000-0000-000000009562', '00000000-0000-0000-0000-000000009512', '00000000-0000-0000-0000-000000009552', 'member', 'Reconciliation Gym B Payer');

-- ============================================================================
-- Story 4.14 (Task 2, FR-137): Gym A connects Tara Money -- inserted
-- directly (not via connect_gym_payment_credentials()) since this file only
-- needs business_id_plain populated for the job's join, not real Vault
-- encryption (already covered by gym_payment_credentials_rls.test.sql).
-- Gym B deliberately has NO row here -- p7 below exercises the "gym never
-- connected, payment somehow settled to the platform account" arm of the
-- job's left join.
-- ============================================================================
insert into gym_payment_credentials (id, gym_id, provider_key, credentials_secret_id, business_id_masked, business_id_plain) values
  ('00000000-0000-0000-0000-000000009801', '00000000-0000-0000-0000-000000009511', 'taramoney', gen_random_uuid(), '•••• ess-a', 'recon-test-business-a');

-- ============================================================================
-- payments fixtures (Gym A). p1: stale (>10 min, no completing webhook). p2:
-- too-recent processing (not yet past the threshold). p3/p4: already-verified
-- rows matched by a webhook event below (amount mismatch / amount match).
-- ============================================================================
-- p5/p6 (Gym A, Story 4.14): p5's matched webhook event settles to the
-- wrong businessId; p6's matches Gym A's own connected business_id_plain.
-- p7 (Gym B, Story 4.14): Gym B never connected (no gym_payment_credentials
-- row at all) -- its matched webhook event still gets flagged.
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0000-000000009601', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 5000, 'XAF', 'mtn_momo', 'processing', now() - interval '11 minutes'),
  ('00000000-0000-0000-0000-000000009602', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 5000, 'XAF', 'mtn_momo', 'processing', now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-000000009603', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 10000, 'XAF', 'orange_money', 'verified', now()),
  ('00000000-0000-0000-0000-000000009604', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 8000, 'XAF', 'orange_money', 'verified', now()),
  ('00000000-0000-0000-0000-000000009605', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 6000, 'XAF', 'orange_money', 'verified', now()),
  ('00000000-0000-0000-0000-000000009606', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009561', 7000, 'XAF', 'orange_money', 'verified', now()),
  ('00000000-0000-0000-0000-000000009607', '00000000-0000-0000-0000-000000009512', '00000000-0000-0000-0000-000000009562', 9000, 'XAF', 'orange_money', 'verified', now());

-- payment_webhook_events fixtures. 'taramoney' is seeded globally by 0029
-- (0029_payment_provider_registry.sql), no per-test payment_providers row
-- needed. e1 matches nothing (AC #1). e2 matches p3 but disagrees on amount
-- (AC #3). e3 matches p4 and agrees (no discrepancy). e4 matches p5 but
-- settles to the wrong businessId (Story 4.14, FR-137). e5 matches p6 and
-- settles to Gym A's own connected businessId (no discrepancy). e6 matches
-- p7 (Gym B, never connected).
-- e2/e3's raw_payload carries Gym A's own connected businessId (Story 4.14
-- fixture addition, below) -- otherwise their empty '{}' payload would also
-- trip the new wrong_account_settlement category (NULL businessId IS
-- DISTINCT FROM Gym A's business_id_plain), falsely coupling the
-- amount_mismatch category's fixtures to this one. Every real webhook
-- delivery always carries businessId (per every real spike in
-- docs/decisions.md), so this also just makes the fixture more realistic.
insert into payment_webhook_events (id, provider_key, provider_transaction_ref, amount, currency, status, matched_payment_id, raw_payload) values
  ('00000000-0000-0000-0000-000000009701', 'taramoney', 'recon-test-unmatched', 5000, 'XAF', 'verified', null, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000009702', 'taramoney', 'recon-test-mismatch', 10500, 'XAF', 'verified', '00000000-0000-0000-0000-000000009603', '{"businessId": "recon-test-business-a"}'::jsonb),
  ('00000000-0000-0000-0000-000000009703', 'taramoney', 'recon-test-match', 8000, 'XAF', 'verified', '00000000-0000-0000-0000-000000009604', '{"businessId": "recon-test-business-a"}'::jsonb),
  ('00000000-0000-0000-0000-000000009704', 'taramoney', 'recon-test-wrong-account', 6000, 'XAF', 'verified', '00000000-0000-0000-0000-000000009605', '{"businessId": "wrong-business-id"}'::jsonb),
  ('00000000-0000-0000-0000-000000009705', 'taramoney', 'recon-test-right-account', 7000, 'XAF', 'verified', '00000000-0000-0000-0000-000000009606', '{"businessId": "recon-test-business-a"}'::jsonb),
  ('00000000-0000-0000-0000-000000009706', 'taramoney', 'recon-test-never-connected', 9000, 'XAF', 'verified', '00000000-0000-0000-0000-000000009607', '{"businessId": "some-business-id"}'::jsonb);

-- ============================================================================
-- Call the job directly -- no waiting on real cron timing.
-- ============================================================================
select lives_ok(
  $$ select run_payment_reconciliation_job() $$,
  'run_payment_reconciliation_job() executes without error against seeded fixtures'
);

select is(
  (select count(*) from job_runs where job_name = 'payment_reconciliation' and status = 'success')::int, 1,
  'a success row is written to job_runs'
);

-- AC #1: the unmatched webhook event produces exactly one
-- missing_internal_record discrepancy, gym_id NULL by construction.
select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'missing_internal_record' and webhook_event_id = '00000000-0000-0000-0000-000000009701'),
  1,
  'the unmatched webhook event produces exactly one missing_internal_record discrepancy'
);

select is(
  (select gym_id from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009701' and discrepancy_type = 'missing_internal_record'),
  null,
  'the missing_internal_record discrepancy has gym_id = NULL -- unattributable by construction'
);

-- AC #2: the stale processing payment (created 11 minutes ago) is flagged.
select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'stale_processing' and payment_id = '00000000-0000-0000-0000-000000009601'),
  1,
  'a processing payment older than 10 minutes with no completing webhook produces a stale_processing discrepancy'
);

select is(
  (select gym_id from payment_discrepancies where payment_id = '00000000-0000-0000-0000-000000009601' and discrepancy_type = 'stale_processing'),
  '00000000-0000-0000-0000-000000009511',
  'the stale_processing discrepancy carries the payment''s own gym_id'
);

select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'stale_processing' and payment_id = '00000000-0000-0000-0000-000000009602'),
  0,
  'a processing payment only 5 minutes old produces no stale_processing discrepancy -- not yet past the 10-minute threshold'
);

-- AC #3: the amount-mismatched webhook event is flagged, with both amounts
-- captured in details.
select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'amount_mismatch' and webhook_event_id = '00000000-0000-0000-0000-000000009702'),
  1,
  'a webhook event whose amount disagrees with its matched payment produces an amount_mismatch discrepancy'
);

select is(
  (select details ->> 'webhookAmount' from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009702' and discrepancy_type = 'amount_mismatch'),
  '10500',
  'the amount_mismatch discrepancy''s details captures the webhook-reported amount'
);

select is(
  (select details ->> 'internalAmount' from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009702' and discrepancy_type = 'amount_mismatch'),
  '10000',
  'the amount_mismatch discrepancy''s details captures the internal payments amount'
);

select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'amount_mismatch' and webhook_event_id = '00000000-0000-0000-0000-000000009703'),
  0,
  'a webhook event whose amount matches its matched payment produces no amount_mismatch discrepancy'
);

-- ============================================================================
-- Story 4.14 (FR-137): the 4th category -- a verified, matched webhook
-- event whose payload businessId disagrees with its gym's own connected
-- business_id_plain. Unlike missing_internal_record, gym_id IS populated
-- here -- this discrepancy is attributable to a gym.
-- ============================================================================
select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'wrong_account_settlement' and webhook_event_id = '00000000-0000-0000-0000-000000009704'),
  1,
  'a webhook event whose businessId disagrees with its gym''s connected business_id_plain produces a wrong_account_settlement discrepancy'
);

select is(
  (select gym_id from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009704' and discrepancy_type = 'wrong_account_settlement'),
  '00000000-0000-0000-0000-000000009511',
  'the wrong_account_settlement discrepancy carries the payment''s own gym_id -- attributable, unlike missing_internal_record'
);

select is(
  (select details ->> 'webhookBusinessId' from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009704' and discrepancy_type = 'wrong_account_settlement'),
  'wrong-business-id',
  'the wrong_account_settlement discrepancy''s details captures the webhook-reported businessId'
);

select is(
  (select details ->> 'expectedBusinessId' from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009704' and discrepancy_type = 'wrong_account_settlement'),
  'recon-test-business-a',
  'the wrong_account_settlement discrepancy''s details captures the gym''s own expected businessId'
);

select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'wrong_account_settlement' and webhook_event_id = '00000000-0000-0000-0000-000000009705'),
  0,
  'a webhook event whose businessId matches the gym''s own connected business_id_plain produces no wrong_account_settlement discrepancy'
);

select is(
  (select count(*)::int from payment_discrepancies
    where discrepancy_type = 'wrong_account_settlement' and webhook_event_id = '00000000-0000-0000-0000-000000009706'),
  1,
  'a gym with no gym_payment_credentials row at all (never connected) still gets its matched webhook event flagged -- the left join produces NULL, which IS DISTINCT FROM any businessId'
);

select is(
  (select gym_id from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009706' and discrepancy_type = 'wrong_account_settlement'),
  '00000000-0000-0000-0000-000000009512',
  'the never-connected-gym''s wrong_account_settlement discrepancy still carries its own gym_id'
);

select is(
  (select details ->> 'expectedBusinessId' from payment_discrepancies where webhook_event_id = '00000000-0000-0000-0000-000000009706' and discrepancy_type = 'wrong_account_settlement'),
  null,
  'the never-connected-gym''s discrepancy details carries a NULL expectedBusinessId, not a fabricated value'
);

-- ============================================================================
-- Idempotency: calling the function twice in a row produces the same row
-- count the second time -- the four partial unique indexes' ON CONFLICT DO
-- NOTHING holding, not a duplicate-detection bug.
-- ============================================================================
select lives_ok(
  $$ select run_payment_reconciliation_job() $$,
  'run_payment_reconciliation_job() can be called a second time without error'
);

select is(
  (select count(*)::int from payment_discrepancies),
  5,
  'a second consecutive run leaves the total discrepancy row count unchanged -- no re-flagging of already-known discrepancies (1 missing_internal_record + 1 stale_processing + 1 amount_mismatch + 2 wrong_account_settlement)'
);

select is(
  (select count(*)::int from payment_discrepancies where discrepancy_type = 'wrong_account_settlement'),
  2,
  'the 4th category''s own partial unique index holds across the second run too -- no duplicate wrong_account_settlement rows'
);

-- ============================================================================
-- RLS: payment_webhook_events -- pure deny-all, no SELECT policy for any
-- role (matches job_runs' own precedent).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009521","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payment_webhook_events),
  0,
  'payment_webhook_events: 0 rows for any role, no SELECT policy at all'
);

-- ============================================================================
-- RLS: payment_discrepancies -- owner/manager/receptionist see their own
-- gym's rows (the missing_internal_record row stays invisible, gym_id is
-- NULL). Total non-null-gym rows for Gym A is 3 (stale_processing +
-- amount_mismatch + wrong_account_settlement); missing_internal_record
-- never matches `gym_id = private.gym_id()` for anyone.
-- ============================================================================
select is(
  (select count(*)::int from payment_discrepancies),
  3,
  'an owner-claim session sees exactly its own gym''s 3 discrepancies -- the gym_id-NULL missing_internal_record row stays invisible even to its own gym''s staff'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009522","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from payment_discrepancies),
  3,
  'a manager-claim session sees the same 3 discrepancies'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009523","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from payment_discrepancies),
  3,
  'a receptionist-claim session sees the same 3 discrepancies'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009524","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from payment_discrepancies),
  0,
  'a coach-claim session sees 0 discrepancies -- no AC/FR gives Coach payment visibility, same as payments itself'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009526","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009512","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payment_discrepancies),
  1,
  'a Gym B owner-claim session sees only its own 1 wrong_account_settlement discrepancy -- Gym A''s 3 discrepancies stay invisible (cross-gym read deny)'
);

select * from finish();
rollback;
