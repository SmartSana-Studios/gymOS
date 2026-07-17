-- Story 2.3: Manager/Owner -- Create, Edit & Deactivate Members. New RLS
-- policies and triggers from 0018_member_management.sql --
-- gym_staff_read_own_members (gated to staff roles only, post-review --
-- see section (g) below for the member-session negative case),
-- manager_or_owner_{insert,update}_own_members on `members`;
-- gym_staff_read_own_subscriptions (staff-gated plus a self-access
-- exists-clause), manager_or_owner_{insert,update}_own_subscriptions on `subscriptions`;
-- the enforce_member_cap and enforce_subscription_expiry_matches_plan_type
-- triggers. Session-simulation conventions match
-- membership_plans_rls.test.sql: fixture rows seeded up front as the
-- connecting role, then `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)` per simulated session.
-- INSERT-denial checks use `throws_like` (a denied INSERT's WITH CHECK
-- failure always raises a real "row-level security" error -- it has no
-- existing-row USING clause to silently filter against, unlike UPDATE/
-- DELETE, which affect 0 rows with no error -- rls_tenant_isolation.test.sql's
-- own explicit comment on this distinction). Cross-tenant/cross-role UPDATE
-- denial checks use a CTE `returning` clause on the write itself.

begin;
select plan(25);

-- Gym A / Gym B: tier with room for ordinary CRUD tests (cap 10).
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000007001', 'Member Mgmt Test Tier', 5000, 50000, 10);

-- Gym C: tier with member_cap = 1, dedicated to the cap-trigger test below.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000007002', 'Member Mgmt Cap Test Tier', 5000, 50000, 1);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000007011', 'Member Mgmt Gym A', '00000000-0000-0000-0000-000000007001', 30),
  ('00000000-0000-0000-0000-000000007012', 'Member Mgmt Gym B', '00000000-0000-0000-0000-000000007001', 30),
  ('00000000-0000-0000-0000-000000007013', 'Member Mgmt Gym C (at cap)', '00000000-0000-0000-0000-000000007002', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000007021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000007022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000007023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000007024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000007025'), -- Gym B owner
  ('00000000-0000-0000-0000-000000007026'), -- Gym C owner
  ('00000000-0000-0000-0000-000000007027'), -- the "new member" account created mid-test
  ('00000000-0000-0000-0000-000000007029'); -- Gym C's at-cap member (role = 'member', the one that actually fills the cap)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000007031', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007021', 'owner', 'Member Mgmt Gym A Owner'),
  ('00000000-0000-0000-0000-000000007032', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007022', 'manager', 'Member Mgmt Gym A Manager'),
  ('00000000-0000-0000-0000-000000007033', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007023', 'receptionist', 'Member Mgmt Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000007034', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007024', 'coach', 'Member Mgmt Gym A Coach'),
  ('00000000-0000-0000-0000-000000007035', '00000000-0000-0000-0000-000000007012', '00000000-0000-0000-0000-000000007025', 'owner', 'Member Mgmt Gym B Owner'),
  ('00000000-0000-0000-0000-000000007036', '00000000-0000-0000-0000-000000007013', '00000000-0000-0000-0000-000000007026', 'owner', 'Member Mgmt Gym C Owner (at cap)'),
  -- role = 'member' -- enforce_member_cap only counts role = 'member' rows
  -- (Story 2.3 review: staff don't consume cap slots), so Gym C's cap = 1
  -- is only actually reached by this row, not by its own owner row above.
  ('00000000-0000-0000-0000-000000007037', '00000000-0000-0000-0000-000000007013', '00000000-0000-0000-0000-000000007029', 'member', 'Member Mgmt Gym C At-Cap Member');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000007041', '00000000-0000-0000-0000-000000007011', 'Member Mgmt Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000007042', '00000000-0000-0000-0000-000000007011', 'Member Mgmt Pay Per Session', 'pay_per_session', 3000, 'monthly', null);

-- ============================================================================
-- (a) Owner/manager sessions can INSERT/UPDATE their own gym's members and
-- subscriptions.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"owner"}',
  true
);

select lives_ok(
  $$insert into members (id, gym_id, user_id, role, name, phone, join_date)
    values ('00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007027', 'member', 'New Member', '+237600000001', current_date)$$,
  'an owner-claim session can INSERT a member into its own gym'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000007051'),
  'New Member',
  'the new member row is visible to the inserting session'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"manager"}',
  true
);

select lives_ok(
  $$update members set name = 'New Member Edited' where id = '00000000-0000-0000-0000-000000007051'$$,
  'a manager-claim session can UPDATE a member in its own gym'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000007051'),
  'New Member Edited',
  'the name UPDATE is reflected'
);

-- Code review fix: manager_or_owner_update_own_members' with check now pins
-- role = 'member', mirroring the INSERT policy -- a Manager/Owner session
-- must not be able to raw-UPDATE a member row's role into a staff role.
select throws_like(
  $$update members set role = 'owner' where id = '00000000-0000-0000-0000-000000007051'$$,
  '%row-level security%',
  'a manager-claim session cannot UPDATE a member''s role to ''owner'' (RLS-violation error)'
);

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000007051'),
  'member',
  'the role-escalation attempt did not change the row'
);

select lives_ok(
  $$insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date)
    values ('00000000-0000-0000-0000-000000007061', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007041', 'active', current_date, current_date + 30)$$,
  'a manager-claim session can INSERT a subscription for its own gym''s member'
);

select lives_ok(
  $$update subscriptions set status = 'expired' where id = '00000000-0000-0000-0000-000000007061'$$,
  'a manager-claim session can UPDATE its own gym''s subscription'
);

select is(
  (select status::text from subscriptions where id = '00000000-0000-0000-0000-000000007061'),
  'expired',
  'the subscription status UPDATE is reflected'
);

-- ============================================================================
-- (b) INSERT with role <> 'member' is rejected -- manager_or_owner_insert_
-- own_members' with check pins role = 'member' (mirrors
-- super_admin_insert_owner_member's role-pinning shape, 0010). A denied
-- INSERT raises a real RLS error (no existing row to silently filter).
-- ============================================================================
select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007027', 'manager', 'Sneaky Staff Row')$$,
  '%row-level security%',
  'a manager-claim session cannot INSERT a member with role <> ''member'' (RLS-violation error)'
);

-- ============================================================================
-- (c) Receptionist/coach sessions can SELECT members/subscriptions but
-- cannot write -- INSERT raises a real RLS-violation error; UPDATE affects
-- 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from members),
  5,
  'a receptionist-claim session can SELECT its own gym''s members (4 seeded staff + 1 newly-created member)'
);

select is(
  (select count(*)::int from subscriptions),
  1,
  'a receptionist-claim session can SELECT its own gym''s subscriptions'
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007027', 'member', 'Receptionist Attempted Member')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a member (RLS-violation error, not a silent no-op)'
);

with attempted as (
  update members set name = 'Hacked Name'
  where id = '00000000-0000-0000-0000-000000007051'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s member UPDATE affects 0 rows -- silently denied, not an error'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"coach"}',
  true
);

with attempted as (
  update members set name = 'Hacked Name'
  where id = '00000000-0000-0000-0000-000000007051'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a coach-claim session''s member UPDATE affects 0 rows -- silently denied, not an error'
);

-- ============================================================================
-- (d) Cross-tenant: an owner session at Gym B cannot write to Gym A's
-- members/subscriptions, even though they hold a write-capable role.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007012","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007027', 'member', 'Cross-Tenant Insert Attempt')$$,
  '%row-level security%',
  'an owner-claim session at a different gym cannot INSERT into gym A''s members'
);

with attempted as (
  update members set name = 'Hacked Cross Tenant'
  where id = '00000000-0000-0000-0000-000000007051'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session at a different gym cannot UPDATE gym A''s member (0 rows affected)'
);

with attempted as (
  update subscriptions set status = 'active'
  where id = '00000000-0000-0000-0000-000000007061'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session at a different gym cannot UPDATE gym A''s subscription (0 rows affected)'
);

-- ============================================================================
-- (e) enforce_member_cap trigger: Gym C's tier has member_cap = 1, and Gym C
-- already has exactly 1 role = 'member' row (its seeded at-cap member --
-- its owner row doesn't count, staff are excluded from the cap) -- the next
-- INSERT, even from a legitimately-authorized owner session, must raise.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007013","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into members (gym_id, user_id, role, name)
    values ('00000000-0000-0000-0000-000000007013', '00000000-0000-0000-0000-000000007027', 'member', 'Over Cap Member')$$,
  '%member cap reached%',
  'enforce_member_cap rejects an INSERT once the gym''s effective member cap is already reached'
);

-- ============================================================================
-- (f) enforce_subscription_expiry_matches_plan_type trigger.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
    values ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007042', 'active', current_date, current_date + 30)$$,
  '%must not have an expiry_date%',
  'a pay-per-session subscription with a non-null expiry_date is rejected'
);

select throws_like(
  $$insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
    values ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007041', 'active', current_date, null)$$,
  '%requires an expiry_date%',
  'a monthly subscription with a null expiry_date is rejected'
);

select lives_ok(
  $$insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date)
    values ('00000000-0000-0000-0000-000000007062', '00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007051', '00000000-0000-0000-0000-000000007042', 'active', current_date, null)$$,
  'a pay-per-session subscription with a null expiry_date succeeds'
);

-- ============================================================================
-- (g) A member-claim session sees only its own row via
-- self_read_own_membership, not gym A's other 4 members via
-- gym_staff_read_own_members -- proves this story's review fix (role-gating
-- that policy to staff only) actually excludes app_role='member' sessions.
-- Before the fix, this would have returned 5, not 1. The subscriptions count
-- below only proves the self-access exists-clause resolves correctly (both
-- of this member's own subscription rows) -- it does not prove exclusivity
-- on its own, since this fixture gives no other Gym A member a subscription
-- row to leak; the members assertion above is this section's real
-- regression guard for the PII-leak class of bug.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000007027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000007011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from members),
  1,
  'a member-claim session sees only its own row (self_read_own_membership) -- gym_staff_read_own_members no longer grants app_role=member visibility into gym A''s other 4 members'
);

select is(
  (select count(*)::int from subscriptions),
  2,
  'a member-claim session sees its own 2 subscription rows via gym_staff_read_own_subscriptions'' self-access exists-clause'
);

reset role;
select is(
  (select name from members where id = '00000000-0000-0000-0000-000000007051'),
  'New Member Edited',
  'gym A''s member row is unchanged after every denied cross-tenant/cross-role write attempt (verified as the connecting role, bypassing RLS visibility)'
);

select * from finish();
rollback;
