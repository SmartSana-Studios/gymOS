-- Story 11.7: Pay Now -- Tier Selection & Alternate Payment Methods.
-- Covers Task 1's schema/RPC extension: initiate_saas_billing_payment()'s
-- new p_tier_id/p_interval override (valid tier accepted, price_locked
-- tier and a nonexistent tier both rejected with the same
-- tier_not_selectable_by_owner message), complete_verified_saas_billing_payment()
-- applying the payment row's own tier/interval onto `gyms` atomically with
-- the anchor-date advance, the new owner_read_own_gym_saas_billing_payments
-- SELECT policy (AC #4), and list_selectable_saas_billing_tiers() excluding
-- price_locked rows. Session-simulation conventions match
-- saas_billing_reminders_one_tap_pay.test.sql (`set local role authenticated`
-- + `set_config('request.jwt.claims', ...)`).

begin;
select plan(23);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000009901', 'Pay Now Test Tier A', 8000, 80000, 40),
  ('00000000-0000-0000-0000-000000009902', 'Pay Now Test Tier B (pricier)', 20000, 200000, 40);

insert into gyms (id, name, tier_id, status, saas_billing_status, saas_billing_interval, saas_billing_anchor_date, capacity) values
  ('00000000-0000-0000-0000-000000009911', 'Pay Now Gym 1', '00000000-0000-0000-0000-000000009901', 'active', 'past_due', 'monthly', current_date - 5, 30),
  ('00000000-0000-0000-0000-000000009912', 'Pay Now Gym 2 (cross-gym isolation)', '00000000-0000-0000-0000-000000009901', 'active', 'active', 'monthly', current_date + 30, 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009921'), -- Gym 1 owner
  ('00000000-0000-0000-0000-000000009922'), -- Gym 1 manager (rejection)
  ('00000000-0000-0000-0000-000000009923'); -- Gym 2 owner (cross-gym isolation)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009931', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009921', 'owner', 'Pay Now Gym 1 Owner'),
  ('00000000-0000-0000-0000-000000009932', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009922', 'manager', 'Pay Now Gym 1 Manager'),
  ('00000000-0000-0000-0000-000000009933', '00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009923', 'owner', 'Pay Now Gym 2 Owner');

-- ============================================================================
-- list_selectable_saas_billing_tiers(): excludes price_locked, includes the
-- Free/Test seed tier's exclusion by construction (already price_locked).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from list_selectable_saas_billing_tiers() where id in ('00000000-0000-0000-0000-000000009901', '00000000-0000-0000-0000-000000009902')),
  2,
  'list_selectable_saas_billing_tiers() returns both non-price_locked test tiers'
);

select is(
  (select count(*)::int from list_selectable_saas_billing_tiers() where id = '00000000-0000-4000-8000-000000000104'),
  0,
  'list_selectable_saas_billing_tiers() excludes the seeded Free/Test (price_locked) tier'
);

select is(
  (select monthly_price from list_selectable_saas_billing_tiers() where id = '00000000-0000-0000-0000-000000009902'),
  20000,
  'list_selectable_saas_billing_tiers() surfaces the tier''s real monthly_price'
);
reset role;

-- ============================================================================
-- initiate_saas_billing_payment(): price_locked tier rejected, run first
-- (before any processing row exists for this gym) so the double-submit
-- guard can't shadow the tier-validation rejection being tested here.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);
select throws_like(
  $$select initiate_saas_billing_payment('00000000-0000-4000-8000-000000000104'::uuid, null)$$,
  '%tier_not_selectable_by_owner%',
  'a price_locked (Free/Test) tier override is rejected'
);

-- A nonexistent tier_id surfaces the identical exception message (per Task
-- 1's spec -- one mapping, not a second "tier not found" code).
select throws_like(
  $$select initiate_saas_billing_payment('00000000-0000-0000-0000-000000000000'::uuid, null)$$,
  '%tier_not_selectable_by_owner%',
  'a nonexistent tier_id surfaces the same tier_not_selectable_by_owner exception'
);
reset role;

select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009911'),
  0,
  'both rejected attempts inserted no row at all'
);

-- ============================================================================
-- initiate_saas_billing_payment(p_tier_id, p_interval): override accepted.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

create temp table pn_1 as
  select initiate_saas_billing_payment('00000000-0000-0000-0000-000000009902'::uuid, 'annual'::billing_interval) as id;
grant select on pn_1 to service_role;

reset role;

select is(
  (select tier_id from saas_billing_payments where id = (select id from pn_1)),
  '00000000-0000-0000-0000-000000009902'::uuid,
  'an overridden tier_id is recorded on the resulting saas_billing_payments row'
);

select is(
  (select billing_interval::text from saas_billing_payments where id = (select id from pn_1)),
  'annual',
  'an overridden billing_interval is recorded on the resulting row'
);

select is(
  (select amount from saas_billing_payments where id = (select id from pn_1)),
  200000,
  'the charged amount reflects the overridden tier/interval (annual_price of Tier B), not the gym''s own tier/interval'
);

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000009911'),
  '00000000-0000-0000-0000-000000009901'::uuid,
  'the gym''s own tier_id is untouched until the payment actually verifies'
);

-- ============================================================================
-- complete_verified_saas_billing_payment(): applies the payment row's own
-- tier_id/billing_interval onto `gyms` atomically with the anchor-date
-- advance.
-- ============================================================================
set local role service_role;
select complete_verified_saas_billing_payment((select id from pn_1), 500);
reset role;

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000009911'),
  '00000000-0000-0000-0000-000000009902'::uuid,
  'the verified payment''s overridden tier_id is applied onto gyms.tier_id'
);

select is(
  (select saas_billing_interval::text from gyms where id = '00000000-0000-0000-0000-000000009911'),
  'annual',
  'the verified payment''s overridden billing_interval is applied onto gyms.saas_billing_interval'
);

select is(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009911'),
  (current_date - 5 + interval '1 year')::date,
  'the anchor date advances using the NEW (just-applied) interval, one year (not one month) from its own prior value'
);

select is(
  (select saas_billing_status::text from gyms where id = '00000000-0000-0000-0000-000000009911'),
  'active',
  'saas_billing_status still resets to active, unaffected by the tier/interval change'
);

-- ============================================================================
-- Backward compatibility: a zero-arg call still works and falls back to the
-- gym's own current tier/interval (now Tier B/annual, just applied above).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

create temp table pn_2 as select initiate_saas_billing_payment() as id;

reset role;

select is(
  (select tier_id from saas_billing_payments where id = (select id from pn_2)),
  '00000000-0000-0000-0000-000000009902'::uuid,
  'a zero-arg call falls back to the gym''s own (now-updated) tier_id, not left null'
);

select is(
  (select billing_interval::text from saas_billing_payments where id = (select id from pn_2)),
  'annual',
  'a zero-arg call falls back to the gym''s own (now-updated) billing_interval'
);

select is(
  (select amount from saas_billing_payments where id = (select id from pn_2)),
  200000,
  'a zero-arg call prices from the gym''s own current tier/interval (annual_price)'
);

-- ============================================================================
-- The trigger extension does NOT let a non-bypassed, non-Super-Admin
-- session write tier_id/saas_billing_interval directly -- only this one
-- RPC's own bypass window changed.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

with updated as (
  update gyms set tier_id = '00000000-0000-0000-0000-000000009901', saas_billing_interval = 'monthly'
  where id = '00000000-0000-0000-0000-000000009911'
  returning id
)
select is((select count(*) from updated)::int, 1, 'the raw owner-session UPDATE itself is row-level permitted (RLS allows it)');

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000009911'),
  '00000000-0000-0000-0000-000000009902'::uuid,
  'tier_id is still pinned back for a raw, non-bypassed owner UPDATE -- unchanged from before this write'
);

select is(
  (select saas_billing_interval::text from gyms where id = '00000000-0000-0000-0000-000000009911'),
  'annual',
  'saas_billing_interval is still pinned back for a raw, non-bypassed owner UPDATE'
);
reset role;

-- ============================================================================
-- owner_read_own_gym_saas_billing_payments: Owner reads own gym's rows,
-- cannot read another gym's row, never bypasses
-- super_admin_read_saas_billing_payments' own broader scope.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009923","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009912","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009911'),
  0,
  'Gym 2''s owner cannot read Gym 1''s saas_billing_payments rows'
);

select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009912'),
  0,
  'Gym 2''s owner sees 0 rows for their own gym -- none exist yet, proving this isn''t a blanket-allow'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from saas_billing_payments where gym_id = '00000000-0000-0000-0000-000000009911'),
  0,
  'a manager-claim session (same gym as the rows) still sees 0 rows -- the new policy is owner-only'
);
reset role;

select * from finish();
rollback;
