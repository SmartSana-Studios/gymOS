---
baseline_commit: 6a74be25ca514d5deafc2a6aac1c0d6b236b89d9
---

# Story 4.3: Manual Payment Entry & Verification Queue

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Receptionist or Manager,
I want to record cash, bank transfer, or manual mobile-money payments and have them verified,
so that non-automated payment methods are captured with a clear audit trail.

## Scope Note — Read Before the Acceptance Criteria

**This story is a payment *ledger* entry, not a renewal.** Unlike Story 3.2's `renew_subscription()` (manual override that resets a subscription to `active`) or Story 4.2's `initiatePayment`/`complete_verified_payment()` (automated charge that *does* renew the subscription on success), nothing in epics.md's literal Story 4.3 ACs or FR-037/FR-038 mentions a plan, a subscription, or an expiry date. Recording a manual payment here only ever inserts a `payments` row and (on verify/flag) updates its `status` — it never touches `subscriptions`, never sets `payments.subscription_id`, and never calls `renew_subscription()`. The UI trigger for "collect a manual payment **and** renew" is the Inline Renewal Panel (AD-16, Story 4.7 — not yet built), which epics.md/Story 4.2's own Dev Notes already earmark as the consumer of `renewSubscription()`. Do not conflate the two flows or add a renewal side effect to this story — that is exactly the kind of scope creep Story 4.2's own Review Findings deferred to later stories.

**AD-10's mockup shows an editable "Date" field; epics.md's AC #1 and FR-038 do not.** AD-10 (`EXPERIENCE.md`) shows `Date * [04 Jul 2026 (today), cannot be a future date]` as a submitted field. But epics.md's literal Story 4.3 AC #1 lists exactly four submitted inputs — "method, amount, member, and a mandatory reason/note" — and FR-038 is explicit: "auto-populated actor, mandatory reason, and **auto-populated timestamp** — none optional." There is also no `payment_date` column on `payments` (`0005_payments.sql` has only `created_at timestamptz not null default now()`). **Resolution: no editable Date field. `created_at` is set by the database default at INSERT time, exactly like every other row in this table.** Do not add a `payment_date` column or a date input to satisfy AD-10's mockup — epics.md's AC text is the authoritative source here, the same precedence Story 4.2 applied to its own Notch-Pay-vs-TaraMoney conflict. Record this resolution in `docs/decisions.md` during dev-story.

**AD-09's "All Payments" ledger table (filters, 50-rows/page, CSV export, discrepancy highlighting) is out of scope for this story.** No FR or AC for Story 4.3 requires it — FR-067 ("Payments verification queue shows unverified manual payments...") is the only Payments-page FR mapped to Epic 4 in the FR Coverage Map, and it describes the queue only. Discrepancy amber-highlighting is explicitly Story 4.4's reconciliation-job output (FR-036) — there are no discrepancies to show before that job exists. Build only AD-09's **Verification Queue** section (the top half of the mockup) plus the "+ Record Payment" entry point; do not build the "All Payments" table, its filters, or CSV export. This mirrors Story 3.10's precedent of shipping a scoped placeholder rather than a full-featured page ahead of its owning story.

**`payments.status` has 4 values: `pending, processing, verified, flagged`.** Story 4.2 already established that `processing` is the *automated*-payment-in-flight state (Notch Pay/TaraMoney webhook not yet received) — manual payments never use it. `pending` is the value this story introduces real usage for: "awaiting manual verification." This story's queue (`gym_staff_verify_own_payments` policy below) only ever selects `status = 'pending'` rows — a stuck `processing` row (automated payment whose webhook never arrived) is invisible to this queue and stays Story 4.4's problem to surface.

**Out of scope, explicitly (do not build):** subscription/renewal side effects (see above), the "All Payments" ledger table/CSV export/date-range filters (see above), reconciliation/discrepancy flagging (Story 4.4 — a *different* meaning of "flagged" than this story's manual "Flag for Review," which happen to share the same enum value by design), refunds (4.5), the front-desk alert (4.6), the Inline Renewal Panel (4.7), the Subscriptions page (4.8), member-facing receipt/payment-history viewing (4.9).

## Acceptance Criteria

1. **Given** the Record Payment form, **when** I submit method, amount, member, and a mandatory reason/note, **then** the payment is recorded with an auto-populated actor and timestamp, and appears in the Verification Queue. [Source: epics.md#Story 4.3 AC#1; FR-038]
2. **Given** the Verification Queue, **when** I view it, **then** unverified payments are ordered by submission time, each showing member, amount, method, submitting receptionist, and reason note. [Source: epics.md#Story 4.3 AC#2; FR-037]
3. **Given** a queued manual payment, **when** a Receptionist or Manager marks it Verified or flags it for review, **then** the queue count updates and the payment's status reflects the action. [Source: epics.md#Story 4.3 AC#3; FR-037]
4. **Given** a manual payment entry or a verification action, **when** either occurs, **then** it is written to the audit log with actor, amount, method, reason, and timestamp. [Source: epics.md#Story 4.3 AC#4; FR-080]

**Role note:** epics.md's story statement and FR-037's literal text name "Receptionist or Manager." This story extends that to also include **Owner**, consistent with FR-064's "Payments (Receptionist+)" access convention already applied to every other Payments-adjacent capability in this codebase (Story 4.2's `gym_staff_read_own_payments`/`gym_staff_insert_own_payments` both include owner/manager/receptionist, excluding only coach). Coach is excluded from all payment visibility, matching Story 4.2's explicit precedent (no AC or FR gives Coach any payment access).

## Tasks / Subtasks

- [x] **Task 1: New migration — the verification-queue UPDATE policy, and tightening the existing INSERT policy** (AC: #3)
  - [x] New file `supabase/migrations/0031_manual_payment_verification_queue.sql`.
  - [x] No new columns needed. `payments.reason` (nullable text, `0005_payments.sql`) already exists and is exactly where the mandatory Record Payment note goes; `actor_id` (nullable uuid → `users`) already exists for the auto-populated actor; `subscription_id`/`provider`/`provider_transaction_ref`/`provider_fee_amount` all stay `null` for every row this story writes (Scope Note).
  - [x] `create policy "gym_staff_verify_own_payments" on payments for update using (gym_id = private.gym_id() and status = 'pending' and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])) with check (gym_id = private.gym_id() and status = any(array['verified', 'flagged']::payment_status[]) and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist']));` — this is the "Story 4.3's manual verification queue will need its own staff-facing UPDATE policy later" gap `0030`'s own comment left open. The `using` clause's `status = 'pending'` is what scopes this policy to manual payments only (an automated `processing` row is invisible to it, correctly deferring stuck-`processing` handling to Story 4.4) and prevents re-verifying/re-flagging an already-`verified`/`flagged` row. The `with check`'s `status = any(array['verified','flagged'])` prevents a staff UPDATE from setting any other status value. (Implementation note: the array literal needed an explicit `::payment_status[]` cast — Postgres infers an untyped `array[...]` literal as `text[]`, and `payment_status = text` has no operator; first `supabase db reset` failed with exactly that error until both new/modified policies added the cast.)
  - [x] Defense-in-depth: `0030`'s `gym_staff_insert_own_payments` policy has no `status` constraint in its `with check` at all — a gym-staff session could currently `INSERT` a payment row directly with `status = 'verified'`, bypassing the queue entirely. Since `0030` already shipped and was reviewed, don't edit it — `drop policy "gym_staff_insert_own_payments" on payments;` then recreate it with an added `status = any(array['pending', 'processing']::payment_status[])` check (both this story's manual-payment `pending` insert and Story 4.2's automated-payment `processing` insert stay allowed; `verified`/`flagged` become impossible to insert directly, only reachable via `complete_verified_payment()`'s `service_role` path or this story's new UPDATE policy).
  - [x] Record Decision 1 (the AD-10-editable-Date-field vs. epics.md/FR-038 resolution) and Decision 2 (the INSERT-policy tightening and why it's safe alongside Story 4.2's existing insert path) in `docs/decisions.md`.

- [x] **Task 2: `apps/dashboard/services/payments.ts` — extend with manual-payment functions** (AC: #1, #2, #3, #4)
  - [x] Reuses this file's existing `getCallerGymId()` helper (already present from Story 4.2) — do not duplicate it again.
  - [x] `recordManualPayment(input: RecordManualPaymentInput): Promise<{ data: { id: string } | null; error: AppError | null }>` — validates via `recordManualPaymentSchema` (Task 4), resolves `gymId`, inserts `{ gym_id, member_id, amount, currency: "XAF", method, status: "pending", actor_id: (await supabase.auth.getClaims()).data?.claims.sub ?? null, reason }`. Note: `actor_id` needs the caller's own `auth.uid()`, not `gym_id` — read it from the same `getClaims()` call `getCallerGymId` already makes, or a second `supabase.auth.getUser()`/`getClaims()` call; either way, never trust a client-supplied actor id (mirrors `log_audit_event`'s own actor-derivation discipline, Story 1.4).
  - [x] `listPendingPayments(): Promise<{ data: PendingPaymentRow[] | null; error: AppError | null }>` — deviates from the literal `users!payments_actor_id_fkey(display_name)` embed suggested in this task's own text: confirmed the FK name is correct (`payments_actor_id_fkey`, via `database.ts`), but also confirmed `users.display_name` is dead data for every staff (owner/manager/receptionist) account — it is only ever written by the mobile app's member self-service profile flow (Story 2.6/2.8; see `services/session.ts`'s own "members.name is used instead of the never-populated users.display_name" precedent). Embedding through it would render the submitting-receptionist column blank for virtually every real payment. Resolved instead via a second, batched `members` query (`user_id in (actorIds)`, scoped to the same gym) to get the real display name, consistent with this codebase's own established `members.name`-is-the-real-name discipline. `.eq("gym_id", gymId).eq("status", "pending").order("created_at", { ascending: true })` — AC #2's "ordered by submission time" read as FIFO. No pagination — out of scope (Scope Note), and a pilot-scale gym's pending-queue depth is small (NFR-009: ~30 members/gym).
  - [x] `verifyPayment(paymentId: string): Promise<{ error: AppError | null }>` — `.update({ status: "verified" }).eq("gym_id", gymId).eq("id", paymentId).select("id").maybeSingle()`; `0` rows back (RLS-denied — not pending, wrong gym, or non-staff role) maps to a `paymentNotFoundError()` helper mirroring `members.ts`'s `memberNotFoundError()`.
  - [x] `flagPayment(paymentId: string): Promise<{ error: AppError | null }>` — same UPDATE shape with `status: "flagged"`. The flag reason is **not** stored on the `payments` row (that column already holds the *original* Record Payment note, FR-038) — it lives in the audit log metadata only (written by `flagPaymentAction` in Task 3), mirroring `deactivateMember`'s established "reason lives in audit_log metadata, not a table column" precedent (`members.ts`).
  - [x] `searchMembersForPayment(query: string): Promise<{ data: { id: string; name: string; phone: string | null }[] | null; error: AppError | null }>` — copied `members.ts`'s `escapeIlike()` verbatim into this file (per-file-copy convention). Empty/blank query returns an empty array without querying (AD-10: "must select from results").
  - [x] `logPaymentChange(actionType: "manual_payment_recorded" | "payment_verified" | "payment_flagged", paymentId: string, metadata: Record<string, unknown>): Promise<{ error: AppError | null }>` — thin `log_audit_event` wrapper, copies `logMemberChange`'s exact shape (`p_target_entity_type: "payment"`).

- [x] **Task 3: `apps/dashboard/app/(dashboard)/payments/actions.ts` — Server Actions** (AC: #1, #3, #4)
  - [x] `recordPayment(input: unknown)`: `recordManualPaymentSchema.safeParse` → `recordManualPayment` → on success, `logPaymentChange("manual_payment_recorded", id, { member_id, amount, method, reason })`. Same `audit_log_failed`-code-means-"saved but log the warning" pattern as `createMember`/`deactivateMember` — the payment row is not rolled back if only the audit write fails.
  - [x] `verifyPaymentAction(paymentId: string, context: { memberId: string; amount: number; method: string; reason: string | null })`: calls `verifyPayment(paymentId)`, then `logPaymentChange("payment_verified", paymentId, { member_id: context.memberId, amount: context.amount, method: context.method, reason: context.reason })`. The client passes the row's own already-known fields as `context` (no extra read needed server-side).
  - [x] `flagPaymentAction(paymentId: string, flagReason: unknown, context: { memberId: string; amount: number; method: string })`: `flagPaymentSchema.safeParse(flagReason)` → `flagPayment(paymentId)` → `logPaymentChange("payment_flagged", paymentId, { member_id: context.memberId, amount: context.amount, method: context.method, flag_reason: parsed.data.reason })`.
  - [x] `searchMembersForPaymentAction(query: string)`: thin wrapper over `searchMembersForPayment` — no schema needed.

- [x] **Task 4: `packages/types` — new schemas** (AC: #1, #3)
  - [x] In `packages/types/src/schemas/payment.ts` (already existed from Story 4.2 — extended in place):
    - `recordManualPaymentSchema = z.object({ memberId: z.uuid("Select a member"), method: z.enum(["cash", "bank_transfer", "manual_momo"]), amount: z.number().int().positive().max(10_000_000, "Enter a valid amount"), reason: z.string().trim().min(10, "Add a note (at least 10 characters)") })`.
    - `flagPaymentSchema = z.object({ reason: z.string().trim().min(5, "Add a reason describing this flag") })`.
    - Both types exported (`RecordManualPaymentInput`, `FlagPaymentInput`) the same way `InitiatePaymentInput` already is. Already re-exported by `packages/types/src/index.ts`'s existing `export * from "./schemas/payment"` — no index.ts change needed.
  - [x] No `database.ts` regeneration needed — no schema change beyond RLS policies.

- [x] **Task 5: Payments page UI** (AC: #1, #2, #3)
  - [x] `apps/dashboard/app/(dashboard)/payments/page.tsx` — Server Component + explicit `<Suspense>`, `Promise.all([listPendingPayments(), getDashboardShellContext()])`, renders `<PaymentsPageClient pendingPayments={...} recordedByName={shell.memberName} />` on success, `common.loadError` on any error.
  - [x] `apps/dashboard/app/(dashboard)/payments/loading.tsx` — skeleton matching `attendance/loading.tsx`'s pattern.
  - [x] `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts` — status badge config for `pending`/`verified`/`flagged` (pending: Clock/orange, verified: CheckCircle2/green, flagged: AlertTriangle/red) plus a `PAYMENT_METHOD_LABEL_KEY` map for the table's method column.
  - [x] `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` — "Payments" heading + "+ Record Payment" button + Verification Queue table (member, amount with thousands separator, method label, submitting actor's name, reason, status badge, Verify/Flag buttons). Empty state: `t("payments.emptyQueue")`. No pagination, no filters.
  - [x] `apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx` — AD-10's modal (max-width 480px): Member (custom type-to-filter combobox, 300ms debounce, plain controlled state + Tailwind), Payment Method (`<select>`, 3 options), Amount (`<Input type="number">`), Reason/Note (`<textarea>` with live "N / min 10" count), no Date field, Recorded By read-only. `recordManualPaymentSchema.safeParse` client-side → `recordPayment` action → close + refresh on success, matching `MemberModal`'s error-handling shape including the `audit_log_failed`-still-succeeds branch.
  - [x] `apps/dashboard/app/(dashboard)/payments/components/VerifyPaymentConfirmDialog.tsx` — mirrors `CheckOutMemberConfirmDialog.tsx` (no reason field, plain confirm, title names the specific target/amount).
  - [x] `apps/dashboard/app/(dashboard)/payments/components/FlagPaymentDialog.tsx` — mirrors `DeactivateMemberDialog.tsx` (mandatory reason ≥5 chars, submit disabled until met, destructive variant).
  - [x] Wired `router.refresh()` (via `useTransition`) after any successful record/verify/flag action.

- [x] **Task 6: i18n — EN/FR locale keys** (AC: all — CI's key-parity gate, Story 1.10)
  - [x] `apps/dashboard/locales/en.json`/`fr.json`: new top-level `"payments"` object — page title, `emptyQueue`, table column headers, status labels, method labels, `recordPaymentButton`, `verifyButton`/`flagButton`, modal strings (title/member/memberPlaceholder/method/methodOptions/amount/reason/reasonCount/recordedBy/recordButton/recording + field-error keys), `verifyDialog`/`flagDialog` strings, and `errors.*`.
  - [x] Verified via `node scripts/check-i18n-key-parity.mjs` — `apps/dashboard/locales: 298 keys, en/fr in parity` (passing, along with the other 3 locale directories).
  - [x] Added dedicated `payments.errors.paymentNotFound` key (follows `members.errors.memberNotFound`'s precedent) plus per-action `auditLogFailedRecord`/`auditLogFailedVerify`/`auditLogFailedFlag` keys (follows `members.errors.auditLogFailedCreate`/etc.'s precedent, one per mutating action rather than one shared key).

- [x] **Task 7: pgTAP coverage** (AC: #3)
  - [x] New file `supabase/tests/manual_payment_verification_queue.test.sql` (17 assertions), mirroring `payments_rls_and_renewal.test.sql`'s session-simulation conventions.
  - [x] `gym_staff_verify_own_payments`: owner/manager/receptionist can UPDATE a `pending` row in their own gym to `verified`/`flagged`; 0 rows affected for another gym's `pending` row; 0 rows affected for a coach/member session; 0 rows affected attempting to UPDATE an already-`verified` row again (idempotency).
  - [x] `with check` rejects an UPDATE attempting to set `status` back to `pending` or to `processing` (`throws_like '%row-level security%'`).
  - [x] Tightened `gym_staff_insert_own_payments`: a receptionist INSERT with `status = 'pending'` succeeds; `status = 'processing'` still succeeds (regression guard); `status = 'verified'`/`'flagged'` rejected.
  - [x] A `pending` row belonging to another gym stays invisible to a cross-gym session's SELECT.
  - [x] Full suite run: `supabase test db` — **all 24 test files pass, 405 total assertions, Result: PASS** (confirmed no regressions in `payments_rls_and_renewal.test.sql` or any other existing file).

- [x] **Task 8: Record decisions** (AC: all)
  - [x] `docs/decisions.md`, dated 2026-07-31 entry covering both of Task 1's decisions plus the enum-array-cast implementation note.

### Review Findings

- [x] [Review][Patch] Audit log trusts client-supplied `context` instead of re-reading the payment row server-side [apps/dashboard/app/(dashboard)/payments/actions.ts] — fixed: `verifyPayment`/`flagPayment` (`apps/dashboard/services/payments.ts`) now `.select("member_id, amount, method, reason")` on the same UPDATE and return it as `VerifiedPaymentInfo`; `verifyPaymentAction`/`flagPaymentAction` use that authoritative data for the audit log instead of a client-supplied `context` argument, which was removed from both actions' signatures (and from the `VerifyPaymentConfirmDialog`/`FlagPaymentDialog` call sites).
- [x] [Review][Patch] `audit_log_failed` warning is silently dropped in the UI [apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx, RecordPaymentModal.tsx, VerifyPaymentConfirmDialog.tsx, FlagPaymentDialog.tsx] — fixed: added `PaymentsPageClient`'s own `showToast` (mirrors `MembersPageClient`'s established toast pattern); `VerifyPaymentConfirmDialog`/`FlagPaymentDialog`'s `onDone` now takes `(warning?: string)` and passes `actionError.message` through on `audit_log_failed` (matching `DeactivateMemberDialog`'s exact precedent) instead of swallowing it; all three `onSaved`/`onDone` call sites in `PaymentsPageClient` now call `showToast(warning)` when present.
- [x] [Review][Patch] ~~`escapeIlike()` doesn't escape comma/parenthesis~~ — **investigated, no change needed.** `searchMembersForPayment`'s `.or()` value is wrapped in double quotes (`"%${escaped}%"`), and per `members.ts`'s own `escapeIlike` comment, PostgREST's quoted-value syntax already neutralizes commas/parentheses inside a quoted value without needing to escape them individually — only `\`, `%`, `_`, and `"` itself need escaping, which the existing (and this file's identically-copied) implementation already does. This finding was a false positive from both adversarial layers missing that documented rationale; restored the fuller explanatory comment (previously trimmed to "copied verbatim") so it isn't rediscovered from scratch next time.
- [x] [Review][Patch] Amount parsed via `Number.parseInt` before Zod validation silently truncates decimals [apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx] — fixed: only a plain whole-digit string (`/^\d+$/`) now parses to a number; anything else (a decimal, scientific notation, a sign) becomes `NaN`, which the schema's `z.number()` check rejects with a real field error instead of silently truncating or misparsing.
- [x] [Review][Patch] `recordManualPaymentSchema`/`flagPaymentSchema`'s `reason` field has only a `.min()` bound, no `.max()` [packages/types/src/schemas/payment.ts] — fixed: added `REASON_MAX_LENGTH = 200` (mirrors `subscription.ts`'s own precedent) and `.max(REASON_MAX_LENGTH, "Reason is too long")` to both schemas.
- [x] [Review][Patch] Member search debounce has no abort/sequencing guard [apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx] — fixed: the debounce effect now tracks an `active` flag, cleared on cleanup, so a stale response from a superseded keystroke no longer overwrites fresher results.
- [x] [Review][Patch] `gym_staff_verify_own_payments`'s `with check` doesn't restrict `amount`/`member_id`/`method`/`reason` during the verify/flag transition [supabase/migrations/0031_manual_payment_verification_queue.sql] — fixed, but **not** via the column-level `grant update (status)` first suggested here: `0014_gym_settings_owner_access.sql`'s own comment already establishes that column-level GRANTs can't scope by `app_role` (every role shares the same `authenticated` Postgres role) and uses a BEFORE UPDATE trigger instead. Added `private.protect_payment_columns_on_staff_verify()` (same migration file), a BEFORE UPDATE trigger on `payments` that pins every column except `status` back to its current value whenever `old.status = 'pending'` and the caller has a staff `app_role` — i.e. exactly the `gym_staff_verify_own_payments` policy's own conditions. `complete_verified_payment()` (service_role, `old.status = 'processing'`, no `app_role` claim in that context) is untouched.
- [x] [Review][Patch] `useTransition`'s `isPending` is discarded [apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx] — fixed: `isPending` is now kept as `isRefreshing` and passed to the Verify/Flag buttons' `disabled` prop, so a user can no longer act twice on a still-stale row while `router.refresh()` is in flight.
- [x] [Review][Patch] `getCallerGymId`'s warning log hardcodes `"initiatePayment"` [apps/dashboard/services/payments.ts:215] — fixed: the log message now names the helper itself (`getCallerGymId`), not the specific caller.
- [x] [Review][Patch] `recordManualPayment` calls `supabase.auth.getClaims()` twice [apps/dashboard/services/payments.ts] — fixed: `getCallerGymId` now reads and returns `actorId` (the claims' `sub`) alongside `gymId` from its single existing `getClaims()` call; `recordManualPayment` uses that instead of a second call.
- [x] [Review][Defer] `initiatePayment` (Story 4.2, untouched by this diff) can leave an orphaned `processing` row on a network failure between the INSERT and `functions.invoke()` [apps/dashboard/services/payments.ts] — deferred, pre-existing Story 4.2 gap; the docstring's claim that "the row is already deleted by the initiate route itself" only covers a returned error, not a client-side network failure before the call ever lands.
- [x] [Review][Defer] `gym_staff_insert_own_payments`'s `with check` doesn't validate `amount > 0` or method/status coherence [supabase/migrations/0031_manual_payment_verification_queue.sql] — deferred, consistent with this same diff's own `deferred-work.md` precedent (INSERT policy not verifying `member_id` belongs to `gym_id`) of relying on the service layer/Zod schema rather than duplicating validation in RLS.
- [x] [Review][Defer] `/payments` page shell renders for Coach before RLS blocks data [apps/dashboard/app/(dashboard)/payments/page.tsx] — deferred, pre-existing app-wide convention; `page.tsx`'s own comment notes the Sidebar hides the nav entry and RLS is "the real gate," matching every other role-restricted page in this codebase (no client-side route guards exist anywhere).

## Dev Notes

- **Read `apps/dashboard/services/payments.ts` and `packages/types/src/schemas/payment.ts` in full before starting** — both already exist (Story 4.2) and this story extends them in place. Do not create parallel `payments2.ts`/second schema files. The existing `getCallerGymId()` helper in `payments.ts` is reused verbatim by every new function in Task 2.
- **`payments` table has never had gym-staff UPDATE access until this story.** `0030` (Story 4.2) deliberately left this open with the exact comment this story now resolves: "Story 4.3's manual verification queue will need its own staff-facing UPDATE policy later — do not add it here, that's scope creep." Task 1 is that policy.
- **Two independent things share the enum value `'flagged'`:** this story's manual "Flag for Review" (a human reviewer's judgment call on a specific queued payment) and Story 4.4's future reconciliation-job discrepancy flagging (an automated nightly job's finding on a *different* kind of problem — provider/internal mismatch). They reuse the same `payment_status` value by schema design but are conceptually distinct actions from distinct triggers; this story only ever sets it via the human "Flag for Review" button.
- **Money handling (FR-026/NFR-003):** `amount` is an integer XAF value, exactly like every other monetary field in this schema — the Zod schema's `z.number().int()` is the client-side guard, the column's existing `integer not null` type is the real one.
- **Testing standard:** pgTAP is the primary automated coverage (Task 7), matching every prior RLS-shaped story in this epic. No E2E/browser test exists for the dashboard in V1 (architecture.md, Testing requirements) — a manual click-through is worth doing but isn't a blocking AC.
- **No CI/typecheck gap here** — unlike Stories 4.1/4.2, this story touches no Edge Function (Deno) code; the existing `pnpm typecheck` gate fully covers everything this story adds.

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0031_manual_payment_verification_queue.sql   (new)
  supabase/tests/manual_payment_verification_queue.test.sql        (new)
  apps/dashboard/services/payments.ts                              (modified — extended, not replaced)
  packages/types/src/schemas/payment.ts                            (modified — extended, not replaced)
  apps/dashboard/app/(dashboard)/payments/page.tsx                 (new)
  apps/dashboard/app/(dashboard)/payments/loading.tsx               (new)
  apps/dashboard/app/(dashboard)/payments/actions.ts                (new)
  apps/dashboard/app/(dashboard)/payments/paymentLabels.ts          (new)
  apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx      (new)
  apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx      (new)
  apps/dashboard/app/(dashboard)/payments/components/VerifyPaymentConfirmDialog.tsx (new)
  apps/dashboard/app/(dashboard)/payments/components/FlagPaymentDialog.tsx       (new)
  apps/dashboard/locales/en.json                                    (modified)
  apps/dashboard/locales/fr.json                                    (modified)
  docs/decisions.md                                                 (modified)
  ```
- The `/payments` route and its nav entry already exist structurally: `Sidebar.tsx`'s `NAV_ITEMS` already has `{ labelKey: "nav.payments", href: "/payments", icon: Wallet, roles: ["receptionist", "manager", "owner"] }` and `locales/{en,fr}.json` already has `nav.payments`. This story is the first to actually populate the route — there is no existing `payments/page.tsx` to conflict with or migrate away from.
- `apps/mobile` and `apps/super-admin` are untouched by this story.
- `packages/types/src/database.ts` is **not** regenerated in this story (no table/function signature changes, only RLS policies, which `supabase gen types typescript` doesn't reflect).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — literal AC text
- [Source: _bmad-output/planning-artifacts/epics.md#FR-033, FR-037, FR-038, FR-080] — payment methods, verification queue, mandatory manual-entry fields, audit record requirements
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-09, AD-10] — Payments page + Record Payment modal mockups (Verification Queue section is in scope; "All Payments" ledger table is not — Scope Note)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Field Validation — AD-10 Manual Payment Entry table] — exact field rules (amount ≤10,000,000, reason ≥10 chars, member must be selected from dropdown)
- [Source: supabase/migrations/0005_payments.sql] — `payments` table shape (`reason`, `actor_id`, `status` columns already exist and are reused as-is)
- [Source: supabase/migrations/0001_extensions_and_enums.sql#payment_method, payment_status] — the 5-value `payment_method` enum (this story uses only `cash`/`bank_transfer`/`manual_momo`) and 4-value `payment_status` enum (this story uses `pending`→`verified`/`flagged`)
- [Source: supabase/migrations/0030_payment_initiation_and_renewal.sql] — the existing `gym_staff_read_own_payments`/`gym_staff_insert_own_payments` policies this story's new UPDATE policy sits alongside, and the exact comment marking this story's own scope
- [Source: supabase/migrations/0007_audit_log.sql#log_audit_event] — canonical audit-write path, actor-derivation discipline
- [Source: apps/dashboard/services/payments.ts, packages/types/src/schemas/payment.ts] — the exact files this story extends (Story 4.2)
- [Source: apps/dashboard/services/members.ts#getCallerGymId, escapeIlike, memberNotFoundError, deactivateMember, logMemberChange] — every pattern this story's new service functions copy
- [Source: apps/dashboard/app/(dashboard)/members/components/DeactivateMemberDialog.tsx, apps/dashboard/app/(dashboard)/attendance/components/CheckOutMemberConfirmDialog.tsx] — exact dialog patterns `FlagPaymentDialog`/`VerifyPaymentConfirmDialog` mirror
- [Source: apps/dashboard/app/(dashboard)/attendance/page.tsx, attendance/actions.ts, attendance/attendanceLabels.ts, attendance/components/AttendancePageClient.tsx] — exact page/actions/labels/client patterns this story's Payments-page files mirror (Suspense boundary, debounce constant, badge config shape)
- [Source: apps/dashboard/components/shared/Sidebar.tsx#NAV_ITEMS] — confirms `/payments` nav entry and role list already exist
- [Source: _bmad-output/implementation-artifacts/4-2-notch-pay-payment-integration.md] — direct precedent for `payments.ts`'s existing shape, the `processing`-status automated-payment path this story's tightened INSERT policy must not break, and the "no `actions.ts` yet" pattern this story finally adds an `actions.ts` for
- [Source: _bmad-output/implementation-artifacts/3-10-member-app-plan-details-check-in-history.md] — precedent for shipping a deliberately scoped placeholder rather than a full-featured page ahead of its owning story

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase db reset` initially failed on migration `0031` with `ERROR: operator does not exist: payment_status = text` — both new/modified RLS policies' `array[...]` literals needed an explicit `::payment_status[]` cast (Postgres infers an untyped array literal as `text[]`). Fixed in the migration file; re-ran clean.
- `supabase test db` (full suite, post-fix): `Files=24, Tests=405 ... Result: PASS` — includes this story's own 17-assertion `manual_payment_verification_queue.test.sql` and a clean re-run of every pre-existing test file (no regressions, notably `payments_rls_and_renewal.test.sql`).
- `pnpm typecheck` (all 4 packages): clean.
- `apps/dashboard` eslint: one initial `react-hooks/set-state-in-effect` error in `RecordPaymentModal.tsx` (calling `setMemberResults([])` synchronously in the debounce effect's early-return branch) — fixed by removing the synchronous clear and instead guarding the results-dropdown's render condition on `memberQuery.trim()`. Clean after the fix.
- `node scripts/check-i18n-key-parity.mjs`: clean (`apps/dashboard/locales: 298 keys, en/fr in parity`).
- Dev server smoke test: `GET /payments` unauthenticated returns `307 → /auth/login?next=%2Fpayments` (same layout-guard redirect as every other dashboard route) with no compile/runtime error in the Next.js dev log — confirms the new route builds and renders. No authenticated click-through was performed (no seeded staff test account was available locally); the story's own Dev Notes mark this non-blocking ("No E2E/browser test exists for the dashboard in V1 ... a manual click-through is worth doing but isn't a blocking AC").

### Completion Notes List

- Implemented the manual payment ledger entry + verification queue exactly per the story's Scope Note: no subscription/renewal side effect, no "All Payments" ledger table/CSV export, no reconciliation flagging — only the Verification Queue section of AD-09 plus the Record Payment modal (AD-10).
- **Deviation from the literal Task 2 text, discovered during implementation:** `listPendingPayments()` does not embed `users!payments_actor_id_fkey(display_name)` as the task's own text suggested, even though that FK name is correct. `users.display_name` is dead data for every staff (owner/manager/receptionist) account — it is only ever written by the mobile app's member self-service profile flow (Story 2.6/2.8), never by anything a dashboard staff account goes through (`services/session.ts`'s own "members.name is used instead of the never-populated users.display_name" comment already documents this for the dashboard shell). Embedding through `users.display_name` would have shipped a "submitting receptionist" column that reads blank for virtually every real payment. Resolved via a second, batched `members` query keyed on `actor_id` (a `users.id`) joined to `members.user_id`, scoped to the same gym — consistent with this codebase's own established discipline of using `members.name` as the real display name.
- All four migrations/policies verified against a real local Postgres via `supabase db reset` + `supabase test db`, not just read for plausibility — the enum-array-cast bug (see Debug Log) would not have surfaced without actually running it.
- `flagPayment`'s signature ended up as `(paymentId: string)` only (not `(paymentId, reason)` as Task 2's text sketched) — the reason never touches the `payments` row (FR-038: that column holds only the original Record Payment note), so `flagPaymentAction` (Task 3) passes the reason straight to `logPaymentChange`'s metadata instead of threading it through the service function.
- No changes to `apps/mobile` or `apps/super-admin` — untouched by this story, per Dev Notes.

### File List

- `supabase/migrations/0031_manual_payment_verification_queue.sql` (new)
- `supabase/tests/manual_payment_verification_queue.test.sql` (new)
- `apps/dashboard/services/payments.ts` (modified — extended)
- `packages/types/src/schemas/payment.ts` (modified — extended)
- `apps/dashboard/app/(dashboard)/payments/page.tsx` (new)
- `apps/dashboard/app/(dashboard)/payments/loading.tsx` (new)
- `apps/dashboard/app/(dashboard)/payments/actions.ts` (new)
- `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts` (new)
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` (new)
- `apps/dashboard/app/(dashboard)/payments/components/RecordPaymentModal.tsx` (new)
- `apps/dashboard/app/(dashboard)/payments/components/VerifyPaymentConfirmDialog.tsx` (new)
- `apps/dashboard/app/(dashboard)/payments/components/FlagPaymentDialog.tsx` (new)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)

## Change Log

- 2026-07-31: Story implemented in full — the manual payment ledger entry + Verification Queue (Record Payment modal, queue table, Verify/Flag actions), the `gym_staff_verify_own_payments` UPDATE policy, and the tightened `gym_staff_insert_own_payments` INSERT policy (`0031` migration). Verified via pgTAP (17 new assertions, full 24-file/405-assertion suite green), `pnpm typecheck`/`eslint` clean, and `check-i18n-key-parity` clean. Status moved to review.
- 2026-07-31: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) found 0 AC violations but 10 patchable issues, all fixed — see Review Findings above for detail. Highlights: `verifyPayment`/`flagPayment` now return the row's own authoritative fields for audit logging instead of trusting a client-supplied `context`; a `private.protect_payment_columns_on_staff_verify()` BEFORE UPDATE trigger (`0031` migration) closes the gap where `gym_staff_verify_own_payments`'s `with check` didn't restrict which columns a staff UPDATE could touch; `audit_log_failed` warnings are now surfaced via a toast instead of silently dropped; amount parsing, the reason field's missing `.max()`, the member-search debounce race, a misleading log message, and a redundant `getClaims()` call were also fixed. `pnpm typecheck`/`eslint` re-verified clean after fixes; the pgTAP suite (`supabase test db`, WSL) should be re-run to confirm the new trigger doesn't affect the existing 17 assertions (static review of the test file found no UPDATE statement that touches any column besides `status`, so no regression is expected). 3 pre-existing/out-of-scope findings deferred to `deferred-work.md`. Status moved to done.
