---
title: '19-4 Desk session payment'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: 'fdb2f83c343947c962f7418e345eafb33e86e97a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staff cannot sell a session at the desk: no `record_session_payment`, no function that creates a `guest_sessions` row, and a `session` payment renders as an unlabelled row.

**Approach:** Migration 0108 adds `record_session_payment(p_member_id, p_method, p_reason default null)` plus a shared `private.` session-creation function (reused by 19.5) and a purpose-generic stale-expiry helper. Dashboard and member-app payment lists and the member receipt label `session` payments in EN/FR. No panel UI (19.9) and no consumption (19.6b).

## Boundaries & Constraints

**Always:** Role via `private.current_member_role()` (owner, manager, supervisor, receptionist; cash and manual_momo open to all four, bank_transfer manager/supervisor/owner only; coach/member/null refused). Suspension guard (`private.current_gym_status() is distinct from 'active'`, "is not active") after the role check and before any write. Amount and currency read server-side from the member's latest subscription's plan (`order by created_at desc, id desc`), never a parameter. Reason optional, btrim'd, empty becomes null, over 200 chars refused. Lock order: stale-expiry on payment rows, then member row `FOR NO KEY UPDATE`. Errors are `'<code>: <message>'`. `usable_until = now() + paid_session_validity_days` from `platform_session_config`. Definer functions `set search_path = public`; revoke EXECUTE from public and anon on every new or replaced function. Audit `session_payment_recorded` (member target; amount, currency, method, reason, payment_id, guest_session_id). EN/FR strings.

**Never:** No Tara/initiate flow, no `complete_verified_payment` change (19.5). No check-in or class gating, no consumption (19.6b/19.7). No panel or alert UI (19.9). No refund or revenue-bucketing change (19.8). No flag flip. No uniqueness index preventing a second desk session (double entry is allowed by design).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cash sale | charging on, latest plan pay_per_session price>0, role receptionist | verified `session` payment (plan price/currency, actor), one guest_sessions row, usable_until now+7d, audit; returns the session row | N/A |
| Bank transfer, receptionist | same | refused | permission denied |
| Bank transfer, manager+ | same | succeeds | N/A |
| Coach / Member / no role | any | refused | permission denied |
| Flag off | gym charging false | refused, no row | `charging_disabled` |
| Wrong plan | latest plan not pay_per_session, or member has no subscription | refused | `plan_not_per_session` |
| Price 0 | pay_per_session price 0 | refused | `session_price_not_set` |
| In flight | session payment pending/processing, not stale | refused, no row | `session_payment_already_in_progress` |
| Stale attempt | processing session payment older than 10 min | flagged `expired_attempt`, audited, new sale proceeds | N/A |
| Deactivated | member deactivated | refused | `member_deactivated` |
| Awaiting fee | `registration_fee_settled_at` null | refused | `registration_fee_not_settled` |
| Suspended gym | owner calls | refused | "is not active" |
| Reason 201 chars | any | refused | `reason is too long` |
| Double entry | two calls same member | both succeed, two sessions, no deadlock | N/A |
| Other gym / non-member | member id of another gym or staff | refused | `not_found` |

## Decisions

- Return type is the `guest_sessions` row (AC: "returns the session").
- "Awaiting the registration fee" is `members.registration_fee_settled_at is null`, the same predicate as `enforce_registration_fee_settled` (0098).
- `private.expire_stale_payment(member, gym, purpose)` generalizes 0106's fee helper, audit code `<purpose>_attempt_expired`; the fee helper becomes a delegating wrapper with identical behavior.
- Receipt "says so" via the mobile payment-detail label (`paymentDetail.session`), since no dashboard receipt surface exists.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0100_registration_fee_tara_collection.sql:367-480` -- `record_registration_fee`: guard order, lock order, error and audit shape to mirror (its JWT role read is replaced by `private.current_member_role()`)
- `supabase/migrations/0106_flagged_payment_reason.sql:144` -- fee stale-expiry helper to generalize; keep fee callers working
- `supabase/migrations/0107_charge_guests_setting_session_record.sql:177-188,201-271` -- latest-subscription pattern, `guest_sessions`, `platform_session_config.paid_session_validity_days`
- `supabase/migrations/0098_registration_fee_foundation.sql:130-150` -- awaiting-fee predicate
- `supabase/tests/registration_fee_collection*.test.sql`, `charge_guests_setting*.test.sql`, `suspension_rpc_coverage.test.sql` -- pgTAP patterns; body must contain the `current_gym_status() is distinct from 'active'` regex
- `packages/types/src/database.ts` -- splice the RPC only (decisions.md)
- `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`, `locales/{en,fr}.json` (`payments.purposes`, `audit.actionTypes`), `audit/auditLabels.ts` + `auditLabels.epic19.test.ts`, `PaymentsPageClient.purpose.test.tsx`
- `apps/mobile/src/services/payments.ts:15,75,91,167`, `src/app/(tabs)/history/index.tsx:400`, `src/app/(tabs)/history/payment/[id].tsx:140`, `src/locales/{en,fr}.json` -- add `isSession` and the label
- `apps/dashboard/services/payments.ts:923`, `0101:146` -- refund eligibility (sessions already excluded from picker; left to 19.8)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0108_desk_session_payment.sql` -- generalized expiry helper + fee wrapper, `private.create_guest_session_for_payment`, `record_session_payment`, grants, `do $verify$` block
- [x] `supabase/tests/desk_session_payment.test.sql` + `.negative.test.sql` -- one assertion per matrix row, incl. stale flag, lapse value from config, double entry, owner/supervisor/manager/receptionist
- [x] `supabase/tests/desk_session_payment.concurrency` check -- two sessions' sequential and interleaved calls under the canonical order, no deadlock (use dblink-free approach: two statements in one test plus lock-order assertion if true concurrency is unavailable in pgTAP; record the limit)
- [x] `packages/types/src/database.ts` -- splice RPC
- [x] `paymentLabels.ts`, dashboard locales, `auditLabels.ts`, tests -- session purpose and audit labels
- [x] mobile `payments.ts`, history list, payment detail, locales -- `isSession` and "Session" label
- [x] `docs/decisions.md` -- helper generalization, awaiting predicate, deferred-revenue audit result (19.3 review #16)

**Acceptance Criteria:**
- Given 0108 applied, when the fee suites run, then every registration-fee pgTAP test still passes unchanged.
- Given `scripts/ci-local.sh`, then every stage passes.
- Given a verified session payment, when the dashboard Payments page or mobile history renders it, then it shows "Session payment" / "Paiement de séance", not a renewal or fee.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|-------|---------|---------|-------|----------|
| 1 | blind, edge | Stale `pending` session payment never expired, blocks desk sale | maybe-false (medium if true) | defer | Only 19.5 creates Tara rows and 0100 creates them as `processing`; no `pending` session row is producible today. Settle when 19.5 picks the initial status. |
| 2 | blind, edge | `create_guest_session_for_payment` does not validate payment/member/gym/purpose/status | low | defer | Private, EXECUTE revoked from public/anon, sole caller today builds the row in the same transaction; unique index on payment_id remains. Add caller assertions when 19.5 wires the second caller. |
| 3 | blind, edge | Latest subscription not checked for active status | false | reject | 0107 line 41 documents "No status filter: pay-per-session rows have no [status]"; spec matrix defines plan test as latest plan only. |
| 4 | edge | platform_session_config `limit 1` arbitrary | false | reject | 0107 creates `platform_session_config_singleton` unique index on `((true))`. |
| 5 | blind, edge | Expiry flag/audit rolls back when a later check refuses | low | reject | Same behavior as 0100/0106 fee helper; matrix only requires the flag on a successful sale; fix is a doc line or new commit-then-raise machinery. |
| 6 | edge | Suspended receptionist + bank_transfer gets permission denied before "not active" | false | reject | Spec orders role check (incl. method-by-role) before suspension guard; mirrors 0100. |
| 7 | edge | Error strings lack `<code>:` prefix for invalid_method / reason / not active | false | reject | Matrix specifies "reason is too long" and "is not active"; shape matches record_registration_fee in 0100. |
| 8 | edge | Key named `paymentDetail.sessionPayment` not `paymentDetail.session` | low | reject | Cosmetic; a rename guards nothing. |
| 9 | edge | Receipt shows no usable-until | low | reject | Intent excludes consumption/panel UI (19.6b/19.9); Decisions limit receipt to the label. |
| 10 | blind | Reason optional for bank_transfer/manual_momo | false | reject | Spec Boundaries: "Reason optional". |
| 11 | blind | No idempotency guard for desk double-submit | maybe-false (low-medium) | defer | Spec Never-list says double entry is allowed by design; the 19.9 panel must disable the button while in flight. |
| 12 | blind | Revenue/refund/confirm-reject-flag consumer audit unpinned by tests; pending session rows in dashboard actions | maybe-false (medium if true) | defer | `gym_revenue_mtd`/`platform_metrics` sum verified payments per audit in decisions.md; pending/flagged action paths with null subscription_id not exercised. Belongs with 19.8 revenue/refund work. |
| 13 | blind, gap | No mobile tests for `isSession` mapping and labels | low | defer | apps/mobile has no test files; needs test setup beyond this story. |
| 14 | blind | `p_purpose` unvalidated, audit action type concatenated | low | reject | Private helper, callers are definer functions with literals; fix adds a branch. |
| 15 | blind, gap | Lock order/ACL pins use source-text matching; authenticated not asserted on helpers | low | reject | Limit is acknowledged in decisions.md; pgTAP covers ACLs. |
| 16 | blind | Missing negative tests (config missing, 10-min boundary, voided/flagged not blocking, inverse latest-plan, flag off mid-flight) | low | reject | Predicates are literal in the RPC; matrix rows are all covered. |
| 17 | blind | No-notification test pins trigger allow-list; no desk receipt | low | reject | Intended: no notification surface in scope; cosmetic to pin. |
| 18 | blind | `usable_until` not anchored to gym day end | false | reject | Spec fixes `now() + paid_session_validity_days`. |
| 19 | blind | database.ts hand-edited | false | reject | decisions.md directs splicing the RPC only. |

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: static, pgtap, unit, e2e PASS

### Review Findings

Second review pass (2026-10-11), 4 layers (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor), baseline fdb2f83. Most findings repeat the first pass's triage log above and keep that disposition.

- [x] [Review][Patch] Expiry helper's `purpose` and `status = 'processing'` filters are pinned by no test [supabase/tests/desk_session_payment.test.sql] — add fixtures: a stale processing `registration_fee` row and an old (>10 min) `verified` session row for the same member must stay untouched after `record_session_payment`; a stale processing `session` row must stay untouched after the fee wrapper. Dropping either predicate today leaves every assertion green, and the wrapper is called by the three live fee RPCs.
- [x] [Review][Defer] Verified `purpose='session'` payments are refundable by direct `refunds` insert [supabase/migrations/0101_registration_fee_void_refund_revenue.sql:153-185] — deferred: refunds are 19.8 (Never-list). `block_fee_and_voided_refunds` blocks only `registration_fee` and voided payments, so decisions.md item 6's "sessions already excluded" is true of the picker UI only; a refund would leave the `guest_sessions` row usable. 19.8 must block or void-cascade this.
- [x] [Review][Defer] Stale `pending` session payment blocks desk sales (repeat of triage #1) — deferred: already in deferred-work.md; no `pending` session row is producible before 19.5.

**Rejected**

- Multi-row stale fee payments now audit once per row, so the wrapper is not identical to 0106 — false: `payments_one_registration_fee_per_member` allows at most one such row, so the loop runs at most once for the fee wrapper.
- Spec frontmatter `status: 'done'` disagrees with sprint-status — rejected: fix edits the spec under review; step 6 of this review sets the status.
- Receipt key `paymentDetail.sessionPayment` vs frozen `paymentDetail.session` — low, cosmetic (repeat of #8); visible EN/FR text is correct.
- Error codes lack a `<code>:` prefix for invalid_method / reason too long / not active — false (repeat of #7): matches matrix wording and 0100's `record_registration_fee`.
- `authenticated` EXECUTE not asserted on `expire_stale_payment` and the wrapper — false: same revoke-from-public pattern as `create_guest_session_for_payment`, whose `authenticated` denial is asserted, and `private` is not an exposed API schema.
- Lock-order / "SECURITY INVOKER" checks are source-text matches; no interleaved test — low, acknowledged limit (decisions.md item 7, spec permits the fallback); a two-session test is not possible in pgTAP.
- Concurrency task checked off without an artifact — rejected: fix edits the spec; the limit is documented as the spec allows.
- No server guard against desk double entry — repeat of #11; allowed by design, 19.9 owns the button state.
- Missing boundary tests (10-minute edge, voided/flagged not blocking, `session_config_missing`, inverse latest plan) — low (repeat of #16); predicates are literal and the matrix rows are covered.
- Expiry runs before member validation and rolls back on a later refusal — low (repeat of #5); documented in the migration header's check order.
- Flagged session rows on dashboard confirm/reject/CSV with null `subscription_id` — repeat of #12; tracked for 19.8 in deferred-work.md.
- Audit list shows a flat label without metadata — low; every audit label in `auditLabels.ts` is flat, so this matches the existing renderer.
- No member-facing signal for a desk sale — low (repeat of #9/#17); out of scope.
- `usable_until` test hardcodes 7 days — low; the default is seeded by 0107 and the test sets its own config row at line 259 for the variant case.
- Dashboard AC 3 shown only for a pending row — low; `PAYMENT_PURPOSE_LABEL_KEY` is the one purpose-to-label map shared by every list, so the map entry covers verified rows.
- Mobile `isSession` untested — repeat of #13, already deferred.
