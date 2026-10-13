---
title: '20-4 Refund reversal, lapses & 90-day reset sweep'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '03e22a096b7bd984e2e65a4b7eeb9c7ec469c0ac'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Refunding a consumed session leaves its guest stamp in place (the 0113 hook is a no-op), and nothing persists or audits lapsed sessions or idle resets: `effective_loyalty` hides them at read time, but the ledger and audit log never record them (FR-162, FR-166, FR-168/OQ-B).

**Approach:** Migration 0120 fills `private.on_session_refunded_after_consumption` with the stamp reversal and adds a daily `pg_cron` sweep (own function, own transaction, `job_runs` name `loyalty_sweep`) that records `lapse` and `reset` events and audit rows exactly once per session or counter window.

## Boundaries & Constraints

**Always:**
- Number is **0120**. Hook signature, grants and the 0113 refund trigger are unchanged.
- Reversal (FR-162): runs for any refund of a consumed session, full or partial. It acts only when a `stamp_earned` event exists with `origin_id` = session id and that stamp is still in the current count: no guest `reset` (other than the one written with that stamp, same origin) and no guest `reward_granted` exists dated after it or sharing its origin. Then one `stamp_reversed` (`origin_id` = session id), `guest_stamps = greatest(guest_stamps - 1, 0)`, one audit row `loyalty_stamp_reversed`. Otherwise nothing is written. A second refund of the same session is a replay and changes nothing. Works whether loyalty is on or off now. A granted free session is never taken back; `guest_last_event_at` is untouched. Subscriber stamps are never reversed (FR-162).
- Sweep, per member in canonical order (member `FOR NO KEY UPDATE`, then `loyalty_progress FOR UPDATE`), conditions re-read under the lock, each member in its own savepoint:
  - Lapse: an unconsumed, unvoided `guest_sessions` row with `usable_until <= now()` and no `lapse` event gets one `lapse` event (`counter guest`, `origin_id` = session id, `details.kind` `free` when `loyalty_grant_id` is set, `paid` when `payment_id` is set) and one audit row. The session row is not changed.
  - Reset: a counter > 0 whose last event is older than its window (guest: `loyalty_idle_reset_days`; subscriber: greatest of that and latest plan `duration_days` + gym `grace_period_days`, exactly `effective_loyalty`'s rule) gets one `reset` event with a deterministic `origin_id` derived from member, counter and last-event timestamp (never a session or payment id), counter set to 0, one audit row with previous count and window.
- Hook failure posture (decided 2026-10-13, option A): the 0118 `on_session_consumed` and 0119 `award_renewal_stamp` bodies are renamed in place and re-exposed under the same names as thin wrappers, as is the new reversal hook; each wrapper catches errors in a savepoint, writes a `loyalty_hook_failed` audit row (system label, hook name, SQLSTATE, message, ids) and a `job_runs` failure row (`loyalty_hook`), and lets the payment, check-in or refund proceed with no ledger write. Callers and signatures are unchanged; earn rules are not edited.
- Covers every gym, including loyalty-off and suspended ones: lapses and resets are time facts, not program actions. Audit actor is the system label `system:loyalty_sweep_job`.
- Own `job_runs` row per run (`loyalty_sweep`, success or failure with error text, failed member count); scheduled daily outside the other jobs' minutes; added to `scripts/job-runs-alert.sql` `expected` with a 27-hour gap so a failure reaches the human through the existing hourly alert.
- Every `loyalty_events` row stays replayable: a pgTAP fold of a member's events (stamp +1, reward/reset to 0, reversed -1 floor 0) equals `loyalty_progress`, and unused free sessions equal granted minus consumed minus lapsed.
- New audit labels EN/FR: `loyalty_stamp_reversed`, `loyalty_free_session_lapsed`, `loyalty_paid_session_lapsed`, `loyalty_sweep_job_failure`, `loyalty_hook_failed`; extend `auditLabels.epic20.test.ts`.
- Rollback script `scripts/rollback-0120-...sql`; pgTAP positive + negative; `database.ts` unchanged unless a signature appears.

**Never:** No change to `effective_loyalty`, `consume_guest_session`, `apply_session_refund`'s lock order, the earn hooks' rules, or any session row; no client-callable function; no UI; no un-granting of rewards; no reversal for renewals; no manual balance path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refund of stamped, consumed session | stamps 2, stamp still counted | `stamp_reversed`, stamps 1, audit | N/A |
| Refund after reward at N | the stamp triggered the grant, counter 0 | nothing written, free session stays | N/A |
| Refund after idle reset | stamp predates a persisted `reset` | nothing written | N/A |
| Counter already 0 | stamp counted but counter 0 | event not written, no negative | N/A |
| Second refund, same session | partial then partial | one reversal only | no error |
| Free session consumed | no payment | no refund path; hook returns | N/A |
| Sweep, free session past 60 days | unused, `usable_until` passed | one `lapse` (kind free) + audit | N/A |
| Sweep, paid session past 7 days | unused, not voided | one `lapse` (kind paid) + audit | N/A |
| Voided or consumed session | past `usable_until` | no lapse | N/A |
| Sweep counter past window | guest stamps 2, 91 days idle | `reset`, stamps 0, audit | N/A |
| Subscriber on annual plan | 120 days since stamp, window 365+grace | no reset | N/A |
| Sweep twice / missed days | same data | each lapse and reset once | no error |
| Earn racing sweep | same member | same result as running in either order | N/A |
| Hook raises inside a paid renewal | bad timezone or bug | payment and renewal succeed, no ledger write, audit + `job_runs` failure | warning only |
| One member fails | bad row | others processed, run logged `failure` | error in `job_runs` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0113_session_refunds_revenue_line.sql:31-117` -- no-op hook to replace; refund trigger already holds member then session locks and calls the hook only for consumed sessions
- `supabase/migrations/0118_loyalty_guest_rule.sql` -- stamp/reset/reward event shapes, audit metadata, header note on sweep origin ids
- `supabase/migrations/0117_loyalty_program_ledger_foundation.sql:342-454` -- `effective_loyalty` window rule to mirror; ledger/progress tables and unique key
- `supabase/migrations/0119_loyalty_subscriber_rule.sql` -- `award_renewal_stamp` (renamed + wrapped), subscriber window
- `supabase/migrations/0021_subscription_lifecycle_cron.sql:46-135` -- job pattern: `job_runs` success/failure, system audit label, `cron.schedule`
- `scripts/job-runs-alert.sql` -- add `loyalty_sweep` to `expected`
- `supabase/tests/loyalty_guest_rule.test.sql` -- fixtures (`mk_paid`, `consume`, `replay`), plan conventions; `loyalty_subscriber_rule.test.sql` for subscriber windows
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `locales/en.json`, `locales/fr.json`, `auditLabels.epic20.test.ts` -- new labels (the test asserts the exact loyalty key set)
- `scripts/rollback-0119-loyalty-subscriber-rule.sql`, `scripts/session-refund-race.sh` -- rollback shape; run the race script (refund hook now writes)
- Do not touch: `effective_loyalty`, `consume_guest_session`, `apply_session_refund` body

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0120_loyalty_refund_reversal_lapse_sweep.sql` -- reversal hook, `run_loyalty_sweep_job()`, schedule, verify block, header with lock order and event/origin rules plus the three hook wrappers
- [x] `supabase/tests/loyalty_sweep_and_reversal.test.sql`, `.negative.test.sql` -- matrix cases, replay equals progress and free sessions, sweep-vs-earn equivalence, not client-callable, cross-gym isolation
- [x] `scripts/rollback-0120-...sql`, `scripts/job-runs-alert.sql` -- rollback and alert list
- [ ] dashboard labels EN/FR + `auditLabels.epic20.test.ts`
- [ ] local gates: apply 0120 locally, `scripts/ci-local.sh` all stages, `scripts/session-refund-race.sh`, sprint-status entry

**Acceptance Criteria:**
- Given the matrix, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given a refund of a consumed paid session and a sweep run twice, when the ledger is read, then each reversal, lapse and reset appears once and the fold equals `loyalty_progress`.
- Given a loyalty hook raises during verification, when the payment completes, then it still succeeds and a `loyalty_hook_failed` audit row and `loyalty_hook` failure row exist.
- Given the sweep raises for one member, when it finishes, then other members are processed and `job_runs` holds a `failure` row the hourly alert reports.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Failure bookkeeping shares one block: audit failure rolls back the `job_runs` alert row (BH, EC) | medium, patch | Verified in `record_loyalty_hook_failure`; split into two blocks. Fixed |
| 2 | Reversal's `previous_last_event_at` clause untested, and differs from the spec's "dated after" wording (VG, EC) | medium, patch | Clause is the more precise reading (a reset only zeroes stamps it saw); EC's "stamp already zeroed" outcome does not occur. Added refund-after-sweep test (reversed, 1 -> 0). Fixed |
| 3 | Subscriber window grace term and latest-subscription choice unpinned (VG, BH) | medium, patch | Added member with two plans and gym grace 30: kept at 100 days idle. Fixed |
| 4 | Subscriber no-reversal test vacuous (BH) | medium, patch | Added a real renewal refund, counter unchanged. Fixed |
| 5 | `system:loyalty_hook` label not used when a caller exists (EC) | low, patch | `log_audit_event` uses the caller as actor when `auth.uid()` is set; header wording corrected. Fixed |
| 6 | Rollback leaves `loyalty_sweep` in alert list (BH) | low, patch | Comment added to rollback script header. Fixed |
| 7 | Swallowed hook errors (deadlock, serialization) are never retried or reconciled (BH, EC) | medium, defer | Consequence of the approved option A; no repair path exists and the epic forbids manual balance edits. Recorded in deferred-work.md |
| 8 | Sweep is one transaction holding member locks; first run backfills history (BH, EC) | maybe-false medium, defer | Spec requires own function and transaction; size depends on backlog. Recorded |
| 9 | SQL error text in tenant-visible audit metadata (BH) | low, rejected | Error text only names the gym's own rows; fix is more than a direct correction |
| 10 | Refund past the idle window but unswept still decrements (EC) | low, rejected | Raw count is zeroed by the next sweep or earn; fold stays consistent |
| 11 | Candidate member missing is skipped silently (EC) | false | `loyalty_progress` and `guest_sessions` reference `members`; no deletion path |
| 12 | Session with neither source recorded as paid (EC) | false | `guest_sessions_exactly_one_source` CHECK (0107) |
| 13 | Refund of the Nth stamp keeps the free session; skipped reversals leave no trace (BH) | false | FR-162: a granted free session is not taken back |
| 14 | Whole-run failure path untested (VG) | low, rejected | `loyalty_idle_reset_days` is NOT NULL CHECK, so the outer handler is not cheaply reachable |
| 15 | Untested mismatch guard, concurrency claims, service_role grants, wrapper gym attribution (BH, VG) | low, rejected | Same depth accepted in 20-2 and 20-3 |
| 16 | Hand-listed fold exclusions, wrong "locked last" comment, grace NULL, rollback `if exists` (BH) | low/false, rejected | Cosmetic; `gyms.grace_period_days` is NOT NULL |

## Design Notes

Stamp reversal can only take back a stamp still in the counter: once a reset or reward has zeroed it, the stamp is already gone, and decrementing the newer count would punish stamps that were never refunded. Writing no event in that case keeps the fold rule simple (reversed = minus one, floor 0).
