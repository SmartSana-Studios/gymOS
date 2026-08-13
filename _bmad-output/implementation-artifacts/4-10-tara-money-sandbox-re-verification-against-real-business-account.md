---
baseline_commit: 4ce3ba8632f1c9536db28d7e8072efd25797b6ba
---

# Story 4.10: Tara Money Sandbox Re-Verification Against Real Business Account

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want to re-run the Tara Money round-trip (auth, initiate, webhook, idempotency, one real-money charge) against GymOS's own now-activated business account (`9FmIZg9GBB`),
so that production reliance on Tara Money (FR-100) rests on the real account, not the stand-in ("Temporal") account the 2026-07-31 spike used.

**Context:** this is the direct sequel to Story 4.1's Task 9 spike. `docs/decisions.md`'s 2026-07-31 entries record that the original spike against GymOS's own business account (`9FmIZg9GBB`) failed with `BUSINESS_NOT_ACTIVATED_PLEASE_CONTACT_SUPPORT`; the same-day re-run against a TaraMoney-supplied stand-in ("Temporal", `businessId wxND8vZv5v`) then passed in full, and `9FmIZg9GBB` remained unactivated at that time. Per `sprint-change-proposal-2026-08-11.md`, `9FmIZg9GBB` has since been confirmed activated by TaraMoney support — this story is the credential swap + re-verification that both `epics.md` and `ARCHITECTURE-SPINE.md`'s "Deferred" section (OQ-7) describe as the sole remaining prerequisite before Story 4.12's cutover can begin, and before any real member payment may route through Tara Money.

**Also resolves OQ-13** (`prd.md` Open Questions table, line 887): "confirm Tara Money's create-collect + payment-detection flow (callback vs poll) and whether payments settle into each gym's own Tara account (per-gym credentials/sub-accounts) — folded into the OQ-7 re-spike" by the PRD itself, not just the correct-course proposal. This story's Task 4 makes that confirmation explicit.

**Not in scope:** OQ-14 (Flow B automated-recurring-debit question) is already resolved in the finalized PRD v1.5 and does **not** need re-probing here — `ARCHITECTURE-SPINE.md`'s own "Deferred" section explicitly flags an earlier correct-course draft's framing of OQ-14 as still-open-pending-this-spike as stale, superseded by the ratified PRD. Do not add recurring/saved-mandate-charge testing to this story's scope. Also not in scope: fixing `epics.md`/the implementation-artifacts filename's stale "Notch Pay" title on Story 4.1 (a known, separately-flagged documentation-drift item, independent of this story) — do not touch it here.

## Acceptance Criteria

1. **Given** `supabase/.env` currently configured against the Temporal stand-in credentials, **when** the credentials are swapped to the real `9FmIZg9GBB` business account, **then** no code or migration change is required — this is a configuration swap behind the existing `PaymentProvider` interface (FR-100). [Source: epics.md#Story 4.10]
2. **Given** the swapped credentials, **when** the same exit criteria that gated the original spike are re-run — sandbox auth, payment initiation returns a reference, webhook received and processed, idempotency test passes, one real-money round-trip — **then** all criteria pass against the real account, and the outcome (including the real-money transaction reference) is recorded in `docs/decisions.md`, resolving OQ-7. [Source: epics.md#Story 4.10; prd.md#OQ-7]
3. **Given** the re-verification fails any criterion, **when** that occurs, **then** production reliance on Tara Money does not proceed — Story 4.12's cutover is blocked until a passing re-run is recorded. [Source: epics.md#Story 4.10]
4. **Given** this re-spike is the designated moment for it, **when** the real request/response data is captured, **then** the outcome record also confirms (or refutes) OQ-13 — that Tara Money's create-collect flow is callback-driven (not poll) and that a request's `businessId` field is what scopes settlement to one specific business account, informing Story 4.13's per-gym-credential design. [Source: prd.md#OQ-13]

## ⚠️ Critical Context: Real Execution Required, Same Constraint as Stories 1.2/2.1/2.9/4.1

**This is a measurement/decision spike, not a feature build — no new code is expected to ship.** The dev agent cannot execute Task 2 (the real spike) alone. It requires, from the user, in real time:

1. **Credentials confirmed pre-cleared.** The user (smartsana) confirmed at story-creation time (2026-08-13) that the real `9FmIZg9GBB` credentials already sitting commented-out in `supabase/.env` (`apiKey LcB8Ayfx04OftF1LohB2ztzr`, `webhookSecret I4Y2ee7OrgHVpdbAQX5100AM`) are still valid — despite having been briefly committed in plaintext during Story 4.1 and redacted after the fact. **No re-confirmation needed before Task 1**; proceed directly with the swap.
2. **Test number confirmed pre-cleared.** The user confirmed at story-creation time (2026-08-13) to reuse the **same real Cameroon MTN/Orange number** Story 4.1's original spike used (the exact digits are redacted in `docs/decisions.md` and not visible to this session — get them from the user live at the start of Task 2, but no "same vs. a different number" decision remains open). **Real-time authorization for one small real-money charge** (100 XAF, matching Story 4.1's Task 9 precedent) is still required live, immediately before the charge — this cannot be simulated or mocked; TaraMoney has no sandbox environment (confirmed in the 2026-07-31 `docs/decisions.md` entry: "There is no sandbox/test environment to fall back to... the 'Production key' label... is TaraMoney's only environment").
3. **A fresh webhook.site (or equivalent) capture URL**, created new for this run — do not reuse a prior capture token.

**If the user is not available for the live parts of Task 2** (dialing the USSD prompt, authorizing the charge), do not skip it silently — halt and ask, exactly as Story 4.1's Task 9 and Story 2.9's Task 4 required before proceeding. The two items above (credentials, which number) are already settled and do not need re-asking.

## Tasks / Subtasks

- [x] **Task 1: Swap `supabase/.env`** (AC: #1)
  - [x] Credentials already confirmed valid by the user at story-creation time (2026-08-13) — no need to re-ask before proceeding.
  - [x] Comment out the three currently-active Temporal lines (`TARAMONEY_API_KEY=zNNHcqJkyzynXBlcx1QXUyAU`, `TARAMONEY_BUSINESS_ID=wxND8vZv5v`, `TARAMONEY_WEBHOOK_SECRET=CnfQfFWuwP3CoC0mXzNdKLAi`) and uncomment (or replace with fresh values from the previous subtask) the three `9FmIZg9GBB` lines, in place, preserving the file's existing comment block explaining the swap history.
  - [x] Confirm no other file needs to change: re-read `supabase/functions/payment-webhook/_shared/payment-providers/TaraMoneyProvider.ts` and confirm it still only reads `TARAMONEY_API_KEY`/`TARAMONEY_BUSINESS_ID`/`TARAMONEY_WEBHOOK_SECRET` via `Deno.env.get(...)` inside its methods — no hardcoded value, no code path that needs editing. This satisfies AC #1 directly; if anything in the provider does need a change to work against the real account, that is itself a finding to document (AC #1 would then not hold as written).
  - [x] If a local `supabase functions serve` instance is already running for this test, restart it (or re-run with `--env-file supabase/.env`) so the swapped env values are actually picked up — env changes do not hot-reload.

- [x] **Task 2: Run the real spike against `9FmIZg9GBB`** (AC: #2, #3, #4 — requires the user; cannot be executed by the dev agent alone)
  - [x] **Real auth + initiation.** Direct `POST https://www.dklo.co/api/tara/mobilepay` with the swapped `9FmIZg9GBB` credentials, a small real amount (100 XAF, matching Story 4.1's precedent), the same real Cameroon number Story 4.1's spike used (confirmed by the user at story-creation time — get the exact digits from the user live, since they're redacted in `docs/decisions.md`), and `webHookUrl` set to a fresh webhook.site capture URL. Confirm `HTTP 200 {"status":"SUCCESS", ...}` with a usable `transactionId` (per Story 4.1's second-attempt entry, `TaraMoneyProvider.initiate()` already returns `body.transactionId ?? params.reference` — confirm this still holds against the real account's response shape; do not assume, verify).
  - [x] **Real webhook delivery.** Confirm the user dials the resulting USSD prompt to complete the collection. Confirm the webhook.site capture receives a real webhook with a `tara-webhook-secret` header exactly matching the swapped `TARAMONEY_WEBHOOK_SECRET`. Replay the captured real payload against the local `payment-webhook` function's real HTTP endpoint (`supabase functions serve` from Task 1, not a simulated/hand-built payload) and confirm it is accepted and processed (`HTTP 200`, one `payments` row created with `status: "verified"`, `provider: "taramoney"`).
  - [x] **Idempotency.** POST the same captured webhook payload a second time; confirm still exactly one `payments` row (no duplicate). POST once more with a deliberately wrong `tara-webhook-secret` header; confirm `HTTP 401` and no DB write — same three-call pattern Story 4.1's Task 9 used.
  - [x] **`businessId` scoping (AC #4 / OQ-13).** Confirm the real webhook payload's `businessId` field matches `9FmIZg9GBB` (not the Temporal `wxND8vZv5v`) — this is the concrete evidence that Tara Money scopes a collect/settlement to the specific `businessId` supplied in the request, i.e. that per-gym credentials (Story 4.13, AD-15) is an architecturally sound model, not just an assumption.
  - [x] Confirm `payment_providers` where `provider_key = 'taramoney'` remains `is_active = true` — this story does not change activation state (it was already flipped `true` during Story 4.1's Temporal-account run); it only re-verifies behavior under the real account's credentials. Do not call `activate_payment_provider()` as part of this story.
  - [x] Delete all fixture rows created for this test (`payments`, and any `subscriptions`/`members`/`gym`/`tier`/auth-user fixtures if created) from the local DB afterward — same cleanup discipline Stories 4.1/4.2 followed. No fixture data should remain.

- [x] **Task 3: Branch on outcome** (AC: #2, #3)
  - [x] **Pass** (all of Task 2's checks succeed): proceed to Task 4. Production reliance on Tara Money is now unblocked.
  - [x] ~~**Fail** (any check fails)~~ — N/A, spike passed in full.

- [x] **Task 4: Record the outcome in `docs/decisions.md`** (AC: #2, #4)
  - [x] Follow the exact dated-entry convention already established by the four 2026-07-31 entries (newest-first, `## YYYY-MM-DD — <Title> — recorded during Story 4.10` heading, full real request/response evidence in prose + fenced JSON, a closing "Why recorded here" paragraph if useful).
  - [x] Explicitly state this **resolves OQ-7** (cite by name, matching how the 2026-07-31 entries and `prd.md`'s OQ-7 row read) and, separately, **resolves OQ-13** (cite by name) with the `businessId`-scoping finding from Task 2.
  - [x] Include the real transaction reference (`transactionId`) from the passing real-money round-trip, per AC #2's explicit requirement.
  - [x] ~~If failed: document the exact failure response/status...~~ — N/A, spike passed.

## Dev Notes

- **No new code is expected.** `TaraMoneyProvider.ts` and the `PaymentProvider` interface are stable and unmodified since 2026-08-01 (commit `5626d55`) and already read all three Tara Money credentials exclusively from env vars — there is no hardcoded credential anywhere to find and change. If Task 1's re-read of `TaraMoneyProvider.ts` finds otherwise, that is itself a story-worthy finding, not something to silently patch around.
- **`payment_providers.taramoney.is_active` is already `true`** and stays that way — this story is not an activation/cutover story (that's Story 4.12). Do not call `activate_payment_provider()`.
- **TaraMoney has no sandbox environment** — every "real spike" in this codebase's history (Story 4.1, 4.2, and this story) is a genuine real-money transaction, not a mock. Keep amounts small (100 XAF, the established precedent) and always get real-time user authorization immediately before each charge.
- **Local webhook delivery cannot use a local loopback `callbackUrl`.** `docs/decisions.md`'s 2026-07-31 entry (recorded during Story 4.2) found that `initiatePayment`'s auto-reconstructed `callbackUrl` resolves to an unreachable `http://127.0.0.1:...` origin when tested locally — a local-environment-only issue, not a production concern (production resolves to the real deployed Supabase URL). Story 4.1's Task 9 worked around this by calling TaraMoney's endpoint directly with an explicit `webHookUrl` set to a webhook.site capture URL, then replaying the captured payload against the local `payment-webhook` receive route by hand. This story should follow that same direct-call-plus-replay technique, not go through `apps/dashboard`'s `initiatePayment` UI path (which isn't wired to any UI yet for this exact scenario, and would hit the same loopback issue locally).
- **Testing standard:** identical to Stories 4.1/2.9 — no pgTAP applies (no schema/RLS change), no typecheck covers this (no Deno/TS code changes expected). The real spike itself, and its recorded evidence in `docs/decisions.md`, is the test.
- **Scope discipline:** do not start any part of Story 4.11 (webhook signature verification hardening — already implemented per the 2026-07-31 finding that the header-equality check exists), Story 4.12 (cutover), or Story 4.13 (per-gym Vault credentials) here. This story only re-verifies the existing, already-implemented pipeline against a different credential set.

### Previous Story Intelligence

- **Story 4.9** (`4-9-member-app-payment-history-receipt-detail.md`, immediately preceding story in Epic 4's numbering) is mobile-only UI work (member-facing payment history/receipt screens) in a completely different layer — no direct carry-over. Two facts worth knowing anyway: `payments.status` has exactly 4 values (`pending | processing | verified | flagged`, no `failed` state — a stalled real charge in this story's Task 2 would surface as `processing`, not `failed`); `payments.method` values `mtn_momo`/`orange_money` are written only by the real Tara Money path this story exercises, not by manual entry.
- **Story 4.1** (`4-1-notch-pay-sandbox-spike.md`, despite its stale title, is entirely the original TaraMoney spike) is the direct structural and evidentiary precedent for this story's Task 2 — its Task 9 is the exact methodology to repeat against the new account. Read its Task 9 and the four 2026-07-31 `docs/decisions.md` entries it produced before starting.
- **Story 4.2** (`4-2-notch-pay-payment-integration.md`) is where the fuller `initiatePayment` pipeline round-trip happened and where the local-loopback `callbackUrl` finding was made — relevant only for the workaround technique noted above, not for any code this story touches.

### Git Intelligence Summary

- HEAD at story-creation time is `4ce3ba8` (`feat(story-2.10): automated member invite via Evolution API`) — working tree is clean of any in-progress payment-related work (only unrelated untracked planning-artifact/tooling files present, confirmed via `git status`).
- No commit since `5626d55` (2026-08-01, Stories 4.4–4.7) has touched `TaraMoneyProvider.ts` or `PaymentProvider.ts` — the provider code has been stable and unmodified for over a week of subsequent work, reinforcing that this story is a pure credential/config exercise.

### Project Structure Notes

- Modified files expected: `supabase/.env` (gitignored, credential swap only), `docs/decisions.md` (new dated entry).
- No migration, no `packages/types` change, no dashboard/super-admin/mobile app change, no Edge Function code change expected.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.10] — this story's verbatim AC text.
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 4 (extension): Tara Money Cutover & Flow A Formalization] — epic framing, Story 4.11/4.12 downstream dependency on this story passing.
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#FR-099, FR-100] — the requirement this story satisfies; explicit "credential swap, not provider cutover" framing.
- [Source: _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md#Open Questions, OQ-7, OQ-13, OQ-14] — OQ-7/OQ-13 are this story's scope; OQ-14 is explicitly out of scope (already resolved).
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-11.md] — confirms `9FmIZg9GBB` activation and names this re-verification as the immediate next action (not `sprint-change-proposal-2026-08-08.md`, which covers unrelated Evolution API/messaging work only).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md#AD-13, "Deferred" (OQ-7, OQ-14 notes)] — confirms this is a credential swap only, not architecture-impacting; confirms OQ-14's framing is stale/resolved.
- [Source: docs/decisions.md#2026-07-31 entries (all four)] — the exact prior evidence, credentials-swap comment block, and dated-entry format/depth this story's Task 4 must match.
- [Source: supabase/functions/payment-webhook/_shared/payment-providers/PaymentProvider.ts, TaraMoneyProvider.ts] — unmodified interface/implementation this story verifies against, not changes.
- [Source: supabase/migrations/0029_payment_provider_registry.sql] — `payment_providers` schema / `activate_payment_provider()` RPC (not called by this story) / `active_payment_provider()` read helper.
- [Source: supabase/.env] — current Temporal-active credential block and the commented-out real `9FmIZg9GBB` block this story swaps in.
- [Source: _bmad-output/implementation-artifacts/4-1-notch-pay-sandbox-spike.md#Task 9] — exact re-run methodology (direct API call + webhook.site capture + replay) this story's Task 2 repeats.
- [Source: _bmad-output/implementation-artifacts/4-2-notch-pay-payment-integration.md] — source of the local-loopback `callbackUrl` finding informing this story's Dev Notes workaround.
- [Source: _bmad-output/implementation-artifacts/4-9-member-app-payment-history-receipt-detail.md] — immediately preceding story; no direct carry-over, `payments.status`/`method` value note only.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

### Completion Notes List

- Task 1 complete: swapped `supabase/.env`'s active TaraMoney credential block from Temporal (`wxND8vZv5v`) to the real, now-activated `9FmIZg9GBB` business account (`TARAMONEY_API_KEY=LcB8Ayfx04OftF1LohB2ztzr`, `TARAMONEY_WEBHOOK_SECRET=I4Y2ee7OrgHVpdbAQX5100AM`), commenting out the Temporal lines in place and preserving/extending the file's swap-history comment block. Re-read `TaraMoneyProvider.ts` in full: confirmed all three credentials are read exclusively via `Deno.env.get(...)` inside `initiate()`/`verifyWebhookSignature()`, no hardcoded value, no code path needs editing — AC #1 holds as written. No local `supabase functions serve` instance was running (`ps aux` confirmed), so no restart was needed; it will be started fresh with `--env-file supabase/.env` for Task 2.
- Task 2 complete: with the user live (test number `237659172788`, a fresh webhook.site capture created by the dev agent via webhook.site's own token API), ran the full real spike against `9FmIZg9GBB` — all checks passed on the first attempt. Real initiate returned `HTTP 200 SUCCESS` with `transactionId: "165126343"`; user dialed the USSD prompt (`#150*50#`); the real webhook arrived with a matching `tara-webhook-secret` header and `businessId: "9FmIZg9GBB"` (confirming OQ-13's scoping question). Local `supabase functions serve payment-webhook` was started with `TMPDIR` pointed under the project directory (`docs/decisions.md`'s 2026-08-12 devcontainer workaround — a bare `/tmp` `TMPDIR` produces a `failed to determine entrypoint` boot error in this devcontainer's Docker-outside-of-Docker setup) and `--env-file supabase/.env`. A throwaway gym/member/tier/auth-user/payment fixture (payment pre-seeded with `provider_transaction_ref = "165126343"`, `status: "processing"`) was created directly in the local DB so the webhook handler's existing-row lookup could match the replayed payload; replay produced `HTTP 200`, `payments.status` → `"verified"`, `provider_fee_amount: 3`. A second replay of the same payload produced no duplicate row (idempotency confirmed); a third with a deliberately wrong `tara-webhook-secret` header produced `HTTP 401` with no DB write. `payment_providers.taramoney.is_active` confirmed unchanged (`true`) throughout. All fixture rows deleted afterward; the local function-serve process and its `TMPDIR` scratch directory were stopped/removed.
- Task 3: outcome branch was Pass — all Task 2 checks succeeded, so no code/state rollback was needed.
- Task 4 complete: recorded the full outcome in `docs/decisions.md` (new dated entry, 2026-08-13, newest-first), explicitly resolving OQ-7 (production Tara Money reliance now rests on the real `9FmIZg9GBB` account) and OQ-13 (businessId-scoping confirmed from the real webhook payload), including the real transaction reference (`transactionId: "MP260813.2224.D34194"`, plus the initiate-time `transactionId: "165126343"`).
- No code changes were needed anywhere — this story was, as scoped, a pure credential swap plus re-verification. Story 4.12's cutover is now unblocked.

### File List

- `supabase/.env` (modified, gitignored — credential swap only, not committed)
- `docs/decisions.md` (modified — new dated entry recording this story's outcome)
