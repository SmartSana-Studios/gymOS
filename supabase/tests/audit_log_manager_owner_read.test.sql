-- Story 7.2: Audit Log Dashboard Page (AC #3). Tests
-- manager_or_owner_read_own_audit_log (0049_audit_log_dashboard_read_policy.sql)
-- -- the RLS policy that closes the gym-admin-facing read gap
-- 0007_audit_log.sql and 0012_super_admin_data_access_escalation.sql both
-- deferred to this story. audit_log_immutable.test.sql already covers
-- append-only enforcement and log_audit_event() shape -- this file is
-- scoped to SELECT access only, seeded via direct service_role INSERT
-- (audit_log_immutable.test.sql's own precedent: "service_role can INSERT
-- into audit_log directly").

begin;
select plan(6);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000014001', 'Audit Log Read Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000014011', 'Audit Log Read Gym A', '00000000-0000-0000-0000-000000014001', 30),
  ('00000000-0000-0000-0000-000000014012', 'Audit Log Read Gym B', '00000000-0000-0000-0000-000000014001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000014021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000014022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000014023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000014024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000014025'), -- Gym B owner
  ('00000000-0000-0000-0000-000000014026'); -- Super Admin (no members row)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000014071', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014021', 'owner', 'Audit Log Read Gym A Owner'),
  ('00000000-0000-0000-0000-000000014072', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014022', 'manager', 'Audit Log Read Gym A Manager'),
  ('00000000-0000-0000-0000-000000014073', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014023', 'receptionist', 'Audit Log Read Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000014074', '00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014024', 'coach', 'Audit Log Read Gym A Coach'),
  ('00000000-0000-0000-0000-000000014075', '00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014025', 'owner', 'Audit Log Read Gym B Owner');

-- Seed audit_log rows directly as service_role (RLS-bypassing table grant,
-- audit_log_immutable.test.sql's own precedent) -- 2 rows for Gym A, 1 row
-- for Gym B, plus 1 gym-agnostic pg_cron-style row (null gym_id) that must
-- never be visible to any gym-scoped session.
set local role service_role;

insert into audit_log (gym_id, actor_id, actor_display_name, action_type) values
  ('00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014021', 'Audit Log Read Gym A Owner', 'member_deactivated'),
  ('00000000-0000-0000-0000-000000014011', '00000000-0000-0000-0000-000000014022', 'Audit Log Read Gym A Manager', 'coach_assigned'),
  ('00000000-0000-0000-0000-000000014012', '00000000-0000-0000-0000-000000014025', 'Audit Log Read Gym B Owner', 'refund_recorded'),
  (null, null, 'system:subscription_lifecycle_cron', 'subscription_lifecycle_job_failure');

reset role;

-- ============================================================================
-- (1) An owner-claim session sees its own gym's audit rows (2 rows for Gym
-- A -- not Gym B's 1 row, not the null-gym_id system row).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from audit_log where gym_id = '00000000-0000-0000-0000-000000014011'),
  2,
  'an owner-claim session sees its own gym''s 2 audit_log rows'
);

-- ============================================================================
-- (2) A manager-claim session sees the same rows as the owner (same count).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"manager"}',
  true
);

select is(
  (select count(*)::int from audit_log where gym_id = '00000000-0000-0000-0000-000000014011'),
  2,
  'a manager-claim session sees the same 2 audit_log rows as the owner'
);

-- ============================================================================
-- (3) A receptionist-claim session sees 0 rows -- this policy is
-- Manager/Owner-only, unlike gym_staff_read_own_members/subscriptions.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from audit_log),
  0,
  'a receptionist-claim session sees 0 audit_log rows -- this policy is Manager/Owner-only'
);

-- ============================================================================
-- (4) A coach-claim session sees 0 rows, for the same reason.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from audit_log),
  0,
  'a coach-claim session sees 0 audit_log rows -- this policy is Manager/Owner-only'
);

-- ============================================================================
-- (5) Tenant isolation: an owner/manager session never sees another gym's
-- audit rows, even when explicitly querying for that gym's id.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000014011","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from audit_log where gym_id = '00000000-0000-0000-0000-000000014012'),
  0,
  'a Gym A owner-claim session sees 0 rows when explicitly querying Gym B''s audit_log rows (tenant isolation)'
);

-- ============================================================================
-- (6) Regression guard: a super_admin-claim session still sees all rows
-- across gyms (including the null-gym_id system row) after this migration
-- -- confirms the new policy didn't interfere with the existing OR'd
-- super_admin_read_audit_log policy (0012).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000014026","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (select count(*)::int from audit_log),
  4,
  'a super_admin-claim session still sees all 4 audit_log rows across gyms -- super_admin_read_audit_log (0012) is unaffected'
);

reset role;

select * from finish();
rollback;
