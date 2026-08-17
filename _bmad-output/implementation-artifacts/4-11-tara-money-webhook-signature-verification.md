---
baseline_commit: c837a0899ad8ee83755b4bd68d8ea35d3af0d57b
---

# Story 4.11: Tara Money Webhook Signature Verification

Status: done

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

- [x] **Task 1: Re-confirm the existing implementation still satisfies AC #1/#2** (AC: #1, #2)
  - [x] Re-read `TaraMoneyProvider.ts`'s `verifyWebhookSignature()` (lines 180-206) and `constantTimeEqual()` (lines 98-109) in full — confirm both are unmodified from the state Story 4.1's code review left them in (no commit has touched `TaraMoneyProvider.ts` since `5626d55`, 2026-08-01, per Story 4.10's own git intelligence — expect this to still hold).
  - [x] Re-read `payment-webhook/index.ts`'s receive route (lines 193-215) — confirm `provider.verifyWebhookSignature()` is called before any `supabase.from(...)` call, and that both the `catch` branch (verification throws) and the `!verification.valid` branch return `401` immediately with no DB access.
  - [x] If either check finds drift from this description, stop and document it as a `[Review][Decision]` finding rather than silently patching it — this story's scope is test coverage, not a signature-scheme rewrite.

- [x] **Task 2: Establish Deno test scaffolding for `payment-webhook`** (AC: #3)
  - [x] Follow the `send-sms-hook` convention exactly: `jsr:@std/assert@^1` (`assert`, `assertEquals`), plain `Deno.test(...)`, no third-party test runner. Reference `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.test.ts` for the isolated-unit pattern and `supabase/functions/send-sms-hook/index.test.ts` for the handler-level pattern (dynamic import after `Deno.env.set(...)`, stubbing shared module state).
  - [x] Create `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts` — this is the primary test target for AC #1/#2/#3, since `verifyWebhookSignature()` and the standalone-exported `normalizeTaraMoneyWebhook()` (`TaraMoneyProvider.ts:215-258`, deliberately exported "so index.ts and tests can exercise payload parsing independently of the still-unconfirmed signature step") are pure functions requiring no network or DB stubbing.
  - [x] Run `deno check` and `deno test` against the new file(s) — `deno` is present at `~/.deno/bin/deno` in this devcontainer, not on `PATH` by default (confirmed by Story 2.9's dev/review cycle); add it to `PATH` for this session or invoke by full path. Do not report tests as unavailable without first checking this.
  - [x] Add `supabase/functions/payment-webhook/deno.lock`, matching `send-sms-hook`'s precedent (the only other tested Edge Function in this repo) — do not omit it from the File List (Story 2.9's code review flagged exactly this omission as a Medium finding).

- [x] **Task 3: Cover AC #1/#2 — signature verification correctness** (AC: #1, #2)
  - [x] Valid header + valid payload → `verifyWebhookSignature()` returns `{ valid: true, event }` with correctly normalized fields.
  - [x] Missing `tara-webhook-secret` header entirely → `{ valid: false }`. This is distinct from the wrong-value case and was explicitly flagged as untested by Story 4.10's code review — do not conflate the two in one test case.
  - [x] Wrong-value `tara-webhook-secret` header (present but incorrect) → `{ valid: false }`.
  - [x] Malformed JSON body (fails `JSON.parse`) → `{ valid: false }`, even with a correct header.
  - [x] Structurally invalid payload (valid JSON, but missing `businessId`/`paymentId`/`status`, or `status` outside `{SUCCESS, FAILURE}`) → `{ valid: false }` via `normalizeTaraMoneyWebhook()`'s type guard.
  - [x] Negative or unparseable `amount`/`originalAmount` → `{ valid: false }` (fails closed, per `TaraMoneyProvider.ts:220-247`).
  - [x] At the `index.ts` receive-route level (may require a lightweight Supabase client stub, following `index.test.ts`'s module-stubbing pattern): confirm an invalid-signature request returns `HTTP 401` and that no `supabase.from("payments")` / `supabase.from("payment_webhook_events")` call occurs — assert this via a call-tracking stub, not just the HTTP status, since AC #1's "before any DB write" clause is the actual invariant under test.

- [x] **Task 4: Cover AC #3 — sandbox and real webhook deliveries** (AC: #3)
  - [x] Build test fixtures from the two real captured payload shapes already on record in `docs/decisions.md`: the 2026-07-31 stand-in-account webhook (`businessId: "wxND8vZv5v"`, real phone number in plaintext at `docs/decisions.md:405` — do not copy the real phone number into a test fixture verbatim; replace it with an obviously-fake placeholder number of the same format) and the 2026-08-13 real-account webhook (`businessId: "9FmIZg9GBB"`, phone number already redacted in that entry). Confirm `verifyWebhookSignature()`/`normalizeTaraMoneyWebhook()` correctly parses both shapes.
  - [x] A valid `tara-webhook-secret` header paired with a `businessId` that doesn't match the account the header's secret belongs to (cross-tenant mismatch) — Story 4.10's review flagged this as untested and directly relevant to Story 4.13's upcoming per-gym-credential design (AD-15). `verifyWebhookSignature()` has no `businessId`-to-secret binding today (the secret is a single global env var, not per-account) — confirm the current single-account behavior explicitly with a test, and note in Dev Notes/Completion Notes that per-gym `businessId` validation is Story 4.13's scope, not a gap to fix here.

- [x] **Task 5: Regression check** (AC: #1, #2, #3)
  - [x] Run the full existing test suite (`send-sms-hook`'s Deno tests, `pnpm --filter dashboard test`, pgTAP) to confirm nothing else broke — this story only adds test files and, if Task 1 finds no drift, zero production code changes.
  - [x] If `deno.lock` didn't exist for `payment-webhook` before this story, confirm its addition doesn't affect any other function's dependency resolution (each Edge Function has its own `deno.json`/import map; `send-sms-hook`'s `deno.lock` coexisting already proves this is safe).

### Review Findings

**2026-08-17 code-review round (bmad-code-review, diff vs. baseline `c837a08`, test-only diff: `TaraMoneyProvider.test.ts` + `index.test.ts`, `deno.lock` excluded as generated):**

- [x] [Review][Patch] `constantTimeEqual`'s byte-comparison branch is never exercised — every "wrong-value secret" test (`"not-the-real-secret"`, `"wrong-secret"`) is a different length than `SECRET`, so only the length-mismatch short-circuit runs; the actual timing-attack guard this function exists for has zero coverage. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts:70-74, supabase/functions/payment-webhook/index.test.ts:278-292] — fixed: added an equal-length wrong-value test at both the provider and route level.
- [x] [Review][Patch] `TARAMONEY_WEBHOOK_SECRET` unset/empty (the `!expected` branch — a real production misconfiguration scenario) is never tested; both files always set the env var to a valid value before any test runs. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts] — fixed: added a test that deletes the env var, asserts `valid:false`, then restores it.
- [x] [Review][Patch] `status: "FAILURE"` → normalized `"flagged"` mapping (the branch that drives `index.ts`'s `complete_flagged_payment` path) is never exercised — all 14 tests use either `"SUCCESS"` or a rejected value. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts] — fixed: added a dedicated test.
- [x] [Review][Patch] `originalAmount` edge cases are incomplete — only the "unparseable" case is tested; a negative-but-parseable `originalAmount` and an `originalAmount` greater than `amount` (negative derived fee, guarded at `TaraMoneyProvider.ts:242-246`) aren't. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts:111-139] — fixed: added both cases.
- [x] [Review][Patch] `mapTaraMoneyVendor`'s fallback branch (an operator string that's neither ORANGE nor MTN — snake_case normalization, or empty-token-to-`undefined`) is untested. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts:81-96] — fixed: added both fallback-branch cases via `normalizeTaraMoneyWebhook`.
- [x] [Review][Patch] `amount` field entirely absent (defaults to `0`) is untested — only "present but invalid" `amount` values are covered. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts] — fixed: added a dedicated test.
- [x] [Review][Patch] Comment misattributes fixture provenance — cites "Story 4.1 Task 9, Temporal stand-in account" but the literal values used (`paymentId: "643539724"`, `amount: "50"`/`"48"`, `transactionId: "MP260731.1244.B72917"`) come from `docs/decisions.md`'s separate Story 4.2 entry (lines 397-415), not the entry literally titled "Task 9" (lines 419-437, which has different values, e.g. `paymentId: "719152650"`). Both entries describe the same Temporal account so the fixture data itself is legitimate, just misattributed. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts:143-145] — fixed: comment now cites the correct entry.
- [x] [Review][Patch] The real, unredacted phone number (`237659172788`) is written out verbatim in a comment, even though the story's own Dev Notes explicitly said not to copy it into a test fixture — the payload itself correctly uses a placeholder, but the comment defeats that intent by putting the real number into a second, permanently source-controlled file. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts:143-145] — fixed: real number removed from the comment.
- [x] [Review][Defer] `index.ts`'s happy path (valid signature → payments lookup → `payment_webhook_events` upsert → `complete_verified_payment` RPC), the unknown-`providerKey` 404, and the `/initiate/<providerKey>` route are entirely untested at the route level. Out of this story's stated scope — Task 3's route-level bullet only required negative-path testing ("before any DB write"), and the Acceptance Auditor confirmed no AC is violated by this gap — but a real, valuable gap for a dedicated future story on `index.ts`'s happy-path coverage. [supabase/functions/payment-webhook/index.ts] — deferred, out of this story's scope.
- [x] [Review][Defer] `payment-webhook`'s receive route accepts any HTTP method (no `405` for non-`POST`, unlike `handleInitiate`'s explicit check) — pre-existing production behavior, unrelated to this diff. [supabase/functions/payment-webhook/index.ts:193] — deferred, pre-existing, not part of this diff.
- [x] [Review][Defer] `Deno.env.set(...)` at module scope in both new test files is never restored/deleted — an inherited pattern from `send-sms-hook`'s existing tests (Story 2.9), not new to this diff, but a real cross-file env-pollution risk if more `payment-webhook` test files are ever run together in one `deno test` invocation. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts, supabase/functions/payment-webhook/index.test.ts] — deferred, pre-existing convention.
- [x] [Review][Defer] Type-confusion payloads (wrong type rather than missing field, e.g. `businessId: 123`) are untested — code already correctly rejects these via `typeof` checks in `isTaraMoneyWebhookPayload`, so this is pure coverage-completeness, not a behavior gap. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts] — deferred, low value, code already correct.
- [x] [Review][Defer] `index.test.ts`'s three `401` assertions never check response body content — low risk today since `jsonResponse(401)` returns `{}`, but gives no regression signal if internal error detail (e.g. `fetchError.message`) starts leaking into the body later. [supabase/functions/payment-webhook/index.test.ts] — deferred, speculative future regression, low current risk.
- [x] [Review][Defer] The cross-tenant test's payload is minimal (omits `originalAmount`/`mobileOperator`/etc.), proving less than a fuller fixture would about the documented Story 4.13 (AD-15) gap it's meant to evidence. [supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts:218-230] — deferred, low-value polish.
- [x] [Review][Defer] The route-level "well-formed JSON but fails schema validation" case (e.g. missing `businessId`) is only unit-tested on `TaraMoneyProvider` directly, not exercised through `index.ts`'s handler — only the JSON-parse-throws case is tested at the route level. [supabase/functions/payment-webhook/index.test.ts] — deferred, low value, already covered at unit level.

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

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `deno check` + `deno test --allow-env` run from `supabase/functions/payment-webhook/` (required — running from the repo root fails with `TS2307` since the import map lives in that directory's own `deno.json`; confirmed the same is true of the pre-existing `send-sms-hook` precedent, not a regression): 17/17 pass (14 `TaraMoneyProvider.test.ts` + 3 `index.test.ts`).
- `deno cache index.ts index.test.ts _shared/payment-providers/TaraMoneyProvider.test.ts` from the same directory generated `deno.lock`. First attempt used an invalid `--lock-write` flag (rejected by this Deno version) which nonetheless left a lockfile on disk; deleted it and regenerated cleanly. The regenerated lock's `workspace.dependencies` correctly scopes to only `payment-webhook/deno.json`'s own imports (`@supabase/functions-js`, `@supabase/supabase-js`) — no `standardwebhooks` entry, unlike `send-sms-hook`'s lock, confirming it wasn't accidentally copied from that function.
- `send-sms-hook` regression: `deno test --allow-env index.test.ts _shared/otp-providers/EvolutionApiProvider.test.ts` — 16/16 pass, `git status --porcelain` confirmed zero changes to that directory.
- `pnpm --filter dashboard test` — 4 files, 28/28 pass.
- `supabase test db` (pgTAP): first run against the container's restored-from-backup state showed 5 files / 7 tests failing (`check_out_manual_auto_timeout`, `messaging_provider_config_rls`, `payment_reconciliation_job`, `subscription_lifecycle_cron`, `subscription_lifecycle_notifications`) — same category of stale-state artifact Story 1.13's Dev Agent Record already documented and ruled unrelated via a DB reset. Ran `supabase db reset` (fresh migration replay) and re-ran: 861/861 clean across all 44 test files.

### Completion Notes List

- Task 1 confirmed **zero drift**: `TaraMoneyProvider.ts` (last touched by commit `5626d55`, 2026-08-01) and `payment-webhook/index.ts`'s receive route are exactly as this story's Dev Notes described — `verifyWebhookSignature()` is called before any `supabase.from(...)` call, and both its `catch` branch and `!verification.valid` branch return `401` immediately with no DB access. No `[Review][Decision]` finding needed; no production code was touched.
- Added `TaraMoneyProvider.test.ts` (14 tests) covering AC #1/#2's signature-verification correctness (valid case, missing header, wrong-value header, malformed JSON, three structurally-invalid-payload variants, negative/unparseable `amount`) and AC #3's fixture coverage (both real captured payload shapes from `docs/decisions.md`'s 2026-07-31 and 2026-08-13 entries, phone numbers replaced with an obviously-fake placeholder per the story's Dev Notes — the real number is never copied into a test file).
- One nuance worth flagging for future readers: Task 3's "negative or unparseable amount/originalAmount → invalid" wording is only fully accurate for `amount`. Reading `normalizeTaraMoneyWebhook()` closely (`TaraMoneyProvider.ts:238-247`), a bad `originalAmount` does **not** invalidate the event — it only leaves `feeAmount` undefined (the amount that fails closed to `null`/invalid is `amount` alone). Added a dedicated test (`normalizeTaraMoneyWebhook: unparseable originalAmount leaves the event valid with feeAmount undefined, not invalid`) documenting the real behavior rather than the task text's stricter phrasing, per this story's Dev Notes instruction to document drift rather than silently "fix" it — this is a test-accuracy note, not a code gap; `originalAmount` failing open (event still verified, just without a derived fee) is the intended fail-closed-on-money-only design already explained by the surrounding code comment.
- Added the Task 4 cross-tenant test documenting that `verifyWebhookSignature()` has no `businessId`-to-secret binding today (single global `TARAMONEY_WEBHOOK_SECRET`, not per-account) — a valid header with a mismatched `businessId` still verifies. This is expected current behavior, not a bug; per-gym `businessId` validation is Story 4.13's (AD-15) scope.
- Added `index.test.ts` at the `payment-webhook` root (Task 3's last bullet) — asserts the actual AC #1 invariant ("before any DB write") via a `globalThis.fetch` stub that throws on any call, not just the `HTTP 401` status code, for three failure shapes (wrong-value header, missing header, malformed JSON with a correct header).
- `deno.lock` added per Task 2/Story 2.9's precedent; confirmed via the regression check that its presence doesn't affect `send-sms-hook`'s own independent `deno.json`/`deno.lock` resolution (each Edge Function is fully isolated).
- This story shipped exactly zero production code changes, as the Dev Notes anticipated — the entire diff is 3 new files (2 test files + 1 lockfile).

### File List

- `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.test.ts` (new)
- `supabase/functions/payment-webhook/index.test.ts` (new)
- `supabase/functions/payment-webhook/deno.lock` (new)

## Change Log

- 2026-08-17: Dev implementation (AI) — Task 1 re-confirmed zero drift in `TaraMoneyProvider.ts`/`payment-webhook/index.ts` since Story 4.1/4.10; added `TaraMoneyProvider.test.ts` (14 tests, AC #1/#2/#3) and `index.test.ts` (3 tests, AC #1's before-any-DB-write invariant) plus `deno.lock`. `deno check`/`deno test` 17/17 pass; `send-sms-hook` regression 16/16 pass; `pnpm --filter dashboard test` 28/28 pass; pgTAP 861/861 pass after a DB reset (5 pre-existing stale-state file failures on the restored-from-backup container were unrelated, ruled out by the reset). Zero production code changes. Status: ready-for-dev → in-progress → review.
- 2026-08-17: Code review (bmad-code-review, diff vs. baseline `c837a08`) — 8 Patch findings applied: added tests for `constantTimeEqual`'s byte-comparison branch (equal-length wrong secret, both provider- and route-level), the unset-secret misconfiguration branch, `status: "FAILURE"`→`"flagged"` mapping, `amount`-absent-defaults-to-0, `mapTaraMoneyVendor`'s non-ORANGE/MTN fallback (both branches), and `originalAmount` negative/greater-than-`amount` edge cases; fixed a misattributed fixture-provenance comment and removed a real unredacted phone number from a comment. Test count: 17 → 26 (`TaraMoneyProvider.test.ts` 14→22, `index.test.ts` 3→4). 7 Defer findings logged to `deferred-work.md` (route-level happy-path coverage gap, pre-existing method-agnostic receive route, inherited env-var-leak test pattern, type-confusion payload coverage, 401 response-body assertions, thin cross-tenant fixture, route-level schema-rejection coverage). 2 dismissed as noise. `deno check`/`deno test` 26/26 pass; `send-sms-hook` regression 16/16 pass. Zero production code changes remain. Status: review → done.
