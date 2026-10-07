---
title: 'Story 18.6: Dashboard Fee Collection, Waive & Void Surfaces'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: e29fcf6e3085846de241bcf688c138f6a2f09250
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 18.1-18.5 built the fee rules, RPCs and services, but staff have no screen to collect, waive or void a registration fee, or to give a settled member their first plan. In a fee gym a new member is stuck awaiting.

**Approach:** No migration. Add row actions and dialogs on the members list: Collect (cash, bank transfer, manual mobile money, Tara Money), Waive, Void and Assign plan. Add the missing record, waive and void actions, a fee-state read shown in the member detail, a payment-purpose label, and audit-label coverage.

## Boundaries & Constraints

**Always:** The fee amount is shown from `registrationFee` and never editable; the RPCs read it server-side. UI role gates mirror the RPCs and RLS: Collect for all four staff roles; Waive and Assign plan for manager, supervisor and owner; Void for owner and supervisor. The RPC stays the authority. Record uses `recordRegistrationFeeSchema` with the reason prefilled "Registration fee" and editable. Waive and Void reasons are mandatory with the schema limits (10-200); add `voidRegistrationFeeSchema` (`paymentId` uuid, `reason`). The Tara option shows only when `canOfferMobileMoneyPayment()` is true (read in `members/page.tsx`, passed down as `mobileMoneyEnabled`), uses `PhoneInput countries="tara-money"` prefilled from the member's phone, and calls `initiateRegistrationFeePaymentAction`. On open the dialog calls `getPendingRegistrationFeePaymentAction`: a `processing` row under 10 minutes old shows a waiting state watched with `subscribeToPaymentStatus`/`fetchPaymentStatus` (verified refreshes the list and closes; flagged shows an error and a retry). A row 10 minutes or older offers retry, since the next initiate flags it. Waive says the member is settled without a payment and cannot be undone from the UI. Void says "This is not a refund". Void appears for a settled member with no plan; the dialog reads the fee payment and, for a Tara (`mobile_money`) fee, shows the hint that Tara fees are corrected outside the platform with no submit. Assign plan (plan select plus start date) calls `assignInitialPlan`, and its submit stays disabled while the call is pending. Submit buttons of every new dialog are disabled while pending. Fee state in the read-only member detail comes from a new `getMemberRegistrationFeeState`: Awaiting; "Paid XAF n on date" (non-voided fee payment); "Waived by name" from the latest `registration_fee_waived` audit row, with the name and reason only for roles that can read the audit log (receptionist sees "Waived"); a settled member with neither shows nothing. The list row keeps the existing "Awaiting registration fee" badge and does not fetch fee state per row. Map `not_found: payment` in `mapSupabaseError` with EN/FR copy. `payments/paymentLabels.ts` gains a purpose label and the Payments page shows "Registration fee" wherever it renders a payment's purpose (select `purpose` in the pending and discrepancy reads). Add a test that every Epic 18 audit action type has a label resolving in both locales. All new strings EN/FR and `pnpm check:i18n` passes.

**Never:** No migration, no RPC change. No fee-state fetch per list row. No ledger page. No change to `RenewalModal`, `RecordRefundModal` or the refund service (its `purpose = 'subscription'` filter is already pinned). No mobile or super-admin change (18.7 and deferred-work). No undo of waive.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Collect manual | Awaiting member, cash, reason | Member settled, list refreshes, toast | Mapped error shown, dialog stays open |
| Collect Tara | Tara connected, valid phone | Waiting state, settled on webhook verify | Flagged shows error plus retry |
| Reopen while processing | Row under 10 minutes | Waiting state, no second initiate | N/A |
| Stale processing | Row 10+ minutes | Retry offered | N/A |
| Waive | Manager+, reason | Settled, no payment, toast | Receptionist never sees it |
| Void | Owner, manual fee, no plan | Member awaiting again | `not_found: payment` mapped copy |
| Void Tara fee | Fee method `mobile_money` | Hint, no submit | N/A |
| Assign plan | Settled, no plan | Active subscription, list refreshes | `registration_fee_due`, `member_already_has_subscription` |
| Fee-0 gym | No fee | No new actions appear | N/A |

</frozen-after-approval>

## Code Map

- `apps/dashboard/app/(dashboard)/members/components/MembersPageClient.tsx` -- row `DropdownMenu` (~381-438), `canManage`/`CAN_MANAGE` (:49), modal state and `DeactivateMemberDialog` render pattern (:489-536, `onDone` toast plus `router.refresh()`); add owner/supervisor and all-staff constants and the four items. Existing tests: `MembersPageClient.awaitingFee.test.tsx`, `.sendInvite.test.tsx`.
- `members/components/DeactivateMemberDialog.tsx` (113 lines) -- template for the Waive, Void and Assign dialogs.
- `components/shared/RenewalModal.tsx` -- Tara pattern to copy: native `<dialog>`, method select, `PhoneInput` (:542), `mobileMoneyPhase`, watch effect (:227-298), resume (:206). Reuse `PAYMENT_METHOD_LABEL_KEY` and `lib/realtime/paymentStatus`; copy the watch effect (a hook extraction is optional). Test template: `RenewalModal.mobileMoney.test.tsx`.
- `members/components/MemberModal.tsx` -- read-only view (~490-560) gets the fee-state line, loaded on open by a server action. `members/page.tsx` -- add `canOfferMobileMoneyPayment()` (`lib/featureFlags.ts`) to the `Promise.all`, pass `mobileMoneyEnabled` (a failed read means false); `members/page.test.tsx` precedent.
- `apps/dashboard/services/payments.ts` -- `initiateRegistrationFeePayment` :237 and `getPendingRegistrationFeePayment` :307 exist; add `recordRegistrationFee`, `waiveRegistrationFee`, `voidRegistrationFeePayment` (RPCs `record_registration_fee`, `waive_registration_fee`, `void_registration_fee_payment`), and `listPendingPayments` :442 / `listPaymentDiscrepancies` :705 select `purpose`. `services/members.ts` -- add `getMemberRegistrationFeeState` (settled-at, fee payment, waive audit row; actor name via a batched `members` query on `user_id` as in `listPendingPayments`).
- `payments/actions.ts` -- `initiateRegistrationFeePaymentAction` :232 and the pending action :260 exist; add record, waive, void and fee-state actions. `members/actions.ts` -- `assignInitialPlan` :259 exists, no UI calls it.
- `packages/types/src/schemas/payment.ts` -- `recordRegistrationFeeSchema` :124, `waiveRegistrationFeeSchema` :136; add the void schema and export it. `packages/types/src/errors.ts` ~628 -- `not_found: member` is mapped, `not_found: payment` is not; `apps/dashboard/lib/errors.registrationFee.test.ts` precedent.
- `payments/paymentLabels.ts`, `payments/components/PaymentsPageClient.tsx`, `audit/auditLabels.ts` (all Epic 18 types already labelled in both locales; `registration_fee_exempt` is metadata, not an action type), locales `apps/dashboard/locales/{en,fr}.json` (`members.*`, `payments.*`) and `packages/types/src/locales`; `docs/decisions.md` (dated entry, quoted heredoc).

## Tasks & Acceptance

**Execution:**
- [x] `packages/types` -- void schema, `not_found: payment` mapping, EN/FR copy -- shared contract
- [x] `services/payments.ts`, `services/members.ts`, `payments/actions.ts` -- record, waive, void, fee-state, purpose selects -- data and server rules
- [x] `members/components/*` (Collect, Waive, Void, Assign dialogs), `MembersPageClient.tsx`, `MemberModal.tsx`, `members/page.tsx` -- row actions, fee-state line, `mobileMoneyEnabled`
- [x] `paymentLabels.ts`, `PaymentsPageClient.tsx`, locales, audit label-map test -- labels
- [x] Vitest for every matrix row and the role matrix, in the style of `RenewalModal.mobileMoney.test.tsx`; `docs/decisions.md`; list the manual browser checks in Implementation Notes (collect by cash and by Tara sandbox, waive, void, receptionist/manager/owner/supervisor matrix, fee-0 gym unchanged, existing member renewing in a fee gym)

**Acceptance Criteria:**
- Given `pnpm typecheck`, `lint`, `check:i18n` and the dashboard and types tests, then they pass.
- Given the full pgTAP suite, then it is still green with no migration added.
- Given a fee-0 gym, then no new row action or fee state appears.

## Implementation Notes

Built to the spec with no migration. Choices worth reviewing:

- Collect, Assign plan and Void require `registrationFee > 0` (so a fee-0 gym shows nothing new); Waive does not, because an awaiting member can outlive a fee lowered to 0. In a gym that lowered its fee to 0, a settled member with no plan shows no Assign plan or Void until the fee is raised again.
- The receptionist cannot read `audit_log` through RLS, so the "Waived" existence check uses the service-role client scoped to the caller gym from the session claims; name and reason are returned only to manager, supervisor and owner.
- The open-time pending check runs even when Tara is not offered, since a processing row blocks the manual methods too.

**Manual browser checks (owner):**

1. Collect by cash: awaiting member, Collect, cash, default reason, submit. Member leaves awaiting, toast, list refreshes.
2. Collect by Tara sandbox: Tara option appears only with Tara connected and the kill switch on; payer phone prefilled; waiting state; settles on webhook verify. Close and reopen mid-wait: waiting state returns, no second prompt. Let a request pass 10 minutes: expiry notice and retry. Decline in the sandbox: error plus Try again.
3. Waive: manager or owner, reason under 10 characters keeps the button disabled; member settled, no payment row; the member detail shows Waived by name and reason for manager/owner and plain Waived for a receptionist.
4. Void: owner or supervisor, settled manual-fee member with no plan; dialog says this is not a refund; member returns to awaiting. A Tara-paid fee shows the hint and no submit. A manager never sees Void.
5. Assign plan: settled member with no plan, manager or owner; submit disables while pending; the subscription appears and the list refreshes.
6. Role matrix: receptionist sees Collect only; manager Collect, Waive, Assign plan; owner and supervisor add Void.
7. Fee-0 gym: no new row action or fee line anywhere.
8. Existing member in a fee gym renewing: RenewalModal unchanged.
9. Payments page: a fee payment or discrepancy row shows "Registration fee" under the member.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Fee line in `MemberModal` keeps an earlier fetch on reopen; a failed fetch leaves it wrong (Blind) | low | patch | `feeLine` was only keyed by member id. Effect now clears it first; reopen and failed-fetch tests added. |
| Fee-state read: `.is("voided_at", null)`, order and limit not observed by the test (VG) | medium | patch | Mock made them no-ops. Mock now records them; voided plus live payment case added. |
| `listPendingPayments` / `listPaymentDiscrepancies` `purpose` select has no service test (VG) | medium | patch | New `payments.listPurpose.test.ts`. |
| Waive / Void / Assign `onDone` wiring (refresh, toast, Assign warning) untested (VG) | medium | patch | Mocks had no trigger. Finish buttons and assertions added. |
| Polling fallback and 45s still-waiting never exercised (VG, Edge) | medium | patch | Subscribe mock always reported SUBSCRIBED. Fake-timer tests added. |
| Payment verified before the channel reports SUBSCRIBED is never seen (Edge) | low | patch | Polling stops on SUBSCRIBED. One-shot `fetchPaymentStatus` added, with test. |
| `handleRetry` sets `mobile_money` with Tara off (Edge) | low | patch | Falls back to `cash`; test added. |
| Stale-pending notice tells the user to send a new request with Tara off (Blind, Edge x2) | low | patch | Manual methods still work (RPC flags the stale row). Notice and preselect now only when Tara is offered. |
| FR "Annuler" is both the void action and Cancel (Blind) | low | patch | Void keys now say "Invalider". |
| Awaiting member in a fee-0 gym is not fee-gated in `MemberModal` (VG note) | low | patch | Test added that it still fetches. |
| `no_active_plan` may include a member whose plan expired, so Assign / Void show for them (Blind) | false | rejected | `listMembers` yields `no_active_plan` only when the member has no subscription row at all (`sub?.status ?? "no_active_plan"`). |
| Fee-state action has no uuid or staff-role check before the service-role audit read (Blind, Edge) | low | rejected | The member read runs first on the caller's own session, so a non-uuid or another gym's id returns not_found before the admin read; a member-role caller can only see their own waived flag. |
| Open-time pending check drops `error` and unlocks the form (Blind, Edge) | low | rejected | Server is authoritative: a submit over an in-flight row raises `registration_fee_already_pending`. Fix adds a branch. |
| Currency hard-coded XAF in copy (Blind) | low | rejected | Epic 18 is whole XAF only; Void dialog already shows the stored currency. |
| Assign plan / Void hidden whenever fee is 0, so a settled planless member loses them after the fee is lowered (Edge) | low | rejected | The spec's own AC ("fee-0 gym shows no new row action") and Implementation Notes record it; a fix needs per-row fee data, which the spec excludes. |
| Void menu opens a "nothing to void" dialog for settled legacy members (Edge) | low | rejected | Spec-defined (dialog reads the fee payment); the dialog message is explicit. Per-row data is excluded. |
| Awaiting member in a fee-0 gym still sees Waive and the awaiting line (Edge) | false | rejected | Intended: Waive is their only exit after the fee is lowered (deferred-work, 18.1); the AC concerns settled members. |
| Dialog shows a stale `registrationFee` if the fee changed after page load (Edge) | low | rejected | Same as the 18.5 rejection: needs a fee change between load and open; the RPC reads the live fee. |
| No `maxLength` / counter on reason fields (Blind) | low | rejected | Schema error shows after submit; fix adds UI. |
| `deferred-work.md` still lists the `not_found: payment` and audit-label items; double-assign only client-guarded; spec status and tasks out of sync (Blind) | low | rejected | deferred-work is append-only by this workflow; the double-assign guard is the spec-required disabled submit; spec status is synced by step 6. |
| `recordRegistrationFee` `!data` branch code, missing admin error test, double Zod parse, duplicate `purposeLabel` calls, unused `created_at` select, dialogs without `aria-labelledby`, `canOfferMobileMoneyPayment` on fee-0 loads (Blind) | low | rejected | Cosmetic or unreachable; precedent dialogs share the same shape. |

## Design Notes

A void clears `registration_fee_settled_at` and the member returns to awaiting; the dialogs must not be reachable from a stale row after that, so every action refreshes the list and the server rejects a stale one.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0
- pgTAP via `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all green
