---
baseline_commit: fd074bee858a525a77d7ff03501d2a20fee6423a
---

# Story 3.1: Subscription Lifecycle Cron Job

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want member subscriptions to automatically transition through their lifecycle states,
so that I don't have to manually track every member's expiry.

## Acceptance Criteria

1. **Given** a member's expiry date is 7 days away, **when** the nightly pg_cron job runs at 02:00 Africa/Douala, **then** their status transitions to `expiring_soon`. [Source: epics.md#Story 3.1]
2. **Given** a member's expiry date has passed, **when** the job runs the next day, **then** their status transitions to `grace_period` for the gym-configured duration (default 3 days). [Source: epics.md#Story 3.1]
3. **Given** a member's grace period has ended without renewal, **when** the job runs, **then** their status transitions to `expired`, they lose gym access, and they retain app account/history. [Source: epics.md#Story 3.1]
4. **Given** the job fails (timeout or infrastructure error), **when** the failure occurs, **then** it is logged to the audit log and surfaced as an alert on the Super Admin dashboard, with no automatic retry and no retroactive backfill on the next successful run. [Source: epics.md#Story 3.1]

## Scope Notes — Read Before the Tasks

**This is the first pg_cron job in the entire project — no existing spike, precedent, or extension has ever been enabled (verified: `grep -rn "create extension" supabase/migrations/` returns nothing). Read all four notes below before writing any SQL.**

### Scope Note #1 — This story is backend/DB only. No dashboard Subscriptions page.

`epics.md`'s FR Coverage Map assigns the Subscriptions dashboard page (FR-085) to **Epic 4, Story 4.8** ("Subscriptions page + manual renewal"), not this story. There is no `apps/dashboard/app/(dashboard)/subscriptions/` directory and no `services/subscriptions.ts` yet — do not create them. This story's only UI surface is a small addition to the **existing** Super Admin `/metrics` page (AC #4's "surfaced as an alert on the Super Admin dashboard" — see Scope Note #3). Everything else is a migration + pgTAP tests.

### Scope Note #2 — Design the transition logic as absolute-date checks, not incremental steps. This is what makes "no retroactive backfill" true for free.

AC #4 requires "no automatic retry, and no retroactive backfill on the next successful run." The natural way to accidentally violate this is to write the job as "how many days has it been since the last successful run" delta logic. **Don't do that.** Instead, each of the three transitions is a plain `UPDATE ... WHERE` computed from `current_date` and the row's own `expiry_date`/the gym's `grace_period_days` — nothing about "how long the job has been failing" ever enters the query. This means a job that failed for 3 nights in a row and then succeeds on the 4th will correctly jump a member straight from `active` to `expired` in one run if that's where today's date puts them (no artificial staged catch-up), which is simultaneously the correct business behavior and the literal absence of "backfill" logic.

Run the three `UPDATE`s in this exact order inside the function (most-progressed state first), so no row is touched twice in the same run:

```sql
-- 1. expired (checked first: catches anyone whose grace period has already
--    elapsed, regardless of what status they're currently sitting in)
update subscriptions s
set status = 'expired'
from gyms g
where s.gym_id = g.id
  and s.status in ('active', 'expiring_soon', 'grace_period')
  and s.expiry_date is not null
  and (s.expiry_date + g.grace_period_days) < current_date;

-- 2. grace_period (expiry has passed, but grace hasn't elapsed yet --
--    rows already flipped to 'expired' above no longer match this WHERE)
update subscriptions
set status = 'grace_period'
where status in ('active', 'expiring_soon')
  and expiry_date is not null
  and expiry_date < current_date;

-- 3. expiring_soon (still active, expiry within 7 days)
update subscriptions
set status = 'expiring_soon'
where status = 'active'
  and expiry_date is not null
  and expiry_date <= current_date + 7;
```

`expiry_date is not null` is not defensive boilerplate — `pay_per_session` subscriptions have `expiry_date = null` (migration `0018_member_management.sql`'s `enforce_subscription_expiry_matches_plan_type` trigger guarantees this), and a `null` compared with `<`/`<=` is `unknown`, which Postgres treats as "don't match" — so pay-per-session rows are correctly and automatically excluded without a `plan_type` join. Keep the explicit `is not null` guards anyway (matches this project's own documented discipline against implicit-NULL three-valued-logic bugs — see `0018`'s trigger comment referencing Story 2.2's Round 2 review finding a real bug from exactly this class of mistake).

### Scope Note #3 — No UX mockup exists for the Super Admin "job failure" alert. Here is the resolved design.

Checked `EXPERIENCE.md` end to end: SA-05 (Platform Metrics)'s only mockup is three read-only stat cards plus a one-line summary — no failure banner, no alert component. The only place `pg_cron` appears in any mockup is AD-12 (the **gym-scoped** Audit Log page, Epic 7, not built yet), showing a generic `System / pg_cron run / — / Success` row sourced from that gym's own `audit_log`. There is no existing precedent for a platform-wide, cross-tenant job-status view.

**Resolved design (apply this, don't re-litigate it):**
- Do **not** add a new RLS SELECT policy on `job_runs` for Super Admin. `job_runs` has been RLS-deny-all-with-zero-policies since Story 1.4 (`0008_job_runs.sql`), and this project's own established pattern for Super Admin cross-tenant reads is an aggregate-only `SECURITY DEFINER` function that self-enforces `private.is_super_admin()` internally (`platform_metrics()`/`gym_member_count()`, `0011_super_admin_tier_gym_lifecycle.sql`) — not a broadened row-level policy. Follow that same pattern here: a new `super_admin_job_failures()` function, `security definer`, `stable`, self-checking `private.is_super_admin()` and raising `'permission denied'` if false (copy the exact guard shape from `platform_metrics()`), returning recent `job_runs` rows where `status = 'failure'`, ordered `started_at desc`, capped at a small limit (20 is plenty at this project's scale — no pagination needed).
- Wire it into **`apps/super-admin/app/(admin)/metrics/page.tsx`** (the existing SA-05 page) as a second, separate section below the stat cards — a small list/table (job name, started/finished timestamps, error text) rendered only if the function returns ≥1 row; nothing rendered otherwise (no empty state needed — an empty state for "no failures" would just be visual noise on a page whose default, common case is "nothing to show here"). Add the new service function to `apps/super-admin/services/metrics.ts` (co-located with `getPlatformMetrics`, same file, same `mapAndLog` error-handling convention) — don't create a new service file for one function.
- i18n: `apps/super-admin/locales/en.json`/`fr.json` already have a `"metrics"` block (`title`, `totalGyms`, `totalMembers`, `totalPayments`, `summary`) — **this is a per-app locale file, not shared via `packages/types`** (verified: `packages/types/src/locales/en.json` has no `metrics` key at all, despite `architecture.md`'s claim that admin-surface locale strings are centrally shared — same class of architecture.md drift already recorded for the mobile app's directory path in `docs/decisions.md`, 2026-07-17 entry). Add the new failure-banner strings as siblings inside the existing `"metrics"` object in both files.
- The audit log write (AC #4's other half — "logged to the audit log") is separate and already fully covered by `log_audit_event()` (`0007_audit_log.sql`) — call it with `p_gym_id => null` (a platform-wide, not gym-scoped record, exactly like `job_runs` itself), `p_system_actor_label => 'system:subscription_lifecycle_job'`. Super Admin can already read it via the existing `super_admin_read_audit_log` policy (`0012_super_admin_data_access_escalation.sql`) — no new audit_log policy needed either.

### Scope Note #4 — The exception-handling shape is the trickiest part of this story. Use an inner `BEGIN...EXCEPTION` block, not a bare top-level one.

A plpgsql `BEGIN ... EXCEPTION WHEN OTHERS ... END` block creates an implicit savepoint: if the guarded code raises, Postgres rolls back only to the start of that block (undoing the three partial `UPDATE`s), and the exception handler's own code (the `job_runs`/`log_audit_event` failure writes) still runs and commits normally as part of the same outer transaction. Get this wrong (e.g., let the exception propagate all the way out of the function uncaught) and the failure record you're trying to write for AC #4 gets rolled back along with everything else — the job fails with literally nothing recorded anywhere, which is worse than the outcome AC #4 exists to prevent. Structure:

```sql
create function public.run_subscription_lifecycle_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
begin
  begin
    -- the three UPDATEs from Scope Note #2, in order

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
```

No `security definer` needed on this function — `pg_cron` invokes scheduled jobs as the role that called `cron.schedule()` (this migration, running as `postgres`), which already has full table access; `security definer` here would be a no-op since the function's owner is already `postgres`. `revoke execute ... from public` after creating it (matching every other function in this codebase) and do not grant `execute` to `authenticated`/`anon` at all — this function is only ever meant to run via `cron.schedule()` or direct `postgres`/`service_role` invocation during manual verification, never from application code.

## Tasks / Subtasks

- [x] **Task 1: Enable `pg_cron` and schedule the job** (AC #1)
  - [x] New migration `supabase/migrations/0021_subscription_lifecycle_cron.sql` (next sequential number after `0020_member_goal_experience_plan_confirmation.sql`). Start with `create extension if not exists pg_cron with schema extensions;` (matches `supabase/config.toml`'s `extra_search_path = ["public", "extensions"]`, keeping extensions out of the `public` schema per Supabase's own convention). Verify hands-on locally (`supabase db reset`) that this succeeds — this is the first extension ever enabled in this project, don't assume it works without confirming.
  - [x] "02:00 Africa/Douala" — Cameroon (WAT) is UTC+1 year-round, no DST. 02:00 WAT = 01:00 UTC, every day, with no seasonal adjustment ever needed. `pg_cron` schedules run in the server's `cron.timezone` setting, which defaults to UTC — schedule as `cron.schedule('subscription_lifecycle', '0 1 * * *', $$ select run_subscription_lifecycle_job(); $$);`, not `'0 2 * * *'` (that would run at 02:00 UTC = 03:00 WAT, a real one-hour bug that would only be caught by someone checking actual run timestamps against real WAT time). `cron.schedule()` upserts by job name — safe to run this migration repeatedly (e.g. across `supabase db reset`s) without creating duplicate scheduled jobs.

- [x] **Task 2: The lifecycle transition function** (AC #1, #2, #3, #4; Scope Notes #2, #4)
  - [x] Implement `public.run_subscription_lifecycle_job()` exactly per Scope Note #4's shape: the three ordered `UPDATE`s from Scope Note #2 inside an inner `BEGIN...EXCEPTION WHEN OTHERS` block, `job_runs` success/failure row on either path, `log_audit_event()` call on the failure path only.
  - [x] `revoke execute on function run_subscription_lifecycle_job() from public;` — no grant to `authenticated`/`anon` (Scope Note #4).

- [x] **Task 3: Close the `subscriptions` expiry/start-date tech debt** (optional, recommended — flagged by the Epic 2 retrospective as "the natural fit for 3.1")
  - [x] Add `alter table subscriptions add constraint subscriptions_expiry_after_start check (expiry_date is null or expiry_date > start_date);` in the same migration. This has been an open gap since Story 1.3 (`deferred-work.md`), still unresolved through Epic 2, explicitly called out in `epic-2-retro-2026-07-18.md`'s Action Items as this story's job to close. Verify no existing seeded/fixture data violates it before adding (pilot has no real production data yet, but check local dev/test fixtures don't break).

- [x] **Task 4: Super Admin job-failure alert** (AC #4; Scope Note #3)
  - [x] Add `public.super_admin_job_failures()` to the same migration — `security definer`, `stable`, `set search_path = public`, self-enforcing `private.is_super_admin()` (copy `platform_metrics()`'s exact guard: `if not private.is_super_admin() then raise exception 'permission denied'; end if;`). Returns `table (id uuid, job_name text, started_at timestamptz, finished_at timestamptz, error text)` for `job_runs` rows where `status = 'failure'`, `order by started_at desc`, `limit 20`.
  - [x] Add a `getRecentJobFailures()` function to `apps/super-admin/services/metrics.ts` (same file as `getPlatformMetrics`, same `{ data, error }` / `mapAndLog` shape) calling the new RPC.
  - [x] In `apps/super-admin/app/(admin)/metrics/page.tsx`, render a second section below the existing stat-card grid: only if `getRecentJobFailures()` returns ≥1 row, show a small list (job name, started/finished timestamps formatted per locale, error text). Render nothing if the list is empty (Scope Note #3 — no empty-state copy needed here).
  - [x] Add the new strings as siblings inside the existing `"metrics"` block in both `apps/super-admin/locales/en.json` and `fr.json` (e.g. a section title and column labels) — do not create a new top-level locale block for this.

- [x] **Task 5: pgTAP tests**
  - [x] New `supabase/tests/subscription_lifecycle_cron.test.sql`. Seed fixture subscriptions covering each transition boundary directly (call `run_subscription_lifecycle_job()` — don't wait for real cron timing):
    - `active`, `expiry_date = current_date + 7` → becomes `expiring_soon`.
    - `active`, `expiry_date = current_date + 10` → stays `active` (not yet in window).
    - `active`/`expiring_soon`, `expiry_date = current_date - 1` → becomes `grace_period`.
    - `grace_period`, `expiry_date + gym's grace_period_days < current_date` → becomes `expired`.
    - `grace_period`, still within the grace window → stays `grace_period`.
    - A `pay_per_session` subscription (`expiry_date = null`) → untouched by any transition, regardless of status.
    - Idempotency: calling the function twice in a row produces the same end state the second time (no row flips twice, no error).
  - [x] The failure-branch (`job_runs` row with `status = 'failure'` + the audit log write) is hard to force via pgTAP without an artificial test-only hook, which this project's conventions avoid adding to production code. Don't invent one — verify this path by manual/hands-on means in Task 6 instead (e.g. temporarily and locally forcing an error inside a rolled-back transaction, or a targeted `DO` block), and document what was actually verified in the Debug Log. This is an accepted, explained test-coverage gap, not a silent one.
  - [x] `rls_tenant_isolation.test.sql`'s existing `select is((select count(*) from job_runs)::int, 0, 'job_runs: 0 rows, no business policy yet')` assertion (line ~78) **does not need to change** — this story adds a `SECURITY DEFINER` function for Super Admin reads, not a raw RLS policy on `job_runs`, so the deny-all-via-direct-table-access behavior that assertion checks is still exactly true.

- [x] **Task 6: Validation and manual verification**
  - [x] `pnpm run typecheck` (4/4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] Hands-on: `select run_subscription_lifecycle_job();` directly against the local Supabase instance with real seeded fixtures spanning all three transitions plus the pay-per-session no-op — confirm the resulting `subscriptions.status` values and the `job_runs` success row, independent of pgTAP.
  - [x] Hands-on: verify the failure path directly (see Task 5's note) and confirm both the `job_runs` failure row and the `audit_log` row (`action_type = 'subscription_lifecycle_job_failure'`) are written, then confirm the transaction still commits (the failure records aren't themselves rolled back).
  - [x] Hands-on: call `super_admin_job_failures()` as a simulated `super_admin` session (same `set_config('request.jwt.claims', ...)` technique used throughout this project) and confirm it returns the seeded failure row(s); call it as a non-super-admin session and confirm it raises `permission denied`.
  - [x] Confirm `cron.schedule()` actually registered the job: query `cron.job` locally and check the `schedule` column reads `'0 1 * * *'` and `command` calls the right function.
  - [x] `supabase test db` — zero regressions against the 227/227 baseline from Story 2.8, plus this story's new test file's assertions.
  - [x] Apply the Epic 2 retrospective's new standing review step (Action Item #2) to this story's own review: explicitly enumerate which roles can reach `super_admin_job_failures()` (should be Super Admin only) and confirm that's correct before the first review round is considered closed — this story is exactly the kind of new RLS/cron surface that action item was written for.

### Review Findings

Three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) reviewed the full diff. Every High/Medium-severity claim was independently re-verified against the running local DB (and, for the pg_cron role question, external documentation) before being accepted or refuted — several plausible-sounding claims from layers without full project access turned out to be wrong once checked against actual runtime state.

- [x] [Review][Decision] Should `run_subscription_lifecycle_job()` exclude subscriptions belonging to `suspended`/`deactivated` gyms? — **Resolved by user: no, process all gyms regardless of status.** Subscription status decay is a per-member fact independent of the gym's administrative state; if a suspended gym is later reinstated, member subscription statuses already reflect reality with no backfill needed. No code change required — matches current implementation as shipped.

- [x] [Review][Patch] `getRecentJobFailures()`'s `error` was silently discarded on the Metrics page, unlike `getPlatformMetrics()` two lines above [apps/super-admin/app/(admin)/metrics/page.tsx] — applied: now renders `common.loadError` if the RPC errors.
- [x] [Review][Patch] Two independent RPC calls (`getPlatformMetrics`, `getRecentJobFailures`) were awaited sequentially [apps/super-admin/app/(admin)/metrics/page.tsx] — applied: now run via `Promise.all` alongside the translation load.
- [x] [Review][Patch] Server-rendered failure timestamps used `toLocaleString()` with no locale argument, bypassing the page's own `getRequestLocale()`/i18n plumbing (French users would see server-locale dates) [apps/super-admin/app/(admin)/metrics/page.tsx] — applied: now passes `locale` explicitly.
- [x] [Review][Patch] Raw `sqlerrm` rendered unstyled/untruncated in the failure table, risking layout blowout on a long Postgres error [apps/super-admin/app/(admin)/metrics/page.tsx] — applied: added `whitespace-pre-wrap break-words max-w-sm`.
- [x] [Review][Patch] Inconsistent schema qualification — `create function public.xxx()` but bare `revoke/grant ... on function xxx` [supabase/migrations/0021_subscription_lifecycle_cron.sql] — applied: removed the `public.` prefix from both `CREATE FUNCTION` statements to match this codebase's established convention (0007/0011 never qualify with `public.`).
- [x] [Review][Patch] `JobFailure.error` field name collided with the enclosing `{ data, error }` result tuple's own `error` field [apps/super-admin/services/metrics.ts] — applied: renamed to `errorMessage`.
- [x] [Review][Patch] New `subscriptions_expiry_after_start` CHECK constraint shipped with zero test coverage [supabase/tests/subscription_lifecycle_cron.test.sql] — applied: added a `throws_like` (equal dates) / `lives_ok` (one-day gap) pair against a dedicated fixture gym.
- [x] [Review][Patch] Exact-day transition boundaries (`expiry_date = current_date`; grace period elapsing exactly today) were untested [supabase/tests/subscription_lifecycle_cron.test.sql] — applied: added two fixtures (M7/M8) + assertions documenting the intended "strictly before today" reading of AC #2/#3's "has passed"/"has ended" wording.

- [x] [Review][Defer] No path back to `active` after a renewal while a subscription sits in `expiring_soon`/`grace_period` — deferred, by design: Epic 4 Story 4.8 owns renewal (Scope Note #1); this story's only job is forward decay.
- [x] [Review][Defer] Double-fault inside the exception handler's own recovery statements isn't further guarded (a failure of the `job_runs`/`log_audit_event` writes *inside* the `EXCEPTION` block would itself propagate uncaught) — deferred, accepted low-probability risk: `log_audit_event()` deliberately doesn't swallow exceptions by its own documented design, and a second nested savepoint layer for this narrow case isn't currently justified.
- [x] [Review][Defer] No advisory-lock/concurrency guard against a manual verification call racing the real scheduled run — deferred, mitigated in practice: the job's absolute-date design is idempotent (a duplicate run just no-ops), and no AC requires locking.
- [x] [Review][Defer] `gyms.timezone` is joined but unused in the date math — deferred, already a deliberate, documented story-level simplification (Dev Notes: fixed WAT arithmetic); only a gym explicitly configured to plain `UTC` (not one of the four WAT-equivalent African zones) would see any discrepancy.
- [x] [Review][Defer] `gyms.grace_period_days` has no DB-level CHECK constraint, only the dashboard's Zod 1–30 bound — deferred, pre-existing gap since the column's introduction (Story 1.2/0002), not introduced by this diff; this story just newly makes it load-bearing in arithmetic.

**Dismissed as noise or refuted (13):** same-day CHECK constraint forbidding `expiry_date == start_date` (matches Task 3's own explicit spec); CHECK constraint added without `NOT VALID` (matches 0018's own established convention, and pilot has no production data yet); "exception handler can throw uncaught because `log_audit_event` isn't schema-qualified" (refuted — hands-on forced-failure test this session confirmed both `job_runs` and `audit_log` rows commit); "`grace_period_days` can be NULL" (refuted — column is `not null default 3`); `super_admin_job_failures()`'s hardcoded `limit 20` (exactly what Scope Note #3 specifies); failure-branch pgTAP gap (already a deliberate, documented Task 5 decision); table markup missing `scope="col"`/`<caption>` (matches every other `<table>` in both dashboard apps, not a deviation); pg_cron's own `cron.job_run_details` always showing "succeeded" (exactly why this story built its own `job_runs`/alert surface); "`create extension pg_cron with schema extensions` will fail" (refuted — Supabase's local image preloads `pg_cron` via `shared_preload_libraries`, already in `pg_catalog` before any migration runs, `IF NOT EXISTS` is a no-op, reproduced 3×); "Debug Log claims are likely inaccurate" and "239/239 claims can't be true" (both refuted alongside the above — re-confirmed 243/243 after the patch additions); unrelated `.env` `OTP_PROVIDER` change in the File List (already self-disclosed and explained as unrelated, not a hidden scope violation); "pg_cron runs as `service_role`, blocking the real job" (refuted via direct `cron.job.username` query plus independent docs — see new `docs/decisions.md` entry, 2026-07-18, so the remaining two planned pg_cron jobs don't repeat the same unverified assumption).

## Dev Notes

- **This is the first `pg_cron` job and the first Postgres extension enabled in this project.** No existing spike, precedent, or config to model beyond the general SECURITY DEFINER/RLS-self-enforcement conventions already established. If `create extension pg_cron` behaves differently locally than expected (schema, required grants), record what was actually needed in `docs/decisions.md`, the way Story 2.1 recorded its six real config-vs-docs surprises for the Send SMS Hook.
- **No dashboard Subscriptions page in this story** (Scope Note #1) — that's Epic 4, Story 4.8. Don't build one.
- **AC #3's "they lose gym access" and "they retain app account/history" describe what the `expired` status *means*, not something this story enforces.** Actually denying check-in for `expired` members is Story 3.4/3.8's job (they read `subscriptions.status`, which this story is responsible for keeping correct) — this story's only obligation is the status transition itself, not gating any check-in/access-control path (none exists yet; `attendance_events` has no business policies or check-in logic until Epic 3's later stories).
- **Timezone arithmetic is fixed, not computed at runtime**: Africa/Douala (WAT) is UTC+1 with no DST, so `'0 1 * * *'` in `pg_cron`'s default UTC schedule is permanently correct for "02:00 Africa/Douala" — no `timezone()` conversion needed inside the function body, since a job firing at 01:00 UTC / 02:00 WAT falls on the same calendar date in both zones (no midnight-boundary edge case here).
- **No new RLS policy on `subscriptions` or `job_runs`** — the cron function runs as `postgres` (via `pg_cron`, which bypasses RLS as a superuser-equivalent role), and Super Admin's `job_runs` visibility goes through a new `SECURITY DEFINER` function, following the exact precedent `platform_metrics()`/`gym_member_count()` already established in `0011_super_admin_tier_gym_lifecycle.sql`, not a broadened SELECT policy.
- **`log_audit_event()`'s system-caller path already exists and needs no changes** — calling it with no `auth.uid()` session (true inside a `pg_cron`-invoked function) already falls into its documented `p_system_actor_label` branch (`0007_audit_log.sql`). Just call it correctly; don't modify it.
- Epic 2 retrospective (`epic-2-retro-2026-07-18.md`) Decision 4 confirmed Epic 3's assumptions hold: `subscriptions.expiry_date` exists and is populated correctly by Epic 2 for every non-pay-per-session plan — this story can rely on that without re-verifying it from scratch.
- The retrospective's Action Item #2 (RLS role-gate checklist as a standing review step) applies directly to this story's new `super_admin_job_failures()` function — see Task 6's last bullet.

### Project Structure Notes

New files:
```
supabase/migrations/0021_subscription_lifecycle_cron.sql   # extension, function, cron.schedule, CHECK constraint, super_admin_job_failures()
supabase/tests/subscription_lifecycle_cron.test.sql        # pgTAP
```

Modified files:
```
apps/super-admin/services/metrics.ts        # + getRecentJobFailures()
apps/super-admin/app/(admin)/metrics/page.tsx  # + failure-list section
apps/super-admin/locales/en.json / fr.json  # + strings inside existing "metrics" block
```

No changes to `apps/dashboard`, `apps/mobile`, or `packages/types` — this story is entirely a new migration plus a small addition to the existing Super Admin Metrics page.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — literal AC wording
- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-07-18.md] — Action Items #2 (RLS role-gate checklist), #3 (pg_cron is new, no precedent), #4 (subscriptions CHECK constraint tech debt), and Decision 4 (Epic 3's assumptions about `subscriptions.expiry_date` confirmed sound)
- [Source: supabase/migrations/0004_subscriptions_and_plans.sql] — `subscriptions`/`plans` schema this story transitions
- [Source: supabase/migrations/0018_member_management.sql] — `enforce_subscription_expiry_matches_plan_type` trigger guaranteeing `expiry_date is null` iff `pay_per_session`; `gym_staff_read_own_subscriptions`/`manager_or_owner_update_own_subscriptions` RLS this story does NOT need to touch (cron bypasses RLS entirely)
- [Source: supabase/migrations/0002_gyms_and_tiers.sql] — `gyms.grace_period_days` (default 3, gym-configurable) used by the grace-period transition
- [Source: supabase/migrations/0007_audit_log.sql] — `log_audit_event()`'s system-caller path, called on job failure
- [Source: supabase/migrations/0008_job_runs.sql] — `job_runs` table this story's function writes to and `super_admin_job_failures()` reads from
- [Source: supabase/migrations/0011_super_admin_tier_gym_lifecycle.sql] — `platform_metrics()`/`gym_member_count()`, the exact `SECURITY DEFINER` + self-enforced `private.is_super_admin()` pattern `super_admin_job_failures()` follows
- [Source: apps/super-admin/app/(admin)/metrics/page.tsx, apps/super-admin/services/metrics.ts] — the existing SA-05 page/service this story extends
- [Source: apps/super-admin/locales/en.json#metrics] — existing locale block this story adds sibling keys to (per-app, not shared via packages/types — architecture.md drift, same class as its mobile-path claim)
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions, #Working Decisions] — three-independent-pg_cron-jobs decision, `job_runs` logging convention, JWT-hook/RLS conventions this story's function respects without adding new RLS
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#SA-05, #AD-12] — confirms no mockup exists for a cross-tenant job-failure alert; the resolved design in Scope Note #3 is this story's own synthesized decision, worth a `docs/decisions.md` entry once written (matching this project's established practice for scope decisions made during story creation/implementation)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` (local Docker via WSL, container `supabase_db_gym_os`) — migrations 0001–0021 apply cleanly, including `create extension if not exists pg_cron with schema extensions;`, the first Postgres extension ever enabled in this project. No unexpected schema/grant behavior.
- `select jobname, schedule, command, active from cron.job;` (via `docker exec ... psql`, no local `psql` client available in WSL) confirmed the job registered exactly as intended: `subscription_lifecycle | 0 1 * * * |  select run_subscription_lifecycle_job();  | t`.
- Hands-on transition verification (rolled-back transaction, real seeded fixtures: 1 gym with `grace_period_days = 3`, 6 members/subscriptions spanning every boundary + 1 pay-per-session): `run_subscription_lifecycle_job()` produced `expiring_soon` (expiry = today+7), `active` unchanged (expiry = today+10), `grace_period` (expiry = today-1), `expired` (grace_period row, expiry+grace_period_days < today), `grace_period` unchanged (still within grace window), and `active` unchanged for the pay-per-session row (`expiry_date is null`, no plan_type join needed). Ran the function a second time in the same transaction — identical end state, confirming idempotency independent of pgTAP. One `job_runs` success row per call.
- Hands-on failure-path verification (committed, not rolled back — needed to prove the failure record survives): temporarily replaced `run_subscription_lifecycle_job()`'s body with a forced `raise exception`, called it for real, confirmed both a `job_runs` row (`status = 'failure'`, `error = 'forced_failure_for_manual_verification'`) and an `audit_log` row (`action_type = 'subscription_lifecycle_job_failure'`, `actor_display_name = 'system:subscription_lifecycle_job'`, `metadata = {"error": "forced_failure_for_manual_verification"}`) were written and actually committed. Then ran `supabase db reset` to restore the real function body and clear the forced-failure test rows before running the pgTAP suite.
- Hands-on `super_admin_job_failures()` permission check (`set_config('request.jwt.claims', ...)` simulation, same technique as every other RLS test in this project): a `super_admin`-claim session successfully retrieved the seeded failure row; an `owner`-claim session was rejected with `permission denied` (raised, not null/empty data) — confirms Action Item #2's role-gate checklist: **only `super_admin` can reach this function**.
- `supabase test db`: 15 files, 239 tests (227 baseline + 12 new in `subscription_lifecycle_cron.test.sql`), all passing — zero regressions. `rls_tenant_isolation.test.sql`'s existing `job_runs: 0 rows, no business policy yet` assertion needed no change, confirming the new `SECURITY DEFINER` function doesn't alter direct-table-access deny-all behavior.
- `pnpm run typecheck`: 4/4 packages pass, 0 errors. `node scripts/check-i18n-key-parity.mjs`: 4/4 locale dirs in parity (`apps/super-admin/locales` now 141 keys, up from 136).

### Completion Notes List

- All 4 ACs implemented: AC #1 (7-day-out → `expiring_soon`) and the `pg_cron` schedule itself via Task 1/2; AC #2 (expiry passed → `grace_period` for the gym's configured duration) and AC #3 (`grace_period` elapsed → `expired`) via the three ordered, absolute-date `UPDATE`s in `run_subscription_lifecycle_job()`; AC #4 (failure logged to `audit_log` + surfaced on the Super Admin dashboard, no retry, no backfill) via the inner `BEGIN...EXCEPTION` savepoint pattern plus `super_admin_job_failures()`/the Metrics page's new failure-list section.
- Followed Scope Note #2 exactly: no delta/"days since last run" logic anywhere — every transition is a plain `current_date`/`expiry_date`/`grace_period_days` comparison, which is what makes "no retroactive backfill" true by construction rather than by a special case.
- Followed Scope Note #4's exact function shape (inner `BEGIN...EXCEPTION` savepoint, not a bare top-level handler) — verified hands-on (see Debug Log) that the failure-path writes survive and commit even though the guarded `UPDATE`s themselves roll back to the inner savepoint.
- Task 3's `subscriptions_expiry_after_start` CHECK constraint (Epic 2 retrospective Action Item) added in the same migration; no existing fixture/test data violated it (verified via `supabase db reset` + full `supabase test db` pass).
- Task 5's failure-branch pgTAP gap is accepted and documented exactly as the story anticipated: forcing a real exception through pgTAP would need a test-only hook this project's conventions avoid adding to production code, so that path was instead verified hands-on (see Debug Log) rather than left silently uncovered.
- No dashboard Subscriptions page was built (Scope Note #1) — this story's only UI surface is the small failure-list addition to the existing Super Admin `/metrics` page, as scoped.
- `super_admin_job_failures()` renders nothing when it returns 0 rows (Scope Note #3's "no empty-state copy needed") — the Metrics page's new section is wrapped in `jobFailures && jobFailures.length > 0`.

### File List

**New:**
- `supabase/migrations/0021_subscription_lifecycle_cron.sql`
- `supabase/tests/subscription_lifecycle_cron.test.sql`

**Modified:**
- `apps/super-admin/services/metrics.ts` (+ `getRecentJobFailures()`)
- `apps/super-admin/app/(admin)/metrics/page.tsx` (+ job-failure list section)
- `apps/super-admin/locales/en.json` (+ `metrics.jobFailures*` keys)
- `apps/super-admin/locales/fr.json` (+ `metrics.jobFailures*` keys)
- `supabase/.env` (local, gitignored — `OTP_PROVIDER` default flipped to `twilio_whatsapp` per the user's explicit request and `docs/decisions.md`'s pre-existing 2026-07-15 channel-priority decision, which had never actually been applied to this file; unrelated to this story's ACs, done at session start)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)
- `docs/decisions.md` (+ 2026-07-18 entry correcting the pg_cron-execution-role assumption, added during code review)
- `_bmad-output/implementation-artifacts/deferred-work.md` (+ 5 deferred findings from code review)

## Change Log

- 2026-07-18: Story implemented — first `pg_cron` job and first Postgres extension (`pg_cron`) in this project. New migration `0021_subscription_lifecycle_cron.sql` adds `run_subscription_lifecycle_job()` (three ordered absolute-date `UPDATE`s: `expired` → `grace_period` → `expiring_soon`, inner `BEGIN...EXCEPTION` savepoint writing `job_runs`/`audit_log` on failure), schedules it via `cron.schedule('subscription_lifecycle', '0 1 * * *', ...)` (01:00 UTC = 02:00 Africa/Douala, no DST), adds the `subscriptions_expiry_after_start` CHECK constraint (closing an Epic 2 retrospective action item), and adds `super_admin_job_failures()` (SECURITY DEFINER, self-enforced `is_super_admin()`, same pattern as `platform_metrics()`). Wired a new failure-list section into the existing Super Admin `/metrics` page (`getRecentJobFailures()` + EN/FR locale keys), rendered only when failures exist. All 4 ACs satisfied; 239/239 pgTAP tests pass (227 baseline + 12 new, zero regressions); typecheck (4/4 packages) and i18n-parity clean. The failure-branch's pgTAP coverage gap is deliberate and documented (Task 5) — verified hands-on instead (see Debug Log), including confirming the failure records actually commit. Status set to `review`.
- 2026-07-18: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, run in parallel). Several severe-sounding claims from layers without full project access were investigated and refuted against the actual running DB and external documentation, not accepted at face value — most notably a claim that `create extension pg_cron with schema extensions` would fail (refuted: Supabase's local image preloads `pg_cron` via `shared_preload_libraries`, already registered in `pg_catalog`, `IF NOT EXISTS` is a no-op) and a claim that production `pg_cron` jobs run as `service_role` rather than `postgres`, which would have silently broken the real nightly job via a permission-denied on every invocation (refuted via a direct `cron.job.username` query plus independent pg_cron documentation; a pre-existing, unverified comment in `audit_log_immutable.test.sql` was the source, corrected in a new `docs/decisions.md` entry for the two remaining planned pg_cron jobs). 8 real patch findings applied: Metrics page now surfaces `getRecentJobFailures()` fetch errors (previously silently dropped), the two RPC calls now run via `Promise.all`, failure timestamps now render in the request's locale (previously server-locale only), long error text now wraps/truncates instead of blowing out the table layout, `run_subscription_lifecycle_job()`/`super_admin_job_failures()` schema-qualification was made consistent with this codebase's convention, `JobFailure.error` was renamed to `errorMessage` to avoid colliding with the enclosing result tuple's own `error` field, and 4 new pgTAP assertions were added (the `subscriptions_expiry_after_start` CHECK boundary, and the two exact-day transition boundaries) — plan count 12→16, suite now 243/243. One decision-needed finding (should suspended/deactivated gyms' subscriptions be excluded from nightly processing?) was resolved by the user: no, process all gyms regardless of status — matches the implementation as shipped, no code change. 5 low-priority findings deferred to `deferred-work.md` (renewal reset path, exception-handler double-fault, concurrency guard, per-gym timezone, `grace_period_days` DB-level bound); 13 findings dismissed as noise, spec-compliant-by-design, or refuted. `pnpm run typecheck`/i18n-parity re-verified clean. Status set to `done`.
