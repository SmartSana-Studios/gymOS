# Version/Vendor Claim Verification — ARCHITECTURE-SPINE.md (gym_os, 2026-08-11)

Reviewer: automated web-research pass, 2026-08-11.
Scope: the "Stack" table (lines 190–201) and every version-pinned / vendor-named claim elsewhere in the document (AD-11, AD-12, AD-13/14/15, AD-18/19/20, Edge Functions section).

## Method

For each claim, ran targeted WebSearch/WebFetch queries against primary sources (vendor docs, GitHub release pages, official blogs) rather than relying on training-data recall, per the task brief. Findings below are graded **CONFIRMED** (verified against a primary source), **PLAUSIBLE-BUT-UNVERIFIED** (search returned circumstantial/secondary confirmation only), or **STALE/RISK** (verification surfaced a concern).

## Findings

### 1. Next.js 16.2.10 — CONFIRMED, plausible pin
GitHub release `vercel/next.js` tag `v16.2.10` exists, dated **2026-07-01**. Per the release notes, 16.2.10 is a trivial republish fixing `@next/swc-wasm-web` not being published since 16.2.4 — no functional changes. This is consistent with a "verified on 2026-07-04" pin: a real, current version, one release old relative to whatever 16.2.x is newest as of 2026-08-11 but not stale enough to flag. **Recommend**: re-check whether 16.2.11+ or a 16.3 has shipped since 07-04, since a full month has passed.
Source: https://github.com/vercel/next.js/releases/tag/v16.2.10

### 2. Expo SDK 57.0.1 (RN 0.86, React 19.2) — CONFIRMED
Expo's own changelog and Expo's official account confirm SDK 57 ships React Native 0.86 with React held at 19.2 (unchanged from SDK 56), released **2026-06-30**. This is a real, current, and correctly-described pin — RN 0.86 is explicitly a non-breaking release from 0.85, and Expo is on record intentionally decoupling "big SDK bumps" from "RN compat-only bumps." No stale-version concern.
Source: https://expo.dev/changelog/sdk-57

### 3. Turborepo 2.x + pnpm workspaces — CONFIRMED as current default
Multiple independent 2026 sources describe Turborepo + pnpm workspaces as the default JS/TS monorepo stack for teams this size, with Turborepo at 2.10.4 and pnpm past v11 as of July 2026. The spine's loose "2.x" pin is appropriately non-committal and still accurate — no action needed.

### 4. Supabase Vault (AD-15) — CONFIRMED real and fit, but flag the "beta" label and pgsodium framing
Vault is a real, current Supabase Postgres extension for at-rest encrypted secrets (libsodium-based Authenticated Encryption, per-project root key managed by Supabase, decrypted view available to SQL/Postgres functions). It is documented as suitable for exactly this use case (per-tenant/per-integration API credentials). **However**: (a) Supabase's own docs/blog language still describes Vault as having shipped "now in Beta" and I could not confirm a subsequent formal GA announcement — worth a human double-check of current maturity/SLA status before treating it as a hard production dependency for payment credentials. (b) AD-15's framing ("chosen over pgsodium... as the least code to own") is actually *stronger* than the doc states: Supabase now explicitly says pgsodium is **pending deprecation** and directs all new usage to Vault, and confirms Vault's backend will be migrated off pgsodium internally while keeping its API stable — so AD-15's decision is not just reasonable but is the vendor-recommended path, not merely a lesser-evil pick. Recommend tightening the AD's rationale to say this explicitly, and having a human confirm Vault's current SLA/beta status for a payments-credential use case.
Sources: https://supabase.com/docs/guides/database/vault ; https://supabase.com/docs/guides/database/extensions/pgsodium

### 5. AD-11/AD-12 — Evolution API / WhatsApp — real technology, but the architectural risk is understated
Evolution API is a real, actively-used open-source project (reverse-engineers the WhatsApp Web protocol, unofficial). Current (2026) sources are consistent in flagging that Baileys/WAHA/Evolution-API-style unofficial connections carry a material, automated ban risk (detection independent of complaints, reports of accounts flagged within weeks-to-months), which is exactly the failure mode the spine's own fallback chain (AD-11: Evolution API → Twilio WhatsApp → Twilio SMS → SendDM) is designed to survive. This validates the *architecture* (fallback chain is the right mitigation) but the doc doesn't name "the unofficial connector can be banned outright, not just be briefly unavailable" as the specific risk driving AD-11 — worth having a human confirm the deferred Story 2.9 sandbox spike (mentioned in AD-11) explicitly tests recovery from a banned/blacklisted number, not just a downed API.

### 6. Twilio (WhatsApp/SMS fallback in AD-11) — not independently re-verified beyond "Twilio is real and operates in this space"
Search did not surface anything Cameroon-specific for Twilio's WhatsApp/SMS coverage. This is a pre-existing V1.0 provider (not new to this spine), so likely already vendor-verified elsewhere in the project's history (Story 2.x), but flagging that this pass could not confirm Twilio WhatsApp/SMS reachability specifically for Cameroon MSISDNs — a human should confirm this was checked when Twilio was originally selected, since it's load-bearing for the entire OTP fallback chain's terminal rungs.

### 7. Not independently re-verified in this pass (lower risk, well-established/generic)
- **Supabase Realtime, Storage, Edge Functions, pg_cron** — all long-established, GA Supabase primitives; the spine's usage (AD-18/19/20) is generic/conventional enough that training-data-level confidence is reasonable here, and nothing in the doc makes a version-specific claim about them that would need a fresh check.
- **TanStack Query, shadcn/ui + Tailwind, Sentry, Zod** — listed without version pins in the Stack table; no falsifiable claim to verify.
- **EAS Build+Submit** — named without a version pin; standard Expo tooling, no stale-version claim to check.

## Overall Verdict

Every version-pinned claim that was checkable (Next.js 16.2.10, Expo SDK 57.0.1/RN 0.86/React 19.2, Turborepo 2.x/pnpm) resolved to real, current, correctly-described releases — none are fabricated or stale as of this review. Supabase Vault is real and is in fact the vendor-recommended (not just architecturally-reasonable) choice given pgsodium's pending deprecation, but its "beta" labeling and the unofficial-WhatsApp-connector ban risk underlying AD-11 both deserve a human sanity check before being treated as fully settled.
