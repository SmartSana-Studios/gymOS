-- Story 3.1: Subscription Lifecycle Cron Job. First pg_cron job and first
-- Postgres extension enabled in this project -- no existing spike/precedent
-- to model beyond the general SECURITY DEFINER/RLS-self-enforcement
-- conventions already established (0011_super_admin_tier_gym_lifecycle.sql).

-- extra_search_path = ["public", "extensions"] (supabase/config.toml) --
-- keeps the extension itself out of the public schema per Supabase's own
-- convention, matching how every other Supabase-managed extension is placed.
create extension if not exists pg_cron with schema extensions;

-- ----------------------------------------------------------------------------
-- Task 3 (optional, recommended by the Epic 2 retrospective): close the
-- subscriptions expiry/start-date tech debt -- open since Story 1.3, still
-- unresolved through Epic 2, explicitly flagged as this story's job to close
-- (epic-2-retro-2026-07-18.md Action Items).
-- ----------------------------------------------------------------------------
alter table subscriptions
  add constraint subscriptions_expiry_after_start
  check (expiry_date is null or expiry_date > start_date);

-- ============================================================================
-- run_subscription_lifecycle_job(): the nightly transition function.
--
-- Absolute-date checks, not incremental/delta steps -- this is what makes
-- "no retroactive backfill" (AC #4) true for free. Each UPDATE below is
-- computed purely from current_date and the row's own expiry_date/the gym's
-- grace_period_days -- nothing about "how long the job has been failing"
-- ever enters the query, so a job that failed for N nights and then succeeds
-- correctly jumps a member straight to wherever today's date puts them, in
-- one run, with no artificial staged catch-up.
--
-- Run in most-progressed-state-first order so no row is touched twice in the
-- same run: expired, then grace_period, then expiring_soon.
--
-- No SECURITY DEFINER needed: pg_cron invokes scheduled jobs as the role
-- that called cron.schedule() (this migration, running as postgres), which
-- already has full table access -- SECURITY DEFINER would be a no-op since
-- the function's owner is already postgres.
--
-- The inner BEGIN...EXCEPTION block creates an implicit savepoint: if the
-- guarded UPDATEs raise, Postgres rolls back only to the start of that block
-- (undoing the partial UPDATEs), while the exception handler's own job_runs/
-- log_audit_event writes still run and commit normally as part of the outer
-- transaction. Letting the exception propagate uncaught would roll back the
-- failure record too -- the job would fail with nothing recorded anywhere,
-- exactly what AC #4 exists to prevent.
-- ============================================================================
create function run_subscription_lifecycle_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    -- 1. expired (checked first: catches anyone whose grace period has
    --    already elapsed, regardless of what status they're currently
    --    sitting in). expiry_date is not null excludes pay_per_session
    --    subscriptions (expiry_date = null, enforced by 0018's
    --    enforce_subscription_expiry_matches_plan_type trigger) without a
    --    plan_type join -- a null compared with < is unknown, which Postgres
    --    treats as "don't match".
    update subscriptions s
    set status = 'expired'
    from gyms g
    where s.gym_id = g.id
      and s.status in ('active', 'expiring_soon', 'grace_period')
      and s.expiry_date is not null
      and (s.expiry_date + g.grace_period_days) < current_date;

    -- 2. grace_period (expiry has passed, but grace hasn't elapsed yet --
    --    rows already flipped to 'expired' above no longer match this WHERE).
    update subscriptions
    set status = 'grace_period'
    where status in ('active', 'expiring_soon')
      and expiry_date is not null
      and expiry_date < current_date;

    -- 3. expiring_soon (still active, expiry within 7 days).
    update subscriptions
    set status = 'expiring_soon'
    where status = 'active'
      and expiry_date is not null
      and expiry_date <= current_date + 7;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('subscription_lifecycle', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('subscription_lifecycle', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'subscription_lifecycle_job_failure',
      p_system_actor_label => 'system:subscription_lifecycle_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- This function is only ever meant to run via cron.schedule() or a direct
-- postgres invocation during manual verification, never from application
-- code -- no grant to authenticated/anon/service_role, matching every other
-- function in this codebase's discipline of explicit least-privilege grants.
-- Note: the real nightly invocation runs as `postgres` (the role that called
-- cron.schedule() below, in this migration), not `service_role` -- verified
-- against the actual pg_cron behavior (`cron.job.username`) and independent
-- documentation (AWS RDS/Azure/citusdata/pg_cron all agree: a scheduled job
-- executes as whichever role registered it via cron.schedule(), with no
-- special role substitution). `postgres` is a superuser and bypasses this
-- REVOKE entirely, same reasoning as 0007_audit_log.sql's REVOKE comment.
-- `supabase/tests/audit_log_immutable.test.sql`'s "pg_cron runs as
-- service_role" comment (written before this project had any real pg_cron
-- job) conflates this with an unrelated Supabase pattern -- a cron job
-- calling an Edge Function over HTTP via pg_net with a service_role JWT
-- bearer token, which only applies when cron makes an HTTP call, not when it
-- calls a SQL function directly as this job does. See docs/decisions.md.
revoke execute on function run_subscription_lifecycle_job() from public;

-- "02:00 Africa/Douala" -- Cameroon (WAT) is UTC+1 year-round, no DST, so
-- 02:00 WAT = 01:00 UTC every day with no seasonal adjustment ever needed.
-- pg_cron schedules run in the server's cron.timezone setting, which
-- defaults to UTC. cron.schedule() upserts by job name -- safe to run this
-- migration repeatedly (e.g. across `supabase db reset`s) without creating
-- duplicate scheduled jobs.
select cron.schedule(
  'subscription_lifecycle',
  '0 1 * * *',
  $$ select run_subscription_lifecycle_job(); $$
);

-- ============================================================================
-- super_admin_job_failures(): Super Admin cross-tenant read of recent job
-- failures (AC #4's "surfaced as an alert on the Super Admin dashboard").
--
-- job_runs has been RLS-deny-all-with-zero-policies since Story 1.4
-- (0008_job_runs.sql) -- this follows the established pattern for Super
-- Admin cross-tenant reads (platform_metrics()/gym_member_count(),
-- 0011_super_admin_tier_gym_lifecycle.sql): an aggregate/row-returning
-- SECURITY DEFINER function that self-enforces private.is_super_admin()
-- internally, not a broadened row-level policy.
-- ============================================================================
create function super_admin_job_failures()
returns table (
  id uuid,
  job_name text,
  started_at timestamptz,
  finished_at timestamptz,
  error text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not private.is_super_admin() then
    raise exception 'permission denied';
  end if;

  return query
  select j.id, j.job_name, j.started_at, j.finished_at, j.error
  from job_runs j
  where j.status = 'failure'
  order by j.started_at desc
  limit 20;
end;
$$;

revoke execute on function super_admin_job_failures from public;
grant execute on function super_admin_job_failures to authenticated;
