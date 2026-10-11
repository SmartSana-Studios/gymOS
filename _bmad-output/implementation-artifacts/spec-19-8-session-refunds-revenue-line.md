---
title: '19-8 Session refunds & revenue line'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '117c1a5a6c0704297e7b9bbaaf734e4d17f9f7a9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A refund of a session payment leaves its session usable, so a refunded guest can still check in; refund/consume races are unguarded; session consumption, blocked attempts and refunds write no data-layer audit row; and session money is mixed into the subscription Revenue figure.

**Approach:** Migration 0113 adds an `AFTER INSERT` trigger on `refunds` that voids an unconsumed session on a full refund or calls a no-op reversal hook for a consumed one, audit triggers for consumption and blocked attempts, and splits revenue: `gym_revenue_mtd()` excludes session payments, new `gym_session_revenue_mtd()` returns the net session figure, and the Overview shows it as its own sub-line.

## Boundaries & Constraints

**Always:** The refund trigger (SECURITY DEFINER, `private.`) acts only when the payment's `purpose = 'session'`. It takes the member lock (`FOR NO KEY UPDATE`) first, then reads the linked `guest_sessions` row (`payment_id`) `FOR UPDATE`, in the canonical order. Full refund (`amount = payment.amount`) of a session with `consumed_at` null and `voided_at` null sets `voided_at = now()`. A partial refund voids nothing. A consumed session stays consumed and `private.on_session_refunded_after_consumption(session_id, member_id, gym_id)` is called (no-op, revoked from public/anon/authenticated; Epic 20 fills it) for any refund of it. Refunds of other purposes are untouched. Each trigger writes through `log_audit_event()` with member as target and the amounts/ids in metadata: `session_refund_applied` (outcome `voided` | `kept_partial` | `kept_consumed`), `session_consumed` (AFTER UPDATE of `guest_sessions` when `consumed_at` goes null → set), `session_attempt_blocked` (AFTER INSERT on `session_attempts`). Existing `session_payment_recorded`/`session_payment_paid` cover payments. `gym_revenue_mtd()` keeps its signature and ACL, drops payments with `purpose = 'session'` and the refunds of them; `gym_session_revenue_mtd()` is SECURITY INVOKER, uses `private.gym_local_month_bounds`, excludes voided payments, subtracts session-payment refunds, and is not granted to PUBLIC. Overview: a "Guest sessions: XAF N" / "Séances des invités : N XAF" line beneath the revenue figure, separate from the fee "of which" line, shown when the gym's `charge_guests_per_session` is true or the figure is > 0; hidden, with the headline unaffected, if its read fails.

**Never:** No change to `consume_guest_session`, `check_in`, `mark_class_attendance`, or the stamp logic (hook is empty). No refund UI change, no Guest sessions card or page (19.10), no Settings control (19.9), no coded refund error. No edit to historical migrations. Platform-level metrics (0103) are not changed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full refund, unused | session unconsumed, not voided | `voided_at` set; later check-in is denied | N/A |
| Partial refund, unused | amount < payment amount | session untouched; audit `kept_partial` | N/A |
| Refund after use | session consumed | stays consumed; visit counted; hook called once; audit `kept_consumed` | N/A |
| Race | refund and consume concurrently | exactly one wins: voided and denied, or consumed and kept; never both | pgTAP concurrency proof |
| Other purpose | subscription/fee refund | no session effect; headline net unchanged from before | N/A |
| Revenue | session payment 5000, refund 2000 | headline excludes both; session line shows 3000 | read fails → line hidden |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0101_registration_fee_void_refund_revenue.sql:130-175,176-240` -- `block_fee_and_voided_refunds` trigger style to copy; current `gym_revenue_mtd()` body (latest, check 0103/0104 for ACL) and `gym_registration_fee_revenue_mtd()` shape
- `supabase/migrations/0107_charge_guests_setting_session_record.sql:198-260` -- `guest_sessions` shape, `payment_id` unique index
- `supabase/migrations/0111_check_in_session_gate.sql:105-210` -- `consume_guest_session()` (member lock then session `FOR UPDATE`), `on_session_consumed` hook pattern; `session_attempts` table (0111:36-52)
- `supabase/migrations/0007_audit_log.sql:140` -- `log_audit_event()` (keep gym match; no session → system label)
- `supabase/tests/gym_revenue_mtd.test.sql`, `registration_fee_void_refund_revenue.test.sql` -- fixture patterns; update for session exclusion
- `apps/dashboard/services/payments.ts:731-755` -- `getRevenueMtd`/`getRegistrationFeeRevenueMtd`; add `getSessionRevenueMtd` the same way (+ unit test beside `payments.getRegistrationFeeRevenueMtd.test.ts`)
- `apps/dashboard/services/gym-settings.ts:70-110` -- `getGymSettings()`; add `chargeGuestsPerSession`
- `apps/dashboard/app/(dashboard)/page.tsx:139-250` -- revenue card; `StatCard` `detail` is one string, so render both sub-lines
- `apps/dashboard/components/ui/stat-card.tsx`, `locales/en.json:50`, `locales/fr.json:50` -- card + strings
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts:57-76` (+ `auditLabels.epic19.test.ts`) -- labels for the three new event types, EN/FR
- `packages/types/src/database.ts`, `scripts/migration-guardrails.grandfather.json`, `docs/decisions.md` (runbook row 0113)

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/0113_session_refunds_revenue_line.sql` -- refund trigger, hook, two audit triggers, revenue functions, `$verify$`
- [ ] `supabase/tests/session_refund*.test.sql` (+ `.negative`, + concurrency) -- one case per matrix row; one audit row per event type; renewal refund unaffected; suspension/RPC coverage lists
- [ ] `supabase/tests/gym_revenue_mtd.test.sql` -- session exclusion cases
- [ ] `payments.ts`, `gym-settings.ts`, `page.tsx`, locales, `auditLabels.ts` (+ unit tests) -- revenue sub-line, visibility rules, labels
- [ ] `database.ts`, `scripts/rollback-0113-*.sql`, grandfather list, `docs/decisions.md`

**Acceptance Criteria:**
- Given 0113 applied, when the refund, revenue, attendance, check-in gate and suspension suites run, then all pass.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given the rollback script in a rolled-back transaction, then `gym_revenue_mtd()` matches 0101 and the new triggers/functions are gone.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap | StatCard array `detail` has no render test | medium | patch | Only string/omitted cases rendered; page test stops at the prop. Fixed: stat-card.test.tsx array case. |
| 2 | gap | Session line with failed headline read untested | medium | patch | `!revenueFailed` could be removed with CI green. Fixed: page.overview case. |
| 3 | gap, blind | `session_consumed` source `free` branch never asserted | low | patch | Only paid asserted. Fixed: free-source consume in session_refund.test.sql (39 assertions). |
| 4 | gap | Race invariant proven only by manual script, not in CI | medium | defer | Two-session race does not fit pgTAP; script exists, CI hook is a separate decision. |
| 5 | gap, blind | platform_metrics() (0103) still counts session payments | medium | defer | Spec Never excludes 0103; decide with 19.10/19.12. |
| 6 | blind | Definer triggers use `search_path = public` without `pg_temp` | low | defer | Repo-wide convention (0101 etc.), not introduced here. |
| 7 | blind | Audit triggers not in suspension coverage allow-list | false | reject | suspension_rpc_coverage passes (126/126 pgTAP); only apply_session_refund needed an entry. |
| 8 | blind, edge | Voided payment's refund double-subtracts in session line | low | reject | Only registration_fee payments can be voided; 0101 blocks refunds of voided payments. Unreachable. |
| 9 | blind | Hook receives no refund amount/id | low | reject | Signature fixed by epic AC; Epic 20 owns the hook. |
| 10 | blind | Attempt audit fires on every insert; class source untested | low | reject | session_attempts holds only blocks by definition; trigger is source-agnostic. |
| 11 | blind | Race script cleanup cannot delete audit_log | false | reject | Script runs as superuser in the container; implementer's 8/8 runs cleaned up. |
| 12 | blind, edge | Race script N>254, swallowed contender errors, sleep ordering | low | reject | Dev tooling with N fixed at 8; not CI. |
| 13 | edge | Over-refund classified kept_partial; `>=` suggested | low | reject | Frozen intent says amount equals payment amount; policy caps amount upstream. |
| 14 | edge | log_audit_event raising aborts check-in | low | reject | Gym always matches the member's own gym; same pattern as existing 0110/0111 audit calls. |
| 15 | edge | No audit row when payment has no session row | low | reject | Verified session payments always create a session; refund_recorded already audits app-side. |
| 16 | edge | Session line shown to roles without revenue access | false | reject | Revenue card already shows to all non-coach staff; coach is redirected. |
| 17 | blind | Guest sessions copy ambiguous vs "of which" | false | reject | Verbatim from epic UX-DR25; separate from the fee line by spec. |
| 18 | blind | Rollback untested | false | reject | Run in a rolled-back transaction; restored 0101 body. |
| 19 | blind | StatCard call site clumsy / index keys | low | reject | Cosmetic. |

## Design Notes

- The member lock serialises refund against consumption; under READ COMMITTED the post-lock session read sees the winner's commit, so no extra isolation is needed.
- Audit lives in triggers so every writer (check_in online/sync, class attendance, service_role refunds) is covered without rewriting 0111/0112 functions.

## Verification

**Commands:**
- `bash scripts/pgtap-run.sh` -- expected: all files pass
- `node scripts/check-migration-guardrails.mjs` -- expected: no new violations
- `bash scripts/ci-local.sh` -- expected: all stages PASS
