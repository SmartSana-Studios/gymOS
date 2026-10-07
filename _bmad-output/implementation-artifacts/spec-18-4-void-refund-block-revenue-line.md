---
title: 'Story 18.4: Void, Refund Block & Revenue Line'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 2e32b3a1f2fe87a11cbbee070fc5c4abf5f02d65
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A registration fee recorded by hand in error is permanent, a refund can still be recorded against a fee, and month-to-date revenue has no way to exclude voided money or show fee income on its own.

**Approach:** Migration 0101 adds a void RPC (a correction, never a refund or a delete), blocks refunds of fee and voided payments in RLS and a trigger, makes `gym_revenue_mtd()` skip voided payments, and adds `gym_registration_fee_revenue_mtd()`. The Overview revenue card gains an "of which registration fees" line. The void screens are Story 18.6.

## Boundaries & Constraints

**Always:** `void_registration_fee_payment(p_payment_id uuid, p_reason text)` returns void: `security definer`, `set search_path`, PUBLIC execute revoked, fail-closed role gate owner/supervisor only, then `private.current_gym_status() is distinct from 'active'` guard (text contains `is not active`) before any write. Reason is trimmed (`btrim(.., E' \t\r\n')`), non-blank, at most 200 chars. Lock the payment row first, the member row second. The payment must be in the caller's gym with `purpose 'registration_fee'`, `status 'verified'`, `voided_at is null` (else `not_found: payment`). On success: `voided_at = now()` (row kept), member `registration_fee_settled_at = null`, audit `registration_fee_voided` (target = member, metadata `payment_id`, `amount`, `method`, `reason`). `gym_revenue_mtd()` keeps its signature, SECURITY INVOKER and refunds subtraction; `gym_registration_fee_revenue_mtd()` is also INVOKER, uses `private.gym_local_month_bounds`, filters `gym_id = private.gym_id()`, and never inlines the month arithmetic. New strings EN/FR; `pnpm check:i18n` passes.

**Never:** No dashboard void/refund surface, member-app change or `RecordRefundModal` edit (18.5-18.7). No delete or status change of a payment. No change to `record`/`waive`/Tara functions or the 18.2 insert policy. Do not extend `protect_payment_purpose_and_void`; the DEFINER function writes `voided_at` as the owner.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Void | Owner/supervisor, verified manual fee, member has no subscription | `voided_at` set, member awaiting again, audit row; fee can be collected again | N/A |
| Role | Manager, receptionist, coach, member, no claim | nothing changes | `permission denied` |
| Suspended | Gym not active | nothing changes | `is not active` |
| Bad reason | Null, blank, tab/newline-only, over 200 chars | nothing changes | `reason is required` / `reason is too long` |
| Not voidable | Other gym, non-fee, `processing`/`flagged`, already voided | nothing changes | `not_found: payment` |
| Tara fee | `method = 'mobile_money'` | nothing changes | `tara_fee_cannot_be_voided` |
| Has plan | Member has any subscription, any status | nothing changes | `member_already_has_subscription` |
| Refund of fee | Insert via RLS, trigger, or service role | rejected; nothing inserted | `registration_fee_not_refundable` |
| Refund of voided | Voided payment | rejected | `payment_voided_not_refundable` |
| Revenue | Voided, flagged or processing fee rows | excluded from `gym_revenue_mtd`; verified non-voided fees stay in it | N/A |
| Fee line | Verified non-voided fee payments in the gym-local month | `gym_registration_fee_revenue_mtd` sums them; other gym, other month, voided, suspended gym -> 0 | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0099_registration_fee_collection.sql` -- copy the `record`/`waive` shape (role gate, status guard, reason trim, `log_audit_event` named args, grants, `$verify$` incl. fail-closed guard regex and manager-names-supervisor check). `payments.voided_at` and the unique index already exist; the voided row frees the index slot. Do not name write statements in comments before the status guard.
- `supabase/migrations/0093_supervisor_manager_plus_access.sql:114` -- current `manager_or_owner_insert_own_refunds`; `alter policy` it verbatim plus `p.purpose <> 'registration_fee' and p.voided_at is null` in its `exists`. Refund trigger is `security definer` so RLS cannot hide the payment (the 0098 gate style).
- `supabase/migrations/0095_gym_revenue_mtd.sql` -- `create or replace gym_revenue_mtd()` with `and p.voided_at is null`; add the new function and keep the PUBLIC-revoke / INVOKER `$verify$` checks. Never edit 0095.
- `supabase/tests/gym_revenue_mtd.test.sql` (`plan(36)`) -- extend for the void exclusion. New `registration_fee_void_refund_revenue{,.negative}.test.sql`, fixture ids `…0314xx`, pattern from `registration_fee_collection*.test.sql`. Prove the RLS refund clause with the trigger disabled inside the transaction (a BEFORE trigger fires first). Include a non-UTC month-boundary row. `suspension_rpc_coverage.test.sql` must stay green without exclusion edits.
- `apps/dashboard/services/payments.ts:519` `getRevenueMtd` -- model for `getRegistrationFeeRevenueMtd()` (no args, mapped error). `:663` `listRefundEligiblePayments` -- add `.eq("purpose", "subscription").is("voided_at", null)`.
- `apps/dashboard/app/(dashboard)/page.tsx:136,186` -- fetch the new figure and `getGymSettings().registrationFee` in the existing `Promise.all`; pass an optional `detail` line to `components/ui/stat-card.tsx` (new optional prop, no change for other cards). Show it when fee > 0 or the figure > 0; a failed fee read hides only the line. `OverviewAutoRefresh` untouched. Extend `page.overview.test.tsx` and add `payments.getRegistrationFeeRevenueMtd.test.ts` (model `payments.getRevenueMtd.test.ts`).
- `packages/types/src/errors.ts:552` -- add the four codes above (`copy` + `locales/{en,fr}.json`); `database.ts:2069` -- hand-splice both RPCs (alphabetical). `audit/auditLabels.ts:32-48` + `apps/dashboard/locales/{en,fr}.json` `audit.actionTypes` -- add `registration_fee_voided` (`registration_fee_paid` is already mapped by 18.3). `docs/decisions.md` -- dated entry, written with a quoted heredoc.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0101_registration_fee_void_refund_revenue.sql` -- void RPC, refund policy + trigger, both revenue functions, `$verify$` -- schema + safety
- [x] `supabase/tests/` -- new pgTAP pair plus the `gym_revenue_mtd` update, covering every matrix row, both refund lines, double void, cross-gym, a voided member re-collected, and the month boundary
- [x] `apps/dashboard/services/payments.ts`, `page.tsx`, `stat-card.tsx` -- fee line, refund list filter, tests
- [x] `packages/types` -- error mapping, `database.ts`; audit label + EN/FR locales; `docs/decisions.md`

**Acceptance Criteria:**
- Given the full pgTAP suite, then green (including `suspension_rpc_coverage`); new files green.
- Given `pnpm typecheck`, `lint`, `check:i18n` and the dashboard and types tests, then pass.
- Given a gym with fee 0 and no fee revenue, then the revenue card renders exactly as before.
- Given a voided member, when staff record the fee again, then it succeeds (one non-voided fee per member).

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `StatCard.detail` has no render test; page tests inspect props only (VG, Blind) | medium | patch | Dropping the `{detail ? ...}` line left every check green. Two render cases added to `stat-card.test.tsx`. |
| `getGymSettings()` error destructured away, never logged (Blind, Edge) | low | patch | Every other Overview read logs; one `console.error` added. A thrown rejection is the same pattern as the other reads. |
| Voided fee still shows as a normal verified payment in the super-admin payment list, mobile history/receipt, and the platform-wide `sum(amount)` in `0011:106` (Blind, VG) | medium | defer | Real, pre-existing consumers that predate `voided_at`; the spec's Never excludes member-app and list surfaces (18.6/18.7). Recorded in deferred-work.md. |
| Void races a subscription insert in flight, leaving a member with a plan and awaiting (Edge, Blind) | low (unverified) | defer | `enforce_registration_fee_settled` reads the member without a lock, so the void's no-subscription check is point-in-time. Narrow window, recoverable by waive; needs a two-session test to settle. |
| `not_found: payment` unmapped; five conditions share one error (Blind, Edge) | low | defer | Spec lists four codes; the 18.6 screen is the first caller. Recorded in deferred-work.md. |
| Existing refund on a fee payment makes void double-subtract (Blind, Edge) | false | rejected | Fee payments exist only since 0099 (Epic 18 unreleased, held from master), so no production fee payment can carry a refund; post-0101 the policy and trigger block new ones. |
| Detect Tara by `provider`, not `method` (Blind) | false | rejected | Manual methods are fixed to cash/bank_transfer/manual_momo by `record_registration_fee`; 18.3 writes `mobile_money` only for Tara. The spec names `method`. |
| Void silently removes the payment from an already-closed month (Blind) | false | rejected | Intended: a void corrects an erroneous entry, so the money was never taken. |
| Refund trigger is INSERT-only; `UPDATE refunds SET payment_id` bypasses it (Blind, Edge) | false | rejected | `refunds` has no UPDATE policy for any client role (0033); the spec fixes the trigger as BEFORE INSERT. |
| Void after the fee was lowered to 0 strands the member (Edge) | false | rejected | Matches the frozen 18.2 decision: lowering the fee never releases awaiting members; waive is the way out. |
| Unchecked member update could be a no-op (Edge) | false | rejected | `payments.member_id` is a foreign key and fee rows are only created for role `member`. |
| `Number(data)` for a bigint RPC (Edge) | false | rejected | Identical to `getRevenueMtd`; PostgREST returns a JSON number. |
| ": " separator hard-coded, French spacing (Blind) | low | rejected | Cosmetic; the spec fixes the "of which registration fees: XAF n" form and the fix means a new interpolated key in both locales. |
| `getGymSettings()` extra round trip on every Overview load (Blind) | low | rejected | Needed to decide whether a zero line shows (spec: fee above 0); one cached-shape read. |
| Policy text re-copied without checking it against later migrations (Blind) | false | rejected | Only 0033 and 0093 touch that policy (grep); `$verify$` asserts the new clauses and supervisor. |
| `recordRefund` service does not check purpose/voided (VG) | false | rejected | The trigger raises first and the mapping is tested; the bad outcome (a refund row) does not happen. |
| No supervisor-success refund pgTAP; no concurrency, month-rollover or re-collect-after-fee-change tests (Blind, VG) | low | rejected | The policy keeps supervisor verbatim and `$verify$` checks it; two-session tests are beyond the pgTAP convention; re-collect after void is already a matrix test. |

## Verification

**Commands:**
- pgTAP via `supabase test db` (or the pg_prove workaround in `docs/decisions.md`) -- expected: all green
- `pnpm typecheck && pnpm lint && pnpm check:i18n && pnpm --filter @gymos/dashboard test` -- expected: exit 0
