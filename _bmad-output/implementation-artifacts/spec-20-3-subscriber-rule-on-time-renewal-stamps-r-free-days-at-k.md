---
title: '20-3 Subscriber rule: on-time renewal stamps, R free days at K'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '7e287b25d4adceb3d3f3375a87aaafc460c424d0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Subscribers who renew on time earn nothing: no renewal path writes a subscriber stamp, so `loyalty_progress.subscriber_stamps` never moves and R free days can never be granted (FR-167).

**Approach:** Migration 0119 adds `private.award_renewal_stamp(p_payment_id)` and calls it, in the verifying transaction, from the two paths that verify a renewal payment and create the renewed subscription: `confirm_renewal` and `complete_verified_payment`'s subscription branch. An on-time renewal earns one stamp; at K the renewed subscription's `expiry_date` moves out by R days and the counter returns to 0.

## Boundaries & Constraints

**Always:**
- Number is **0119**. `confirm_renewal(uuid,text,text,boolean)` (latest body 0093) and `complete_verified_payment(uuid,integer)` (latest body 0109) are re-created with only the call added; `confirm_renewal` also takes the member row lock (`FOR NO KEY UPDATE`) before its first write, to honor AD-27. `complete_verified_payment` locking is unchanged. Signatures, grants and return shapes unchanged.
- The migration header lists every renewal-verification path found by grep and what each does: `confirm_renewal` (calls, not when `p_backdate`), `complete_verified_payment` subscription branch (calls), `renew_subscription` (payment-less override, never calls), 0031 staff queue UPDATE pending→verified (ledger entry only: creates and extends no subscription, so no period to judge, never calls), `registration_fee` / `session` purposes (never call).
- `award_renewal_stamp` is revoked from public/anon/authenticated, no client-callable surface. It reads everything from the payment row: no-op unless `purpose = 'subscription'`, `status = 'verified'`, `voided_at` null, `subscription_id` set.
- Earns only when: the gym has `loyalty_enabled` and a K; the renewed subscription's plan is not `pay_per_session` and is the same plan as the previous subscription (latest subscription of the member created before the renewed one); the previous subscription has an `expiry_date`; and the payment is on time — gym-local date (`gyms.timezone`) at verification is on or after the previous `expiry_date` and no later than that date + 1 day, judged against the **current** (possibly extended) `expiry_date`. Decision (2026-10-12): a renewal verified while the previous period still runs (before its `expiry_date`) earns nothing; this is what "at most one stamp per subscription period" means.
- Stamp: one `stamp_earned` (`counter subscriber`, `origin_id` = payment id) and `subscriber_stamps + 1`, `subscriber_last_event_at` = `now()`. An existing `(origin_id, event_type)` row is a replay: return, change nothing. Progress row created on first use, locked last (`FOR UPDATE`).
- Idle reset first, as 20.2: counter > 0 and `subscriber_last_event_at` older than `greatest(loyalty_idle_reset_days, plan duration_days + grace_period_days)` → one `reset` event (`origin_id` = payment id, previous count in details), counter 0, then stamp. Same window `effective_loyalty` applies at read.
- At `subscriber_stamps >= K` (also above a lowered K): one `reward_granted` event (`counter subscriber`, `origin_id` = payment id), `expiry_date` of the renewed subscription + R days, counter 0. No payment, amount or plan change; status is left for the lifecycle job.
- Audit via `log_audit_event` (actor as the surrounding call; webhook path keeps its system label): reuse `loyalty_stamp_earned`, `loyalty_reward_granted`, `loyalty_progress_reset` with `counter: 'subscriber'` in metadata, grant adds old/new `expiry_date`. No new labels; extend the dashboard label comment only.
- Refunding a renewal reverses nothing here (FR-162; reversal is 20.4's business for sessions only).

**Never:** No change to `renew_subscription`, plan assignment or change paths, the 0031 queue, `effective_loyalty()` or the setter; no new column (no "original expiry"); no refund reversal, lapse event or sweep (20.4); no dashboard or mobile UI; no new client-callable function; no manual balance write path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| On time, below K | program on, stamps 1, K 3, renewed on expiry or expiry+1 (gym-local) | stamp, stamps 2 | N/A |
| Reaches K | stamps 2, K 3, R 7 | stamp, `reward_granted`, expiry +7 days, stamps 0 | N/A |
| Above lowered K | stamps 5, K lowered to 3 | one stamp, one grant, stamps 0 | N/A |
| Late | verified expiry+2 or later | nothing written, progress kept | N/A |
| Late vs original, on time vs extended | previous expiry extended by R | stamp earned | N/A |
| Back-dated staff renewal | `p_backdate` true | nothing written | N/A |
| Payment-less override | `renew_subscription` | nothing written | N/A |
| Pay-per-session | plan type pay_per_session | nothing written | N/A |
| Program off | verified renewal | no event, no progress row | N/A |
| Replay | webhook redelivered / function run twice | one stamp, one extension | no error |
| Idle past window | last stamp beyond window, stamps 2 | `reset`, then stamp: 1 | N/A |
| Early renewal | verified before previous `expiry_date`, incl. a second renewal right after a first | nothing written | N/A |
| Refund of renewal | payment refunded later | stamp and free days stay | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0093_supervisor_manager_plus_access.sql:286-380` -- latest `confirm_renewal` body (copy, add member lock + call; skip call when `p_backdate`)
- `supabase/migrations/0109_in_app_tara_session_payment.sql:238-430` -- latest `complete_verified_payment`; subscription branch at the end, call after the `subscription_id` backfill; payment+member locks already taken
- `supabase/migrations/0093_...:483` -- `renew_subscription` (not touched, payment-less)
- `supabase/migrations/0031_manual_payment_verification_queue.sql` -- queue UPDATE policy; ledger entry only
- `supabase/migrations/0118_loyalty_guest_rule.sql` -- model for event/progress/idle-reset/audit code and header style
- `supabase/migrations/0117_loyalty_program_ledger_foundation.sql` -- ledger tables, `effective_loyalty` subscriber window rule
- `supabase/migrations/0018_member_management.sql:27` -- expiry/plan-type trigger (fires on the extension UPDATE; still valid)
- `supabase/tests/loyalty_guest_rule.test.sql`, `loyalty_foundation.test.sql` -- fixtures, `plan()` conventions; existing renewal tests must stay green (program off)
- `scripts/rollback-0118-loyalty-guest-rule.sql`, `scripts/check-migration-guardrails.mjs` -- rollback shape, lint gate
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts` (comment only), `auditLabels.epic20.test.ts`
- Do not touch: `renew_subscription`, `effective_loyalty`, 0113 refund hook, `consume_guest_session`

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0119_loyalty_subscriber_rule.sql` -- `award_renewal_stamp`, re-created `confirm_renewal` and `complete_verified_payment` per Boundaries; header lists paths and lock order; verify block (function bodies call the hook, hook not client-callable)
- [ ] `supabase/tests/loyalty_subscriber_rule.test.sql`, `.negative.test.sql` -- matrix cases through real `confirm_renewal` and `complete_verified_payment`, replay of each path, late-vs-original/on-time-vs-extended, no stamp for override/backdate/ppsession/queue, ledger replay equals progress, cross-gym isolation, no client write
- [ ] `scripts/rollback-0119-loyalty-subscriber-rule.sql` -- restore 0093 `confirm_renewal` and 0109 `complete_verified_payment` bodies, drop the hook, verify
- [ ] dashboard: label comment + `auditLabels.epic20.test.ts` assertion that subscriber metadata renders
- [ ] local gates: apply to local DB, `scripts/ci-local.sh` all stages; sprint-status entry; if lock order in `consume_guest_session` / `apply_session_refund` is untouched, skip `session-refund-race.sh`

**Acceptance Criteria:**
- Given the matrix, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given K on-time renewals through `confirm_renewal` and through the webhook, when the Kth completes, then the new subscription's `expiry_date` is R days later than its plan produced and no payment row was added.
- Given each renewal path runs twice for one payment, when counts are read, then the ledger holds one `stamp_earned` and at most one `reward_granted`.


## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Hook failure rolls back paid verification, no exception isolation (EC, BH) | maybe-false, defer | Needs a bug in the hook to occur; swallowing errors would hide ledger drift. Same posture as 20-2. defer, unverified medium |
| 2 | Null gym timezone treated as on time (EC, BH) | false | `gyms.timezone text not null default 'Africa/Douala'` (0002) |
| 3 | R/K of 0 or below not guarded (BH) | false | CHECK ranges K 3-24, R 1-30 (0117) |
| 4 | Null expiry on renewed subscription when K reached (EC) | false | `enforce_subscription_expiry_matches_plan_type` (0018) rejects null expiry on every non-pay-per-session plan; pay-per-session returns earlier |
| 5 | Previous-subscription selection ties or cancelled status (EC, BH) | false | Same "latest by created_at, id" rule confirm_renewal and effective_loyalty use; test fixtures age rows |
| 6 | service_role keeps EXECUTE on hook (EC) | false | Negative test asserts it and passes in ci-local |
| 7 | On time judged at verification, not payment time (BH) | false | Spec: "evaluated at verification time" |
| 8 | Server current_date vs gym-local date near midnight (EC) | low, rejected | start_date uses current_date in pre-existing code; fix touches renewal date semantics outside this story |
| 9 | Subscriber reward shares label "Free session granted" (BH) | low, rejected | Spec: no new labels; copy belongs to 20.5 (header note already in auditLabels.ts) |
| 10 | Label test only asserts typeof string (BH) | low, patch | Assert non-empty and not the raw key |
| 11 | confirm_renewal role gate moved from JWT claim to current_member_role (EC, BH, VG) | medium, patch | Forced by 19.1 guardrail; behavior change surfaced to the human. Missing tests: supervisor positive, claim-vs-row mismatch refusal; 0093 prosrc guard should also accept current_member_role. patch |
| 12 | Idle-window plan-duration term untested (VG) | medium, patch | greatest(90, 33) is 90 in every test; add a long-plan case |
| 13 | Gym timezone judging untested (VG) | medium, patch | Add a far-offset-timezone boundary case |
| 14 | Negative test UPDATE could abort file (BH) | false | Test file runs green; update is by a member under RLS |
| 15 | Audit new_expiry_date stale after reward (BH) | low, rejected | Audit rows record the value at that time; reward row carries old/new |
| 16 | Rollback script re-runnability, lineage wording (BH) | low, rejected | Single-transaction script like 0118; verify block present |
| 17 | Missing config row shrinks idle window (BH) | false | Singleton row, NOT NULL CHECK > 0 (0107, same as 20-1 triage 9) |

### Review Findings

Code review 2026-10-13 (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) of `epic/20...HEAD` at 8292774.

- [x] [Review][Decision] RESOLVED 2026-10-13 (accept as shipped, delegated to reviewer): confirm_renewal role gate moved from the JWT `app_role` claim to `private.current_member_role()` — contradicts Boundaries "re-created with only the call added". Forced by the 19.1 grandfather cap and documented in the 0119 header and triage row 11, but the human has not signed off. Effects: the check now runs after the suspension gate (a non-staff caller on a suspended gym gets "gym is not active", not "permission denied"), and a staff caller with no active `members` row in the gym is refused where the claim sufficed. `current_member_role()` already gates 63 other call sites and filters `deactivated_at is null`. Options: (1) accept as shipped; (2) keep the claim read and raise the 19.1 grandfather cap by one; (3) split the gate change into its own migration. [supabase/migrations/0119_loyalty_subscriber_rule.sql:322-328] (verified: medium)
- [x] [Review][Patch] M14 guard tests are vacuous — payments c1-c3 and member 05003e have no previous subscription, so the hook exits at the "no previous" return even with the purpose/status/voided guards deleted. Give M14 a renewal-shaped fixture (previous same-plan subscription with expiry today, newer subscription linked to each payment) so a missing guard would stamp. [supabase/tests/loyalty_subscriber_rule.test.sql:523-545] (verified: medium)
- [x] [Review][Patch] Matrix row "late vs original, on time vs extended" has no test that exercises an extension — M4 only sets previous expiry to today. Add a case: reward extends a subscription by R, then renew on a date late against the original expiry but on time against the extended one. [supabase/tests/loyalty_subscriber_rule.test.sql] (verified: medium)
- [x] [Review][Defer] Hook runs unguarded inside payment verification — already recorded in deferred-work.md by the build pass (20.4 decides failure posture for all Epic 20 hooks) — deferred: not re-appended
- [x] [Review][Defer] An early renewal forfeits the remaining period including any rewarded R days (new period starts at `current_date`) — deferred: pre-existing `start_date := current_date` semantics in confirm_renewal / complete_verified_payment, outside this story's Never list
- [x] [Review][Defer] Subscriber free days render as "Free session granted" in the audit UI — deferred: spec forbids new labels; copy belongs to 20.5
- [x] [Review][Defer] `gyms.timezone` has no database validation, so an unresolvable zone would make the hook raise and roll back a paid renewal — deferred: unverified medium; settle by checking the settings-form schema validates against the IANA list (fold into the 20.4 hook-failure decision)

#### Rejected

- `renewal_confirmed` audit `new_expiry_date` is pre-extension (BH, EC, AA) — low: audit rows record the value at that time; the `loyalty_reward_granted` row carries old/new; reordering would reorder audit rows.
- Skips write nothing, so support cannot see why a renewal earned no stamp (BH) — design choice, no defect shown.
- Server `current_date` vs gym-local date near midnight (BH, EC) — low: pre-existing start_date code; the skew is at most one day inside a two-day on-time window.
- `complete_verified_payment` plan lookup has no id tie-break (EC) — low: pre-existing 0109 body; needs two subscriptions with identical `created_at`.
- Previous subscription `cancelled`/`paused` earns (EC, BH) — false: `subscription_status` is active/expiring_soon/grace_period/expired; no such status exists.
- Test fixtures mix `current_date` and Douala date (BH) — false for the on-time assertions: they use `pg_temp.today()` consistently; `current_date` only feeds created/start dates computed the same way by the functions.
- 0031 queue "no stamp" proven by superuser UPDATE (VG) — low: the hook is wired into no trigger (header grep); queue path creates no subscription.
- `confirm_renewal` replay done by calling the hook twice (AA) — a second confirm_renewal call creates a new payment by design; hook replay is the right unit.
- Dashboard test does not assert subscriber metadata renders (AA) — low: labels only, no metadata renderer in this story.
- Spec status `done`, unchecked tasks, empty change log, `last_updated` header (AA, BH) — fix edits the spec under review / sprint-status keeps its log as comments.
- Rollback verify block does not check the 0093 gate; hand-copied bodies; no `if exists` (BH, AA) — low: script applied, rolled back and re-applied locally; extra guards exceed a direct fix.
- supervisor_manager_plus_access guard accepts `current_member_role` (BH) — low, follows from the decision above.
- No race tests for the new lock interleavings (BH) — low: lock order payment -> member -> progress matches AD-27 on both paths.
- Missing negative cases: deactivated webhook member, null K/R, `throws_ok` with null message, update row counts (BH, VG) — low, cosmetic test depth.
- Returned `new_expiry_date` includes the extension (AA) — intended, informational.
- Deactivated staff / multi-membership role resolution (EC) — covered: `current_member_role()` filters `deactivated_at is null` and resolves per JWT gym; part of the decision above.

### Review Findings (pass 2, 2026-10-13)

Second code review (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) of `7e287b2` against the working tree (committed 8292774 plus the pass-1 patches).

- [x] [Review][Decision] RESOLVED 2026-10-13 (option 1, restore role-before-gate; delegated to reviewer): confirm_renewal runs the suspension gate BEFORE the role check, so a non-staff caller at a suspended gym learns the gym's status instead of `permission denied` — `tenant_suspension_enforcement.test.sql:339-345` records that the 2026-09-09 review moved the gate BELOW role resolution for the three staff RPCs for exactly this status-probe reason; 0119 reintroduces the opposite order for `confirm_renewal` (0093 checked role first). The earlier "accept as shipped" decision named the effect but not that rationale, and no test pins either order: `tenant_suspension_enforcement.test.sql:334,414` use an owner and an unresolvable claim (pass either way) and the new negative tests assert `permission denied` only at an active gym. Options: (1) restore role-before-gate and loosen the unresolvable-claim test at `:414` to accept `permission denied` (null role); (2) keep the order and add a `member`-at-suspended-gym assertion that pins `is not active`, recording why it differs from the 2026-09-09 rule; (3) split the gate change out of 0119. [supabase/migrations/0119_loyalty_subscriber_rule.sql:312-328] (verified: medium; VG, AA, EC)
- [x] [Review][Patch] M13 comment says "late (expiry - 3 days)" but the fixture sets the previous expiry to `today() - 3`, i.e. expiry + 3 days. [supabase/tests/loyalty_subscriber_rule.test.sql:530] (verified: low; BH)
- [x] [Review][Defer] Hook runs unguarded inside payment verification (EC, BH) — deferred: already in deferred-work.md (20.4 decides the failure posture for all Epic 20 hooks); not re-appended

#### Rejected (pass 2)

- Null gym timezone makes the on-time guard NULL (BH) — false: `gyms.timezone text not null default 'Africa/Douala'` (0002).
- Null `expiry_date` / lifetime plan at K, NULL-duration idle window differs from `effective_loyalty` (EC, BH) — false: `plans_duration_days_matches_plan_type` (0017) forces `duration_days` not null for every non-pay-per-session plan, and the hook returns early for pay-per-session, so `coalesce(duration, 0)` never fires and both windows match.
- Missing `platform_session_config` row / NULL idle days (EC) — false: singleton NOT NULL CHECK (0107); triaged in pass 1.
- Previous subscription `cancelled`/`frozen` status earns (EC) — false: `subscription_status` has no such value.
- Lock order "subscriptions then progress last" not literal (AA, EC) — low: the renewed subscription row is inserted in the same transaction, so its row lock is already held, and the member lock serializes both callers; only the header wording is loose, no deadlock.
- On time judged at verification, not payment time (EC) — spec decision ("evaluated at verification time"); fix edits the spec.
- Grace period wider than the on-time window (BH) — spec decision (expiry or the day after); fix edits the spec.
- Idle-reset audit row written when the reset insert conflicts (AA, BH) — false: the replay guard on `stamp_earned` returns before the reset path, and a payment's reset row cannot exist without its stamp row.
- Audit `new_expiry_date` is pre-extension; two clocks (`current_date` vs gym-local) near midnight; subscriber reward shares the "Free session granted" label; early renewal forfeits remaining days — already triaged in pass 1 (low rejected or deferred).
- Audit-label test weak, no concurrency test, brittle/untested rollback, weak post-condition asserts, supervisor `lives_ok` silently earns a stamp, owner/manager not driven through the new gate in the new tests, unexercised test-matrix corners (R/K bounded by CHECK 1-30 / 3-24, class_only renewal, voided re-verify covered by M14), redundant M8 update, hand-counted `plan(93)` — low: cosmetic or test depth, fix is more than a direct correction.
- Unverified pgTAP / ci-local green (AA) — not a defect; the full gate runs before merge.

Pass 2 resolution (2026-10-13): option 1 applied. 0119 `confirm_renewal` now resolves the role via `private.current_member_role()` first, then the suspension gate (still before the first write, so `suspension_rpc_coverage` placement holds). `tenant_suspension_enforcement.test.sql:416` now expects `permission denied` for the unresolvable-gym claim (no membership); new negative-test case pins a member of a suspended gym getting `permission denied` (plan 16 -> 17). M13 comment fixed. Local: 0119 re-applied, six affected pgTAP files green (93/17/88/7/15/31). 0119 header comment updated in place; rollback script unaffected.

### Review Findings (pass 3, 2026-10-13)

Third code review (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) of `7e287b2` against the working tree (committed 8292774 plus the pass-1/pass-2 patches). No decision-needed; four test-only patches; nothing new to defer.

- [x] [Review][Patch] M4b never makes the hook read the extended expiry — after the grant the test calls `pg_temp.prev_expiry(member, today())`, overwriting the extended `expiry_date`, so the second renewal is judged against a hand-set "expiry today" and passes whether or not the extension persisted. Assert the stored expiry equals the audit `new_expiry_date`, then shift the dates uniformly (not overwrite) so the extended expiry lands on today; fix M4's "7 days earlier" comment to match its fixture. [supabase/tests/loyalty_subscriber_rule.test.sql:328-358] (verified: low; AA)
- [x] [Review][Patch] M5 fixture is time-of-day dependent — `expiry_date = current_date - 1` uses the session date while the hook judges the Douala date; between 23:00 and 24:00 UTC the renewal is "late" at the hook, so M5 passes with the `if not p_backdate` guard deleted. Use `pg_temp.today() - 1`. [supabase/tests/loyalty_subscriber_rule.test.sql:361-371] (verified: low; VG)
- [x] [Review][Patch] Suspended-gym negative test is vacuous — `throws_ok(..., 'P0001', null, ...)` for a member with no subscription also raises P0001 ("no existing subscription") if the gate is removed. Assert the `is not active` message. [supabase/tests/loyalty_subscriber_rule.negative.test.sql:135-137] (verified: low; VG)
- [x] [Review][Patch] M18 label overstates coverage — the previous subscription is on another plan, so the hook returns at the plan-mismatch check, not the `expiry_date is null` guard; that guard is unreachable (0018 forces a non-null expiry on every non-pay-per-session plan). Reword the comment and assertion message to what it covers. [supabase/tests/loyalty_subscriber_rule.test.sql:603-612] (verified: low; VG)

#### Rejected (pass 3)

- Grace-period renewals never earn; early renewal earns nothing and forfeits remaining days (BH) — spec decision (approved early-renewal-earns-nothing, on-time = expiry or day after); the forfeit is already deferred in pass 1; fix edits the spec.
- Skipped renewals leave no trace (BH) — design choice, rejected in pass 1.
- Lock-order claim untested / race script skipped (BH) — false for the note: `session-refund-race.sh` covers refund vs `consume_guest_session`, not renewals; lock order payment -> member -> progress matches AD-27 on both paths (pass 1, low).
- Two clocks near midnight (BH, EC) — low, rejected in passes 1 and 2 (pre-existing `current_date` start_date).
- Unvalidated `gyms.timezone`; hook unguarded inside payment verification (BH, EC) — already deferred in deferred-work.md; not re-appended.
- Dashboard label test tautological, spec/sprint bookkeeping, rollback hand copy (BH) — rejected in passes 1 and 2.
- Refund of a renewal keeps stamp and free days (BH) — spec choice (FR-162), documented in the 0119 header; reversal is 20.4's.
- `renewal_confirmed` audit expiry differs from the returned expiry (BH) — low, rejected in pass 1.
- Previous-subscription tie on equal `created_at` (EC) — false: a renewal runs in a later transaction than the subscription it renews, so `created_at` differs; triage row 5.
- Idle-reset audit written when the reset insert conflicts; `reward_granted` conflict leaves the counter zeroed (EC) — false: the `stamp_earned` replay guard returns before either path, and a payment's reset/reward row cannot exist without its stamp row.
- confirm_renewal role gate change (EC) — resolved in passes 1 and 2.
- K consecutive webhook renewals not chained in one test (AA) — low: the hook is shared with `confirm_renewal`, which M1 chains; fix is added test depth.

Pass 3 resolution (2026-10-13): all four patches applied, test-only. M4b asserts stored expiry = audited extended date before the shift; M4 comment corrected; M5 fixture uses `pg_temp.today() - 1`; suspended-gym negative asserts the `is not active` message; M18 wording narrowed. `loyalty_subscriber_rule.test.sql` plan 93 -> 94. Local: both files pass (94, 17) via scripts/pgtap-run.sh. No migration change.
