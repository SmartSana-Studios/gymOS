---
baseline_commit: 207c9faa429b878c239b59d0b1a4b2c7deefe67e
---

# Story 6.3: Payment Notifications (N-04, N-05)

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a member,
I want to be notified when a payment succeeds or fails,
so that I know my membership status is up to date.

## Acceptance Criteria

1. **Given** a payment transitions into `status = 'verified'` through any existing write path (webhook completion via `complete_verified_payment()`, the manual Verification Queue's staff "Verify" action, or a direct verified insert from the Inline Renewal Panel / Open Payment Method / Subscriptions-page manual renewal), **when** the `AFTER INSERT OR UPDATE` trigger on `payments` fires, **then** push N-04 (`Payment confirmed`) is queued through a private payment-scoped dispatch function for every registered Expo token belonging to that payment's member's user account, in the member's preferred language, exactly once per payment.
2. **Given** a payment's provider webhook reports a non-`verified` (declined/failed) outcome for a payment currently `processing`, **when** the webhook handler processes that delivery, **then** the payment transitions `processing → flagged` through a new server-side completion path (no such automated transition exists on `main` today — see Dev Notes) and the same trigger queues push N-05 (`Payment failed`) once for that payment, in the member's preferred language.
3. **Given** a staff member manually flags a `pending` payment for review via the existing Verification Queue ("Flag for Review", Story 4.3, `pending → flagged`), **when** the trigger fires, **then** no N-05 (or any) push notification is sent. PRD FR-075 defines N-05's trigger as "Payment webhook failure event" specifically — manual internal review flagging is a distinct, human judgment-call action and must not be conflated with an automated payment failure signal to the member.
4. **Given** the same payment reaches its terminal status more than once in the write path (e.g. `complete_verified_payment()`'s second, separate `UPDATE ... SET subscription_id = ...` runs after the `status = 'verified'` transition, on the same row, in the same transaction), or a lifecycle/reconciliation job re-touches the row without changing `status`, **when** dispatch is evaluated, **then** no duplicate N-04/N-05 is queued for the same payment and no unrelated `payments` UPDATE (e.g. a future column-only edit) triggers a stray notification.
5. **Given** a push delivery returns Expo's `DeviceNotRegistered` error, **when** the notification delivery processor (Story 6.2, extended by this story) handles the push ticket or receipt, **then** the matching stale token is removed through the existing `private.cleanup_invalid_device_push_token()` and unrelated users' tokens remain untouched — identical contract to Story 6.2, reused, not reimplemented.
6. **Given** a member's `users.preferred_language` is `fr`, **when** N-04 or N-05 is built, **then** the French title/body is sent; `en`, an unsupported value, or a missing effective value uses the English fallback. The notification data payload includes camelCase `notificationCode`, `paymentId`, and `gymId`. Dispatch is keyed by `payment_id`, not `subscription_id` — see Dev Notes for why `subscription_id` cannot be used as the dispatch identity here.
7. **Given** N-04/N-05 are mandatory V1 payment notifications, **when** dispatch eligibility is evaluated, **then** no `member_preferences` opt-out can suppress them and this story adds no preference UI or non-critical notification settings (identical constraint to Story 6.2, owned by Story 6.4).
8. **Given** a manual "Record Payment" ledger entry (Story 4.3) whose `subscription_id` is permanently `NULL` by design, **when** it is later verified or flagged from the Verification Queue, **then** dispatch still succeeds using `payments.gym_id`/`payments.member_id` directly (both `NOT NULL` on every payment row) — no subscription lookup is required or attempted.

## Tasks / Subtasks

- [ ] **Task 1: Add the payment-scoped notification transport migration** (AC: #1, #2, #4, #6, #8)
  - [ ] Create the next sequential migration, `supabase/migrations/0046_payment_notifications.sql`.
  - [ ] Add `private.payment_notification_dispatches` and `private.payment_notification_deliveries`, structurally mirroring Story 6.2's `private.notification_dispatches`/`private.notification_deliveries` (same columns, same status vocabulary, same indexes) but keyed by `payment_id` instead of `subscription_id`. Use `notification_code check (notification_code in ('N-04', 'N-05'))` and `unique (payment_id, notification_code)`.
  - [ ] **Do not alter or reuse `private.notification_dispatches`/`private.notification_deliveries` (migration 0045).** They are already shipped and reviewed, and their unique key is `subscription_id`-shaped — `subscription_id` is frequently `NULL` on `payments` (manual ledger entries never set it; the webhook path's `complete_verified_payment()` only sets it in a *second*, later `UPDATE`, after the `verified` transition this story dispatches from). A parallel, payment-keyed pair avoids widening 0045's proven schema and avoids nullable-either-column unique-index ambiguity. Record this as a deliberate rejected alternative in the decision log (Task 6).
  - [ ] Enable RLS on both new tables in the same migration; grant only `service_role` (no `authenticated`/`anon` policy), matching 0045's exact posture.
  - [ ] Add the same supporting indexes 0045 used: a due-delivery partial index on `(status, updated_at)`, and unique indexes on `push_request_id`/`receipt_request_id`.

- [ ] **Task 2: Implement bilingual payment message construction and Expo enqueueing** (AC: #1, #2, #6, #7, #8)
  - [ ] Implement `private.send_payment_push_notification(p_payment_id uuid, p_notification_code text)`. **Cannot be an overload of `private.send_push_notification(uuid, text)`** — Postgres cannot disambiguate two functions with an identical `(uuid, text)` signature; use a distinct name.
  - [ ] Derive `gym_id`, `member_id` **directly from the `payments` row** (`payments.gym_id`/`payments.member_id` are both `NOT NULL`) — do **not** join through `subscriptions` (Story 6.2's pattern); `payments.subscription_id` is frequently `NULL` and is not a reliable join key here. From `member_id`, derive `members.user_id → users.preferred_language`, and every `device_push_tokens` row for that user, exactly as Story 6.2 does.
  - [ ] Validate the notification code allowlist (`N-04`, `N-05` only) and fail closed for unknown codes, matching `send_push_notification`'s exact guard.
  - [ ] Use `fr` only when `lower(preferred_language) = 'fr'`; otherwise English. Propose this copy (not pre-reviewed like Story 6.2's N-01–N-03 copy — confirm/record final wording in the decision log, Task 6):
    - [ ] N-04 EN: title `Payment confirmed`; body `Your payment of {amount} {currency} to {gym_name} was confirmed.`
    - [ ] N-04 FR: title `Paiement confirmé`; body `Votre paiement de {amount} {currency} à {gym_name} a été confirmé.`
    - [ ] N-05 EN: title `Payment failed`; body `Your payment to {gym_name} could not be completed. Please try again or contact the front desk.`
    - [ ] N-05 FR: title `Échec du paiement`; body `Votre paiement à {gym_name} n'a pas pu être effectué. Veuillez réessayer ou contacter la réception.`
  - [ ] POST the same Expo-shaped JSON as Story 6.2 to `https://exp.host/--/api/v2/push/send` via `net.http_post`, with a `data` object containing `notificationCode`, `paymentId`, `gymId`. Do not call FCM/APNs directly; do not create an Edge Function.
  - [ ] Insert the logical dispatch row first with `on conflict (payment_id, notification_code) do nothing`, mirroring 6.2's idempotency guard exactly. No-token case is a safe, observable `no_tokens` no-op.
  - [ ] Revoke public execute; grant only to `service_role` (the trigger runs as the table owner/postgres and does not need a grant to `authenticated`).

- [ ] **Task 3: Add the `payments` trigger — the single hardest correctness requirement in this story** (AC: #1, #2, #3, #4)
  - [ ] Implement `private.notify_payment_status_change()` as an `AFTER INSERT OR UPDATE ON payments FOR EACH ROW` trigger function, registered as trigger `payments_notify_status_change`.
  - [ ] **N-04 firing condition:** `(TG_OP = 'INSERT' AND NEW.status = 'verified') OR (TG_OP = 'UPDATE' AND NEW.status = 'verified' AND OLD.status IS DISTINCT FROM 'verified')`. The `OLD.status IS DISTINCT FROM 'verified'` guard is load-bearing: without it, `complete_verified_payment()`'s **second** `UPDATE ... SET subscription_id = ...` (which leaves `status` already `'verified'`) would re-fire the trigger a second time for the same payment. (The dispatch table's `unique(payment_id, notification_code)` would absorb a second *dispatch* attempt harmlessly, but the trigger should not even attempt it — keep the SQL-level intent correct, not just idempotency-safe.)
  - [ ] **N-05 firing condition:** `TG_OP = 'UPDATE' AND NEW.status = 'flagged' AND OLD.status = 'processing'`. This is the mechanism that distinguishes an automated webhook failure from a manual "Flag for Review" (AC #3): the Verification Queue's `gym_staff_verify_own_payments` policy (`supabase/migrations/0031_manual_payment_verification_queue.sql`) only ever operates on `OLD.status = 'pending'` rows, so a `pending → flagged` transition **never** matches this condition and correctly sends nothing. Only Task 4's new webhook-failure completion path produces a `processing → flagged` transition. Do **not** use a bare `NEW.status = 'flagged'` condition — that would incorrectly notify members on every manual internal flag.
  - [ ] Call `private.send_payment_push_notification(NEW.id, 'N-04' | 'N-05')` via `perform` from the trigger body (`security definer` not required on the trigger function itself since it runs in the same transaction as the writer; `send_payment_push_notification` itself carries the privilege boundary).

- [ ] **Task 4: Give the webhook a real, distinguishable failure completion path** (AC: #2, #3)
  - [ ] `supabase/functions/payment-webhook/index.ts` (read fully before editing — see Existing Files to Update) currently treats `event.status !== "verified"` as a terminal no-op: it logs and returns 200 without ever writing to `payments.status` (see the exact comment at lines 267–278: *"payment_status has no 'failed' value... no auto-transition happens here"*). That comment's premise no longer holds once this task ships — you are the first story to give an automated webhook failure a real, observable state.
  - [ ] Add `complete_flagged_payment(p_payment_id uuid) returns void`, mirroring `complete_verified_payment()`'s exact shape and trust boundary (`security definer`, `service_role`-only grant, `revoke ... from public`): `UPDATE payments SET status = 'flagged' WHERE id = p_payment_id AND status = 'processing'`. The `AND status = 'processing'` clause is the idempotency guard for a retried webhook delivery, identical reasoning to `complete_verified_payment()`'s own comment.
  - [ ] No new parameters for error detail — `payment_webhook_events` (Story 4.4, `supabase/migrations/0032_payment_reconciliation_job.sql`) already persists `status`/`raw_payload`/`matched_payment_id` for every signature-verified delivery, matched or not, immediately above this branch in the same handler. That is the audit trail for *why* a payment failed; do not duplicate it onto the `payments` row.
  - [ ] In the `event.status !== "verified"` branch, when `paymentRow` was found (a real payment exists to fail), call the new RPC instead of the current no-op. Leave the `!paymentRow` defensive branch (line ~281) untouched.
  - [ ] Update the stale comment block to describe the new behavior instead of the now-false claim that nothing happens.
  - [ ] Note the interaction with Story 4.4's reconciliation job (`run_payment_reconciliation_job()`, AC #2, `stale_processing`): after this change, a *promptly delivered* declined webhook will transition the payment to `flagged` immediately rather than being caught ~10 minutes later as `stale_processing`. This is a genuine, positive behavior change to already-shipped Story 4.4 logic — record it explicitly in the decision log (Task 6); do not let it read as an accidental side effect.

- [ ] **Task 5: Extend the delivery processor to cover the new ledger** (AC: #5)
  - [ ] Story 6.2's `private.process_notification_deliveries()` and its `notification_delivery_processor` cron entry already implement the full Expo ticket/receipt state machine (push_pending → receipt_pending → delivered/failed/device_not_registered) and already call `private.cleanup_invalid_device_push_token()` on `DeviceNotRegistered`. Extend that same function (recommended: `UNION ALL` the `private.payment_notification_deliveries` rows into its processing loop, keyed the same way) rather than standing up a second near-identical processor and a second cron entry — there is no behavioral reason for two copies of the same Expo response-handling logic.
  - [ ] If a shared/generalized processor proves awkward in practice, a second, clearly-named processor + cron entry is an acceptable fallback — but it must reuse `private.cleanup_invalid_device_push_token()` exactly as-is (never reimplement token cleanup).
  - [ ] Preserve the existing `notification_delivery_processor` cron schedule/name for the lifecycle ledger; `cron.schedule()` upserts by name, so do not introduce a duplicate.

- [ ] **Task 6: Regenerate database types and document the decisions** (AC: #1–#8)
  - [ ] Regenerate `packages/types/src/database.ts`; the new ledger tables live in `private` and should remain absent from generated public types, same as 0045.
  - [ ] Add a dated `docs/decisions.md` entry covering, at minimum: (a) why a parallel payment-keyed dispatch/delivery pair was added instead of generalizing 0045's subscription-keyed tables; (b) why dispatch derives identity from `payments.gym_id`/`member_id` directly instead of joining through `subscriptions`; (c) the `OLD.status = 'processing' → 'flagged'` vs. `OLD.status = 'pending' → 'flagged'` distinction that separates an automated webhook failure (N-05) from a manual "Flag for Review" (no notification) — this is the story's central design resolution and must not be silently assumed; (d) that `complete_flagged_payment()` is a new, previously-nonexistent automated failure path, and its interaction with Story 4.4's `stale_processing` reconciliation check; (e) final confirmed N-04/N-05 copy if it differs from this story's proposed default.

- [ ] **Task 7: Add comprehensive pgTAP coverage** (AC: #1–#8)
  - [ ] Add `supabase/tests/payment_notifications.test.sql` with deterministic fixtures for: webhook completion (`complete_verified_payment`) firing N-04 exactly once despite its two-`UPDATE` shape; manual Verification Queue staff-verify (`pending → verified`) firing N-04; a direct verified insert (mirroring the Inline Renewal Panel / Open Payment Method pattern) firing N-04; a manual "Record Payment" ledger entry with `subscription_id IS NULL` still dispatching correctly keyed by `payment_id`.
  - [ ] Assert the N-05 boundary precisely: a new `complete_flagged_payment()` call (`processing → flagged`) fires N-05; a manual "Flag for Review" (`pending → flagged`) fires **nothing**. This is the highest-value assertion in the whole story — get it wrong and members get told a payment failed when a staff member was just doing internal review.
  - [ ] Assert EN/FR/unsupported-language-fallback copy, multiple device tokens, no-token no-op, and rerun idempotency (same payment re-verified/re-touched produces no duplicate dispatch or `pg_net` request), same discipline as `supabase/tests/subscription_lifecycle_notifications.test.sql`.
  - [ ] Inspect queued `pg_net` request payload state within the test transaction — never send a real Expo request. Assert endpoint, headers, Expo token, exact EN/FR title/body, and camelCase `notificationCode`/`paymentId`/`gymId` data keys.
  - [ ] Extend or add a negative-privilege test file proving `anon`/`authenticated` cannot execute `send_payment_push_notification`, `complete_flagged_payment`, or the processor, nor read/write the new `private` tables.
  - [ ] Keep all existing `supabase/tests/subscription_lifecycle_notifications.test.sql`, `manual_payment_verification_queue.test.sql`, and `payment_reconciliation` test assertions passing unchanged unless a count must expand for a directly related regression.

- [ ] **Task 8: Validate from a clean database** (AC: #1–#8)
  - [ ] Run `supabase db reset`, the full `supabase test db` suite, type generation/diff verification, `pnpm run typecheck`, and `pnpm run lint`.
  - [ ] Confirm the delivery-processor cron entry still exists exactly once (whether extended or duplicated per Task 5) and retains its schedule/owner.
  - [ ] A fresh physical-device delivery check is **not required** for this story — Stories 6.1/6.2 already proved the Expo/`pg_net`/FCM pipeline end-to-end on a real device. This story's actual risk surface is server-side trigger/dispatch correctness, which Task 7's pgTAP coverage owns. Only re-verify on-device if something in the shared processor path (Task 5) genuinely changes observable delivery behavior.

## Dev Notes

### Scope and Non-Negotiable Decisions

- **This is a database/backend story with one small, surgical Edge Function change.** Expected production changes: one migration, one Edge Function edit (`payment-webhook/index.ts`), generated database types, tests, and the decision log. No mobile UI change — Story 6.1 already registers Expo tokens; this story only sends payment pushes.
- **The central design problem this story must solve, not inherit unsolved:** unlike Story 6.2 (a single cron entry point dispatching lifecycle pushes), N-04/N-05 must fire from **at least five different existing write paths** that all set `payments.status = 'verified'` (webhook `complete_verified_payment()`; Verification Queue staff-verify; Inline Renewal Panel's `confirm_renewal()`; Open Payment Method's direct-verified insert; Subscriptions-page manual renewal's direct-verified insert) — which is exactly why the epic mandates a genuine `AFTER INSERT OR UPDATE` trigger on `payments` rather than threading a dispatch call through every call site individually.
- **`subscription_id` cannot be the dispatch key.** Story 6.2's `private.notification_dispatches` is keyed by `subscription_id`, which works because every subscription lifecycle event genuinely has one. `payments.subscription_id` is `NULL` for every manual "Record Payment" ledger entry (Story 4.3, by design — see that story's Scope Note) and is `NULL` at the exact moment `complete_verified_payment()`'s first `UPDATE` sets `status = 'verified'` (it only gets backfilled in a *second*, later `UPDATE` in the same function). Dispatch must be keyed by `payment_id`, which is always present and unique.
- **The webhook-failure gap is real, not a misreading.** Before this story, `payments.status` has **no automated failure transition at all**. `supabase/functions/payment-webhook/index.ts:267-278` explicitly documents the current non-decision: a declined webhook delivery is logged and returned `200` with zero write to `payments`. FR-075 nonetheless requires N-05 to fire on "Payment webhook failure event." This story is where that gap finally closes — do not treat it as something you can route around by reusing the existing manual `flagged` path; PRD FR-075 and this story's AC #3 explicitly require the opposite (manual flagging must stay silent).
- **`OLD.status = 'processing'` is the entire mechanism that keeps N-05 honest.** No new column, no new enum value, no schema change to `payments` is needed to distinguish "webhook said this failed" from "a human is reviewing this" — the two cases already start from different `payments.status` values today (`processing` vs. `pending`) purely because of how Stories 4.2/4.3 scoped their own RLS policies. Lean on that; do not invent a parallel signal.
- **Mandatory means no preference lookup**, identical to Story 6.2 — N-04/N-05 cannot be opted out of in V1; `member_preferences`/N-06/N-07 belong to Story 6.4.
- **No new Edge Function, no direct FCM/APNs integration** — preserves the architecture's two-Edge-Functions boundary. The one Edge Function touched (`payment-webhook`) is edited, not multiplied.
- **Refunds (Story 4.5) are out of scope** — `refunds` is a separate table that never mutates `payments.status` (confirmed: `supabase/migrations/0033_refund_recording.sql`); no notification is owned by this story for a refund event.

### Existing Files to Update

- `supabase/functions/payment-webhook/index.ts` — **read fully before editing.** Current state: signature verification → `payment_webhook_events` upsert (Story 4.4) → `if (event.status !== "verified")` early-return no-op (lines 267–278, the exact block whose premise this story invalidates) → payment row lookup → `complete_verified_payment` RPC call → 200. Story change: add the `complete_flagged_payment` RPC call inside the `event.status !== "verified"` branch, only when `paymentRow` was found; update the now-stale comment. Do not touch signature verification, the `payment_webhook_events` upsert, or the `!paymentRow` defensive branch.
- `supabase/migrations/0045_subscription_lifecycle_notifications.sql` — **read-only precedent, do not edit.** Copy its shape (dispatch/delivery table pair, `send_*_push_notification` function, processor, idempotency-via-unique-conflict pattern) for the new payment-keyed tables; do not widen its existing `subscription_id`-keyed tables to also serve payments.
- `supabase/migrations/0031_manual_payment_verification_queue.sql` — **read-only precedent, do not edit.** `gym_staff_verify_own_payments`'s `using (status = 'pending')` scoping is what this story's trigger logic relies on to exclude manual Flag-for-Review from N-05. Confirm this precondition still holds by reading the current policy before writing Task 3's trigger.
- `supabase/migrations/0030_payment_initiation_and_renewal.sql` — **read-only precedent, do not edit.** `complete_verified_payment()`'s two-`UPDATE` shape (status first, `subscription_id` second) is exactly why AC #4's `OLD.status IS DISTINCT FROM 'verified'` guard exists. Re-read it before writing the trigger to confirm the two-`UPDATE` shape is unchanged.
- `packages/types/src/database.ts` — regenerate after migration; do not hand-edit.
- `docs/decisions.md` — append a dated decision; preserve all prior entries.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — workflow tracking only; updated by BMAD, not application code.

### Architecture and Security Guardrails

- Keep privileged internals in `private` with pinned `search_path` and explicit `REVOKE`/`GRANT`, matching 0045 exactly. New tables are server-internal transport state — no client-readable path.
- Never expose Expo tokens or payment amounts/PII beyond what's already in the notification payload's `data` object (`notificationCode`, `paymentId`, `gymId` — no token, no raw amount required by any AC).
- `complete_flagged_payment()` must carry the exact same trust boundary as `complete_verified_payment()`: `security definer`, `revoke ... from public`, `grant execute ... to service_role` only. It must never be reachable from an `authenticated` gym-staff session — that would let staff forge a "failed" transition outside the Verification Queue's reviewed UI/audit path.
- The trigger function itself does not need `security definer` — it executes within the same transaction/privilege context as whichever writer (webhook's `service_role`, or a staff `authenticated` UPDATE) touched the row; the privilege boundary lives in `send_payment_push_notification`, not the trigger.
- Consider (judgment call, not mandated by any AC) adding a `log_audit_event()` call inside `complete_flagged_payment()`, symmetric with `complete_verified_payment()`'s own audit logging of the success path — Story 7.1 (Audit Record Coverage Verification, Epic 7) will otherwise need to circle back to this gap.

### Testing Requirements

- Follow the exact pgTAP fixture pattern established in `supabase/tests/subscription_lifecycle_notifications.test.sql`: transaction + `plan(...)`, deterministic UUIDs, direct function/trigger invocation, inspect queued DB state, `finish()`, rollback.
- Never send a real Expo request in tests; assert `pg_net` queue/payload state within the test transaction.
- **Highest-risk regressions, in priority order:** (1) N-05 firing on a manual Flag-for-Review (`pending → flagged`) — this would incorrectly tell a member their payment failed when staff are just reviewing it; (2) N-04 double-firing because `complete_verified_payment()`'s second `UPDATE` (setting `subscription_id`) re-triggers dispatch; (3) a manual ledger payment (`subscription_id IS NULL`) silently failing to dispatch because dispatch logic assumes a subscription join; (4) breaking Story 6.2's existing lifecycle notification tests or Story 4.3/4.4's existing payment tests while extending shared infrastructure.
- Full regression gate: clean database reset, all pgTAP tests, generated-types diff inspection, monorepo typecheck, lint.

### Previous Story Intelligence (Story 6.2)

- Story 6.2 built the reusable Expo transport pattern this story extends: direct `pg_net` → `https://exp.host/--/api/v2/push/send`, a logical-dispatch/per-device-delivery split for idempotency, and a shared ticket/receipt processor. Copy that shape; do not reinvent it.
- Story 6.2's dispatch table is intentionally narrow (`notification_code check (... in ('N-01','N-02','N-03'))`) with an explicit comment: *"do not generalize payment notifications owned by Story 6.3."* This story is that generalization — done via a parallel table pair (this story's Task 1), not by widening 0045's check constraint.
- Story 6.2's own git/worktree note still applies: the repository may carry unrelated BMAD tooling changes in the working tree. Preserve unrelated modifications; never use destructive reset/checkout commands.

### Latest Technical Information

- Expo's server contract separates push tickets from push receipts; `DeviceNotRegistered` requires stopping sends to that token — identical to Story 6.2's finding. See [Expo: Send notifications with the Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/).
- `pg_net` performs asynchronous HTTP requests; responses are only readable after transaction commit, in a later statement/job. Do not attempt to read a `pg_net` response synchronously in the same transaction that called `net.http_post`.

### Project Structure Notes

- New migration: `supabase/migrations/0046_payment_notifications.sql`.
- New tests: `supabase/tests/payment_notifications.test.sql`, and a negative-privilege test file if isolating those assertions.
- Edited: `supabase/functions/payment-webhook/index.ts`.
- Updated generated type: `packages/types/src/database.ts`.
- Updated decision record: `docs/decisions.md`.
- No expected changes under `apps/dashboard`, `apps/super-admin`, or mobile UI/routes/components.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 6, Story 6.3]
- [Source: `_bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md` §6.15, FR-074–FR-078 — N-05's trigger is literally defined as "Payment webhook failure event," not manual flagging]
- [Source: `supabase/migrations/0045_subscription_lifecycle_notifications.sql` — dispatch/delivery table shape, `send_push_notification`, processor, cron pattern to mirror]
- [Source: `supabase/migrations/0005_payments.sql` — `payments.gym_id`/`member_id` both `NOT NULL`; `subscription_id` nullable]
- [Source: `supabase/migrations/0030_payment_initiation_and_renewal.sql` — `complete_verified_payment()`'s two-`UPDATE` shape (status, then `subscription_id`)]
- [Source: `supabase/migrations/0031_manual_payment_verification_queue.sql` — `gym_staff_verify_own_payments` scoped to `OLD.status = 'pending'`, the exact precondition that keeps manual Flag-for-Review out of N-05]
- [Source: `supabase/migrations/0032_payment_reconciliation_job.sql` — `payment_webhook_events` as the existing failure/decline audit trail; `stale_processing` interaction noted in Task 4]
- [Source: `supabase/functions/payment-webhook/index.ts:217-309` — the exact webhook handler branch this story edits, including the stale "payment_status has no failed value" comment]
- [Source: `docs/decisions.md` 2026-08-03/04 entries — Story 6.2's five dispatch/idempotency decisions this story's decision log entry should sit alongside]
- [Source: `_bmad-output/implementation-artifacts/6-2-subscription-lifecycle-notifications-n-01-n-02-n-03.md` — previous-story scope, transport pattern, and testing discipline this story reuses]

## Change Log

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
