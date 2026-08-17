---
baseline_commit: c837a0899ad8ee83755b4bd68d8ea35d3af0d57b
---

# Story 4.11: Tara Money Webhook Signature Verification

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform,
I want Tara Money's webhook signature verified before any payment write,
so that unsigned or forged payment callbacks can never create or update a payment record.

**Context:** the underlying capability already exists and predates this story. `TaraMoneyProvider.verifyWebhookSignature()` (`supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:180-206`) implements Tara Money's shared-secret-header scheme (`tara-webhook-secret` header compared against `TARAMONEY_WEBHOOK_SECRET`), and Story 4.1's own code review (2026-07-31) already caught and fixed a timing-attack risk by introducing `constantTimeEqual()` (`TaraMoneyProvider.ts:98-109`). `payment-webhook/index.ts`'s receive route already calls `verifyWebhookSignature()` before any Supabase DB access at all (`index.ts:202-215`) — matching `ARCHITECTURE-SPINE.md`'s AD-17 invariant ("signature verification happens before any DB write"). Both the sandbox spike (Story 4.1, 2026-07-31) and the real-account re-verification (Story 4.10, 2026-08-13) manually confirmed this works end-to-end, including a deliberately-wrong-secret request correctly returning `HTTP 401` with zero DB writes.

**What this story actually delivers:** automated Deno test coverage. No `*.test.ts` file exists anywhere under `supabase/functions/payment-webhook/` today — every verification to date has been a live, manual, real-money spike (Story 4.1, Story 4.10), never an automated regression test. `docs/decisions.md`'s FR-101 language ("Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover") presumes tests exist; they don't yet. This story closes that gap before Story 4.12's cutover proceeds, per AC #3 below.

**Not in scope:** changing `verifyWebhookSignature()`'s scheme, the `constantTimeEqual()` comparison, or `index.ts`'s verify-before-DB-access ordering — Task 1 below is a re-confirmation check, not a rewrite; if it finds the implementation has drifted from this description, document that as a Review Finding rather than silently patching it as part of a "just add tests" story. Also not in scope: Story 4.10's Review Findings for non-`SUCCESS`/`FAILED` webhook status handling and conflicting-duplicate-payload replay (same `provider_transaction_ref`, different `amount`/`status`) — those are about post-verification event processing, not signature verification itself, and remain tracked in `deferred-work.md`. Do not fold them into this story's scope; a future story on webhook processing robustness is the right home for them if the user decides to act on them.

## Acceptance Criteria

1. **Given** the shared `payment-webhook` Edge Function, **when** a Tara Money webhook is received, **then** it is verified using Tara Money's signature scheme (the `tara-webhook-secret` shared-secret header, provider-specific per NFR-002) before any DB write. [Source: epics.md#Story 4.11; ARCHITECTURE-SPINE.md#AD-17]
2. **Given** an unsigned or invalid Tara Money webhook payload (missing header, wrong-value header, or malformed body), **when** it is received, **then** it is rejected with `HTTP 401` and no payment record is created or modified. [Source: epics.md#Story 4.11; prd.md#FR-101]
3. **Given** Tara Money sandbox and real webhook deliveries (post Story 4.10), **when** signature verification is exercised against both, **then** both are covered by automated integration tests before Story 4.12's cutover proceeds. [Source: epics.md#Story 4.11]

## Tasks / Subtasks

- [ ] **Task 1: Re-confirm the existing implementation still satisfies AC #1/#2** (AC: #1, #2)
  - [ ] Re-read `TaraMoneyProvider.ts`'s `verifyWebhookSignature()` (lines 180-206) and `constantTimeEqual()` (lines 98-109) in full — confirm both are unmodified from the state Story 4.1's code review left them in (no commit has touched `TaraMoneyProvider.ts` since `5626d55`, 2026-08-01, per Story 4.10's own git intelligence — expect this to still hold).
  - [ ] Re-read `payment-webhook/index.ts`'s receive route (lines 193-215) — confirm `provider.verifyWebhookSignature()` is called before any `supabase.from(...)` call, and that both the `catch` branch (verification throws) and the `!verification.valid` branch return `401` immediately with no DB access.
  - [ ] If either check finds drift from this description, stop and document it as a `[Review][Decision]` finding rather than silently patching it — this story's scope is test coverage, not a signature-scheme rewrite.

- [ ] **Task 2: Establish Deno test scaffolding for `payment-webhook`** (AC: #3)
  - [ ] Follow the `send-sms-hook` convention exactly: `jsr:@std/assert@^1` (`assert`, `assertEquals`), plain `Deno.test(...)`, no third-party test runner. Reference `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts` for the isolated-unit pattern and `supabase/functions/send-sms-hook/index.test.ts` for the handler-level pattern (dynamic import after `Deno.env.set(...)`, stubbing shared module state).
  - [ ] Create `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts` — this is the primary test target for AC #1/#2/#3, since `verifyWebhookSignature()` and the standalone-exported `normalizeTaraMoneyWebhook()` (`TaraMoneyProvider.ts:215-258`, deliberately exported "so index.ts and tests can exercise payload parsing independently of the still-unconfirmed signature step") are pure functions requiring no network or DB stubbing.
  - [ ] Run `deno check` and `deno test` against the new file(s) — `deno` is present at `~/.deno/bin/deno` in this devcontainer, not on `PATH` by default (confirmed by Story 2.9's dev/review cycle); add it to `PATH` for this session or invoke by full path. Do not report tests as unavailable without first checking this.
  - [ ] Add `supabase/functions/payment-webhook/deno.lock`, matching `send-sms-hook`'s precedent (the only other tested Edge Function in this repo) — do not omit it from the File List (Story 2.9's code review flagged exactly this omission as a Medium finding).

- [ ] **Task 3: Cover AC #1/#2 — signature verification correctness** (AC: #1, #2)
  - [ ] Valid header + valid payload → `verifyWebhookSignature()` returns `{ valid: true, event }` with correctly normalized fields.
  - [ ] Missing `tara-webhook-secret` header entirely → `{ valid: false }`. This is distinct from the wrong-value case and was explicitly flagged as untested by Story 4.10's code review — do not conflate the two in one test case.
  - [ ] Wrong-value `tara-webhook-secret` header (present but incorrect) → `{ valid: false }`.
  - [ ] Malformed JSON body (fails `JSON.parse`) → `{ valid: false }`, even with a correct header.
  - [ ] Structurally invalid payload (valid JSON, but missing `businessId`/`paymentId`/`status`, or `status` outside `{SUCCESS, FAILURE}`) → `{ valid: false }` via `normalizeTaraMoneyWebhook()`'s type guard.
  - [ ] Negative or unparseable `amount`/`originalAmount` → `{ valid: false }` (fails closed, per `TaraMoneyProvider.ts:220-247`).
  - [ ] At the `index.ts` receive-route level (may require a lightweight Supabase client stub, following `index.test.ts`'s module-stubbing pattern): confirm an invalid-signature request returns `HTTP 401` and that no `supabase.from("payments")` / `supabase.from("payment_webhook_events")` call occurs — assert this via a call-tracking stub, not just the HTTP status, since AC #1's "before any DB write" clause is the actual invariant under test.

- [ ] **Task 4: Cover AC #3 — sandbox and real webhook deliveries** (AC: #3)
  - [ ] Build test fixtures from the two real captured payload shapes already on record in `docs/decisions.md`: the 2026-07-31 stand-in-account webhook (`businessId: "wxND8vZv5v"`, real phone number in plaintext at `docs/decisions.md:405` — do not copy the real phone number into a test fixture verbatim; replace it with an obviously-fake placeholder number of the same format) and the 2026-08-13 real-account webhook (`businessId: "9FmIZg9GBB"`, phone number already redacted in that entry). Confirm `verifyWebhookSignature()`/`normalizeTaraMoneyWebhook()` correctly parses both shapes.
  - [ ] A valid `tara-webhook-secret` header paired with a `businessId` that doesn't match the account the header's secret belongs to (cross-tenant mismatch) — Story 4.10's review flagged this as untested and directly relevant to Story 4.13's upcoming per-gym-credential design (AD-15). `verifyWebhookSignature()` has no `businessId`-to-secret binding today (the secret is a single global env var, not per-account) — confirm the current single-account behavior explicitly with a test, and note in Dev Notes/Completion Notes that per-gym `businessId` validation is Story 4.13's scope, not a gap to fix here.

- [ ] **Task 5: Regression check** (AC: #1, #2, #3)
  - [ ] Run the full existing test suite (`send-sms-hook`'s Deno tests, `pnpm --filter dashboard test`, pgTAP) to confirm nothing else broke — this story only adds test files and, if Task 1 finds no drift, zero production code changes.
  - [ ] If `deno.lock` didn't exist for `payment-webhook` before this story, confirm its addition doesn't affect any other function's dependency resolution (each Edge Function has its own `deno.json`/import map; `send-sms-hook`'s `deno.lock` coexisting already proves this is safe).

## Dev Notes

- **This is very likely a zero-production-code-change story** — same category as Story 2.9's later test-coverage-only follow-up, not a fresh implementation. Task 1 exists specifically to verify that assumption before writing tests against behavior that might have silently drifted.
- `verifyWebhookSignature()`'s scheme is a **shared-secret header match, not an HMAC-of-body signature** — don't assume HMAC verification is missing; Tara Money's actual API contract (confirmed via Story 4.1's real spike) sends the secret verbatim as `tara-webhook-secret`, and `constantTimeEqual()` already guards the comparison against timing attacks.
- `payment-webhook/index.ts` has two routes (`handleInitiate` for server-to-server initiation, and the webhook receive route this story concerns) dispatched by URL path — do not touch `handleInitiate` or its tests; it is unrelated to signature verification.
- `NFR-002`'s prose in `prd.md` (line 783) still says "Notch Pay request signature" even though Tara Money is now the active provider — a pre-existing documentation-accuracy gap, not part of this story's scope. Fine to note as a Review Finding if it resurfaces, but do not edit `prd.md` as part of implementing this story.
- No CI step currently runs Deno tests for any Edge Function (confirmed via `ARCHITECTURE-SPINE.md`'s CI description — typecheck, pgTAP, i18n lint only). Adding `payment-webhook` test files does not by itself add CI coverage; that's a separate, not-yet-decided concern (matches the open `deferred-work.md`-tracked "no test runner" action item from Epic 7's retrospective) — do not attempt to wire CI as part of this story unless the user asks.

### Previous Story Intelligence

Story 4.10 (`done`, 2026-08-13) is the direct predecessor. Its Dev Notes explicitly named this story as future scope: *"do not start any part of Story 4.11 (webhook signature verification hardening — already implemented per the 2026-07-31 finding that the header-equality check exists)... here."* Its Review Findings section deferred four edge cases against `payment-webhook`; two are this story's Task 4 (missing-vs-wrong-value header, cross-tenant `businessId` mismatch), two are explicitly out of this story's scope (non-`SUCCESS` status handling, conflicting-duplicate replay — see "Not in scope" above). No code was changed by Story 4.10 — `TaraMoneyProvider.ts`/`PaymentProvider.ts`/`index.ts` are exactly as Story 4.1 (2026-07-31) and the 5626d55 commit (2026-08-01) left them.

### Git Intelligence Summary

Only 3 commits have ever touched `supabase/functions/payment-webhook/`: `9dc27bd` (Story 4.1/4.2/4.3, introduced `TaraMoneyProvider.ts` and the plain-`!==` signature check, later fixed to `constantTimeEqual()` within the same story's review cycle), `5626d55` (Stories 4.4-4.7, reconciliation/refunds/alerts — no signature-verification changes), `55eda46` (Story 6.3, payment notifications — no signature-verification changes). `1e6a099` (Story 2.9's test-coverage-only follow-up) is the closest direct precedent for what this story's own commit should look like: test files + `deno.lock` only, no production code diff, unless Task 1 finds otherwise.

### Project Structure Notes

New files expected: `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts`, `supabase/functions/payment-webhook/deno.lock`. Possibly `supabase/functions/payment-webhook/index.test.ts` if Task 3's DB-write-avoidance assertion needs handler-level coverage beyond what the provider-level tests can prove. No new directories — everything sits alongside `send-sms-hook`'s existing sibling structure.

### References

- [Source: epics.md#Story 4.11] — full AC text, Epic 4 extension context
- [Source: prd.md#FR-101] — "Webhook signature verification (NFR-002) is provider-specific... Tara Money verification is implemented and tested against sandbox and real webhook deliveries before cutover."
- [Source: ARCHITECTURE-SPINE.md#AD-17] — "signature verification (NFR-002) happens before any DB write"
- [Source: supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:98-109,180-258]
- [Source: supabase/functions/payment-webhook/index.ts:193-215]
- [Source: supabase/functions/send-sms-hook/index.test.ts, EvolutionApiProvider.test.ts] — established Deno-test conventions to mirror
- [Source: docs/decisions.md, 2026-07-31 and 2026-08-13 entries] — real captured webhook payload shapes for both accounts
- [Source: 4-10-tara-money-sandbox-re-verification-against-real-business-account.md#Review Findings] — the four edge cases this story's Task 4 partially inherits

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
