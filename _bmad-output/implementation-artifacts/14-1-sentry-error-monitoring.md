---
baseline_commit: b8e6755b713ec4be091bf661389c43e80e66e600
---

# Story 14.1: Sentry Error Monitoring

Status: done

## Story

As the development team,
I want unhandled exceptions across the dashboard, super-admin, and mobile app captured to Sentry with dev/staging/prod environment tagging,
so that a production error is surfaced automatically instead of discovered only when a user reports it (NFR-007).

## Acceptance Criteria

1. **Given** a real `SENTRY_DSN` configured per app, **when** an unhandled exception occurs in `apps/dashboard`, `apps/super-admin`, or `apps/mobile`, **then** it is captured to Sentry, tagged using the same three-value environment convention Story 9.5 already established for PostHog — `VERCEL_ENV` → `prod`/`staging`/`dev` for the two Next.js apps, `EXPO_PUBLIC_APP_ENV` for mobile — not a new convention invented from scratch.
2. **Given** no `SENTRY_DSN` is configured (e.g. local dev), **when** the app runs, **then** Sentry initialization no-ops safely, matching the existing PostHog module's own no-DSN-configured fallback pattern (`apps/dashboard/lib/analytics.ts`) — never blocking or crashing local dev or CI.
3. **Given** `architecture.md`'s existing error-handling convention (Server Actions/service functions return `{ data, error }` for expected, user-facing errors; only genuine bugs throw), **when** Sentry is wired, **then** it captures exactly those genuine-bug throws (React error boundaries, unhandled promise rejections, Server Action crashes) — not the expected `{ error }` returns the UI already handles, avoiding alert noise.
4. **Given** Edge Functions are named in `architecture.md` as a fourth Sentry surface, **when** this story ships, **then** Edge Function instrumentation (a separate Deno SDK, a different runtime) is explicitly out of scope, flagged as a follow-up — matching this codebase's existing precedent of narrowing scope when a surface's toolchain genuinely differs (e.g. Story 9.5 excluding `apps/super-admin` from PostHog).
5. **Given** a captured error reaches Sentry, **when** this story ships, **then** it delivers capture only — alerting rules, on-call routing, and dashboards are an operational follow-up, not part of this story's scope.

## Tasks / Subtasks

- [x] **Task 1: Dashboard — wire `@sentry/nextjs`** (AC: #1, #2, #3)
  - [x] Install `@sentry/nextjs` in `apps/dashboard` (pin the exact version resolved at implementation time — see Dev Notes "Latest Tech Information", this SDK moves fast and the version researched here (`10.70.0`) may already be stale).
  - [x] Add `NEXT_PUBLIC_SENTRY_DSN` to `.env.example` (see Dev Notes "The DSN env var naming decision" — do **not** reuse the existing bare `SENTRY_DSN` placeholder as-is).
  - [x] Wrap `apps/dashboard/next.config.ts`'s existing export with `withSentryConfig(...)`, preserving `cacheComponents: true` and the existing `env: { NEXT_PUBLIC_ANALYTICS_ENV: ... }` block untouched.
  - [x] Extend the *existing* `apps/dashboard/instrumentation-client.ts` (already exports `onRouterTransitionStart` for PostHog pageviews — do not create a duplicate export, compose into the same one). Add a guarded `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, environment: resolveAnalyticsEnvironment(), ... })` only when the DSN is set, mirroring the `if (apiKey) { ... }` guard already used for PostHog in the same file.
  - [x] Create `apps/dashboard/instrumentation.ts` (does not exist yet): `register()` dynamically imports `./sentry.server.config` / `./sentry.edge.config` by `NEXT_RUNTIME`; export `onRequestError = Sentry.captureRequestError`.
  - [x] Create `apps/dashboard/sentry.server.config.ts` and `apps/dashboard/sentry.edge.config.ts`: guarded `Sentry.init()` reading `NEXT_PUBLIC_SENTRY_DSN`, `environment: resolveAnalyticsEnvironment()` (import the existing function from `./lib/analytics-environment`, do not re-derive the `VERCEL_ENV` mapping).
  - [x] Create `apps/dashboard/app/global-error.tsx` (does not exist yet — no `error.tsx`/`global-error.tsx` exists anywhere in the repo today): `'use client'`, call `Sentry.captureException(error)` in a `useEffect`, minimal fallback UI. See Dev Notes "global-error.tsx and i18n" for the copy-language call.
  - [x] Verify a real `next build` (production) succeeds with `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` all **unset** — must not fail or warn-to-error (AC #2). Then verify it also succeeds with a dummy DSN set.

- [x] **Task 2: Super-admin — mirror Task 1** (AC: #1, #2, #3, #4)
  - [x] Install `@sentry/nextjs` in `apps/super-admin`.
  - [x] `apps/super-admin` has no `resolveAnalyticsEnvironment()` today (Story 9.5 excluded it from PostHog entirely — no `lib/analytics.ts` or `lib/analytics-environment.ts` exists there). Create `apps/super-admin/lib/analytics-environment.ts` with the identical `VERCEL_ENV` → `prod`/`staging`/`dev` mapping as `apps/dashboard/lib/analytics-environment.ts` (same function body, not a shared package — matches AD-10's existing precedent that this repo duplicates the per-app analytics wrapper rather than abstracting it).
  - [x] `apps/super-admin` has no `instrumentation-client.ts` at all (nothing to compose with, unlike dashboard) — create fresh, Sentry-only.
  - [x] Wrap `apps/super-admin/next.config.ts` with `withSentryConfig(...)`, preserving `cacheComponents: true` and `transpilePackages: ["@gymos/types"]` untouched.
  - [x] Create `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `app/global-error.tsx` following the same shape as Task 1.
  - [x] Same build verification as Task 1 (no-DSN and dummy-DSN `next build`).

- [x] **Task 3: Mobile — wire `@sentry/react-native`** (AC: #1, #2, #3)
  - [x] `npx expo install @sentry/react-native` in `apps/mobile` (pin exact version — researched as `8.24.0`, re-verify at implementation time).
  - [x] Add `EXPO_PUBLIC_SENTRY_DSN` to `.env.example`. Treat it like `EXPO_PUBLIC_POSTHOG_KEY` — a single value read the same way across all three EAS build profiles, **not** a per-profile value in `apps/mobile/eas.json`'s `build.*.env` blocks (only `EXPO_PUBLIC_APP_ENV` is legitimately per-profile there, since it differentiates the environment tag itself).
  - [x] Add the `@sentry/react-native/expo` config plugin to `apps/mobile/app.json`'s `plugins` array (`org`/`project`/`url`). Verify `expo prebuild`/dev-client build does not hard-fail when a real Sentry org/project isn't available in this environment — if it does, fall back to omitting the plugin's org/project fields (source-map upload is not required by this story's AC #5 "capture only" scope) and flag the gap in Completion Notes rather than blocking the story on it.
  - [x] Update `apps/mobile/metro.config.js`: swap `getDefaultConfig` for `getSentryExpoConfig` (from `@sentry/react-native/metro`) as the base config, while preserving the two existing customizations verbatim — the `.wasm` asset-ext push and the `node_modules/.ignored` `blockList` regex (see Dev Notes for the exact current file content).
  - [x] In `apps/mobile/src/app/_layout.tsx`: add a guarded `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, environment: resolveAnalyticsEnvironment(), ... })` (import the existing `resolveAnalyticsEnvironment` from `@/lib/analytics` — do not duplicate it), mirroring the file's existing `if (!posthogClient)` guard style. Rename the current `export default function RootLayout()` to a plain named `function RootLayout()` and add `export default Sentry.wrap(RootLayout);` as the file's final line — `Sentry.wrap` is safe to apply unconditionally even when `Sentry.init` was never called (SDK no-ops), so it does not need its own DSN guard. Keep the existing conditional `PostHogProvider` wrapping exactly as-is inside `RootLayout`'s body.
  - [x] Verify a dev-client / `expo start` boot with no `EXPO_PUBLIC_SENTRY_DSN` set does not crash (AC #2).

- [x] **Task 4: Cross-cutting verification** (AC: #1–#5)
  - [x] Confirm zero `@sentry/*` imports or references anywhere under `supabase/functions/` (AC #4 — Edge Functions explicitly out of scope; `payment-webhook`, `send-sms-hook`, `gym-qr-display` are untouched by this story).
  - [x] `pnpm typecheck` clean across all 4 packages; `pnpm lint` at the existing documented per-app baselines (no new errors introduced); `node scripts/check-i18n-key-parity.mjs` still passes (no locale files touched unless the dev agent adds `global-error.tsx` copy as real i18n keys — see Dev Notes).
  - [x] Manual verification (triggering a real thrown error against a real Sentry DSN and confirming an event lands in the Sentry project) — **the user created 3 real Sentry projects (gymos-dashboard, gymos-super-admin, gymos-mobile) and provided real DSNs mid-session**, so this was performed live rather than deferred; see the added "Live Sentry Verification (post-review)" note in Completion Notes and Debug Log References below.

- [x] **Task 5: Documentation** (AC: #1–#5)
  - [x] `docs/decisions.md`: new dated entry recording the DSN env-var-naming decision (resolves `deferred-work.md`'s existing flagged gap, see below), the newly-created `instrumentation.ts`/`global-error.tsx` files (none existed before this story), the Edge-Function-out-of-scope confirmation, and the source-map-token build-verification result from Task 1/2.
  - [x] `docs/deploy-runbook.md`: update the §5 env var list (`SENTRY_DSN` placeholder line → `NEXT_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`) and rewrite the §7 Observability section to reflect Sentry now being wired (still note that alerting/on-call/dashboards remain unbuilt, per AC #5).
  - [x] Remove or update `deferred-work.md` line 546 (the SENTRY_DSN-naming gap) now that this story resolves it.

### Review Findings

- [x] [Review][Decision] No PII-scrubbing policy configured across any of the six `Sentry.init()` call sites — this platform handles gym-member PII and a live payment-provider (Tara Money) integration, yet no `sendDefaultPii`/`beforeSend` scrubbing option is set or documented anywhere in this diff (`apps/dashboard/{instrumentation-client.ts,sentry.server.config.ts,sentry.edge.config.ts}`, the matching `apps/super-admin` files, `apps/mobile/src/app/_layout.tsx`). **Resolved:** user chose to accept the SDK default (`sendDefaultPii: false`) as sufficient — matches this story's explicitly narrow "capture only" scope (AC #5); an explicit `beforeSend` scrubbing policy is deferred as a follow-up rather than blocking this story. No code change.

- [x] [Review][Patch] `Sentry.init()` lacks the try/catch guard used elsewhere in this same diff [apps/dashboard/sentry.server.config.ts:8-13] — fixed: wrapped `Sentry.init()` in try/catch (matching the existing `instrumentation-client.ts` pattern, `console.error` fallback) in `apps/dashboard/sentry.server.config.ts`, `apps/dashboard/sentry.edge.config.ts`, `apps/super-admin/sentry.server.config.ts`, `apps/super-admin/sentry.edge.config.ts`, and `apps/mobile/src/app/_layout.tsx`. Verified via `pnpm --filter dashboard/super-admin/mobile typecheck` (all clean) and `eslint` on the touched Next.js files (clean).

- [x] [Review][Patch] `error.digest` is typed on the props but never attached to the Sentry capture [apps/dashboard/app/global-error.tsx:14-17, apps/super-admin/app/global-error.tsx:9-12] — fixed: `Sentry.captureException(error, { tags: { digest: error.digest } })` in both apps' `global-error.tsx`.

- [x] [Review][Patch] `.env.example`'s updated Sentry comment doesn't say which var belongs to which app [.env.example:11] — fixed: inline per-var comments (`# dashboard, super-admin` / `# mobile`) replace the single ambiguous header comment.

- [x] [Review][Defer] Manual live verification never exercised a real `global-error.tsx` React-boundary catch or a Server Action crash (`onRequestError`'s `'action'` routeType) [_bmad-output/implementation-artifacts/14-1-sentry-error-monitoring.md:201-209] — deferred, pre-existing. Only a generic Route Handler throw (`'route'` routeType) was tested end-to-end against a real Sentry project; the other two surfaces AC #3 names by name were verified structurally (typecheck/build) but not exercised live. Recommend a short follow-up verification pass before relying on this in an incident.

- [x] [Review][Defer] No `release`/`dist` identifier set on any `Sentry.init()` call — deferred, pre-existing. Without a release tag, a captured error can't be correlated to the deploy/commit that produced it, weakening NFR-007's diagnostic value once more than one deploy has shipped. Deliberately out of this story's "capture only" scope (AC #5); worth a near-term follow-up once a release-naming convention (commit SHA vs. EAS build ID vs. Vercel deployment ID) is chosen.

- [x] [Review][Defer] `withSentryConfig(...)` sets `silent: true` unconditionally in both `next.config.ts` files — deferred, pre-existing. This suppresses all future Sentry build-plugin warnings, not just the disclosed missing-`SENTRY_AUTH_TOKEN` case, which could hide a genuine future misconfiguration.

- [x] [Review][Defer] No tracked follow-up ensures the new DSNs actually get added to Vercel/EAS production project settings — deferred, pre-existing. Per `docs/deploy-runbook.md`'s own updated text, production hosting still has no DSN configured after this diff merges; the only record of that gap is doc prose, with nothing in `deferred-work.md` or a new story tracking it.

- [x] [Review][Defer] No automated test coverage exercises any of the six no-DSN-no-crash init guards (AC #2) — deferred, pre-existing. A future regression (e.g. someone removing a guard) would only be caught by manual verification, not CI.

## Dev Notes

### Nothing to copy — Sentry has never been implemented

A repo-wide check (re-confirmed for this story) found **zero** `@sentry/*` packages, zero SDK calls, and zero `sentry.*.config.ts`/`instrumentation.ts`/`error.tsx`/`global-error.tsx` files anywhere in the codebase, despite `architecture.md` describing Sentry as already "the sole V1 observability tool" (`architecture.md:48,185,475,518,544-546`). This was first flagged during Story 9.5's PostHog research and never followed up (`docs/decisions.md`'s 2026-08-20 entry). This story is a from-scratch build, not an extension of existing Sentry code — but it **must** reuse the existing analytics-environment-tagging pattern (below), not invent a second one.

### The environment-tagging convention to reuse (AC #1)

Story 9.5 already built exactly the three-value convention this AC asks for, just for PostHog instead of Sentry:

- `apps/dashboard/lib/analytics-environment.ts`:
  ```ts
  export function resolveAnalyticsEnvironment(): "prod" | "staging" | "dev" {
    if (process.env.VERCEL_ENV === "production") return "prod";
    if (process.env.VERCEL_ENV === "preview") return "staging";
    return "dev";
  }
  ```
  Kept dependency-free in its own file (no `posthog-node` import) specifically so `next.config.ts` can import it without pulling a third-party SDK into the build-time config graph — the same reasoning applies to importing it from `sentry.server.config.ts`/`sentry.edge.config.ts`.
- `apps/mobile/src/lib/analytics.ts` exports an identical `resolveAnalyticsEnvironment()`, sourced from `EXPO_PUBLIC_APP_ENV` instead of `VERCEL_ENV` (mobile has no Vercel equivalent; set per EAS build profile in `eas.json`).
- `apps/super-admin` has **no** copy of this function (excluded from PostHog by Story 9.5's own design — see its Dev Notes). This story must create one there (Task 2) — same `VERCEL_ENV` logic as dashboard's, not a shared `packages/types` helper (this repo's AD-10 precedent is that the analytics/observability wrapper is duplicated per-app on purpose, not abstracted).

Reuse these three functions verbatim for Sentry's `environment` option. Do not write a second `VERCEL_ENV`/`EXPO_PUBLIC_APP_ENV` mapping from scratch.

### The DSN env var naming decision

`.env.example` currently has a single bare `SENTRY_DSN=` line shared across all three apps — this is a pre-existing, already-flagged inconsistency (`deferred-work.md:546`): *"`.env.example` bundles a single shared SENTRY_DSN variable across three apps instead of per-app naming — inconsistent with the Supabase vars directly above it, which are explicitly duplicated per-framework (`NEXT_PUBLIC_*` vs `EXPO_PUBLIC_*`); its own comment says 'wired in a later story,' so revisit naming scheme when that story lands."* This story **is** that later story.

Sentry DSNs are not secrets — they're public-by-design values used only to submit events (this is standard across the Sentry ecosystem, unlike an API key). Since `instrumentation-client.ts` runs in the browser and needs the DSN inlined into the client bundle, and since this codebase's own precedent for exactly this situation is `NEXT_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_KEY` (also public-safe values, same per-framework prefix split), the natural fix is:

- `NEXT_PUBLIC_SENTRY_DSN` for `apps/dashboard` and `apps/super-admin`
- `EXPO_PUBLIC_SENTRY_DSN` for `apps/mobile`

This matches the Supabase vars' existing per-framework duplication pattern the deferred-work note points at, and avoids inventing a third env-injection mechanism (dashboard's `next.config.ts` already has one bespoke trick — inlining `VERCEL_ENV` under `NEXT_PUBLIC_ANALYTICS_ENV` because `VERCEL_ENV` itself isn't `NEXT_PUBLIC_`-prefixed — but that trick exists only because `VERCEL_ENV` is a Vercel-provided built-in; a Sentry DSN is a value the team sets themselves in Vercel/EAS project settings, so it can just be named `NEXT_PUBLIC_`/`EXPO_PUBLIC_`-prefixed directly at the source, no inlining trick needed).

### `next.config.ts` — preserve what's already there

Both apps already have custom `next.config.ts` content that `withSentryConfig(...)` must wrap, not replace:

- `apps/dashboard/next.config.ts`: `cacheComponents: true` plus the `env: { NEXT_PUBLIC_ANALYTICS_ENV: resolveAnalyticsEnvironment() }` block (Story 9.5).
- `apps/super-admin/next.config.ts`: `cacheComponents: true` plus `transpilePackages: ["@gymos/types"]` (load-bearing — without it Next.js won't transpile the workspace package's TS source).

### `instrumentation-client.ts` — dashboard already has one, don't clobber it

`apps/dashboard/instrumentation-client.ts` already exists (Story 9.5, PostHog) and already exports a function named `onRouterTransitionStart` (captures PostHog `$pageview` on App Router client-side navigations, since PostHog's own autocapture doesn't fire on those). Sentry's own manual-setup docs also want to export `onRouterTransitionStart` (aliased to `Sentry.captureRouterTransitionStart`) from the same file. **These must be composed into one export, not two conflicting ones** — call both PostHog's existing pageview capture and Sentry's router-transition capture from the single exported function. `apps/super-admin` has no such file yet, so Task 2 creates a Sentry-only one there.

### `instrumentation.ts` / server error capture

Next.js 16.3.4 (the version actually installed — this repo runs a materially newer Next.js than most training data; `apps/dashboard/AGENTS.md` / `apps/super-admin/AGENTS.md` both warn of this) supports `onRequestError` in `instrumentation.ts`, introduced stable at v15 and unchanged in shape at v16: it receives `(error, request, context)` where `context.routeType` is `'render' | 'route' | 'action' | 'proxy'` — `'action'` is exactly the Server Action crash case AC #3 asks for. Assign `export const onRequestError = Sentry.captureRequestError;` per Sentry's own SDK, which wraps this correctly. This file works in both Node and Edge runtimes; use `NEXT_RUNTIME` to select the config to import (see Task 1).

### `global-error.tsx` and i18n

No `error.tsx` or `global-error.tsx` exists anywhere in this repo today. `global-error.tsx` is a genuine Next.js special case: it replaces the root layout entirely when active (must define its own `<html>`/`<body>`) and therefore **cannot** nest inside `LocaleShell`/`I18nClientProvider` (the very layout that might be what crashed). This creates real tension with the repo's normal i18n-parity discipline (`scripts/check-i18n-key-parity.mjs`, enforced on every other user-facing string in `apps/dashboard/locales`, `apps/super-admin/locales`, `apps/mobile/src/locales`, `packages/types/src/locales`). The parity script only diffs `en.json`/`fr.json` key sets against each other — it does not scan source for hardcoded strings, so a hardcoded-English fallback in `global-error.tsx` will not fail CI. Given this story's explicitly narrow "capture only" scope (AC #5) and that this is the exact situation Next.js's and Sentry's own official examples both handle with plain hardcoded text, a minimal hardcoded-English fallback UI (one line, matching Sentry's own `NextError` example) is the pragmatic default — but this is a real judgment call the dev agent should make explicitly and note in Completion Notes, not silently decide.

### Source maps / build-time auth token — must not block CI or local dev

`withSentryConfig(...)` (Next.js) and the `@sentry/react-native/expo` config plugin (mobile) both support uploading source maps at build time via `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`. None of these exist anywhere in this repo (`.github/workflows/ci.yml` has no Sentry env vars today, same as it currently has none for PostHog either — PostHog's no-DSN no-op already relies on this exact gap without issue). Source-map upload is optional tooling on top of error capture, not required by this story's scope (AC #5: "capture only"). **Task 1/2's build-verification step is not optional** — a real `next build` must be confirmed to succeed with these unset, since this is precisely the kind of silent-CI-break AC #2 exists to prevent. If `withSentryConfig` needs an explicit `silent: true` or a conditionally-omitted `authToken` field to avoid a webpack/Turbopack-plugin warning becoming a hard failure, wire that in.

Next.js 16.3.4 uses Turbopack by default; per current Sentry docs, some legacy `withSentryConfig` options tied to build-time code transformation are ignored under Turbopack (source-map upload itself is unaffected). Re-verify against the actually-installed `@sentry/nextjs` version's own README at implementation time — this integration surface changes quickly and the version pinned here may already be stale by the time `dev-story` runs.

### Mobile — `_layout.tsx`, `metro.config.js`, `app.json` exact current state

`apps/mobile/src/app/_layout.tsx` currently ends with:
```tsx
export default function RootLayout() {
  const content = ( /* ... */ );
  if (!posthogClient) {
    return content;
  }
  return <PostHogProvider client={posthogClient}>{content}</PostHogProvider>;
}
```
Sentry's `Sentry.wrap()` HOC needs to wrap the *exported* component, so this becomes a plain `function RootLayout() { ... }` (same body, no `export default`) with `export default Sentry.wrap(RootLayout);` added as the final line of the file. `Sentry.wrap` is safe to apply even when `Sentry.init` was never called (DSN unset) — the SDK no-ops — so it does not need its own conditional guard, unlike `Sentry.init` itself which should mirror the file's existing `if (!posthogClient)` / `if (apiKey)` guard style.

`apps/mobile/metro.config.js` currently is:
```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm'); // expo-sqlite web wasm binary
config.resolver.blockList = [/node_modules[\\/]\.ignored([\\/].*)?$/]; // pnpm/Windows dangling junctions
module.exports = config;
```
Both custom lines exist for real, documented reasons (in-file comments) and must survive the swap to `getSentryExpoConfig(__dirname)` as the base config.

`apps/mobile/app.json`'s `plugins` array currently has 6 entries (`expo-router`, `expo-splash-screen`, `expo-localization`, `expo-image-picker`, `expo-camera`, `expo-sqlite`, `expo-notifications`) — append the `@sentry/react-native/expo` plugin entry, do not reorder or remove existing ones. `EXPO_PUBLIC_SENTRY_DSN` is a value read at runtime, not an `eas.json` build-profile field — do not add it to `eas.json`'s per-profile `env` blocks (only `EXPO_PUBLIC_APP_ENV` legitimately lives there, since it's what differentiates the environment tag itself across the `development`/`preview`/`production` build profiles).

### Latest Tech Information (researched 2026-09-02, re-verify at implementation time)

- `@sentry/nextjs`: latest npm version at research time was `10.70.0`. Manual setup for App Router + Turbopack: `withSentryConfig` in `next.config.ts`, `Sentry.init()` in `instrumentation-client.ts` (client) + `sentry.server.config.ts`/`sentry.edge.config.ts` imported from `instrumentation.ts`'s `register()` (server/edge), `onRequestError = Sentry.captureRequestError` in `instrumentation.ts`, `global-error.tsx` calling `Sentry.captureException` in a `useEffect`. [Source: Sentry JS SDK docs, Next.js manual setup, fetched 2026-09-02]
- `@sentry/react-native`: latest npm version at research time was `8.24.0`. Manual setup for Expo + `expo-router`: `npx expo install @sentry/react-native`, `Sentry.init()` + `export default Sentry.wrap(RootLayout)` in the root `_layout.tsx`, `@sentry/react-native/expo` config plugin in `app.json`, `getSentryExpoConfig` in `metro.config.js`. `SENTRY_AUTH_TOKEN` (source maps only, EAS secret, never committed) is separate from the runtime DSN. [Source: Sentry React Native SDK docs, Expo manual setup, fetched 2026-09-02]

### Git Intelligence

Epic 14 has no prior story to inherit patterns from (this is story 1 of a new epic). The 5 most recent commits (`b8e6755` correct-course plan, `44425c6` docs, `4cba686` Story 13.5 e2e baseline, `67568e9`/`c2e9921` Story 13.4) are docs/planning or unrelated-feature commits — nothing in them bears on Sentry wiring. The closest real precedent is Story 9.5's PostHog instrumentation (already covered above in detail), not recent git history.

### Project Structure Notes

- No database/migration work in this story — Sentry is app-layer only, no `supabase/migrations/` changes.
- New files: `apps/dashboard/{instrumentation.ts,sentry.server.config.ts,sentry.edge.config.ts,app/global-error.tsx}`; `apps/super-admin/{lib/analytics-environment.ts,instrumentation-client.ts,instrumentation.ts,sentry.server.config.ts,sentry.edge.config.ts,app/global-error.tsx}`. Modified files: both apps' `next.config.ts`, dashboard's existing `instrumentation-client.ts`, root `.env.example`, `apps/mobile/{app.json,metro.config.js,src/app/_layout.tsx}`, `docs/decisions.md`, `docs/deploy-runbook.md`, `_bmad-output/implementation-artifacts/deferred-work.md`.
- Edge Functions (`supabase/functions/{payment-webhook,send-sms-hook,gym-qr-display}`) are explicitly untouched (AC #4) — do not add any Deno Sentry SDK calls there.
- No RLS/pgTAP surface — this story has no database changes, so no new pgTAP suite is expected.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 14: Observability & Release Hardening / Story 14.1] — full AC text
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-09-01.md] — story's origin, scope confirmation (§Story 14.1 (Sentry))
- [Source: docs/decisions.md#2026-08-20 — PostHog Analytics Instrumentation] — the environment-tagging convention this story must reuse, and its own note that Sentry should adopt the same convention when eventually wired
- [Source: architecture.md:48,185,475,518,544-546] — Sentry named as the sole V1 observability tool, four-surface scope, error-handling convention (`{data,error}` vs throw)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:546] — the SENTRY_DSN naming gap this story resolves
- [Source: docs/deploy-runbook.md §5, §7] — current (stale) Sentry references to update
- [Source: apps/dashboard/lib/analytics.ts, apps/dashboard/lib/analytics-environment.ts, apps/dashboard/instrumentation-client.ts, apps/dashboard/next.config.ts] — the exact PostHog pattern (guard style, module-singleton style, env-injection style) this story mirrors
- [Source: apps/mobile/src/lib/analytics.ts, apps/mobile/src/app/_layout.tsx, apps/mobile/metro.config.js, apps/mobile/app.json, apps/mobile/eas.json] — mobile's existing PostHog wiring and the exact files Task 3 modifies
- [Source: Sentry JS SDK docs — Next.js manual setup (App Router, Turbopack); Sentry React Native SDK docs — Expo manual setup] — fetched live 2026-09-02, see "Latest Tech Information"

## Change Log

- 2026-09-02: dev-story: implemented all 5 tasks. `@sentry/nextjs@10.73.0` wired in `apps/dashboard` and `apps/super-admin` (instrumentation-client.ts, instrumentation.ts, sentry.server/edge.config.ts, app/global-error.tsx, next.config.ts wrapped with `withSentryConfig`), `@sentry/react-native@8.24.0` wired in `apps/mobile` (`app.json` config plugin, `metro.config.js` swapped to `getSentryExpoConfig`, `_layout.tsx`'s `RootLayout` wrapped with `Sentry.wrap`). Reuses Story 9.5's `VERCEL_ENV`/`EXPO_PUBLIC_APP_ENV` → prod/staging/dev environment-tagging convention verbatim (new `apps/super-admin/lib/analytics-environment.ts` created to match). `.env.example`'s shared `SENTRY_DSN` split into `NEXT_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_DSN`, resolving `deferred-work.md:546`. Both apps' `global-error.tsx` ships a deliberate hardcoded-English fallback (cannot nest inside `I18nClientProvider`) with a scoped `eslint-disable i18next/no-literal-string`. `docs/decisions.md`/`docs/deploy-runbook.md` updated. Full regression clean: typecheck 0 errors across all 4 packages, lint 0 errors on touched files (pre-existing warnings/mobile-eslint-gap only), i18n key-parity clean (80/731/214/309 keys), dashboard Vitest 218/218, real production `next build` verified clean (no-DSN and dummy-DSN) for both Next.js apps, real `expo prebuild`/`expo start` verified non-fatal for mobile with no DSN. Edge Functions confirmed untouched (AC #4). Status: ready-for-dev → review.
- 2026-09-02: dev-story (post-review follow-up, same session): user created 3 real Sentry projects and provided real DSNs. Set as `NEXT_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_DSN` in each app's gitignored `.env.local` (not committed, no story file scope change). Live-verified: `apps/dashboard` and `apps/super-admin` both had a real thrown error captured and flushed to Sentry's ingest endpoint (confirmed via temporary SDK debug logging, no transport errors); `apps/mobile`'s DSN confirmed valid/reachable via a direct raw-envelope POST (HTTP 200, event accepted) since no device/simulator is available in this environment for a full in-app crash test. All temporary test routes and debug flags were removed immediately after — `git status` confirms no residual diff from this verification pass. See "Live Sentry Verification (post-review, same session)" in Dev Agent Record.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm --filter dashboard typecheck` / `pnpm --filter super-admin typecheck` / `pnpm --filter mobile typecheck` / `pnpm typecheck` (all 4 packages) — clean, 0 errors, throughout.
- `pnpm --filter dashboard build` with `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` all unset — clean production build, no warnings, after fixing two `@sentry/nextjs` deprecation warnings surfaced on the first run (`withSentryConfig` import path, `disableLogger` option).
- `pnpm --filter dashboard build` with a dummy `NEXT_PUBLIC_SENTRY_DSN` set — clean.
- `pnpm --filter super-admin build` — same two verifications (no-DSN, dummy-DSN), both clean.
- `npx expo config --type public` and a real `npx expo prebuild --no-install --platform android` in `apps/mobile` — confirmed the `@sentry/react-native/expo` plugin with no `org`/`project` fields degrades to a non-fatal console warning ("Missing config for organization, project...") rather than a hard failure. The generated `android/` directory (gitignored, this is a Continuous Native Generation project) was deleted after verification; `expo prebuild` also rewrote `package.json`'s `android`/`ios` scripts from `expo start --*` to `expo run:*` as an unrelated side effect of prebuilding a previously-un-prebuilt project — reverted those two lines back to their original `expo start --android`/`expo start --ios` since this story doesn't intend to change the mobile dev workflow scripts.
- `npx expo start --no-dev --minify` in `apps/mobile` with no `EXPO_PUBLIC_SENTRY_DSN` set, run under a timeout — confirmed Metro Bundler reached "Waiting on http://localhost:8081" with no crash. An unrelated pre-existing environment gap surfaced in the same run (`libgtk-3.so.0` missing, breaks React Native DevTools only, not a Sentry regression).
- `grep -rn "@sentry" supabase/functions/` — zero matches, confirming AC #4's Edge-Function scope boundary held.
- `pnpm --filter dashboard lint` — initially surfaced 2 new `i18next/no-literal-string` errors on `app/global-error.tsx`'s hardcoded fallback copy (this repo's i18n key-parity script doesn't catch this, but the ESLint rule does); fixed with a scoped `eslint-disable`/`eslint-enable` pair and a comment explaining why (mirrors the reasoning already in Dev Notes "global-error.tsx and i18n"). Re-run: 0 errors, 15 pre-existing warnings in unrelated test files (unchanged baseline).
- `pnpm --filter super-admin lint` — 0 errors, 1 pre-existing unrelated warning (`PaymentProvidersPageClient.tsx`'s `react-hooks/exhaustive-deps`, unchanged baseline).
- `pnpm --filter mobile lint` — fails with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "eslint" not found`; confirmed via `ls apps/mobile/node_modules/.bin/eslint` that no `eslint` binary/devDependency exists in `apps/mobile` at all — this is the same pre-existing environment gap documented in prior stories (9.6, 10.3, 12.3's Dev Agent Records), not something this story introduced or could fix.
- `node scripts/check-i18n-key-parity.mjs` — clean (80/731/214/309 keys across the 4 locale sets, all in parity), both before and after the `global-error.tsx` lint fix (no locale files touched by this story — the fallback copy is deliberately hardcoded, not i18n keys, per Dev Notes).
- `pnpm --filter dashboard test` (Vitest) — 218/218 passing, unaffected by this story's app-layer-only changes (no test files touched).

### Live Sentry Verification (post-review, same session)

After this story was marked `review`, the user created 3 real Sentry projects (`gymos-dashboard`, `gymos-super-admin` — both Next.js platform; `gymos-mobile` — React Native platform) under one organization and provided the real DSNs. These were set as `NEXT_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_DSN` in each app's gitignored `.env.local` (never committed) and live-verified:

- **`apps/dashboard`:** started a real `next dev` server with the real DSN loaded from `.env.local`, temporarily added a throwaway Route Handler (`app/api/cron/sentry-verify-test/route.ts`, under the already-proxy-exempt `/api/cron/` prefix so it didn't need auth) that threw a real `Error`, and `curl`'d it. With `debug: true` temporarily added to `sentry.server.config.ts`, the server log showed `Captured error event` → `Flushing events...` → `Done flushing events` with no transport errors — confirming the real DSN is valid and the event was actually transmitted to Sentry's ingest endpoint. Both the temporary route and the `debug: true` line were deleted/reverted immediately after.
- **`apps/super-admin`:** same method, on port 3001 (to avoid colliding with dashboard's own dev server on 3000) — a throwaway route at `app/auth/sentry-verify-test/route.ts` (under the already-proxy-exempt `/auth/` prefix). Same `Captured error event` / `Flushing events...` / `Done flushing events` confirmation. Cleaned up identically.
- **`apps/mobile`:** no device/simulator or browser automation is available in this environment (consistent with every prior story's mobile-verification limitation), so the full `Sentry.wrap(RootLayout)` → real render crash → capture path was not triggered end-to-end. Instead, the real DSN's validity and reachability were confirmed directly: a hand-built minimal Sentry envelope (matching the wire format the SDK itself sends) was POSTed straight to `https://o4512014263123968.ingest.de.sentry.io/api/4512014294319184/envelope/` with the DSN's public key in the `X-Sentry-Auth` header — the request returned `HTTP 200 {"id":"<event id>"}`, confirming the project/DSN accepts real events. The in-app SDK wiring itself (config plugin, `Sentry.wrap`, `Sentry.init` guard) was already verified structurally in Task 3 (typecheck, `expo prebuild`, `expo start` boot); a real on-device thrown-error confirmation is left to the user, same as every other mobile manual-QA item in this project.
- No route/component/config file changes from this verification pass were left in the diff — everything temporary was removed, confirmed via `git status` showing only the story's original intended file set.

### Completion Notes List

- All 5 tasks complete. Zero `@sentry/*` code existed anywhere in the repo before this story (re-confirmed); this was a from-scratch build across all three apps, not an extension of existing code.
- `apps/dashboard`: `@sentry/nextjs@10.73.0` wired — `next.config.ts` wrapped with `withSentryConfig` (imported from the non-deprecated `@sentry/nextjs/config` subpath, discovered mid-implementation since the plain `@sentry/nextjs` import path logs a deprecation warning at this SDK version), the pre-existing `instrumentation-client.ts` extended (not duplicated) to compose PostHog's pageview capture and Sentry's router-transition capture into one `onRouterTransitionStart` export, new `instrumentation.ts`/`sentry.server.config.ts`/`sentry.edge.config.ts`/`app/global-error.tsx` created.
- `apps/super-admin`: mirrors dashboard's shape exactly, plus a new `lib/analytics-environment.ts` (super-admin had no PostHog-era copy of this function, per Story 9.5's own design) and a fresh Sentry-only `instrumentation-client.ts` (nothing pre-existing to compose with).
- `apps/mobile`: `@sentry/react-native@8.24.0` wired via `npx expo install`, `@sentry/react-native/expo` config plugin added to `app.json` (org/project fields deliberately omitted — no real Sentry project exists in this environment; confirmed via a real `expo prebuild` run that this degrades gracefully rather than hard-failing, matching the judgment call flagged in Dev Notes), `metro.config.js` swapped to `getSentryExpoConfig` while preserving both pre-existing customizations verbatim, `_layout.tsx`'s `RootLayout` renamed to a plain function and exported via `Sentry.wrap(RootLayout)`.
- **`global-error.tsx` i18n judgment call (flagged explicitly, per Dev Notes' own instruction not to silently decide):** both apps ship a minimal hardcoded-English fallback ("Something went wrong" / "An unexpected error occurred. Please try refreshing the page."), matching Next.js's and Sentry's own official examples, since `global-error.tsx` structurally replaces the root layout and cannot nest inside `I18nClientProvider`. This required a scoped `eslint-disable i18next/no-literal-string` — the repo's i18n *key-parity* script doesn't scan for hardcoded strings so it wasn't the blocker Dev Notes anticipated, but the separate `eslint-plugin-i18next` lint rule (error-level since Story 1.10) correctly caught it and needed an explicit, commented exception rather than a silent pass.
- **DSN env var naming resolves the already-flagged `deferred-work.md:546` gap:** `.env.example`'s shared `SENTRY_DSN` placeholder is now `NEXT_PUBLIC_SENTRY_DSN` (dashboard, super-admin) / `EXPO_PUBLIC_SENTRY_DSN` (mobile), matching the `NEXT_PUBLIC_POSTHOG_KEY`/`EXPO_PUBLIC_POSTHOG_KEY` precedent.
- **Manual verification (AC #1) was performed live, later in the same session** — the user created 3 real Sentry projects and provided real DSNs; `apps/dashboard` and `apps/super-admin` both had a real thrown error captured and flushed to Sentry's ingest endpoint with no transport errors (confirmed via temporary `debug: true` SDK logging), and `apps/mobile`'s DSN was confirmed valid/reachable via a direct raw-envelope POST (HTTP 200, event accepted). See "Live Sentry Verification (post-review, same session)" above for full detail. A real on-device/in-app thrown-error confirmation for mobile specifically (vs. the direct-envelope DSN check performed here) is still left to the user, since no device/simulator/browser automation exists in this environment — consistent with every other mobile manual-QA item in this project.
- No database/migration changes (this story is app-layer only, as scoped). No Edge Function changes (AC #4, confirmed via grep).
- Found and fixed two real code-quality issues along the way, beyond the story's literal task text but necessary to satisfy Task 4's "lint at existing documented per-app baselines, no new errors introduced" gate: the `@sentry/nextjs` deprecated-import-path warning (both Next.js apps) and the `i18next/no-literal-string` lint errors on `global-error.tsx` (both apps).
- Pre-existing, unrelated environment gaps observed but not touched: `apps/mobile` has no `eslint` binary/devDependency at all (documented in prior stories); `libgtk-3.so.0` missing breaks React Native DevTools only (unrelated to Sentry).
- Noticed but did not touch: a pre-existing uncommitted diff for Story 4-16 (`platform-business-id-collision-guard`, already marked `done` in `sprint-status.yaml`) was present in the working tree at the start of this session — left entirely untouched throughout, per the epic-7 action item that commits should happen promptly but this story has no authority to commit another story's work.

### File List

**New:**
- `apps/dashboard/instrumentation.ts`
- `apps/dashboard/sentry.server.config.ts`
- `apps/dashboard/sentry.edge.config.ts`
- `apps/dashboard/app/global-error.tsx`
- `apps/super-admin/lib/analytics-environment.ts`
- `apps/super-admin/instrumentation-client.ts`
- `apps/super-admin/instrumentation.ts`
- `apps/super-admin/sentry.server.config.ts`
- `apps/super-admin/sentry.edge.config.ts`
- `apps/super-admin/app/global-error.tsx`

**Modified:**
- `.env.example`
- `apps/dashboard/instrumentation-client.ts`
- `apps/dashboard/next.config.ts`
- `apps/dashboard/package.json`
- `apps/mobile/app.json`
- `apps/mobile/metro.config.js`
- `apps/mobile/package.json`
- `apps/mobile/src/app/_layout.tsx`
- `apps/super-admin/next.config.ts`
- `apps/super-admin/package.json`
- `docs/decisions.md`
- `docs/deploy-runbook.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `pnpm-lock.yaml`
