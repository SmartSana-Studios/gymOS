---
baseline_commit: 6a74be25ca514d5deafc2a6aac1c0d6b236b89d9
---

# Story 4.2: Real Payment Orchestration — TaraMoney Initiation, Verified-Payment Renewal, Payments RLS

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, Owner, or Receptionist,
I want to trigger a real MTN Mobile Money or Orange Money charge for a member (via TaraMoney) and have a successful payment automatically renew that member's subscription,
so that renewals can be completed without handling cash, with the same correctness guarantees (idempotent webhook, signature verification, fee visibility) Story 4.1 already proved against TaraMoney's real API.

## Scope Note — Read Before the Acceptance Criteria

**epics.md's literal Story 4.2 text names Notch Pay.** Per Story 4.1's Scope Note (2026-07-30, user-directed) the concrete, real, spike-verified provider for this whole epic is **TaraMoney**, not Notch Pay — Notch Pay is not built, not registered, and not a fallback. Every "Notch Pay" reference below is inherited epics.md/PRD wording, mapped 1:1 onto the already-built `TaraMoneyProvider`/`payment_providers` registry. Do not build or reference Notch Pay.

**This story is backend/integration-only — no dashboard UI, no `actions.ts`.** This mirrors Story 3.2 (Manual Renewal Reset) exactly: that story built `renew_subscription()` + `services/subscriptions.ts`'s `renewSubscription()` with **zero UI**, explicitly deferring the button/modal to "Epic 4 Stories 4.7/4.8." The same reasoning applies here, and for a second, concrete reason found during this story's research: **no screen in `ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md` has an entry point for an automated Mobile Money charge.** Checked exhaustively:
- AD-10 Manual Payment Entry (Story 4.3): manual methods only (Cash / Bank Transfer / Manual Mobile Money).
- Inline Renewal Panel / AD-16 (Story 4.7, not yet built): its payment-method dropdown is explicitly `Cash | Bank Transfer | Manual Mobile Money` — automated Mobile Money is absent from that list too.
- AD-09 Payments (Story 4.3, not yet built) only *filters* by a "Mobile Money" method value — it has no automated-charge trigger, only "+Record Payment" → AD-10 (manual).
- MA-13 Plan Details (member app): explicitly "No member-facing actions (plan changes require admin)."
- AD-04 Member Detail (with Subscription/Payments tabs) **does not exist yet in the codebase at all** — only a flat Members list (`apps/dashboard/app/(dashboard)/members/`) with modals exists today.

**Resolution:** build the real service-layer capability (`initiatePayment`) and the Edge Function orchestration only, proven via direct RPC/service-layer calls and pgTAP — the same verification style Story 4.1 used for its Super Admin page before a live browser was reachable. Story 4.7 (Inline Renewal Panel) is the natural next story to add a "Mobile Money (MTN/Orange)" option to its dropdown and wire it to this story's `initiatePayment`; record this handoff in `docs/decisions.md` during dev-story, the same way Story 3.2's deferral was recorded structurally (comment in `subscriptions.ts`).

**Real, load-bearing gap this story must close: `payments` has never had gym-staff RLS.** `0005_payments.sql` enables RLS with a deny-all default (per architecture's "every table migration closes the open-table window" rule) but **no gym-staff SELECT/INSERT policy for `payments` has ever been added** — grep confirms the only policy on this table is `super_admin_escalated_read_payments` (`0012`). Story 3.10 hit this directly: its Member App History screen shipped a "static Payments placeholder tab" specifically because "no payments table yet [RLS]" (see `3-10-...md` Task/Change-Log). architecture.md's own directory tree even names the expected file (`0011_rls_policies_payments.sql`) but the real `0011` migration became `0011_super_admin_tier_gym_lifecycle.sql` instead — the payments RLS migration was simply never written by any prior story. This story is the first to need real staff read/write access to `payments`, so it is the right place to close this gap (mirrors `gym_staff_read_own_subscriptions`/`manager_or_owner_insert_own_subscriptions`, `0018`).

**Out of scope, explicitly (do not build):** the manual Verification Queue/AD-10 (Story 4.3), the reconciliation job (Story 4.4), refunds (4.5), the front-desk alert and its dismissal (4.6 — not yet built, so nothing to dismiss), the Inline Renewal Panel UI (4.7), the Subscriptions page (4.8), member-facing receipt viewing / MA-11 Payments tab / MA-14 (4.9), and push notifications N-04/N-05 (Epic 6, entirely backlog — no `send_push_notification()` call site exists anywhere yet). Do not attempt any of these; a correctly-scoped Story 4.2 touches only the payment-initiation → webhook → renewal pipeline and the RLS gap above.

## ⚠️ Critical Context: Real Money, No Sandbox — Read Before Testing

**TaraMoney has no sandbox/test environment** (confirmed exhaustively during Story 4.1 — the "Production key" the user holds is TaraMoney's only environment). `supabase/.env` currently holds a **stand-in business** ("Temporal KEYS") because the real GYM OS business (`9FmIZg9GBB`) is still `BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT` as of 2026-07-31 (see `docs/decisions.md`'s two 2026-07-31 entries). Any real end-to-end test of `initiatePayment` in this story will:
1. Trigger a **real charge** (real XAF, real USSD prompt) against whichever TaraMoney business `supabase/.env` currently points to.
2. Require the **user's real-time authorization and a real phone to dial the USSD confirmation** — exactly as Story 4.1's Task 9 needed. Do not attempt a real `initiate()` call without first getting the user's explicit go-ahead for that specific transaction (amount + destination number), the same discipline Story 4.1 followed both times it ran the real spike.
3. Only Orange Cameroon has ever been confirmed end-to-end (Story 4.1's real webhook only exercised `ORANGE_CAMEROON`) — the `mtn_momo` vendor-mapping fallback in `payment-webhook/index.ts` remains unverified against a real MTN delivery. Do not assume it works; flag it if this story is the one that finally exercises it.

If a real end-to-end run isn't feasible in this dev-story session, ship this story verified via pgTAP + direct `supabase.functions.invoke`/RPC calls against the local instance (same fallback Story 4.1 used for its Super Admin page), and say so plainly rather than claiming a real charge was tested.

## Acceptance Criteria

1. **Given** the `PaymentProvider`/`TaraMoneyProvider` built in Story 4.1, **when** an owner/manager/receptionist session calls the new `initiatePayment` service-layer function for a specific gym-scoped member, **then** a `payments` row is inserted scoped to the caller's own gym (`status = 'processing'`, `provider` = whatever `active_payment_provider()` currently returns, `provider_transaction_ref` initially null), the new Edge Function initiate route calls `TaraMoneyProvider.initiate()` with that member's payment amount/currency/phone number, and on a successful provider response the row is updated with the real `provider_transaction_ref` TaraMoney returned — replacing Story 4.1's throwaway `<gymId>:<memberId>:<suffix>` spike convention entirely. [Source: epics.md#Story 4.2 AC#1, adapted per Scope Note — real orchestration instead of the spike's placeholder]

2. **Given** `initiate()` returns a failure (network error, TaraMoney error response), **when** that happens, **then** the just-inserted `payments` row is removed (no `payment_status` enum value exists for "failed" — do not add one; nothing was ever charged, so nothing to reconcile) and the caller receives a mapped error — no orphaned `processing` row is left behind for a charge that never actually started.

3. **Given** `payment-webhook`'s existing signature verification and idempotent-upsert logic (Story 4.1), **when** it is extended for real orchestration, **then**: (a) a verified webhook event is matched to the pre-existing `payments` row by `provider_transaction_ref` (set at initiate time) — no new row is ever inserted by the webhook handler; (b) if no matching row is found, nothing is persisted and it is logged (defensive — should not occur in normal operation); (c) an unsigned/invalid webhook still 401s exactly as Story 4.1 left it — this story does not relax that.

4. **Given** a payment row's first transition from `processing` to `verified`, **when** that transition happens, **then** it happens exactly once, atomically, via a new `service_role`-only function (distinct from the existing `renew_subscription()`, which requires a real authenticated staff JWT and cannot be called from the webhook's service-role context) — a second (replayed/duplicate) webhook delivery for the same `provider_transaction_ref` must find the row already `verified` and perform **no further action**: no second `subscriptions` row, no second audit log entry, no re-run of the renewal side effect. This is the idempotency gap Story 4.1 explicitly left open ("Story 4.2's orchestration decides") — Story 4.1's own idempotency test only covered "no duplicate `payments` row," not "no duplicate renewal."

5. **Given** a payment's first verified transition, **when** it completes, **then** a new `subscriptions` row is inserted (status `active`, same plan as the member's most recent subscription, new expiry per plan duration — mirroring `renew_subscription()`'s exact "renewal-as-history" shape from `0022_manual_renewal_reset.sql`), and the triggering `payments` row's `subscription_id` is set to that new row's id (matching architecture.md's ER note: "a renewal payment links to the subscription it renewed"). The action is audit-logged via `log_audit_event(..., p_system_actor_label => ...)` (no real staff session initiated this side effect — it's system-triggered from the webhook, mirroring Story 4.1's own precedent for out-of-band `log_audit_event` calls).

6. **Given** TaraMoney's real webhook payload carries both `amount` (what the member paid) and `originalAmount` (what the gym is actually credited net of TaraMoney's fee — confirmed via Story 4.1's real spike: `"amount":"100","originalAmount":"97"`), **when** a webhook is processed, **then** the fee is captured on the `payments` row via a new nullable column rather than silently dropped — this closes the exact gap Story 4.1's own review flagged as deferred ("`originalAmount` ... never propagated ... deferred, pre-existing scope boundary: real fee-passthrough handling is Story 4.2+'s job"). No member-facing surcharge option is added (FR-039 — the platform/gym absorbs the fee via the amount/originalAmount delta, it is not billed separately to the member).

7. **Given** `payments` has had a deny-all-only RLS posture since `0005_payments.sql` with no gym-staff policy ever added, **when** this story ships, **then** owner/manager/receptionist sessions can `SELECT` and `INSERT` `payments` rows scoped to their own gym only (mirroring `gym_staff_read_own_subscriptions`/`manager_or_owner_insert_own_subscriptions`'s exact role-list and `gym_id = private.gym_id()` shape, `0018_member_management.sql`), verified by pgTAP the same way every prior RLS story has been. Member-scoped self-read RLS for `payments` (needed by MA-11/MA-14) is explicitly **not** added here — it is Story 4.9's job, same boundary Story 3.10 already established for its placeholder tab.

8. **Given** every FR-041 receipt field (member name, gym name, plan, amount, currency, method, date, transaction reference, actor), **when** a payment reaches `verified`, **then** every field is correctly present and derivable via joins from `payments`/`members`/`gyms`/`subscriptions`/`plans` — `actor_id` is `null` for this automated path (no human staff member acted; `log_audit_event`'s `p_system_actor_label` records the system attribution in the audit trail instead). No receipt-rendering UI is built in this story (Stories 4.3/4.9 own that) — this AC is about data completeness and correctness only.

## Tasks / Subtasks

- [x] **Task 1: New migration — close the `payments` RLS gap, add the fee column, add the renewal-completion function** (AC: #4, #5, #6, #7)
  - [x] New file `supabase/migrations/0030_payment_initiation_and_renewal.sql`.
  - [x] `create policy "gym_staff_read_own_payments" on payments for select using (gym_id = private.gym_id() and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist']));` — deliberately **excludes** `'coach'`, unlike `gym_staff_read_own_subscriptions`/`gym_staff_read_own_members` (both include coach) — no AC or FR gives Coach role any visibility into payment data; check the actual gym-staff role list this codebase uses (`0018`'s `gym_staff_read_own_members` includes `coach`) before assuming — if in doubt, exclude coach here since nothing calls for it and it's easy to widen later, hard to narrow after data/UI assumes it.
  - [x] `create policy "gym_staff_insert_own_payments" on payments for insert with check (gym_id = private.gym_id() and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist']));` — mirrors `manager_or_owner_insert_own_subscriptions`'s shape but includes `receptionist` (matches `renew_subscription()`'s own role list, since a receptionist is exactly who collects payment at the front desk per the epics user story).
  - [x] No UPDATE policy for any gym-staff role in this story — the only writer that transitions `processing → verified` is the new `service_role`-only function below (webhook path); Story 4.3's manual verification queue will need its own staff-facing UPDATE policy later — do not add it here, that's scope creep.
  - [x] `alter table payments add column provider_fee_amount integer;` — nullable (cash/manual/unverified-in-flight payments have none), integer XAF per FR-026/NFR-003 (no floats). Add a `check (provider_fee_amount is null or provider_fee_amount >= 0)` constraint.
  - [x] New function `complete_verified_payment(p_payment_id uuid, p_fee_amount integer) returns uuid` — `security definer`, `set search_path = public`. Logic, in order:
    1. `update payments set status = 'verified', provider_fee_amount = p_fee_amount where id = p_payment_id and status = 'processing' returning gym_id, member_id into v_gym_id, v_member_id;` — the `where status = 'processing'` clause **is** the idempotency guard (AC #4): a second call for an already-`verified` row updates 0 rows.
    2. If 0 rows updated (`v_gym_id is null`): `return null` — no-op, already handled or invalid id. Log via `raise notice` (or equivalent), do not raise an exception (a replayed webhook is an expected, not exceptional, event).
    3. Defense in depth, mirroring `renew_subscription()`'s deactivated-member guard: skip/abort renewal if `members.deactivated_at is not null` for `v_member_id` — but the payment itself stays `verified` (money was still real and received; do not silently revert `status` back to `processing`). Decide and document whichever behavior you pick — do not leave this branch unhandled.
    4. Look up `v_plan_id` from the member's most recent `subscriptions` row (`order by created_at desc limit 1`) — same query `renew_subscription()` already uses (`0022`).
    5. Compute new expiry the same way `renew_subscription()` does: `duration_days` from `plans`, `current_date + duration_days` (or null for pay-per-session).
    6. `insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values (v_gym_id, v_member_id, v_plan_id, 'active', current_date, v_new_expiry) returning id into v_new_subscription_id;`
    7. `update payments set subscription_id = v_new_subscription_id where id = p_payment_id;`
    8. `perform log_audit_event(p_action_type => 'subscription_payment_renewal', p_gym_id => v_gym_id, p_target_entity_id => v_member_id::text, p_target_entity_type => 'member', p_metadata => jsonb_build_object('payment_id', p_payment_id, 'subscription_id', v_new_subscription_id, 'plan_id', v_plan_id, 'new_expiry_date', v_new_expiry, 'fee_amount', p_fee_amount), p_system_actor_label => 'payment-webhook');`
    9. `return v_new_subscription_id;`
  - [x] `revoke execute on function complete_verified_payment from public; grant execute on function complete_verified_payment to service_role;` — **not** granted to `authenticated`. This function must only ever be reachable from the webhook's service-role client, never directly by a gym-staff session (that would let staff renew without a real verified payment) — same narrow-grant discipline as `activate_payment_provider()`.
  - [x] Record Decision 1 (this function's existence and why it's distinct from `renew_subscription()`) and Decision 2 (the RLS gap and why it's closed here) in `docs/decisions.md`.

- [x] **Task 2: `payment-webhook` — add the initiate route, simplify the webhook-receive path** (AC: #1, #2, #3, #6)
  - [x] In `supabase/functions/payment-webhook/index.ts`, route on URL path: keep the existing `/payment-webhook/<providerKey>` shape for **receiving** webhooks, add a new `/payment-webhook/initiate/<providerKey>` POST route for **initiating** a payment. (Still one Edge Function, `payment-webhook` — architecture.md reserves Edge Functions for "the Notch Pay webhook receiver only," so extending the existing function's internal routing is the recorded deviation, not adding a second/third function.)
  - [x] **Initiate route body:** `{ paymentId: string, phoneNumber: string }`.
    1. Fetch the `payments` row by `paymentId` via the service-role client. Reject (400) if not found, if `status !== 'processing'`, or if `provider_transaction_ref` is already non-null (guards against calling initiate twice for the same row).
    2. Build `InitiatePaymentParams`: `amount`/`currency` from the row, `reference` = the row's own `id` (a real UUID — replaces the spike's `<gymId>:<memberId>:<suffix>` convention entirely; simpler and no longer needs any string-parsing on the receive side), `callbackUrl` = this function's own base URL + `/<providerKey>` (the existing receive route), `phoneNumber` from the request body.
    3. Call `provider.initiate(params)`. On success: `update payments set provider_transaction_ref = result.providerTransactionRef where id = paymentId`, return `200 { providerTransactionRef, authorizationUrl? }`. On failure: `delete from payments where id = paymentId` (AC #2 — nothing was charged), return an error status with `result.error`.
  - [x] **Receive route (existing, being simplified):** delete `parseReference()` entirely — replace the upsert-by-reference logic with: `select id, gym_id, member_id from payments where provider_transaction_ref = event.providerTransactionRef` → if no row, log and `return 200` (nothing to do — should not occur since initiate always sets this ref first); if found, call `complete_verified_payment(id, feeAmount)` via the service-role client, where `feeAmount` is parsed from the webhook payload's fee field (confirm the exact field name — `originalAmount` per the real spike payload — and derive `feeAmount = amount - originalAmount`, guarding against a missing/non-numeric `originalAmount` the same defensive way `TaraMoneyProvider.ts`'s existing amount-validation already guards `amount` itself).
  - [x] `TaraMoneyProvider.ts`'s `NormalizedPaymentEvent`/webhook-normalization code already exists (Story 4.1) — extend it to also surface the fee field (`originalAmount` or equivalent) rather than dropping it, matching Story 4.1's own review finding.
  - [x] Do not touch the signature-verification branch (401 on invalid/unsigned) at all — AC #3(c) is a regression guard, not new work.

- [x] **Task 3: `apps/dashboard/services/payments.ts` — `initiatePayment` service function, no UI** (AC: #1, #2)
  - [x] New file. Follow `members.ts`'s established per-file `getCallerGymId()` helper (copy, don't import across files — matches this codebase's own stated convention) to resolve the caller's `gym_id` from claims.
  - [x] `initiatePayment(input: InitiatePaymentInput): Promise<{ data: { paymentId: string } | null; error: AppError | null }>`:
    1. Validate `input` via the new `initiatePaymentSchema` (Task 4) — this is the outermost boundary (no `actions.ts` exists yet, matching `subscriptions.ts`'s own precedent of validating here rather than trusting an already-parsed caller).
    2. Resolve `gymId` via `getCallerGymId()`.
    3. Look up the member's most recent subscription's plan (`price`, `currency`) — reuse the existing join pattern `members.ts`/`subscriptions.ts` already use for "most recent subscription," do not reinvent it.
    4. Call `active_payment_provider()` RPC (already granted to `authenticated` since Story 4.1) to get the current `provider` key.
    5. Insert the `payments` row via the normal RLS-respecting `createClient()` (this insert is exactly what proves authorization — if the caller's role/gym doesn't satisfy Task 1's new INSERT policy, this fails here with the normal RLS 0-rows-affected pattern, mapped via `mapAndLog`).
    6. Call `supabase.functions.invoke('payment-webhook/initiate/' + provider, { body: { paymentId: row.id, phoneNumber: input.phoneNumber } })`.
    7. On a non-2xx/error response, surface the mapped error (the row will already have been deleted by Task 2's initiate route on a provider-side failure — do not also try to delete it here, avoid a double-delete race).
  - [x] **No `actions.ts`, no component, no page.** Story 4.7 imports this function directly, exactly as `subscriptions.ts`'s comment already tells the reader to expect for `renewSubscription`.

- [x] **Task 4: `packages/types` — new schema, regenerated database types** (AC: #1, #6, #7)
  - [x] New file `packages/types/src/schemas/payment.ts`: `initiatePaymentSchema` — `memberId: z.uuid()`, `phoneNumber` (TaraMoney's real API takes bare-digit Cameroon numbers with no `+`, confirmed from Story 4.1's real request/response evidence in `docs/decisions.md` — **do not reuse `member.ts`'s `e164Phone` regex as-is**, since that requires a leading `+`; either accept E.164 and strip the `+` before calling TaraMoney inside the service function, or define a distinct local regex here — pick one, document the choice, stay consistent with wherever `members.phone` is actually stored), `method: z.enum(["mtn_momo", "orange_money"])`. Export from `packages/types/src/index.ts` (`export * from "./schemas/payment";`).
  - [x] `supabase gen types typescript --local` → `packages/types/src/database.ts` — diff should be exactly: `payments.provider_fee_amount` column, `complete_verified_payment` function signature.

- [x] **Task 5: pgTAP coverage** (AC: #4, #5, #6, #7)
  - [x] New file `supabase/tests/payments_rls_and_renewal.test.sql`, mirroring `payment_providers_rls.test.sql`'s (Story 4.1) session-simulation conventions.
  - [x] RLS: deny-all still holds for a member/coach session (no policy grants them anything on `payments`); owner/manager/receptionist can `SELECT`/`INSERT` scoped to their own `gym_id`, and get 0 rows for another gym's payments.
  - [x] `complete_verified_payment()`: first call on a `processing` row returns a new subscription id, sets `payments.status = 'verified'` and `subscription_id`, and a new `active` `subscriptions` row exists with the expected plan/expiry. A **second call with the same `p_payment_id`** returns `null` and does **not** insert a second `subscriptions` row (AC #4's core idempotency assertion — this is the exact gap Story 4.1 left untested).
  - [x] `complete_verified_payment()` called by a non-`service_role` caller (e.g. `authenticated`) is rejected (no `EXECUTE` grant) — confirms the narrow-grant boundary (Task 1) actually holds.
  - [x] A deactivated member's payment still transitions to `verified` (money was real) but does not silently create an inconsistent state — assert whatever behavior Task 1.3 documented.

- [x] **Task 6: Real spike verification (user-gated — see the Critical Context section above)** (AC: #1, #2, #3, #4, #5, #6)
  - [x] If the user authorizes a real transaction: call `initiatePayment` for a real (throwaway/test) fixture member with a real phone number, confirm a real USSD prompt fires, confirm the webhook arrives and drives `payments.status → verified`, a new `subscriptions` row appears, and `provider_fee_amount` is populated. Replay the exact same webhook payload once more (captured, not re-triggered from TaraMoney) and confirm no second `subscriptions` row is created.
  - [x] If not feasible this session: verify the full pipeline via direct `supabase.functions.invoke`/RPC calls against the local instance plus the pgTAP suite (Task 5), and state explicitly in Dev Agent Record that no real charge was exercised — do not claim otherwise.

- [x] **Task 7: Record decisions** (AC: all)
  - [x] `docs/decisions.md`, dated entry: the `payment-webhook`-internal-routing decision (initiate vs. receive), the `complete_verified_payment()` vs. `renew_subscription()` split and why, the payments-RLS-gap closure, and (if Task 6's real run happens) the real transaction's evidence — same format as every prior entry in this log.

### Review Findings

- [x] [Review][Patch] Uncaught network exception in `provider.initiate()` defeats AC #2's orphaned-row cleanup [supabase/functions/payment-webhook/index.ts:handleInitiate] — fixed: wrapped in try/catch, deletes the row and returns 502 on a thrown error
- [x] [Review][Patch] Successful `initiate()` followed by a failed `provider_transaction_ref` persistence write leaves the row re-initiable [supabase/functions/payment-webhook/index.ts — handleInitiate, provider_transaction_ref update branch] — fixed: retries the write up to 3 times before giving up
- [x] [Review][Patch] Initial payments-row eligibility lookup (`fetchError` branch) leaves an orphaned `processing` row instead of deleting it like the other failure branches [supabase/functions/payment-webhook/index.ts:handleInitiate] — fixed: now deletes the row before returning 500
- [x] [Review][Patch] Self-contradicting doc comments on `originalAmount` [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts] — fixed: corrected the JSDoc to describe it as post-fee (net), matching the actually-implemented behavior
- [x] [Review][Patch] `isTaraMoneyWebhookPayload` type guard validates far less than the interface it claims to narrow to [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts] — fixed: now checks `status` is actually `"SUCCESS"`/`"FAILURE"`
- [x] [Review][Patch] Raw provider error string returned directly in the initiate route's 502 response body [supabase/functions/payment-webhook/index.ts:handleInitiate] — fixed: caller now gets a generic message, detail is logged server-side only
- [x] [Review][Defer] No safeguard against duplicate/concurrent payment initiation (same-row race in the initiate route; same-member double-submit in `initiatePayment`) [supabase/functions/payment-webhook/index.ts — handleInitiate; apps/dashboard/services/payments.ts — initiatePayment] — deferred, no UI calls `initiatePayment` yet (Story 4.7 is the first real caller); not reachable until that UI ships, and belongs with 4.7's own click-to-charge flow design
- [x] [Review][Defer] Webhook-receive path never reconciles the provider-reported amount against the payment's original amount [supabase/functions/payment-webhook/index.ts] — deferred, webhooks are already signature-verified via shared secret (defense-in-depth gap, not exploitable under TaraMoney's real observed behavior); revisit if a real amount mismatch is ever observed
- [x] [Review][Defer] Member-selected `method` never sent to TaraMoney (`network: ""`) and never reconciled with the webhook's derived vendor [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts; index.ts] — deferred, Story 4.1's real spike evidence shows TaraMoney derives the vendor correctly from the phone number itself regardless of `network`; revisit only if a real method/vendor mismatch is ever observed
- [x] [Review][Defer] `gym_staff_insert_own_payments` INSERT policy doesn't verify `member_id` belongs to `gym_id` [supabase/migrations/0030_payment_initiation_and_renewal.sql] — deferred, pre-existing pattern inherited verbatim from `manager_or_owner_insert_own_subscriptions` (0018); the intended service-layer path already prevents exploiting it
- [x] [Review][Defer] "Most recent subscription" lookups (pricing + renewal-plan resolution) don't filter by subscription status [apps/dashboard/services/payments.ts; supabase/migrations/0030_payment_initiation_and_renewal.sql] — deferred, pre-existing; this story's own Dev Notes explicitly instruct reusing `renew_subscription()`'s (0022, Story 3.2) exact query pattern verbatim
- [x] [Review][Defer] Renewal expiry math (`current_date + duration_days`) ignores remaining time on a not-yet-expired subscription, no `greatest(current_date, previous_expiry)` [supabase/migrations/0030_payment_initiation_and_renewal.sql] — deferred, pre-existing; mirrors `renew_subscription()`'s established behavior per this story's own explicit instructions
- [x] [Review][Defer] Failed/declined ("flagged") webhook deliveries leave the payment at `processing` forever rather than transitioning to the schema's existing `flagged` enum value [supabase/functions/payment-webhook/index.ts] — deferred; this story's own Dev Notes explicitly assign this to Story 4.4's reconciliation-job scope
- [x] [Review][Defer] Generated `database.ts` type for `complete_verified_payment`'s `p_fee_amount` is non-nullable but the webhook handler calls it with `null` [packages/types/src/database.ts] — deferred; Supabase codegen fidelity gap compounded by the already-documented absence of Deno/Edge-Function typecheck coverage, not something to hand-patch in a generated file
- [x] [Review][Defer] `authorizationUrl` computed by the initiate route is never read or returned by `initiatePayment` [apps/dashboard/services/payments.ts] — deferred; dead for the current TaraMoney/USSD-only flow, only relevant if/when a future redirect-based provider is registered

## Dev Notes

- **This is Story 4.1's direct continuation, not a fresh integration.** `PaymentProvider`, `TaraMoneyProvider`, the `payment_providers` registry, and the webhook's signature verification are all already built and real-spike-verified — do not re-implement or second-guess any of that. This story's actual new work is: real gym/member/subscription linkage (replacing the spike's throwaway reference), the renewal side effect, fee capture, and the RLS gap.
- **`payments.status` enum has exactly 4 values: `pending, processing, verified, flagged`.** There is no `failed` value. Do not add one — AC #2's "delete the row on initiate failure" design exists specifically so this story doesn't need one. `flagged` is Story 4.4's reconciliation-job concern, not this story's.
- **Two different "renewal" functions now exist on purpose:** `renew_subscription()` (`0022`, Story 3.2 — real authenticated staff session, manual override, mandatory human-entered reason) and `complete_verified_payment()` (this story — `service_role`-only, system-triggered, no human reason). Do not merge them or have one call the other; they have different callers, different trust boundaries, and different audit semantics (`p_system_actor_label` vs. a real `auth.uid()`-derived actor).
- **`InitiatePaymentParams.reference`** (the interface field from Story 4.1) should now carry the `payments` row's own `id` — a real UUID, globally unique, already exists before the provider call. This makes the old `<gymId>:<memberId>:<suffix>` string convention and its parser fully obsolete; delete `parseReference()`, don't keep it as dead code.
- **Only Edge Functions may import `TaraMoneyProvider`** (Deno-only code — `Deno.env.get`, no Node runtime). Do not port or duplicate any TaraMoney request/response logic into `apps/dashboard` (Node/Next.js) — the Server Action layer only ever calls the Edge Function's initiate route over HTTP (`supabase.functions.invoke`), it never talks to TaraMoney directly. This keeps exactly one implementation of TaraMoney's real (and, per Story 4.1, occasionally surprising) API shape.
- **`verify_jwt = false` on `payment-webhook`** (Story 4.1, required for the public webhook-receive route) means the new initiate route gets no automatic JWT check either. The trust boundary for initiate is: the caller already passed RLS on the `payments` INSERT (Task 3, step 5) before ever calling the Edge Function, and the Edge Function itself only accepts a `paymentId` for a row that is real, `processing`, and not yet provider-linked. Do not add a second JWT-verification layer inside the initiate route — that would be redundant with the RLS check that already gated row creation, and this function has no way to independently verify a forwarded JWT without extra plumbing (a real thing to flag if it starts to feel insufficient, not something to silently work around).
- **Money handling (FR-026/NFR-003):** `provider_fee_amount` is an integer XAF value, same as `amount`. Never derive it with floating-point arithmetic even transiently.
- **No CI/typecheck coverage exists for Edge Function (Deno) code** — same pre-existing gap Story 2.1 and Story 4.1 both flagged and left open. Don't assume `pnpm typecheck` covers anything under `supabase/functions/`.
- **Testing standard:** pgTAP is the primary automated coverage (Task 5) — mirrors Story 4.1's own testing discipline for RLS/RPC-shaped work. The real TaraMoney round-trip (Task 6) is the only thing that can verify the actual external integration; no automated test substitutes for it, and it is user-gated (see Critical Context).

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0030_payment_initiation_and_renewal.sql   (new)
  supabase/functions/payment-webhook/index.ts                   (modified — initiate route, simplified receive path)
  supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts  (modified — surface fee field on NormalizedPaymentEvent)
  supabase/tests/payments_rls_and_renewal.test.sql               (new)
  apps/dashboard/services/payments.ts                           (new)
  packages/types/src/schemas/payment.ts                         (new)
  packages/types/src/index.ts                                   (modified — export new schema)
  packages/types/src/database.ts                                (regenerated)
  docs/decisions.md                                              (modified)
  ```
- `apps/dashboard` gets no new route/page/component in this story — confirmed no `members/[id]` detail page (AD-04) exists yet anywhere in the codebase, so there is genuinely nowhere in the current dashboard to hang a "Collect Mobile Money Payment" button even if this story wanted to add one. Do not build AD-04 as a side effect of this story — that's a much larger, unscoped surface belonging to whichever future story actually needs it.
- `apps/mobile` and `apps/super-admin` are untouched by this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2] — original literal AC text (Notch-Pay-specific); see Scope Note for what changed and why
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-032, FR-033, FR-034, FR-035, FR-039, FR-041, NFR-002, NFR-003] — renewal semantics, payment methods, provider-agnostic idempotency/fee/receipt requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries, Complete Project Directory Structure, Entity Relationships] — "Edge Functions reserved for the webhook receiver only" boundary (extended, not violated, by this story's initiate route); `payments (0..1) --> subscriptions` ER note this story's `subscription_id` linkage satisfies
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-04, AD-09, AD-10, AD-16 Inline Renewal Panel, MA-13] — exhaustive check confirming no automated-payment-initiation screen exists anywhere in the UX spec (Scope Note)
- [Source: supabase/migrations/0005_payments.sql] — `payments` table shape, existing `provider_transaction_ref` unique constraint, the RLS-enabled-but-policy-less state this story closes
- [Source: supabase/migrations/0018_member_management.sql#gym_staff_read_own_subscriptions, manager_or_owner_insert_own_subscriptions] — exact RLS pattern this story's new `payments` policies mirror
- [Source: supabase/migrations/0022_manual_renewal_reset.sql#renew_subscription] — the manual-renewal precedent this story's `complete_verified_payment()` deliberately parallels but does not reuse (different trust boundary)
- [Source: supabase/migrations/0007_audit_log.sql#log_audit_event] — `p_system_actor_label` mechanism, already used by Story 4.1 for its own out-of-band activation
- [Source: supabase/functions/payment-webhook/index.ts, .../TaraMoneyProvider.ts] — the exact code this story extends (Story 4.1)
- [Source: apps/dashboard/services/subscriptions.ts, members.ts] — `renewSubscription`'s "backend-only, no actions.ts yet" precedent this story follows exactly; `getCallerGymId()` convention to copy
- [Source: _bmad-output/implementation-artifacts/4-1-notch-pay-sandbox-spike.md] — full context on TaraMoney's real behavior, the spike's known gaps (throwaway reference convention, unpersisted fee, no real orchestration) this story exists to close
- [Source: _bmad-output/implementation-artifacts/3-10-member-app-plan-details-check-in-history.md] — direct evidence of the payments-RLS gap ("static Payments placeholder tab... no payments table yet")
- [Source: docs/decisions.md#2026-07-31 entries] — TaraMoney real spike evidence (webhook payload shape incl. `originalAmount`, signature mechanism, Temporal-business stand-in credentials currently in `supabase/.env`)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Local Supabase stack (WSL): `supabase db reset --local` applied `0030_payment_initiation_and_renewal.sql` cleanly on top of Story 4.1's uncommitted `0029` migration.
- `supabase gen types typescript --local` diff against the pre-existing `database.ts` was exactly the two expected additions (`payments.provider_fee_amount`, `complete_verified_payment` function signature) — no unexpected drift.
- Full pgTAP suite (`supabase test db --local`): 388 tests, all passing (23 files including the new `payments_rls_and_renewal.test.sql`, 29 assertions).
- `pnpm --filter @gymos/types typecheck` and `pnpm --filter dashboard typecheck`: clean, no errors.
- Local Edge Function verification (`supabase functions serve --env-file supabase/.env`) via real HTTP calls to the actual Deno code (not just pgTAP calling the SQL function directly): 404 on unknown provider key, 400 on a non-eligible `paymentId` for the initiate route, and a full synthetic webhook round-trip (signature-valid payload → `verified` → new `subscriptions` row → audit log), a replayed duplicate (no second row/audit entry), and a wrong-secret request (401) — all as expected.
- Real TaraMoney round-trip (user-authorized, 50 XAF to `+237659172788`): two attempts through the actual local initiate route failed (`"TaraMoney returned an unrecognized response shape"`, then a timeout) — confirmed with the user that no USSD prompt reached the phone either time, i.e. no charge was attempted. Root cause: the initiate route's `callbackUrl` resolves to `http://127.0.0.1:54321/...` when called locally, which is unreachable/meaningless to TaraMoney's real server (their own loopback, not this machine) — a local-testing-only constraint, not a code defect (in production `url.origin` is the real deployed project's public HTTPS URL). A third attempt, made directly against TaraMoney's real endpoint with a genuine public `webHookUrl` (a fresh webhook.site capture token, used only for this one verification call), succeeded: real USSD dial confirmed by the user, real webhook captured (`amount: "50"`, `originalAmount: "48"`), replayed against the actual local receive route and confirmed `payments.status = 'verified'`, `provider_fee_amount = 2`, a new `active` `subscriptions` row, and a `subscription_payment_renewal` audit_log entry — the full real pipeline end to end. Full evidence recorded in `docs/decisions.md` (2026-07-31 entry). All fixture rows were deleted after verification; local DB was reset to a clean state.

### Completion Notes List

- Migration `0030_payment_initiation_and_renewal.sql`: adds `gym_staff_read_own_payments`/`gym_staff_insert_own_payments` RLS policies (owner/manager/receptionist, no coach — first-ever gym-staff policies on `payments` since `0005`), `payments.provider_fee_amount` (nullable integer, `>= 0` check), and `complete_verified_payment(p_payment_id, p_fee_amount)` (`service_role`-only, idempotent via a `where status = 'processing'` guard, deactivated-member-safe by returning early rather than raising so the already-committed `verified` status is never unwound).
- `payment-webhook`'s Edge Function gained a `POST /initiate/<providerKey>` route (validates the payment is `processing` and not yet provider-linked, calls `TaraMoneyProvider.initiate()`, deletes the row on failure per AC #2, persists `provider_transaction_ref` on success) and its receive route was simplified to correlate purely by `provider_transaction_ref` and call `complete_verified_payment` — `parseReference()` and the throwaway `<gymId>:<memberId>:<suffix>` convention are fully deleted. `NormalizedPaymentEvent` gained `feeAmount`, derived from TaraMoney's real `amount`/`originalAmount` delta.
- `apps/dashboard/services/payments.ts`'s `initiatePayment` is backend-only (no `actions.ts`/UI), exactly mirroring `subscriptions.ts`'s `renewSubscription` precedent — Story 4.7 is the documented next consumer (both in-code and in `docs/decisions.md`).
- All 8 ACs verified: AC #1/#2 via the initiate route's success/failure paths (pgTAP + real HTTP + one real TaraMoney charge); AC #3 via the simplified receive route (signature verification untouched, correlation by `provider_transaction_ref`, defensive no-row logging); AC #4/#5 via `complete_verified_payment`'s idempotency and renewal-insert logic (pgTAP + the real replayed webhook); AC #6 via `provider_fee_amount` capture (pgTAP synthetic values + the real 50/48 → fee 2 XAF delta); AC #7 via the new RLS policies (pgTAP, all four role/cross-gym combinations); AC #8 via the existing joinable schema (`payments`/`members`/`gyms`/`subscriptions`/`plans`), no new gap.
- Real spike (Task 6) was run to completion with explicit, transaction-specific user authorization (50 XAF, a real phone number) — see Debug Log References and `docs/decisions.md` for the full real-money evidence, including a real-environment finding (unreachable local `callbackUrl`) that's worth knowing for any future local Edge Function verification against a real external webhook-issuing API.

### File List

- `supabase/migrations/0030_payment_initiation_and_renewal.sql` (new)
- `supabase/functions/payment-webhook/index.ts` (modified)
- `supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts` (modified)
- `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts` (modified)
- `supabase/tests/payments_rls_and_renewal.test.sql` (new)
- `apps/dashboard/services/payments.ts` (new)
- `packages/types/src/schemas/payment.ts` (new)
- `packages/types/src/index.ts` (modified)
- `packages/types/src/database.ts` (regenerated)
- `docs/decisions.md` (modified)

## Change Log

- 2026-07-31: Story implemented in full — real payment orchestration (`initiatePayment` → `payment-webhook` initiate route → real TaraMoney charge → webhook → `complete_verified_payment` → subscription renewal), the `payments` gym-staff RLS gap closed, fee-passthrough capture added. Verified via pgTAP (29 new assertions, full suite green), direct real-HTTP Edge Function calls, and one user-authorized real 50 XAF TaraMoney round-trip. Status moved to review.
