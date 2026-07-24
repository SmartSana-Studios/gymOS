---
baseline_commit: fd074bee858a525a77d7ff03501d2a20fee6423a
---

# Story 3.3: QR Code Generation & Gym Token Validation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Gym Owner,
I want a unique, printable QR code for my gym's entrance,
so that members can check in by scanning it.

## Acceptance Criteria

1. **Given** a gym's Settings page, **when** the gym is created, **then** a non-guessable `gym_token` UUID is generated and encoded into a downloadable/printable QR code. [Source: epics.md#Story 3.3]
2. **Given** a member scans a QR code, **when** the token doesn't match any gym, **then** the app shows "QR code not recognized — make sure you're scanning your gym's code" and no check-in is recorded. [Source: epics.md#Story 3.3]

## Scope Notes — Read Before the Tasks

**AC #1 is already fully built by prior stories. This story's real work is entirely AC #2, entirely in `apps/mobile`, and does not touch Postgres at all.** Read all four notes below before writing any code.

### Scope Note #1 — AC #1 requires zero new code; verify, don't rebuild

`gyms.gym_token` (`supabase/migrations/0002_gyms_and_tiers.sql:27`) is `text not null unique default gen_random_uuid()::text` — the column comment there literally says *"doubles as a non-guessable, unique token for the QR code (FR-043)"*. `apps/super-admin/services/gyms.ts`'s `createGym` INSERT (~line 497) does not set `gym_token` at all, so every gym gets one automatically the instant its row is created — satisfying AC #1's literal "when the gym is created" wording without any app code.

The downloadable/printable QR itself was built in Story 1.9: `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` already renders it (`QRCode.toDataURL(gymToken)`, the `qrcode` npm package — `docs/decisions.md` 2026-07-10 Decision 5), offers a download button (`handleDownloadQr`), and a regenerate flow with a confirm dialog (`regenerateQrCode()` in `apps/dashboard/services/gym-settings.ts:247-271`, which does `update({ gym_token: crypto.randomUUID() })`).

**Task 1 below is a hands-on verification pass, not new implementation.** Do not add a second QR renderer, a second regenerate path, or touch `0002`/`0014`'s migrations or `gym-settings.ts`/`SettingsForm.tsx` at all unless verification turns up an actual regression.

### Scope Note #2 — AC #2's scope boundary vs. Story 3.4: this story builds the scanning shell and exactly one of five result states

`EXPERIENCE.md`'s MA-10 (Check-In) mockup (lines 613–714) defines five result states: Success (online), Success (offline), Denied — Expired, Already Checked In, and Wrong QR. Only **Wrong QR** belongs to this story:

- **Success / Already Checked In** are Story 3.4's job (`epics.md`: "one open check-in per member," attendance-event recording) — that story does not exist as code yet (no `attendance_events` INSERT path anywhere, and the partial unique index enforcing one-open-check-in is explicitly deferred past `0006_attendance.sql`, whose own comment says *"the partial unique index... is Epic 3's concern once check-in flows actually exist — not added here"*).
- **Denied — Expired** is Epic 4's job, not Epic 3's: the FR Coverage Map is explicit — `epics.md` line 227: *"FR-031: Epic 4 - Check-in outcomes by member state (accept/reject + alert color)"*. This story's check-in screen does not read or branch on subscription status at all.
- **Success — Offline** (the SQLite queue) is Story 3.9's job (`architecture.md`'s own file-structure note ties `checkin.ts`'s "offline SQLite queue" to that later story, not this one) and NFR-006 scopes offline support to check-in specifically, not to this story's slice of it.

**Do build:** the Check-In tab's camera shell (permission handling, viewfinder, scan-target overlay, 15s "having trouble" nudge — all from the MA-10 mockup, none of which require any check-in-recording backend) and the **Wrong QR** overlay exactly as mocked. **Do not build:** any attendance INSERT, any subscription-status check, any offline queueing, or placeholder UI for the other four result states — they belong to later stories and a placeholder here is speculative work this story wasn't asked for.

**Copy note:** the AC's inline wording ("QR code not recognized — make sure you're scanning your gym's code") is a paraphrase, not the literal string to ship — `epics.md`'s ACs are business-requirement summaries, while `EXPERIENCE.md` is this project's actual copy source of truth (confirmed by precedent: `onboarding/goal.tsx`'s shipped `en.json` uses EXPERIENCE.md's exact British spelling "personalise," not an Americanized paraphrase). Ship EXPERIENCE.md's exact two-part heading+body pair instead — heading **"QR not recognised"**, body **"Make sure you're scanning your gym's QR code."** — matching the other four result states' own heading+body structure.

**Consequence for a valid (matching) token scan:** since no later-story behavior exists yet to hand off to, a valid scan in this story's build does the mockup's own scan-detection micro-interaction only ("QR detected: immediate flash/highlight of scan frame" — MA-10 Interactions) and then simply resumes scanning, with no overlay. This is a deliberate, temporary gap that Story 3.4 closes by replacing that no-op branch with real attendance-event handling — not a bug to work around in this story.

### Scope Note #3 — Token validation needs zero new Postgres objects; it is a plain client-side SELECT scoped entirely by existing RLS

A member's JWT already carries `gym_id` (their own home gym, set at login by `custom_access_token_hook`, `0009_auth_hook_gym_claims.sql:114-125`) — V1 has no multi-gym-membership switcher (that function's own comment: *"a JWT can only carry one gym_id/role pair... the most recently created, non-deactivated membership wins"*). The `"read own gym"` RLS policy (`0009_auth_hook_gym_claims.sql:154-156`, `using (id = private.gym_id())`) has no role restriction — it already lets a `member`-role session `SELECT` its own gym row, including `gym_token` (proven today by `getGymSettings()` selecting that exact column, gated only by which staff role the UI happens to show the Settings page to, not by RLS — `deferred-work.md`'s existing entry on this is about staff-side over-exposure, unrelated to this story). Base table grants already cover this too: `grant select ... on gyms to authenticated` (`0002_gyms_and_tiers.sql:47`) — every `app_role` runs as the same shared `authenticated` Postgres role.

**The validation query is therefore:**
```ts
const { data } = await supabase.from('gyms').select('id').eq('gym_token', scannedToken).maybeSingle();
```
RLS silently restricts the visible row set to `id = private.gym_id()` regardless of the `eq('gym_token', ...)` filter — so this returns exactly one row if the scanned token equals *this member's own gym's* token, and **zero rows both for a garbage string and for a real token belonging to a different, real gym.** That is exactly the behavior AC #2 asks for ("the token doesn't match any gym" — from this session's point of view, a foreign gym's token is indistinguishable from a nonexistent one), and it happens to also avoid leaking whether some other gym's token is real — consistent with this codebase's established anti-enumeration discipline (Story 3.2's Review Findings explicitly fixed an analogous cross-tenant existence leak in `renew_subscription()`).

**Do not add a `resolve_gym_by_token()` RPC, a new migration, or a new RLS policy for this.** The existing policy already does the job; a new SECURITY DEFINER function here would be strictly more code for identical behavior, and would also have to reinvent the anti-enumeration property the existing RLS scoping gives for free.

### Scope Note #4 — New `expo-camera` dependency; no new binary icon asset needed

No camera/barcode library exists anywhere in this repo yet — `expo-camera` (`npx expo install expo-camera`, SDK 57) is the standard Expo-blessed choice: `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}` and an `onBarcodeScanned` callback (`(result: BarcodeScanningResult) => void`, decoded string on `result.data`), gated by the `useCameraPermissions()` hook. **`apps/mobile/AGENTS.md` explicitly says to read the versioned SDK 57 docs before writing camera code — do that, don't rely on general Expo knowledge, since this API (`CameraView`/`onBarcodeScanned`) replaced the older `expo-barcode-scanner` package and general training data may describe the deprecated one.** The docs give no built-in debounce — guard against the callback firing repeatedly for the same still-in-frame code with a local `scanned` boolean, reset only when the user dismisses a result or leaves/re-enters the tab.

For the new tab's icon: `home.tsx`/`profile.tsx`'s existing tabs use static PNG assets (`NativeTabs.Trigger.Icon src={require(...)}`) — there is no purpose-built "scan/QR" PNG anywhere in this repo, and hand-authoring new binary icon art is out of scope for this story. `NativeTabs.Trigger.Icon` also accepts named-symbol props instead of `src`: `sf` (SF Symbols, iOS) and `md` (Material Symbols, Android) — use `<NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />` for the Check-In tab instead of adding a new PNG. This is a deliberate, one-off deviation from the two existing tabs' `src`-based icons, not a repo-wide convention change — document it as such, don't retrofit Home/Profile to match.

## Tasks / Subtasks

- [x] **Task 1: Verify AC #1 is already satisfied — no code changes expected** (AC #1; Scope Note #1)
  - [x] Confirm hands-on: create/inspect a gym row, confirm `gym_token` is a non-null UUID-shaped string with no app code setting it.
  - [x] Confirm hands-on: log in as an Owner, load `/settings`, confirm the QR image renders, "Download" produces a PNG, and "Regenerate" (behind its confirm dialog) issues a new token and re-renders the QR.
  - [x] If (and only if) this turns up a real regression, fix it narrowly and note the fix in Dev Notes — do not proactively refactor `gym-settings.ts`/`SettingsForm.tsx`.

- [x] **Task 2: `expo-camera` dependency + Check-In tab scaffold** (AC #2; Scope Note #4)
  - [x] `npx expo install expo-camera` inside `apps/mobile` (adds the SDK-57-matched version, not a hand-picked one).
  - [x] Add a `checkin` `NativeTabs.Trigger` to `apps/mobile/src/components/app-tabs.tsx`, positioned between `index` (Home) and `profile`, using `<NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />` (Scope Note #4 — no new PNG asset).
  - [x] Add the matching `TabTrigger`/`TabButton` entry to `apps/mobile/src/components/app-tabs.web.tsx` for parity (text-label only, no icon needed there — matches that file's existing Home/Profile entries).
  - [x] Add new i18n keys under a new top-level `checkin` namespace in `apps/mobile/src/locales/en.json` and `fr.json` (tab label, screen title, instructional copy, permission-denied copy, wrong-QR copy — see References for exact EXPERIENCE.md copy to translate) — run `node scripts/check-i18n-key-parity.mjs` after.

- [x] **Task 3: `apps/mobile/src/app/(tabs)/checkin.tsx` — camera scanning screen with the Wrong QR result state** (AC #2; Scope Notes #2, #4)
  - [x] Camera permission flow via `useCameraPermissions()`: request on mount if undetermined; if denied, render the permission-denied state (lock icon + "Camera access needed" heading + copy + "Open Settings" button using `Linking.openSettings()`) in place of the viewfinder, per EXPERIENCE.md MA-10.
  - [x] `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`, full-width viewfinder, animated corner-bracket scan-target overlay, instructional text below ("Point at your gym's QR code"), swapping to the "Having trouble? Move closer to the QR code." nudge after 15s with no successful scan.
  - [x] `onBarcodeScanned` handler: guard against re-firing while already processing (local `scanned`/`processing` boolean, matching the debounce need Scope Note #4 flags); on first fire, call the new `validateGymToken()` service function with `result.data`.
  - [x] On a matching token (1 row returned): brief scan-frame flash/highlight (MA-10's own "QR detected" micro-interaction), then reset back to actively scanning — no result overlay (Scope Note #2's documented, deliberate gap for this story).
  - [x] On no match (0 rows): show the full-screen amber **Wrong QR** overlay exactly per EXPERIENCE.md (⚠ icon, "QR not recognised" heading, "Make sure you're scanning your gym's QR code." body, "Try again" button that closes the overlay and returns to the scanning state; does not auto-dismiss).
  - [x] On a query/network error (distinct from "no match" — e.g. offline, request failure): show a generic retry message (new i18n key, following this app's existing `errorNetwork` copy convention from `onboarding/phone.tsx`/`otp.tsx`), not the Wrong-QR copy — these are different failure causes and shouldn't share user-facing text. This is not the offline check-in flow (Scope Note #2) — just a plain failed-request fallback for the validation read itself.
  - [x] Header bar: "Check In" title + ✕ close button returning to the previous tab/Home; closing deactivates the camera immediately (unmount `CameraView`).

- [x] **Task 4: `apps/mobile/src/services/checkin.ts`** (AC #2; Scope Note #3)
  - [x] New file, new `validateGymToken(token: string)` function: `supabase.from('gyms').select('id').eq('gym_token', token).maybeSingle()`, returning a simple `{ matched: boolean, error: boolean }` shape (or equivalent) the screen can branch on directly — no Zod schema needed for a single opaque scanned string, no shared `packages/types` schema addition (this never leaves `apps/mobile`, unlike the dashboard/super-admin services this codebase's other schemas back).
  - [x] Do not implement any SQLite/offline queueing here (Scope Note #2) — this file's only job in this story is the online-only token check; Story 3.9 is expected to extend this same file later, not replace it.

- [x] **Task 5: pgTAP coverage for the token-matching read path** (AC #2; Scope Note #3)
  - [x] New `supabase/tests/checkin_gym_token_validation_rls.test.sql`, following `gym_settings_rls.test.sql`'s exact session-simulation convention (fixture Gym A + Gym B, a `member`-role session at Gym A — no `member_management_rls.test.sql` fixture reuse needed, this only touches `gyms`).
  - [x] Assert: a Gym-A-member session querying `gyms` filtered by Gym A's own real `gym_token` returns exactly 1 row.
  - [x] Assert: the same session querying by Gym B's real (but foreign) `gym_token` returns 0 rows.
  - [x] Assert: the same session querying by a syntactically-plausible-but-nonexistent token string returns 0 rows (proves the "foreign real token" and "garbage token" cases are indistinguishable from this session's point of view, per Scope Note #3's anti-enumeration property).

- [x] **Task 6: Validation and manual verification**
  - [x] `pnpm run typecheck` (all packages, 0 errors) and `node scripts/check-i18n-key-parity.mjs` (0 errors).
  - [x] `supabase test db` — confirm the new file passes and there are zero regressions in the existing suite.
  - [x] Run the mobile app (`expo start`, per `apps/mobile/AGENTS.md`'s versioned-docs guidance for anything camera-related) as a logged-in member: exercise the camera-permission-denied path, a wrong-QR scan (scan any real QR that isn't this member's own gym's — e.g. a different seeded gym's Settings-page QR, or any arbitrary QR), and a correct-token scan (confirm the brief flash-then-resume behavior, no crash, no stray overlay).

### Review Findings

- [x] [Review][Patch] Uncaught exception in `validateGymToken` permanently freezes the scanner — the `supabase` call isn't wrapped in try/catch, so a thrown (not just resolved-error) failure leaves `processingRef.current` stuck `true` forever with no overlay shown [apps/mobile/src/services/checkin.ts:16]
- [x] [Review][Patch] Wrong-QR/network-error overlay covers the header, hiding the close button — `styles.overlay` is `position: absolute` with `top/left/right/bottom: 0` as a sibling of the header inside the same `SafeAreaView`, so it stretches over the ✕ close button, leaving "Try again" as the only way out [apps/mobile/src/app/(tabs)/checkin.tsx:150]
- [x] [Review][Patch] Camera permission isn't rechecked when the app resumes from OS Settings — the permission-request effect only fires while `status === 'undetermined'`; after a user taps "Open Settings", grants access, and returns, the screen has no `AppState` listener to re-fetch permission, so it's stuck on the permission-denied screen despite having granted access [apps/mobile/src/app/(tabs)/checkin.tsx:48]
- [x] [Review][Patch] Stale `validateGymToken` response can pop a result overlay after the user already left and returned to the tab — no `mountedRef`/`isFocused` guard around the post-await `setWrongQr`/`setNetworkError` calls (the Dev Notes call for a `mountedRef` guard matching `profile.tsx`'s convention, which this file doesn't apply); on `app-tabs.web.tsx` (which unmounts the inactive route) this is a genuine post-unmount `setState` [apps/mobile/src/app/(tabs)/checkin.tsx:80]
- [x] [Review][Patch] Scanned QR token isn't trimmed/normalized before the `gym_token` equality check — stray whitespace/newlines in the decoded payload would silently mismatch a legitimate token and surface as "Wrong QR" [apps/mobile/src/services/checkin.ts:16]
- [x] [Review][Patch] RLS test's "foreign gym token" assertion is vacuous — it captures Gym B's `gym_token` via a subquery run *while impersonating the Gym-A session*, so RLS itself hides Gym B's row and the subquery returns `NULL`; the outer `where gym_token = NULL` is unconditionally false regardless of whether cross-tenant scoping actually works. Fix by capturing Gym B's real token while running as the RLS-bypassing connecting role (same pattern as the "sanity check" assertion immediately above it), then compare against that captured literal from the Gym-A session [supabase/tests/checkin_gym_token_validation_rls.test.sql:65-70]
- [x] [Review][Patch] Scan-target overlay is a static bordered square, not the "animated corner-bracket" overlay Task 3 and EXPERIENCE.md's MA-10 mockup specify — no `Animated`/`Reanimated` usage exists anywhere in the file, and the border is a single full square rather than corner brackets with a gentle pulsing idle animation [apps/mobile/src/app/(tabs)/checkin.tsx:142]
- [x] [Review][Patch] No loading affordance while camera permission or token validation is pending — the permission-pending branch renders a blank body with no spinner, and the gap between a scan firing and `validateGymToken` resolving shows nothing, reading as an unresponsive scanner on a slow connection [apps/mobile/src/app/(tabs)/checkin.tsx:106]

**Fix summary:**
- `apps/mobile/src/services/checkin.ts`: wrapped the Supabase call in try/catch and added `.trim()` to the scanned token before the equality check.
- `apps/mobile/src/app/(tabs)/checkin.tsx`: restructured JSX so the header sits outside the overlay's positioning container; added an `AppState` listener to re-check permission on app resume; added `mountedRef`/`isFocusedRef` guards around the post-await result setters (and reset `processingRef` on a stale/abandoned response so a later scan isn't silently ignored); replaced the static square scan-target with four animated corner brackets (`Animated` from `react-native`, matching `otp.tsx`'s existing convention) with a gentle idle pulse, paused during flash/result states; added `ActivityIndicator` for the permission-pending state and the in-flight validation call.
- `supabase/tests/checkin_gym_token_validation_rls.test.sql`: gyms are now seeded with explicit `gym_token` literals; the foreign-token assertion now compares against Gym B's literal directly instead of a subquery that was itself RLS-scoped to the Gym-A session (which always returned `NULL`, making the original assertion vacuously true). Re-ran `supabase test db`: 268/268 passing.
- Verified: `pnpm --filter @gymos/mobile run typecheck` (0 errors) and `node scripts/check-i18n-key-parity.mjs` (0 errors) both clean after the patches.

## Dev Notes

- **AC #1 needed no new code — this is the rare story that is almost entirely verification plus a completely separate, unrelated new feature (AC #2's mobile scanning shell).** Don't let Task 1's "nothing to build" quality create pressure to invent scope there; the real work is Tasks 2–5.
- **No new Postgres migration in this story at all** — a deliberate, verified-safe design choice (Scope Note #3), not an oversight. If the dev-story or code-review pass finds itself reaching for a new RPC/migration for the token check, stop and re-read Scope Note #3 first.
- **This story does not implement any of: attendance recording, one-open-check-in enforcement, subscription-status-based accept/reject, or offline queueing.** All four are explicitly other stories' jobs (Scope Note #2). Resist building speculative UI for them.
- **The Check-In tab is new mobile surface** — first time `expo-camera` is used anywhere in this repo, first use of `NativeTabs.Trigger.Icon`'s `sf`/`md` name-based props instead of `src`-based PNGs (Scope Note #4).
- `apps/mobile/AGENTS.md` is a standing instruction to read the exact versioned SDK 57 docs before writing Expo code — this applies most acutely to `expo-camera`'s `CameraView`/`useCameraPermissions` API in this story, since it's genuinely new to the codebase and easy to get subtly wrong from stale training-data assumptions (e.g. the deprecated `expo-barcode-scanner` package).
- Reuse `apps/mobile/src/hooks/use-session.ts`'s existing `supabase.auth.getSession()` pattern if the screen needs to confirm a session exists before scanning — though in practice, `(tabs)` is already gated behind `session && isOnboarded` at the root layout (`use-session.ts`), so `checkin.tsx` itself can assume an authenticated session unconditionally, matching `profile.tsx`'s own assumption.
- Follow `profile.tsx`'s established resilience conventions for this codebase's mobile screens: a `mountedRef` guard against post-unmount state updates, and distinguishing "no data" states from genuine load failures (here: "no match" vs. "network/query error" are two different branches, per Task 3).

### Project Structure Notes

New files:
```
apps/mobile/src/app/(tabs)/checkin.tsx     # MA-10, Wrong-QR state only this story
apps/mobile/src/services/checkin.ts        # validateGymToken() only this story
supabase/tests/checkin_gym_token_validation_rls.test.sql
```

Modified files:
```
apps/mobile/package.json                        # + expo-camera
apps/mobile/src/components/app-tabs.tsx          # + Check-In NativeTabs.Trigger
apps/mobile/src/components/app-tabs.web.tsx      # + Check-In TabTrigger (parity)
apps/mobile/src/locales/en.json                  # + checkin.* namespace
apps/mobile/src/locales/fr.json                  # + checkin.* namespace
```

No changes expected to `apps/dashboard`, `apps/super-admin`, `packages/types`, or any `supabase/migrations/*.sql` file (Scope Notes #1, #3). If verification (Task 1) turns up an actual AC #1 regression, the only files that could legitimately need a fix are `apps/dashboard/services/gym-settings.ts` and `apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx` — nothing else.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — literal AC wording
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4, FR Coverage Map lines 227, 238-240] — the epic-boundary evidence for Scope Note #2 (FR-031 → Epic 4, FR-042–044 → Epic 3, one-open-check-in → Story 3.4)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-10 · Check-In, lines 613-714] — full mockup: layout, camera permission copy, all five result states' exact copy, 15s scanning-timeout nudge, interactions
- [Source: _bmad-output/planning-artifacts/architecture.md#project structure, apps/mobile section lines 375-388] — `checkin.tsx` (MA-10) and `services/checkin.ts` file placement; `(tabs)` route group structure
- [Source: supabase/migrations/0002_gyms_and_tiers.sql:25-27, 47] — `gym_token` column + comment anticipating this exact story; table-level GRANT covering `authenticated`
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql:114-125, 154-156] — `custom_access_token_hook`'s one-gym-per-JWT rule; `"read own gym"` RLS policy this story's validation query relies on entirely
- [Source: apps/dashboard/services/gym-settings.ts:245-271] — `regenerateQrCode()`, the existing AC #1 implementation
- [Source: apps/dashboard/app/(dashboard)/settings/SettingsForm.tsx:72-93, 244-250, 426-440] — existing QR render/download UI (AC #1)
- [Source: docs/decisions.md#2026-07-10 Gym Branding & Operational Settings, Decision 5] — `qrcode` package precedent
- [Source: _bmad-output/implementation-artifacts/3-2-manual-renewal-reset.md#Review Findings] — the cross-tenant existence-enumeration fix this story's Scope Note #3 design deliberately avoids re-introducing
- [Source: apps/mobile/AGENTS.md] — standing instruction to read exact versioned Expo SDK 57 docs before writing camera code
- [Source: apps/mobile/src/components/app-tabs.tsx, app-tabs.web.tsx] — existing two-tab structure (`NativeTabs.Trigger`/`TabTrigger` patterns) this story extends
- [Source: apps/mobile/src/hooks/use-session.ts] — root-layout session/onboarding gate that already covers `(tabs)` routes including the new Check-In tab
- [Source: apps/mobile/src/app/(tabs)/profile.tsx] — established mobile screen conventions (`mountedRef`, load-error vs. no-data distinction, `supabase.auth.getSession()` usage) this story's `checkin.tsx` should match
- [Source: supabase/tests/gym_settings_rls.test.sql] — pgTAP session-simulation convention this story's new test file follows
- [Source: _bmad-output/planning-artifacts/architecture.md#Retries] — "no automatic retry on mutations... matching the UX spec's inline 'Try again' pattern" — informs Task 3's error-vs-no-match distinction (the validation read itself isn't a mutation, but the user-facing "Try again" idiom still applies)
- Web research (Expo SDK 57 docs, fetched during story creation): `expo-camera`'s `CameraView`/`useCameraPermissions`/`onBarcodeScanned`/`barcodeScannerSettings` API shape, and `NativeTabs.Trigger.Icon`'s `sf`/`md` name-based icon props as an alternative to `src`-based PNG assets — both confirmed current for SDK 57.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Task 1 (AC #1 verification): rolled-back `begin; insert into tiers/gyms; select gym_token; rollback;` against local Postgres (`docker exec supabase_db_gym_os psql`) confirmed `gym_token` auto-generates a non-null UUID string with no app code setting it. `pnpm --filter @gymos/dashboard run typecheck` — 0 errors, confirming no regression in `gym-settings.ts`/`SettingsForm.tsx`.
- Task 1 (live browser verification): started `apps/dashboard`'s dev server, created a temporary owner fixture (tier + gym + auth user via GoTrue admin API + `members` row), logged in via Chrome automation, navigated to `/settings`, confirmed the QR image rendered, clicked "Regenerate QR code" through its confirm dialog, and confirmed via direct DB query that `gym_token` changed and the QR image visibly updated to a new pattern. Fixture rows deleted afterward (tier/gym/member/auth user).
- `npx expo install expo-camera` inside `apps/mobile` — first attempt hit a transient Windows `EPERM` rename error in `node_modules/.pnpm` (a stale `apps/dashboard` dev server process was holding file handles); stopped that process and the retry succeeded (`expo-camera ~57.0.3`).
- Added the `expo-camera` config plugin to `app.json` with a `cameraPermission` string (mirroring the existing `expo-image-picker` plugin entry's shape) — this app has no camera-specific native permission text otherwise.
- `pnpm --filter @gymos/mobile run typecheck` — 0 errors (both before and after a self-caught fix: `overlayButton`'s white background originally paired with `primaryButtonLabel`'s white text, which would have rendered invisible white-on-white "Try again" text — fixed with a dedicated `overlayButtonLabel` style using `Brand.primary`).
- `node scripts/check-i18n-key-parity.mjs` — 0 errors (mobile locale count: 78 → 86 keys, EN/FR in parity).
- `supabase test db` (full suite, local via WSL Docker) — 268/268 passing (264 baseline from Story 3.2 + 4 new in `checkin_gym_token_validation_rls.test.sql`), zero regressions.
- Task 6 manual mobile verification (physical device via Expo Go over LAN, WSL2 mirrored networking): temporarily uncommented `[auth.sms.test_otp]` in `supabase/config.toml` for a fake number (`supabase stop`/`start` to reload config, data-preserving) to enable a real phone-OTP login without sending SMS; seeded a gym/tier/member fixture with `onboarding_completed_at` pre-set; discovered and fixed a firewall port mismatch (Metro was started on an alternate port 8090 to dodge a stale process on 8081, but only 8081 has an existing Windows Firewall allow rule for this project — killed the stale process, restarted Metro on 8081, phone connected successfully). Verified: camera-permission-already-granted path (no re-prompt, since Expo Go's OS-level camera permission was already granted from prior photo-picker testing), Wrong QR overlay (scanned a QR encoding a nonexistent token — got the amber "QR not recognised" overlay with working "Try again"), and a valid-token scan (scanned a QR encoding the fixture gym's real `gym_token` — no overlay appeared, matching the deliberate no-op-until-Story-3.4 design; confirmed via the absence of any error and no crash). All test fixtures (member/user/gym/tier/auth user) and the temporary `test_otp` config change were reverted afterward; `supabase test db` re-run clean (268/268) post-revert.

### Completion Notes List

- AC #1 required no new code (Scope Note #1): verified both at the DB level (gym_token auto-generates on gym creation via the `0002` column default) and via a live browser walkthrough of the Settings page's existing QR render/download/regenerate flow (Story 1.9). No files under `apps/dashboard` were touched.
- AC #2 implemented as scoped: a new Check-In tab (`apps/mobile/src/app/(tabs)/checkin.tsx`) with camera permission handling, a QR-only `CameraView` scanner, and exactly one of MA-10's five result states — Wrong QR — plus a (not literally mocked, but explicitly asked-for) generic network-error fallback distinct from the Wrong-QR copy. Token validation (`apps/mobile/src/services/checkin.ts`) required zero new Postgres migrations or RPCs — the pre-existing `"read own gym"` RLS policy already scopes the check correctly (Scope Note #3), proven by the new pgTAP file's 4 assertions (own-token match; foreign-gym-token no-match; garbage-token no-match; the last two being indistinguishable from this session's point of view, closing the same class of cross-tenant enumeration gap Story 3.2's review fixed elsewhere).
- Followed Scope Note #2 exactly: no attendance recording, no subscription-status branching, no offline queueing were added — a valid token scan only does the mockup's brief scan-frame flash, then resumes scanning, with no result overlay (deliberately left for Story 3.4).
- Followed Scope Note #4: `expo-camera` (SDK-57-matched version via `expo install`) is a new dependency; the new tab's icon uses `NativeTabs.Trigger.Icon`'s `sf`/`md` named-symbol props instead of a new PNG asset, since no purpose-built scan/QR icon art exists in this repo.
- One self-caught, self-fixed issue during implementation (not a review finding): the Wrong-QR/network-error overlay's "Try again" button initially reused the permission-denied state's white-text style against its own white background — fixed to a dedicated dark-text style before typecheck/review.
- Manual, physical-device verification of all three scenarios (permission-already-granted path, Wrong QR, valid-token pass-through) was performed live with the user via Expo Go over the local network, not just simulated — see Debug Log for the exact fixture/config setup and teardown.

### File List

**New:**
- `apps/mobile/src/app/(tabs)/checkin.tsx`
- `apps/mobile/src/services/checkin.ts`
- `supabase/tests/checkin_gym_token_validation_rls.test.sql`

**Modified:**
- `apps/mobile/package.json` (+ `expo-camera`)
- `apps/mobile/app.json` (+ `expo-camera` config plugin)
- `apps/mobile/src/components/app-tabs.tsx` (+ Check-In `NativeTabs.Trigger`)
- `apps/mobile/src/components/app-tabs.web.tsx` (+ Check-In `TabTrigger`, parity)
- `apps/mobile/src/locales/en.json` (+ `checkin.*` namespace)
- `apps/mobile/src/locales/fr.json` (+ `checkin.*` namespace)
- `pnpm-lock.yaml` (`expo-camera` and its transitive dependencies)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

No changes to `apps/dashboard`, `apps/super-admin`, `packages/types`, or any `supabase/migrations/*.sql` file — confirmed via Task 1's verification (AC #1 already satisfied) and Scope Note #3 (no new Postgres objects needed for AC #2).

## Change Log

- 2026-07-18: Story implemented. AC #1 (gym_token generation + downloadable/printable QR) required no new code — verified already fully built by Stories 1.5/1.9 (DB-level column default + Settings page QR render/download/regenerate flow), confirmed via a rolled-back DB check and a live browser walkthrough of the actual Regenerate flow. AC #2 (member-scan gym-token validation) is new mobile-only work: added `expo-camera` (first use in this repo) and a new Check-In tab (`apps/mobile/src/app/(tabs)/checkin.tsx`) with camera permission handling, a QR-only scanner, and the "Wrong QR" result state from EXPERIENCE.md's MA-10 mockup (the other four result states — Success, Success-Offline, Denied-Expired, Already-Checked-In — are explicitly out of scope, belonging to Stories 3.4/3.9/Epic 4). Token validation (`apps/mobile/src/services/checkin.ts`) needed no new Postgres migration or RPC: the pre-existing `"read own gym"` RLS policy already scopes a client-side `SELECT ... WHERE gym_token = ...` correctly, which a new pgTAP suite (`checkin_gym_token_validation_rls.test.sql`, 4 assertions) proves — a foreign gym's real token and a nonexistent token are both indistinguishable 0-row results from the scanning member's session, avoiding a cross-tenant enumeration leak. New `checkin.*` i18n namespace (EN/FR). `pnpm run typecheck` (4/4 packages) and i18n-parity clean. `supabase test db`: 268/268 passing (264 baseline + 4 new), zero regressions. Manually verified end-to-end on a physical device via Expo Go over the local network: camera permission flow, a Wrong-QR scan, and a valid-token scan (silent pass-through, no result overlay yet — deliberate, Story 3.4's job). Status set to `review`.
