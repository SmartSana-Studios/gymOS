-- Read-only. Returns one row per PROBLEM; zero rows means healthy.
-- Used by .github/workflows/job-runs-alert.yaml (hourly) and runnable by hand:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/job-runs-alert.sql
--
--  * failed run   : any job_runs row with status 'failure' started in the last 65 minutes
--                   (the workflow runs hourly, so each failure is reported once or twice).
--  * not running  : a known job whose latest run is older than its allowed gap, or that never ran.
--                   Frequent jobs (15 min / 5 min cadence) get 45 minutes; the daily jobs get 27 hours.
-- A job name missing from `expected` is still covered for failures but not for "not running":
-- add new cron jobs here when they ship.
with expected(job_name, max_gap) as (
  values
    ('check_in_auto_timeout',      interval '45 minutes'),
    ('class_reminder',             interval '45 minutes'),
    ('quiet_gym_alert',            interval '45 minutes'),
    ('class_session_materializer', interval '27 hours'),
    ('payment_reconciliation',     interval '27 hours'),
    ('payment_connection_cleanup', interval '27 hours'),
    ('saas_billing_lifecycle',     interval '27 hours'),
    ('subscription_lifecycle',     interval '27 hours'),
    ('loyalty_sweep',              interval '27 hours'),
    ('loyalty_hook_repair',        interval '27 hours')
),
last_run as (
  select job_name, max(started_at) as last_started from job_runs group by job_name
),
problems as (
  select 'failed run'::text as problem, j.job_name, j.started_at::text as at,
         left(coalesce(j.error, ''), 200) as detail
  from job_runs j
  where j.status::text = 'failure' and j.started_at > now() - interval '65 minutes'
  union all
  select 'not running', e.job_name, coalesce(l.last_started::text, 'never'),
         'expected a run within ' || e.max_gap::text
  from expected e left join last_run l using (job_name)
  where l.last_started is null or l.last_started < now() - e.max_gap
)
select problem, job_name, at, detail from problems order by problem, job_name;
