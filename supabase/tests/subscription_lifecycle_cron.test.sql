-- Story 3.1: run_subscription_lifecycle_job()'s transition logic, called
-- directly (not via real cron timing), plus super_admin_job_failures()'s
-- permission gate. The failure branch (job_runs 'failure' row + audit_log
-- write) is intentionally NOT covered here -- forcing it needs a test-only
-- hook this project's conventions avoid adding to production code; it was
-- instead verified hands-on (see this story's Debug Log).

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000701', 'Cron Test Tier', 5000, 50000, 100);

insert into gyms (id, name, tier_id, grace_period_days)
values ('00000000-0000-0000-0000-000000000702', 'Cron Test Gym', '00000000-0000-0000-0000-000000000701', 3);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000710'), -- super_admin caller
  ('00000000-0000-0000-0000-000000000711'), -- owner of the gym (non-super_admin)
  ('00000000-0000-0000-0000-000000000720'),
  ('00000000-0000-0000-0000-000000000721'),
  ('00000000-0000-0000-0000-000000000722'),
  ('00000000-0000-0000-0000-000000000723'),
  ('00000000-0000-0000-0000-000000000724'),
  ('00000000-0000-0000-0000-000000000725'),
  ('00000000-0000-0000-0000-000000000726'),
  ('00000000-0000-0000-0000-000000000727');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000730', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000711', 'owner', 'Cron Test Owner'),
  ('00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000720', 'member', 'M1 crosses into expiring_soon window'),
  ('00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000721', 'member', 'M2 not yet in window'),
  ('00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000722', 'member', 'M3 expiry passed, enters grace_period'),
  ('00000000-0000-0000-0000-000000000743', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000723', 'member', 'M4 grace elapsed, becomes expired'),
  ('00000000-0000-0000-0000-000000000744', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000724', 'member', 'M5 still within grace window'),
  ('00000000-0000-0000-0000-000000000745', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000725', 'member', 'M6 pay_per_session, no expiry_date'),
  ('00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000726', 'member', 'M7 expiry_date = current_date exactly'),
  ('00000000-0000-0000-0000-000000000747', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000727', 'member', 'M8 grace period elapses exactly today');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000000750', '00000000-0000-0000-0000-000000000702', 'Cron Test Monthly', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000702', 'Cron Test Pay Per Session', 'pay_per_session', 2000, 'monthly', null);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000000760', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000740', '00000000-0000-0000-0000-000000000750', 'active', current_date - 300, current_date + 7),
  ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000750', 'active', current_date - 300, current_date + 10),
  ('00000000-0000-0000-0000-000000000762', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000750', 'active', current_date - 300, current_date - 1),
  ('00000000-0000-0000-0000-000000000763', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000743', '00000000-0000-0000-0000-000000000750', 'grace_period', current_date - 300, current_date - 5),
  ('00000000-0000-0000-0000-000000000764', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000744', '00000000-0000-0000-0000-000000000750', 'grace_period', current_date - 300, current_date - 2),
  ('00000000-0000-0000-0000-000000000765', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000745', '00000000-0000-0000-0000-000000000751', 'active', current_date - 300, null),
  -- Exact-boundary fixtures (AC #2/#3 use "has passed"/"has ended" -- both
  -- read as strictly before today, matching the job's strict `<` comparisons):
  ('00000000-0000-0000-0000-000000000766', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000746', '00000000-0000-0000-0000-000000000750', 'active', current_date - 300, current_date),
  ('00000000-0000-0000-0000-000000000767', '00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000747', '00000000-0000-0000-0000-000000000750', 'grace_period', current_date - 300, current_date - 3);

-- ============================================================================
-- Call the job directly -- no waiting on real cron timing.
-- ============================================================================
select lives_ok(
  $$ select run_subscription_lifecycle_job() $$,
  'run_subscription_lifecycle_job() executes without error against seeded fixtures'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000760')::text, 'expiring_soon',
  'active subscription with expiry_date = current_date + 7 becomes expiring_soon'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000761')::text, 'active',
  'active subscription with expiry_date = current_date + 10 stays active -- not yet in the 7-day window'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000762')::text, 'grace_period',
  'active subscription with expiry_date = current_date - 1 becomes grace_period'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000763')::text, 'expired',
  'grace_period subscription whose expiry_date + grace_period_days has elapsed becomes expired'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000764')::text, 'grace_period',
  'grace_period subscription still within the gym''s grace window stays grace_period'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000765')::text, 'active',
  'pay_per_session subscription (expiry_date is null) is untouched by any transition'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000766')::text, 'expiring_soon',
  'active subscription with expiry_date = current_date exactly becomes expiring_soon, not grace_period -- "has passed" (AC #2) is strictly before today'
);

select is(
  (select status from subscriptions where id = '00000000-0000-0000-0000-000000000767')::text, 'grace_period',
  'grace_period subscription whose expiry_date + grace_period_days = current_date exactly stays grace_period, not expired -- "has ended" (AC #3) is strictly before today'
);

select is(
  (select count(*) from job_runs where job_name = 'subscription_lifecycle' and status = 'success')::int, 1,
  'a success row is written to job_runs'
);

-- ============================================================================
-- Idempotency: calling the function twice in a row produces the same end
-- state the second time -- no row flips twice, no error.
-- ============================================================================
select lives_ok(
  $$ select run_subscription_lifecycle_job() $$,
  'run_subscription_lifecycle_job() can be called a second time without error'
);

select is(
  (select array_agg(status order by id) from subscriptions where gym_id = '00000000-0000-0000-0000-000000000702')::text,
  (array['expiring_soon', 'active', 'grace_period', 'expired', 'grace_period', 'active', 'expiring_soon', 'grace_period']::subscription_status[])::text,
  'a second consecutive run leaves every subscription in the same end state -- no row flips twice'
);

-- ============================================================================
-- subscriptions_expiry_after_start CHECK constraint (Task 3): expiry_date
-- must be strictly after start_date when not null. Uses a separate,
-- unrelated gym/member so its rows don't perturb the array_agg assertion
-- above (which pins the first gym's exact row set/order).
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000703', 'Constraint Test Tier', 5000, 50000, 10);

insert into gyms (id, name, tier_id)
values ('00000000-0000-0000-0000-000000000704', 'Constraint Test Gym', '00000000-0000-0000-0000-000000000703');

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000728');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000748', '00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000728', 'member', 'Constraint Test Member');

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000000752', '00000000-0000-0000-0000-000000000704', 'Constraint Test Monthly', 'monthly', 10000, 'monthly', 30);

select throws_like(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000748', '00000000-0000-0000-0000-000000000752', 'active', current_date, current_date) $$,
  '%subscriptions_expiry_after_start%',
  'expiry_date equal to start_date violates subscriptions_expiry_after_start'
);

select lives_ok(
  $$ insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
     values ('00000000-0000-0000-0000-000000000704', '00000000-0000-0000-0000-000000000748', '00000000-0000-0000-0000-000000000752', 'active', current_date, current_date + 1) $$,
  'expiry_date one day after start_date satisfies subscriptions_expiry_after_start'
);

-- ============================================================================
-- super_admin_job_failures(): permission gate. (Row-shape/content coverage
-- for an actual failure is verified hands-on -- see this story's Debug Log.)
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000711","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000702","app_role":"owner"}',
  true
);

select throws_like(
  $$ select * from super_admin_job_failures() $$,
  '%permission denied%',
  'a non-super_admin caller is rejected by super_admin_job_failures(), not given null or wrong data'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000710","role":"authenticated","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$ select * from super_admin_job_failures() $$,
  'a super_admin caller can call super_admin_job_failures() without error'
);

select * from finish();
rollback;
