---
title: '19-9b Dashboard session alert, Record Session Payment panel, member sessions'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '7d38c1cad69e9f115f7c8a0b9eccfafa73477626'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Refused Pay-per-session guests raise `session_required` alerts (19.6b/19.7) and `record_session_payment` exists (19.4), but the dashboard drops those alerts and has no way to record a session payment, see a member's sessions, or refund one with a correct notice.

**Approach:** Half B of Story 19.9 (split decided 2026-10-11): widen the front-desk alert panel with a `session_required` variant, add a Record Session Payment panel opened from the alert, the member modal header and the Classes refusal row, add a Sessions section to the member modal, an AD-10 hint, and refund notices. 19-9c (Payments Purpose ledger, Subscriptions guard) stays out.

## Boundaries & Constraints

**Always:**
- Alert variant in the single `FrontDeskAlertPanel` (no fork): `info` dot, "SESSION REQUIRED" / "SÉANCE REQUISE", "[Name] · No paid session · [time]", "Record a payment so they can scan again.", "From class: [name]" (class refusal), "Scanned offline at [time]" (late sync), "Mobile money payment in progress" while a pending/processing session payment exists, [Record session payment] and no [Renew]; `aria-live="assertive"`; SSR, polling and realtime all include it; subscription alerts and the at-risk list stay subscription-only.
- Record panel: read-only Amount "plan price — fixed"; Method Cash default and Manual Mobile Money; Bank Transfer only for manager/supervisor/owner and absent from DOM for receptionist (thread `role` down); optional Note ≤200; Recorded by; submit disabled while in flight; success toast "Session recorded for [Name]. Ask them to scan again."; each 19.4 refusal code renders its own EN/FR inline message and keeps the panel open; focus returns to trigger; tab order Method → Note → Record → Cancel.
- Member modal (receptionist+ only; nothing for coaches): [Record session payment] only when Pay-per-session, price > 0, gym charging on and viewer can record; Sessions section when on Pay-per-session at a charging gym or holding rows: Unused (source, time, method, recorded-by, lapse date, soonest first), Used (date, covered day), muted "Lapsed [date]" / "Voided by refund [date]" for 90 days, link to Payments filtered to member and Purpose: Session, empty state "No sessions yet."
- AD-10: on selecting a Pay-per-session member at a charging gym, hint "To sell a session, use Record session payment on the member's page." (+FR); no Session purpose is added to AD-10.
- Refund modal: session payments become refund-eligible; live `info` notice (full on unused → cancelled; partial → keeps session; used → "The visit stays counted", loyalty clause only when loyalty on; renewal with loyalty on → "Loyalty stamps and free days from this renewal are not removed."); success toast names the outcome the server resolved ("The session was cancelled." / "The session had already been used.").
- Decision (2026-10-11): the Record Session Payment panel is ONE native `<dialog>` component modelled on `RenewalModal`, opened from the alert, the member modal header and the Classes refusal row (focus returns to the trigger). The AC's inline / 320px drawer / expanding-section layouts are not built because `InlineRenewalPanel` does not exist.
- Decision (2026-10-11): scope stays one story; the refund notices and AD-10 hint are not split out.
- All strings EN+FR; "session" always qualified in EN; `check:i18n` passes.

**Never:** No migration, no new RPC. No Settings, Payments Purpose filter/column/CSV, "Confirmed late" or Subscriptions change (19-9a/19-9c). No auto-marking attendance. Do not edit historical migrations or invert `frontDeskAlerts.kindFilter.test.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Alert arrives | `kind=session_required` row | variant renders, assertive | N/A |
| Record success | valid method | RPC ok, toast, alert dismisses, panel closes | N/A |
| Refused | `session_payment_already_in_progress` etc. | inline message, panel stays | mapped per code |
| Receptionist | role receptionist | Bank Transfer absent | server 'permission denied' → permission copy |
| Double click | submit in flight | single RPC call | N/A |
| Partial refund | amount < payment | "keeps the session" notice | N/A |

</frozen-after-approval>

## Code Map

- `apps/dashboard/components/shared/FrontDeskAlertPanel.tsx` -- item is subscription-only (status labels, `isDenied`, [Renew]); add kind branch; query key `["frontDeskAlerts", gymId]`, 5s poll at ~L105-170
- `apps/dashboard/services/frontDeskAlerts.ts` -- `FrontDeskAlertRow` lacks `kind`, `status` non-null; `listActiveFrontDeskAlerts` filters `kind=subscription_status` (~L76); widen for the panel only
- `apps/dashboard/lib/realtime/frontDeskAlerts.ts` -- `isSubscriptionStatusAlertRow`/`forward…` (L26-40) and `fetchActiveFrontDeskAlerts` (L84-190) drop other kinds; keep dismiss helpers
- `session_attempts` (database.ts:1492; staff SELECT) -- latest attempt per member gives class (`class_session_id`→`class_sessions.class_id`→`classes.name`) and offline (`scanned_at` ≪ `created_at`); in-flight Tara = payments `purpose='session'`, `voided_at is null`, status pending/processing (0108:229)
- `components/shared/RenewalModal.tsx` -- layout/dialog model for the panel (Method select L58, note counter); has no role prop
- `supabase/migrations/0108_desk_session_payment.sql:126` -- `record_session_payment(p_member_id, p_method, p_reason) returns guest_sessions`; refusals prefix codes: permission denied, gym not active, invalid_method, reason too long, charging_disabled, not_found, member_deactivated, registration_fee_not_settled, plan_not_per_session, session_price_not_set, session_payment_already_in_progress, session_config_missing
- `apps/dashboard/services/payments.ts`, `app/(dashboard)/payments/actions.ts` -- add wrapper + action (mirror `recordRefund`/`confirmRenewalAction`, `{data,error}` + code mapping); `searchMembersForPayment` (:684) select needs plan type
- `app/(dashboard)/members/components/MemberModal.tsx` (view mode ~L580-650), `members/page.tsx`, `MembersPageClient.tsx` (has `role`) -- thread `role` and `chargeGuestsPerSession` (from `getGymSettings`); `MemberListRow.planType`
- `guest_sessions` (database.ts:469) -- no dashboard reader; new service+action joining `payments` for method/actor
- `payments/components/RecordPaymentModal.tsx` -- hint after member Input (L186-190)
- `payments/components/RecordRefundModal.tsx`, `services/payments.ts:981` `recordRefund`, `listRefundEligiblePayments` (~932, hard-filtered to `subscription`, no purpose) -- widen; outcome from post-insert read of `guest_sessions` by `payment_id` (voided_at/consumed_at); `PaymentsPageClient.tsx:58-75` toast
- `classes/components/ClassesPageClient.tsx` -- existing session-required refusal row; add [Record session payment] opening the panel
- Tests to mirror: `RenewalModal.mobileMoney.test.tsx`, `frontDeskAlerts.kindFilter.test.ts`, `MemberModal.feeState.test.tsx`, `ClassesPageClient.sessionRequired.test.tsx`, `payments.listRefundEligiblePayments.test.ts`
- Locales: `locales/en.json`, `fr.json` -- add `frontDeskAlert.session*`, `sessionPayment.*`, `members.modal.sessions.*`, `payments.refundModal.notice.*`

## Tasks & Acceptance

**Execution:**
- [x] `services/frontDeskAlerts.ts`, `lib/realtime/frontDeskAlerts.ts` -- carry `kind`, include session alerts, follow-up reads (class, offline, in-flight) -- panel data
- [x] `FrontDeskAlertPanel.tsx` -- session variant + trigger -- main surface
- [x] `services/payments.ts`, `payments/actions.ts` -- `recordSessionPayment` wrapper/action with code mapping -- panel backend
- [x] Record Session Payment panel component -- single dialog, opened from alert, modal header, Classes row
- [x] `MemberModal.tsx`, members page chain, sessions service/action -- Sessions section + header action
- [x] `RecordPaymentModal.tsx`, `searchMembersForPayment` -- AD-10 hint
- [x] `RecordRefundModal.tsx`, `payments.ts` -- eligibility, notices, outcome toast
- [x] `ClassesPageClient.tsx` -- refusal row action
- [x] `locales/en.json`, `fr.json` and tests beside each -- bilingual parity, one case per matrix row

**Acceptance Criteria:**
- Given the matrix cases, when dashboard tests run, then all pass and the kind-filter test still passes for subscription lists.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given a charging gym in manual QA, when a guest is refused then paid at the desk, then the alert shows, the panel records, and the alert dismisses.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | gap | Refund outcome read-back, guestSessions service, preview/search plan derivation and page prop wiring have no test that runs them | medium | patch | Tests mock the actions/props; swapping cancelled/kept or dropping a page prop passes every test. |
| 2 | blind, edge | `getSessionPaymentPreview` returns any plan and price; panel shows a non-session price as "fixed" and enables Record | medium | patch | No planType/price check in the service; the RPC refusal only arrives after submit. |
| 3 | blind, edge | Refund notice says "cancels the paid session" for an empty, zero or invalid amount | low | patch | RecordRefundModal.tsx else-branch fires for every non-partial amount; fix is a direct condition. |
| 4 | blind | FR `sessionPayment.recordButton` drops the "séance" qualifier | low | patch | fr.json:1251 "Enregistrer le paiement" vs EN "Record session payment". |
| 5 | edge, blind | Sessions link goes to `/payments?memberId=&purpose=session`, nothing reads the params | low | defer | Purpose filter and params are 19-9c (frozen Never); link target is correct once 19-9c lands. |
| 6 | edge | `alreadyKnown` early return makes the Tara in-flight line stale | low | reject | A payment status change never UPDATEs the alert row, so the guard is not the cause; a duplicate cash record is refused with `session_payment_already_in_progress`. |
| 7 | edge | Stale alert persists when recorded from modal or Classes row | false | reject | 0111:493 dismisses the member's session_required alert inside create_guest_session_for_payment; realtime UPDATE removes it. |
| 8 | edge | session_required alerts auto-dismiss after the gym's alert minutes | low | reject | Same component with no fork is the spec; a new refusal re-raises one active alert per member. |
| 9 | blind, edge | Focus not returned when the alert's button unmounts on success | low | reject | The trigger no longer exists; fallback target would add behavior the spec does not define. |
| 10 | blind | Record before Cancel in DOM, Cancel left visually | false | reject | Spec fixes tab order Method → Note → Record → Cancel. |
| 11 | blind, edge | Dismiss/onRecorded throwing after success shows generic error | low | reject | dismissFrontDeskAlert returns `{error}` and the server already dismissed; not reachable. |
| 12 | blind | No server role gate on session reads for coaches | low | reject | Exposure is RLS-defined and pre-existing, not introduced here. |
| 13 | edge | Global attempt limit, latest-attempt masking, 60s offline heuristic | low | reject | Needs dozens of refusals by one member; fix adds query complexity. |
| 14 | edge | Polling reader throws when session read fails; SSR context read not try/caught | low | reject | Throwing keeps the cached list by design; supabase-js returns errors rather than throwing. |
| 15 | blind, edge | Sessions section silent on load failure; sort comparator; aria and a11y nits; duplicated mapping | low | reject | Cosmetic; fixes add state or strings with no named harm. |
| 16 | blind, edge | loyaltyEnabled clauses unreachable | false | reject | Specified Epic 20 hook, gated by design. |

## Verification

**Commands:**
- `pnpm --filter dashboard test` -- expected: pass
- `pnpm --filter dashboard check:i18n` -- expected: parity
- `bash scripts/ci-local.sh` -- expected: all stages PASS
