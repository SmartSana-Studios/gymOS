-- Story 11.5: Super Admin Billing View. Covers migration 0075's two new
-- SECURITY DEFINER RPCs: record_out_of_band_saas_billing_payment() and
-- apply_saas_billing_credit(). Session-simulation conventions match
-- saas_billing_reminders_one_tap_pay.test.sql / tenant_suspension_enforcement.test.sql
-- (`set local role authenticated` + `set_config('request.jwt.claims', ...)`).

begin;
select plan(28);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-0000000a5001', 'Billing View Test Tier A (monthly)', 8000, 80000, 40),
  ('00000000-0000-0000-0000-0000000a5002', 'Billing View Test Tier B (pricier)', 15000, 150000, 40);

insert into gyms (id, name, tier_id, status, saas_billing_status, saas_billing_interval, saas_billing_anchor_date, capacity) values
  ('00000000-0000-0000-0000-0000000a5011', 'Billing View Gym 1 (suspended, monthly)', '00000000-0000-0000-0000-0000000a5001', 'suspended', 'suspended', 'monthly', current_date - 40, 30),
  ('00000000-0000-0000-0000-0000000a5012', 'Billing View Gym 2 (deactivated)', '00000000-0000-0000-0000-0000000a5001', 'deactivated', 'suspended', 'monthly', current_date - 20, 30),
  ('00000000-0000-0000-0000-0000000a5013', 'Billing View Gym 3 (active, annual)', '00000000-0000-0000-0000-0000000a5002', 'active', 'past_due', 'annual', current_date - 5, 30),
  ('00000000-0000-0000-0000-0000000a5014', 'Billing View Gym 4 (suspended, for credit)', '00000000-0000-0000-0000-0000000a5001', 'suspended', 'suspended', 'monthly', current_date - 3, 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000a5601'), -- super_admin caller
  ('00000000-0000-0000-0000-0000000a5602'), -- Gym 1's owner (non-super-admin caller, permission tests)
  ('00000000-0000-0000-0000-0000000a5603'); -- Gym 1's member (reversal/"no refresh" proof)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-0000000a5701', '00000000-0000-0000-0000-0000000a5011', '00000000-0000-0000-0000-0000000a5602', 'owner', 'Billing View Gym 1 Owner'),
  ('00000000-0000-0000-0000-0000000a5702', '00000000-0000-0000-0000-0000000a5011', '00000000-0000-0000-0000-0000000a5603', 'member', 'Billing View Gym 1 Member');

-- ============================================================================
-- record_out_of_band_saas_billing_payment()
-- ============================================================================

-- Review fix: the "before" half of (e)'s reversal proof below -- without
-- this, (e) only proves the member session succeeds *after* the reset, not
-- that tenant_active_gate actually denied it *before*. Gym 1 starts
-- 'suspended' per the fixture above.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5603","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5011","app_role":"member"}',
  true
);
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-0000000a5702'),
  0,
  'pre-check: Gym 1''s own member session cannot see their own members row while the gym is still suspended (tenant_active_gate)'
);
reset role;

-- (a) A non-super-admin caller (the gym's own owner) is rejected; no row
-- inserted, gym unchanged.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5602","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5011","app_role":"owner"}',
  true
);
select throws_like(
  $$select * from record_out_of_band_saas_billing_payment('00000000-0000-0000-0000-0000000a5011'::uuid)$$,
  '%permission denied%',
  'a non-super-admin (owner) caller cannot call record_out_of_band_saas_billing_payment()'
);
reset role;
select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-0000000a5011'),
  0,
  'the rejected non-super-admin attempt inserted no row'
);

-- (b) A super_admin caller succeeds against Gym 1 (suspended, monthly,
-- anchor already 40 days in the past). Proves: amount is resolved live from
-- the gym's own tier (8000), the new row is status=verified/provider=null,
-- the anchor advances from its OWN current value (not current_date), and
-- the gym resets from suspended back to active.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
create temp table oob_1 as select * from record_out_of_band_saas_billing_payment('00000000-0000-0000-0000-0000000a5011'::uuid);
reset role;

select is((select amount from oob_1), 8000, 'record_out_of_band: amount is resolved live from the gym''s own tier (monthly_price)');
select is(
  (select new_anchor_date from oob_1),
  (current_date - 40 + interval '1 month')::date,
  'record_out_of_band: the new anchor advances one month from the gym''s OWN prior anchor, not from current_date'
);
select is(
  (select status::text from saas_billing_payments where id = (select id from oob_1)),
  'verified',
  'record_out_of_band: the new saas_billing_payments row is inserted already verified'
);
select is(
  (select provider from saas_billing_payments where id = (select id from oob_1)),
  null,
  'record_out_of_band: provider is null -- not a Tara Money-mediated payment'
);
select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-0000000a5011'),
  'active',
  'record_out_of_band: the gym''s saas_billing_status resets from suspended to active'
);
select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-0000000a5011'),
  'active',
  'record_out_of_band: the gym''s status resets from suspended to active'
);

-- (c) The anchor advance uses the ANNUAL interval branch when the gym's own
-- saas_billing_interval is annual, priced from its own (pricier) tier.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
create temp table oob_2 as select * from record_out_of_band_saas_billing_payment('00000000-0000-0000-0000-0000000a5013'::uuid);
reset role;

select is((select amount from oob_2), 150000, 'record_out_of_band: an annual-interval gym is priced from its own tier''s annual_price');
select is(
  (select new_anchor_date from oob_2),
  (current_date - 5 + interval '1 year')::date,
  'record_out_of_band: an annual-interval gym''s anchor advances by one year, not one month'
);

-- (d) A deactivated gym is rejected with an exception -- not a silent no-op
-- -- and no payment row is inserted, gym left untouched.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
select throws_like(
  $$select * from record_out_of_band_saas_billing_payment('00000000-0000-0000-0000-0000000a5012'::uuid)$$,
  '%is deactivated%',
  'record_out_of_band_saas_billing_payment() rejects a deactivated gym with an exception'
);
reset role;
select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-0000000a5012'),
  0,
  'the rejected deactivated-gym attempt inserted no row'
);
select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-0000000a5012'),
  'deactivated',
  'the rejected deactivated-gym attempt left the gym''s status untouched'
);

-- (e) Reversal proof mirroring tenant_suspension_enforcement.test.sql's own
-- "no refresh required" pattern: Gym 1's member session, previously denied
-- by tenant_active_gate while the gym was suspended, immediately succeeds on
-- the very next statement after (b)'s reset to active -- no reconnect, no
-- token refresh.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5603","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5011","app_role":"member"}',
  true
);
select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-0000000a5702'),
  1,
  'reversal: Gym 1''s own member session now sees their own members row immediately after record_out_of_band_saas_billing_payment() -- no reconnect required'
);

-- ============================================================================
-- apply_saas_billing_credit()
-- ============================================================================

-- Review fix: the "before" half of (j)'s reversal proof below -- Gym 4 has
-- no member fixture, so this re-derives the "before" proof via
-- private.current_gym_status() directly (same technique (j) already uses
-- for the "after" half), rather than a members-table read.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5014","app_role":"member"}',
  true
);
select isnt(
  (select private.current_gym_status()::text),
  'active',
  'pre-check: private.current_gym_status() does not read active for Gym 4 while still suspended'
);
reset role;

-- (f) A non-super-admin caller is rejected; gym unchanged.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5602","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5011","app_role":"owner"}',
  true
);
select throws_like(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, 30)$$,
  '%permission denied%',
  'a non-super-admin (owner) caller cannot call apply_saas_billing_credit()'
);
reset role;
select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-0000000a5014'),
  'suspended',
  'the rejected non-super-admin attempt left the gym untouched'
);

-- (g) A super_admin caller succeeds against Gym 4 (suspended, anchor 3 days
-- in the past): the anchor advances by exactly p_days from its own current
-- value, and the gym resets from suspended back to active.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
create temp table credit_1 as select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, 30);
reset role;

select is(
  (select new_anchor_date from credit_1),
  (current_date - 3 + interval '30 days')::date,
  'apply_saas_billing_credit: the anchor advances by exactly p_days from the gym''s own prior anchor'
);
select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-0000000a5014'),
  'active',
  'apply_saas_billing_credit: the gym''s saas_billing_status resets from suspended to active'
);
select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-0000000a5014'),
  'active',
  'apply_saas_billing_credit: the gym''s status resets from suspended to active'
);

-- (h) p_days <= 0 is rejected by the RPC's own validation.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
select throws_like(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, 0)$$,
  '%p_days must be positive%',
  'apply_saas_billing_credit() rejects a non-positive p_days'
);
select throws_like(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, -5)$$,
  '%p_days must be positive%',
  'apply_saas_billing_credit() rejects a negative p_days'
);
-- Review fix: 90 days (one quarter) is the ceiling a Super Admin can grant.
select throws_like(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, 91)$$,
  '%p_days must not exceed 90%',
  'apply_saas_billing_credit() rejects a p_days greater than 90'
);
select lives_ok(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5014'::uuid, 90)$$,
  'apply_saas_billing_credit() accepts p_days exactly at the 90-day ceiling'
);
reset role;

-- (i) A deactivated gym is rejected with an exception; gym left untouched.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","app_role":"super_admin"}',
  true
);
select throws_like(
  $$select * from apply_saas_billing_credit('00000000-0000-0000-0000-0000000a5012'::uuid, 30)$$,
  '%is deactivated%',
  'apply_saas_billing_credit() rejects a deactivated gym with an exception'
);
reset role;
select is(
  (select status::text from gyms where id = '00000000-0000-0000-0000-0000000a5012'),
  'deactivated',
  'the rejected deactivated-gym credit attempt left the gym untouched'
);

-- (j) Reversal proof for apply_saas_billing_credit(), mirroring (e) above --
-- Gym 4 has no member fixture, so this re-derives the same proof via
-- private.current_gym_status() directly (the same helper tenant_active_gate
-- reads) rather than a members-table read.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000a5601","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000a5014","app_role":"member"}',
  true
);
select is(
  (select private.current_gym_status()::text),
  'active',
  'reversal: private.current_gym_status() (the tenant_active_gate helper) reads active for Gym 4 immediately after apply_saas_billing_credit() -- no reconnect required'
);

select * from finish();
rollback;
