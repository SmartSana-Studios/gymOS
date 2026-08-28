-- Story 11.2: SaaS Subscription Lifecycle & Free/Test Tier. Adds a second,
-- independent state machine to `gyms` -- the platform's own billing
-- relationship with the gym, distinct from `subscriptions` (a gym's billing
-- relationship with its members, Story 3.1). Also adds the Free/Test tier
-- (FR-139, amending FR-073).

-- ----------------------------------------------------------------------------
-- New enum, distinct from `subscription_status` -- 3 of 4 values overlap,
-- but `suspended` is not `expired`, and the underlying entity (gym vs.
-- member subscription) genuinely differs. Conflating them would let a
-- gym-level status accidentally take a member-only value or vice versa.
-- `saas_billing_interval` below reuses the existing `billing_interval` enum
-- instead (its values already fit -- "no second enum" reuse precedent from
-- Story 11.1's `saas_billing_payments.status` reusing `payment_status`).
-- ----------------------------------------------------------------------------
create type saas_billing_status as enum ('active', 'past_due', 'grace_period', 'suspended');

-- `saas_billing_anchor_date` defaults to one month out (not `current_date`)
-- so existing gyms get a runway before their first SaaS bill, and a
-- newly-created gym doesn't look overdue on day one -- see this migration's
-- job below and Task 4's operational-flag note in the story file.
-- `saas_grace_period_days` is a per-gym column (default 7) even though
-- FR-131 only says "Super-Admin-configurable" without specifying per-gym vs.
-- platform-wide -- chosen because it costs nothing extra, is strictly more
-- flexible, and mirrors the exact precedent of the pre-existing per-gym
-- `grace_period_days` (member-subscription grace) and `member_cap_override`
-- (0011_super_admin_tier_gym_lifecycle.sql) -- both per-gym override
-- columns Super Admin can set with no dedicated UI shipped in the same
-- story that added the column (Story 11.5's Billing view is the natural
-- home for a `saas_grace_period_days` control).
alter table gyms
  add column saas_billing_status saas_billing_status not null default 'active',
  add column saas_billing_interval billing_interval not null default 'monthly',
  add column saas_billing_anchor_date date not null default (current_date + interval '1 month')::date,
  add column saas_grace_period_days integer not null default 7;

-- DB is the enforcement of record (AD-21/AD-22/AD-26), not just future UI
-- validation -- a negative value would make the suspend threshold
-- (anchor + 5 + saas_grace_period_days) arrive before or at the same time
-- as the grace threshold, collapsing this story's state-machine ordering.
alter table gyms add constraint gyms_saas_grace_period_days_nonneg
  check (saas_grace_period_days >= 0);

-- Operational-flag decision (Task 4, raised with the user before merging):
-- the column default above (1 month) already backfills every pre-existing
-- gym via the ADD COLUMN itself, which would put existing gyms on a path to
-- `suspended` roughly 43 days after this migration deploys (anchor + 5 days
-- past_due + 7 days grace_period, run_saas_billing_lifecycle_job() below).
-- Nothing can recover a gym from `suspended` or override it yet -- Story
-- 11.3 (payment-completion reset) and Story 11.5 (Super Admin override) are
-- both still backlog, sequential in this sprint, with no signal either
-- lands within that window. A false production suspension (loses
-- staff-creation ability immediately per create_staff_member()'s live
-- current_gym_status() check, 0063) is a severe, hard-to-reverse risk
-- against a minor delay to billing enforcement during the beta -- so
-- existing gyms are separately backfilled to 3 months of runway here,
-- overriding the column default's 1-month value for rows that exist at
-- migration time only. Any gym created after this migration still gets the
-- column's own 1-month default (set above) -- reasonable once it's
-- provisioned into a platform where 11.3+'s real recovery/override
-- machinery already exists.
update gyms set saas_billing_anchor_date = current_date + interval '3 months';

-- ----------------------------------------------------------------------------
-- Security-critical: extend the existing column-protection trigger
-- (0014_gym_settings_owner_access.sql). `owner_update_own_gym` gives every
-- gym Owner row-level UPDATE access to their own `gyms` row -- RLS is
-- row-level, not column-level, so without this the four new columns above
-- would let an Owner self-modify saas_billing_status back to 'active' via a
-- raw supabase-js update, silently defeating the whole billing lifecycle
-- this migration builds. The trigger itself does not need to be recreated,
-- only the function body (create or replace).
--
-- `app.saas_billing_lifecycle_job_bypass`: the trigger fires unconditionally
-- for every UPDATE, including run_saas_billing_lifecycle_job()'s own writes
-- below -- which run with no JWT/session context at all (pg_cron invokes as
-- `postgres`, matching 0021's own documented reasoning), so
-- private.is_super_admin() reads a null claim and returns false. Without
-- this bypass the job's own UPDATEs to `status`/`saas_billing_status` would
-- be silently pinned back to their old values by this very trigger --
-- discovered by this story's own pgTAP run, not a hypothetical. Same
-- transaction-local-GUC pattern as update_staff_role()'s
-- `app.staff_role_update_bypass` (0063_staff_edit_deactivation.sql): a
-- narrow, `set_config(..., true)`-scoped signal, checked only for the exact
-- columns the one already-authorized system write touches -- `tier_id`/
-- `member_cap_override` stay unconditionally pinned back even when this GUC
-- is set, matching that precedent's own code-review-fixed "narrow the
-- bypass to only the columns the specific write touches" shape.
-- ----------------------------------------------------------------------------
create or replace function private.protect_super_admin_only_gym_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at := old.created_at;
  if not private.is_super_admin() then
    new.tier_id := old.tier_id;
    new.member_cap_override := old.member_cap_override;

    if coalesce(current_setting('app.saas_billing_lifecycle_job_bypass', true), 'false') <> 'true' then
      new.status := old.status;
      new.saas_billing_status := old.saas_billing_status;
    end if;
    -- saas_billing_interval/saas_billing_anchor_date/saas_grace_period_days
    -- are never written by run_saas_billing_lifecycle_job() (it only ever
    -- sets status/saas_billing_status, above) so the bypass does not extend
    -- to them -- they stay unconditionally pinned back for any
    -- non-super_admin session, matching this trigger's narrow-bypass intent.
    new.saas_billing_interval := old.saas_billing_interval;
    new.saas_billing_anchor_date := old.saas_billing_anchor_date;
    new.saas_grace_period_days := old.saas_grace_period_days;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Free/Test tier (AC #3, FR-139). `price_locked` + a CHECK constraint is the
-- enforcement of record at the DB layer (not just a UI convention) --
-- matches this project's consistent "DB is the enforcement of record"
-- discipline (AD-21/AD-22/AD-26). One seeded row, not a general "locked
-- tier" mechanism -- no UI is added for Super Admin to create additional
-- price-locked tiers via the normal Add Tier flow (out of scope, FR-139
-- describes exactly one Free/Test tier).
-- ----------------------------------------------------------------------------
alter table tiers add column price_locked boolean not null default false;

alter table tiers add constraint tiers_price_locked_implies_zero_price
  check (not price_locked or (monthly_price = 0 and annual_price = 0));

-- member_cap = 30 (same as Hustle) is a reasonable Super-Admin-adjustable
-- starting value -- chosen to avoid tripping tierCapOrderingError's
-- monotonic price->cap ordering check at seed time, since Free/Test sorts
-- as the cheapest tier (price 0). Super Admin can freely change the cap
-- later via the existing Edit Tier flow -- price_locked only blocks price
-- edits, not cap edits.
insert into tiers (id, name, monthly_price, annual_price, member_cap, price_locked) values
  ('00000000-0000-4000-8000-000000000104', 'Free/Test', 0, 0, 30, true)
on conflict (id) do nothing;

-- ============================================================================
-- run_saas_billing_lifecycle_job(): mirrors run_subscription_lifecycle_job()'s
-- (0021_subscription_lifecycle_cron.sql) exact shape -- no SECURITY DEFINER
-- (pg_cron invokes as the role that called cron.schedule(), already
-- full-access), absolute-date computation (never delta/incremental, so a
-- missed run self-corrects on the next run with no backfill), most-
-- progressed-state-first ordering so no row is touched twice in one run, an
-- inner BEGIN...EXCEPTION block (implicit savepoint) so a failure still
-- commits its own job_runs/log_audit_event failure record.
--
-- State-transition thresholds, derived from FR-131/FR-133 (extrapolation
-- from the FR text -- the PRD doesn't give an exact day-count for
-- past_due, only that it follows the payment-due-notice reminder schedule
-- "on the default 1, 3, 5 days after due" before the gym moves to
-- grace_period):
--   active -> past_due: the anchor date has passed unpaid.
--   past_due -> grace_period: anchor + 5 days (5 = the last day of the
--     1/3/5-day reminder schedule -- "retries exhausted").
--   grace_period -> suspended: anchor + 5 + saas_grace_period_days.
--
-- The suspended transition also sets gyms.status = 'suspended' (the
-- existing gym_status enum/column from 0002_gyms_and_tiers.sql) in the same
-- UPDATE -- this is the load-bearing linkage point Story 11.4 depends on
-- ("suspended status (Story 11.2) ... denied at the RLS/auth-hook layer via
-- private.current_gym_status()"). gym_status is the one signal Story 11.4
-- (and the one existing live consumer, create_staff_member()'s
-- current_gym_status() = 'active' check, 0063_staff_edit_deactivation.sql)
-- already reads -- no second suspension signal is invented here.
--
-- Free/Test tier gyms are NOT special-cased or skipped -- AC #3 and
-- epics.md's Story 11.6 both require the full lifecycle to keep running at
-- the 0 XAF price point, exercising the same code paths as a paying gym.
-- This job has no notion of "was this gym actually charged" (this
-- migration intentionally adds no billing/payment columns) -- it is purely
-- a clock, driven only by saas_billing_anchor_date. Deliberate scope
-- boundary: Story 11.3 owns actually creating saas_billing_payments rows
-- and resetting this state on a successful payment.
-- ============================================================================
create function run_saas_billing_lifecycle_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    -- See this trigger's own comment (above) for why this bypass exists --
    -- reset to 'false' before the block ends on every path (success and
    -- exception) so it never leaks into any later statement of the caller's
    -- own transaction.
    perform set_config('app.saas_billing_lifecycle_job_bypass', 'true', true);

    -- 1. suspended (checked first: catches any gym whose grace period has
    --    already elapsed, regardless of which status it's currently in).
    --    Excludes gyms already manually 'deactivated' by a Super Admin --
    --    that is a deliberate, distinct admin action this billing clock
    --    must not silently overwrite (code review, 2026-08-27).
    update gyms
    set saas_billing_status = 'suspended', status = 'suspended'
    where saas_billing_status in ('active', 'past_due', 'grace_period')
      and status <> 'deactivated'
      and (saas_billing_anchor_date + 5 + saas_grace_period_days) < current_date;

    -- 2. grace_period (retries exhausted, grace hasn't elapsed yet -- rows
    --    already flipped to 'suspended' above no longer match this WHERE).
    update gyms
    set saas_billing_status = 'grace_period'
    where saas_billing_status in ('active', 'past_due')
      and (saas_billing_anchor_date + 5) < current_date;

    -- 3. past_due (anchor date has passed unpaid, retries not yet exhausted).
    update gyms
    set saas_billing_status = 'past_due'
    where saas_billing_status = 'active'
      and saas_billing_anchor_date < current_date;

    perform set_config('app.saas_billing_lifecycle_job_bypass', 'false', true);

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('saas_billing_lifecycle', v_started_at, now(), 'success');
  exception when others then
    perform set_config('app.saas_billing_lifecycle_job_bypass', 'false', true);

    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('saas_billing_lifecycle', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'saas_billing_lifecycle_job_failure',
      p_system_actor_label => 'system:saas_billing_lifecycle_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- Never called from application code, matching run_subscription_lifecycle_job()'s
-- own discipline -- see that function's migration comment for why the real
-- nightly invocation runs as `postgres`, not `service_role`.
revoke execute on function run_saas_billing_lifecycle_job() from public;

-- Same "02:00 Africa/Douala" (= '0 1 * * *' UTC, no DST ever) nightly slot
-- as subscription_lifecycle -- no reason emerged during dev-story to
-- stagger it. cron.schedule() upserts by job name -- safe across repeated
-- `db reset`s.
select cron.schedule(
  'saas_billing_lifecycle',
  '0 1 * * *',
  $$ select run_saas_billing_lifecycle_job(); $$
);
