---
title: '20-2 Guest rule: stamps on paid sessions, free session at N'
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '874ecd6cddb915ef11140352b8e7733cb67f13b1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Guests at a gym that charges per session earn nothing for coming back: `private.on_session_consumed()` (0111) is a no-op, so no stamp, free session or ledger entry exists (FR-165, FR-166).

**Approach:** Migration 0118 replaces the hook body. A consumed paid session earns one guest stamp; at N one free session is granted and the counter returns to 0; a consumed free session records `reward_consumed`. All in the consuming transaction, exactly once per session.

## Boundaries & Constraints

**Always:**
- Number is **0118**. Only `private.on_session_consumed(uuid, uuid, uuid)` changes (`create or replace`, same signature, still revoked from public/anon/authenticated, no client-callable surface). `consume_guest_session()`, `check_in()`, `mark_class_attendance()` are untouched; class attendance earns through the same hook.
- Paid session (`payment_id` not null) stamps only when the gym has `loyalty_enabled` and `charge_guests_per_session` on at consumption time. Program off or charging off: nothing is written. Nothing is retroactive.
- Stamp: one `stamp_earned` (`counter guest`, `origin_id` = session id) and `loyalty_progress.guest_stamps + 1`, `guest_last_event_at` = the session's `consumed_at`. Progress row is created on first use. An existing `(origin_id, event_type)` row means a replay: return, change nothing.
- Idle reset first: if `guest_stamps > 0` and `guest_last_event_at` is older than `platform_session_config.loyalty_idle_reset_days` before `consumed_at`, write one `reset` event (`origin_id` = session id, details with previous count) and zero the counter, then stamp.
- At `guest_stamps >= N` (also when above a lowered N): one `reward_granted` event (`origin_id` = session id), one `guest_sessions` row with `loyalty_grant_id` set, `payment_id` null, `usable_until` = `consumed_at` + `free_session_validity_days`, counter to 0. Exactly one reward per stamp.
- Free session (`loyalty_grant_id` not null) consumed: one `reward_consumed` event (`counter guest`, `origin_id` = session id), recorded whatever the switches say; it changes no counter and does not extend the idle window.
- Audit rows via `log_audit_event` (actor as the surrounding call): `loyalty_stamp_earned`, `loyalty_reward_granted`, `loyalty_progress_reset`; free use is already audited by `session_consumed` (source free). EN/FR labels, no new UI.
- Lock order holds: member lock and the consumed session row are already held; `loyalty_progress` is locked last (`FOR UPDATE`). Windows and validity come from `platform_session_config`, never literals.

**Never:** No subscriber logic (20.3), no refund reversal, lapse event or sweep (20.4), no dashboard or mobile UI, no change to `effective_loyalty()` or the setter, no discount or amount change, no manual balance write path, no new client-callable function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paid, below N | program+charging on, stamps 2, N 5 | stamp event, stamps 3, no grant | N/A |
| Paid, reaches N | stamps 4, N 5 | stamp, `reward_granted`, free session 60 days, stamps 0 | N/A |
| Above lowered N | stamps 7, N lowered to 5 | one stamp, one grant, stamps 0 | N/A |
| Free consumed | free session consumed | `reward_consumed`, stamps unchanged | N/A |
| Covered re-entry | same covered day | hook not reached, nothing written | N/A |
| Program off / charging off | paid consumed | no event, no progress row | N/A |
| Idle past window | last stamp 91 days ago, stamps 3 | `reset`, then stamp: stamps 1 | N/A |
| Replay | hook run twice for one session | one stamp, one grant | no error |
| Plan change | free session held, member on Monthly then back | not consumable while off Pay-per-session, usable on return | N/A |
| Order | free and paid both unused | consumed per FR-159 (soonest lapse, paid first on tie) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0111_check_in_session_gate.sql` -- `on_session_consumed` no-op (line ~113) and its only caller `consume_guest_session` (~140-210); model for hook signature and revoke
- `supabase/migrations/0117_loyalty_program_ledger_foundation.sql` -- ledger/progress tables, FK, `effective_loyalty` (read window rule to match)
- `supabase/migrations/0113_session_refunds_revenue_line.sql` -- `audit_session_consumed` trigger (free use audit); refund hook left alone
- `supabase/migrations/0107_charge_guests_setting_session_record.sql` -- `guest_sessions` constraints (exactly one source, one consumed per day), `platform_session_config`
- `supabase/migrations/0061_staff_creation_role_ceiling_enforcement.sql` -- `log_audit_event` actor semantics
- `supabase/tests/loyalty_foundation.test.sql`, `check_in_session_gate.test.sql` -- fixture and `plan()` conventions; the `pg_temp.mk_grant` helper
- `supabase/tests/charge_guests_setting.test.sql` -- existing tests that consume sessions; must stay green (program off)
- `scripts/rollback-0117-*.sql`, `scripts/check-migration-guardrails.mjs` -- rollback shape, lint gate
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `auditLabels.epic20.test.ts`, `locales/en.json`, `fr.json` -- three new labels
- Do not touch: `consume_guest_session`, `check_in`, `complete_verified_payment`, `effective_loyalty`, 0113 refund hook

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0118_loyalty_guest_rule.sql` -- replace hook body per Boundaries; header lists lock order, replay key, what the reset event means for 20.4's sweep; verify block
- [ ] `supabase/tests/loyalty_guest_rule.test.sql`, `loyalty_guest_rule.negative.test.sql` -- matrix cases through real `check_in()` and the hook directly, replay, class attendance path, 19.10 card counts grants, ledger replay equals progress, cross-gym isolation, no client write
- [ ] `scripts/rollback-0118-loyalty-guest-rule.sql` -- restore the no-op hook, refuse nothing destructive, verify
- [ ] dashboard audit labels (3) in `auditLabels.ts`, `en.json`, `fr.json`, extend `auditLabels.epic20.test.ts`
- [ ] local gates: apply to local DB, `scripts/ci-local.sh` all stages; sprint-status entry; run `scripts/session-refund-race.sh` only if lock order is edited (not expected)

**Acceptance Criteria:**
- Given the matrix, when pgTAP and vitest run, then all pass and `scripts/ci-local.sh` is green on every stage.
- Given N paid consumptions through `check_in()`, when the Nth completes, then the member holds exactly one usable free session and the 19.10 overview counts it as given.
- Given the hook runs twice for one session, when counts are read, then the ledger holds one `stamp_earned` and at most one `reward_granted`.

## Implementation Notes

## Spec Change Log

## Review Triage Log


| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | Replay exists-check precedes the progress lock; stamp insert has no ON CONFLICT (EC, BH) | low | Every real caller holds the member lock and a session is consumed once, so no live path races; direct fix is moving the check after the lock. patch: done |
| 2 | Gym-mismatch guard in the hook never exercised (VG) | medium | Deleting the clause left all tests green. patch: negative test added (plan 14 -> 16) |
| 3 | reward_consumed writes no audit row (BH) | low | Deliberate: session_consumed (0113, source free) already audits it. patch: header note |
| 4 | platform_session_config missing/null (EC, BH) | false | Singleton row, NOT NULL CHECK > 0, no INSERT/DELETE grant (same as 20-1 triage 9) |
| 5 | guest_last_event_at can move backwards (EC, BH) | false | consumed_at is now() under the member lock on every live path; monotonic |
| 6 | Voided consumed paid session stamps (EC) | false | Refund of a consumed session is kept_consumed, never voided; consume skips voided rows |
| 7 | reward_granted conflict zeroes counter with no grant (EC) | false | Conflict needs an existing reward_granted without stamp_earned, unreachable; replay returns earlier |
| 8 | reset conflict still audits/zeroes (EC, BH) | low, rejected | Needs a reset row with the session id as origin and no stamp; 20.4 told to use its own origins (header) |
| 9 | Grant event belongs to other member/gym (EC) | false | Only the hook creates grants, with the session's own member and gym |
| 10 | U exact-90 assertion weak (EC) | false | A dropped stamp leaves counter 2, so '(0,0)' fails |
| 11 | Config durations only tested at defaults (VG, BH) | low, rejected | Code reads columns, not literals; test gap negligible |
| 12 | Audit metadata shape unasserted; stamps vs stamps_after naming (VG, BH) | low, rejected | Nothing renders it yet |
| 13 | N=1, reset+reach N, replay below N, free-consumed with charging off untested (BH, VG) | low, rejected | N=1 impossible (CHECK 2-50); rest negligible |
| 14 | Cross-tenant read tests, rollback gap, audit page rendering (BH) | low, rejected | Read isolation proven in 20.1 on the same tables; rendering is UI, out of scope |
## Design Notes

"Qualifying event" in FR-168 is read as a stamp: consuming a free session does not extend the idle window. Excess above a lowered N is not carried over (counter returns to 0, as the epic states). The stamp's `consumed_at` and the grant's `usable_until` are taken from the session row, not `now()`, so replays and tests are deterministic; for live paths they are equal. Hook stays SECURITY INVOKER like its caller chain (definer `check_in` / `mark_class_attendance`).

## Verification

**Commands:**
- `scripts/ci-local.sh --fast` -- expected: pgTAP and guardrails green
- `scripts/ci-local.sh` -- expected: static, pgTAP, unit, e2e green
