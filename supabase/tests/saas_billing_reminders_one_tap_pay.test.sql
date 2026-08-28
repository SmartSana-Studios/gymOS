-- Story 11.3: Payment-Due Reminders & One-Tap Pay. Covers Task 1's schema
-- shape: initiate_saas_billing_payment(), update_own_owner_notification_email(),
-- complete_verified_saas_billing_payment()'s new reset side effect + its
-- narrowly-scoped app.saas_billing_payment_reset_bypass GUC, the
-- saas_billing_notices dedup unique index, and the amount>=0 CHECK
-- constraint. Session-simulation conventions match
-- member_self_service_renewal.test.sql/saas_subscription_lifecycle.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- for RPC callers, `set local role service_role` for the webhook-only
-- completion RPC).

begin;
select plan(51);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000009501', 'Reminders Test Tier A', 8000, 80000, 40),
  ('00000000-0000-0000-0000-000000009502', 'Reminders Test Tier B', 15000, 150000, 40);

insert into gyms (id, name, tier_id, status, saas_billing_status, saas_billing_interval, saas_billing_anchor_date, capacity) values
  ('00000000-0000-0000-0000-000000009511', 'Reminders Gym 1', '00000000-0000-0000-0000-000000009501', 'active', 'active', 'monthly', current_date + 30, 30),
  ('00000000-0000-0000-0000-000000009512', 'Reminders Gym 2 (pricier tier)', '00000000-0000-0000-0000-000000009502', 'active', 'active', 'monthly', current_date + 30, 30),
  ('00000000-0000-0000-0000-000000009513', 'Reminders Gym 3 (Free/Test)', '00000000-0000-4000-8000-000000000104', 'active', 'active', 'monthly', current_date + 30, 30),
  ('00000000-0000-0000-0000-000000009514', 'Reminders Gym 4 (deactivated)', '00000000-0000-0000-0000-000000009501', 'deactivated', 'suspended', 'monthly', current_date - 20, 30),
  ('00000000-0000-0000-0000-000000009515', 'Reminders Gym 5 (suspended, monthly)', '00000000-0000-0000-0000-000000009501', 'suspended', 'suspended', 'monthly', current_date - 10, 30),
  ('00000000-0000-0000-0000-000000009516', 'Reminders Gym 6 (past_due, annual)', '00000000-0000-0000-0000-000000009501', 'active', 'past_due', 'annual', current_date - 3, 30),
  ('00000000-0000-0000-0000-000000009517', 'Reminders Gym 7 (bypass-scope proof)', '00000000-0000-0000-0000-000000009501', 'active', 'active', 'monthly', current_date + 30, 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009601'), -- Gym 1 owner
  ('00000000-0000-0000-0000-000000009602'), -- Gym 1 second owner (cross-member isolation)
  ('00000000-0000-0000-0000-000000009603'), -- Gym 1 manager (rejection)
  ('00000000-0000-0000-0000-000000009604'), -- Gym 1 receptionist (rejection)
  ('00000000-0000-0000-0000-000000009605'), -- Gym 1 coach (rejection)
  ('00000000-0000-0000-0000-000000009606'), -- Gym 1 supervisor (rejection)
  ('00000000-0000-0000-0000-000000009607'), -- Gym 2 owner (cross-gym isolation)
  ('00000000-0000-0000-0000-000000009608'), -- Gym 3 owner (Free/Test)
  ('00000000-0000-0000-0000-000000009609'); -- Gym 7 owner (bypass-scope proof)

insert into members (id, gym_id, user_id, role, name, email) values
  ('00000000-0000-0000-0000-000000009701', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009601', 'owner', 'Reminders Gym 1 Owner', null),
  ('00000000-0000-0000-0000-000000009702', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009602', 'owner', 'Reminders Gym 1 Second Owner', null),
  ('00000000-0000-0000-0000-000000009703', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009603', 'manager', 'Reminders Gym 1 Manager', null),
  ('00000000-0000-0000-0000-000000009704', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009604', 'receptionist', 'Reminders Gym 1 Receptionist', null),
  ('00000000-0000-0000-0000-000000009705', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009605', 'coach', 'Reminders Gym 1 Coach', null),
  ('00000000-0000-0000-0000-000000009706', '00000000-0000-0000-0000-000000009511', '00000000-0000-0000-0000-000000009606', 'supervisor', 'Reminders Gym 1 Supervisor', null),
  ('00000000-0000-0000-0000-000000009707', '00000000-0000-0000-0000-000000009512', '00000000-0000-0000-0000-000000009607', 'owner', 'Reminders Gym 2 Owner', null),
  ('00000000-0000-0000-0000-000000009708', '00000000-0000-0000-0000-000000009513', '00000000-0000-0000-0000-000000009608', 'owner', 'Reminders Gym 3 Owner', null),
  ('00000000-0000-0000-0000-000000009709', '00000000-0000-0000-0000-000000009517', '00000000-0000-0000-0000-000000009609', 'owner', 'Reminders Gym 7 Owner', null);

-- ============================================================================
-- initiate_saas_billing_payment()
-- ============================================================================

-- (a) An owner caller succeeds; the resulting row's gym_id/amount/currency/
-- provider all match the caller's own gym/tier/active-provider -- never a
-- client-supplied value, since the RPC takes no parameters.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009601","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"owner"}',
  true
);

create temp table sbp_1 as select initiate_saas_billing_payment() as id;

reset role;

select is(
  (select gym_id from saas_billing_payments where id = (select id from sbp_1)),
  '00000000-0000-0000-0000-000000009511'::uuid,
  'the new saas_billing_payments row belongs to the calling owner''s own gym'
);

select is(
  (select amount from saas_billing_payments where id = (select id from sbp_1)),
  8000,
  'the new row''s amount is server-derived from the gym''s own tier (monthly_price)'
);

select is(
  (select currency from saas_billing_payments where id = (select id from sbp_1)),
  'XAF',
  'the new row''s currency is XAF'
);

select is(
  (select provider from saas_billing_payments where id = (select id from sbp_1)),
  'taramoney',
  'the new row''s provider is the platform''s active provider'
);

select is(
  (select status::text from saas_billing_payments where id = (select id from sbp_1)),
  'processing',
  'the new row starts in processing status'
);

-- (b) A non-owner role is rejected, with zero rows inserted for each.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009603","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"manager"}',
  true
);
select throws_like(
  $$select initiate_saas_billing_payment()$$,
  '%permission denied%',
  'a manager-claim session cannot call initiate_saas_billing_payment()'
);
reset role;
select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009511' and provider is null),
  0,
  'no orphaned row was inserted for the rejected manager-claim session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009604","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"receptionist"}',
  true
);
select throws_like(
  $$select initiate_saas_billing_payment()$$,
  '%permission denied%',
  'a receptionist-claim session cannot call initiate_saas_billing_payment()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009605","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"coach"}',
  true
);
select throws_like(
  $$select initiate_saas_billing_payment()$$,
  '%permission denied%',
  'a coach-claim session cannot call initiate_saas_billing_payment()'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009606","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"supervisor"}',
  true
);
select throws_like(
  $$select initiate_saas_billing_payment()$$,
  '%permission denied%',
  'a supervisor-claim session cannot call initiate_saas_billing_payment()'
);
reset role;

select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009511'),
  1,
  'exactly one saas_billing_payments row exists for Gym 1 -- only the (a) owner call ever inserted one, all 4 non-owner attempts inserted zero'
);

-- (c) A Free/Test-tier gym''s call succeeds with amount = 0 -- not rejected.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009608","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009513","app_role":"owner"}',
  true
);

create temp table sbp_3 as select initiate_saas_billing_payment() as id;

reset role;

select is(
  (select amount from saas_billing_payments where id = (select id from sbp_3)),
  0,
  'a Free/Test-tier gym''s owner gets a real processing row at amount = 0, not rejected'
);

select is(
  (select status::text from saas_billing_payments where id = (select id from sbp_3)),
  'processing',
  'the Free/Test-tier gym''s 0-amount row still starts in processing status'
);

-- (d) Cross-gym isolation: Gym 2''s owner is priced from Gym 2''s own tier
-- (15000), never Gym 1''s (8000), even though both fixtures exist.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009607","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009512","app_role":"owner"}',
  true
);

create temp table sbp_2 as select initiate_saas_billing_payment() as id;

reset role;

select is(
  (select gym_id from saas_billing_payments where id = (select id from sbp_2)),
  '00000000-0000-0000-0000-000000009512'::uuid,
  'Gym 2''s owner''s payment is recorded against Gym 2, not Gym 1'
);

select is(
  (select amount from saas_billing_payments where id = (select id from sbp_2)),
  15000,
  'Gym 2''s owner is priced from Gym 2''s own tier, not Gym 1''s'
);

-- ============================================================================
-- update_own_owner_notification_email()
-- ============================================================================

-- (e) An owner caller updates only their own row''s email; no other column
-- changes.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009601","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"owner"}',
  true
);
select lives_ok(
  $$select update_own_owner_notification_email('owner1@example.com')$$,
  'an owner caller can set their own notification email'
);
reset role;

select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009701'),
  'owner1@example.com',
  'the owner''s own row''s email is updated'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000009701'),
  'Reminders Gym 1 Owner',
  'no other column on the owner''s own row was touched'
);

-- (f) A non-owner role is rejected; no row is touched.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009603","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"manager"}',
  true
);
select throws_like(
  $$select update_own_owner_notification_email('manager@example.com')$$,
  '%permission denied%',
  'a manager-claim session cannot call update_own_owner_notification_email()'
);
reset role;

select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009703'),
  null,
  'the rejected manager''s own row''s email was never touched'
);

-- (g) Cross-member, same-gym isolation: the caller''s own row is touched,
-- never a second owner-role member in the same gym.
select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009702'),
  null,
  'a second owner-role member in the same gym is untouched by the first owner''s call'
);

-- (h) Cross-gym isolation: Gym 2''s owner calling does not touch Gym 1''s
-- owner row.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009607","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009512","app_role":"owner"}',
  true
);
select lives_ok(
  $$select update_own_owner_notification_email('owner2@example.com')$$,
  'Gym 2''s owner can independently set their own notification email'
);
reset role;

select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009701'),
  'owner1@example.com',
  'Gym 2''s owner''s call did not touch Gym 1''s owner row'
);

-- (i) An empty-string input clears the field back to null.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009601","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"owner"}',
  true
);
select lives_ok(
  $$select update_own_owner_notification_email('')$$,
  'an owner can clear their own notification email by submitting an empty string'
);
reset role;

select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009701'),
  null,
  'the owner''s email is cleared back to null'
);

-- (j) app.owner_notification_email_update_bypass (the GUC
-- update_own_owner_notification_email() sets internally) is narrowly scoped
-- to exactly `email` -- proven directly against the trigger via a raw
-- UPDATE (not the RPC, which never touches role/phone itself) mirroring the
-- gyms-table bypass-scope proof pattern below.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009601","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009511","app_role":"owner"}',
  true
);
select set_config('app.owner_notification_email_update_bypass', 'true', true);

with updated as (
  update members
  set email = 'bypass-scope-proof@example.com', role = 'manager', phone = '+10000000000'
  where id = '00000000-0000-0000-0000-000000009701'
  returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'a self-update session''s UPDATE with the email bypass GUC set is still matched (row-level policy allows the write)'
);

select is(
  (select email from members where id = '00000000-0000-0000-0000-000000009701'),
  'bypass-scope-proof@example.com',
  'with the bypass GUC set, email DOES go through for a self-update session'
);

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000009701'),
  'owner',
  'role is still pinned back even with the email bypass GUC set -- the bypass does not extend to it'
);

select is(
  (select phone from members where id = '00000000-0000-0000-0000-000000009701'),
  null,
  'phone is still pinned back even with the email bypass GUC set -- the bypass does not extend to it'
);

select set_config('app.owner_notification_email_update_bypass', 'false', true);
reset role;

-- ============================================================================
-- complete_verified_saas_billing_payment(): reset side effect
-- ============================================================================

insert into saas_billing_payments (id, gym_id, amount, currency, status, provider) values
  ('00000000-0000-0000-0000-000000009801', '00000000-0000-0000-0000-000000009515', 8000, 'XAF', 'processing', 'taramoney'), -- Gym 5: suspended, monthly
  ('00000000-0000-0000-0000-000000009802', '00000000-0000-0000-0000-000000009514', 8000, 'XAF', 'processing', 'taramoney'), -- Gym 4: deactivated
  ('00000000-0000-0000-0000-000000009803', '00000000-0000-0000-0000-000000009516', 80000, 'XAF', 'processing', 'taramoney'); -- Gym 6: past_due, annual

-- (j) Gym 5 (suspended, monthly): a verified payment resets
-- saas_billing_status -> active, status -> active (it was suspended), and
-- advances saas_billing_anchor_date by exactly one month from its own prior
-- value.
set local role service_role;
select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009801'::uuid, 200);
reset role;

select is(
  (select status::text from saas_billing_payments where id = '00000000-0000-0000-0000-000000009801'),
  'verified',
  'Gym 5''s payment transitions to verified'
);

select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000009515'),
  'active',
  'Gym 5''s saas_billing_status resets to active on a verified payment'
);

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-000000009515'),
  'active',
  'Gym 5''s status resets from suspended to active on a verified payment'
);

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009515'),
  (current_date - 10 + interval '1 month')::date,
  'Gym 5''s saas_billing_anchor_date advances by exactly one month from its own prior value, not from current_date'
);

-- (k) Gym 4 (deactivated): a verified payment still transitions the payment
-- row, but never touches the gym''s status/saas_billing_status/anchor_date
-- -- a Super Admin''s manual deactivation is a distinct action this
-- billing-completion reset must not silently overwrite.
set local role service_role;
select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009802'::uuid, 150);
reset role;

select is(
  (select status::text from saas_billing_payments where id = '00000000-0000-0000-0000-000000009802'),
  'verified',
  'Gym 4''s payment still transitions to verified even though the gym itself is deactivated'
);

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-000000009514'),
  'deactivated',
  'Gym 4''s status is never touched by the reset -- still deactivated'
);

select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000009514'),
  'suspended',
  'Gym 4''s saas_billing_status is never touched by the reset -- unchanged from its prior value'
);

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009514'),
  (current_date - 20)::date,
  'Gym 4''s saas_billing_anchor_date is never touched by the reset -- unchanged'
);

-- (l) Gym 6 (past_due, annual): a verified payment advances the anchor by
-- exactly one year (not one month) -- the interval branch is read live from
-- the gym''s own saas_billing_interval.
set local role service_role;
select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009803'::uuid, 300);
reset role;

select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000009516'),
  'active',
  'Gym 6''s saas_billing_status resets to active on a verified payment'
);

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009516'),
  (current_date - 3 + interval '1 year')::date,
  'Gym 6''s saas_billing_anchor_date advances by exactly one year (its own saas_billing_interval), not one month'
);

-- (m) Replaying the same already-verified webhook (a second call with the
-- same payment id) does not re-advance the anchor date a second time.
set local role service_role;
select lives_ok(
  $$ select complete_verified_saas_billing_payment('00000000-0000-0000-0000-000000009803'::uuid, 300) $$,
  'a replayed call on an already-verified payment is a safe no-op, not an exception'
);
reset role;

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009516'),
  (current_date - 3 + interval '1 year')::date,
  'Gym 6''s saas_billing_anchor_date is unchanged by the replayed call -- not advanced a second time'
);

-- ============================================================================
-- app.saas_billing_payment_reset_bypass: narrowly scoped to exactly
-- status/saas_billing_status/saas_billing_anchor_date (mirrors
-- saas_subscription_lifecycle.test.sql's 4-assertion proof pattern for its
-- own sibling bypass GUC).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009609","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009517","app_role":"owner"}',
  true
);

select set_config('app.saas_billing_payment_reset_bypass', 'true', true);

with updated as (
  update gyms
  set status = 'suspended',
      saas_billing_status = 'suspended',
      saas_billing_anchor_date = current_date - 1,
      tier_id = '00000000-0000-0000-0000-000000009502',
      saas_billing_interval = 'annual',
      saas_grace_period_days = 1
  where id = '00000000-0000-0000-0000-000000009517'
  returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'an owner-claim session''s UPDATE with the payment-reset bypass GUC set is still matched (row-level policy allows the write)'
);

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-000000009517'),
  'suspended',
  'with the bypass GUC set, status DOES go through for a non-super_admin session'
);

select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000009517'),
  'suspended',
  'with the bypass GUC set, saas_billing_status DOES go through'
);

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009517'),
  (current_date - 1)::date,
  'with the bypass GUC set, saas_billing_anchor_date DOES go through -- the one column the lifecycle-job''s own bypass does not exempt'
);

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000009517'),
  '00000000-0000-0000-0000-000000009501'::uuid,
  'tier_id is still pinned back even with the payment-reset bypass GUC set -- the bypass does not extend to it'
);

select is(
  (select saas_billing_interval::text from gyms where id = '00000000-0000-0000-0000-000000009517'),
  'monthly',
  'saas_billing_interval is still pinned back even with the payment-reset bypass GUC set'
);

select is(
  (select saas_grace_period_days from gyms where id = '00000000-0000-0000-0000-000000009517'),
  7,
  'saas_grace_period_days is still pinned back even with the payment-reset bypass GUC set'
);

select set_config('app.saas_billing_payment_reset_bypass', 'false', true);
reset role;

-- ============================================================================
-- saas_billing_notices: dedup unique index.
-- ============================================================================
insert into saas_billing_notices (gym_id, notice_day_offset, billing_anchor_date_at_notice, sms_status, whatsapp_status, email_status) values
  ('00000000-0000-0000-0000-000000009511', 0, current_date, 'sent', 'sent', 'skipped_no_email_on_file');

select throws_like(
  $$ insert into saas_billing_notices (gym_id, notice_day_offset, billing_anchor_date_at_notice, sms_status, whatsapp_status, email_status)
     values ('00000000-0000-0000-0000-000000009511', 0, current_date, 'sent', 'failed', 'skipped_no_email_on_file') $$,
  '%idx_saas_billing_notices_dedup%',
  'a duplicate (gym_id, billing_anchor_date_at_notice, notice_day_offset) insert is rejected by the unique index'
);

-- ============================================================================
-- saas_billing_payments_amount_nonneg CHECK constraint.
-- ============================================================================
select throws_like(
  $$ insert into saas_billing_payments (gym_id, amount, currency, status, provider)
     values ('00000000-0000-0000-0000-000000009511', -100, 'XAF', 'processing', 'taramoney') $$,
  '%saas_billing_payments_amount_nonneg%',
  'a negative amount is rejected by the CHECK constraint'
);

select throws_like(
  $$ insert into saas_billing_payments (gym_id, amount, currency, status, provider, provider_fee_amount)
     values ('00000000-0000-0000-0000-000000009511', 8000, 'XAF', 'verified', 'taramoney', -50) $$,
  '%saas_billing_payments_amount_nonneg%',
  'a negative provider_fee_amount is rejected by the CHECK constraint'
);

select * from finish();
rollback;
