---
title: 'Story 18.3: Tara Money Fee Collection'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 08ca31eb0fe5bec999932a6766f12a7a73601d07
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff can collect an awaiting member's registration fee only by hand (Story 18.2). There is no way to charge it by Tara Money, and `complete_verified_payment` would treat a verified fee payment as a renewal.

**Approach:** Migration 0100 adds a staff-only RPC that inserts the `processing` fee payment at the gym's fee, redefines `complete_verified_payment` with a fee branch that settles the member and never creates a subscription, and tightens record/waive around in-flight Tara rows. A new service function and server action call the existing `payment-webhook/initiate/<provider>` route. The screens are Story 18.6.

## Boundaries & Constraints

**Always:** Amount is read from `gyms.registration_fee` server-side, never a parameter. Row: `purpose 'registration_fee'`, `status 'processing'`, `method 'mobile_money'`, active `provider`, `currency 'XAF'`, no `subscription_id`, `actor_id = auth.uid()`. New RPC: `security definer`, `set search_path`, PUBLIC execute revoked, `private.current_gym_status() is distinct from 'active'` guard (text contains `is not active`) before any write, fail-closed role gate owner/manager/supervisor/receptionist. The payer phone is a separate input from the member's phone: the front desk can change it (E.164, like `initiatePaymentSchema`). `complete_verified_payment` stays service_role-only and in the 0090 exclusion arrays; its `subscription` branch behaves exactly as before; the `processing` -> `verified` guard is the idempotency guard. Lock order is payment row first, member row second, in every function touching both. New strings EN/FR, `pnpm check:i18n` passes.

**Decision (stuck collections):** A Tara collection stays `processing` while it waits; mobile prompts always expire. While a fee payment is `processing` and younger than 10 minutes (the existing `stale_processing` threshold), a new Tara attempt, `record_registration_fee` and `waive_registration_fee` are all refused with `registration_fee_already_pending`. Once it is older than 10 minutes, the next of those calls first marks it `flagged` (no push, audit `registration_fee_attempt_expired`) and proceeds. A late success after flagging is not applied (same as the declined path; the `payment_webhook_events` row remains). A `verified` fee row yields `registration_fee_already_recorded`.

**Never:** No void RPC, refund block or revenue change (18.4); no UI, member-app, or `recordManualPayment` change (18.5-18.7). Do not modify `initiatePayment`, `initiate_member_payment` or any renewal initiator. Do not edit the payment-webhook Edge Function (it already charges `payments.amount` and deletes the row on failure). `complete_flagged_payment` is unchanged.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | Awaiting member, fee > 0, provider connected, payer phone | `processing` fee row at the fee; provider invoked with that row's amount | N/A |
| Payer override | Phone differs from member's | Accepted; used for the prompt only | invalid E.164 -> `validation_error` |
| No provider | Kill switch off, gym not connected, or no active provider | nothing written | `no_active_provider` |
| Not startable | Settled / deactivated / other gym / role != member / fee 0 | nothing written | `registration_fee_not_due` / `member_deactivated` / `not_found` / `not_found` / `registration_fee_not_configured` |
| Waiting | Fee row `processing`, < 10 min | Tara retry, record, waive refused | `registration_fee_already_pending` |
| Expired | Fee row `processing`, > 10 min | Row `flagged`, audit; Tara retry, cash or waive proceeds | N/A |
| Paid | Webhook success on a `processing` fee row | Row `verified` with `provider_fee_amount`; member settled; `registration_fee_paid` audit (actor `payment-webhook`); no subscription; `subscription_id` null | N/A |
| Replay | Same confirmation twice | Second is a no-op: no second audit row | N/A |
| Declined | Webhook failure | Row `flagged`, no notification; retry allowed | N/A |
| Provider call fails | Edge function errors | Row deleted by the function; error returned | `gym_credentials_unavailable` or mapped error |
| Direct insert | Staff inserts a fee row via RLS | denied (18.2 policy) | RLS |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0099_registration_fee_collection.sql` -- new file `0100_registration_fee_tara_collection.sql`. Copy the record/waive bodies, status guard, `log_audit_event` named args, grants, and `$verify$` shape. Redefine both with `create or replace` (same signature keeps the ACL): flag expired rows first (before the member `for update`), then pending vs recorded checks. Unique index `payments_one_registration_fee_per_member` already covers `processing`; map 23505 to `registration_fee_already_pending`.
- `0030_payment_initiation_and_renewal.sql:76` -- latest `complete_verified_payment` (only definition). Re-create with `purpose` returned from the first UPDATE and a fee branch (settle `coalesce`, audit, `return null`); the rest verbatim. `0090:1689-1692` exclusion arrays and `suspension_rpc_coverage.test.sql` exclusion view already list it; do not change.
- `0055_member_self_service_renewal.sql:30` -- `initiate_member_payment` shape for `payment_already_pending` / `no_active_provider` (do not edit). `0029:101` `active_payment_provider()`.
- `0046:267` notify trigger already skips `purpose != 'subscription'` (0099); `0048:11` `complete_flagged_payment` unchanged.
- `apps/dashboard/services/payments.ts:58` `initiatePayment` -- model for the new `initiateRegistrationFeePayment` (RPC for the row, then `functions.invoke`, `gym_credentials_unavailable` mapping, bare-digit phone) and `getPendingMobileMoneyPayment:184`; leave both untouched.
- `apps/dashboard/app/(dashboard)/payments/actions.ts:174` `initiatePaymentAction` + `getMobileMoneyAvailability` (`lib/featureFlags.ts:61`) -- model for the action; `disabled`/`not_connected` -> `no_active_provider`.
- `packages/types/src/schemas/payment.ts:27` -- add `initiateRegistrationFeePaymentSchema` (`memberId`, `phoneNumber`). `packages/types/src/errors.ts` + `locales/{en,fr}.json` -- map the new raise texts. `database.ts` -- hand-splice the RPC, alphabetical.
- `audit/auditLabels.ts:32-34` + `apps/dashboard/locales/{en,fr}.json` `audit.actionTypes` -- add `registration_fee_paid`, `registration_fee_attempt_expired`.
- Tests: `registration_fee_tara_collection.test.sql` + `.negative.test.sql`, fixture ids `…0313xx`; `payments.initiateRegistrationFeePayment.test.ts` modeled on `payments.initiatePayment.test.ts`. 18.2's pgTAP may assert `already_recorded` on a `processing` row: update only that assertion. `docs/decisions.md` -- dated entry.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0100_registration_fee_tara_collection.sql` -- `initiate_registration_fee_payment(member)` returning payment id + provider, the fee branch of `complete_verified_payment`, redefined record/waive, expiry helper, `$verify$` block -- schema + safety
- [x] `supabase/tests/registration_fee_tara_collection{,.negative}.test.sql` -- every I/O row, role matrix, replay, expiry boundary, flagged retry, cross-gym, suspended gym, no notification, no subscription created; pin that an awaiting member's `initiate_member_payment` raises `no_active_plan`
- [x] `apps/dashboard/services/payments.ts`, `payments/actions.ts` -- `initiateRegistrationFeePayment`, `getPendingRegistrationFeePayment` (id + createdAt) and actions
- [x] `packages/types` -- schema, error mapping, `database.ts` splice
- [x] Audit labels + EN/FR locales; `docs/decisions.md`

**Acceptance Criteria:**
- Given the full pgTAP suite, then green (including `suspension_rpc_coverage`); new files green.
- Given `pnpm typecheck`, `lint`, `check:i18n` and the dashboard and types tests, then pass.
- Given a settled-by-Tara member, when a subscription is created, then the 18.1 gate no longer rejects it.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `docs/decisions.md` entry corrupted: `$verify$` expanded by the shell, two sentences truncated and a stray `# Decisions Log` injected (Blind, VG) | medium | patch | Confirmed at lines 11 and 19 (file had 3 "Decisions Log" matches). Both sentences rewritten with the literal `$verify$`; no other file has the damage. |
| No assertion that the RPC-created row has `provider_transaction_ref` null; the initiate route answers 400 when it is set (VG) | medium | patch | `index.ts:157` refuses a row with a ref; the row-shape pgTAP assertion omitted the column. Column added to the assertion. |
| `initiateRegistrationFeePayment` comment says the row is always deleted on failure (Blind, VG, Edge) | low | patch | True only when the route runs and the provider call fails; a transport failure or the 400 leaves a `processing` row. Comment corrected; behavior is by design (blocks only until the 10-minute expiry). |
| Env var restored at the end of a test body, not in `afterEach` (Blind, Edge) | low | patch | Moved into `afterEach` for the second describe block. |
| Webhook initiate/confirm routes untested with a fee-purpose row (Blind, VG) | medium (unverified) | defer | Needs a Tara sandbox run or a Deno test; recorded in deferred-work.md. |
| Late success after the row was flagged charges the member without settling, no alert (Blind, Edge) | low | rejected | Frozen Decision states it is not applied; mobile prompts expire before the 10-minute threshold (the user's premise); a stale row is already listed by the reconciliation job's `stale_processing` discrepancy. A new alert would add surface. |
| No staff cancel for an in-flight collection (Blind) | false | rejected | Chosen design (frozen Decision): wait for expiry. |
| Transport failure leaves a `processing` row; add a service-side cleanup RPC (Edge) | low | rejected | Bounded to 10 minutes by design; cleanup would add public surface. |
| Reconciliation job lists fee rows as `stale_processing`, resolver may assume a subscription (Blind) | false | rejected | `payment_discrepancies` is read-only (only the job writes; dashboard only lists), nothing resolves it. |
| `$verify$` lock-order check string-position based; ACL covers PUBLIC only; helper is `create function` (Blind) | low | rejected | Same substring style as 0093-0099; behavior proven by pgTAP; migrations run once. |
| `not_found: member` / `member_deactivated: member` mappings too broad (Blind) | false | rejected | grep: only 0099 and 0100 raise those texts. |
| Availability copy reused from the renewal panel (Blind) | false | rejected | Copy reads "Automated Mobile Money payments are temporarily unavailable..." and "Connect your Tara Money account..."; generic, not renewal-specific. |
| Initiation not audited; audit metadata hardcodes XAF/mobile_money; amount mismatch not compared at webhook; `unique_violation` handler wording; expiry flag rolled back when a later check raises; pending lookup lacks UUID validation and an `expired` flag; kill switch not in SQL; waive ignores a `pending` fee row; lock-order claim conditional (Blind, Edge) | low | rejected | Initiation of renewals is not audited either; the row's currency and method are fixed by this RPC; mismatches are the reconciliation job's `amount_mismatch` category (pre-existing); a rolled-back flag is re-applied on the next call; the 18.6 UI owns presentation; no path creates a `pending` fee row (RLS denies, RPCs insert `processing`/`verified`); lock-order is safe for the only reachable interleavings. |

## Design Notes

Deadlock avoidance: the webhook locks the payment row then the member row, so record/waive/initiate must too. They therefore flag expired rows with a payment UPDATE before taking `for update` on the member. 18.2's deferred (c), a `flagged` fee row returning to `verified`, is unreachable: both completion functions only move rows out of `processing`.

## Verification

**Commands:**
- pgTAP via `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all green
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0
