-- Story 11.2, Task 2: run_saas_billing_lifecycle_job()'s transition logic,
-- called directly (not via real cron timing) -- same approach as
-- subscription_lifecycle_cron.test.sql for run_subscription_lifecycle_job().
-- Covers each state-transition boundary (exact-day, not one day early/late),
-- the suspended transition's lockstep gyms.status flip, Free/Test-tier
-- parity with a paying gym, idempotency across two consecutive runs, and the
-- job_runs success row. The failure branch is intentionally NOT covered
-- here, same rationale as subscription_lifecycle_cron.test.sql (forcing it
-- needs a test-only hook this project's conventions avoid adding to
-- production code).

begin;
select plan(15);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009306', 'Billing Job Test Tier', 5000, 50000, 100);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009820'); -- owner, unused by any assertion but keeps the fixture shape consistent

-- G1: anchor 1 day in the future -- not yet due, stays active.
-- G2: anchor = current_date exactly -- "has passed" is strictly before
--     today (same convention as subscription_lifecycle_cron.test.sql's
--     AC #2/#3 boundary fixtures) -- stays active, not one day early.
-- G3: anchor = current_date - 1 -- just passed, becomes past_due.
-- G4: anchor + 5 = current_date exactly -- becomes past_due, not grace yet
--     (seeded active, same active->past_due edge as G3, exact-boundary
--     variant proving it doesn't also cross into grace_period this run).
-- G5: anchor + 5 = current_date - 1 -- crosses straight from active to
--     grace_period in one run (self-correcting, no backfill, mirrors
--     run_subscription_lifecycle_job()'s own "one run jumps to wherever
--     today's date puts them" behavior).
-- G6: already grace_period; anchor + 5 + 7 (default grace days) =
--     current_date exactly -- stays grace_period, not one day early.
-- G7: already grace_period; anchor + 5 + 7 = current_date - 1 -- crosses to
--     suspended, and gyms.status must flip to 'suspended' in lockstep.
-- G8: Free/Test tier, same far-past anchor as G7's crossing case -- proves
--     the job does not special-case or skip the 0 XAF tier (AC #3).
insert into gyms (id, name, tier_id, status, capacity, saas_billing_status, saas_billing_anchor_date, saas_grace_period_days) values
  ('00000000-0000-0000-0000-000000009811', 'Billing Job Gym 1 (not yet due)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date + 1, 7),
  ('00000000-0000-0000-0000-000000009812', 'Billing Job Gym 2 (due boundary)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date, 7),
  ('00000000-0000-0000-0000-000000009813', 'Billing Job Gym 3 (just past due)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date - 1, 7),
  ('00000000-0000-0000-0000-000000009814', 'Billing Job Gym 4 (grace boundary)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date - 5, 7),
  ('00000000-0000-0000-0000-000000009815', 'Billing Job Gym 5 (crosses into grace)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date - 6, 7),
  ('00000000-0000-0000-0000-000000009816', 'Billing Job Gym 6 (suspend boundary)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'grace_period', current_date - 12, 7),
  ('00000000-0000-0000-0000-000000009817', 'Billing Job Gym 7 (crosses into suspended)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'grace_period', current_date - 13, 7),
  ('00000000-0000-0000-0000-000000009818', 'Billing Job Gym 8 (Free/Test parity)', '00000000-0000-4000-8000-000000000104', 'active', 30, 'active', current_date - 13, 7);

-- ============================================================================
-- Call the job directly -- no waiting on real cron timing.
-- ============================================================================
select lives_ok(
  $$ select run_saas_billing_lifecycle_job() $$,
  'run_saas_billing_lifecycle_job() executes without error against seeded fixtures'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009811')::text, 'active',
  'anchor 1 day in the future stays active -- not yet due'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009812')::text, 'active',
  'anchor = current_date exactly stays active -- not one day early'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009813')::text, 'past_due',
  'anchor = current_date - 1 becomes past_due'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009814')::text, 'past_due',
  'anchor + 5 = current_date exactly becomes past_due -- not grace_period yet'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009815')::text, 'grace_period',
  'anchor + 5 = current_date - 1 crosses straight from active to grace_period in one run'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009816')::text, 'grace_period',
  'anchor + 5 + grace_period_days = current_date exactly stays grace_period -- not one day early'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009817')::text, 'suspended',
  'anchor + 5 + grace_period_days = current_date - 1 crosses to suspended'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000009817')::text, 'suspended',
  'gyms.status flips to suspended in lockstep with saas_billing_status'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009818')::text, 'suspended',
  'a Free/Test-tier gym transitions to suspended identically to a paying gym (AC #3)'
);

select is(
  (select status from gyms where id = '00000000-0000-0000-0000-000000009818')::text, 'suspended',
  'the Free/Test-tier gym''s gyms.status also flips to suspended in lockstep'
);

select is(
  (select count(*) from gyms
   where id in (
     '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009812',
     '00000000-0000-0000-0000-000000009813', '00000000-0000-0000-0000-000000009814',
     '00000000-0000-0000-0000-000000009815', '00000000-0000-0000-0000-000000009816'
   ) and status = 'suspended')::int, 0,
  'no gym short of the suspended threshold has its gyms.status touched'
);

select is(
  (select count(*) from job_runs where job_name = 'saas_billing_lifecycle' and status = 'success')::int, 1,
  'a success row is written to job_runs'
);

-- ============================================================================
-- Idempotency: calling the function twice in a row produces the same end
-- state the second time -- no row flips twice, no error.
-- ============================================================================
select lives_ok(
  $$ select run_saas_billing_lifecycle_job() $$,
  'run_saas_billing_lifecycle_job() can be called a second time without error'
);

select is(
  (select array_agg(saas_billing_status order by id) from gyms where id in (
     '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009812',
     '00000000-0000-0000-0000-000000009813', '00000000-0000-0000-0000-000000009814',
     '00000000-0000-0000-0000-000000009815', '00000000-0000-0000-0000-000000009816',
     '00000000-0000-0000-0000-000000009817', '00000000-0000-0000-0000-000000009818'
   ))::text,
  (array['active', 'active', 'past_due', 'past_due', 'grace_period', 'grace_period', 'suspended', 'suspended']::saas_billing_status[])::text,
  'a second consecutive run leaves every gym in the same end state -- no row flips twice'
);

select * from finish();
rollback;
