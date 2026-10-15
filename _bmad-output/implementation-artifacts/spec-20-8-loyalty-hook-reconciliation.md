---
title: '20-8 Loyalty hook reconciliation'
type: 'feature'
created: '2026-10-15'
status: 'review'
baseline_commit: '12ae3bf'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/docs/decisions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 0120 swallows a failing loyalty hook (record `loyalty_hook_failed`, let the payment, check-in or refund proceed). Nothing retries it and Epic 20 forbids manual balance edits, so a missed stamp, renewal stamp or reversal is permanent (Epic 20 retro S-2; decision 2026-10-15).

**Approach:** Migration 0122 adds a daily job that finds source rows whose loyalty event is missing and re-invokes the same `_impl` function. Replays are exactly-once through `unique (origin_id, event_type)`. The renewal impl gains an explicit clock so a repaired renewal is judged at its own time.

## Boundaries & Constraints

**Always:**
- Number is **0122** (Epic 21's 21.1 moves to 0123). Hook wrappers, signatures, grants and the earn/reversal rules are unchanged.
- `private.award_renewal_stamp_impl(uuid, timestamptz)` is the 0119 body with its six `now()` uses reading the argument; the one-argument impl delegates with `now()`.
- Candidates: last 7 days; earn and renewal only where the program was enabled at the source fact's time (latest `loyalty_program_changed` audit row at or before it) and is enabled now; reversal independent of the switch.
- Member lock first, each item in its own savepoint; a failure goes through `record_loyalty_hook_failure` and the run is recorded as a failure in `job_runs` (`loyalty_hook_repair`). A repaired item writes its normal rows plus one `loyalty_hook_repaired` audit row (EN/FR label).
- Separate job, 03:15 UTC daily, no change to `run_loyalty_sweep_job`; added to `scripts/job-runs-alert.sql` (27 h) and its harness; `prod-apply.mjs` stage 6 with a first run; rollback script; pgTAP.

**Never:** No client-callable function, no change to `loyalty_progress` outside the impls, no retry queue table, no retroactive application to a program switched on later, no UI.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|---|---|---|
| Missed guest stamp | paid session consumed 1 h ago, no event, program on | stamp_earned, counter 1, repaired audit row |
| Replay | second run | nothing written |
| Outside window | consumed 9 days ago | untouched |
| Free session | consumed, no payment | no stamp |
| Enabled later | program switched on after the session | untouched |
| Program off now | gym switch off | untouched |
| Missed renewal stamp | verified 3 days ago, on time then (late now) | stamp at the renewal's time |
| Early renewal | candidate, rule writes nothing | no event, run still succeeds |
| Missed reversal | refund of a consumed session, stamp present | stamp_reversed, counter back |
| One item raises | trigger forces an error | other members repaired, failure recorded, next run repairs it |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0122_loyalty_hook_reconciliation.sql`, `scripts/rollback-0122-loyalty-hook-reconciliation.sql`
- `supabase/tests/loyalty_hook_reconciliation.test.sql` (25)
- `scripts/prod-apply.mjs` stage 6, `scripts/job-runs-alert.sql` + `.test.sh`
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, locales en/fr, `auditLabels.epic20.test.ts`
- `docs/decisions.md`, `_bmad-output/planning-artifacts/epics.md`

## Verification

- pgTAP `loyalty_hook_reconciliation.test.sql`, existing loyalty files, `scripts/ci-local.sh` green; rollback script exercised locally.
- Production: stage 6 dry run, backup, apply (runs the job once), verification.
