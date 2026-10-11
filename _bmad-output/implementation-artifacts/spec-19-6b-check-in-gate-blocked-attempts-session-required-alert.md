---
title: '19-6b Check-in gate, blocked attempts & session-required alert'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '9a7f0bab7b5f26d5a3df97e4e249587295c1f046'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** At a gym that charges guests per session, a Pay-per-session member can still check in without a paid session: nothing consumes one, nothing records a refused scan, and `attendance_events` still accepts direct client inserts.

**Approach:** Migration 0111 adds `private.consume_guest_session()` and `session_attempts`, gates `check_in()` behind the charging flag, raises a `session_required` alert on refusal, dismisses it when a session payment lands, and closes direct writes on `attendance_events`. Flag-off gyms never enter new code.

## Boundaries & Constraints

**Always:** `check_in()` keeps its signature, `RETURNS attendance_events` and null-means-blocked. It reads `gyms.charge_guests_per_session` before any new call or lock; off means byte-for-byte the 0110 path. When on, it takes the member lock (`FOR NO KEY UPDATE`) before the open-session `attendance_events` lock (canonical order). `consume_guest_session` re-checks flag, current plan type and price > 0 and returns *exempt* without locking; only then locks, computes the gym-local day with `private.gym_local_day_bounds()` of receipt time, returns *covered* / *consumed* (soonest `usable_until`, paid before free on tie; sets `consumed_at` and non-null `covered_day`) / *denied*, and calls a no-op `private.on_session_consumed()`. Consumed rows must have a non-null `covered_day` (CHECK, deferred-work 980). Replay by `client_scan_id` short-circuits before any consumption. Offline scan time becomes `checked_in_at` only if within the auto-timeout window of receipt and not before the covering session's creation; else receipt time. `private.create_guest_session_for_payment` dismisses the member's active `session_required` alert in the same transaction. Direct INSERT/UPDATE/DELETE on `attendance_events` is revoked from `authenticated` and `service_role` after a grep for writers; each is moved behind a definer function or listed in the migration header. Dashboard alert readers filter on `kind = 'subscription_status'` so a null-status row never renders as an at-risk alert. Types spliced by hand; rollback script, `$verify$` block, header counting grepped writers.

**Never:** No `mark_class_attendance()` change (19.7). No dashboard UI for the alert (19.9), no mobile change (19.11). No coded `attendance_events` row. No change to the expired/at-risk subscription alerts. No edit to historical migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flag off | any member scan | pre-0111 behavior; no attempt row, no consume call | N/A |
| Exempt | flag on, plan not Pay-per-session or price 0 | check-in as before, nothing consumed | N/A |
| Usable session | flag on, one usable session | *consumed*; attendance row | N/A |
| Same day again | session already consumed today | *covered*; attendance row, no second consumption | N/A |
| 23:50 vs 00:10 | consumed 23:50 gym time, scan 00:10 | next day needs a new session | N/A |
| No session | flag on, none usable | *denied*: `session_attempts` row, one active `session_required` alert (status null), no attendance row, returns null | N/A |
| Repeat denied | same member scans again | second attempt row (null scan id) or conflict-skipped (same scan id); still one active alert | N/A |
| Replay | same `client_scan_id` after success | returns stored row, consumes nothing | N/A |
| Payment | session payment recorded (19.4/19.5) | member's active `session_required` alert dismissed | N/A |
| Direct write | authenticated/service_role INSERT on `attendance_events` | rejected | permission denied |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0110_front_desk_alert_kind.sql:98-313` -- live `check_in()` body to copy via `pg_get_functiondef`; `:60-70` alert CHECK allows `session_required` with null status; index `(member_id, kind, status) nulls not distinct`
- `supabase/migrations/0109_in_app_tara_session_payment.sql:57-95` -- `create_guest_session_for_payment` (live; also called by 0108's desk RPC): add the alert dismissal here
- `supabase/migrations/0107_charge_guests_setting_session_record.sql:201-227` -- `guest_sessions` shape and the unique indexes; add the `covered_day` CHECK
- `supabase/migrations/0097_gym_local_period_bounds.sql:56` -- `private.gym_local_day_bounds(timezone, at)`
- `supabase/migrations/0006_attendance.sql:20` -- the broad grant to revoke; definer writers in 0024/0090/0093 keep working, grep tests and `supabase/functions` for others
- `supabase/tests/rls_tenant_isolation.test.sql:167` -- DELETE-as-authenticated assertion expects 0 rows; becomes permission denied, update it
- `supabase/tests/front_desk_alert_kind*.test.sql`, `check_in_one_open_session_enforcement.test.sql` -- patterns and suites that must still pass
- `apps/dashboard/services/frontDeskAlerts.ts`, `apps/dashboard/lib/realtime/frontDeskAlerts.ts` -- readers needing the `kind` filter
- `scripts/check-migration-guardrails.mjs`, `scripts/migration-guardrails.grandfather.json` -- new revokes; the copied body keeps `app_role` read, grandfather list bump as in 0110

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0111_check_in_session_gate.sql` -- `session_attempts` (+RLS, staff read, unique index), `covered_day` CHECK, `on_session_consumed()` no-op, `consume_guest_session()`, `check_in()` rewrite, alert dismissal in the creation helper, attendance_events write revoke, `$verify$`
- [x] `supabase/tests/check_in_session_gate.test.sql` + `.negative.test.sql` -- one case per matrix row; sequential double-call proves one *consumed* then *covered*; unique index backstops the race; replay; day boundary; flag-off no side effects
- [x] `supabase/tests/rls_tenant_isolation.test.sql` and any writer found by grep -- adapt to the revoke
- [x] `apps/dashboard/services/frontDeskAlerts.ts`, `apps/dashboard/lib/realtime/frontDeskAlerts.ts` -- filter on `kind`, with a unit test
- [x] `packages/types/src/database.ts` -- `session_attempts`, function signatures
- [x] `scripts/rollback-0111-check-in-session-gate.sql`, `docs/decisions.md` -- forward-fix rollback; runbook row 0111 (apply only after 0110's week is clean)

**Acceptance Criteria:**
- Given 0111 applied, when the existing alert, attendance, suspension and tenant-isolation suites run, then all pass.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given the rollback script in a rolled-back transaction, then `check_in()` matches 0110 and `attendance_events` grants match 0006.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap | Realtime INSERT/UPDATE kind filter untested (only predicate and reader .eq tested) | medium | patch | Reverting handlers to forward every payload leaves all tests green; vitest case added. |
| 2 | gap | Stale auto-close committing with a denied scan, and non-stale open row raising, untested | medium | patch | Every denial test starts with no open row; two pgTAP cases added. |
| 3 | gap | Rollback script only manually rehearsed | low | defer | Rarely used forward fix; harness is separate work (same as 19-6a #2). |
| 4 | gap, blind | Header says check_in_one_open_session_enforcement test was updated; it was not | low | patch | Its insert runs after reset role as superuser; header corrected. |
| 5 | gap, blind | decisions.md says lock order "Asserted"; no test does | low | patch | One pgTAP session cannot observe it; wording corrected. |
| 6 | blind | session_attempts deviates from epic AC: client_scan_id vs scan_id, no source column | medium | patch | Epic 19.6b AC names scan_id and source in check_in|class; 19.7 needs source. Renamed and added. |
| 7 | edge, blind | session_attempts.scanned_at stores unclamped client time | low | patch | Skewed device clock gives future timestamps in the only blocked-count source; clamp with least(). |
| 8 | edge | gyms.timezone null makes covered_day null | false | reject | gyms.timezone is NOT NULL default (0002:20). |
| 9 | edge, blind | Other front_desk_alerts consumers not audited | false | reject | grep: only the two dashboard files read the table; migrations 0051/0073/0093 are publication and policies. |
| 10 | edge | Offline scan from previous gym-local day: covered day from receipt time | low | reject | Epic AC: server receipt time governs. |
| 11 | edge | EXECUTE on consume_guest_session not revoked from service_role | low | reject | service_role is the trusted server role and bypasses RLS; same posture as every existing private helper. |
| 12 | edge | dismissed_by null when payment completes via webhook | false | reject | dismissed_by is a nullable FK (0034:19); trigger stamps auth.uid(). |
| 13 | edge | Consumed session burned if caller swallows a later insert error | false | reject | Same transaction; function body is atomic, no subtransaction. |
| 14 | edge | Realtime payload with absent kind treated as subscription_status | false | reject | Postgres realtime INSERT/UPDATE payload.new carries every column. |
| 15 | edge | Rollback aborts when session_attempts has rows | low | reject | Intentional guard against losing blocked-attempt evidence; archive-and-drop is an operator decision. |
| 16 | edge, blind | Rollback re-run hits non-IF EXISTS drops; leaves session_required rows | low | reject | Single --single-transaction forward fix; a failed run rolls back whole. |
| 17 | blind | session_required alert only dismissed by a session payment | low | reject | Epic FR-160 defines dismissal on payment; other admit paths are Epic 20. |
| 18 | blind | Null return gives client no reason | false | reject | Epic decision 1: null is the signal old builds handle; 19.11 reads the latest attempt. |
| 19 | blind | Tara completion path dismissal untested | low | reject | Same shared helper as the desk path, which is tested. |
| 20 | blind | ADD CONSTRAINT with no backfill could abort | false | reject | guest_sessions has no consumption path before 0111, so no consumed rows exist. |
| 21 | blind | $ uses has_table_privilege only | low | reject | Table-level revoke all precedes it; column grants never existed. |
| 22 | blind, edge | check_in takes member lock for exempt members too | low | reject | Spec: lock taken when flag is on; exempt members serialize only on their own row. |
| 23 | blind | Grandfather list and cap grew again | low | reject | Forced by the unchanged live body (same as 19-6a #9). |
| 24 | blind | Spec status/tasks/sprint-status out of sync | low | reject | Process state; resolved by step 5. |

## Design Notes

- Gate order: the member lock is taken once, before the open-session `FOR UPDATE`, only when the flag is on; `consume_guest_session` re-locks harmlessly. A denied scan commits its attempt and alert (it returns null, it does not raise); a stale auto-close earlier in the same call also commits, which is correct.
- pgTAP runs one session, so "concurrent" is proven by the partial unique index plus the lock-then-recheck order, as in 0108.
- 0111 should not be applied to production until 0110 has run a week clean (decisions.md runbook); that is a release gate, not a build gate.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all files pass
- `node scripts/check-migration-guardrails.mjs` -- expected: no new violations
- `bash scripts/ci-local.sh` -- expected: all stages PASS
