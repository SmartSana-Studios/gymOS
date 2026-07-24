-- Story 3.2: Manual Renewal Reset. Tests `renew_subscription()`
-- (0022_manual_renewal_reset.sql) -- a SECURITY DEFINER RPC, not a raw
-- RLS-policy-gated INSERT, so most assertions call the function directly
-- under a simulated session rather than asserting on INSERT/UPDATE
-- statements themselves. Session-simulation conventions match
-- member_management_rls.test.sql (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role). Table-state assertions after each call use
-- `reset role` first (audit_log has no SELECT policy for gym staff, only
-- Super Admin's `super_admin_read_audit_log`, 0012 -- the connecting/
-- superuser role bypasses RLS entirely to inspect real committed state,
-- same convention as member_management_rls.test.sql's own closing checks).

begin;
select plan(21);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000008001', 'Manual Renewal Test Tier', 5000, 50000, 10);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000008011', 'Manual Renewal Gym A', '00000000-0000-0000-0000-000000008001', 30),
  ('00000000-0000-0000-0000-000000008012', 'Manual Renewal Gym B', '00000000-0000-0000-0000-000000008001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000008021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000008022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000008023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000008024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000008025'), -- Gym B owner
  ('00000000-0000-0000-0000-000000008026'), -- Gym A member-role session (own account)
  ('00000000-0000-0000-0000-000000008027'), -- Grace Member's user
  ('00000000-0000-0000-0000-000000008028'), -- Pay-Per-Session Member's user
  ('00000000-0000-0000-0000-000000008029'), -- Deactivated Member's user
  ('00000000-0000-0000-0000-000000008030'); -- No-Subscription Member's user

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000008041', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', 'owner', 'Manual Renewal Gym A Owner'),
  ('00000000-0000-0000-0000-000000008042', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008022', 'manager', 'Manual Renewal Gym A Manager'),
  ('00000000-0000-0000-0000-000000008043', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008023', 'receptionist', 'Manual Renewal Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000008044', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008024', 'coach', 'Manual Renewal Gym A Coach'),
  ('00000000-0000-0000-0000-000000008045', '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008025', 'owner', 'Manual Renewal Gym B Owner'),
  ('00000000-0000-0000-0000-000000008046', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008026', 'member', 'Manual Renewal Gym A Member Session'),
  ('00000000-0000-0000-0000-000000008051', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008027', 'member', 'Grace Member'),
  ('00000000-0000-0000-0000-000000008052', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008028', 'member', 'Pay Per Session Member'),
  ('00000000-0000-0000-0000-000000008053', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008029', 'member', 'Deactivated Member'),
  ('00000000-0000-0000-0000-000000008054', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008030', 'member', 'No Subscription Member');

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000008053';

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000008061', '00000000-0000-0000-0000-000000008011', 'Manual Renewal Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000008062', '00000000-0000-0000-0000-000000008011', 'Manual Renewal Pay Per Session', 'pay_per_session', 3000, 'monthly', null);

-- Grace Member: existing grace_period subscription on the monthly plan.
-- created_at is explicitly backdated: `now()` is frozen for the entire
-- transaction in Postgres (all statements in this one pgTAP
-- begin...rollback see the same transaction timestamp), so a fixture row
-- and a row inserted later by renew_subscription() would otherwise tie on
-- created_at, making the "most recent subscription" `order by created_at
-- desc limit 1` pattern (Scope Note #3) resolve ambiguously within this
-- test. In real usage each renewal is its own transaction, so this is a
-- test-only concern, not a production one.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000008071', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008051', '00000000-0000-0000-0000-000000008061', 'grace_period', current_date - 40, current_date - 10, now() - interval '1 day');

-- Pay Per Session Member: existing expired pay-per-session subscription (no expiry_date).
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000008072', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008052', '00000000-0000-0000-0000-000000008062', 'expired', current_date - 5, null, now() - interval '1 day');

-- Deactivated Member: existing expired subscription on the monthly plan.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000008073', '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008053', '00000000-0000-0000-0000-000000008061', 'expired', current_date - 40, current_date - 10, now() - interval '1 day');

-- No Subscription Member: deliberately zero subscription rows -- bypasses
-- the app's own always-creates-one-subscription invariant on purpose, to
-- exercise renew_subscription()'s own defensive guard.

-- ============================================================================
-- (a) An owner-claim session can renew Grace Member -- full field-level
-- verification of the insert-only design (Scope Note #3).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Cash payment collected at front desk')$$,
  'an owner-claim session can renew Grace Member'
);

reset role;

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000008051'),
  2,
  'Grace Member now has 2 subscription rows -- the renewal inserted a new one rather than mutating the old (Scope Note #3)'
);

select is(
  (select status::text from subscriptions where member_id = '00000000-0000-0000-0000-000000008051' order by created_at desc limit 1),
  'active',
  'the new (most recent) subscription row is active'
);

select is(
  (select start_date from subscriptions where member_id = '00000000-0000-0000-0000-000000008051' order by created_at desc limit 1),
  current_date,
  'the new row''s start_date is today'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000008051' order by created_at desc limit 1),
  current_date + 30,
  'the new row''s expiry_date is today + the plan''s duration_days (30)'
);

select is(
  (select status::text from subscriptions where id = '00000000-0000-0000-0000-000000008071'),
  'grace_period',
  'the prior subscription row is untouched -- still grace_period, history preserved'
);

select is(
  (select plan_id from subscriptions where member_id = '00000000-0000-0000-0000-000000008051' order by created_at desc limit 1),
  '00000000-0000-0000-0000-000000008061',
  'the renewal reuses the same plan_id as the member''s prior subscription'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'subscription_manual_renewal'
     and target_entity_id = '00000000-0000-0000-0000-000000008051'
     and metadata->>'reason' = 'Cash payment collected at front desk'),
  1,
  'an audit_log row was written with the exact reason supplied'
);

-- ============================================================================
-- (b) A manager-claim session can also renew Grace Member -- and renewing an
-- already-active member is explicitly allowed (Dev Notes), not rejected.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"manager"}',
  true
);

select lives_ok(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Manager override renewal')$$,
  'a manager-claim session can renew Grace Member again, even though it is already active'
);

-- ============================================================================
-- (c) A receptionist-claim session can renew too -- this story's actual new
-- capability (the existing subscriptions INSERT RLS policy is manager/owner
-- only; this function's own self-check is what grants receptionist access).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Receptionist collected mobile money payment')$$,
  'a receptionist-claim session can renew Grace Member -- new capability this story grants'
);

reset role;
select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000008051'),
  4,
  'Grace Member has 4 subscription rows after 3 renewals (1 original + 3 renewals)'
);

-- ============================================================================
-- (d) A coach-claim session is denied.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"coach"}',
  true
);

select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Coach attempted renewal')$$,
  '%permission denied%',
  'a coach-claim session cannot call renew_subscription()'
);

-- ============================================================================
-- (e) A member-claim session (an ordinary member's own login) is denied.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"member"}',
  true
);

select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Member attempted self-renewal')$$,
  '%permission denied%',
  'a member-claim session cannot call renew_subscription()'
);

-- ============================================================================
-- (f) Cross-tenant: a Gym B owner-claim session cannot renew a Gym A member,
-- even though owner is otherwise a write-capable role.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008012","app_role":"owner"}',
  true
);

select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', 'Cross-tenant renewal attempt')$$,
  '%not found%',
  'a Gym B owner-claim session cannot renew Gym A''s Grace Member -- gym-scoped lookup reports not-found, not permission-denied, to avoid cross-tenant member-existence enumeration'
);

-- ============================================================================
-- (g) A pay-per-session member's renewal produces a null expiry_date --
-- proves 0022 composes correctly with 0018's
-- enforce_subscription_expiry_matches_plan_type trigger.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select renew_subscription('00000000-0000-0000-0000-000000008052', 'Pay-per-session top-up')$$,
  'an owner-claim session can renew Pay Per Session Member'
);

reset role;
select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000008052' order by created_at desc limit 1),
  null,
  'the new subscription row for a pay-per-session plan has a null expiry_date'
);

-- ============================================================================
-- (h) Empty / whitespace-only reason is rejected -- the DB-level backstop,
-- called directly (not through the TS Zod layer) to prove it works
-- independently.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000008021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000008011","app_role":"owner"}',
  true
);

select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', '')$$,
  '%reason is required%',
  'an empty reason is rejected'
);

select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008051', '   ')$$,
  '%reason is required%',
  'a whitespace-only reason is rejected'
);

-- ============================================================================
-- (i) A deactivated member cannot be renewed.
-- ============================================================================
select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008053', 'Attempted renewal of deactivated member')$$,
  '%is deactivated and cannot be renewed%',
  'a deactivated member cannot be renewed'
);

-- ============================================================================
-- (j) A member with zero subscription rows cannot be renewed.
-- ============================================================================
select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000008054', 'Attempted renewal with no prior subscription')$$,
  '%has no existing subscription to renew%',
  'a member with no existing subscription cannot be renewed'
);

-- ============================================================================
-- (k) A nonexistent member_id is rejected.
-- ============================================================================
select throws_like(
  $$select renew_subscription('00000000-0000-0000-0000-000000009999', 'Nonexistent member')$$,
  '%not found%',
  'a nonexistent member_id is rejected'
);

select * from finish();
rollback;
