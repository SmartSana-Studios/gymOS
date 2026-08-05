---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.2: E-Ink Display Endpoint

Status: done

## Story

As a gym Owner whose front desk uses an e-ink display instead of a printed QR poster,
I want a device-pollable endpoint that returns the gym's current check-in QR code as an image,
so that the display can refresh itself without a human reprinting or re-uploading anything after a manual QR regeneration.

**Context:** raised directly by the user (2026-08-05), alongside Story 8.1. Full planning context and the architecture-deviation discussion live in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`. `architecture.md` states no external API surface exists outside the two existing Edge Functions (`payment-webhook`, `send-sms-hook`); this story is the first addition to that surface since those were established, and the user explicitly chose a 3rd Edge Function over a Next.js API route to stay consistent with that pattern rather than deviate from it a different way.

## Acceptance Criteria

1. **Given** a gym's `gym_token`, **when** a device sends `GET` to `/functions/v1/gym-qr-display/<gymToken>`, **then** it receives `200` with `Content-Type: image/png` containing a QR code PNG encoding that exact token string (same encoding `QRCode.toDataURL(gymToken)` already produces client-side in `SettingsForm.tsx` — the token is not wrapped in a URL or scheme).
2. **Given** an unknown or malformed token, **when** the endpoint is polled, **then** it returns a generic `404` with no information distinguishing "wrong format" from "no such gym."
3. **Given** a request method other than `GET`, **when** received, **then** it returns `405`.
4. **Given** the response, **when** inspected, **then** it carries `Cache-Control: no-store` — a manual QR regeneration (Story 8.1's existing flow) must be reflected on the device's next poll, never served stale.
5. **Given** this is the first unauthenticated endpoint added since `architecture.md` was written, **when** the story is complete, **then** `docs/decisions.md` records: why a 3rd Edge Function was chosen over a Next.js API route or extending an existing function's internal routing (the `payment-webhook`-initiate-route precedent, `docs/decisions.md`), and the trust-model reasoning (gym_token as bearer secret == same trust level as a printed poster).

## Tasks / Subtasks

- [x] **Task 1: `supabase/functions/gym-qr-display/index.ts`** (AC: #1, #2, #3, #4)
  - [x] Module-scope `service_role` Supabase client, matching `payment-webhook/index.ts`'s exact pattern (`Deno.env.get("SUPABASE_URL")`/`SUPABASE_SERVICE_ROLE_KEY"`, `createClient`).
  - [x] Manual path parsing off `req.url` (`url.pathname.split("/").filter(Boolean)`, last segment = token) — same convention as `payment-webhook`.
  - [x] `GET` only; any other method → `405`.
  - [x] Look up `gyms` by `gym_token` (service-role bypasses RLS, so `private.gym_id()`'s session-scoping doesn't block an unauthenticated caller) — no match or empty token segment → generic `404`.
  - [x] Render PNG server-side via `qrcode`'s `toBuffer()` API (`npm:qrcode` specifier in this function's own `deno.json` — first `npm:` import in this codebase's Edge Functions, but a standard Deno capability).
  - [x] Response headers: `Content-Type: image/png`, `Cache-Control: no-store`.
- [x] **Task 2: `supabase/functions/gym-qr-display/deno.json`** (AC: #1)
  - [x] Import map: `@supabase/functions-js` (jsr, matching existing functions), `@supabase/supabase-js` (jsr), `qrcode` (`npm:qrcode@^1.5.4`).
- [x] **Task 3: `supabase/config.toml`** (AC: all)
  - [x] Add `[functions.gym-qr-display]` with `enabled = true`, `verify_jwt = false`, and a comment explaining why (unauthenticated hardware caller, same shape as the two existing `verify_jwt = false` comments).
- [x] **Task 4: `docs/decisions.md` entry** (AC: #5)
  - [x] Dated entry: 3rd-Edge-Function choice and why (vs. Next.js route, vs. folding into an existing function), the `gym_token`-as-bearer-secret trust model, and the `npm:` specifier precedent.
- [ ] **Task 5: Manual verification** (AC: all) — deferred to the consolidated end-of-epic verification pass
  - [ ] `supabase functions serve gym-qr-display` locally; `curl` with a real `gym_token` from the local DB → expect `200`/`image/png` decodable back to that token; `curl` with a bogus token → `404`; `curl -X POST` → `405`.

## Dev Notes

### Technical Requirements & Architecture Compliance

- `gym_token` becomes dual-purpose (check-in match, per `apps/mobile/src/services/checkin.ts`'s `validateGymToken`, + e-ink bearer secret here) — accepted, same trust level as a printed poster: anyone holding the QR already holds the token. This endpoint adds no new secret, just a new way to *render* the existing one.
- No dashboard UI for pairing/configuring an e-ink device with this URL in this story — just the endpoint. The gym's own dashboard (Story 8.1) already displays and lets an owner download the QR; how they get this function's URL onto their device is out of scope here.
- Response format is PNG only (no SVG option) — simplest for embedded/e-ink firmware to consume.

### Previous Story Intelligence

- `payment-webhook/index.ts`'s own comments record that a real sub-route addition (Story 4.2's `initiate` route) was folded into that existing function rather than becoming a new one, specifically because it was payment-domain work belonging naturally under the payment webhook. This story's QR-display concern is unrelated to both existing functions' domains (payments, SMS-hook delivery) — a new function is the better fit here, not a deviation from that precedent.

### Review Findings

- [x] [Review][Defer] No rate limiting or cost-amplification guard on the unauthenticated endpoint — every request runs a Postgres lookup plus a server-side PNG render, and `Cache-Control: no-store` guarantees no caching layer ever shields it [supabase/functions/gym-qr-display/index.ts] — deferred, accepted: pilot-scale usage (a single e-ink display polling infrequently, not internet-facing traffic), `gym_token` is a full unguessable UUID, matches this codebase's established pattern of accepting comparable low-probability abuse risk on other endpoints. Revisit if real abuse is observed.
- [x] [Review][Patch] `Cache-Control: no-store` is only set on the 200 success response; the `jsonResponse()` helper used for 404/405/500 sets no `Cache-Control` header at all, so AC4's guarantee doesn't literally cover error responses [supabase/functions/gym-qr-display/index.ts:5-10] — fixed: `jsonResponse()` now also sets `Cache-Control: no-store`
- [x] [Review][Patch] The `gyms` lookup isn't wrapped in try/catch (unlike the `QRCode.toBuffer` call below it) — a thrown exception (network failure, timeout) becomes an unhandled rejection instead of a controlled 500 [supabase/functions/gym-qr-display/index.ts:41-45] — fixed: lookup wrapped in try/catch, returns 500 on throw
- [x] [Review][Patch] `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` fall back to `""` with no validation before `createClient()` is called at module scope — a misconfigured deployment fails every request on that isolate with no diagnostic [supabase/functions/gym-qr-display/index.ts:14-16] — fixed: throws a clear error at module init if either env var is missing
- [x] [Review][Defer] No `gyms.status` filter — a suspended/deactivated gym's QR is served identically to an active one [supabase/functions/gym-qr-display/index.ts:41-45] — deferred, pre-existing gap already present in `apps/mobile/src/services/checkin.ts`'s `validateGymToken`, not introduced by this diff
