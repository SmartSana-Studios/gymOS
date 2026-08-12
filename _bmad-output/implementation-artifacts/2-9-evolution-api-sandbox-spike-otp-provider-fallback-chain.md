---
baseline_commit: 4c89fec9e33c9b5c6f89e981f8461f4a3175f523
---

# Story 2.9: Evolution API Sandbox Spike & OTP Provider Fallback Chain

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want to validate Evolution API against a real send/receive round-trip and wire it into an ordered fallback chain ahead of the existing Twilio/sent.dm providers,
so that OTP delivery gains a lower-friction primary channel without weakening reliability if it's unavailable.

**Context — not derived from `epics.md`:** like Stories 1.12/1.13, this story does not exist in `_bmad-output/planning-artifacts/epics.md` (confirmed by direct grep — no `### Story 2.9` header exists; `sprint-status.yaml`'s own header comment flags this as a known documentation-drift gap, not an error). It was raised via `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md`, Section 4.4 (Correct Course workflow, approved 2026-08-08) — adopting a self-hosted Evolution API WhatsApp gateway as the primary OTP channel. **Unlike Story 1.13**, this story's architecture has since been formally adopted into the canonical spine: `_bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md`'s **AD-11** (OTP fallback chain) and **AD-12** (`WhatsAppMessageProvider`) are now the authoritative source for the target architecture — treat AD-11 as binding, not just the proposal's draft prose (they agree, but AD-11 is dated 2026-08-08 and is the ratified decision record).

**This story covers only the OTP delivery chain (`send-sms-hook`).** It does **not** touch member invitations (`WhatsAppMessageProvider`/`EvolutionApiMessageProvider`/`sendMemberInvite`) — that is Story 2.5's revision, a separate story explicitly gated on this one's `EvolutionApiProvider`/chain infrastructure existing first (per the proposal's Section 5 dependency order). Do not build `WhatsAppMessageProvider` or any dashboard-facing invite code here.

**Story 1.13 already shipped the table this story reads from** (`messaging_provider_config`, `supabase/migrations/0050_messaging_provider_config.sql`) — do not re-create it, do not add a new RPC to it. This story is a pure *consumer* of that table's `instance_id` column, read-only, via a service-role client (see Dev Notes — Task 1).

## Acceptance Criteria

1. **Given** the already-running Evolution API instance, **when** I send a test OTP-shaped message and confirm delivery, **then** the outcome is recorded in `docs/decisions.md` (send succeeds, response shape confirmed, instance-disconnect behavior observed and documented). [Source: sprint-change-proposal-2026-08-08.md#4.4]
2. **Given** the spike passes, **when** `EvolutionApiProvider` (implements `OtpDeliveryProvider`) is added to `send-sms-hook`, **then** the `OTP_PROVIDER` env var is retired, and the hook tries providers in order — Evolution API → Twilio WhatsApp → Twilio SMS → sent.dm — advancing to the next on any failure. [Source: sprint-change-proposal-2026-08-08.md#4.4; ARCHITECTURE-SPINE.md#AD-11]
3. **Given** the Evolution API instance is disconnected or misconfigured, **when** an OTP is requested, **then** the chain falls through to Twilio WhatsApp (then SMS, then sent.dm) and the OTP still arrives. [Source: sprint-change-proposal-2026-08-08.md#4.4]
4. **Given** the spike fails, **when** that occurs, **then** Evolution API is not added to the chain until a fix is validated and documented — the existing three-provider chain (Twilio WhatsApp → Twilio SMS → sent.dm) ships and remains the production path. [Source: sprint-change-proposal-2026-08-08.md#4.4]

**Regardless of pass/fail, the chain-runner refactor itself always ships** — Task 2 below (replacing `getProvider()`'s single-provider `switch` with an ordered chain runner, retiring `OTP_PROVIDER`) is not conditional on Evolution API passing. Only `EvolutionApiProvider`'s presence at the front of the chain is conditional. This exactly mirrors Story 2.1's own precedent (its `OtpDeliveryProvider` interface and `TwilioSmsProvider` shipped regardless of `SentDmProvider`'s spike outcome; only which provider became the active default was conditional).

## ⚠️ Critical Context: Real Execution Required, Same Constraint as Stories 1.2/2.1/4.1

**This is a measurement/decision spike with a code deliverable, not just a feature build.** The dev agent cannot execute Task 4 (the real spike) alone — it requires:

1. **A reachable, already-provisioned Evolution API instance** (per the proposal: "already provisioned and running" — this is not a new deployment task). Need its base URL and an API key (global or instance-scoped token — confirm which the running instance actually issues; see Dev Notes) from the user, plus the **instance name** it was provisioned under (this becomes the seed value the user later enters into Story 1.13's already-shipped `/messaging` Super Admin page — do not hardcode it into env vars or code; it lives in `messaging_provider_config.instance_id`, read at request time).
2. **A real, reachable phone the user can check** — same "do not gate on a literal Cameroonian SIM, but flag plainly if the test number isn't a real `+237` number" rule Story 2.1's Dev Notes established. Reuse the same test number if still available (`+237680811041`, per `docs/decisions.md`'s 2026-07-14 entry) for direct comparability.
3. **A deliberate disconnect test** — ARCHITECTURE-SPINE.md's "Named infra risk" note explicitly calls out that unofficial WhatsApp gateways face *automated ban detection*, not just downtime: *"Story 2.9's sandbox spike should confirm recovery from an outright connector ban... not only an availability outage."* If the user can safely simulate a disconnect (stopping the instance, or pointing `messaging_provider_config.instance_id` at a bogus name), do so and confirm the chain still falls through to Twilio WhatsApp — this is AC #3's real-world proof, not just code review.

**If Evolution API access isn't available in this session**, do not skip Task 4 silently — halt and ask the user for the instance URL/API key/instance name, exactly as Story 2.1's Task 1 required real Twilio/sent.dm credentials before Task 8 could run.

## Tasks / Subtasks

- [x] **Task 1: `EvolutionApiProvider` implementation** (AC: #1, #2, #3)
  - [x] Create `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts` implementing `OtpDeliveryProvider` (`send(phone, code, locale): Promise<DeliveryResult>` — same contract every other provider in this directory already implements; do not redeclare the interface).
  - [x] **Instance ID must be read per-request from `messaging_provider_config`, not hoisted or cached at module scope.** This is the load-bearing detail that makes AC #2's "no redeploy" guarantee (Story 1.13's own AC #2) actually hold for the OTP path: a Super Admin updating the instance ID via `/messaging` must take effect on the *next* OTP send, not after an isolate recycle. Add a hoisted (module-scope, same convention as `gym-qr-display/index.ts` and `payment-webhook/index.ts`) `supabase-js` service-role client:
    ```ts
    import { createClient } from "@supabase/supabase-js";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    ```
    then, **inside** `send()` (per-request), query `messaging_provider_config.instance_id`:
    ```ts
    const { data, error } = await supabase.from("messaging_provider_config").select("instance_id").single();
    if (error || !data?.instance_id) {
      return { success: false, error: "Evolution API instance is not configured" };
    }
    ```
    A `null`/missing `instance_id` (the table's documented "not yet configured" state, per Story 1.13's migration) must produce a clean `DeliveryResult.success:false` — this is what makes AC #3's "disconnected or misconfigured" fall-through actually work, not a thrown exception that could crash the chain runner.
  - [x] **Evolution API's real REST contract** (verified via `doc.evolution-api.com`'s official reference and a live-user example, cross-confirmed by two independent sources — but **the real spike, Task 4, is the actual source of truth; if the live instance's behavior differs from what's documented below, trust the live response and correct this story's Dev Agent Record, the same way Story 2.1's `SentDmProvider` needed a live `GET /v3/templates/{id}` call to discover its real parameter shape):**
    - Send: `POST {EVOLUTION_API_BASE_URL}/message/sendText/{instance}`, header `apikey: {EVOLUTION_API_KEY}`, `Content-Type: application/json`, body `{ "number": "<phone digits, no leading +>", "text": "<message>" }`. Confirm during the spike whether the live instance expects `number` (bare digits, no `+`) or a `jid` (`"<digits>@s.whatsapp.net"`) — both forms appear across different Evolution API versions/forks in the research gathered for this story; do not assume, verify against the real 200/201 response.
    - A 200/201 response with a `key`/`message` object shape indicates a real send was accepted by the gateway — this is **not** the same as delivery confirmation (WhatsApp's own read/delivery receipts are a separate, async concern this story does not need). Treat "the gateway accepted the send" as success, matching how `TwilioSmsProvider`/`SentDmProvider` already treat their own providers' synchronous accept-response as `DeliveryResult.success:true` — this codebase does not wait for async delivery webhooks anywhere in the `OtpDeliveryProvider` chain today.
    - A non-2xx response (auth failure, instance not found/disconnected, malformed number) → `errorResult("Evolution API", response)` (reuse `httpHelpers.ts`'s existing helper — do not hand-roll a new error shape).
  - [x] **Locale is available but Evolution API has no template-approval constraint (unlike sent.dm/Twilio WhatsApp Content API)** — since it's not the official WhatsApp Business Platform, send plain inline text, mirroring `TwilioSmsProvider`'s `MESSAGES: Record<"en"|"fr", string>` pattern (`"Your GymOS code is: {code}"` / `"Votre code GymOS est : {code}"`), not a locked template.
  - [x] Route the actual HTTP call through `httpHelpers.ts`'s `postJsonWithTimeout`/`errorResult` (same 10s-timeout, redaction-ready shape `SentDmProvider` already uses) — do not write a second bespoke fetch wrapper.
  - [x] Never throw — same "defense in depth, contract is always return a `DeliveryResult`" discipline every existing provider follows (`index.ts`'s outer try/catch is a backstop, not the primary contract).

- [x] **Task 2: Ordered fallback-chain runner in `send-sms-hook/index.ts`** (AC: #2, #3, #4)
  - [x] Replace `getProvider()`'s single-provider `switch (Deno.env.get("OTP_PROVIDER"))` with a hoisted, ordered array: `const PROVIDER_CHAIN: OtpDeliveryProvider[] = [new EvolutionApiProvider(), new TwilioWhatsAppProvider(), new TwilioSmsProvider(), new SentDmProvider()];` (module scope — instantiating providers is cheap and stateless; this mirrors the existing `const provider = getProvider();` hoisting, just for an array). **Delete `OTP_PROVIDER` from `getProvider()` and every reference to it** — AC #2 is explicit that the env var is retired, not left as a dead/ignored fallback.
  - [x] Add a chain-runner function, e.g. `async function sendViaChain(phone: string, code: string, locale: "en" | "fr"): Promise<DeliveryResult>`, that iterates `PROVIDER_CHAIN` in order, `await`-ing each provider's `send()` inside the same try/catch-per-provider posture `index.ts` already uses for the single-provider case (a provider throwing unexpectedly must not abort the whole chain — log and advance to the next provider instead of returning 500 immediately). **The first `success:true` short-circuits** — do not call subsequent providers once one succeeds.
  - [x] **Log every attempt** (provider name + outcome — success/failure, not the phone number or code) per AD-11's explicit "every attempt is logged" requirement — extend the existing `console.error` convention (this hook has no other logging today) with one line per attempt, e.g. `console.log(\`send-sms-hook: ${providerName} → ${result.success ? "success" : "failed: " + redactPhone(result.error, phone)}\`)`. Reuse the existing `redactPhone()` helper — do not let a failed provider's error body (which may echo the phone number, per the existing comment on `redactPhone`) leak unredacted into a new log line just because it's a different code path than the current single-`console.error` call.
  - [x] If **every** provider in the chain fails, return the *last* provider's failure `DeliveryResult` to preserve the existing 429/503 `Retry-After` mapping logic in `index.ts`'s response-building code (unchanged) — do not invent a new aggregate-failure shape.
  - [x] `EvolutionApiProvider`'s presence in `PROVIDER_CHAIN` is itself conditional on Task 4's spike outcome (AC #4) — see Task 4's own instruction for how to encode a fail result without deleting the file.

- [x] **Task 3: Wiring — `deno.json`, `config.toml`, local secrets** (AC: #1, #2)
  - [x] `supabase/functions/send-sms-hook/deno.json`: add `"@supabase/supabase-js": "jsr:@supabase/supabase-js@^2"` to `imports` (same version pin `gym-qr-display`/`payment-webhook` already use — confirm no version drift).
  - [x] `supabase/config.toml`: `send-sms-hook`'s `[functions.send-sms-hook]` block already has `enabled = true` / `verify_jwt = false` (Story 2.1) — no change needed there. Confirm the Edge Function's runtime env picks up `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` the same way `gym-qr-display` does (these are Supabase-CLI-injected defaults for every function locally — verify, don't assume, since `send-sms-hook` has never needed them before this story).
  - [x] `supabase/.env` (gitignored, already exists from Story 2.1): add `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY` — obtained from the user (see Critical Context above). **Do not add an `EVOLUTION_API_INSTANCE`-style env var** — the instance name/ID is a runtime DB value (`messaging_provider_config.instance_id`), not a deploy-time secret; adding a duplicate env-var path would silently violate Story 1.13's whole "update without a redeploy" design intent.

- [x] **Task 4: Run the real spike** (AC: #1, #2, #3, #4 — requires the user; cannot be executed by the dev agent alone)
  - [x] Start local Supabase (`supabase start`, WSL2 Docker per `[[project_supabase_wsl]]`) and serve the function (`supabase functions serve send-sms-hook --env-file supabase/.env`), same procedure Story 2.1's Task 8 used. **Devcontainer note:** required `TMPDIR=/workspaces/gym_os/.tmp-supabase-serve` — see `docs/decisions.md`'s 2026-08-12 entry, Decision 4, for the root cause (Docker-outside-of-Docker `/tmp` bind-mount mismatch) and why the next story needing this command in this same devcontainer will hit it too.
  - [x] Seed `messaging_provider_config.instance_id` with the user's real, already-running instance name (directly via SQL or Story 1.13's `/messaging` Super Admin page — either works, this table already exists). Seeded `souna2` via direct SQL.
  - [x] Send a real test OTP-shaped message via `EvolutionApiProvider` in isolation first (temporarily as the sole entry in `PROVIDER_CHAIN`, or via a direct one-off script — developer's choice) against the real reachable phone number. Confirm the exact response shape received (does it match Task 1's assumed shape? which body field name actually worked?) — **update Task 1's implementation to match the live response if it differs**, exactly as Story 2.1 had to correct its `SentDmProvider` parameter assumptions mid-spike. Verified via a direct `curl` first (HTTP 201, `number` field confirmed exactly as assumed — no code correction needed), then via the real webhook round trip.
  - [x] Test the full 4-provider chain end-to-end: confirm Evolution API succeeds first and short-circuits (Twilio/sent.dm never called for a normal send). Confirmed via `send-sms-hook` logs: only `EvolutionApiProvider → success` logged, no other provider attempted.
  - [x] **Disconnect test (AC #3, and ARCHITECTURE-SPINE.md's explicit ban-detection ask):** point `messaging_provider_config.instance_id` at a bogus/disconnected value (or actually disconnect the real instance, if the user is willing), request another OTP, and confirm the chain falls through to `TwilioWhatsAppProvider` and the OTP still arrives. Document whichever disconnect mode was actually tested (misconfigured instance ID vs. a real connector-level ban/disconnect) — do not claim the ban-detection case was covered if only the misconfigured-ID case was actually run. **The user performed a real connector-level disconnect** (logged out the live `souna2` instance, not a bogus ID substitution) — `EvolutionApiProvider` failed with a real `Evolution API 500: {"status":500,"error":"Internal Server Error","response":{"message":"Connection Closed"}}`, chain fell through to `TwilioWhatsAppProvider → success`, OTP received and confirmed by the user. Instance reconnected afterward; a final send re-confirmed `EvolutionApiProvider → success`.
  - [x] **Branch on outcome:**
    - **Pass** (send succeeds, disconnect correctly falls through): leave `EvolutionApiProvider` as `PROVIDER_CHAIN[0]`. Proceed to Task 5. **PASS — both halves confirmed with real evidence.**
    - **Fail** (send never succeeds, or fails in a way that can't be fixed within this story's scope): **remove `EvolutionApiProvider` from `PROVIDER_CHAIN`** (keep the file — it's still a valid, reviewable implementation for a future fix, per AC #4's "not added to the chain until a fix is validated" — this is a wiring decision, not a deletion decision), leaving the chain as `[TwilioWhatsAppProvider, TwilioSmsProvider, SentDmProvider]`. Proceed to Task 5 with a documented failure, not a silent skip.

- [x] **Task 5: Record the outcome in `docs/decisions.md`** (AC: #1) — follow the exact dated-entry convention Story 2.1's Task 9 and Story 4.1's Task 9 established (newest-first, full request/response evidence, explicit PASS/FAIL per provider)
  - [x] Full dated entry: real request/response evidence for the send test, the exact body-field shape confirmed live (`number` vs `jid`, per Task 1/4), the disconnect-test result and which disconnect mode was tested, and the final chain composition (4-provider or 3-provider, per Task 4's branch). See `docs/decisions.md`'s 2026-08-12 entry.
  - [x] If PASS: note this supersedes/extends AD-11's "requires its own passed sandbox spike" gate — AD-11 is now fully satisfied, not just adopted-pending-verification. Noted in the entry's closing line.
  - [x] If FAIL: document the specific failure mode... — **N/A, spike passed; nothing to document under this branch.**

- [x] **Task 6: Manual regression check on the existing 3-provider path** (AC: #3, #4)
  - [x] Regardless of Task 4's outcome, confirm `TwilioWhatsAppProvider`/`TwilioSmsProvider`/`SentDmProvider` still work exactly as Story 2.1 left them — the chain-runner refactor (Task 2) changes *how* they're invoked (loop vs. single `switch`-selected call) but must not change their own behavior. A quick re-send via `TwilioSmsProvider` (or whichever chain position is reachable given Task 4's real test setup) confirming a real delivered SMS, matching Story 2.1's original pass evidence, is sufficient — a full re-run of all three isn't required if the chain-runner logic itself is straightforward to verify by code inspection plus one live confirmation. Satisfied by the disconnect test's own real `TwilioWhatsAppProvider → success` delivery (confirmed received by the user) — the reachable chain position given this spike's real test setup, per this subtask's own allowance.

## Dev Notes

- **This is a spike-gated infrastructure story, not a feature build** — same framing as Story 2.1. The deliverable is a working, sandbox-verified `EvolutionApiProvider` (conditionally wired) plus a chain-runner refactor that always ships, plus a documented decision. No dashboard/mobile UI work belongs here (that's Story 2.5's revision, gated on this story).
- **`OtpDeliveryProvider`'s existing four implementations are the reuse template — read all of them before writing `EvolutionApiProvider`.** `TwilioSmsProvider.ts`, `TwilioWhatsAppProvider.ts`, `SentDmProvider.ts` (all in `supabase/functions/send-sms-hook/_shared/otp-providers/`) show the established shape: read env credentials inside `send()`, route through `httpHelpers.ts`, never throw, return `{channel}` on success only if genuinely known. `EvolutionApiProvider` is the one exception to "read config inside `send()`" being *just* env vars — it also reads a DB value, which none of the other three providers do; this is new, not a deviation to avoid, but flag it clearly in code comments since it's the first `OtpDeliveryProvider` with a DB dependency.
- **The `messaging_provider_config` table, its RLS (deny-all + `update_messaging_instance()` RPC), and its Super Admin UI already exist and are out of scope to modify** (Story 1.13, `done`). This story only adds a second *reader* of `instance_id` (`send-sms-hook`'s service-role client) alongside the implicit future reader Story 2.5's revision will add (`sendMemberInvite`) — both were anticipated by 1-13's own Dev Notes ("the Epic 2 spike/chain story and the Story 2.5 revision each own their own read path against this table via their existing service-role clients").
- **This is the first `OtpDeliveryProvider` implementation with a live database dependency and the first fallback-chain pattern in this codebase** — no prior "try N things in order, first success wins" runner exists to copy from directly (the `PaymentProvider` interface, architecture.md notes, has never needed one — Notch Pay/TaraMoney has always been a single active provider via `payment_providers`' registry). Design the chain runner simply (a `for` loop with early return is sufficient — no need for a generic/reusable "chain" abstraction elsewhere in the codebase; this pattern has exactly one consumer).
- **Edge Functions remain capped at exactly 3, platform-wide** (`payment-webhook`, `send-sms-hook`, `gym-qr-display`, per ARCHITECTURE-SPINE.md's explicit "adding a 4th requires a deliberate AD" rule) — this story adds a provider and a DB read *inside* the existing `send-sms-hook` function; it does not add a new Edge Function.
- **`supabase-js` inside a Deno Edge Function is an established, working pattern** — copy `gym-qr-display/index.ts`'s exact hoisting/error-on-missing-env shape for the new `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` client in `EvolutionApiProvider.ts` (or hoist it in `index.ts` and pass it in — developer's choice, but keep it module-scope-hoisted either way, matching `payment-webhook`/`gym-qr-display`'s shared rationale: warm isolates re-run this once per isolate boot, not once per request).
- **Do not re-litigate Story 2.1's already-accepted deferrals** (no idempotency/dedup guard on hook retries, no CAPTCHA-hardening, module-scope secret hoisting not refreshing without a redeploy) — those are documented, accepted, pre-existing gaps this story's chain-runner refactor does not need to close. Flag only if the chain refactor makes any of them meaningfully worse (e.g., 4 sequential provider attempts on a hook retry now costs 4x the external calls instead of 1x — worth a one-line note in Completion Notes if observed, not a blocking fix).

### Previous Story Intelligence

- **Story 2.8** (`2-8-member-self-service-profile-management.md`, immediately preceding story in Epic 2's numbering) is in an unrelated domain (mobile member-profile UI) — no learnings from it carry over to this story. The two stories that actually matter for continuity are **Story 1.13** and **Story 2.1**, cited throughout Dev Notes/References above and in the Critical Context section.
- **Story 1.13** confirms: `messaging_provider_config` exists exactly as this story assumes (verified directly against `supabase/migrations/0050_messaging_provider_config.sql` and `apps/super-admin/services/messaging-provider-config.ts` during story creation); no `EvolutionApiProvider`/Evolution API reference exists anywhere in the codebase yet (confirmed via grep at story-creation time); 1-13's own Dev Notes explicitly anticipated this story as one of two future readers of `instance_id`.
- **Story 2.1** confirms the exact conventions this story must follow: `OtpDeliveryProvider`'s contract, `httpHelpers.ts`'s shared timeout/error helpers, the "ship the code regardless, wire in conditionally on the real spike's outcome" structure, and the `docs/decisions.md` dated-entry format — all reused directly rather than re-derived.

### Git Intelligence Summary

- HEAD at story-creation time is `4c89fec` (`plan(ux): extend GymOS UX spine for V1.5 epics 9-13 + extensions`) — working tree is clean of any in-progress Evolution API work (confirmed via `git status`; only two unrelated untracked planning artifacts present). This directly resolves an open question Story 1.13's own Git Intelligence Summary flagged — it noted "unrelated uncommitted changes... including `send-sms-hook/index.ts` (likely in-progress work toward the Epic 2 Evolution API spike/chain story)" at its own creation time (2026-08-08); that uncommitted work is **not** present in the current tree (confirmed: `index.ts` still has the original single-provider `switch`, no Evolution API references anywhere) — it was evidently discarded or never committed. Do not assume any prior partial implementation exists; this story starts from the same clean `send-sms-hook` Story 2.1 last left it in.
- Recent commit history (`958dff5`, `e317e8e`) is entirely Story 1.13's own work (messaging config table + UI, logout wiring, code-review fixes) — no additional relevant patterns beyond what's already extracted into Dev Notes above.

### Testing Standards

- Identical to Story 2.1 — no pgTAP applies (no schema/RLS touched by this story itself; `messaging_provider_config`'s own pgTAP coverage is Story 1.13's, already shipped and unaffected). No Next.js/Turborepo typecheck covers Deno code. The real spike execution (Task 4) plus a manual chain-runner invocation are the actual "tests" here.

### Project Structure Notes

- New file: `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts`.
- Modified files: `supabase/functions/send-sms-hook/index.ts` (chain runner, `OTP_PROVIDER` removal), `supabase/functions/send-sms-hook/deno.json` (`@supabase/supabase-js` import), `supabase/.env` (new Evolution API credentials, gitignored — never commit), `docs/decisions.md` (new dated entry).
- No migration, no `packages/types` changes, no dashboard/super-admin/mobile app changes — this story is entirely within `supabase/functions/send-sms-hook/`.

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-08.md#4.4] — the story's original AC text (verbatim above) and full rationale/risk framing.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md#AD-11, #AD-12, "Named infra risk"] — the ratified, current architecture decision this story implements; supersedes the proposal's draft text where they differ (they don't, materially).
- [Source: supabase/functions/send-sms-hook/index.ts, _shared/otp-providers/{OtpDeliveryProvider,TwilioSmsProvider,TwilioWhatsAppProvider,SentDmProvider}.ts, httpHelpers.ts] — the existing code this story extends; read in full before writing `EvolutionApiProvider`.
- [Source: supabase/functions/gym-qr-display/index.ts, payment-webhook/index.ts] — `supabase-js`-in-Deno hoisting precedent (Task 1, Task 3).
- [Source: supabase/migrations/0050_messaging_provider_config.sql, apps/super-admin/services/messaging-provider-config.ts] — the table/shape this story reads from (Story 1.13, shipped, do not modify).
- [Source: _bmad-output/implementation-artifacts/1-13-super-admin-evolution-api-instance-configuration.md] — closest prior-story precedent; confirms the table shape, confirms no Evolution API code existed as of its creation, confirms this story and Story 2.5's revision are the two anticipated future readers.
- [Source: _bmad-output/implementation-artifacts/2-1-sms-otp-provider-sandbox-spike.md] — closest structural precedent: a spike the dev agent can't fully execute alone, the "ship the code regardless, wire in conditionally on real test result" pattern, and the `docs/decisions.md` dated-entry convention (Task 9).
- [Source: docs/decisions.md#2026-07-14 — SMS/OTP Provider Sandbox Spike; #2026-07-14 — Twilio WhatsApp added] — the exact entry format/evidence depth to match for this story's Task 5.
- [Source: https://doc.evolution-api.com/v2/api-reference/message-controller/send-text, https://gist.github.com/dantetesta/b8b7e7e2d6196beae968c8b0a61afb7a] — Evolution API v2's documented `POST /message/sendText/{instance}` contract (`apikey` header, `{number, text}` body) — researched during story creation since Evolution API is not part of the original architecture; **the real spike (Task 4) is authoritative over this research if they conflict.**
- [Source: https://github.com/EvolutionAPI/evolution-api/issues/2216] — a real user's report of `/instance/connect`/`/instance/connectionState` 404ing on some deployments/versions while `/message/sendText` works fine with the same base URL/key — flagged so a 404 during the spike isn't mistaken for a credentials problem; this story doesn't need the connection-state endpoint (Task 1 relies on `sendText`'s own response, not a separate state check), but the versioning fragility it reveals is worth knowing going in.
- [[project_supabase_wsl]] — local Supabase/Docker must run from WSL for Task 4's manual spike execution.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- No deno CLI available in this container to run `deno check`/`deno test` — matches Testing Standards' note that no typecheck covers Deno code here; correctness relies on code inspection + Task 4's real spike (which ran successfully, see below).
- `supabase functions serve` initially failed for every function (`failed to determine entrypoint`) — root cause and fix (`TMPDIR` override) documented in `docs/decisions.md`'s 2026-08-12 entry, Decision 4. Not a code defect in this story.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Tasks 1–3 complete: `EvolutionApiProvider` implemented (module-scope service-role client, per-request `instance_id` read, `httpHelpers.ts` reuse, plain-text `en`/`fr` messages, never-throw contract); `send-sms-hook/index.ts` refactored to a `PROVIDER_CHAIN` + `sendViaChain()` runner (Evolution API → Twilio WhatsApp → Twilio SMS → sent.dm, first-success short-circuit, per-attempt logging via existing `redactPhone()`, `OTP_PROVIDER` env var and `getProvider()` fully removed — confirmed no remaining code references); `deno.json` gained the `@supabase/supabase-js` import; `supabase/config.toml` needed no change (confirmed `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are CLI-injected the same way for every local function, same as `gym-qr-display`/`payment-webhook`).
- **Task 4 (the real spike) ran to completion with the user, live, against their already-running Evolution API instance (`https://evo.ultradominon.com`, instance `souna2`) — PASS on all fronts.** Direct API contract verified first (`curl`, HTTP 201, `number` field confirmed exactly as Task 1 assumed), then the full `send-sms-hook` → GoTrue round trip (`EvolutionApiProvider → success`, first-attempt short-circuit, no other provider called). At the user's request, mid-spike, the OTP code was made bold via WhatsApp's plain-text `*text*` markdown (confirmed rendering live) — a native "Copy Code" button was explicitly ruled out and documented as mutually exclusive with Evolution API's whole no-template-approval appeal (Decision 3 in the decisions.md entry). The disconnect test used a **real connector-level disconnect** (the user logged out the live instance, not a bogus `instance_id`) — `EvolutionApiProvider` failed with a genuine `Evolution API 500: ... "Connection Closed"`, the chain fell through to `TwilioWhatsAppProvider → success`, and the OTP still arrived (user-confirmed) — this also serves as Task 6's regression evidence. Instance reconnected afterward; one final send re-confirmed `EvolutionApiProvider → success`.
- Final chain: `[EvolutionApiProvider, TwilioWhatsAppProvider, TwilioSmsProvider, SentDmProvider]` — the full 4-provider pass-branch outcome. `docs/decisions.md`'s 2026-08-12 entry is the full evidence record (AC #1); it also documents a real devcontainer/Docker infrastructure bug (`TMPDIR` workaround for `supabase functions serve`'s Docker-outside-of-Docker `/tmp` bind-mount mismatch) discovered only by actually running the spike, flagged for whoever needs this command next in this same devcontainer.
- Story 2.1's already-accepted deferrals (no idempotency/dedup guard on hook retries, module-scope secret hoisting not refreshing without a redeploy) were not made meaningfully worse by the chain refactor — a hook retry now costs up to 4x the external calls instead of 1x only in the all-providers-fail case, which is already the worst-case path; the common case (first provider succeeds) is unchanged at 1x. Not flagged as a new gap, per Dev Notes' own threshold for when this would be worth a note.

### File List

- `supabase/functions/send-sms-hook/_shared/otp-providers/EvolutionApiProvider.ts` (new)
- `supabase/functions/send-sms-hook/index.ts` (modified — chain runner, `OTP_PROVIDER`/`getProvider()` removal)
- `supabase/functions/send-sms-hook/deno.json` (modified — `@supabase/supabase-js` import)
- `supabase/.env` (modified, gitignored — `OTP_PROVIDER` removed, real `EVOLUTION_API_BASE_URL`/`EVOLUTION_API_KEY` added)
- `docs/decisions.md` (modified — new 2026-08-12 dated entry)

## Change Log

- 2026-08-12: Tasks 1–3 implemented (EvolutionApiProvider, fallback-chain runner, wiring). Task 4 real spike run live with the user against their Evolution API instance — PASS (send + real connector-disconnect fall-through both confirmed). Bold OTP formatting added at user request; native copy-button request declined with rationale (documented). Tasks 5–6 complete (`docs/decisions.md` entry, regression check via disconnect-test evidence). Story complete, all ACs satisfied.
