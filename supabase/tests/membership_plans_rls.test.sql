-- Story 2.2: Membership Plan Configuration. New RLS policies from
-- 0017_membership_plan_configuration.sql -- gym_staff_read_own_plans
-- (ungated by role) and manager_or_owner_{insert,update,delete}_own_plans
-- on `plans`. Session-simulation conventions match gym_settings_rls.test.sql:
-- fixture rows seeded up front as the connecting role, then
-- `set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- per simulated session. Cross-tenant/cross-role UPDATE/DELETE-denial checks
-- use a CTE `returning` clause on the write itself (rls_tenant_isolation's
-- pattern), not a follow-up SELECT. INSERT-denial checks use `throws_like`
-- (rls_tenant_isolation's pattern too) -- unlike SELECT/UPDATE/DELETE, a
-- denied INSERT raises a real "row-level security" error rather than
-- silently affecting 0 rows.

begin;
select plan(15);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006001', 'Plans Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000006011', 'Plans Gym A', '00000000-0000-0000-0000-000000006001', 30),
  ('00000000-0000-0000-0000-000000006012', 'Plans Gym B', '00000000-0000-0000-0000-000000006001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000006021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000006022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000006023'), -- Gym B owner
  ('00000000-0000-0000-0000-000000006024'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000006025'); -- Gym A coach

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000006031', '00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006021', 'owner', 'Plans Gym A Owner'),
  ('00000000-0000-0000-0000-000000006032', '00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006022', 'manager', 'Plans Gym A Manager'),
  ('00000000-0000-0000-0000-000000006033', '00000000-0000-0000-0000-000000006012', '00000000-0000-0000-0000-000000006023', 'owner', 'Plans Gym B Owner'),
  ('00000000-0000-0000-0000-000000006034', '00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006024', 'receptionist', 'Plans Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000006035', '00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006025', 'coach', 'Plans Gym A Coach');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000006041', '00000000-0000-0000-0000-000000006011', 'Existing Monthly', 'monthly', 15000, 'monthly', 30);

-- ============================================================================
-- Any gym-staff role (including receptionist/coach, deliberately NOT
-- restricted to manager/owner) can SELECT their own gym's plans.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from plans),
  1,
  'a receptionist-claim session can SELECT its own gym''s plans'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from plans),
  1,
  'a coach-claim session can SELECT its own gym''s plans'
);

-- ============================================================================
-- Owner and manager sessions can INSERT into their own gym's plans.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"owner"}',
  true
);

select lives_ok(
  $$insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
    values ('00000000-0000-0000-0000-000000006042', '00000000-0000-0000-0000-000000006011', 'Owner-Created Plan', 'class_only', 8000, 'monthly', 30)$$,
  'an owner-claim session can INSERT a plan into its own gym'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"manager"}',
  true
);

select lives_ok(
  $$insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
    values ('00000000-0000-0000-0000-000000006043', '00000000-0000-0000-0000-000000006011', 'Manager-Created Plan', 'coach_inclusive', 12000, 'monthly', 30)$$,
  'a manager-claim session can INSERT a plan into its own gym'
);

-- ============================================================================
-- Manager session can UPDATE and DELETE their own gym's plans.
-- ============================================================================
select lives_ok(
  $$update plans set price = 13000 where id = '00000000-0000-0000-0000-000000006043'$$,
  'a manager-claim session can UPDATE its own gym''s plan'
);

select is(
  (select price from plans where id = '00000000-0000-0000-0000-000000006043'),
  13000,
  'the price UPDATE is reflected'
);

with deleted as (
  delete from plans
  where id = '00000000-0000-0000-0000-000000006043'
  returning id
)
select is(
  (select count(*)::int from deleted),
  1,
  'a manager-claim session can DELETE its own gym''s plan'
);

-- ============================================================================
-- Receptionist/coach sessions can SELECT but cannot write -- INSERT raises a
-- real RLS-violation error; UPDATE/DELETE silently affect 0 rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$insert into plans (id, gym_id, name, plan_type, price, billing_interval)
    values ('00000000-0000-0000-0000-000000006044', '00000000-0000-0000-0000-000000006011', 'Receptionist Attempted Plan', 'monthly', 5000, 'monthly')$$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a plan (RLS-violation error, not a silent no-op)'
);

with attempted as (
  update plans set price = 999
  where id = '00000000-0000-0000-0000-000000006041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

with attempted as (
  delete from plans
  where id = '00000000-0000-0000-0000-000000006041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a receptionist-claim session''s DELETE affects 0 rows -- silently denied, not an error'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"coach"}',
  true
);

with attempted as (
  update plans set price = 999
  where id = '00000000-0000-0000-0000-000000006041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'a coach-claim session''s UPDATE affects 0 rows -- silently denied, not an error'
);

-- ============================================================================
-- Cross-tenant: an owner/manager session at gym B cannot write to gym A's
-- plans, even though they hold a write-capable role.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006012","app_role":"owner"}',
  true
);

select throws_like(
  $$insert into plans (id, gym_id, name, plan_type, price, billing_interval)
    values ('00000000-0000-0000-0000-000000006045', '00000000-0000-0000-0000-000000006011', 'Cross-Tenant Insert Attempt', 'monthly', 5000, 'monthly')$$,
  '%row-level security%',
  'an owner-claim session at a different gym cannot INSERT into gym A''s plans'
);

with attempted as (
  update plans set price = 1
  where id = '00000000-0000-0000-0000-000000006041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session at a different gym cannot UPDATE gym A''s plan (0 rows affected)'
);

with attempted as (
  delete from plans
  where id = '00000000-0000-0000-0000-000000006041'
  returning id
)
select is(
  (select count(*)::int from attempted),
  0,
  'an owner-claim session at a different gym cannot DELETE gym A''s plan (0 rows affected)'
);

reset role;
select is(
  (select price from plans where id = '00000000-0000-0000-0000-000000006041'),
  15000,
  'gym A''s original plan is unchanged after every denied cross-tenant/cross-role write attempt (verified as the connecting role, bypassing RLS visibility)'
);

select * from finish();
rollback;
