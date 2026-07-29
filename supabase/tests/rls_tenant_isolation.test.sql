-- Cross-cutting: every table from Task 1 stays pure deny-all (RLS enabled, zero
-- policies) except the one deliberate canary policy on `gyms` (covered by
-- auth_hook_canary.test.sql), as of Story 1.8 (0013_dashboard_shell_self_read.sql),
-- `members`' self_read_own_membership policy (a session now sees exactly its own
-- membership row, never any other row -- see the updated `members` assertion below),
-- as of Story 1.10 (0015_users_self_service_language_preference.sql),
-- `users`' self_read_own_user policy (same shape -- a session sees exactly its
-- own users row), as of Story 2.2 (0017_membership_plan_configuration.sql),
-- `plans`' gym_staff_read_own_plans policy -- deliberately ungated by role
-- (unlike plans' own INSERT/UPDATE/DELETE policies, manager/owner-only): a
-- `member`-role session now legitimately sees its own gym's plans too, since
-- the member app's own Plan Confirmation/Plan Details screens (Story 2.7,
-- 3.10) need to read plan name/price/duration directly, and as of Story 2.3
-- (0018_member_management.sql), `members`' gym_staff_read_own_members policy
-- (unlike gym_staff_read_own_plans, gated to staff roles only -- plans carry
-- no PII, members do -- see the updated `members` assertion below, still
-- satisfied for a member-role session via the pre-existing
-- self_read_own_membership policy from Story 1.8) and `subscriptions`' own
-- gym_staff_read_own_subscriptions policy (staff-gated plus a self-access
-- `exists` clause for the caller's own subscription -- see the updated
-- `subscriptions` assertion below -- this table is no longer pure deny-all),
-- and as of Story 3.7 (0026_member_app_home_screen_status_display.sql),
-- `attendance_events`' member_read_own_attendance_events policy (same
-- self-access `exists`-clause shape as subscriptions' -- see the updated
-- `attendance_events` assertion below -- also no longer pure deny-all for a
-- member-role session, alongside 0025's pre-existing staff-only policy).
-- This asserts that an authenticated session with a VALID, correctly-scoped gym_id
-- claim still sees 0 rows everywhere else -- proving "even before any feature-specific
-- policy exists" (this story's own Story statement) holds for every table, not just
-- the ones exercised by the canary/deny-all tests.
-- 0 rows with no error is the point: a hard error here would mean a missing GRANT,
-- not correct deny-all (see 0002-0008 migrations' GRANT comments for why this matters).

begin;
select plan(13);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000003', 'Tenant Isolation Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000e1', 'Isolation Gym', '00000000-0000-0000-0000-000000000003', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000f1'),
  -- Second user, kept membership-free, reserved for the write-path INSERT-denial
  -- assertions below -- must be seeded here, as `postgres`, since `authenticated`
  -- has no privileges on auth.users once the session role switches below.
  ('00000000-0000-0000-0000-0000000000f5');

insert into members (id, gym_id, user_id, role, name)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'member', 'Test Member');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', 'Monthly', 'monthly', 5000, 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', 'active', current_date, current_date + 30);

insert into payments (id, gym_id, member_id, amount, method, status)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2', 5000, 'cash', 'verified');

insert into attendance_events (id, gym_id, member_id)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f2');

insert into job_runs (id, job_name, status)
values (gen_random_uuid(), 'test_job', 'success');

-- Authenticated session, valid claim, correctly matching the seeded gym.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000e1","app_role":"member"}',
  true
);

select is((select count(*) from tiers)::int, 0, 'tiers: 0 rows, no business policy yet -- Story 2.3 deliberately adds no tiers SELECT policy (gym_effective_member_cap() RPC instead, Scope Note #7)');
select is((select count(*) from users)::int, 1, 'users: exactly 1 row -- their own (self_read_own_user, Story 1.10), not the pure deny-all of every other table here');
select is((select count(*) from members)::int, 1, 'members: exactly 1 row -- this fixture only seeds one member row (this session''s own), satisfied by self_read_own_membership (Story 1.8); as of Story 2.3, gym_staff_read_own_members does NOT additionally grant this to a member-role session (staff-gated), so this count does not distinguish the two policies -- see member_management_rls.test.sql for a multi-member fixture that does');
select is((select count(*) from plans)::int, 1, 'plans: exactly 1 row -- their own gym''s plan (gym_staff_read_own_plans, Story 2.2), not the pure deny-all of every other table here');
select is((select count(*) from subscriptions)::int, 1, 'subscriptions: exactly 1 row -- their own subscription via gym_staff_read_own_subscriptions'' self-access exists-clause (Story 2.3), not the pure deny-all it was before this story -- the staff-gated half of that policy does not apply to this member-role session');
select is((select count(*) from payments)::int, 0, 'payments: 0 rows, no business policy yet');
select is((select count(*) from attendance_events)::int, 1, 'attendance_events: exactly 1 row -- their own check-in via member_read_own_attendance_events'' self-access exists-clause (Story 3.7), not the pure deny-all it was before this story -- the staff-gated 0025 policy does not additionally apply to this member-role session');
select is((select count(*) from job_runs)::int, 0, 'job_runs: 0 rows, no business policy yet');

-- gyms is the one exception (its canary policy): the user's own gym IS visible here,
-- proving the 0-row results above are RLS deny-all, not a broken session/claim.
select is((select count(*) from gyms)::int, 1, 'gyms: exactly 1 row (the canary policy), proving the session/claim itself is valid');

-- Write-path deny-all: an INSERT into a table with RLS enabled and zero applicable
-- policies raises an explicit RLS-violation error (unlike SELECT/UPDATE/DELETE, whose
-- USING clause just filters to 0 affected rows with no error). Both are "deny-all",
-- but the failure mode differs per Postgres's own RLS semantics; neither write-path
-- shape was previously exercised by any test in this suite (user f5 seeded above).
select throws_like(
  $$ insert into gyms (name, tier_id) values ('Sneaky Gym', '00000000-0000-0000-0000-000000000003') $$,
  '%row-level security%',
  'INSERT into gyms is blocked by RLS even though a SELECT canary policy exists'
);

select throws_like(
  $$ insert into members (gym_id, user_id, role, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f5', 'member', 'Sneaky Member') $$,
  '%row-level security%',
  'INSERT into members is blocked by RLS for a member-role session (as of Story 2.3, manager_or_owner_insert_own_members requires app_role manager/owner -- this session''s app_role is member, so it is still denied, just no longer via pure deny-all)'
);

with updated as (
  update payments set status = 'flagged'
  where gym_id = '00000000-0000-0000-0000-0000000000e1'
  returning id
)
select is((select count(*) from updated)::int, 0, 'UPDATE on payments affects 0 rows under deny-all (no error, filtered like SELECT)');

with deleted as (
  delete from attendance_events
  where gym_id = '00000000-0000-0000-0000-0000000000e1'
  returning id
)
select is((select count(*) from deleted)::int, 0, 'DELETE on attendance_events affects 0 rows under deny-all (no error, filtered like SELECT)');

select * from finish();
rollback;
