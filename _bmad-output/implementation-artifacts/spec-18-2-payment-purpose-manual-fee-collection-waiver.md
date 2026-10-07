---
title: 'Story 18.2: Payment Purpose, Manual Fee Collection & Waiver'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: f78938f7b53ed4f130735ec74f98e0c10d6874c1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An awaiting member (Story 18.1) has no way out: nothing records a fee payment, `payments` cannot say what a row pays for, and nothing waives the fee.

**Approach:** Migration 0099 adds `payments.purpose` and `payments.voided_at`, a one-fee-per-member index and a narrowed staff insert policy, then `record_registration_fee` and `waive_registration_fee` RPCs that settle the member. Fee payments send no push notification. Database-only; the screens are Story 18.6.

## Boundaries & Constraints

**Always:** Fee payment `amount` is read from `gyms.registration_fee` server-side, never a parameter. Fee rows are `verified`, `currency 'XAF'`, no `subscription_id`, `actor_id = auth.uid()`. Settling (`registration_fee_settled_at = now()`) and the insert share one transaction. Both RPCs: `security definer`, `set search_path`, PUBLIC execute revoked, `private.current_gym_status() is distinct from 'active'` guard (raise text contains `is not active`) before any write, no dynamic SQL. Role gates fail closed (`coalesce`). Record: owner/manager/supervisor/receptionist. Waive: owner/supervisor/manager. Reason non-blank, ≤ 200 chars. Existing payments take `purpose 'subscription'` and are unchanged; whole existing pgTAP suite passes with no fixture edits. New policy/function text that names `manager` also names `supervisor`. EN and FR strings, `pnpm check:i18n` passes.

**Decision (release of awaiting members):** Lowering the fee to 0 does NOT auto-release awaiting members; `set_registration_fee` is unchanged. `waive_registration_fee` works on any awaiting member regardless of the gym's current fee (including 0), and is the way out. `record_registration_fee` still raises `registration_fee_not_configured` at fee 0.

**Never:** No void RPC, refund block, revenue change (18.4), no Tara path (18.3), no UI or `recordManualPayment` change (18.5/18.6). Do not redefine `protect_payment_columns_on_staff_verify`. Do not touch `gym_revenue_mtd` or the refund picker.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Record | Awaiting member, fee > 0, method cash/bank_transfer/manual_momo, reason | `verified` fee row at gym fee; member settled; `registration_fee_recorded` audit (amount, method, reason) | N/A |
| Not due | Member already settled / deactivated / other gym / role ≠ member / gym fee 0 | nothing written | `registration_fee_not_due` / `member_deactivated` / `not_found` / `not_found` / `registration_fee_not_configured` |
| Bad input | `mobile_money`, blank or > 200 reason | rejected, nothing written | exception |
| Double record | Second call, or non-voided non-`flagged` fee row exists | blocked | `registration_fee_already_recorded` |
| Retry | Prior fee row `flagged` | new record succeeds | N/A |
| Waive | Owner/supervisor/manager, awaiting member, reason | settled; no payment row; `registration_fee_waived` audit with reason | receptionist/coach/member, settled, deactivated, blank reason, suspended gym → error |
| Direct insert | Staff inserts `purpose = 'registration_fee'` via RLS | denied | RLS |
| Direct write | `authenticated` UPDATE of `payments.voided_at` / `purpose` | pinned unchanged | silent revert (18.1 style) |
| Notification | Fee row inserted `verified` or updated to `flagged` | no N-04/N-05 notification row | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0098_registration_fee_foundation.sql` -- latest; new file `0099_registration_fee_collection.sql`. Copy `set_registration_fee` (role gate, status guard, `log_audit_event` named args, grants), the INVOKER pin `private.protect_registration_fee_settled_at` (pins when `current_user in ('authenticated','anon')`; definer RPCs pass), and the trailing `$verify$` block shape.
- `0005` payments base, `0036:44` `payments_reason_length_check` (reuse, add none), `0001:20` `payment_status` enum (pending/processing/verified/flagged).
- `0093:91` `gym_staff_insert_own_payments` -- `alter policy ... with check` appending `and purpose = 'subscription'`; keep its existing clauses verbatim. `0093:374 confirm_renewal` -- shape of a definer payments insert.
- `0031:75` `protect_payment_columns_on_staff_verify` -- pending-only, JWT-keyed, omits supervisor: do NOT extend; add a separate BEFORE UPDATE OF (`voided_at`, `purpose`) INVOKER trigger in the 0098 style.
- `0046:267` `payments_notify_status_change` trigger (`when NEW.status in ('verified','flagged')`) / `private.notify_payment_status_change` -- add `and NEW.purpose = 'subscription'` to the trigger WHEN (drop + create, after the column exists).
- `supabase/tests/suspension_rpc_coverage.test.sql` -- both RPCs must carry the status-guard regex; gated-table count stays 21. `supervisor_manager_plus_access.test.sql:148-185` -- policy/function role lists.
- Tests: new `registration_fee_collection.test.sql` + `.negative.test.sql`; fixture ids `…0311xx` block follows 18.1's pair (`registration_fee_foundation*.test.sql`), pair each denial with a positive control.
- `packages/types/src/schemas/payment.ts` (~85 `recordManualPaymentSchema`, `REASON_MAX_LENGTH`) -- add `recordRegistrationFeeSchema` (`memberId`, same method enum, reason) and `waiveRegistrationFeeSchema`; no amount field. `packages/types/src/database.ts` -- hand-splice payments (~989-1050) and Functions (~1781, alphabetical).
- `apps/dashboard/app/(dashboard)/audit/auditLabels.ts:32-34`, `apps/dashboard/locales/{en,fr}.json` `audit.actionTypes` (~1026) -- add `registration_fee_recorded`, `registration_fee_waived`.
- `docs/decisions.md` -- dated entry (pin choice, notification skip, Open Question outcome).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0099_registration_fee_collection.sql` -- `purpose` + check, `voided_at`, partial unique index (`member_id` where `purpose='registration_fee' and voided_at is null and status <> 'flagged'`, mapped to `registration_fee_already_recorded`), policy alter, pin trigger, notify trigger WHEN, both RPCs with grants, `$verify$` block -- schema + safety
- [x] `supabase/tests/registration_fee_collection.test.sql` and `.negative.test.sql` -- cover every I/O row, role matrix for both RPCs, client-supplied amount impossible, race, flagged retry, RLS denial, no notification row, suspended and cross-gym
- [x] `packages/types` -- schemas, `database.ts` splice
- [x] `auditLabels.ts` + EN/FR locales -- two action labels
- [x] `docs/decisions.md` -- dated entry

**Acceptance Criteria:**
- Given the full pgTAP suite, when run unmodified, then green; new files green.
- Given `pnpm typecheck`, `lint`, `check:i18n`, dashboard and types tests, then pass.
- Given a manual fee record, when the member is then given a subscription, then the 18.1 gate no longer rejects it.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| Reason length checked on untrimmed `p_reason`, stored trimmed (Blind, Edge x2) | low | patch | `char_length(p_reason) > 200` vs `v_reason := btrim(p_reason)`; padded input the Zod `.trim().max(200)` accepts is rejected. One-word fix in both RPCs. |
| Staff INSERT policy does not constrain `voided_at`; pin is UPDATE-only (Edge) | medium | patch | Staff can insert a pre-voided payment; 18.4 revenue exclusion would then be bypassable. Policy fix is one clause, no new surface. |
| Waive on awaiting member with an in-flight/verified fee row; in-flight row yields "already recorded"; flagged -> verified completion can hit raw 23505 (Edge x3) | medium | defer | Unreachable in 18.2: record settles in the same transaction and no 18.2 path leaves an awaiting member with a non-voided fee row. Needs 18.3's `processing` rows; 18.3 owns complete_verified_payment and waive/in-flight interplay. Recorded in deferred-work.md. |
| `unique_violation` handler never executed by a test (Verification Gap) | low | rejected | The partial index is tested (SQLSTATE 23505) and the pre-check path asserted; the handler only fires on a true concurrent race, which pgTAP cannot interleave. The index still guarantees no duplicate. |
| Fee payments visible to `gym_revenue_mtd`, refund picker, payment history, mobile history (Blind, Edge, VG) | low | rejected | Intent excludes it: epic assigns revenue line and refund block to 18.4, spec Never says so, decisions entry records it, and Epic 18 is held from master so no real gym can collect a fee yet. |
| Void must clear `registration_fee_settled_at`; no un-settle path (Blind, Edge) | false | rejected | Epic 18.4 AC: void returns the member to awaiting; waive is explicitly not undoable (epic). Nothing in 18.2 voids. |
| Staff can flip a fee row pending -> flagged (Blind) | false | rejected | Test seeds the pending fee row as superuser. No 18.2 path creates a pending fee row (RPC inserts `verified`; staff insert policy now denies `registration_fee`), and the verify policy only touches `pending` rows. |
| DB reason minimum weaker than Zod min 10 (Blind) | low | rejected | Epic requires only non-blank, <= 200 in the RPC; Zod min mirrors `recordManualPaymentSchema`. |
| service_role/definer bypass of payments pin untested (Blind) | low | rejected | Pin is `current_user in ('authenticated','anon')`, same mechanism 18.1 proved with a real definer function; no payments writer other than the owner role exists yet. |
| Notify trigger recreate may widen events vs 0046; `$verify$` pattern weak (Blind) | false | rejected | 0046:267 is `after insert or update ... when (NEW.status in ('verified','flagged'))`; the recreate is identical plus the purpose clause. |
| Waived vs paid distinguishable only via audit; currency hard-coded; method list repeated; `purpose` typed string; no Zod tests; no client error mapping; audit page metadata (Blind) | low | rejected | Epic design (no payment row on waive, `currency = 'XAF'`, text+check types, 18.6 owns error mapping); `packages/types` has no test suite; auditLabels.ts is the only audit-label consumer. |

### Review Findings

Second independent review (2026-10-07; Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor over `master...HEAD`, commit e062948): 23 raw findings, 1 patch, 0 decision-needed, 0 defer, 22 rejected (distinct claims below).

- [x] [Review][Patch] Reason "non-blank" check passes tab/newline-only input, because `btrim(p_reason)` trims spaces only [supabase/migrations/0099_registration_fee_collection.sql:record_registration_fee, waive_registration_fee `v_reason := btrim(p_reason)`] — Edge Case Hunter. Verified: a reason of `E'\t'` survives `btrim`, passes `v_reason = ''` and is stored and audited, while the Zod schema (`.trim()`) rejects the same input. Low: not reachable from the UI and a one-character reason is also accepted, but the spec's Always says "reason non-blank". Fix is one argument in both RPCs (`btrim(p_reason, E' \t\r\n')`) plus a pgTAP case. Note 0022/0035/0036/0037 use the same plain `btrim`, so this repeats an existing repo habit.

**Rejected**

- `unique_violation` handler too broad (Blind, Edge): `false`. The handler wraps a single INSERT that never sets `provider_transaction_ref` (the only other unique column on `payments`, NULL here) and lets `id` default, so the fee index is the only unique constraint it can hit. A real concern for 18.3's Tara path, not for this function.
- Fee read without a lock can differ from the fee at commit (Blind, Edge): `false`. READ COMMITTED reads the fee in force at that statement; a `set_registration_fee` committing a moment later is an ordinary ordering, not a wrong amount.
- Deactivated/demoted staff keep access until JWT expiry (Edge): `false` for this change. `auth.jwt() ->> 'app_role'` gating is the codebase-wide pattern in every RPC (0022, 0035, 0036, 0093); not introduced here.
- No shape check forcing fee rows to have null `subscription_id` and XAF (Edge): `low`, not worth fixing. No path creates a non-conforming row today, and the guard would be a new constraint for a speculative 18.3 caller.
- Fee rows visible to `gym_revenue_mtd`, refund picker, history; refundable until 18.4; readers not inventoried (Blind x3, Edge, Auditor): `low`, rejected. Spec Never, epic AC 18.4 and the triage log above already assign this to 18.4; `subscription_id` was already nullable so fee rows are not a new row shape; the notify trigger skips them; Epic 18 is held from master so no live gym can collect a fee. (Already rejected in the first review.)
- Waive ignores an existing non-voided fee row (Auditor): already deferred to 18.3 in `deferred-work.md` (the "Medium, unreachable in 18.2" entry). Nothing new.
- Waive audit omits the fee amount (Blind): `low`, rejected. Spec records the audit as carrying the reason; no consumer needs the forgone amount yet and 18.6/18.4 can add it where the screen needs it.
- `$verify$` checks are substring-only (policy clauses, index predicate, notify trigger) (Blind x2, Auditor): `low`, rejected. Behavior is proven by pgTAP (policy denial matrix, index 23505 and flagged exemption, notification suppression); verify blocks in 0093/0098 use the same substring style.
- Policy re-pasted from 0093 may revert a later change (Blind): `false`. `gym_staff_insert_own_payments` is last defined in 0093; no migration between 0093 and 0099 touches it (grep), and the Auditor confirmed the clauses against 0093:91.
- No waived-vs-paid state, no `voided_by`/void reason (Blind): `low`, rejected. Epic design: waive writes no payment row and the audit log is the record; void metadata is 18.4's migration.
- Spec frontmatter/Implementation Notes/Boundaries out of step with the review patches (Blind, Auditor): rejected. Fix is to edit the spec; the Triage Log records both patches.
- 200-char limit repeated as a literal; Zod min 10 vs RPC non-blank; `purpose`/`method` typed `string` in `database.ts`; no Zod schema tests (Blind): `low`, rejected. `payments_reason_length_check` is the same 200 and the RPC check exists for a clean error; Zod min mirrors `recordManualPaymentSchema`; `database.ts` follows the generated shape (text columns); `packages/types` has no test suite. (Mostly already rejected in the first review.)
- Race/serialization not tested (Blind, Auditor, VG): `low`, rejected. The `for update` row lock is the mechanism; pgTAP cannot interleave two sessions, and the index and pre-check paths are asserted. (Already rejected in the first review.)

## Verification

**Commands:**
- `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all pgTAP green
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0
