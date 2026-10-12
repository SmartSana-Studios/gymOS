---
title: '19-2 Flagged-payment reason (late vs. wrong account)'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '4d634f4abccaf87abd955b9200665ae634f9c83c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Late-confirmed and wrong-account Tara payments are both stored `status = 'flagged'` with nothing to tell them apart, so the Epic 19 session branch (apply a late payment, never apply a wrong-account one) cannot be written.

**Approach:** Migration 0106 adds `payments.flagged_reason` with a closed-set CHECK, backfills existing rows, makes every server path that flags a payment set it in the same statement, pins it against client writes, and shows it as a localized label. No behavior change for subscription or registration-fee payments.

## Boundaries & Constraints

**Always:** Reason set in the same statement as the status change. Reasons: `late_confirmation`, `wrong_account`, `expired_attempt`, `reconciliation_mismatch`, plus `provider_declined` (provider reported failure; `complete_flagged_payment`) and `staff_flagged` (staff "Flag for Review"). New/replaced functions revoke EXECUTE from `public, anon` (19.1 gate); no `auth.jwt() ->> 'app_role'`. Replacement bodies copy the current definitions (0100 / 0048) and change only the reason writes. Migration ends with a `do $verify$` block. Regenerate `packages/types/src/database.ts`.

**Decision (human delegated, 2026-10-11):** dashboard scope is data layer only: `flaggedReason` on the payments service rows, a reason-label map and EN/FR keys. No new UI surface, because no flagged-row list exists yet; the tag renders beside the Flagged badge when one ships.

**Never:** No behavior change to who is flagged, when, notifications or audit codes. No `payments.status` change by the reconciliation job. No new Edge Function. Do not touch `saas_billing_payments`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Expiry | `processing` fee row older than 10 min | flagged, `expired_attempt` | N/A |
| Late success | webhook success for a fee row already flagged | audit row as today, reason becomes `late_confirmation`; status stays flagged | replay: no second change |
| Provider decline | `complete_flagged_payment` on `processing` row | flagged, `provider_declined` | already left processing: no-op |
| Staff flag | authenticated UPDATE pending → flagged | flagged, `staff_flagged` forced by trigger | N/A |
| Forge attempt | authenticated UPDATE sets `flagged_reason` | value pinned to old | N/A |
| Bad value | service-role write of a code outside the set | rejected by CHECK | N/A |
| Backfill | existing flagged rows | derived from audit/discrepancy evidence, else `reconciliation_mismatch` | verify block raises on any null |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0100_registration_fee_tara_collection.sql` -- current `expire_stale_registration_fee_payment` (l.61) and `complete_verified_payment` late branch (l.240); copy bodies into 0106
- `supabase/migrations/0048_audit_record_coverage_verification.sql` -- current `complete_flagged_payment`
- `supabase/migrations/0099_registration_fee_collection.sql` -- `protect_payment_purpose_and_void` (l.84, INVOKER, pins for authenticated/anon); extend it and recreate its trigger with `flagged_reason, status` in the column list
- `supabase/migrations/0032`/`0053`/`0076` -- `payment_discrepancies` (reconciliation output; never writes `payments.status`)
- `apps/dashboard/services/payments.ts:656` -- `flagPayment` direct UPDATE (staff path); no change needed
- `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`, `locales/{en,fr}.json` -- label map and keys (`payments.discrepancies.types.*` already holds two of the four)
- `supabase/tests/registration_fee_tara_collection*.test.sql`, `payment_notifications.test.sql` -- pgTAP patterns to copy

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0106_flagged_payment_reason.sql` -- column, CHECKs, backfill, replaced functions, extended pin trigger, verify block -- core of the story
- [x] `supabase/tests/flagged_payment_reason.test.sql` + `.negative.test.sql` -- one assertion per path in the matrix, forge attempt, bad value, backfill -- pgTAP positive and negative
- [x] `packages/types/src/database.ts` -- regenerate -- type parity
- [x] `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`, `apps/dashboard/locales/{en,fr}.json` -- reason label map + EN/FR keys (Confirmed late, Attempt expired, Payment declined, Flagged by staff; two already shipped); `check:i18n` passes
- [x] `docs/decisions.md` -- record reason set, the one-directional CHECK, and that reconciliation never flags payments -- project convention

**Acceptance Criteria:**
- Given any row with `status = 'flagged'`, then `flagged_reason` is non-null and in the closed set (CHECK validated after backfill).
- Given Story 19.5 will put `late_confirmation` on a verified session payment, then a non-flagged row may carry a reason (the CHECK is one-directional).
- Given `scripts/ci-local.sh`, then every stage passes.

## Implementation Notes

Migration 0106 applied locally; review patches applied by the orchestrator (late guard, insert pin, coalesce, backfill fixtures). Backfill test still runs a copy of the migration CASE (the migration cannot be re-run on a populated table); run `select count(*), flagged_reason from payments where status='flagged' group by 2` before applying to prod.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Late success relabels a `wrong_account` row (blind, edge) | medium | patch | Late branch updated unconditionally; fixed with `flagged_reason is distinct from 'wrong_account'`, audit trace kept; test added |
| 2 | Client INSERT can set `flagged_reason` (blind) | medium | patch | No insert trigger; added BEFORE INSERT trigger nulling it for authenticated/anon; negative test added |
| 3 | Backfill covers 3 of 6 branches, test pastes a copy (gap, blind) | medium | patch | Fixtures added for late/expired/declined audit shapes; `payment_flagged` shape confirmed (target = payment id, `logPaymentChange`). Copy-drift remains, see Design Notes |
| 4 | Pin trigger overwrites an existing reason on move to flagged (edge) | low | patch | Direct correction: `coalesce(old.flagged_reason, 'staff_flagged')` |
| 5 | Label map has no consumer, no parity test, no fallback (gap, blind, edge) | low | defer | Spec decision A; belongs to the story that renders the tag |
| 6 | Concurrent redelivery can write two late audit rows (edge) | low | rejected | Guard is 0100's, not changed here; fix adds locking |
| 7 | Stale reasons persist on non-flagged rows (blind, edge) | false | rejected | Flagged is terminal (no path leaves it); one-directional CHECK is intended for 19.5 |
| 8 | Forge test passes vacuously (edge) | false | rejected | RLS WITH CHECK refuses the write first; the test asserts the 42501 and the unchanged value, the trigger is defence in depth |
| 9 | Staff flag whose audit write failed backfills as `reconciliation_mismatch` (edge) | low | rejected | Speculative; documented fallback; fix is a heuristic |
| 10 | Late success on a flagged subscription row keeps old reason (blind, edge) | false | rejected | Subscription late handling is out of scope (spec Never: no behaviour change) |
| 11 | Not all flagged writers covered (blind) | false | rejected | Repo-wide grep (migrations, functions, apps, fixtures) found no other writer; CHECK + full pgTAP prove it |
| 12 | `reconciliation_mismatch` label shows "Amount Mismatch" (blind) | false | rejected | The story AC specifies this label |
| 13 | Verify block asymmetric; fixtures churn; sprint header (blind) | low | rejected | Cosmetic; `last_updated` is an append-only comment log; fixtures only name reasons on flagged rows |
| 14 | Double blank line in decisions.md (blind) | low | patch | Fixed |

## Design Notes

AC says "non-null exactly when flagged"; 19.4/19.5 require a verified late session payment to carry `late_confirmation`, so the CHECK is `status <> 'flagged' or flagged_reason is not null`. The AC's "reconciliation job(s) set the reason" has no target: the jobs write `payment_discrepancies`, never `payments`. `wrong_account` is defined here and first produced by 19.5; the backfill assigns it only to flagged rows with a `wrong_account_settlement` discrepancy.

## Verification

**Commands:**
- `bash scripts/ci-local.sh` -- expected: static, pgtap, unit, e2e PASS

### Review Findings

Code review of commit 0cc5527 (2026-10-11), layers: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor.

- [x] [Review][Patch] Late success must relabel only `expired_attempt` and `provider_declined` rows — decided (delegated to reviewer): `staff_flagged` and `reconciliation_mismatch` keep their reason and `wrong_account` stays untouched; the audit row is still written for every late success. Change the late-branch UPDATE guard to `flagged_reason in ('expired_attempt','provider_declined')`, add pgTAP cases for the kept reasons, and record it in decisions.md item 7. 0106 is not on origin/master (only `story/19-2-...`), so it is edited in place. [supabase/migrations/0106_flagged_payment_reason.sql:265-269]
- [x] [Review][Patch] Pin trigger's `new.flagged_reason := old.flagged_reason` line is untested on a reachable path — an authenticated `pending -> verified` UPDATE that also sets `flagged_reason` passes RLS (WITH CHECK allows verified) and the one-directional CHECK; only line 119 stops a forged reason on a verified row. Deleting the line leaves every new assertion green. Add a negative-test case: staff session, pending row -> `verified` with `flagged_reason='late_confirmation'`, assert the column stays null. [supabase/migrations/0106_flagged_payment_reason.sql:119, supabase/tests/flagged_payment_reason.negative.test.sql]

#### Rejected

- Backfill test pastes a copy of the migration CASE (gap, blind, auditor) — low: the two texts were diffed whitespace-normalised and are identical; the migration runs once, so later drift cannot occur. Acknowledged in Implementation Notes.
- Verify block does not name the INSERT trigger or `payments_flagged_reason_check` (blind, edge, gap, auditor) — low: both are created in the same transaction by straight-line DDL; the data scan covers the closed set; a guard adds code for a failure that cannot happen.
- Backfill scans `audit_log` unindexed under one transaction (blind, edge) — low: flagged rows are few at this gym count; fix adds an index and a NOT VALID/VALIDATE split for no demonstrated harm.
- Label map untyped, no fallback, no parity test, `reconciliation_mismatch` -> "Amount Mismatch" (blind, edge) — low/false: already triaged (#5 deferred to the rendering story, #12 label fixed by the story AC).
- `flaggedReason` only on discrepancy rows (blind, auditor) — false: the payments list never renders a Flagged badge (`PaymentsPageClient.tsx:35` comment: badge always Pending), and the human decision scoped this story to the data layer.
- Late branch still writes an audit row for a `wrong_account` row (edge) — false: intended (triage #1, "audit trace kept").
- `coalesce(old.flagged_reason,'staff_flagged')` keeps a stale reason on a pending row (edge) — false: no path produces a pending row with a reason.
- Concurrent redelivery can write two late audit rows (blind) — low: guard is 0100's, unchanged; the added UPDATE is idempotent; fix needs row locking (triage #6).
- SECURITY DEFINER RPCs bypass the pin (edge claim) — false: by design, the closed-set CHECK is the net.
- "Bad value" case runs as migration owner not `service_role` (auditor) — low: CHECK fires for every role.
- No test for `processing -> flagged` client write or subscription late success (blind) — low: RLS blocks the first; the second is out of scope (triage #10).
- Spec/doc inconsistencies: `status: done` vs sprint `review`, Code Map line numbers, decisions.md item 7 formatting and omissions, sprint-status note wording (blind, auditor) — low: fixes edit the spec under review or are cosmetic.
