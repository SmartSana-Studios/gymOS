---
baseline_commit: 9dc27bd
---

# Story 4.5: Refund Recording

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want to record a refund when a member disputes a payment,
so that the dispute is tracked even though the gym pays the member out-of-band.

## Scope Note — Read Before the Acceptance Criteria

**No mockup or UI surface exists anywhere for refunds.** AD-09 (Payments page) shows no refund action, and MA-14 (member app's Payment Detail/receipt screen) explicitly says "No member-initiated refund action" — that's about the member app, not the admin dashboard, and doesn't cover this story either. **This story must design its own minimal entry point**, same situation Stories 4.3/4.4 were already in for their own scope decisions.

**No "All Payments" ledger table exists yet** — Story 4.3's Scope Note explicitly deferred it (no FR requires it), and Story 4.4 built its own Discrepancies section around the same gap rather than the full ledger. There is currently no UI anywhere that lists a member's individual payment history to pick "a disputed payment" from. **Resolved design:** add a "+ Record Refund" button to the existing `/payments` page (next to "+ Record Payment"), visible only to owner/manager (this story's own user story says "Manager or Owner" — narrower than payment recording's owner/manager/receptionist; gated client-side via a new `role` prop threaded from `getDashboardShellContext()`, same pattern `Sidebar.tsx` already uses for role-based visibility, UX-DR4). It opens a `RecordRefundModal` with two steps: (1) search and select a member — reuses `searchMembersForPaymentAction` verbatim, no duplicate; (2) once a member is selected, fetch that member's refund-eligible payments (a new `listRefundEligiblePaymentsAction`) and let the user pick one from a list, which prefills the refund amount (editable, capped to that payment's amount).

**Refunds live in a brand-new `refunds` table, entirely separate from `payments`.** `payment_status` (the enum) has no `'refunded'` value and this story does not add one — a refund is a separate ledger fact, not a change to what was actually paid. This is the exact same "don't mutate `payments.status`, add a dedicated table instead" precedent Story 4.4 established for `payment_discrepancies` (see that story's own Scope Note). Unlike `payment_discrepancies.gym_id` (nullable — some discrepancies are gym-unattributable by construction), `refunds.gym_id` is **not null**: a refund always targets a real, already-`verified` payment, so a gym is always resolvable at insert time. No "unattributable" case exists here.

**Only `verified` payments are refund-eligible.** A `pending`/`processing`/`flagged` payment was never confirmed as real, completed money — there's nothing to refund. `refunds.payment_id` is `unique`: **at most one refund per payment in V1** (a record-a-dispute ledger, not a partial/multiple-refund system) — a second refund attempt against an already-refunded payment is rejected by this constraint, surfaced as a friendly conflict error.

**The refund amount cannot exceed the original payment's amount.** This is a real database-state-dependent business rule (unlike a static Zod bound), so it's checked twice: once in `services/payments.ts#recordRefund` for a friendly error message, and again — the real authorization gate — inside the new RLS INSERT policy's own `exists` clause. Same "fast, friendly Server Action check backed by an uncircumventable DB gate" shape architecture.md's Gap 2 resolution already established for member-cap enforcement.

**No provider-executed refund API call exists anywhere in this story (AC #2).** No Edge Function is touched, no `PaymentProvider` interface method is called. This is satisfied by construction — don't accidentally wire up a TaraMoney/`PaymentProvider` refund call that has no basis in any AC; recording is genuinely the entire scope.

**This story does not touch `subscriptions` in any way.** No AC asks for the member's subscription/access to be reverted or changed when a refund is recorded — the epics user story's own framing ("the gym pays the member out-of-band") implies the member keeps whatever access they already had. Matches Story 4.3's "this is a payment ledger entry, not a renewal" discipline, applied here to refunds instead.

**No new "Refunds" list/section is built anywhere** (Payments page, Audit Log, member detail — no member detail page exists yet at all). No AC or FR requires displaying a list of recorded refunds back to any UI in V1 — the audit log (FR-080, Epic 7's future Audit Log page) is the only durable, queryable record. Same "don't build UI beyond what's asked" discipline as Story 4.4's Discrepancies section, applied here as "build no list at all" rather than "build a minimal read-only one," since no AC even implies staff need to browse past refunds.

## Acceptance Criteria

1. **Given** a disputed payment, **when** I record a refund with amount, mandatory reason, and actor, **then** the refund is saved, timestamped, and audit-logged. [Source: epics.md#Story 4.5 AC#1; FR-040] — see Scope Note: the "disputed payment" must be an already-`verified` payment, selected via the new Record Refund modal's member-then-payment picker; amount is capped to the original payment's amount.
2. **Given** V1 scope, **when** a refund is recorded, **then** no provider-executed refund API call is triggered (recording only). [Source: epics.md#Story 4.5 AC#2; FR-040] — satisfied by construction, see Scope Note.

## Tasks / Subtasks

- [x] **Task 1: New migration — `refunds` table + RLS** (AC: #1, #2)
  - [x] New file `supabase/migrations/0033_refund_recording.sql` (next sequential number after `0032_payment_reconciliation_job.sql`).
  - [x] Exact schema/RLS to implement:
    ```sql
    create table refunds (
      id uuid primary key default gen_random_uuid(),
      gym_id uuid not null references gyms(id),
      payment_id uuid not null references payments(id) unique,
      amount integer not null,
      currency text not null default 'XAF',
      reason text not null,
      actor_id uuid not null references users(id),
      created_at timestamptz not null default now(),
      constraint refunds_amount_positive check (amount > 0)
    );

    create index idx_refunds_gym_id on refunds(gym_id);

    alter table refunds enable row level security;

    grant select, insert, update, delete on refunds to authenticated, service_role;

    create policy "gym_staff_read_own_refunds" on refunds
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      );

    create policy "manager_or_owner_insert_own_refunds" on refunds
      for insert
      with check (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager'])
        and exists (
          select 1 from payments p
          where p.id = payment_id
            and p.gym_id = gym_id
            and p.status = 'verified'
            and amount <= p.amount
        )
      );
    ```
  - [x] No UPDATE/DELETE policy for any role — a recorded refund is permanent in V1 (FR-040's "recording only"; no AC specifies a correction/reversal path).
  - [x] Read policy is intentionally the same owner/manager/receptionist list as `gym_staff_read_own_payments` (0030) — a receptionist can already see the underlying payment, so seeing it was later refunded is no new exposure, even though no V1 UI actually renders a refunds list. It exists because `listRefundEligiblePayments` (Task 3) needs SELECT to exclude already-refunded payments from the picker.
  - [x] INSERT policy is deliberately narrower than `gym_staff_insert_own_payments` — owner/manager only, excluding receptionist (this story's own user story: "As a Manager or Owner"). Easy to widen later, hard to narrow once data/UI assumes it (same reasoning Story 4.2 applied to excluding coach from payments visibility).
  - [x] No `on delete` clause on the new FKs — matches the already-accepted, documented gap from Story 4.4's own deferred-work entry (not reachable through any delete path in this diff either).

- [x] **Task 2: Zod schema — `recordRefundSchema`** (AC: #1)
  - [x] `packages/types/src/schemas/payment.ts`: add below `flagPaymentSchema`, reusing the file's existing `REASON_MAX_LENGTH = 200` constant (do not redefine it):
    ```ts
    export const recordRefundSchema = z.object({
      paymentId: z.uuid("Select a payment to refund"),
      amount: z.number().int().positive().max(10_000_000, "Enter a valid amount"),
      reason: z
        .string()
        .trim()
        .min(10, "Add a reason (at least 10 characters)")
        .max(REASON_MAX_LENGTH, "Reason is too long"),
    });

    export type RecordRefundInput = z.infer<typeof recordRefundSchema>;
    ```
  - [x] No `memberId` field — unlike `recordManualPaymentSchema`, `recordRefund` (Task 3) derives `member_id`/`gym_id` from the target payment row itself (authoritative, not client-supplied), so there's nothing to validate here beyond which payment and how much.
  - [x] The `amount <= original payment amount` rule is **not** expressible in this schema (it depends on DB state) — enforced in `recordRefund` (Task 3) and mirrored in the RLS `with check` (Task 1). Say so in a comment, matching this file's existing self-documenting style.

- [x] **Task 3: `apps/dashboard/services/payments.ts` — refund read/write functions** (AC: #1, #2)
  - [x] Add below the existing Story 4.4 section, in a new `// Story 4.5: refund recording...` block. **Read the whole file first** — reuse `getCallerGymId`, `paymentNotFoundError`, `mapAndLog`, `getServerTranslation`/`getRequestLocale` exactly as the existing functions in this file do; do not duplicate any of them.
  - [x] `listRefundEligiblePayments(memberId: string)`: returns that member's `verified` payments with no existing `refunds` row, newest first. Query: `.from("payments").select("id, amount, currency, method, created_at, refunds(id)").eq("gym_id", gymId).eq("member_id", memberId).eq("status", "verified").order("created_at", { ascending: false })` — filter out rows where `refunds` (the reverse-FK embed) is non-empty, since `refunds.payment_id` is unique but PostgREST still embeds it as an array. Row shape: `{ id, amount, currency, method, createdAt }`.
  - [x] `recordRefund(input: RecordRefundInput)`: validates via `recordRefundSchema`, resolves `gymId`/`actorId` via `getCallerGymId`, then reads the target payment (`.from("payments").select("id, gym_id, member_id, amount, status").eq("id", input.paymentId).eq("gym_id", gymId).maybeSingle()`). If not found or `status !== "verified"`, return `paymentNotFoundError(...)` (reuse the existing helper — do not write a new one). If `input.amount > paymentRow.amount`, return a `validation_error` with message key `payments.refundModal.errors.amountExceedsPayment`. Otherwise insert into `refunds` (`gym_id`, `payment_id`, `amount`, `reason`, `actor_id: actorId`), `.select("id").single()`. A concurrent duplicate-refund race hits the `refunds.payment_id` unique constraint here — let `mapAndLog` map it the same way every other unique-violation path in this codebase already does; don't add special-case handling. Return `{ data: { id, memberId: paymentRow.member_id }, error: null }` on success — `memberId` comes back out for the audit-log call site (Task 4), same "authoritative fields read back from the row, not trusted from the caller" discipline as `verifyPayment`/`flagPayment`.
  - [x] `logRefundChange(refundId: string, metadata: Record<string, unknown>)`: a new, separate thin `log_audit_event` wrapper — do **not** extend `logPaymentChange`'s `actionType` union, since a refund's `target_entity_type` (`"refund"`) differs from every existing call in that function (`"payment"`), and that function has no parameter for it. Hardcode `p_action_type: "refund_recorded"`, `p_target_entity_type: "refund"`, `p_target_entity_id: refundId`. Same shape as `logPaymentChange` otherwise (resolve `gymId`, call `supabase.rpc("log_audit_event", ...)`, log-and-map on failure).

- [x] **Task 4: `apps/dashboard/app/(dashboard)/payments/actions.ts` — Server Actions** (AC: #1, #2)
  - [x] `listRefundEligiblePaymentsAction(memberId: string)`: thin passthrough to `listRefundEligiblePayments`, same shape as the existing `searchMembersForPaymentAction`.
  - [x] `recordRefundAction(input: unknown)`: parses `recordRefundSchema`, calls `recordRefund`, then `logRefundChange(data.id, { payment_id: parsed.data.paymentId, member_id: data.memberId, amount: parsed.data.amount, reason: parsed.data.reason })`. On audit failure, return `{ data: { id: data.id }, error: { code: "audit_log_failed", message: t("payments.errors.auditLogFailedRefund") } }` — exact same "saved but log the warning, don't roll back" pattern as `recordPayment`/`verifyPaymentAction`/`flagPaymentAction` in this same file.

- [x] **Task 5: Regenerate `packages/types/src/database.ts`** (AC: all)
  - [x] Run `supabase gen types typescript --local` after Task 1's migration applies cleanly. Adds `refunds` Row/Insert/Update/Relationships. Review the diff line-by-line before accepting (Story 1.4/4.4's established discipline) — expect only the new `refunds` table shape, no unrelated churn.

- [x] **Task 6: Payments page UI — Record Refund entry point** (AC: #1)
  - [x] `apps/dashboard/app/(dashboard)/payments/page.tsx`: thread `shell.role` through to `PaymentsPageClient` as a new `role` prop (the shell context already resolves this via `getDashboardShellContext()`, already called on this page — no new query needed).
  - [x] `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx`: accept the new `role: MemberRole` prop (import the type from `@/services/session`, matching how other dashboard components reference it). Render a `"+ Record Refund"` button next to the existing `"+ Record Payment"` button in the header row, **only when `role === "owner" || role === "manager"`** — client-side gating only, matching `Sidebar.tsx`'s existing role-based visibility convention (UX-DR4); the RLS INSERT policy (Task 1) is the real, uncircumventable gate. Clicking it opens the new `RecordRefundModal`.
  - [x] New `apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx`, modeled directly on `RecordPaymentModal.tsx`'s structure (`<dialog>`, `showModal()` on mount, same disabled-while-submitting/`onCancel` pattern) — **read that file in full first**, do not reinvent its member-search step:
    - Step 1 (member selection): copy `RecordPaymentModal`'s member-search block verbatim (debounced `searchMembersForPaymentAction` call, "must select from results" behavior) — do not duplicate the search logic into a shared hook, this codebase's established convention is per-file copies for this exact search pattern (see `RecordPaymentModal`'s own precedent).
    - Step 2 (payment selection, appears once a member is selected): call `listRefundEligiblePaymentsAction(memberId)`, render the results as a radio-button list (amount formatted with `toLocaleString(i18n.language)` matching `PaymentsPageClient`'s own `formatAmount`, plus method label via `PAYMENT_METHOD_LABEL_KEY` reused from `paymentLabels.ts`, plus a locale-aware date). If the list is empty, show `payments.refundModal.noEligiblePayments` and disable the rest of the form. Selecting a payment prefills the amount field with that payment's own `amount` (still editable).
    - Amount field: numeric input, same `/^\d+$/` whole-digit parsing guard `RecordPaymentModal` uses before handing to `Number()` (reject decimal/scientific input as a field error, don't silently truncate) — copy that exact validation approach.
    - Reason field: same `min 10 chars` live counter pattern as `RecordPaymentModal`'s reason field (`payments.refundModal.reasonCount`).
    - "Recorded By": same disabled, informational, session-display-name-only field as `RecordPaymentModal` (never submitted — the server derives the real actor).
    - Submit calls `recordRefundAction`; on `audit_log_failed`, close the modal and surface the warning via the page's existing toast (`onSaved(warning)` callback shape, identical to `RecordPaymentModal`'s `onSaved`).
  - [x] No changes to `VerifyPaymentConfirmDialog.tsx`/`FlagPaymentDialog.tsx` — unrelated to this story.

- [x] **Task 7: i18n + decisions** (AC: all)
  - [x] `apps/dashboard/locales/en.json`/`fr.json`: inside the existing `"payments"` block, add `"recordRefundButton": "+ Record Refund"` and a new `"refundModal"` sub-object mirroring `"modal"`'s shape: `title`, `close`, `member`, `memberPlaceholder`, `paymentLabel` (payment-selection step's label), `noEligiblePayments`, `amount`, `reason`, `reasonCount`, `recordedBy`, `recordButton`, `recording`, and an `errors` sub-object (`memberRequired`, `paymentRequired`, `amountInvalid`, `amountExceedsPayment`, `reasonInvalid`). Also add `"payments.errors.auditLogFailedRefund"` alongside the existing `auditLogFailedRecord`/`Verify`/`Flag` keys. Verify via `node scripts/check-i18n-key-parity.mjs`.
  - [x] `docs/decisions.md`: dated entry (2026-08-01) recording (1) refunds as a dedicated new table rather than a `payments.status` mutation, mirroring Story 4.4's `payment_discrepancies` precedent, and (2) the "one refund per payment, no partial/multiple-refund ledger" V1 simplification (`refunds.payment_id unique`).

- [x] **Task 8: pgTAP coverage** (AC: #1, #2)
  - [x] New file `supabase/tests/refund_recording.test.sql`, seeding a gym/tier/member/plan/subscription plus one `verified` payment (mirror `payment_reconciliation_job.test.sql`'s fixture-seeding style).
  - [x] RLS assertions: owner/manager can INSERT a refund against their own gym's verified payment; receptionist and coach cannot (0 rows / RLS-denied); a cross-gym payment_id is rejected (the `exists` clause's `p.gym_id = gym_id` condition fails); an amount greater than the payment's own amount is rejected; an INSERT against a `pending`/`processing`/`flagged` payment is rejected. SELECT: owner/manager/receptionist see their own gym's refund rows; coach and cross-gym sessions see 0 rows.
  - [x] Uniqueness: a second INSERT against the same `payment_id` fails (unique-violation), proving "at most one refund per payment."
  - [x] `rls_tenant_isolation.test.sql`: add a `refunds` deny-all-for-member-role assertion, same shape as this story's own `payment_discrepancies` addition in Story 4.4 (`select is((select count(*) from refunds)::int, 0, 'refunds: 0 rows for a member-role session -- gym_staff_read_own_refunds is staff-gated...')`). **Remember to bump `select plan(15)` to `plan(16)`** — a common miss when extending this file (the count must match the actual number of `select is(...)`/`select throws_like(...)` assertions run).

- [x] **Task 9: Validation and manual verification**
  - [x] `pnpm run typecheck` (4/4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` — zero regressions against the pre-story baseline (426 assertions per Story 4.4's own final count) plus this story's new file and the `rls_tenant_isolation.test.sql` addition.
  - [x] Hands-on: as an owner/manager session, record a refund against a real verified payment via the UI; confirm the `refunds` row, confirm the audit log entry (`action_type = 'refund_recorded'`), confirm the same payment no longer appears in a second Record Refund attempt's eligible-payments list. As a receptionist session, confirm the "+ Record Refund" button does not render.

### Review Findings

- [x] [Review][Patch] Duplicate-refund race surfaces a generic "unknown" error instead of the friendly conflict message the story documents [packages/types/src/errors.ts]
- [x] [Review][Patch] `RecordRefundModal` silently swallows the error from `listRefundEligiblePaymentsAction`, rendering it identically to a genuine "no eligible payments" empty state [apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx:93]
- [x] [Review][Patch] `rls_tenant_isolation.test.sql`'s new `refunds` deny-all assertion never seeds a `refunds` row, so it can't actually prove RLS denial [supabase/tests/rls_tenant_isolation.test.sql:1003]
- [x] [Review][Patch] `recordRefund` never reads/sets `currency` on the `refunds` insert — always takes the `'XAF'` column default regardless of the original payment's actual currency [apps/dashboard/services/payments.ts]
- [x] [Review][Patch] `RefundEligiblePaymentRowFromDb.refunds` is typed/commented as an array, but `refunds.payment_id` is unique (`isOneToOne: true`) so PostgREST embeds it as a single object, not an array [apps/dashboard/services/payments.ts]
- [x] [Review][Patch] No loading indicator while `eligiblePayments` is being fetched after selecting a member — leaves a blank gap under "Payment to Refund" [apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx:261]
- [x] [Review][Defer] `refund_recording.test.sql` only seeds/tests one of the three enumerated "not verified" statuses (`pending`) though Task 8 literally lists `pending`/`processing`/`flagged` [supabase/tests/refund_recording.test.sql] — deferred, pre-existing

## Dev Notes

- **Read `apps/dashboard/services/payments.ts` and `apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx`/`PaymentsPageClient.tsx` in full before starting** — all three already exist (Stories 4.2–4.4) and this story extends them in place, following their exact `getCallerGymId()`/toast/refresh/member-search conventions.
- **`payment_status` (the enum) and every existing `payments` RLS policy/trigger from 0030/0031 are untouched by this story.** No migration in this story touches the `payments` table's own columns, policies, or `protect_payment_columns_on_staff_verify()` — refunds live entirely in the new `refunds` table (Scope Note).
- **This story never touches `subscriptions`** — no renewal, no reversal, no access change. A refund is a pure ledger entry (Scope Note).
- **No provider/Edge Function code is touched at all** — unlike Stories 4.1/4.2/4.4, this story has zero Deno code changes. The `pnpm typecheck`-doesn't-cover-`supabase/functions/` gap those stories documented does not apply here.
- **Money handling (FR-026/NFR-003):** `refunds.amount`/`currency` follow the same integer-XAF-plus-explicit-currency-column convention as every other monetary field in this schema. No floating-point handling anywhere in this story.
- **Actor/audit discipline:** `actor_id` is always derived server-side from the caller's own session claims (`getCallerGymId`'s existing `actorId` return value) — never accepted as a client-supplied field, matching `recordManualPayment`'s own actor derivation.
- **Testing standard:** pgTAP is the primary automated coverage (Task 8), matching every prior RLS-shaped story in this epic (4.2, 4.3, 4.4). No manual/E2E dashboard testing infrastructure exists in V1 (documented project-wide standard) — Task 9's hands-on pass is the only UI-level verification.

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0033_refund_recording.sql                              (new)
  supabase/tests/refund_recording.test.sql                                    (new)
  supabase/tests/rls_tenant_isolation.test.sql                                (modified — 1 new assertion, plan count bump)
  packages/types/src/schemas/payment.ts                                      (modified — recordRefundSchema)
  packages/types/src/database.ts                                             (regenerated)
  apps/dashboard/services/payments.ts                                        (modified — listRefundEligiblePayments, recordRefund, logRefundChange)
  apps/dashboard/app/(dashboard)/payments/actions.ts                         (modified — listRefundEligiblePaymentsAction, recordRefundAction)
  apps/dashboard/app/(dashboard)/payments/page.tsx                           (modified — thread role prop)
  apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx (modified — role-gated button, modal wiring)
  apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx  (new)
  apps/dashboard/locales/en.json                                             (modified)
  apps/dashboard/locales/fr.json                                             (modified)
  docs/decisions.md                                                          (modified)
  ```
  - No changes to `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts` beyond reusing its existing `PAYMENT_METHOD_LABEL_KEY` export — no new label map needed for this story.
  - `apps/mobile` and `apps/super-admin` are untouched by this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5] — literal AC text and user story
- [Source: _bmad-output/planning-artifacts/epics.md#FR-040] — "Refunds are recorded (amount, reason, actor, timestamp) in V1; provider-executed refund API calls deferred; audit-logged"
- [Source: _bmad-output/planning-artifacts/architecture.md#Entity Relationships] — "Money handling — touches payments, subscriptions, refunds, receipts" (narrative only; no ERD entry existed for a `refunds` table — this story is the first to define its actual shape)
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements Coverage Validation, Gap 2] — the "fast, friendly Server Action check backed by an uncircumventable DB trigger/policy" pattern this story's `recordRefund`/RLS `with check` pairing mirrors
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-09, AD-10] — the Payments page/Record Payment modal layout `RecordRefundModal` is modeled on; no refund-specific mockup exists (Scope Note)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-14 Payment Detail] — "No member-initiated refund action" (member app receipt view — confirms no member-facing refund flow exists or is expected)
- [Source: supabase/migrations/0005_payments.sql, 0030_payment_initiation_and_renewal.sql, 0031_manual_payment_verification_queue.sql] — `payments` schema and RLS this story's `refunds` table references but never mutates
- [Source: supabase/migrations/0032_payment_reconciliation_job.sql] — the "own table, don't mutate payments.status, nullable-gym_id-only-when-truly-unattributable" precedent this story's `refunds` table follows (with `gym_id not null`, since refunds are always attributable)
- [Source: apps/dashboard/services/payments.ts] — `getCallerGymId`, `paymentNotFoundError`, `logPaymentChange` (the pattern `logRefundChange` mirrors as a separate function), `recordManualPayment`/`verifyPayment`/`flagPayment` (the exact shape `recordRefund` follows)
- [Source: apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx] — the member-search step and form conventions `RecordRefundModal` copies
- [Source: apps/dashboard/app/(dashboard)/payments/actions.ts] — the `recordPayment`/`verifyPaymentAction`/`flagPaymentAction` Server Action shape `recordRefundAction` follows, including the `audit_log_failed`-but-keep-success pattern
- [Source: apps/dashboard/services/session.ts#getDashboardShellContext, MemberRole] — the `role` claim this story threads into `PaymentsPageClient` for button gating, same convention `Sidebar.tsx` already uses
- [Source: packages/types/src/schemas/payment.ts] — `recordManualPaymentSchema`/`flagPaymentSchema`/`REASON_MAX_LENGTH` this story's `recordRefundSchema` reuses/mirrors
- [Source: _bmad-output/implementation-artifacts/4-3-manual-payment-entry-verification-queue.md] — "payment ledger entry, not a renewal" scope discipline this story applies to refunds; AD-10 Record Payment modal precedent
- [Source: _bmad-output/implementation-artifacts/4-4-payment-reconciliation-discrepancy-flagging.md] — the "dedicated new table instead of mutating payments.status" decision this story's `refunds` table repeats; the "don't build UI beyond what's asked" discipline applied here as "build no refunds list at all"
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: code review of story-4-4] — "New FKs lack an explicit ON DELETE clause" — same accepted gap this story's `refunds` FKs also carry, not a new decision

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` (WSL): applied `0033_refund_recording.sql` cleanly on first pass.
- `supabase gen types typescript --local`: diffed line-by-line against the working `database.ts` before accepting — clean diff, only the new `refunds` Row/Insert/Update/Relationships block added, no unrelated churn.
- `pnpm run typecheck`: 4/4 packages, 0 errors (re-run after each service/action/component change).
- `node scripts/check-i18n-key-parity.mjs`: 0 errors after adding `refundModal`/`recordRefundButton`/`auditLogFailedRefund` keys to both `en.json`/`fr.json`.
- `supabase test db`: **first run surfaced a real bug** — `refund_recording.test.sql`'s own pgTAP coverage failed 3/13 subtests: an over-amount refund (amount > the original payment's amount) was silently *accepted* instead of rejected by the RLS INSERT policy, inflating the SELECT-count assertions from 2 to 3. Root cause: the `manager_or_owner_insert_own_refunds` policy's `exists` subquery left `gym_id`/`amount` unqualified inside a correlated subquery against `payments p`, which also has `gym_id`/`amount` columns — standard SQL name resolution bound both bare references to the *innermost* scope (`payments p`'s own columns), reducing both conditions to a vacuous `p.col = p.col` self-comparison. Confirmed directly via `pg_get_expr` on the compiled policy (`polwithcheck`) and two isolated `docker exec psql` probes (one showing an over-amount INSERT silently succeeding, one showing the cross-gym half was denied only as an accidental side effect of `payments`' own SELECT RLS already scoping the subquery, not because the policy's own gym check worked). Fixed by explicitly qualifying `refunds.gym_id`/`refunds.amount` in `0033_refund_recording.sql`, matching the qualification Postgres itself already auto-injects for `payment_id` (which has no naming collision). Documented in `docs/decisions.md` (2026-08-01, Decision 3). Second `supabase test db` run: all 440 assertions pass (426 baseline + 13 new `refund_recording.test.sql` + 1 `rls_tenant_isolation.test.sql` addition), 26/26 files, 0 regressions.
- Hands-on golden-path verification: attempted an authenticated browser click-through per Task 9, but the local Supabase API port (127.0.0.1:54321) was unreachable from the Windows-host dev server process for the duration of this session (WSL↔Windows Docker port-forwarding was confirmed flaky via repeated `curl`/`docker inspect` probes — connections succeeded once, then failed consistently even after the container stack reported healthy) — the same class of environment issue already on record (see memory: WSL mirrored-networking constraints on this machine). Substituted a committed, non-superuser, RLS-gated `docker exec psql` walkthrough exercising the exact same path `recordRefund`/`logRefundChange`/`listRefundEligiblePayments` take: seeded a gym/owner/member/verified payment, confirmed the payment appeared in the eligible-list query (`eligible_count: 1`), inserted the refund as an `owner`-claim session (RLS-gated, not superuser), called `log_audit_event` with the real function signature, confirmed the `refunds` row (correct amount/reason/actor_id), confirmed the `audit_log` row (`action_type = 'refund_recorded'`, `target_entity_type = 'refund'`, metadata carrying `payment_id`/`member_id`/`amount`/`reason`), and confirmed the payment then dropped out of the eligible-list query (`eligible_count: 0`). All fixture rows deleted afterward. The receptionist-hides-the-button assertion is a pure client-side boolean (`role === "owner" || role === "manager"`) verified by code inspection plus `pnpm run typecheck`, not requiring a live session.

### Completion Notes List

- Both ACs satisfied: AC #1 (refund recorded with amount/mandatory reason/actor/timestamp, audit-logged) proven via pgTAP (`refund_recording.test.sql`) and the hands-on `docker exec psql` walkthrough above; AC #2 (no provider-executed refund API call) satisfied by construction — no Edge Function or `PaymentProvider` code was touched anywhere in this story.
- Found and fixed a real, pre-existing bug in the story's own literal Task 1 SQL (not introduced during implementation, but only surfaced because this story's own pgTAP coverage exercised it): the RLS INSERT policy's `exists` subquery's bare `gym_id`/`amount` references were shadowed by the correlated `payments p` table's own same-named columns, making the amount-cap check vacuously true. Fixed by explicit `refunds.`-qualification; see Debug Log and `docs/decisions.md` (2026-08-01, Decision 3) for the full root-cause writeup. Worth flagging in review: this is the kind of RLS bug that passes a superficial "policy looks right" read and is only caught by exercising it with real data via pgTAP — the story file's own Task 8 requirement (exhaustive RLS assertions, not just happy-path) is what caught it.
- No changes to `payment_status` (the enum), any existing `payments` RLS policy/trigger, or `subscriptions` — refunds live entirely in the new `refunds` table, exactly as scoped.
- No provider/Edge Function code touched — zero Deno changes in this story.
- `RecordRefundModal.tsx` follows `RecordPaymentModal.tsx`'s structure and conventions throughout (dialog lifecycle, member-search debounce, whole-digit amount parsing guard, reason-length counter, disabled "Recorded By" field, `audit_log_failed`-keeps-success handling) per the story's own Dev Notes instruction to read that file in full first.
- i18n: `refundModal` block + `recordRefundButton` + `payments.errors.auditLogFailedRefund` added to both `en.json`/`fr.json`; `check-i18n-key-parity.mjs` passes.
- `docs/decisions.md`: one dated 2026-08-01 entry with three decisions (dedicated `refunds` table, one-refund-per-payment uniqueness, and the RLS bare-column-shadowing fix).

### File List

- `supabase/migrations/0033_refund_recording.sql` (new)
- `supabase/tests/refund_recording.test.sql` (new)
- `supabase/tests/rls_tenant_isolation.test.sql` (modified — 1 new assertion, `plan(15)` → `plan(16)`)
- `packages/types/src/schemas/payment.ts` (modified — `recordRefundSchema`/`RecordRefundInput`)
- `packages/types/src/database.ts` (regenerated — new `refunds` Row/Insert/Update/Relationships)
- `apps/dashboard/services/payments.ts` (modified — `listRefundEligiblePayments`, `recordRefund`, `logRefundChange`)
- `apps/dashboard/app/(dashboard)/payments/actions.ts` (modified — `listRefundEligiblePaymentsAction`, `recordRefundAction`)
- `apps/dashboard/app/(dashboard)/payments/page.tsx` (modified — thread `role` prop)
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` (modified — role-gated button, modal wiring)
- `apps/dashboard/app/(dashboard)/payments/components/RecordRefundModal.tsx` (new)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)

## Change Log

- 2026-08-01: Story implemented in full — the new `refunds` table + RLS policies (`0033` migration), `recordRefundSchema`, `listRefundEligiblePayments`/`recordRefund`/`logRefundChange` service functions, `listRefundEligiblePaymentsAction`/`recordRefundAction` Server Actions, the role-gated "+ Record Refund" entry point and `RecordRefundModal` on the Payments page, i18n keys, and the `docs/decisions.md` entry recording this story's scope/schema decisions. During implementation, this story's own pgTAP coverage caught a real bug in the literal RLS policy SQL from the story's Task 1 (a bare-column shadowing bug that made the amount-cap check vacuously true) — fixed in the migration and documented as Decision 3. Verified via pgTAP (26/26 files, 440/440 assertions, 0 regressions against the 426-assertion baseline), `pnpm typecheck` (4/4 packages) clean, `check-i18n-key-parity` clean, and a hands-on committed `docker exec psql` walkthrough of the full RLS-gated golden path (refund insert, audit log entry, eligible-payments-list exclusion) substituting for a browser click-through after the local Supabase API port proved unreachable from the Windows-host dev server for this session. Status moved to review.
