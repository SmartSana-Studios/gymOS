---
baseline_commit: 9dc27bd
---

# Story 4.4: Payment Reconciliation & Discrepancy Flagging

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Owner,
I want a nightly reconciliation job to flag payment discrepancies,
so that no franc goes unaccounted for.

## Scope Note — Read Before the Acceptance Criteria

**This story requires new infrastructure that doesn't exist yet: nothing in this codebase currently persists a raw record of an inbound payment webhook.** `supabase/functions/payment-webhook/index.ts` (Story 4.2) receives, verifies, and either completes (`complete_verified_payment`) or discards (`console.error` + `200`, no DB write at all) every webhook delivery — an unmatched or declined webhook currently leaves **zero trace** anywhere in the database. AC #1 ("a webhook event with no matching internal payment record") is literally undetectable by a nightly batch job unless webhook events are persisted somewhere first, since there is no payments row to inspect for an event that never matched one. **Resolution: this story adds a new `payment_webhook_events` log table, written by the existing webhook-receive handler (not a new Edge Function — architecture.md reserves Edge Functions for "the webhook receiver only," and this is the same function, same route, extending what it already does), one row per signature-verified delivery, matched or not.** The nightly job reads this log plus `payments` to compute all three discrepancy types. This is new scope beyond the literal AC text, but it's the only way to make AC #1 possible at all — recorded as a `docs/decisions.md` entry (Task 6).

**Discrepancies are NOT stored by mutating `payments.status`.** Story 4.3's own Dev Notes speculated that this story's "discrepancy flagging" and 4.3's manual "Flag for Review" might both set `payment_status = 'flagged'` on the same enum. That turns out not to work: **AC #1 has no payments row to mutate at all** (that's the entire premise of the AC), so any mechanism has to work without one. This story instead adds a dedicated `payment_discrepancies` table (own migration, own RLS) that references `payments`/`payment_webhook_events` only loosely (nullable FKs) — `payments.status`/the `payment_status` enum are untouched by this story, and 0031's `gym_staff_verify_own_payments` policy and `protect_payment_columns_on_staff_verify()` trigger are unaffected. Record this resolution in `docs/decisions.md` (Task 6) so it isn't rediscovered as a contradiction of 4.3's own note.

**AC #1's "no matching internal payment record" case can never be attributed to a gym, and this story does not build a UI for it.** TaraMoney's webhook payload carries `businessId` (the platform's single merchant account, not per-gym) — there is no reliable way to know which gym an *unmatched* webhook belongs to, since the only gym-scoping path is through a `payments` row, and by definition this discrepancy type has none. `payment_discrepancies.gym_id` is nullable and stays `NULL` for every `missing_internal_record` row; the gym-scoped RLS policy (Task 1) means these rows are **structurally invisible on every gym's Payments page** — `null = private.gym_id()` is never true, by design (same NULL-exclusion technique Story 3.1's Scope Note #2 already established as this codebase's convention, not a bug to fix). The row still gets written (for a future investigator with direct DB/Super Admin access, and so the job's own success/failure semantics stay meaningful), but no dashboard surface renders it. This is a deliberate scope reduction, not an oversight — a platform-wide unattributed-webhook viewer is real, new, cross-tenant UI scope with no FR, mockup, or story slot backing it (unlike Story 3.1's `super_admin_job_failures()`, which *did* have an explicit architecture.md mandate: "surfaced as an alert on the Super Admin dashboard"). Flag it in `deferred-work.md` (Task 6), don't build it here.

**AD-09's mockup shows "Discrepancy" only as an amber tag inside the not-yet-built "All Payments" ledger table — this story does not build that table.** Same reasoning Story 4.3 already applied to its own scope (no FR requires the full ledger with filters/CSV/pagination): FR-036 only requires discrepancies be "flagged on the Payments dashboard," not that the full AD-09 ledger exist first. **Resolved design, no mockup covers this exact shape:** add a small "Discrepancies" section to the existing `/payments` page (`PaymentsPageClient.tsx`), rendered only when ≥1 row exists — same pattern as this story's own Verification Queue (4.3) and Story 3.1's Super Admin job-failure list. Read-only: no resolve/dismiss action exists in any AC or FR for V1.

**"Notch Pay" in epics.md's literal AC text means TaraMoney.** Same historical-naming situation Story 4.1/4.2/4.3 already navigated — the provider was swapped during Story 4.1's spike; every reference below to "the webhook"/"the provider" means the real `TaraMoneyProvider`/`payment-webhook` Edge Function.

**Closes (partially) a gap 4.3 explicitly assigned here.** `deferred-work.md`'s Story 4.2 review noted: *"Failed/declined ('flagged') webhook deliveries leave the `payments` row at `processing` forever... this story's own Dev Notes explicitly assign this to 'Story 4.4's reconciliation-job concern.'"* This story's AC #2 (stale `processing`, >10 minutes) structurally catches this case too — a declined delivery never calls `complete_verified_payment`, so the row stays `processing` and ages past 10 minutes exactly like a delivery that never arrived at all. This story does **not** distinguish "never received" from "received but declined" in the discrepancy record (no AC asks for that distinction), and does **not** auto-transition the payment's own status — detection only, matching every other AC's literal "flagged as a discrepancy" wording. Task 2 also persists the declined-webhook event itself (previously not persisted at all), which gives a future investigator the "it actually declined, here's why" context even though the row's `payments.status` doesn't change.

## Acceptance Criteria

1. **Given** a Notch Pay (TaraMoney) webhook event with no matching internal payment record, **when** the nightly reconciliation job runs, **then** it is flagged as a discrepancy on the Payments dashboard. [Source: epics.md#Story 4.4 AC#1; FR-036] — see Scope Note: this specific discrepancy type has no gym to attribute and is not visible on any dashboard; the discrepancy record is still written.
2. **Given** an internal payment in `processing` status with no webhook received within 10 minutes, **when** the job runs, **then** it is flagged as a discrepancy. [Source: epics.md#Story 4.4 AC#2; FR-036]
3. **Given** an amount mismatch between a webhook payload and its internal record, **when** the job runs, **then** it is flagged as a discrepancy with both amounts shown. [Source: epics.md#Story 4.4 AC#3; FR-036]

## Tasks / Subtasks

- [x] **Task 1: New migration — event log, discrepancies table, reconciliation job, cron schedule** (AC: #1, #2, #3)
  - [x] New file `supabase/migrations/0032_payment_reconciliation_job.sql` (next sequential number after `0031_manual_payment_verification_queue.sql`).
  - [x] `create type payment_discrepancy_type as enum ('missing_internal_record', 'stale_processing', 'amount_mismatch');` — new enum type in this migration (not `0001`), matching the precedent that later migrations may introduce new enums when the concept didn't exist at schema-design time (e.g. `payment_providers`/`0029` added new tables the same way).
  - [x] `payment_webhook_events` table — one row per signature-verified webhook delivery, matched or not: `id uuid pk default gen_random_uuid()`, `provider_key text not null references payment_providers(provider_key)`, `provider_transaction_ref text not null`, `reference text` (nullable — the provider's echo of our own `InitiatePaymentParams.reference`, i.e. TaraMoney's `productId`), `amount integer not null`, `currency text not null`, `status text not null check (status in ('verified', 'flagged'))` (mirrors the two real webhook-reported values of `NormalizedPaymentEvent.status`; `'processing'` is never a webhook-reported status, it's the payments-table-only initial state), `matched_payment_id uuid references payments(id)` (nullable — set at receive time from the same lookup the handler already performs), `received_at timestamptz not null default now()`, `raw_payload jsonb not null`. `create unique index idx_payment_webhook_events_provider_ref on payment_webhook_events (provider_key, provider_transaction_ref);` — idempotent against retried webhook deliveries (Task 2 inserts with `on conflict do nothing`), same discipline as `payments.provider_transaction_ref unique`. `enable row level security`; grant baseline `select, insert, update, delete` to `authenticated, service_role` (0002 convention); **no SELECT policy** — deny-all, internal/service-role-and-postgres-cron-only, exactly matching `job_runs`' own "no business policy yet" precedent (Story 3.1).
  - [x] `payment_discrepancies` table: `id uuid pk default gen_random_uuid()`, `gym_id uuid references gyms(id)` (nullable — see Scope Note), `payment_id uuid references payments(id)` (nullable — `missing_internal_record` has none), `webhook_event_id uuid references payment_webhook_events(id)` (nullable — `stale_processing` has none), `discrepancy_type payment_discrepancy_type not null`, `details jsonb not null default '{}'::jsonb`, `detected_at timestamptz not null default now()`. Three partial unique indexes, one per discrepancy type, so the job's nightly `insert ... on conflict do nothing` (Task 1's function, below) never re-flags an already-known discrepancy on a later run — same "absolute-condition, idempotent by construction" design as Story 3.1's Scope Note #2, not delta/last-run logic:
    ```sql
    create unique index idx_payment_discrepancies_missing_record
      on payment_discrepancies (webhook_event_id) where discrepancy_type = 'missing_internal_record';
    create unique index idx_payment_discrepancies_stale_processing
      on payment_discrepancies (payment_id) where discrepancy_type = 'stale_processing';
    create unique index idx_payment_discrepancies_amount_mismatch
      on payment_discrepancies (webhook_event_id) where discrepancy_type = 'amount_mismatch';
    ```
    `enable row level security`; grant baseline `select, insert, update, delete` to `authenticated, service_role`. One SELECT policy, mirroring `gym_staff_read_own_payments`' exact role list (owner/manager/receptionist, excludes coach — no AC/FR gives Coach payment visibility, same reasoning Story 4.3 already applied):
    ```sql
    create policy "gym_staff_read_own_payment_discrepancies" on payment_discrepancies
      for select
      using (
        gym_id = private.gym_id()
        and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
      );
    ```
  - [x] `run_payment_reconciliation_job()` — plain `language plpgsql`, no `security definer` (cron invokes as `postgres`, which already bypasses RLS — same reasoning as `run_subscription_lifecycle_job()`/`run_check_in_auto_timeout_job()`, and the corrected `pg_cron`-runs-as-`postgres` finding from `docs/decisions.md`'s 2026-07-18 entry, which explicitly names "payment reconciliation" as one of the two jobs that must follow this exact grant discipline). Inner `BEGIN...EXCEPTION WHEN OTHERS` savepoint block (Story 3.1 Scope Note #4's exact shape — do not use a bare top-level handler, or a failure mid-run rolls back its own `job_runs` failure record too). Three set-based `INSERT ... SELECT ... ON CONFLICT ... DO NOTHING` statements inside the guarded block, in any order (they touch disjoint discrepancy types, unlike 3.1's ordered three UPDATEs):
    ```sql
    -- AC #1: webhook events that never matched a payments row. gym_id is
    -- always NULL here by construction (see Scope Note) -- not an oversight.
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select null, null, e.id, 'missing_internal_record',
      jsonb_build_object('providerTransactionRef', e.provider_transaction_ref, 'webhookAmount', e.amount, 'reference', e.reference)
    from payment_webhook_events e
    where e.matched_payment_id is null
    on conflict (webhook_event_id) where discrepancy_type = 'missing_internal_record' do nothing;

    -- AC #2: processing payments older than 10 minutes with no completing
    -- webhook. Also structurally catches a declined (event.status = 'flagged')
    -- webhook that was received but never transitioned the row (see Scope Note) --
    -- this query doesn't need to know which case it is.
    insert into payment_discrepancies (payment_id, gym_id, discrepancy_type, details)
    select p.id, p.gym_id, 'stale_processing',
      jsonb_build_object('createdAt', p.created_at)
    from payments p
    where p.status = 'processing'
      and p.created_at < now() - interval '10 minutes'
    on conflict (payment_id) where discrepancy_type = 'stale_processing' do nothing;

    -- AC #3: a matched webhook event whose amount disagrees with the
    -- payments row it matched. Both amounts captured in `details` (AC #3's
    -- "with both amounts shown").
    insert into payment_discrepancies (payment_id, gym_id, webhook_event_id, discrepancy_type, details)
    select p.id, p.gym_id, e.id, 'amount_mismatch',
      jsonb_build_object('webhookAmount', e.amount, 'internalAmount', p.amount, 'currency', p.currency)
    from payment_webhook_events e
    join payments p on p.id = e.matched_payment_id
    where e.amount <> p.amount
    on conflict (webhook_event_id) where discrepancy_type = 'amount_mismatch' do nothing;
    ```
    Followed by the `job_runs` success insert; the `exception when others` branch writes the `job_runs` failure row + `log_audit_event(p_action_type => 'payment_reconciliation_job_failure', p_system_actor_label => 'system:payment_reconciliation_job', ...)`, copying `run_subscription_lifecycle_job()`'s exact structure (`0021_subscription_lifecycle_cron.sql`) line for line — do not re-derive this shape from scratch.
  - [x] `revoke execute on function run_payment_reconciliation_job() from public;` — no grant to `authenticated`/`service_role` (cron/direct-`postgres`-only, same as the other two jobs).
  - [x] Schedule: `select cron.schedule('payment_reconciliation', '15 1 * * *', $$ select run_payment_reconciliation_job(); $$);` — 01:15 UTC (02:15 WAT), 15 minutes after `subscription_lifecycle`'s 01:00 UTC slot, so the two nightly jobs don't contend for the same instant (no FR mandates a specific offset; this just avoids two full-table batch jobs starting simultaneously). `cron.schedule()` upserts by job name — safe across repeated `supabase db reset`s, matching `0021`/`0024`'s own comment.
  - [x] Record Decision 1 (the `payment_webhook_events` log table as the only way to make AC #1 detectable, superseding 4.3's speculative "reuse `flagged`" note) and Decision 2 (the gym-unattributable `missing_internal_record` case gets no UI, deferred) in `docs/decisions.md` (Task 6).

- [x] **Task 2: `supabase/functions/payment-webhook/index.ts` — persist every signature-verified webhook event** (AC: #1, #2, #3)
  - [x] **Read the current file in full before editing** — this task restructures existing control flow, it does not append new code at the end. The current handler (a) looks up `payments` by `provider_transaction_ref` only *after* the `event.status !== "verified"` branch has already early-returned, so a declined delivery never even attempts the lookup, and (b) never persists anything for either branch.
  - [x] Move the `payments` lookup (`select id from payments where provider_transaction_ref = event.providerTransactionRef`) to run **before** the `event.status !== "verified"` branch, so `matched_payment_id` is available to both the declined-delivery path and the verified path.
  - [x] Immediately after a successful lookup (whichever branch), insert one row into `payment_webhook_events`: `provider_key: providerKey`, `provider_transaction_ref: event.providerTransactionRef`, `reference: event.reference ?? null`, `amount: event.amount`, `currency: event.currency`, `status: event.status` (`"verified"` or `"flagged"` — the type union's third value, `"processing"`, is never reachable here per Task 1's check constraint reasoning), `matched_payment_id: paymentRow?.id ?? null`, `raw_payload: JSON.parse(payloadText)` (re-parses the already-signature-verified body; cheap, and `payloadText` is already known-valid JSON at this point since `verifyWebhookSignature` itself parsed it successfully). Use `.upsert(..., { onConflict: "provider_key,provider_transaction_ref", ignoreDuplicates: true })` (or an equivalent `.insert()` with the unique index doing the dedup and the resulting unique-violation error checked-and-ignored) — a retried webhook delivery for the same `provider_transaction_ref` must not create a second event-log row.
  - [x] A failure to write `payment_webhook_events` should be logged (`console.error`) but must **not** block the existing completion path — `complete_verified_payment` still runs on the verified branch even if the event-log insert failed. Reconciliation-log durability is a nice-to-have; the real payment completion must never be blocked by it.
  - [x] No change to `complete_verified_payment`'s own logic, no change to the idempotency/matching behavior on the verified path, no change to `handleInitiate` — this task only adds persistence around the existing receive-path branches.
  - [x] **This story touches Edge Function (Deno) code** — like Stories 4.1/4.2, unlike 4.3: `pnpm typecheck` does not cover `supabase/functions/`, and there is no CI gate for it (a pre-existing, already-documented gap). Verify by reading, not by a compiler.

- [x] **Task 3: Regenerate `packages/types/src/database.ts`** (AC: all — Task 4 needs the new tables typed)
  - [x] Run `supabase gen types typescript --local` after Task 1's migration applies cleanly. This adds `payment_webhook_events` and `payment_discrepancies` `Row`/`Insert`/`Update`/`Relationships` shapes plus the `payment_discrepancy_type` enum and `run_payment_reconciliation_job`'s `Args`/`Returns`. Unlike 4.3 (RLS-only, no regen needed), this story adds two new tables — expect a real, non-trivial diff. Review it line-by-line before accepting (matches Story 1.4's established discipline).

- [x] **Task 4: `apps/dashboard/services/payments.ts` — read discrepancies** (AC: #1, #2, #3)
  - [x] `listPaymentDiscrepancies(): Promise<{ data: PaymentDiscrepancyRow[] | null; error: AppError | null }>` — reuses this file's existing `getCallerGymId()` helper (do not duplicate it). Query: `payment_discrepancies` filtered to `gym_id = gymId` (RLS already enforces this identically — the explicit `.eq` is defense-in-depth, matching every other list function in this file), joined to `payments(member_id, amount, currency, members(name))` where `payment_id is not null` (the only two discrepancy types this gym-scoped query will ever actually return are `stale_processing`/`amount_mismatch` — `missing_internal_record` rows have `gym_id = null` and are already excluded by RLS/the `.eq` filter; no need for the code to special-case that type). `order by detected_at desc`. No pagination (same NFR-009-scale reasoning as `listPendingPayments`).
  - [x] Row shape: `{ id, discrepancyType: "stale_processing" | "amount_mismatch", memberId, memberName, amount, currency, details, detectedAt }` — `details` stays a passthrough `Record<string, unknown>` (its exact shape differs per `discrepancyType`, no need for a discriminated schema for a read-only display).

- [x] **Task 5: Payments page — Discrepancies section** (AC: #1, #2, #3)
  - [x] `apps/dashboard/app/(dashboard)/payments/page.tsx`: add `listPaymentDiscrepancies()` to the existing `Promise.all([listPendingPayments(), getDashboardShellContext()])`, pass `discrepancies` through to `PaymentsPageClient`.
  - [x] `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx`: new read-only section below the Verification Queue, rendered only when `discrepancies.length > 0` (Story 3.1's Scope Note #3 precedent — no empty-state copy needed for a section whose default, common case is "nothing to show"). Per row: member name, amount (and the mismatched webhook amount when `discrepancyType === "amount_mismatch"`, reading both out of `details`), a type label (`payments.discrepancies.types.staleProcessing` / `.amountMismatch`), detected-at timestamp formatted via the request locale (mirrors Story 3.1's Metrics-page fix for exactly this bug — pass `i18n.language`, don't call `toLocaleString()` with no argument). No actions column — this section has no Verify/Flag/resolve buttons, matching the Scope Note's "read-only, no resolution workflow in V1."
  - [x] `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts`: add a small label map for the two real discrepancy types this UI ever renders (`stale_processing`, `amount_mismatch`) — do not add a `missing_internal_record` entry, it never reaches this component.

- [x] **Task 6: i18n + decisions + deferred-work** (AC: all)
  - [x] `apps/dashboard/locales/en.json`/`fr.json`: new keys inside the existing `"payments"` block — a `discrepancies` sub-object: section title, per-type labels, an "internal vs. reported amount" line format, detected-at label. Verify via `node scripts/check-i18n-key-parity.mjs`.
  - [x] `docs/decisions.md`: dated entry recording (1) the `payment_webhook_events` log table as new, story-motivated infrastructure and why it's required for AC #1 to be possible at all (superseding 4.3's speculative "shares the `flagged` enum value" note — that turned out not to be how this was built), and (2) the gym-unattributable `missing_internal_record` case getting no UI surface, with the reasoning from this story's Scope Note.
  - [x] `deferred-work.md`: add an entry for "no Super Admin (or any) UI surfaces `missing_internal_record` discrepancies — the row is written but nothing displays it" as a deliberate, reasoned V1 gap (per Scope Note), so it isn't rediscovered as a bug during a future review.

- [x] **Task 7: pgTAP coverage** (AC: #1, #2, #3)
  - [x] New file `supabase/tests/payment_reconciliation_job.test.sql`, mirroring `subscription_lifecycle_cron.test.sql`'s "seed fixtures, call the function directly, don't wait for real cron timing" convention.
  - [x] RLS: `payment_webhook_events` — 0 rows visible via direct table access regardless of role (deny-all, no policy — same assertion shape as `job_runs`' existing "0 rows, no business policy yet" test). `payment_discrepancies` — owner/manager/receptionist see only their own gym's rows with `gym_id` set; a `missing_internal_record` row (`gym_id = null`) is invisible to every gym-scoped session including its own gym's staff (the point of the Scope Note); coach sees 0 rows; cross-gym session sees 0 rows for another gym's discrepancies.
  - [x] Detection, seeded directly then `select run_payment_reconciliation_job();`:
    - A `payment_webhook_events` row with `matched_payment_id = null` → produces exactly one `missing_internal_record` discrepancy with `gym_id is null`.
    - A `payments` row `status = 'processing'`, `created_at = now() - interval '11 minutes'` → produces a `stale_processing` discrepancy with the correct `gym_id`/`payment_id`.
    - A `payments` row `status = 'processing'`, `created_at = now() - interval '5 minutes'` → produces **no** discrepancy (not yet past the 10-minute threshold).
    - A `payment_webhook_events` row matched to a `payments` row where `amount` differs → produces an `amount_mismatch` discrepancy with `details` containing both the webhook and internal amounts.
    - A `payment_webhook_events` row matched to a `payments` row where `amount` is equal → produces **no** discrepancy.
    - Idempotency: calling the function twice in a row produces the same row count the second time (the three partial unique indexes' `on conflict ... do nothing` holding, not a duplicate-detection bug).
  - [x] `rls_tenant_isolation.test.sql`: add the two new tables to its cross-cutting "gym A cannot see gym B's rows" sweep if that file enumerates tables by name (check its structure before assuming — don't blindly duplicate rows if it already iterates dynamically).

- [x] **Task 8: Validation and manual verification**
  - [x] `pnpm run typecheck` (4/4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] `supabase test db` — zero regressions against the pre-story baseline (405 assertions per Story 4.3's own final count) plus this story's new file.
  - [x] Hands-on: confirm `cron.job` registered `payment_reconciliation` at `'15 1 * * *'` (same technique as Story 3.1's Task 6).
  - [x] Hands-on: send a real (or locally-simulated, signed) webhook payload through `payment-webhook`'s receive route for a `provider_transaction_ref` that matches no `payments` row, confirm a `payment_webhook_events` row is written with `matched_payment_id = null`, then run `run_payment_reconciliation_job()` and confirm the resulting `missing_internal_record` discrepancy. This is the one path pgTAP can't exercise end-to-end (the Edge Function itself), matching this codebase's established "Deno code verified hands-on, not by a compiler or pgTAP" convention (4.1/4.2's own Debug Log precedent).

### Review Findings

- [x] [Review][Defer] Webhook-before-ref-persisted race produces a permanent, un-healing `missing_internal_record` flag — `supabase/functions/payment-webhook/index.ts:226-235` looks up `payments` by `provider_transaction_ref` synchronously with the webhook delivery, but `handleInitiate` (same file, lines 151-162) persists that same `provider_transaction_ref` via a separate, later, up-to-3-retry write. If the webhook callback fires before that write lands, `matched_payment_id` is `null` at insert time and stays `null` forever — `payment_webhook_events` rows are never re-matched by any later job run, and `payment_discrepancies`' partial-unique-index/`ON CONFLICT DO NOTHING` design means the resulting `missing_internal_record` row (and, once the payment ages past 10 minutes, a second `stale_processing` row for the same root cause) is permanent and never self-heals even after the ref eventually persists. — deferred: accepted as a V1 gap, consistent with this codebase's existing append-only "no resolve action for V1" convention (Story 3.1's job-failure list never auto-clears either); documented in `docs/decisions.md`.
- [x] [Review][Patch] Stale "not persisted" log message contradicts the new persistence behavior [supabase/functions/payment-webhook/index.ts:275-278] — the `event.status !== "verified"` branch still logs `"...reported status \"${event.status}\" -- not persisted"`, but Task 2's new `payment_webhook_events` insert (lines 245-259) now runs unconditionally *before* this branch, so every declined delivery this log fires for was in fact just persisted. Anyone debugging off production logs would wrongly conclude declined webhooks still leave zero trace. Fixed: log message updated to "no completion action taken".
- [x] [Review][Patch] `discrepanciesError` now blanks the entire Payments page on a Discrepancies-only failure [apps/dashboard/app/(dashboard)/payments/page.tsx:37] — folding the new `listPaymentDiscrepancies()` error into the same combined `if (pendingError || discrepanciesError || shellError || !shell)` check means a failure isolated to the new, read-only Discrepancies query now takes down the pre-existing, business-critical Pending Payments verification queue too, instead of degrading gracefully. Fixed: `discrepanciesError` no longer blanks the page — it degrades to an empty Discrepancies section (server-logged) while Pending Payments keeps rendering.
- [x] [Review][Patch] Dead filter with self-contradicting comment in `listPaymentDiscrepancies` [apps/dashboard/services/payments.ts:465] — `.not("payment_id", "is", null)` can never exclude anything: the preceding `.eq("gym_id", gymId)` already excludes every row that could have a null `payment_id` (the only discrepancy type with a null `payment_id` also has a null `gym_id`), which the function's own docstring one line above already acknowledges ("no need for the code to special-case that type") while the code adds that special case anyway. Fixed: dead filter removed.
- [x] [Review][Patch] Unchecked type cast in `listPaymentDiscrepancies` [apps/dashboard/services/payments.ts:474] — `row.discrepancy_type as "stale_processing" | "amount_mismatch"` casts a raw DB `string` without a runtime guard; if a third discrepancy type ever produced a non-null `payment_id` row, this would silently mislabel it rather than failing loudly. Fixed: added an `isDisplayableDiscrepancyType` type guard that filters out any unexpected value instead of mislabeling it.
- [x] [Review][Defer] `amount_mismatch` detection and UI never compare/show `currency` [supabase/migrations/0032_payment_reconciliation_job.sql:152-158, apps/dashboard/services/payments.ts, PaymentsPageClient.tsx] — deferred, currently a dead path since `payments.currency`/`payment_webhook_events.currency` are always `'XAF'` app-wide (no multi-currency flow exists anywhere in the product yet), but a same-numeric/different-currency mismatch would go fully undetected if that ever changes.
- [x] [Review][Defer] New FKs lack an explicit `ON DELETE` clause [supabase/migrations/0032_payment_reconciliation_job.sql:19,25,59,60] — deferred, not reachable through any delete path in this diff (the only `payments` row deletion, in `handleInitiate`'s failure cleanup, always runs before a webhook/discrepancy row could exist for that payment), but a landmine for any future payments-deletion path (GDPR/data-retention, admin cleanup).
- [x] [Review][Defer] `payment_webhook_events.status` CHECK constraint only permits `('verified', 'flagged')` while `NormalizedPaymentEvent.status`'s type (`supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts:45`) still allows `"processing"` — deferred, currently unreachable since the sole real provider (`TaraMoneyProvider`) only ever emits `verified`/`flagged`, but a future second provider (AC #4) that reports something else would throw on insert, get silently swallowed by the non-blocking `console.error`, and permanently defeat AC #1 for that event.

### Not Independently Verified

The following Dev Agent Record claims require actual command/runtime execution and could not be confirmed from a static diff review alone (no contradiction found — the visible SQL/TS/i18n changes are structurally consistent with each claim): `supabase db reset` applying cleanly; `supabase test db` passing 426/426 assertions with zero regressions (the stated arithmetic — 405 baseline + 19 new + 2 added — is internally consistent with `plan(19)`/`plan(15)` in the two test files); `pnpm run typecheck` 4/4 packages clean; `check-i18n-key-parity.mjs` clean; the hands-on `cron.job` registration check; and the hands-on signed-webhook round-trip verifying AC #1 end-to-end (the one path pgTAP can't reach, per the story's own documented convention).

## Dev Notes

- **Read `supabase/functions/payment-webhook/index.ts` in full before starting.** Task 2 restructures its existing control flow (moving the `payments` lookup earlier so both the verified and declined branches can use it) — this is not a bolt-on at the end of the file.
- **Read `apps/dashboard/services/payments.ts` and `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` in full before starting** — both already exist (Story 4.3) and this story extends them in place, following the exact `getCallerGymId()`/toast/refresh conventions already established there.
- **`payment_status` (the enum) and every existing `payments` RLS policy/trigger from 0030/0031 are untouched by this story.** No migration in this story touches the `payments` table's own columns, policies, or the `protect_payment_columns_on_staff_verify()` trigger — discrepancies live entirely in the two new tables (Scope Note).
- **The reconciliation job is read/insert-only into the two new tables — it never writes to `payments`.** It does not transition a stuck `processing` row to any other status, even when the underlying cause is a declined webhook the job now indirectly makes visible (Scope Note's "closes, partially" note). No AC asks for an auto-transition; building one would be inventing scope.
- **Idempotency discipline matches Story 3.1's Scope Note #2 exactly**: every detection query is a plain, absolute-condition `SELECT` against current state (`status = 'processing' AND created_at < now() - interval '10 minutes'`, `amount <> amount`, `matched_payment_id IS NULL`) — never "since the last successful run" delta logic. The three partial unique indexes plus `ON CONFLICT ... DO NOTHING` are what make repeated nightly runs safe without ever needing to track "have I already looked at this row."
- **Money handling (FR-026/NFR-003):** `payment_webhook_events.amount` and every `details` jsonb amount field stay integer XAF, matching every other monetary field in this schema. No new floating-point handling anywhere in this story.
- **Testing standard:** pgTAP is the primary automated coverage (Task 7), matching every prior RLS/cron-shaped story in this epic (3.1, 3.4, 3.5). The Edge Function's own new persistence logic (Task 2) has no automated coverage — same accepted, documented gap as 4.1/4.2's webhook-provider code, verified hands-on instead (Task 8).
- **CI/typecheck gap**: unlike Story 4.3 (no Edge Function changes), this story **does** touch Deno code (Task 2) — the same `pnpm typecheck`-doesn't-cover-`supabase/functions/` gap 4.1/4.2 already documented applies here too.

### Project Structure Notes

- File layout to create/modify:
  ```
  supabase/migrations/0032_payment_reconciliation_job.sql          (new)
  supabase/tests/payment_reconciliation_job.test.sql                (new)
  supabase/functions/payment-webhook/index.ts                       (modified — restructured receive path)
  packages/types/src/database.ts                                    (regenerated)
  apps/dashboard/services/payments.ts                                (modified — extended, not replaced)
  apps/dashboard/app/(dashboard)/payments/page.tsx                  (modified)
  apps/dashboard/app/(dashboard)/payments/paymentLabels.ts          (modified)
  apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx (modified)
  apps/dashboard/locales/en.json                                    (modified)
  apps/dashboard/locales/fr.json                                    (modified)
  docs/decisions.md                                                 (modified)
  _bmad-output/implementation-artifacts/deferred-work.md            (modified)
  ```
- No new Server Action / `actions.ts` entry needed — this story is entirely read-only from the dashboard's perspective (the reconciliation job is the only writer of the new tables, running as `postgres` via `pg_cron`). `apps/dashboard/app/(dashboard)/payments/actions.ts` (Story 4.3) is not modified.
- No new Zod schema in `packages/types/src/schemas/payment.ts` — no user-submitted form exists for this story (display-only).
- `apps/mobile` and `apps/super-admin` are untouched by this story (confirmed against the Scope Note's decision not to build a Super Admin surface for the unattributable case).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — literal AC text
- [Source: _bmad-output/planning-artifacts/epics.md#FR-036] — "nightly reconciliation job matches provider-confirmed payments against internal records; discrepancies (missing internal record, `processing` record with no webhook within 10 minutes, amount mismatch) are flagged on the Payments dashboard"
- [Source: _bmad-output/planning-artifacts/architecture.md#Working Decisions] — "Three independent `pg_cron` triggers... each logging to a `job_runs` table"; Edge Functions "reserved for the Notch Pay webhook receiver only"
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping] — Payments (FR-033–041) maps to `supabase/functions/notch-pay-webhook/`, `0005`, `0011` (RLS), `0015` (reconciliation, aspirational numbering — real migration is `0032`, matching the already-established drift documented for every other cron job's real migration number)
- [Source: supabase/migrations/0021_subscription_lifecycle_cron.sql] — the exact `BEGIN...EXCEPTION`/`job_runs`/`log_audit_event` failure-handling shape this story's job copies; the "cron runs as `postgres`, no special grant" precedent
- [Source: supabase/migrations/0024_check_out_manual_auto_timeout.sql] — second precedent for the same cron-job shape, confirms the pattern is now established (this is the third such job)
- [Source: docs/decisions.md#2026-07-18 — Correction: pg_cron scheduled jobs run as postgres] — explicitly names "payment reconciliation" as one of the two remaining jobs that must follow the no-special-grant convention
- [Source: supabase/functions/payment-webhook/index.ts] — the exact file/control-flow this story restructures (Task 2)
- [Source: supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts#NormalizedPaymentEvent] — `status`/`amount`/`reference`/`feeAmount` shape this story persists
- [Source: supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts] — confirms `productId` (→ `NormalizedPaymentEvent.reference`) is always our own `payments.id`, and that `amount`/`originalAmount` parsing already guards against non-numeric/negative values before this story's code ever sees them
- [Source: supabase/migrations/0005_payments.sql, 0030_payment_initiation_and_renewal.sql] — `payments` schema and `complete_verified_payment()`'s existing matching-by-`provider_transaction_ref` logic this story's event log runs alongside, unmodified
- [Source: supabase/migrations/0029_payment_provider_registry.sql] — `payment_providers.provider_key` FK target for `payment_webhook_events.provider_key`
- [Source: _bmad-output/implementation-artifacts/4-3-manual-payment-entry-verification-queue.md] — Scope Note's "two independent things share the enum value 'flagged'" speculation this story supersedes with a different mechanism; AD-09's Verification Queue precedent this story's Discrepancies section mirrors structurally
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: code review of story-4-2-notch-pay-payment-integration] — "Failed/declined ('flagged') webhook deliveries leave the `payments` row at `processing` forever... assigned to Story 4.4's reconciliation-job concern" — the gap this story's AC #2 structurally (not explicitly) closes
- [Source: apps/dashboard/services/payments.ts, apps/dashboard/app/(dashboard)/payments/*] — exact files/patterns this story extends (Story 4.3)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#AD-09] — "Discrepancy rows: amber highlight + 'Discrepancy' tag in Status column" inside the not-yet-built "All Payments" table — the mockup element this story's own resolved-design Discrepancies section substitutes for (Scope Note)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `supabase db reset` applied `0032_payment_reconciliation_job.sql` cleanly against the full existing migration chain (0001–0031), no errors.
- `supabase gen types typescript --local` diff reviewed line-by-line before accepting into `packages/types/src/database.ts`: exactly the expected new `payment_discrepancies`/`payment_webhook_events` Row/Insert/Update/Relationships shapes, the `payment_discrepancy_type` enum, and `run_payment_reconciliation_job`'s Args/Returns — no unrelated diff.
- `supabase test db`: `All tests successful. Files=25, Tests=426, ... Result: PASS` — 426 assertions total (405 pre-story baseline + 19 new `payment_reconciliation_job.test.sql` + 2 added to `rls_tenant_isolation.test.sql`'s cross-cutting sweep). Zero regressions.
- `pnpm run typecheck`: 4/4 packages (`@gymos/types`, `@gymos/dashboard`, `@gymos/mobile`, `@gymos/super-admin`) succeeded, 0 errors.
- `node scripts/check-i18n-key-parity.mjs`: all 4 locale namespaces in parity, including `apps/dashboard/locales` (304 keys, en/fr).
- Hands-on cron verification: `docker exec supabase_db_gym_os psql -U postgres -d postgres -c "select jobname, schedule, active from cron.job where jobname = 'payment_reconciliation';"` → `payment_reconciliation | 15 1 * * * | t`.
- Hands-on webhook verification (the one path pgTAP can't exercise end-to-end, matching 4.1/4.2's own convention): started `supabase functions serve payment-webhook --env-file supabase/.env`, sent a real signed POST to `http://127.0.0.1:54321/functions/v1/payment-webhook/taramoney` (header `tara-webhook-secret` matching `supabase/.env`'s real `TARAMONEY_WEBHOOK_SECRET`) with `paymentId: "manual-test-unmatched-4-4"`, a reference matching no `payments` row. Response: `200 {}`. Confirmed `payment_webhook_events` row written with `matched_payment_id` NULL. Ran `run_payment_reconciliation_job()` directly and confirmed the resulting `missing_internal_record` discrepancy row (`gym_id` NULL, `details` containing `providerTransactionRef`/`webhookAmount`/`reference`). Stopped the local functions-serve process and ran `supabase db reset` afterward — no fixture data left in the local DB (same discipline as Story 4.2's own real-provider test cleanup).

### Completion Notes List

- New `supabase/migrations/0032_payment_reconciliation_job.sql`: `payment_discrepancy_type` enum; `payment_webhook_events` (deny-all RLS, written only by the webhook receiver) and `payment_discrepancies` (gym-scoped, staff-only SELECT policy, three discrepancy types) tables; `run_payment_reconciliation_job()` (three set-based, idempotent-by-construction `INSERT ... ON CONFLICT DO NOTHING` detection queries, `job_runs`/`log_audit_event` failure handling copied from `run_subscription_lifecycle_job()`'s shape); `payment_reconciliation` cron job at `15 1 * * *`.
- `supabase/functions/payment-webhook/index.ts`: the `payments` lookup by `provider_transaction_ref` now runs before the `event.status !== "verified"` branch (previously only the verified path attempted it); every signature-verified delivery (matched or not, verified or declined) is now persisted to `payment_webhook_events` via an idempotent upsert, with a logged-but-non-blocking failure path so reconciliation-log durability never blocks real payment completion.
- `packages/types/src/database.ts` regenerated to include the two new tables' types and the new enum/function signature.
- `apps/dashboard/services/payments.ts`: new `listPaymentDiscrepancies()`, gym-scoped (RLS + explicit `.eq` defense-in-depth), joined to `payments`/`members` for display fields, excluding the gym-unattributable `missing_internal_record` type by construction (`payment_id is not null`).
- Payments page: new read-only "Discrepancies" section (`PaymentsPageClient.tsx`) below the Verification Queue, rendered only when ≥1 row exists, with type badges, an internal-vs-reported amount line for `amount_mismatch` rows, and locale-aware detected-at timestamps (`i18n.language`, not bare `toLocaleString()`).
- i18n: new `payments.discrepancies.*` keys added to both `en.json`/`fr.json`, parity-checked.
- `docs/decisions.md` and `deferred-work.md`: recorded the `payment_webhook_events` log-table decision (superseding Story 4.3's speculative shared-enum note) and the deliberate, reasoned V1 gap of no UI for the gym-unattributable `missing_internal_record` discrepancy type.
- pgTAP: new `supabase/tests/payment_reconciliation_job.test.sql` (19 assertions) covering all three detection queries, idempotency, and RLS (deny-all for `payment_webhook_events`; gym-scoped/staff-only/NULL-gym-invisible for `payment_discrepancies`). `rls_tenant_isolation.test.sql` extended with 2 assertions for the two new tables' cross-cutting deny-all/staff-gated sweep.
- All 3 ACs satisfied: AC #1 (unmatched webhook → discrepancy, verified hands-on end-to-end), AC #2 (stale `processing` payment → discrepancy, pgTAP), AC #3 (amount mismatch → discrepancy with both amounts in `details`, pgTAP).

### File List

- `supabase/migrations/0032_payment_reconciliation_job.sql` (new)
- `supabase/tests/payment_reconciliation_job.test.sql` (new)
- `supabase/tests/rls_tenant_isolation.test.sql` (modified — 2 new assertions)
- `supabase/functions/payment-webhook/index.ts` (modified)
- `packages/types/src/database.ts` (regenerated)
- `apps/dashboard/services/payments.ts` (modified)
- `apps/dashboard/app/(dashboard)/payments/page.tsx` (modified)
- `apps/dashboard/app/(dashboard)/payments/paymentLabels.ts` (modified)
- `apps/dashboard/app/(dashboard)/payments/components/PaymentsPageClient.tsx` (modified)
- `apps/dashboard/locales/en.json` (modified)
- `apps/dashboard/locales/fr.json` (modified)
- `docs/decisions.md` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)

## Change Log

- 2026-07-31: Story implemented in full — the `payment_webhook_events` log table and `payment_discrepancies` table (`0032` migration), `run_payment_reconciliation_job()`'s three idempotent detection queries plus its `payment_reconciliation` cron schedule, `payment-webhook/index.ts`'s restructured event-persistence path, the read-only Discrepancies section on the Payments page, and the two `docs/decisions.md`/`deferred-work.md` entries recording this story's new-infrastructure scope decisions. Verified via pgTAP (19 new assertions in a new test file plus 2 added to the cross-cutting tenant-isolation sweep, full 25-file/426-assertion suite green), `pnpm typecheck` (4/4 packages) clean, `check-i18n-key-parity` clean, a hands-on `cron.job` registration check, and a hands-on real signed-webhook round-trip through the actual Edge Function confirming the one path pgTAP can't reach end-to-end (AC #1's `missing_internal_record` detection). Status moved to review.
