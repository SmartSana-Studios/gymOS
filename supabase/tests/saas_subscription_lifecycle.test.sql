-- Story 11.2: SaaS Subscription Lifecycle & Free/Test Tier. Covers Task 1's
-- schema shape: the four new `gyms` billing-lifecycle columns, the extended
-- protect_super_admin_only_gym_columns() trigger (mirrors
-- tiers_and_gym_lifecycle_rls.test.sql's exact assertion shape for the
-- pre-existing status/tier_id/member_cap_override pin-back), and the
-- Free/Test tier's price_locked CHECK constraint. run_saas_billing_lifecycle_job()'s
-- own transition behavior is covered separately in
-- saas_billing_lifecycle_job.test.sql (Task 2).

begin;
select plan(18);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values
  ('00000000-0000-0000-0000-000000009305', 'SaaS Lifecycle Test Tier', 5000, 50000, 30),
  ('00000000-0000-0000-0000-000000009307', 'Bypass Test Target Tier', 6000, 60000, 40);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000009411', 'SaaS Lifecycle Test Gym', '00000000-0000-0000-0000-000000009305', 'active', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009403'), -- super_admin caller
  ('00000000-0000-0000-0000-000000009404'); -- owner of the test gym

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009603', '00000000-0000-0000-0000-000000009411', '00000000-0000-0000-0000-000000009404', 'owner', 'SaaS Lifecycle Test Owner');

-- ============================================================================
-- (a) the four new gyms columns exist with correct defaults/types.
-- ============================================================================
select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'active',
  'saas_billing_status defaults to active'
);

select is(
  (select saas_billing_interval from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'monthly',
  'saas_billing_interval defaults to monthly'
);

select ok(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009411') > current_date,
  'saas_billing_anchor_date defaults to a future date (one month out)'
);

select is(
  (select saas_grace_period_days from gyms where id = '00000000-0000-0000-0000-000000009411')::int, 7,
  'saas_grace_period_days defaults to 7'
);

-- ============================================================================
-- (b) a non-super_admin session's UPDATE silently pins the new columns back,
-- mirroring the pre-existing status/tier_id/member_cap_override assertions.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009404","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009411","app_role":"owner"}',
  true
);

with updated as (
  update gyms
  set saas_billing_status = 'suspended',
      saas_billing_interval = 'annual',
      saas_billing_anchor_date = current_date,
      saas_grace_period_days = 1
  where id = '00000000-0000-0000-0000-000000009411'
  returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'an owner-claim session''s UPDATE attempting to change the new columns is still matched (row-level policy allows the write)'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'active',
  'the gym''s saas_billing_status is unchanged -- protect_super_admin_only_gym_columns pins it back for a non-super_admin session'
);

select is(
  (select saas_billing_interval from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'monthly',
  'the gym''s saas_billing_interval is unchanged -- pinned back'
);

select ok(
  (select saas_billing_anchor_date from gyms where id = '00000000-0000-0000-0000-000000009411') > current_date,
  'the gym''s saas_billing_anchor_date is unchanged -- pinned back'
);

select is(
  (select saas_grace_period_days from gyms where id = '00000000-0000-0000-0000-000000009411')::int, 7,
  'the gym''s saas_grace_period_days is unchanged -- pinned back'
);

-- ============================================================================
-- The bypass GUC (private.protect_super_admin_only_gym_columns()'s
-- app.saas_billing_lifecycle_job_bypass check) is narrow: it only lets
-- status/saas_billing_* through for a non-super_admin session --
-- tier_id/member_cap_override stay unconditionally pinned back even with
-- the GUC set, matching update_staff_role()'s own narrowed-bypass
-- precedent (0063_staff_edit_deactivation.sql code review fix). Still
-- running as the same owner-claim session as (b) above.
-- ============================================================================
select set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);

with updated as (
  update gyms
  set status = 'suspended', tier_id = '00000000-0000-0000-0000-000000009307', member_cap_override = 999
  where id = '00000000-0000-0000-0000-000000009411'
  returning id
)
select is(
  (select count(*) from updated)::int, 1,
  'an owner-claim session''s UPDATE with the bypass GUC set is still matched (row-level policy allows the write)'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'suspended',
  'with the bypass GUC set, status DOES go through for a non-super_admin session -- the exact mechanism run_saas_billing_lifecycle_job() relies on'
);

select is(
  (select tier_id from gyms where id = '00000000-0000-0000-0000-000000009411')::text, '00000000-0000-0000-0000-000000009305',
  'tier_id is still pinned back to its original value even with the bypass GUC set -- the bypass does not extend to it'
);

select is(
  (select member_cap_override from gyms where id = '00000000-0000-0000-0000-000000009411'), null,
  'member_cap_override is still pinned back to null even with the bypass GUC set -- the bypass does not extend to it'
);

select set_config('app.saas_billing_lifecycle_job_bypass', 'false', true);

-- ============================================================================
-- (c) a super_admin session's equivalent update succeeds.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009403","role":"authenticated","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$ update gyms set saas_billing_status = 'past_due', saas_billing_interval = 'annual', saas_grace_period_days = 14 where id = '00000000-0000-0000-0000-000000009411' $$,
  'super_admin can UPDATE the new saas billing columns'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009411')::text, 'past_due',
  'the super_admin update actually took effect'
);

-- ============================================================================
-- (d) the Free/Test tier row exists with price_locked = true, prices = 0.
-- ============================================================================
select is(
  (select price_locked from tiers where id = '00000000-0000-4000-8000-000000000104')::boolean, true,
  'the seeded Free/Test tier has price_locked = true'
);

select is(
  (select (monthly_price, annual_price) from tiers where id = '00000000-0000-4000-8000-000000000104')::text, '(0,0)',
  'the seeded Free/Test tier has monthly_price and annual_price both 0'
);

-- ============================================================================
-- (e) tiers_price_locked_implies_zero_price CHECK constraint rejects a
-- price edit on any price_locked row, super_admin or not.
-- ============================================================================
select throws_like(
  $$ update tiers set monthly_price = 100 where id = '00000000-0000-4000-8000-000000000104' $$,
  '%tiers_price_locked_implies_zero_price%',
  'a price edit on the price_locked Free/Test tier is rejected by the CHECK constraint, even for super_admin'
);

select * from finish();
rollback;
