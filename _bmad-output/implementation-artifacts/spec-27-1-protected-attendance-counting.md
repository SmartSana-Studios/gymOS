---
title: '27-1 Protected attendance counting: stored visit day, counting views, reader allowlist'
type: 'feature'
created: '2026-11-15'
status: 'ready-for-dev'
baseline_commit: ''
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Attendance is counted straight off `attendance_events`, so a visit voided later (27.3) would still be counted by any query that forgot the filter, and the "today" count uses the UTC day, so a Douala check-in between 00:00 and 01:00 local lands on yesterday. Epics 28, 30 and 31 need one protected, timezone-stable place to count from.

**Approach:** Add a stored gym-local `visit_day` and a nullable `voided_at` (always null until 27.3), a single `private.gym_local_date` helper, the views `attendance_counted` and `member_visit_days`, base-table policies that hide voided rows, and re-point the occupancy count and the Attendance page at the view. Add two checks that fail any new base-table reader of `attendance_events`. Nothing a member or desk sees changes, except the page's "today" count moving to the gym-local day.

## Boundaries & Constraints

**Always:** The AC text in `epics.md` "Story 27.1" is the acceptance baseline; this spec only adds the code facts found at planning time. `voided_at` is the ONLY void column here (`voided_by`, `void_reason`, `source`, `entered_by` are 27.2). Backfill uses the gym's current `gyms.timezone` with `private.gym_today`'s fallback (null, empty or invalid zone means UTC). `visit_day` is written once and never updated. Views are `security_invoker = true`, explicit column list, no `select *`, SELECT to `authenticated` only. New functions revoke EXECUTE from `public` and `anon` in the same migration file (check:migrations). Rollback script `scripts/rollback-NNNN-attendance-counting.sql`. Existing pgTAP suites pass without fixture edits. Migration number is the next free at merge time (files end at 0172, so 0173); never renumber later.

**Never:** No change to `check_in()`, `check_out*`, the auto-timeout job, the one-open index or the 0111 write revokes (27.2 owns them). No `entered_by`, `source` or other 27.2 columns. No mobile code change (the two member-app readers stay on the base table, allowlisted). No change to the Daily Log's UTC date-range filter (only its source becomes the view). No `dirty_from` or engagement objects.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backfill, Douala | check-in 23:30 UTC, zone `Africa/Douala` | `visit_day` is the next local date | N/A |
| Backfill, UTC / bad zone | zone `UTC`, null, empty or invalid | same UTC date; invalid zone falls back to UTC, same answer as `gym_today` | no exception |
| Offline replay | scan stamped 23:50 Sunday, synced 00:20 Monday | `visit_day` is Sunday (from the recorded `checked_in_at`) | N/A |
| Insert without `visit_day` | any role or function, incl. postgres fixtures | BEFORE INSERT trigger sets it | fixtures need no edit |
| Update `visit_day` | any UPDATE changing it | raises | exception |
| Voided row (fixture as postgres) | `voided_at` set | hidden from member and staff base reads, both views; service_role still excluded by the views | N/A |
| Cross-tenant / suspended / anon | gym B owner, suspended gym, `anon` | zero rows; suspended gym zero rows; anon refused | N/A |
| Attendance page "today" | clock 23:30 UTC, zone Douala | check-in at 00:10 local counts for today | Vitest pins it |
| New reader | PR adds `.from("attendance_events")` or a function/policy mentioning the table | node check and pgTAP enumeration fail | names the offender |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0006_attendance.sql`, `0023`, `0028` -- table, one-open index, `client_scan_id`; untouched.
- `supabase/migrations/0124_live_authorization_database.sql:66-72,194` -- live bodies of `gym_staff_read_own_attendance_events` and `member_read_own_attendance_events` (ALTER POLICY, append `and voided_at is null`); `tenant_active_gate` (RESTRICTIVE) unchanged.
- `supabase/migrations/0056_quiet_gym_alert_opt_in_delivery.sql:30` -- `private.gym_occupancy_band(p_gym_id)` is the only occupancy body that counts (`count(*) from attendance_events where gym_id and checked_out_at is null`); `public.member_occupancy_band()` (0124:2031) only delegates to it, so ONE body is re-created, not two. Last redefinition found by grep; signature, grants and result unchanged.
- `supabase/migrations/0157_renewal_start_date_gym_local.sql:20` -- `private.gym_today` fallback to copy: `coalesce(nullif(btrim(tz),''),'UTC')`, `exception when others` falls back to UTC.
- `supabase/migrations/0097_gym_local_period_bounds.sql` + `apps/dashboard/services/gym-settings.ts:146` (`getGymLocalPeriodBounds()`) -- gym-local day bounds already reachable from the app; reuse for "today".
- `apps/dashboard/services/attendance.ts:162,238,301` -- the three base-table reads to move to `attendance_counted`; `todayUtcDate()` at 51/236/290 (line 290 feeds the Daily Log filter and stays).
- `apps/mobile/src/app/(tabs)/history/index.tsx:109`, `apps/mobile/src/services/checkin.ts:53` -- stay on the base table; allowlisted.
- Live readers per local DB (`pg_proc.prosrc`): `check_in`, `check_out`, `check_out_member`, `run_check_in_auto_timeout_job`, `private.gym_occupancy_band` (the AC list omitted the last; include it). Policies mentioning the table: `member_read_own_attendance_events` (qual joins members only); `gym_staff_read_own_attendance_events` and `tenant_active_gate` sit on the table.
- `scripts/check-migration-guardrails.mjs`, `scripts/claim-inventory.baseline.json` (shape `{entries:[], nullUnsafe:[]}`), `scripts/__tests__/*.test.mjs`, `package.json` scripts, `scripts/ci-local.sh:80-84` (static stage), `.github/workflows/ci.yml:51-55` -- the shape and wiring for the new node check.
- `supabase/tests/occupancy_display_admin_attendance_page.test.sql`, `suspension_rpc_coverage.test.sql`, `check_in_session_gate*.test.sql` -- must pass unedited.
- `scripts/prod-apply.mjs:115-120` -- privilege checks that must still pass.
- Local DB `supabase_migrations` head reads 0159 while files reach 0172: bring the local DB to head (`supabase migration up` or db reset) before pgTAP.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0173_attendance_counting.sql` -- add `visit_day`, `voided_at`; `private.gym_local_date`; backfill then NOT NULL; BEFORE INSERT and BEFORE UPDATE triggers; views; policy ALTERs; re-create `private.gym_occupancy_band` over the view; partial indexes `(gym_id, visit_day)` and `(member_id, visit_day)` where `voided_at is null`; verify block -- the data foundation
- [ ] `scripts/rollback-0173-attendance-counting.sql` -- restore policies and the 0056 occupancy body; drop views, triggers, helper, indexes, columns
- [ ] `supabase/tests/attendance_counting.test.sql` -- backfill zones, offline replay, trigger backstop and immutability, view isolation matrix, voided-row hiding, EXPLAIN index use on a 100,000-row fixture, re-asserted 0111 revokes, enumeration of `pg_proc` bodies and `pg_policies` against a committed list, seeded-offender case
- [ ] `scripts/check-attendance-readers.mjs` + `scripts/attendance-readers.baseline.json` + `scripts/__tests__/attendance-readers.test.mjs` -- zero-dependency scan of `apps`, `packages`, `supabase/functions`; baseline entries each with a one-line reason; fails a seeded fixture
- [ ] `package.json`, `scripts/ci-local.sh`, `.github/workflows/ci.yml` -- wire `check:attendance-readers` into the static stage and CI
- [ ] `apps/dashboard/services/attendance.ts` -- the three reads onto `attendance_counted`; "today" via `getGymLocalPeriodBounds()` day instants; keep return shapes; verify the `members!inner` embeds still resolve through the view (fallback: separate name lookup)
- [ ] `apps/dashboard/services/attendance.*.test.ts` -- Vitest: clock 23:30 UTC, Douala, 00:10 local check-in counts today; existing tests adjusted only for the table name
- [ ] `packages/types/src/database.ts` -- regenerate (hand-splice only this story's columns and views if the CLI output carries unrelated drift, per decisions.md precedent)
- [ ] `docs/decisions.md` -- dated newest-first entry on the timezone-history backfill rationale; then verify cited line numbers
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- status transitions and a `last_updated` line

**Acceptance Criteria:**
- Given the AC set in `epics.md` Story 27.1 (15 criteria), when the story closes, then each is met and pgTAP-proven; the full `scripts/ci-local.sh` gate is green on story/27-1.
- Given the existing suite, when it runs, then no existing test needs a fixture edit; the only edited files are the dashboard attendance tests.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The reader scan is a gate that must reach its consumers (Epic 22 retro 66): the node scan covers app code, the pgTAP enumeration covers function bodies and policies, and each is shown failing on a seeded offender (retro 77). The existing `check_in()` stays on the base table in 27.1; it writes and takes the open row, so it is a listed reader, and 27.2 narrows the writer list to `private.record_check_in`.

Plan note for the Attendance page: PostgREST infers an embed through a view from the underlying `member_id` foreign key. If `members!inner(name)` cannot be resolved through `attendance_counted`, do not widen the view; look names up in a second query keyed by member id.

## Verification

**Commands:**
- `scripts/pgtap-run.sh supabase/tests/attendance_counting.test.sql` -- expected: all ok
- `pnpm run check:attendance-readers && pnpm run check:migrations && pnpm run test:guardrails` -- expected: pass; the seeded-offender test fails as designed
- `pnpm --filter @gymos/dashboard test -- attendance` and `pnpm run typecheck` -- expected: pass
- `scripts/ci-local.sh` -- expected: GREEN, with per-stage lines read, not only the final line
