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
--
-- Story 11.6, Task 3 (AC #2): G8 above only proved the final active ->
-- suspended jump for a Free/Test-tier gym. G9/G10 below close the gap by
-- proving the two intermediate stops (past_due, grace_period) too --
-- mirroring G3's and G5's own paying-gym boundary fixtures exactly, just on
-- the Free/Test tier -- so every stop along the lifecycle is proven to run
-- identically at the 0 XAF price point, not just the terminal state.

begin;
select plan(21);

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
  ('00000000-0000-0000-0000-000000009818', 'Billing Job Gym 8 (Free/Test parity)', '00000000-0000-4000-8000-000000000104', 'active', 30, 'active', current_date - 13, 7),
  ('00000000-0000-0000-0000-000000009819', 'Billing Job Gym 9 (Free/Test, just past due)', '00000000-0000-4000-8000-000000000104', 'active', 30, 'active', current_date - 1, 7),
  ('00000000-0000-0000-0000-000000009820', 'Billing Job Gym 10 (Free/Test, crosses into grace)', '00000000-0000-4000-8000-000000000104', 'active', 30, 'active', current_date - 6, 7);

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
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009819')::text, 'past_due',
  'Story 11.6 (AC #2): a Free/Test-tier gym with anchor = current_date - 1 becomes past_due identically to a paying gym (G3) -- the intermediate stop, not just the terminal suspended state'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009820')::text, 'grace_period',
  'Story 11.6 (AC #2): a Free/Test-tier gym with anchor + 5 = current_date - 1 crosses straight from active to grace_period identically to a paying gym (G5)'
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
     '00000000-0000-0000-0000-000000009817', '00000000-0000-0000-0000-000000009818',
     '00000000-0000-0000-0000-000000009819', '00000000-0000-0000-0000-000000009820'
   ))::text,
  (array['active', 'active', 'past_due', 'past_due', 'grace_period', 'grace_period', 'suspended', 'suspended', 'past_due', 'grace_period']::saas_billing_status[])::text,
  'a second consecutive run leaves every gym in the same end state -- no row flips twice (Story 11.6: now including the Free/Test-tier G9/G10 boundary fixtures)'
);

-- ============================================================================
-- Story 11.6, Task 3 (AC #3): apply_saas_billing_credit() (0075) resets a
-- gym's saas_billing_status to 'active' and advances the anchor date
-- forward -- but nobody had yet tested that this actually prevents
-- run_saas_billing_lifecycle_job()'s own past_due transition from
-- re-triggering afterward. G11: seeded already past its anchor date (would
-- trip past_due on the next lifecycle run, exactly like G3 above) --
-- credited before that next run gets a chance to flip it.
-- ============================================================================
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009825'); -- super_admin caller (Story 11.6, AC #3)

insert into gyms (id, name, tier_id, status, capacity, saas_billing_status, saas_billing_anchor_date, saas_grace_period_days) values
  ('00000000-0000-0000-0000-000000009821', 'Billing Job Gym 11 (AC #3: credit prevents false past_due)', '00000000-0000-0000-0000-000000009306', 'active', 30, 'active', current_date - 1, 7);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009825","role":"authenticated","app_role":"super_admin"}',
  true
);

select lives_ok(
  $$ select * from apply_saas_billing_credit('00000000-0000-0000-0000-000000009821'::uuid, 30) $$,
  'a super_admin can apply a 30-day credit to Gym 11 before the lifecycle job would otherwise flag it past_due'
);

reset role;

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009821')::text, 'active',
  'apply_saas_billing_credit() itself resets saas_billing_status to active immediately'
);

select lives_ok(
  $$ select run_saas_billing_lifecycle_job() $$,
  'run_saas_billing_lifecycle_job() can be called a third time without error, after Gym 11''s credit'
);

select is(
  (select saas_billing_status from gyms where id = '00000000-0000-0000-0000-000000009821')::text, 'active',
  'Story 11.6 (AC #3): Gym 11 stays active after the lifecycle job runs -- the credit''s anchor-date advance (current_date - 1 + 30 days) already prevents the false past_due re-trigger; a credit is not mistaken for a missed payment'
);

select * from finish();
rollback;
