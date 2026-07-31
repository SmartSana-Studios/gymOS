---
baseline_commit: 6a74be25ca514d5deafc2a6aac1c0d6b236b89d9
---

# Story 4.1: Payment Provider Sandbox Spike & Multi-Gateway Registry (TaraMoney)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want to validate `TaraMoneyProvider` (behind a generalized, multi-gateway-capable `PaymentProvider` interface) against TaraMoney's real sandbox, and build a Super-Admin-switchable payment-provider registry,
so that mobile-money payments are proven to work on a real gateway before the Payments Epic is built on top of it, and the platform owner can add or switch payment gateways later without a code deploy.

## Scope Note — Read Before the Acceptance Criteria

epics.md's literal AC text (below) names **Notch Pay** — the provider architecture.md originally locked in, with Campay explicitly deferred to V2. **This was changed during story creation (2026-07-30, at the user's explicit direction) in two ways:**

1. **The concrete provider under test is now TaraMoney** (`https://taramoney.com/developer`), not Notch Pay. Notch Pay is no longer assumed as even a future fallback — TaraMoney is simply the first of what the user wants to be an open-ended, growing set of gateways.
2. **Scope is expanded from "one hardcoded provider, swappable only by code deploy" to a real multi-gateway registry**: multiple `PaymentProvider` implementations can be registered in code, exactly one is "active" platform-wide at a time, and **the Super Admin can switch the active provider at runtime from the Super Admin dashboard, with no deploy required.** This is new capability with no FR/story number anywhere in epics.md or prd.md — it is being built now because the user asked for it, not because a document requires it.

**What does NOT change:** FR-035 (idempotent webhook processing via a unique constraint on the provider transaction reference), FR-036 (nightly reconciliation), FR-037 (verification queue), FR-039 (fee passthrough), FR-041 (receipt fields) are all provider-agnostic already and are unaffected by which gateway is active. The `payments` table (`0005_payments.sql`) already stores `payment_method` as a generic enum (`mtn_momo`, `orange_money`, `cash`, `bank_transfer`, `manual_momo`) with no gateway name baked in — this story's design builds on that, it doesn't fight it.

**architecture.md is not edited** (matches this project's established practice — see `docs/decisions.md`'s many "architecture deviation, recorded not silently applied" entries). Two real deviations from its text are called out explicitly in Dev Notes: (a) the Edge Function is renamed `payment-webhook` (generic), not `notch-pay-webhook`; (b) provider selection becomes DB-backed and Super-Admin-editable at runtime, not an env var picked at deploy time (the `OTP_PROVIDER` pattern Story 2.1 established). Both should be recorded as dated `docs/decisions.md` entries during dev-story, the same way Story 2.1 recorded its own provider-selection deviations.

## ⚠️ Critical Context: This Spike Needs a Real TaraMoney Account — Read Before Starting

**This is a measurement/decision spike with a registry-architecture deliverable, not a feature build.** No `apps/dashboard` Payments UI, no reconciliation job, no manual-payment entry — those are Stories 4.2–4.4's job. Resist building beyond: (a) the generalized `PaymentProvider` interface + a `TaraMoneyProvider` implementation, (b) the DB-backed provider registry + Super Admin switcher UI, (c) the generic webhook Edge Function, (d) the real sandbox spike itself, (e) the `docs/decisions.md` record.

**The dev agent cannot execute the real spike alone, and TaraMoney's public docs are not usable as-is.** `https://taramoney.com/developer` is a client-rendered SPA — it did not yield API details to either web search or a direct fetch during story creation (same class of gap Story 1.2 hit for RTT measurement, and Story 2.1 hit for sent.dm's real template behavior). **Per the user's explicit direction (2026-07-30): they will provide real TaraMoney API credentials and/or documentation when this story reaches `dev-story`, not before.** Do not guess at TaraMoney's authentication scheme, endpoint shapes, or webhook signature mechanism and hardcode them as if confirmed — build `TaraMoneyProvider` as an isolated, clearly-flagged-as-unverified implementation behind the interface, and **stop and ask the user for the real API reference before writing `verifyWebhookSignature`'s actual logic or the real request/response field mapping.** Guessing wrong here is worse than asking — a webhook signature scheme that's silently wrong fails closed in the best case (no payments ever process) and is a real security hole in the worst case (unsigned/forged webhooks accepted).

**Minimum the user needs to supply before Task 9 (the real spike) can run:**
- A TaraMoney sandbox/test account with API key(s)
- TaraMoney's actual API reference (auth header shape, initiate-payment endpoint + fields, webhook payload + signature verification mechanism) — or direct account access so the dev agent can inspect it
- Confirmation of which Cameroon mobile-money rails TaraMoney actually supports in sandbox (MTN MoMo / Orange Money, per FR-033) so the spike tests a real, relevant flow

## Acceptance Criteria

**TaraMoney spike (adapted from epics.md's Notch-Pay-specific AC, same exit-criteria shape):**

1. **Given** the TaraMoney sandbox, **when** I run auth, a payment initiation, and a webhook round-trip, **then** sandbox auth succeeds, initiation returns a reference, and the webhook is received and processed. [Source: epics.md#Story 4.1, adapted per Scope Note]
2. **Given** a duplicate webhook delivery, **when** it's replayed, **then** the idempotency test passes — no duplicate payment record is created (enforced via `payments.provider_transaction_ref`'s existing unique constraint, `0005_payments.sql`). [Source: epics.md#Story 4.1]
3. **Given** the spike fails any exit criterion, **when** that occurs, **then** no payment-processing code is marked active/default until an alternative integration is validated and documented in `docs/decisions.md`. **Under the expanded registry design, this means: no `payment_providers` row is set `is_active = true` until at least one provider has passed this spike** — the registry/Super-Admin-switcher scaffolding itself may still ship even if TaraMoney's spike fails, since it's the exact mechanism that lets a different, validated provider be activated instead. [Source: epics.md#Story 4.1, generalized per Scope Note]

**New: multi-gateway registry (no FR/story source — user-directed, 2026-07-30):**

4. **Given** the `PaymentProvider` interface, **when** a new concrete provider is added in code, **then** no schema migration is required to make it *registrable* — only a new `payment_providers` row (via the Super Admin UI or a follow-up migration) is needed to make it *selectable*. Writing the new provider's adapter class itself is still real engineering work; this AC is about the *switching* mechanism being schema-stable, not about zero-code multi-gateway support.
5. **Given** more than one `payment_providers` row exists, **when** any state is queried, **then** exactly one row has `is_active = true` at all times, enforced at the database level (not just app logic).
6. **Given** the Super Admin dashboard, **when** a Super Admin views the new payment-providers page, **then** they see every registered provider and which one is active, and can activate a different registered provider in one action.
7. **Given** a Super Admin activates a different provider, **when** the action completes, **then** it is audit-logged (actor, previous active provider, new active provider, timestamp), matching every other Super Admin lifecycle action's audit discipline (Story 1.6 precedent).
8. **Given** a non-Super-Admin session (owner/manager/receptionist/coach), **when** they attempt to read or change `payment_providers` directly, **then** RLS denies it — this is a platform-wide setting, not gym-scoped, and no gym-level role has any access to it (mirrors `tiers`).
9. **Given** any authenticated gym-scoped session, **when** it calls the new `active_payment_provider()` read function, **then** it receives the current active provider's key — this is the one narrow read path Story 4.2 needs to know which concrete provider to instantiate for a real payment; it does not expose the full `payment_providers` table.

## Tasks / Subtasks

- [x] **Task 1: TaraMoney sandbox account and API reference (user-provided prerequisite — blocks Task 9 only)** (AC: #1)
  - [x] Obtain a TaraMoney sandbox/test account and API key(s) from the user. **Note: the key the user provided is labeled "Production key" by TaraMoney's own dashboard — no separate sandbox environment/base URL exists anywhere in the real API reference. See docs/decisions.md.**
  - [x] Obtain (or get direct access to) TaraMoney's real API reference: authentication scheme, payment-initiation endpoint, webhook payload shape. **Webhook signature verification mechanism (header name(s), algorithm) is NOT documented anywhere in the real API reference (checked in full) — remains genuinely unconfirmed, flagged as a stub per Task 3.**
  - [x] Confirm which Cameroon mobile-money methods TaraMoney's sandbox actually exercises (MTN MoMo / Orange Money per FR-033) — both are listed in the real API reference (`MTN_MOMO_CMR`, `ORANGE_CMR`); actual sandbox behavior still needs Task 9's real test.
  - [x] Store real credentials in `supabase/.env` only (gitignored — same pattern Story 2.1 established for `TWILIO_*`/`SENT_DM_*`). Never commit real keys.

- [x] **Task 2: Generalize the `PaymentProvider` interface** (AC: #4)
  - [x] Create `supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts`. Design it gateway-agnostic from the start (this is the whole point of the registry) — do not name anything after TaraMoney or Notch Pay inside the interface itself. Minimum shape, adjust once Task 1's real API reference is in hand:
    ```ts
    export interface InitiatePaymentParams {
      amount: number; // integer, smallest currency unit per FR-026 (XAF has no subunit — whole francs)
      currency: string; // "XAF" for V1
      reference: string; // our own idempotency reference, distinct from the provider's own transaction ref
      callbackUrl: string;
      memberName?: string;
      description?: string;
    }
    export interface InitiatePaymentResult {
      success: true;
      providerTransactionRef: string; // maps to payments.provider_transaction_ref
      authorizationUrl?: string; // present if the provider requires a redirect/USSD-prompt step
    } | { success: false; error: string };

    export interface WebhookVerificationResult {
      valid: boolean;
      event?: NormalizedPaymentEvent; // only present if valid
    }
    export interface NormalizedPaymentEvent {
      providerTransactionRef: string;
      status: "processing" | "verified" | "flagged"; // maps to the existing payment_status enum, 0001_extensions_and_enums.sql
      amount: number;
      currency: string;
    }

    export interface PaymentProvider {
      readonly providerKey: string; // must match a payment_providers.provider_key row
      initiate(params: InitiatePaymentParams): Promise<InitiatePaymentResult>;
      verifyWebhookSignature(payload: string, headers: Record<string, string>): WebhookVerificationResult;
    }
    ```
  - [x] This interface owns the call contract only — entity shapes that touch the DB (`Payment`) stay the generated type from `packages/types`, matching architecture.md's Service Boundaries rule and the same discipline `OtpDeliveryProvider` already follows.
  - [x] Mirror `send-sms-hook`'s `_shared/otp-providers/httpHelpers.ts` pattern (`fetchWithTimeout`, shared error-result helper) in a new `_shared/payment-providers/httpHelpers.ts` — do not re-invent timeout/error handling per provider.

- [x] **Task 3: `TaraMoneyProvider` implementation — best-effort skeleton, flag every unverified assumption** (AC: #1)
  - [x] Create `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts` implementing `PaymentProvider`. **`verifyWebhookSignature` throws a clearly-marked "not yet confirmed" error (mechanism is genuinely undocumented anywhere in the real API reference — see Task 1) rather than guessing.** Also discovered and fixed: the real `InitiatePaymentParams` interface needed a `phoneNumber` field TaraMoney's API requires but the story's draft interface omitted (TaraMoney's mobile-money endpoint triggers the USSD prompt server-side, unlike a redirect-based gateway).
  - [x] Read credentials via `Deno.env.get(...)`, matching this project's `env(...)`-everywhere convention — never hardcoded.
  - [x] On any non-success provider response, return `{ success: false, error: ... }` — never throw, matching `TwilioSmsProvider`'s established contract.

- [x] **Task 4: Migration `0029_payment_provider_registry.sql`** (AC: #2, #4, #5, #8, #9)
  - [x] `payment_providers` table: `id uuid primary key default gen_random_uuid()`, `provider_key text not null`, `display_name text not null`, `is_active boolean not null default false`, `created_at timestamptz not null default now()`. Enable RLS with a deny-all default in this same migration (no "open table" window — matches every prior table's discipline).
  - [x] `create unique index idx_payment_providers_key_unique on payment_providers (provider_key);`
  - [x] `create unique index idx_payment_providers_one_active on payment_providers (is_active) where is_active;` — the same partial-unique-index technique already established for "at most one open check-in per member" (`idx_attendance_events_one_open_per_member`, Story 3.4) — DB-enforced, not just app-logic-enforced (AC #5). Verified via pgTAP: a raw UPDATE bypassing RLS still hits the index.
  - [x] `super_admin_read_payment_providers` SELECT policy (`private.is_super_admin()`) — the only RLS policy this table needs. **No INSERT/UPDATE/DELETE policy for any role** — the only sanctioned mutation path is the `activate_payment_provider()` RPC below (`security definer`), matching this project's precedent of a single blessed write path for a sensitive invariant (same posture as `log_audit_event()` being the only path into `audit_log`).
  - [x] `activate_payment_provider(p_provider_key text) returns void`, `security definer`, `set search_path = public`: raises if the caller isn't `private.is_super_admin()`; raises if `p_provider_key` doesn't exist; deactivates whichever row is currently active, activates the target row, and calls `log_audit_event(...)` in the same transaction (AC #7). `revoke execute ... from public; grant execute ... to authenticated;`.
  - [x] `active_payment_provider() returns text`, `language sql stable security definer set search_path = public`: `select provider_key from payment_providers where is_active limit 1;`. `grant execute ... to authenticated, service_role;`.
  - [x] Seed exactly one row: `insert into payment_providers (provider_key, display_name, is_active) values ('taramoney', 'TaraMoney', true);`.
  - [x] Same migration: `alter table payments add column provider text references payment_providers(provider_key);` (nullable).
  - [x] Record this migration's design in `docs/decisions.md` (2026-07-31 entry).

- [x] **Task 5: `payment-webhook` Edge Function** (AC: #1, #2)
  - [x] Create `supabase/functions/payment-webhook/index.ts`. Deviates from architecture.md's `notch-pay-webhook` naming — recorded in `docs/decisions.md`.
  - [x] Provider dispatch: parse the provider key from the request URL's path suffix. Verified live: unknown provider path → `404`.
  - [x] Do not gate webhook acceptance on `is_active` — verified unconditionally against whichever provider the URL path names.
  - [x] Look up the matching `PaymentProvider` implementation by key from a small in-file registry map (`{ taramoney: TaraMoneyProvider }`).
  - [x] Verify the webhook signature via the resolved provider's `verifyWebhookSignature()`. Verified live: an unsigned/unverifiable webhook → `HTTP 401` (fails closed, matching NFR-002 — currently every TaraMoney webhook 401s until Task 9 supplies the real signature mechanism).
  - [x] On a valid, verified webhook: upsert the matching `payments` row keyed by `provider_transaction_ref`. **Real gap discovered from the API reference: TaraMoney's initiate response carries no transaction reference at all (only `message`/`status`/`vendor`), and the two documented webhook payload shapes disagree on whether `productId` (our own correlation reference) is even present.** Implemented defensively (optional `reference` field, logged-not-guessed when absent) — see TaraMoneyProvider.ts comments and docs/decisions.md.
  - [x] Create `supabase/functions/payment-webhook/deno.json`, mirroring `send-sms-hook/deno.json`'s shape.
  - [x] Add `[functions.payment-webhook]` with `verify_jwt = false` to `supabase/config.toml`.

- [x] **Task 6: Super Admin payment-providers page** (AC: #6, #7, #8)
  - [x] `apps/super-admin/services/payment-providers.ts`: `listPaymentProviders()`, `activatePaymentProvider(providerKey)` — matches `services/tiers.ts`'s thin-CRUD-primitives split.
  - [x] `apps/super-admin/app/(admin)/payment-providers/actions.ts`: `setActivePaymentProvider` Server Action, `{ data, error }` contract via `mapSupabaseError`.
  - [x] `page.tsx` (Server Component + `<Suspense>`) + `loading.tsx` (2-row skeleton).
  - [x] Minimal list UI (`components/PaymentProvidersPageClient.tsx`): provider key, display name, active/inactive `Badge`, "Activate" button per inactive row.
  - [x] New locale keys in `apps/super-admin/locales/{en,fr}.json` — `check:i18n` parity check passes.
  - [x] Added `/payment-providers` nav entry to the Super Admin layout, inside the existing Super-Admin-role-gated `AdminLayout`.

- [x] **Task 7: `packages/types` regeneration** (AC: #4, #5)
  - [x] `supabase gen types typescript --local` → `packages/types/src/database.ts` — diffed; changes are exactly the new `payment_providers` table, `payments.provider` column, and the two new RPC function signatures.
  - [x] Added `activatePaymentProviderSchema` to `packages/types/src/schemas/paymentProvider.ts` (minimal — a provider-key string), matching the codebase's "every Server Action parses via a Zod schema first" convention.

- [x] **Task 8: Local secrets and config wiring** (AC: #1)
  - [x] Added real TaraMoney credentials (`TARAMONEY_API_KEY`, `TARAMONEY_BUSINESS_ID`, `TARAMONEY_WEBHOOK_SECRET`) to `supabase/.env` (gitignored, confirmed via `git check-ignore`). Not added to any app's `.env.local`/`.env.example`.
  - [x] Wired `[functions.payment-webhook]` into `supabase/config.toml` — confirmed `send-sms-hook`'s existing config block is unaffected.

- [x] **Task 9: Run the real spike (AC: #1, #2, #3) — blocked on Task 1, requires the user**
  - [x] Start local Supabase (WSL2 Docker) and serve `payment-webhook` locally (`supabase functions serve payment-webhook --env-file supabase/.env`).
  - [x] Real TaraMoney auth + a real payment initiation attempted, with the user's explicit real-time authorization (100 XAF to `237659172788`). **Result: `HTTP 200 {"status":"ERROR","message":"BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT"}`.** No sandbox exists to fall back to (confirmed absent across all 9 real API reference docs) — this is TaraMoney's only environment. No payment was created (`transactionList: []`), no money moved. Full evidence in `docs/decisions.md`.
  - [x] Webhook round-trip / replay: **not reachable on the first attempt** — no payment was ever created on TaraMoney's side, so no webhook was ever sent (confirmed: 0 requests captured at the webhook.site endpoint used to safely observe the real webhook shape without exposing the local Supabase stack's default dev keys to the public internet).
  - [x] ~~If the spike passes: confirm seeded row is_active = true~~ — was N/A on the first attempt (spike failed); **superseded by the re-run below, which passed — see that entry for the confirmed `is_active = true` state.**
  - [x] Spike **failed on the first attempt** (account-provisioning gap on TaraMoney's side, not a code defect — see docs/decisions.md for why). Per AC #3: `0029_payment_provider_registry.sql`'s seed changed to `is_active = false` for `taramoney` before ever being shared. Documented honestly, same standard as Story 2.1's sent.dm failure.

  - [x] **Re-run, same day (2026-07-31), against a separate Temporal TaraMoney business — PASSED.** The GYM OS business (`9FmIZg9GBB`) remained unactivated, so the user supplied a second, already-activated TaraMoney business ("Temporal KEYS": `businessId wxND8vZv5v`) as a stand-in; `supabase/.env` was swapped to it. With the user's real-time authorization, a real 100 XAF Orange Money collection was initiated to `237659172788` — `HTTP 200 {"status":"SUCCESS","transactionId":"719152650",...}` — confirmed via a real USSD prompt (`#150*50#`) dialed by the user. TaraMoney then delivered a real webhook to the webhook.site capture URL, carrying header `tara-webhook-secret: CnfQfFWuwP3CoC0mXzNdKLAi` matching the configured secret exactly — **this resolves the signature-verification unknown**: it's a shared-secret header match, not HMAC. `verifyWebhookSignature()` is now implemented for real (no longer a `throw` stub). The real payload also confirmed `productId` and `mobileOperator` are both present on a real delivery, resolving two other documented ambiguities — `index.ts`'s vendor→`payment_method` mapping is now real (`orange_money` confirmed; `mtn_momo` fallback still unverified against a real MTN delivery). Idempotency (AC #2) was verified by replaying the real payload (reference rewritten to a throwaway gym/member fixture, deleted after) against the local function twice: first delivery created one `payments` row, the replay created zero additional rows, and a wrong-secret request correctly 401'd. `payment_providers.taramoney.is_active` is now `true` (both the running local DB and `0029`'s seed), activated via a direct `log_audit_event()` call (system actor, not the Super Admin RPC, since no real Super Admin session was involved) to preserve the audit trail. Full evidence in `docs/decisions.md`'s companion entry. **Still open:** `9FmIZg9GBB` itself remains unactivated — this pass validates the code path and TaraMoney's real behavior, not that specific business account.

- [x] **Task 10: Record the outcome in `docs/decisions.md`** (AC: #1, #2, #3)
  - [x] Two dated entries (2026-07-31): the Notch Pay → TaraMoney pivot + multi-gateway-registry scope expansion + `payment-webhook` rename (schema-design entry), and the real spike's exact pass/fail evidence with full request/response detail + the final `payment_providers.is_active` state this story leaves the system in (spike-outcome entry).

### Review Findings

- [x] [Review][Patch] Real TaraMoney credentials (apiKey, businessId, webhookSecret), a real phone number, and a local personal file path committed in plaintext to `docs/decisions.md` [docs/decisions.md:7-40] — fixed: all real values redacted to placeholders in `docs/decisions.md` and the matching path comment in `TaraMoneyProvider.ts`. **Still open, user decision needed:** whether to rotate the leaked `webhookSecret`/`apiKey` with TaraMoney now that they briefly sat in a working-tree file.
- [x] [Review][Patch] Webhook signature check is a plain, non-constant-time string comparison (`received !== expected`) — the sole authentication mechanism for the webhook endpoint [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:144] — fixed: added a `constantTimeEqual()` helper and used it in `verifyWebhookSignature()`.
- [x] [Review][Patch] A non-verified/failed webhook status returns `200` with zero logging and zero persistence — a real failed payment attempt leaves no trace anywhere [supabase/functions/payment-webhook/index.ts:78-83] — fixed: added a `console.error` log line on this branch.
- [x] [Review][Patch] A malformed/non-numeric webhook `amount` produces `NaN` → serializes to `null` → violates `payments.amount NOT NULL` → generic `500`, indistinguishable from a transient failure and risking endless gateway retries instead of a fast 4xx rejection [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:177, supabase/functions/payment-webhook/index.ts:125-128] — fixed: `normalizeTaraMoneyWebhook()` now validates the amount is finite and non-negative, returning `null` (→ webhook rejected with 401) for an unparseable value instead of silently producing NaN/0.
- [x] [Review][Patch] `errorResult()` in `httpHelpers.ts` is unused dead code — `TaraMoneyProvider.initiate()` duplicates the same logic inline instead of calling it [supabase/functions/payment-webhook/_shared/payment-providers/httpHelpers.ts:9, TaraMoneyProvider.ts:107-110] — fixed: `initiate()` now calls `errorResult()` for the non-ok response branch.
- [x] [Review][Patch] `TaraMoneyInitiateResponse` has no runtime validation — `await result.json()` is cast directly with no shape check, so a malformed `200` response can throw an uncaught exception instead of the typed failure shape every other branch returns [TaraMoneyProvider.ts:112-117] — fixed: added `isTaraMoneyInitiateResponse()` type guard, checked before the response body is used.
- [x] [Review][Patch] `activate_payment_provider()` reads the previously-active provider without row locking (no `for update`) — concurrent activation calls can record an incorrect `previous_provider_key` in the audit log, even though the exactly-one-active invariant itself still holds via the unique index [supabase/migrations/0029_payment_provider_registry.sql:69] — fixed: added `for update` to the previous-active-row select.
- [x] [Review][Patch] Super Admin activate button's `try { } finally { }` has no `catch` — if the Server Action throws instead of resolving `{ error }`, the button silently resets with no error shown to the admin [apps/super-admin/app/(admin)/payment-providers/components/PaymentProvidersPageClient.tsx:32-41] — fixed: added a `catch` that sets `common.somethingWentWrong` as the displayed error.
- [x] [Review][Defer] `originalAmount` (TaraMoney's fee-adjusted amount) is parsed off the real webhook payload and commented as "FR-039 fee-passthrough relevance," but never propagated to `NormalizedPaymentEvent` or persisted anywhere [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:49] — deferred, pre-existing scope boundary: real fee-passthrough handling is Story 4.2+'s job; flagged so this field-availability finding isn't rediscovered from scratch.
- [x] [Review][Defer] `payments.provider_transaction_ref` carries one global `unique` constraint (pre-existing, `0005_payments.sql`), not scoped per-provider — a future second real gateway producing a colliding reference string could silently collide via this story's upsert `onConflict` target [supabase/migrations/0005_payments.sql:14, supabase/functions/payment-webhook/index.ts:106-123] — deferred, pre-existing: only one real provider exists today so it isn't reachable yet; worth a composite-uniqueness follow-up once a second gateway is added.
- [x] [Review][Defer] `payment_providers` grants table-level INSERT/UPDATE/DELETE to `service_role` (which conventionally bypasses RLS in Supabase) despite the "single blessed write path via `activate_payment_provider()`" design narrative [supabase/migrations/0029_payment_provider_registry.sql:26] — deferred, pre-existing: identical to the baseline GRANT convention already used on every other table in this repo (tiers, gyms, users, payments, etc.), not unique to this diff.
- [x] [Review][Defer] `sprint-status.yaml` also flips Story 3.10 to `done` in this same diff, unrelated to Story 4.1 [_bmad-output/implementation-artifacts/sprint-status.yaml] — deferred, pre-existing: diff-hygiene note only, not a code defect.

## Dev Notes

- **This is a spike-plus-scaffolding story, not a feature build.** No `apps/dashboard` Payments page, no manual payment entry, no reconciliation job — Stories 4.2–4.4 own those. Building them here would be scope creep even under the expanded registry direction.
- **Why the registry is a DB row + RPC pair, not an env var:** the whole point of the user's request is Super-Admin-driven runtime switching with no deploy — `OTP_PROVIDER` (Story 2.1's pattern) is deliberately *not* reused here because it requires a redeploy to change. This is a genuinely different mechanism for a genuinely different requirement (deploy-time swap vs. runtime, non-technical-user-driven swap), not an inconsistency with Story 2.1's approach.
- **Adding a brand-new gateway later is still real engineering work.** AC #4 is about the *switching* mechanism being schema-stable (no migration needed to flip which already-coded provider is active), not about a zero-code universal adapter. Do not build a dynamic plugin-loading system, a provider marketplace, or anything that tries to support an arbitrary future API with no new code — that's over-engineering nothing in this story or the user's request calls for. A second provider still means a second `_shared/payment-providers/<X>Provider.ts` class and a registry-map entry in `payment-webhook/index.ts`.
- **Webhook signature verification is genuinely unknown right now — this is the single highest-risk unknown in this story.** Do not invent a plausible-sounding HMAC scheme and ship it as if confirmed. Story 2.1's Decision 4/#5 bugs (wrong header format, wrong param names) were all found only by running the real spike against a real account — expect the same here, and budget for it rather than assuming the first-guess implementation is correct.
- **`payment_providers` is platform-wide, not gym-scoped** — same category as `tiers` (Story 1.6): one setting for the whole platform, Super-Admin-controlled, no per-gym override. If a future request wants per-gym provider choice, that's a different table shape and a new decision, not assumed here.
- **The `PaymentProvider`/`OtpDeliveryProvider` shared-pattern intent (architecture.md's Decision Impact Analysis) still holds** — keep `_shared/payment-providers/` structurally parallel to `_shared/otp-providers/` (interface file separate from implementation files, shared `httpHelpers.ts`) so the convention stays recognizable across both Edge Functions.
- **Money handling:** every amount is an integer XAF value (FR-026, NFR-003) — no floats anywhere in `InitiatePaymentParams`/`NormalizedPaymentEvent` or the wire format to/from TaraMoney. If TaraMoney's real API expects a different unit (e.g. minor units on an XAF-adjacent representation, unlikely but unconfirmed), convert at the `TaraMoneyProvider` boundary only — never let a non-integer or wrongly-scaled value reach `payments.amount`.
- **No CI/typecheck coverage exists yet for Edge Function (Deno) code** — same gap Story 2.1 flagged and left open ("no CI wiring for Deno type-checking exists yet — flag as a gap for whichever story next touches Edge Functions"). This story is that next story; the gap still isn't closed here (out of scope), but don't assume `pnpm typecheck` covers anything under `supabase/functions/`.
- **Testing standard:** pgTAP covers the new `payment_providers` table's RLS (deny-all for non-super-admin, super-admin SELECT works) and both new functions (`activate_payment_provider` enforces exactly-one-active via the partial unique index; a non-super-admin caller gets rejected; `active_payment_provider()` returns the right key to any authenticated role) — new file `supabase/tests/payment_providers_rls.test.sql`, mirroring `tiers_and_gym_lifecycle_rls.test.sql`'s session-simulation conventions. The real spike (Task 9) is the only verification for TaraMoney integration itself — no automated test can substitute for it.

### Project Structure Notes

- `supabase/functions/` currently contains one real function (`send-sms-hook`) plus `.gitkeep`-era scaffolding conventions — this story adds the second, `payment-webhook`, deviating from architecture.md's `notch-pay-webhook` name (see Scope Note and Task 5).
- File layout to create:
  ```
  supabase/functions/payment-webhook/
    index.ts
    deno.json
    _shared/payment-providers/
      PaymentProvider.ts
      TaraMoneyProvider.ts
      httpHelpers.ts
  supabase/migrations/0029_payment_provider_registry.sql
  supabase/tests/payment_providers_rls.test.sql
  apps/super-admin/services/payment-providers.ts
  apps/super-admin/app/(admin)/payment-providers/
    page.tsx
    loading.tsx
    actions.ts
  ```
- `apps/dashboard` is untouched by this story — Story 4.2 is the first story that reads `active_payment_provider()` from that app.
- `docs/decisions.md` already exists (most recently appended by Story 3.1's correction entry, 2026-07-18) — append new dated entries at the top per its established "newest first" convention.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — original literal AC text (Notch Pay-specific); see Scope Note for exactly what changed and why
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-034, FR-033, FR-035, FR-036, FR-039, FR-041] — payment-method table, spike exit criteria, idempotency/reconciliation/fee/receipt requirements (all provider-agnostic, unaffected by the TaraMoney pivot)
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions, Architectural Boundaries, Complete Project Directory Structure] — original `PaymentProvider`/`NotchPayProvider` shape and `notch-pay-webhook` naming (both superseded per this story's Scope Note, not edited in place)
- [Source: supabase/migrations/0005_payments.sql, 0001_extensions_and_enums.sql] — existing `payments` table, `payment_method`/`payment_status` enums, the pre-existing `provider_transaction_ref` unique constraint this story's idempotency AC relies on
- [Source: supabase/migrations/0023_member_check_in_one_open_session_enforcement.sql] — the partial-unique-index technique reused here for "exactly one active provider"
- [Source: supabase/migrations/0011_super_admin_tier_gym_lifecycle.sql, 0007_audit_log.sql] — `tiers`' RLS/uniqueness pattern and `log_audit_event()`'s signature, both directly reused
- [Source: _bmad-output/implementation-artifacts/1-6-super-admin-tier-management-gym-lifecycle.md] — closest structural analog for a new Super-Admin-only table + service + Server Action + page
- [Source: _bmad-output/implementation-artifacts/2-1-sms-otp-provider-sandbox-spike.md] — closest analog for "a spike the dev agent can't fully execute alone," `_shared/<domain>-providers/` file layout, and the `httpHelpers.ts` extraction pattern
- [Source: docs/decisions.md#2026-07-17 — Story 2.6 Decision 1] — precedent for "architecture.md text is stale, log the deviation, don't rewrite the doc," reused here for the Edge Function rename
- [Source: web research, 2026-07-30 — https://taramoney.com/developer] — SPA shell only, no usable API details surfaced via fetch or search; real credentials/docs needed from the user before Task 9
- User direction, this session (2026-07-30): TaraMoney as the initial provider; multi-gateway registry with Super-Admin runtime switching, designed now rather than deferred; real TaraMoney credentials/docs to be provided at `dev-story` time

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase test db` (pgTAP): 22 files, 359 assertions, all passing except one pre-existing, unrelated flaky assertion in `check_out_manual_auto_timeout.test.sql` (confirmed pre-existing via `git stash` + rerun against the unmodified baseline — a pg_cron timing race, not caused by this story's migration).
- `npx turbo run typecheck`: all 4 packages (`@gymos/types`, `@gymos/dashboard`, `@gymos/mobile`, `@gymos/super-admin`) pass clean.
- `node scripts/check-i18n-key-parity.mjs`: all 4 locale directories in parity, including the new `paymentProviders`/`nav.paymentProviders` keys.
- `supabase functions serve payment-webhook --env-file supabase/.env`: verified live via real HTTP requests — unknown provider path → `404`; TaraMoney webhook with unconfirmed signature mechanism → `401` (fails closed, as designed).
- Task 9 re-run (2026-07-31, Temporal business): real `curl` calls against `https://www.dklo.co/api/tara/mobilepay` (initiate) confirmed `SUCCESS` with a real `transactionId`; webhook.site captured the real inbound webhook including the `tara-webhook-secret` header; the real payload (reference rewritten to a throwaway gym/member/auth-user fixture, deleted after) was replayed against the local `payment-webhook` function via `curl` — first delivery `200` + one `payments` row created, replay `200` + no additional row, wrong-secret request `401`. Full request/response detail in `docs/decisions.md`.
- Super Admin `payment-providers` page: **not verified in a live browser.** Windows cannot currently reach the WSL2-hosted Supabase/Docker stack over HTTP (`curl`/`Invoke-WebRequest`/Node `fetch` from the Windows side all fail to connect on port 54321, despite `.wslconfig` having `networkingMode=mirrored` configured — a pre-existing environment issue, not something this story's changes caused), and WSL has no Node.js install to run `next dev` natively inside it. Verified instead via: (a) full typecheck of the exact page/service/action code against the real generated `Database` types, (b) direct REST/RPC calls from inside WSL against the live local instance using a hand-signed super-admin JWT, confirming `payment_providers` SELECT and `active_payment_provider()` RPC both respond correctly once the Kong/PostgREST containers were fully settled, and (c) the same underlying RPCs already proven exhaustively via pgTAP. The Activate-button click path itself was not exercised in a real browser — flagging this explicitly rather than claiming full UI verification.

### Completion Notes List

- **All 10 tasks complete, including a passing real spike.** Task 9's first attempt did not pass its exit criteria — not from a code defect, but because TaraMoney's GYM OS business account itself wasn't activated for live transactions (`BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT`, real HTTP 200 response, full evidence in `docs/decisions.md`). **Task 9 was re-run the same day (2026-07-31) against a separate, already-activated TaraMoney business the user supplied as a stand-in ("Temporal KEYS") and passed in full**: real auth, a real 100 XAF Orange Money collection (confirmed via a real USSD prompt the user dialed), a real webhook delivery, and a replay-idempotency check — all with real evidence in `docs/decisions.md`'s companion entry. `payment_providers.taramoney.is_active` is now `true`. The GYM OS business (`9FmIZg9GBB`) itself remains unactivated — next step for a production cutover is still on the user: contact TaraMoney support to activate it, then swap `supabase/.env`'s credentials back (no code/migration change needed).
- **The real spike resolved the story's single highest-risk unknown: webhook signature verification.** TaraMoney's "Webhook Secret" is sent verbatim as the `tara-webhook-secret` request header — a shared-secret equality check, not an HMAC-of-body scheme. `TaraMoneyProvider.verifyWebhookSignature()` is now implemented for real (previously a flagged `throw` stub). Two other documented ambiguities in TaraMoney's real API reference are also resolved by the real delivery: `productId` (our correlation reference) **is** present on a real webhook, and `mobileOperator` **is** present and derivable — `payment-webhook/index.ts` no longer hardcodes `method: "mtn_momo"`, it maps the real vendor via a new `mapTaraMoneyVendor()` helper (confirmed for `orange_money`; `mtn_momo` fallback remains unverified against a real MTN delivery). `TaraMoneyProvider.initiate()` was also corrected: a real SUCCESS response does carry a usable `transactionId`, contradicting the story's original assumption that none exists — `providerTransactionRef` now uses it instead of falling back to our own reference.
- Two real gaps were discovered directly from TaraMoney's actual API reference (not guessed, not present in the story's original draft interface) and are documented inline in code comments plus `docs/decisions.md`:
  1. `InitiatePaymentParams` needed a `phoneNumber` field the draft interface omitted — TaraMoney's mobile-money endpoint triggers the USSD prompt server-side and requires the payer's phone number in the initiate call itself.
  2. TaraMoney's real API reference is internally inconsistent about whether the webhook payload includes `productId` (our own correlation reference) — one documented payload shape has it, the "Mobile Payments API"'s own webhook section does not. Handled defensively (optional field, logged not guessed) pending Task 9's real delivery confirming which shape actually arrives.
- The webhook signature verification mechanism (header name, algorithm) is genuinely undocumented anywhere in TaraMoney's real API reference — implemented as a clearly-flagged `throw` stub per the story's explicit instruction, meaning every real TaraMoney webhook will 401 until Task 9 inspects a real delivery's actual headers and finalizes this.
- The `payment_providers.provider` → `payments` correlation for the webhook handler's upsert uses a spike-only `<gymId>:<memberId>:<suffix>` convention embedded in the reference we send as TaraMoney's `productId`, since Story 4.2's real subscription-linking orchestration doesn't exist yet — explicitly commented as throwaway, not a design to carry forward.
- `payment-webhook`'s upsert hardcodes `method: 'mtn_momo'` since TaraMoney's webhook payload carries no vendor/network field (only the initiate response does) — flagged inline pending Task 9 confirming whether it's actually derivable another way.

### File List

- `supabase/functions/payment-webhook/index.ts` (new)
- `supabase/functions/payment-webhook/deno.json` (new)
- `supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts` (new)
- `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts` (new)
- `supabase/functions/payment-webhook/_shared/payment-providers/httpHelpers.ts` (new)
- `supabase/migrations/0029_payment_provider_registry.sql` (new)
- `supabase/tests/payment_providers_rls.test.sql` (new)
- `supabase/config.toml` (modified — `[functions.payment-webhook]` block)
- `supabase/.env` (modified — TaraMoney credentials; gitignored, not committed)
- `packages/types/src/database.ts` (regenerated)
- `packages/types/src/schemas/paymentProvider.ts` (new)
- `packages/types/src/index.ts` (modified — export new schema)
- `apps/super-admin/services/payment-providers.ts` (new)
- `apps/super-admin/app/(admin)/payment-providers/page.tsx` (new)
- `apps/super-admin/app/(admin)/payment-providers/loading.tsx` (new)
- `apps/super-admin/app/(admin)/payment-providers/actions.ts` (new)
- `apps/super-admin/app/(admin)/payment-providers/components/PaymentProvidersPageClient.tsx` (new)
- `apps/super-admin/app/(admin)/layout.tsx` (modified — nav entry)
- `apps/super-admin/locales/en.json` (modified — `paymentProviders`/`nav.paymentProviders` keys)
- `apps/super-admin/locales/fr.json` (modified — `paymentProviders`/`nav.paymentProviders` keys)
- `docs/decisions.md` (modified — two 2026-07-31 entries: schema design, spike outcome)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story marked in-progress)

## Change Log

- 2026-07-31: Implemented Tasks 1–8 of Story 4.1. Generalized `PaymentProvider` interface + `httpHelpers.ts` (`_shared/payment-providers/`), `TaraMoneyProvider` built against the user-supplied real TaraMoney API reference (webhook signature verification left as a flagged stub — genuinely undocumented in the real API reference), new `payment_providers` registry table + `activate_payment_provider()`/`active_payment_provider()` RPCs (migration `0029`, pgTAP-covered), generic `payment-webhook` Edge Function (provider-dispatch by URL path, verified live via real HTTP requests), Super Admin `/payment-providers` page (list + Activate, EN/FR), `packages/types` regenerated.
- 2026-07-31: Ran Task 9's real spike with the user's explicit real-time authorization (100 XAF to a real Cameroon number). Result: `BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT` — TaraMoney's business account needs activation from their support team before any live transaction can process; no code defect, no money moved, no sandbox exists to fall back to. Per AC #3, flipped `0029`'s seed to `is_active = false` for `taramoney` and re-ran the pgTAP suite (still 15/15 for the new test file; full suite green). Recorded full evidence in `docs/decisions.md`. Task 10 (decisions.md outcome entry) done as part of this same step.
- 2026-07-31 (same day, second session): Re-ran Task 9 against a separate, already-activated TaraMoney business the user supplied as a stand-in ("Temporal KEYS") while the GYM OS business awaits TaraMoney's activation. **Passed in full**: real auth + a real 100 XAF Orange Money collection (real USSD confirmation) + a real webhook delivery + a replay-idempotency check, all with real evidence. This resolved the story's highest-risk unknown — TaraMoney's webhook signature mechanism is a shared-secret header (`tara-webhook-secret`), not HMAC — so `TaraMoneyProvider.verifyWebhookSignature()` is now implemented for real. Also fixed, from real evidence: `initiate()` now returns TaraMoney's real `transactionId` instead of our own reference; `payment-webhook/index.ts` now derives `payment_method` from the real `mobileOperator` field instead of hardcoding `mtn_momo`. `payment_providers.taramoney.is_active` flipped back to `true` (local DB + `0029`'s seed, both edited directly since the migration was never shared), activation audit-logged via a direct `log_audit_event()` call. Full evidence in `docs/decisions.md`'s companion entry.
