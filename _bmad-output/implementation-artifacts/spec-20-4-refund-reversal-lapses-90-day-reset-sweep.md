---
title: '20-4 Refund reversal, lapses & 90-day reset sweep'
type: 'feature'
created: '2026-10-13'
status: 'review'
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
- Hook failure posture (decided 2026-10-13, option A): the 0118 `on_session_consumed` and 0119 `award_renewal_stamp` bodies are renamed in place and re-exposed under the same names as thin wrappers, as is the new reversal hook; each wrapper catches errors in a savepoint, writes a `loyalty_hook_failed` audit row (system label when there is no caller, hook name, SQLSTATE, message, ids) and a `job_runs` failure row (`loyalty_hook`), and lets the payment, check-in or refund proceed with no ledger write. Callers and signatures are unchanged; earn rules are not edited.
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
- [x] dashboard labels EN/FR + `auditLabels.epic20.test.ts`
- [ ] local gates: apply 0120 locally, `scripts/ci-local.sh` all stages, `scripts/session-refund-race.sh`, sprint-status entry

**Acceptance Criteria:**
- Given the matrix, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given a refund of a consumed paid session and a sweep run twice, when the ledger is read, then each reversal, lapse and reset appears once and the fold equals `loyalty_progress`.
- Given a loyalty hook raises during verification, when the payment completes, then it still succeeds and a `loyalty_hook_failed` audit row and `loyalty_hook` failure row exist.
- Given the sweep raises for one member, when it finishes, then other members are processed and `job_runs` holds a `failure` row the hourly alert reports.

### Review Findings

Code review 2026-10-13 (bmad-code-review, diff 03e22a0..bb98647, 4 layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor).

- [x] [Review][Decision] RESOLVED (a): keep the code, spec text amended in Spec Change Log. Reversal's "stamp still counted" reset test is narrower than the frozen spec text — 0120 also requires `previous_last_event_at >= stamp.occurred_at`; the spec says only "no guest `reset` dated after it (other than the same-origin one)". Differs only for a different-origin reset dated after the stamp that saw an older last event (backdated/offline consumption). Options: (a) keep the code and amend the spec text by your sign-off, (b) drop the extra condition to match the spec. [0120:131-135] (acceptance-auditor)
- [x] [Review][Decision] RESOLVED (a): accept caller attribution; with-caller test added as a patch. Hook-failure audit row is attributed to the calling user, not `system:loyalty_hook` — `log_audit_event` uses `auth.uid()` when present (payment verify, check-in, refund by a logged-in user), so the spec's "system label" holds only for jobs/webhooks; the 0120 header documents it, the pgTAP assertion runs with empty claims only. Options: (a) accept and amend spec wording plus add a with-caller test, (b) write the row through a path that always uses the system label (touches shared `log_audit_event` or a direct `audit_log` insert). [0120:208-223] (acceptance-auditor+blind-hunter)
- [x] [Review][Patch] Sweep bookkeeping shares the work's block — the summary `job_runs` insert and `loyalty_sweep_job_failure` audit write (and the outer handler's own writes) run inside the BEGIN block that holds every member's lapse/reset; if the audit write raises, all member work and the failure row roll back and, if the handler's audit write also raises, no `job_runs` row survives (only the 27h not-running alert fires). Guard the summary and handler writes in their own begin/exception blocks, as `record_loyalty_hook_failure` already does. [0120:484-508] (blind-hunter+edge-case-hunter)
- [x] [Review][Patch] No test for the same-origin reset exclusion — `e.origin_id <> p_session_id` (reset written by the earn hook with the stamp's own origin) is never exercised by a refund; deleting it passes every test while refunds of the first stamp after an idle gap stop reversing. Refund m14's (0x3f) consumed session and assert one `stamp_reversed` and counter 1 -> 0. [supabase/tests/loyalty_sweep_and_reversal.test.sql] (verification-gap)
- [x] [Review][Patch] AC3 is proved only at wrapper level — no test forces a hook failure inside `complete_verified_payment` / `confirm_renewal` / check-in and asserts the payment, renewal or check-in row still commits (confirmed: no reference to either function in the test file). [supabase/tests/loyalty_sweep_and_reversal.test.sql] (acceptance-auditor+blind-hunter)
- [x] [Review][Patch] Hook-failure audit actor is untested with a caller — add a pgTAP case that sets JWT claims (`auth.uid()` present) and asserts the `loyalty_hook_failed` row's actor is that user while the `job_runs` `loyalty_hook` row still exists; update the spec's "system label" wording to "system label when there is no caller". [supabase/tests/loyalty_sweep_and_reversal.test.sql] (decision 2)
- [x] [Review][Defer] `loyalty_sweep` alert entry and the alert query are not executed by any test — deferred: no harness for `scripts/job-runs-alert.sql` exists; small pgTAP or CI-step check is separate work. (verification-gap)
- [x] [Review][Defer] `service_role` is not revoked on the wrappers, `_impl` bodies or `record_loyalty_hook_failure` (only the sweep revokes it); post-conditions check anon/authenticated only — deferred: unverified medium, same posture as 0118/0119. Settle with `has_function_privilege('service_role', 'private.on_session_consumed(uuid,uuid,uuid)', 'execute')` on the local DB and decide for all Epic 20 private functions together. (blind-hunter)

#### Pass 2026-10-13 (bmad-code-review, 4 fresh layers, diff 03e22a0..working tree)

- [x] [Review][Patch] The sweep's outer failure path (`exception when others` around the config read and candidate query, with its two guarded writes) has no test. The earlier rejection said `loyalty_idle_reset_days` is NOT NULL so the path is unreachable; the raise is actually on `platform_session_config` having no row (`select ... limit 1` returns null on an empty table), which a rolled-back `delete from platform_session_config` reaches. Add a case: delete the row, run the sweep, assert one `loyalty_sweep` failure `job_runs` row and one `loyalty_sweep_job_failure` audit row, no member work. [supabase/tests/loyalty_sweep_and_reversal.test.sql] (blind-hunter)
- [x] [Review][Defer] Refund-vs-refund, sweep-vs-earn and sweep-vs-refund serialization is verified only sequentially (pgTAP cannot interleave; `scripts/session-refund-race.sh` never touches loyalty rows and is not in `ci-local.sh`) — deferred: same depth accepted in 20-2 and 20-3; close with a two-connection script asserting one `stamp_reversed`, no deadlock and a single reset. (verification-gap)
- [x] [Review][Defer] SETTLED, no longer open: `service_role` cannot execute the three wrappers, the three `_impl` bodies or `record_loyalty_hook_failure` (`has_function_privilege` is false on the local DB for all seven, so the deferral above is rejected as `false`). `private` usage alone does not grant function EXECUTE here.

#### Rejected (pass 2026-10-13)

- `service_role` can call the reversal and earn bodies (blind-hunter) (false): `has_function_privilege('service_role', ...)` is false for all seven 0120 private functions on the local DB; the revoke from `public` removed the default grant.
- Spec contradicts its own change log, frozen text lacks the `previous_last_event_at` clause, stale "not exercised" log line, unchecked task, `review_loop_iteration` (blind-hunter, acceptance-auditor, verification-gap) (low): fix is a spec edit. The clause is covered by m3, m14 and m15.
- Reversal reads a live stamp as zeroed when `consumed_at` is backdated; sweep reset `occurred_at = now()` vs stamp `occurred_at = consumed_at` (edge-case-hunter, verification-gap) (low): unreachable on live paths (0118 header: `consumed_at = now()`); decision 1 already settled the narrower clause.
- Sweep reset origin repeats when `guest_last_event_at` returns to a swept value (edge-case-hunter) (false): every earn writes a new `now()` last-event time and a reset only runs while the counter is > 0, so the same timestamp cannot be swept twice.
- Lapse written without a progress row / lock (edge-case-hunter) (low): no counter to protect; lapse insert is idempotent on `(origin_id, event_type)`.
- Wrappers cannot catch `query_canceled`; commit message "never blocks" (edge-case-hunter, blind-hunter) (false): a cancel aborts the whole statement, nothing a handler could keep; already rejected in the previous pass.
- `award_renewal_stamp` failure with a missing payment writes an audit row with null gym (edge-case-hunter) (low): the `job_runs` row still carries the failure; the impl cannot raise on a missing payment first.
- `now()` timestamps on `job_runs` hook rows (edge-case-hunter) (false): no uniqueness or ordering assumption in the alert query (`max(started_at)` and a 65-minute window).
- Partial-failure run writes only a failure row (edge-case-hunter) (false): the alert's not-running check uses `max(started_at)` of any status and the failed-run check fires on the failure row.
- AC3 proven only through `confirm_renewal`; refund and check-in callers not exercised (acceptance-auditor, blind-hunter, verification-gap) (low): all three callers go through the same wrapper, covered directly; same depth accepted in 20-2 and 20-3.
- Candidate scan has no partial index; first-run backfill audit noise; no repair path or retry for swallowed failures (blind-hunter) (low / already deferred): single-transaction and backfill and no-retry are in `deferred-work.md`; table sizes are small today.
- Raw `sqlerrm` in owner-visible audit metadata, hook failure label wording (blind-hunter) (low): the spec lists SQLSTATE and message in the audit row; fix is a spec edit.
- Rollback verify block, `drop function` without `if exists` (blind-hunter) (low): already rejected; single-use `--single-transaction` script.
- Two negative-test assertions are one-sided (blind-hunter) (low): already rejected as test-shape nits; the cross-gym RLS assertions also pair with owner B's positive event count.
- A 1 XAF partial refund removes a stamp (blind-hunter) (false as a defect): frozen spec behavior.
- Sprint-status `last_updated` stale (blind-hunter) (false): the file's convention is appended `# last_updated:` comment entries, as in earlier stories.
- `session_refund.test.sql` replaces the wrapper with a probe (verification-gap) (false): observation, not a defect; the wrapper chain is covered in the 0120 test.
- `database.ts` lists `run_loyalty_sweep_job` (acceptance-auditor) (low): generated output, already rejected.

#### Rejected

- `loyalty_hook` failure rows never reach the alert (false): `job-runs-alert.sql` reports any `status = 'failure'` row from the last 65 minutes regardless of `expected`, so `loyalty_hook` is covered (script header lines 8-9).
- `loyalty_hook` failure rows can flood the hourly alert/audit on a persistent bug (low): the flood is the signal, and dedupe adds state for a rare case.
- Wrappers do not catch `query_canceled` / statement timeout (false): a statement timeout cancels the outer statement; no PL/pgSQL handler could keep the payment alive, so it is not a defect of the wrapper.
- `record_loyalty_hook_failure` is invoker and untested under `authenticated` (false): all three callers are SECURITY DEFINER (`check_in`, `apply_session_refund`, the verifying functions), so the `job_runs` insert runs as owner.
- Raw `sqlerrm` in tenant-visible audit metadata (low): rare, owner-facing, no cross-tenant detail in the message; the full text is the debugging value.
- `v_processed` in the failure audit overstates writes from rolled-back members (low): diagnostic count only.
- reward_granted with equal `occurred_at` makes the reversal fire twice (maybe-false, would be low): needs two sessions of one member with identical consumed timestamps.
- Rollback verify block does not check `cron.job`, `drop function` without `if exists` (low): single-use script in `--single-transaction`; `cron.unschedule` raises on failure.
- `loyalty_sweep` shows "never ran" until the first 03:30 UTC run (low): deploy order already puts migrations before the PR to master.
- `database.ts` lists `run_loyalty_sweep_job` (low): generated type, harmless at runtime.
- Earn-racing-sweep order B vacuous, "partial then partial" not via a second refund row, vacuous negative assertion, fold test exclusion list (low): test-shape nits; the guarded paths are covered by m5, m14, m15 and the fold check on the main set.
- A 1 XAF partial refund removes a stamp (false as a defect): behavior is the frozen spec ("any refund, full or partial"); fix would edit the spec.
- Spec bookkeeping (status, unchecked Tasks, `review_loop_iteration`) (low): fix is a spec edit; status is set by this workflow's closing step.
- Sweep scalability / success row has no counts (low, partly already deferred): first-run backfill and single transaction are in `deferred-work.md` since the earlier pass.

#### Pass 2026-10-13 (pass 4, bmad-code-review, 4 fresh layers, diff epic/20...HEAD at 10d8465)

- [x] [Review][Patch] The reversal's "stamp already zeroed" guard is never discriminated: every refund test that reaches it has the counter at 0 and returns at the `guest_stamps <= 0` check, so deleting the whole `if exists (...)` block (or inverting its `reward_granted` / `reset` clause) passes all 72 + 16 assertions. Add pgTAP: three stamps (grant, counter 0), a fourth (counter 1), refund the first, assert counter stays 1 and `stamp_reversed` count is 0; and the same after a sweep reset (stamp, reset, new stamp, refund the old one). Medium: in production a refund of an old stamp would silently take away a newer, unrefunded one. [0120:~131-139; supabase/tests/loyalty_sweep_and_reversal.test.sql] (verification-gap)
- [x] [Review][Patch] The reversal's "no `stamp_earned` event for this session" early return is unpinned: the only test aimed at it has its member at `guest_stamps = 0` (returns at the counter check), so removing the `if not found then return` makes a never-stamped session decrement other stamps with no test failing. Add pgTAP: a member at `guest_stamps = 2`, a consumed paid session with no `stamp_earned` row, refund it, assert counter 2 and no `stamp_reversed`. Medium. [0120:~100-103; supabase/tests/loyalty_sweep_and_reversal.negative.test.sql] (verification-gap)
- [x] [Review][Patch] `deferred-work.md` still carried the first "Deferred from: code review of spec-20-4 (2026-10-13)" bullet that lists the `service_role` execute-grant item as open, while the second heading with the identical title records it as settled `false`. Delete the stale open bullet so a reader is not sent chasing a closed item. Low. [_bmad-output/implementation-artifacts/deferred-work.md] (blind-hunter)
- [x] [Review][Defer] Hook impl bodies and the sweep take member/progress row locks with no `lock_timeout`: a payment, check-in or refund whose hook waits on a row the 03:30 UTC sweep holds for its whole single transaction stalls behind it, and the first run also writes an owner-visible lapse audit row per historic expired session. — deferred: unverified medium, extends the open "sweep is one transaction" item; settle by timing the first run on a prod-sized copy, then add `set local lock_timeout` in the wrappers (caught as a hook failure) and batch per gym or cut off backfill audit rows. (edge-case-hunter+blind-hunter)

#### Rejected (pass 4)

- Reward granted for a different session sharing the stamp's `occurred_at` defeats the strict `>` (edge-case-hunter) (low): needs two sessions of one member with identical `consumed_at` from different transactions; a reward for the stamp's own session is covered by `origin_id = p_session_id`.
- Sweep success `job_runs` row has no processed/failed counts (blind-hunter) (low): already rejected in an earlier pass; the failure row and audit carry counts.
- Audit/event key `idle_reset_days` holds the plan-aware window for the subscriber counter (blind-hunter) (low): cross-migration rename with the same key used by 0118/0119; pinned by tests, no wrong outcome.
- Latest-subscription lookup ignores status and gym (blind-hunter, acceptance-auditor) (false): the sweep's query is character-for-character the `effective_loyalty` one (0117 `order by s.created_at desc, s.id desc limit 1`), which the spec requires to match exactly; the acceptance auditor's cross-check is satisfied.
- Reversal's `origin_id <> p_session_id` clause is dead (blind-hunter) (false): redundant by construction and recorded as deliberate defensive logic in the Spec Change Log; no wrong outcome.
- Hook-failure rows vanish if the caller later rolls back; no retry (blind-hunter) (low / already deferred): the rolled-back payment or check-in is gone too; no-retry is an existing deferral.
- Hook-failure audit actor is the end user and carries raw `sqlerrm` (blind-hunter) (low): decision 2 accepted caller attribution; the spec lists SQLSTATE and message in the row.
- Spec frontmatter, Change Log "not exercised" line, Triage row 14, unchecked task, duplicate Rejected entries, frozen block wording (blind-hunter, acceptance-auditor, verification-gap) (low): fix is a spec edit.
- Rollback script is weaker than the migration; sweep and reversal timestamp semantics to settle before 20.5 (blind-hunter) (low): single-use `--single-transaction` script, earlier rejection stands; refund-before-sweep is Triage row 10.
- Vacuous negative test, fold test hand-excludes members, `started_at = now()` equality, alert query and concurrency only sequential (blind-hunter, acceptance-auditor) (low / already deferred): test-shape nits or existing deferrals.
- AC3 proven through `confirm_renewal` only (acceptance-auditor) (low): same depth accepted in 20-2 and 20-3; rejected in the earlier pass.
- Rollback script not executed by CI (verification-gap) (low): run manually per the activity log, no new evidence.

## Implementation Notes

## Spec Change Log

- 2026-10-13 (code review, decision 1): Reversal "stamp still counted" test. Spec text: no guest `reset` dated after the stamp. Code (kept): a reset zeroes the stamp only if it is dated at or after it AND its `previous_last_event_at` is at or after the stamp, since a reset cannot zero a stamp written after it saw an older last event (backdated or offline consumption). Spec intent amended to match. Not exercised by a test yet.
- 2026-10-13 (code review, patches): the same-origin reset exclusion (`origin_id <> p_session_id`) is redundant by construction with the `previous_last_event_at` guard (an earn-hook idle reset always saw a last event older than the stamp), so the m14 test pins behaviour (first stamp after an idle reset is reversed) and cannot kill a mutation that deletes only that clause.

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
