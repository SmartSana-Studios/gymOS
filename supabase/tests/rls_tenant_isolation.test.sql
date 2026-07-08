-- Cross-cutting: every table from Task 1 stays pure deny-all (RLS enabled, zero
-- policies) except the one deliberate canary policy on `gyms` (covered by
-- auth_hook_canary.test.sql). This asserts that an authenticated session with a
-- VALID, correctly-scoped gym_id claim still sees 0 rows everywhere else -- proving
-- "even before any feature-specific policy exists" (this story's own Story statement)
-- holds for every table, not just the ones exercised by the canary/deny-all tests.
-- 0 rows with no error is the point: a hard error here would mean a missing GRANT,
-- not correct deny-all (see 0002-0008 migrations' GRANT comments for why this matters).

begin;
select plan(13);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000003', 'Hustle', 5000, 50000, 30);

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

insert into plans (id, gym_id, name, plan_type, price, billing_interval)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', 'Monthly', 'monthly', 5000, 'monthly');

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

select is((select count(*) from tiers)::int, 0, 'tiers: 0 rows, no business policy yet');
select is((select count(*) from users)::int, 0, 'users: 0 rows, no business policy yet');
select is((select count(*) from members)::int, 0, 'members: 0 rows, no business policy yet (even own gym)');
select is((select count(*) from plans)::int, 0, 'plans: 0 rows, no business policy yet');
select is((select count(*) from subscriptions)::int, 0, 'subscriptions: 0 rows, no business policy yet');
select is((select count(*) from payments)::int, 0, 'payments: 0 rows, no business policy yet');
select is((select count(*) from attendance_events)::int, 0, 'attendance_events: 0 rows, no business policy yet');
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
  'INSERT into members (pure deny-all table) is blocked by RLS'
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
