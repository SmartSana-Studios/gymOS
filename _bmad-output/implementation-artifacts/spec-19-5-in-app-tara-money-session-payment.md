---
title: '19-5 In-app Tara Money session payment'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '886cabc4d3ab7796ac9d1841f1ab023698458e28'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A session guest can only pay at the desk. No member-callable RPC starts a Tara payment for a session, and `complete_verified_payment` neither creates a session nor takes the member lock on its subscription path.

**Approach:** Migration 0109 adds `initiate_session_payment()` (shape of `initiate_registration_fee_payment`, caller is the member) and rewrites `complete_verified_payment` to lock payment then member on every purpose branch, with a `session` branch that creates one `guest_sessions` row through 19.4's `private.create_guest_session_for_payment`. No new Edge Function; no UI (19.11); no consumption (19.6b).

## Boundaries & Constraints

**Always:** Caller role via `private.current_member_role()` = member only; member row resolved from `auth.uid()` and `private.gym_id()`. Suspension guard (`private.current_gym_status() is distinct from 'active'`, "is not active") before any write. Amount and currency from the latest subscription's plan (`order by created_at desc, id desc`), never a parameter. The new payment is `processing` (the status `payment-webhook` initiate and `complete_verified_payment` require), `method = 'mobile_money'`, provider from `active_payment_provider()`, which must have a `gym_payment_credentials` row. Lock order: expiry on payment rows, then member `FOR NO KEY UPDATE`; in `complete_verified_payment`, payment row lock then member lock, before any other write, on every purpose branch. One in-flight session payment per member, enforced by a partial unique index as well as the check. The late path creates the session only for `flagged_reason = 'expired_attempt'`. Errors are `'<code>: <message>'`. Definer functions `set search_path = public`; revoke EXECUTE from public and anon. Audit `session_payment_paid` and `session_late_payment` with EN/FR dashboard labels.

**Never:** No new Edge Function and no `payment-webhook` change. No mobile or dashboard payment UI. No check-in or class gating, no consumption (19.6b/19.7). No refund or revenue change (19.8). No flag flip. Never create a session for a payment flagged `wrong_account`, `reconciliation_mismatch`, `staff_flagged` or `provider_declined`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initiate | member, charging on, Tara connected, latest plan pay_per_session price>0, fee settled | one `processing` `session` payment at plan price/currency; returns payment_id and provider_key | N/A |
| Not a member | staff, coach, no role | refused | permission denied |
| Flag off | gym charging false | refused, no row | `charging_disabled` |
| Wrong plan / none | latest plan not pay_per_session, or no subscription | refused | `plan_not_per_session` |
| Price 0 | pay_per_session price 0 | refused | `session_price_not_set` |
| No Tara | no active provider or no credentials row | refused | `no_active_provider` |
| In flight | session payment `processing`, under 10 min | refused, no row | `session_payment_already_in_progress` |
| Stale attempt | `processing` session payment over 10 min | flagged `expired_attempt`, audited, new one proceeds | N/A |
| Deactivated / awaiting fee | deactivated, or `registration_fee_settled_at` null | refused | `member_deactivated` / `registration_fee_not_settled` |
| Suspended gym | member of suspended gym | refused | "is not active" |
| Confirm | processing session payment, webhook completes | `verified`, one session, `usable_until` now + config days, audit | N/A |
| Replay | same confirmation again | nothing new (0 rows updated, one session via unique `payment_id`) | no-op notice |
| Late confirm | payment flagged `expired_attempt` | `verified`, `flagged_reason = 'late_confirmation'`, session created, audit | N/A |
| Bad flag | flagged `wrong_account` / `reconciliation_mismatch` / `staff_flagged` / `provider_declined` | no session, row unchanged | no-op notice |
| Subscription confirm | renewal payment, desk action on same member | serializes via payment-then-member locks, no deadlock | N/A |

## Decisions

- New payment status is `processing`, not the AC's `pending`: webhook initiate and completion filter on `processing`, and the registration-fee flow does the same. This also settles 19.4 triage #1 (no `pending` session row exists).
- `initiate_session_payment()` returns `table (payment_id uuid, provider_key text)` so the app needs no second read.
- `private.create_guest_session_for_payment` gains caller assertions (payment exists, `purpose = 'session'`, `verified`, member and gym match), closing 19.4 triage #2 now that a second caller exists.
- `provider_declined` followed by a success is left flagged for staff; only `expired_attempt` is the late case the AC names.
- Producing `wrong_account` on a payment row is not done here (the webhook leaves a mismatch for reconciliation); this story only guarantees such a row never yields a session.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0100_registration_fee_tara_collection.sql:106-201` -- `initiate_registration_fee_payment`: guard, expiry-then-lock, insert and unique_violation shape to mirror
- `supabase/migrations/0106_flagged_payment_reason.sql:229-368` -- current `complete_verified_payment` body to copy; late branch, ACL block (`revoke public, anon, authenticated`, grant service_role)
- `supabase/migrations/0108_desk_session_payment.sql:47-121` -- `private.expire_stale_payment`, `private.create_guest_session_for_payment` (assertions go here); `:126-254` `record_session_payment` check order and audit shape
- `supabase/migrations/0090_suspension_enforcement_in_rpcs.sql:1169-1265` -- `initiate_member_payment`: member-from-`auth.uid()` lookup (`order by deactivated_at nulls first`)
- `supabase/migrations/0107_charge_guests_setting_session_record.sql` -- `guest_sessions`, `platform_session_config`, `payments_purpose_check`; `0099/0106` pin trigger on `payments`
- `supabase/functions/payment-webhook/index.ts:55-300,540-610` -- initiate route and completion call, unchanged; read-only check that `session` rows pass its filters
- `supabase/tests/desk_session_payment*.test.sql`, `flagged_payment_reason.test.sql`, `registration_fee_collection*.test.sql`, `suspension_rpc_coverage.test.sql` -- pgTAP patterns; new RPC body must match the suspension-guard regex
- `packages/types/src/database.ts` -- splice the RPC only (decisions.md)
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts`, `auditLabels.epic19.test.ts`, `locales/{en,fr}.json` (`audit.actionTypes`) -- two new action labels
- `apps/mobile/src/services/payments.ts:16,77,171` -- `isSession` already shipped in 19.4; no change
- `_bmad-output/implementation-artifacts/deferred-work.md`, `docs/decisions.md` -- close 19.4 triage #1/#2, record the lock-order and `processing` decisions

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0109_in_app_tara_session_payment.sql` -- `initiate_session_payment()`, one-in-flight partial unique index, assertions in the session-creation helper, `complete_verified_payment` rewrite (locks on every branch, session branch, late-session handling), grants, `do $verify$` block
- [x] `supabase/tests/in_app_session_payment.test.sql` + `.negative.test.sql` -- one assertion per matrix row, incl. replay, late, each bad flag, lapse value from config
- [x] `supabase/tests/complete_verified_payment_member_lock.test.sql` -- subscription, fee and session branches each take the member lock after the payment lock; sequential subscription confirm plus desk action on one member; record the pgTAP concurrency limit as 19.4 did
- [x] `packages/types/src/database.ts` -- splice RPC
- [x] `auditLabels.ts`, dashboard locales, `auditLabels.epic19.test.ts` -- `session_payment_paid`, `session_late_payment`
- [x] `_bmad-output/implementation-artifacts/deferred-work.md`, `docs/decisions.md` -- close triage #1/#2, record decisions

**Acceptance Criteria:**
- Given 0109 applied, when the existing payment, fee, desk-session and flagged-reason pgTAP suites run, then all pass unchanged.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given a redelivered webhook for a verified session payment, then `guest_sessions` still has exactly one row for it.

## Implementation Notes

- `desk_session_payment.test.sql` fixture edit: the one-in-flight index (`pending` and `processing`) rejects the old fixture that held a `processing` and a `pending` session payment on one member. The pending row moved to another member and `private.expire_stale_payment` is called once for that member; every assertion is unchanged. This is the one place "existing suites pass unchanged" is not literal.
- A deactivated member has a null `current_member_role()`, so `initiate_session_payment` lets a null role through to the member row to reach `member_deactivated`; staff, coaches and callers without a member row get `permission denied`.
- A session payment confirmed for a deactivated member or a suspended gym still verifies and creates a session (money is real; same rule as the fee branch).
- pgTAP runs in one session, so true lock interleaving is not exercised; lock order is source-pinned plus a row-lock observation.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap, edge, blind | Member lock on every branch verified only by `position()` over `prosrc`; sequential test passes with the lock removed | medium | patch | Single-session pgTAP cannot interleave, and no assertion observes the row lock. Fix: assert the member row's `xmax` after a confirmation; source checks stay as a secondary guard. |
| 2 | gap | "No active provider" test calls as gym D, which has no credentials row, so provider-inactive is not distinguished | low | patch | Test fixture only; the RPC branch is correct, but a hard-coded provider would pass. One assertion for a gym with credentials fixes it. |
| 3 | edge | Lock-order inversion with RPCs that lock member then update an existing payment row | false | reject | `void_registration_fee_payment` (0101:103,113) locks payment then member; `record_registration_fee`/`waive` lock the member and only insert; 0031 confirm locks the payment first. |
| 4 | edge, blind | `unique_violation` handler catches any unique violation on the insert | low | reject | The inserted row has a null provider ref and `purpose = 'session'`, so only the in-flight index can fire; same handler shape as 0100's fee initiate. |
| 5 | edge, blind | Late confirmation creates a session even if the member has since paid, is deactivated, or the gym is suspended or flag off | low | reject | AC says the late session is created; money is real. Same rule as the fee branch. A second session is a second payment. |
| 6 | edge | Confirmed amount not compared with the current plan price | false | reject | Amount is fixed on the row at initiation; a changed plan price after initiation is irrelevant and provider amount mismatches go to reconciliation (0054/0076). |
| 7 | edge, blind | Session flagged `staff_flagged`/`reconciliation_mismatch`/`provider_declined`/null reason then confirmed leaves only a notice, no audit | low | defer | AC requires no session and the row stays flagged and visible with its reason; `provider_declined` then success is blocked by the webhook's status check. Whether a trace is wanted, and how `wrong_account` is produced, is in deferred-work.md. |
| 8 | edge | Audit currency uses the payment currency while the fee path hardcodes XAF | false | reject | Session amounts are in the plan's currency; the literal on the fee path is the fee's own. |
| 9 | edge, blind | Lock-order checks use `position()` on source text; titles claim lock behavior | low | reject | Repeat of #1; covered by that patch and the acknowledged pgTAP limit (19.4 decisions item 7). |
| 10 | edge, blind | AC "existing suites pass unchanged" is not true: `desk_session_payment.test.sql` was edited | low | reject | The index makes a processing plus a pending fixture impossible by design (AC: one in flight, DB-enforced); assertions are unchanged. Recorded in Implementation Notes; fix would edit the spec. |
| 11 | edge, gap | A manually inserted `pending` session row blocks the member forever (expiry flips only `processing`) | low | reject | No code path creates a `pending` session row (desk inserts `verified`, 0109 inserts `processing`); repeat of 19.4 triage #1. |
| 12 | blind | The unique index makes a second desk `record_session_payment` fail | false | reject | 0108:232 inserts the desk row as `verified`, outside the index; `desk_session_payment.test.sql` "double entry yields two sessions" still passes. |
| 13 | blind, gap | Webhook never tested with a `session` row | false | reject | `payment-webhook` initiate and completion filter on status and `provider_transaction_ref` only (index.ts:158, 355); no purpose assumption. |
| 14 | blind | Helper failure (`session_config_missing`) rolls back verification of a paid payment | low | reject | The singleton config row is seeded by 0107; a rollback leaves the payment `processing` for webhook retry, which is the safer failure. |
| 15 | blind | Plan currency unvalidated against the provider, no non-XAF test | low | reject | Plans carry their own currency and 19.4's desk path does the same; no provider currency contract exists in code. |
| 16 | blind | `authenticated` EXECUTE on the private helper not asserted | false | reject | Same pattern 19.4 rejected: `private` is not an exposed API schema and public/anon are revoked and asserted. |
| 17 | blind | New deferred items not recorded | low | defer | Real: wrong_account production and unexplained-success trace recorded in deferred-work.md. |
| 18 | blind | Spec bookkeeping stale (status, task boxes, notes) | low | reject | Fix edits the spec under review; tasks ticked and notes written by this step, status set in step 5. |
| 19 | blind | Renewal select orders by `created_at` only, unlike the new `id` tiebreak | low | reject | Pre-existing code carried over verbatim; same-timestamp subscriptions are not producible through the app. |
| 20 | blind | EN label "Paid session payment received" is clumsy; late label ambiguous | low | reject | EN rule is "paid session" always qualified; cosmetic, the FR label is correct. |

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: static, pgtap, unit, e2e PASS
