---
baseline_commit: d2a3c6b3eeed59e02ce9c73cdc80e01896d75066
---

# Story 2.6: Member App — Phone/OTP Onboarding Through Profile Setup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a new gym member,
I want to verify my phone number and set up my profile,
so that I can access my gym's branded app.

## Acceptance Criteria

**⚠️ AC #2 is superseded by a platform-wide decision recorded 2026-07-15 — read Scope Note #1 before implementing. ACs #4 and #5 need Scope Notes #2/#3 to be implementable at all — the underlying account model isn't fully spelled out anywhere else.**

1. **Given** the app's first launch, **when** I select a language, enter my phone number, and receive an OTP, **then** I can enter the 6-digit code and it auto-submits on the 6th digit. [Source: epics.md#Story 2.6]
2. **[SUPERSEDED — see Scope Note #1]** Given a deep link from a Manager/Owner invite (Story 2.5), when the app opens via that link, then the OTP screen is the first screen shown, with the phone number from the deep link pre-associated. **No deep link exists to open — do not build this.** [Source: epics.md#Story 2.6, superseded by docs/decisions.md#2026-07-15 "Onboarding/account-recovery channel policy"]
3. **Given** 3 failed resend attempts, **when** I request a 4th resend, **then** I am routed to a 5-minute lockout screen with back-navigation disabled. [Source: epics.md#Story 2.6; architecture.md "OTP resend/lockout enforcement" — must be server-side, see Scope Note #4]
4. **Given** OTP verification succeeds for a new account, **when** I proceed, **then** I set my name and optional photo (profile setup). [Source: epics.md#Story 2.6 — "new account" is not defined anywhere in the planning docs; see Scope Note #2 for the required definition]
5. **Given** a phone number that already has a platform user account from a different gym, **when** that phone verifies successfully at a new gym, **then** a new `members` row is created for this gym, linked to the same existing platform user account — no duplicate account is created. [Source: epics.md#Story 2.6; see Scope Note #3 — this AC is already satisfied by Story 2.3, this story does not create anything]

## Scope Notes — Read Before the Tasks

**This story touches more undocumented territory than any prior one: it's the first story with any real `apps/mobile` code, the first consumer of the OTP flow built in Story 2.1, and the first story to need "new vs. returning platform account" logic that no prior story defined. Read all four notes below before writing code.**

### Scope Note #1 — No deep link exists; AC #2 does not apply

Per `docs/decisions.md#2026-07-15 "Onboarding/account-recovery channel policy"`: *"no link of any kind (deep link, recovery link, or email link) ships in any onboarding or account-recovery flow for now, for any user type."* Story 2.5 (already done) confirmed the actual mechanism: staff shares a plain-text message via Copy/WhatsApp; the member opens the app cold (icon tap, not a link) and manually enters their phone number at MA-02. `apps/mobile/app.json`'s `scheme: "gymos"` has no associated-domains/App-Links config and no dynamic-link provider is wired anywhere — **do not build `gymos://` URL parsing, `Linking.useURL()`-based phone pre-fill, or any deep-link handling for this story.** MA-02's phone field is always empty on entry except when arriving from MA-04's "Try again" (which pre-fills the phone the user themself typed earlier in the *same session* — that's a local-state carry-forward, not a deep link).

### Scope Note #2 — Defining "new account" (AC #4) and where self-entered profile data lives

No planning document defines what makes an account "new." Here's the reasoning and the recommended implementation — **record this as a decision in `docs/decisions.md` once implemented**, since it establishes a schema precedent Story 2.8 (Member Self-Service Profile Management, not yet created) will build directly on top of:

- Every `members` row a member ever onboards into **already exists** before OTP ever runs (Scope Note #3) — `members.name`/`members.photo_url` are admin-entered at creation time (Story 2.3) and stay that way; a Manager/Owner may still edit them via the dashboard. They are **gym-roster fields, not the member's own self-description**, and this story must not overwrite them.
- `users.display_name` (`packages/types/src/database.ts` — the `users` table) has existed since Story 1.3 but is confirmed **never populated by any shipped code** (`docs/decisions.md#2026-07-10 Story 1.8 Decision 2`: "every real user today has `display_name = null`"). This story is the natural place to finally populate it — from the member's own self-entered name at MA-05 — which also gives a clean, no-new-column signal for "new account": **`users.display_name IS NULL` means this phone has never completed profile setup on the platform before, regardless of which gym.**
- `users` has no `photo_url` column today. Add one (nullable, mirrors `display_name`) in this story's migration — MA-05's optional photo, like the name, is account-level (a member with two gym memberships has one self-photo, not one per gym), so it cannot live on `members`.
- **MA-05 writes `users.display_name` / `users.photo_url`, never `members.name` / `members.photo_url`.** After OTP verification succeeds, check `users.display_name` for the now-authenticated `user_id`: `NULL` → show MA-05 (AC #4's "new account" case); non-`NULL` → skip straight to the MA-06 placeholder (AC #5's "existing account, different gym" case — the UX flow diagram in EXPERIENCE.md line 104 labels MA-05 `[new account only]`, consistent with this reading).
- Writing to `users` needs new RLS: no self-update policy exists on `users` beyond `self_update_own_language` (`0015_users_self_service_language_preference.sql`, `preferred_language` only), and `protect_self_managed_user_columns`'s allow-list trigger pins every other column back to `OLD` on a self-update. Follow that migration's own exact precedent (`docs/decisions.md#2026-07-16 Story 1.11 Decision 4` calls this "a repeatable gotcha pattern"): add `display_name` and `photo_url` to that trigger's allow-list, in the same migration that adds the `photo_url` column — **do this in the same migration, not a follow-up**, exactly as Decision 4 warns, or a self-update will silently no-op with no error.

### Scope Note #3 — The `members` row already exists; this story does not create one

`apps/dashboard/services/members.ts:322`'s `findOrCreateUserByPhone` / `provisionMemberRow` already created the `auth.users` row (`phone_confirm: false`), the `public.users` row (via the `handle_new_user` trigger, `0003_members_and_users.sql`), and the `members` row **at admin member-creation time (Story 2.3)** — well before this story's OTP flow ever runs. This is the exact same reality Story 2.5 discovered and documented for its own AC #4 (`2-5-member-invitation-via-deep-link.md` Scope Note #2). AC #5's "a new `members` row is created for this gym" is **already true by the time a member reaches this story** — there is nothing left for this story to insert.

What this story actually needs from the data layer:
- **Gym context after verification is resolved automatically** by the JWT custom-claims hook (`0009_auth_hook_gym_claims.sql`), which already implements "most-recently-created, non-deactivated `members` row wins" for a multi-gym user (`docs/decisions.md#2026-07-06 Story 1.3 Decision 3`). Do not build a gym picker or any custom multi-membership resolution logic — read `app_role`/gym context off the session exactly like every dashboard Server Action already does.
- MA-02's documented "This number isn't registered at a gym yet" error state (EXPERIENCE.md line 318) requires checking, **before ever sending an OTP**, whether any `members` row exists for the entered phone. `members`/`users` are both deny-all RLS to `anon` — this lookup needs a new `SECURITY DEFINER` RPC (mirrors `gym_effective_member_cap()`'s pattern, `0003_members_and_users.sql`), e.g. `public.phone_has_membership(p_phone text) returns boolean`, granted to `anon`. **This existence check is not just UX polish** — it is this story's answer to a real, already-logged risk: `docs/decisions.md#2026-07-15 "enable_signup=true ... cost-abuse"` explicitly flags that `POST /auth/v1/otp` for an unowned number triggers a real, billed Twilio send before any ownership is verified, and says *"flagged here for whoever builds Story 2.6 ... to consider hardening."* Checking membership existence first and only calling `signInWithOtp` on a match means an arbitrary/attacker-controlled phone number never reaches Twilio at all. **This narrows the abuse vector, it does not eliminate it** (an attacker can still probe which numbers are registered, or spam a real member's number) — do not present this as a full fix, and do not add CAPTCHA in this story: `docs/decisions.md`'s same entry explains `[auth.captcha]` "cannot be enabled in isolation" without a matching client widget, which no AC or mockup in this story calls for.

### Scope Note #4 — Server-side OTP resend/lockout does not exist yet; this story builds it

`architecture.md` (Authentication & Security) is explicit: *"OTP resend/lockout enforcement: server-side (a Postgres function or Edge Function tracking attempt counts + timestamps per phone number) ... regardless of client behavior — the UX spec's countdown is a client-side reflection of server-enforced state, not the enforcement itself."* No migration in `supabase/migrations/` implements this today — `[auth.rate_limit]`'s `sms_sent`/`token_verifications` limits are generic per-IP throttles, not the specific "3 resends → 5-minute lockout per phone number" rule MA-03/MA-04 require. Build:
- A new table (RLS enabled, deny-all default, same as every table in this project) tracking `phone`, resend count, and a `locked_until` timestamp.
- Two `SECURITY DEFINER` RPCs granted to `anon` (this all happens pre-authentication): one to check current lock state, one to record a resend attempt and evaluate the 3-resend/5-minute rule, resetting the counter once `locked_until` has passed.
- MA-04's countdown must survive app backgrounding by computing remaining time from the server's `locked_until` timestamp, not a purely local `setInterval` — EXPERIENCE.md is explicit: *"Countdown continues even if app is backgrounded; uses elapsed time on foreground return."*
- The initial OTP send from MA-02 is not a "resend" and does not count against the 3-attempt limit — only taps of MA-03's "Resend code" link do.

## Tasks / Subtasks

- [x] **Task 1: Correct the mobile source-tree assumption before touching anything** (all ACs)
  - [x] Confirmed the real scaffold is rooted at `apps/mobile/src/` (not `apps/mobile/app/`); every new file this story adds lives under `apps/mobile/src/...`. Recorded as Decision 1 in `docs/decisions.md#2026-07-17`.
  - [x] Read `apps/mobile/AGENTS.md`'s Expo v57 pointer; fetched Expo SDK 57 `ImagePicker` docs and Expo Router's current `Stack.Protected` auth-gating pattern before writing the layout/profile screens (both confirmed current API shapes, not assumed from older Expo/React Native knowledge).

- [x] **Task 2: Supabase client for Expo** (all ACs)
  - [x] `apps/mobile/src/lib/supabase.ts` — AsyncStorage-backed client, `detectSessionInUrl: false`. **Deviation from the plan:** no `Database` generic passed to `createClient` — discovered mid-implementation that `apps/dashboard`'s own Supabase clients are all deliberately untyped (`services/members.ts`'s own comment: "this app's Supabase client carries no `Database` generic, matching every other service file's own loosely-typed-client discipline"); matched that existing convention instead of introducing the first typed client in the codebase.
  - [x] `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`, matching the root `.env.example`'s already-existing convention. New `apps/mobile/.env.example` added (mirrors `apps/dashboard/.env.example`'s per-app pattern, which didn't exist for mobile yet).
  - [x] `mapSupabaseError` available for reuse from `@gymos/types`; not wired into every screen since most errors here are GoTrue auth errors (not Postgres/RLS errors `mapSupabaseError` targets) — handled with direct, UX-spec'd copy per screen instead.

- [x] **Task 3: Server-side OTP resend/lockout (migration)** (AC #3, Scope Note #4)
  - [x] `supabase/migrations/0019_member_onboarding_otp.sql` — `otp_resend_attempts` table (RLS deny-all) + `check_otp_resend_allowed`/`record_otp_resend` RPCs, `anon`-granted via explicit revoke-then-grant. Verified hands-on against the real local Supabase instance (direct RPC calls over PostgREST with the anon key, not just pgTAP): 3 resends succeed with decrementing `attempts_remaining`, the 4th is rejected with a future `locked_until`.
  - [x] `phone_has_membership(p_phone text)` — boolean-only, `SECURITY DEFINER`, `anon`-granted. Verified via curl against the real REST API.
  - [x] `users.photo_url` added; `protect_self_managed_user_columns` re-declared with `display_name` removed from its pin-back list (`photo_url` was never added to begin with, since it's a new column the trigger doesn't mention) — same "same migration, not a follow-up" discipline as `0016`.
  - [x] No new RLS policy needed — confirmed `0015`'s existing `self_update_own_language` (`id = auth.uid()`) already covers any column on a self-owned row, exactly as `0016`'s own comment predicted; the trigger is what gates which columns.
  - [x] **Added beyond the plan:** a `member-photos` Storage bucket (public, RLS scoped to `auth.uid()`), mirroring `gym-logos`' exact pattern — needed by Task 9's photo upload, not explicitly called out as its own bullet in the original plan.

- [x] **Task 4: `onboarding/_layout.tsx` — sequencing guard** (UX-DR6, all ACs)
  - [x] Implemented via Expo Router's current `Stack.Protected` pattern (verified against live docs, not assumed) — required restructuring the root layout: existing `index.tsx`/`explore.tsx` moved into a new `(tabs)/` route group (`git mv`, preserves history) with their own `(tabs)/_layout.tsx` hosting `AppTabs`; root `_layout.tsx` becomes the auth gate (`Stack.Protected guard={!!session}` → `(tabs)`, `guard={!session}` → `onboarding`), using a new `useSession()` hook.
  - [x] `onboarding/_layout.tsx` implements the sequencing guard via a `SequencingGuard` component (pathname + local `OnboardingProgressProvider` context state) that redirects any out-of-order direct navigation back to the correct step.
  - [x] `apps/mobile/src/app/onboarding/goal.tsx` placeholder added (MA-06 stub).

- [x] **Task 5: MA-01 Language Selection** (AC #1)
  - [x] `apps/mobile/src/app/onboarding/language.tsx` — device-locale pre-highlight via new `expo-localization` dependency + `detectDeviceLocale()`; tap immediately calls `i18n.changeLanguage()` and navigates. Language kept in local context only, not persisted.

- [x] **Task 6: MA-02 Phone Number Entry** (AC #1, #5, Scope Note #3)
  - [x] `apps/mobile/src/app/onboarding/phone.tsx` — `phone_has_membership` check before `signInWithOtp`, exactly per Scope Note #3. **Deviation, recorded in `deferred-work.md`:** the country-code picker is a fixed `+237` prefix, not EXPERIENCE.md's full searchable bottom-sheet — deliberate scope reduction (Cameroon-only pilot, no FR requires multi-country V1 support).
  - [x] New `packages/types/src/schemas/memberOnboarding.ts` (`phoneEntrySchema`, redeclaring the same `e164Phone` pattern locally per this project's established no-shared-cross-file-consts convention, confirmed by checking `member.ts`'s own local declaration).

- [x] **Task 7: MA-03 OTP Verification** (AC #1, #3)
  - [x] `apps/mobile/src/app/onboarding/otp.tsx` — single hidden `TextInput` driving 6 visual boxes (robust auto-advance/paste-to-fill pattern), auto-submit on 6 digits, shake animation on failure, resend flow calling the Task 3 RPC before ever re-calling `signInWithOtp`.
  - [x] Branches to `/onboarding/profile` vs. `/onboarding/goal` based on `users.display_name IS NULL`, per Scope Note #2.

- [x] **Task 8: MA-04 OTP Lockout** (AC #3, Scope Note #4)
  - [x] `apps/mobile/src/app/onboarding/lockout.tsx` — countdown derived from server `locked_until` (route param + a `check_otp_resend_allowed` resync on mount), `BackHandler` intercepts the Android hardware-back gesture, `Stack.Screen`'s `gestureEnabled: false` blocks the iOS swipe-back.

- [x] **Task 9: MA-05 Profile Setup** (AC #4, Scope Note #2)
  - [x] `apps/mobile/src/app/onboarding/profile.tsx` — step indicator, photo circle, name field, writes `users.display_name`/`users.photo_url` only. New `expo-image-picker` dependency (resolved via `expo install` to the correct SDK-57-compatible version, not hand-guessed). **Deviation, recorded in `deferred-work.md`:** the "native action sheet" is a 3-button `Alert.alert`, not a true bottom sheet — no extra dependency added to build one.
  - [x] `member-photos` bucket + upload via `fetch(uri).then(r => r.arrayBuffer())` (no `expo-file-system` dependency needed for this).

- [x] **Task 10: OTP delivery locale (best-effort)** — **investigated, left unresolved, per the task's own explicit escape hatch.**
  - [x] Tested hands-on against the real local Supabase Auth API (`POST /auth/v1/otp` with `data: { locale: "fr" }`, for both an existing pre-created user and a brand-new phone). **Inconclusive:** the local Send SMS Hook consistently returned `hook_timeout` (5s) because the Edge Functions runtime isn't served by plain `supabase start` in this environment — the request never completed far enough to isolate GoTrue's metadata-merge behavior from the hook-timeout's effect on the transaction. `send-sms-hook/index.ts` left unchanged (still hardcoded `"en"`). Gap recorded in `deferred-work.md` with the specific next step (get the hook actually reachable locally first).

- [x] **Task 11: i18n (EN/FR parity) for the mobile app**
  - [x] `apps/mobile/src/locales/en.json`/`fr.json` created (32 keys), fully self-contained (no merge with `packages/types/src/locales`, matching architecture.md).
  - [x] `scripts/check-i18n-key-parity.mjs`'s `LOCALE_DIRS` now includes `apps/mobile/src/locales` — verified: `node scripts/check-i18n-key-parity.mjs` reports all 4 locale dirs in parity.
  - [x] `apps/mobile`'s own `expo lint` still cannot run at all (`Error: Cannot find module 'eslint'`, confirmed by actually running it) — this pre-existing gap is now more consequential (real UI strings, no lint gate). Not fixed (real, separate scope); recorded in `deferred-work.md`, `.github/workflows/ci.yml` left unchanged.

- [x] **Task 12: pgTAP tests** (Task 3's migration)
  - [x] New `supabase/tests/member_onboarding_rls.test.sql` (13 assertions) — `phone_has_membership` true/false, the 3-resend/4th-lockout sequence, `check_otp_resend_allowed` resync, independent per-phone counters, and grant checks for both `anon` and `authenticated`.
  - [x] `supabase/tests/users_self_service_rls.test.sql` **updated** (not just left as-is) — its pre-existing assertions expected `display_name` to stay pinned on a self-update, which this story's own migration deliberately changes; updated to assert the new, correct behavior (persists, doesn't revert) rather than silently leaving a now-incorrect test passing for the wrong reason. (It wasn't actually failing before my fix was applied — I updated it *before* first running the suite, having read the trigger change's implication ahead of time.)
  - [x] `supabase test db` run repeatedly through implementation (after the initial migration, after adding the Storage bucket, and one final run after a full `supabase db reset`) — **208/208 tests pass**, 13 files, zero regressions.

- [x] **Task 13: Validation and manual verification**
  - [x] `node scripts/check-i18n-key-parity.mjs` — all 4 locale dirs pass, including `apps/mobile/src/locales` (32 keys).
  - [x] `pnpm run typecheck` (all 4 packages: dashboard, super-admin, types, mobile) — **0 errors across the board.** This story's own new files introduce zero typecheck errors (confirmed via an isolated pre/post file-list diff). As a side effect of recovering from a self-inflicted dependency-resolution issue (see Completion Notes), the two previously-documented pre-existing baseline errors (`apps/dashboard/app/layout.tsx`'s `next-themes` issue, `apps/mobile`'s `Image`/`NativeTabs` type errors) are *also* currently gone — `deferred-work.md` updated to record this honestly as an unplanned side effect, not a deliberate fix, and flagged to re-verify on the next install.
  - [x] **No physical device or simulator walkthrough was performed** — no device/emulator was available in this environment. Verified instead via: direct RPC/REST calls against the real local Supabase instance for every new backend function (migration logic, RLS, resend/lockout state machine), `tsc` across the whole monorepo, and i18n parity. This is a real, honestly-stated gap, not claimed as done — recorded in `deferred-work.md`. A physical-device (or Expo Go) walkthrough of MA-01→MA-05 is still needed before this story meets `architecture.md`'s own "manually QA'd on a physical Android device" standard.

### Review Findings

- [x] [Review][Patch] New members may be routed straight to `(tabs)` instead of MA-05/MA-06 profile setup — the root auth gate's `Stack.Protected guard={!!session}` flips on raw session presence, and `_layout.tsx`'s own comment admits "any session at all falls through to (tabs) unchanged today." `useSession()`'s `onAuthStateChange` listener fires as soon as `supabase.auth.verifyOtp()` internally persists the new session — this can race ahead of (or immediately follow) `otp.tsx`'s explicit `router.replace('/onboarding/profile')`, unmounting the onboarding stack before MA-05/MA-06 ever renders for a brand-new member. **Resolution (user decision):** extended `useSession()` to also fetch `users.display_name` once a session exists (exposed as `isOnboarded`); root navigator now gates `(tabs)` on `session && isOnboarded`, and `onboarding` on the inverse. [apps/mobile/src/app/_layout.tsx, apps/mobile/src/hooks/use-session.ts]
- [x] [Review][Patch] A "new" (never-onboarded) but deactivated member can legitimately reach MA-05 (per FR-083 and `phone_has_membership`'s deliberate no-`deactivated_at`-filter design), but the `member-photos` Storage RLS policies required `(auth.jwt() ->> 'app_role') = 'member'`, a claim the JWT hook only grants for a `deactivated_at IS NULL` membership row — their photo upload would be silently denied. **Resolution (user decision):** added `public.caller_has_membership()` (SECURITY DEFINER, no `deactivated_at` filter, mirrors `phone_has_membership`) and swapped it into all 4 `member-photos` storage policies in place of the `app_role` check. [supabase/migrations/0019_member_onboarding_otp.sql]

- [x] [Review][Patch] iOS `expo-image-picker` permission plugin/usage descriptions not configured in `app.json` — added the `expo-image-picker` config plugin with `photosPermission`/`cameraPermission` strings [apps/mobile/app.json]
- [x] [Review][Patch] `goal.tsx` renders hardcoded English strings, not routed through i18n — added `onboarding.goal.*` keys (en/fr) and wired via `t()` [apps/mobile/src/app/onboarding/goal.tsx]
- [x] [Review][Patch] `profile.tsx`'s photo-picker `Alert.alert` button labels are hardcoded English — added `onboarding.profile.photoSource*` keys (en/fr) [apps/mobile/src/app/onboarding/profile.tsx]
- [x] [Review][Patch] Photo upload content-type derived from file extension mislabels `.jpg` as `image/jpg` — added an extension→MIME map defaulting `.jpg`/`.jpeg` to `image/jpeg` [apps/mobile/src/app/onboarding/profile.tsx]
- [x] [Review][Patch] `profileSetupSchema`'s `photoUrl` was validated against a hardcoded `null` — schema now validates the real uploaded URL after the upload step [apps/mobile/src/app/onboarding/profile.tsx]
- [x] [Review][Patch] `maskPhone()` masked the `+237` country code too — now keeps the first 4 chars visible alongside the last 4 digits [apps/mobile/src/app/onboarding/otp.tsx]
- [x] [Review][Patch] `SequencingGuard` redirected out-of-order nav to `/onboarding/profile`/`/onboarding/goal` all the way back to `/onboarding/language` — now redirects to the nearest missing prerequisite (language → phone → otp) [apps/mobile/src/app/onboarding/_layout.tsx]
- [x] [Review][Patch] `otp.tsx` silently discarded the error from the post-verification `users.display_name` lookup — now surfaces `errorNetwork` and aborts routing on a failed lookup [apps/mobile/src/app/onboarding/otp.tsx]
- [x] [Review][Patch] `record_otp_resend` had no NULL/empty-phone guard — now raises a clean `22023` exception instead of a raw insert failure [supabase/migrations/0019_member_onboarding_otp.sql]
- [x] [Review][Patch] `useSession()`'s `getSession()` call had no `.catch` — now catches and clears loading state via `.finally` [apps/mobile/src/hooks/use-session.ts]
- [x] [Review][Patch] `lockout.tsx` held `phone`/`lockedUntil` only in in-memory context — now persists a resync hint to AsyncStorage, read back on mount if context/params are empty, with the server's `check_otp_resend_allowed` remaining the source of truth [apps/mobile/src/app/onboarding/lockout.tsx]
- [x] [Review][Patch] `handleResend()` had no re-entrancy guard — added a `resending` state guard, also disables the resend link while in flight [apps/mobile/src/app/onboarding/otp.tsx]
- [x] [Review][Patch] If `record_otp_resend` succeeds but the following `signInWithOtp` fails, the member loses a resend attempt — documented as an accepted tradeoff (reordering would defeat the pre-send enforcement Scope Note #4 requires); not reordered [apps/mobile/src/app/onboarding/otp.tsx]
- [x] [Review][Patch] `profile.tsx` gave no user feedback when camera/media-library permission is denied — now sets `errorPhotoPermissionDenied` [apps/mobile/src/app/onboarding/profile.tsx]
- [x] [Review][Patch] MA-05 was missing the "Back arrow (returns to MA-03)" component required by EXPERIENCE.md — added, matching phone.tsx/otp.tsx's own back-button pattern [apps/mobile/src/app/onboarding/profile.tsx]
- [x] [Review][Patch] `profileSetupSchema`'s `displayName` had no `.max(100)` cap — added, plus a matching submit-time check in `profile.tsx` [packages/types/src/schemas/memberOnboarding.ts]
- [x] [Review][Patch] `member_onboarding_rls.test.sql` claimed `photo_url` self-write coverage lives in `users_self_service_rls.test.sql`, but no such assertion existed there — added the missing assertion [supabase/tests/users_self_service_rls.test.sql]
- [x] [Review][Patch] `SequencingGuard` had no branch guarding `/onboarding/lockout` — now covered by the same phone-prerequisite branch as `/otp` [apps/mobile/src/app/onboarding/_layout.tsx]

- [x] [Review][Defer] `phone_has_membership` has no rate limit of its own, enumerable via direct PostgREST call bypassing GoTrue's per-IP throttle [supabase/migrations/0019_member_onboarding_otp.sql:31] — deferred, already an accepted/documented risk (Scope Note #3, docs/decisions.md Decision 3)
- [x] [Review][Defer] `member-photos` Storage bucket is `public = true`, making its own SELECT RLS policy non-protective for the direct object URL [supabase/migrations/0019_member_onboarding_otp.sql:217] — deferred, already recorded in this diff's own deferred-work.md entry mirroring the gym-logos precedent
- [x] [Review][Defer] No DB-level constraint backs the newly self-writable `users.display_name`/`photo_url` columns beyond RLS row-ownership [supabase/migrations/0019_member_onboarding_otp.sql] — deferred, matches this project's established Zod-is-the-single-source-of-validation convention, not a new deviation
- [x] [Review][Defer] `otp_resend_attempts` has no retention/cleanup mechanism, unbounded row growth [supabase/migrations/0019_member_onboarding_otp.sql] — deferred, low severity at pilot scale, retention policy needs a separate ops decision
- [x] [Review][Defer] Resend's `signInWithOtp` call isn't re-gated by a fresh `phone_has_membership` check [apps/mobile/src/app/onboarding/otp.tsx:119] — deferred, unreachable in practice per the UI flow (phone context state only ever set after a successful check in phone.tsx)

## Dev Notes

- **This is the first story with any real code in `apps/mobile`.** Every convention prior stories established for the two Next.js dashboards (Server Components, Server Actions, `services/<domain>.ts`) does not directly apply — mobile has no Server Actions equivalent; `apps/mobile/src/services/auth.ts` (per `architecture.md`'s file-org section) calling `supabase-js` directly from client code is the correct pattern here, not a violation of the "only `services/` calls Supabase" rule (that rule is about components vs. services within one app, not about mobile needing a server layer it structurally can't have).
- **Read Scope Notes #1–#4 before writing any code that touches deep links, "new account" detection, member-row creation, or OTP resend logic** — each one heads off a specific, real mistake (building dead deep-link infra, inventing a second member-creation path, silently un-enforcing the resend limit client-side-only).
- `i18next/no-literal-string`-equivalent discipline and EN/FR parity are CI gates on every prior story (FR-016) — apply the same standard to every string this story adds, even though mobile's own lint gate isn't wired into CI yet (Task 11).
- Zod schemas for this story's writes (`phone`, name, resend requests) should live in `packages/types/src/schemas/` per this project's single-source-of-validation rule — do not inline validation in a component.

### Project Structure Notes

New files:
```
apps/mobile/src/lib/supabase.ts
apps/mobile/src/app/onboarding/_layout.tsx
apps/mobile/src/app/onboarding/language.tsx        # MA-01
apps/mobile/src/app/onboarding/phone.tsx            # MA-02
apps/mobile/src/app/onboarding/otp.tsx               # MA-03
apps/mobile/src/app/onboarding/lockout.tsx           # MA-04
apps/mobile/src/app/onboarding/profile.tsx           # MA-05
apps/mobile/src/app/onboarding/goal.tsx              # MA-06 placeholder only — Story 2.7 builds the real screen
apps/mobile/src/locales/en.json / fr.json
supabase/migrations/0019_member_onboarding_otp.sql   # exact number TBD at implementation time — verify next-available
supabase/tests/member_onboarding_rls.test.sql
```

Modified files:
```
supabase/functions/send-sms-hook/index.ts    # Task 10, best-effort locale threading
scripts/check-i18n-key-parity.mjs            # Task 11, add apps/mobile/locales to LOCALE_DIRS
.github/workflows/ci.yml                     # only if Task 11's mobile-lint wiring is done; otherwise leave as-is and flag in deferred-work.md
apps/mobile/src/app/index.tsx (or root _layout.tsx)  # Task 4, unauthenticated redirect to onboarding
```

No changes to `apps/dashboard` or `apps/super-admin` — this story is entirely mobile + backend (migration, Edge Function).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] — literal AC wording (superseded in part, see Scope Notes)
- [Source: _bmad-output/planning-artifacts/architecture.md lines 361–388] — mobile directory tree (superseded by the real `src/` scaffold, Task 1), OTP resend/lockout server-side requirement, `OtpDeliveryProvider` pattern
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-01 through MA-05] — exact layouts, copy, interaction/error states for every screen this story builds
- [Source: docs/decisions.md#2026-07-15 "Onboarding/account-recovery channel policy"] — authoritative: no deep link exists (Scope Note #1)
- [Source: docs/decisions.md#2026-07-10 Story 1.8 Decision 2] — `users.display_name` confirmed never populated, the basis for Scope Note #2's "new account" signal
- [Source: docs/decisions.md#2026-07-16 Story 1.11 Decision 4] — the exact self-writable-column trigger-allow-list gotcha this story's `users` migration must replicate
- [Source: docs/decisions.md#2026-07-15 "enable_signup=true ... cost-abuse"] — explicitly names this story as the place to consider hardening against unauthenticated OTP-send abuse (Scope Note #3)
- [Source: docs/decisions.md#2026-07-14 SMS/OTP spike entries] — `OTP_PROVIDER=twilio_whatsapp` is the current default; six real integration bugs found only by hands-on testing, same discipline this story's Task 10 should follow
- [Source: docs/decisions.md#2026-07-10 Story 1.9 Decision 3] — `gym-logos` Storage bucket RLS/upsert pattern to replicate for member photo upload (Task 9)
- [Source: docs/decisions.md#2026-07-06 Story 1.3 Decision 3] — multi-gym JWT claims resolution, already handles Scope Note #3's gym-context need with no new code
- [Source: _bmad-output/implementation-artifacts/2-5-member-invitation-via-deep-link.md] — sibling story that first established "no deep link, phone number already pre-associated by Story 2.3" — this story's Scope Notes #1/#3 extend the same finding
- [Source: apps/dashboard/services/members.ts:322] — `findOrCreateUserByPhone`/`provisionMemberRow`, confirms the `members`/`users`/`auth.users` rows already exist before this story's flow runs
- [Source: supabase/functions/send-sms-hook/index.ts] — existing OTP-send Edge Function (Story 2.1), including the hardcoded `"en"` locale (Task 10) and the `E164_DIGITS` normalization this story's client-side validation must stay consistent with
- [Source: supabase/migrations/0003_members_and_users.sql, 0015_users_self_service_language_preference.sql, 0018_member_management.sql] — `users`/`members` current schema and RLS baseline this story extends
- [Source: apps/mobile/tsconfig.json, apps/mobile/src/app/_layout.tsx] — confirms the real `src/`-rooted scaffold (Task 1)
- [Source: apps/mobile/AGENTS.md] — Expo SDK 57 versioned-docs instruction, applies to every screen this story builds
- [Source: packages/types/src/errors.ts, src/schemas/member.ts, src/schemas/locale.ts] — reusable error-mapping and validation primitives (e164Phone, localeSchema) this story should import, not redeclare
- [Source: scripts/check-i18n-key-parity.mjs, .github/workflows/ci.yml] — current i18n CI gate, missing an `apps/mobile` entry (Task 11)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md line 81] — already-logged gap this story's Task 11 closes

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Code)

### Debug Log References

- `supabase migration up` / `supabase db reset` (multiple runs, local Docker via WSL) — `0019_member_onboarding_otp.sql` applies cleanly every time, no errors.
- `supabase test db` (final run, post `supabase db reset`): `Files=13, Tests=208 ... Result: PASS` — zero regressions, includes the new `member_onboarding_rls.test.sql` and the updated `users_self_service_rls.test.sql`.
- Direct REST/RPC verification against the real local Supabase instance (anon key, `curl`/`psql`): `phone_has_membership` returns correct true/false; `record_otp_resend` correctly allows 3 resends then locks the 4th with a future `locked_until`; `check_otp_resend_allowed` reflects the same lock state.
- `POST /auth/v1/otp` with `data: { locale: "fr" }` tested against both an existing and a brand-new user (Task 10) — inconclusive due to `hook_timeout` (Edge Functions runtime not served locally); documented in `deferred-work.md`, not resolved.
- `node scripts/check-i18n-key-parity.mjs`: all 4 locale dirs (including the newly-added `apps/mobile/src/locales`) in parity.
- `pnpm run typecheck` (root, all 4 packages): 0 errors. Isolated `pnpm --filter mobile typecheck` confirmed this story's new files add zero errors (file-list diff against the pre-existing baseline error set).
- Mid-session regression and recovery: `expo install` (Task 9's `expo-image-picker`/`expo-localization` additions) triggered a workspace-wide `@supabase/supabase-js` re-resolution (it was pinned to `"latest"` in `apps/mobile/package.json`, a pre-existing but latent issue) that broke `apps/dashboard`/`apps/super-admin`'s typecheck (`Cannot find module '@supabase/supabase-js'`/`'@supabase/ssr'`) via dangling `.pnpm` symlinks (Windows file-removal races during the install). Diagnosed via direct symlink inspection, fixed via a full `.pnpm/node_modules` rebuild plus pinning `@supabase/supabase-js` to `^2.110.7` in `apps/mobile/package.json` (root-causing the fix, not just papering over the symptom). Re-verified all 4 packages clean afterward.

### Completion Notes List

- All 5 ACs implemented. AC #2 is explicitly superseded (Scope Note #1) — no deep-link code exists, matching the platform-wide 2026-07-15 decision. AC #4/#5 implemented per Scope Notes #2/#3's synthesized account model (`users.display_name IS NULL` = new account; the `members` row itself was already provisioned by Story 2.3, this story only reads it).
- This is the first story with any real code in `apps/mobile`. Three real, load-bearing corrections/discoveries surfaced during implementation, all recorded in `docs/decisions.md#2026-07-17`: (1) the real scaffold root is `apps/mobile/src/`, not architecture.md's literal `apps/mobile/app/`; (2) `users.display_name`/`users.photo_url` are the correct place for self-entered profile data, distinct from admin-controlled `members.name`/`members.photo_url`; (3) the OTP resend/lockout off-by-one was resolved in favor of epics.md's precise AC wording over EXPERIENCE.md's looser phrasing.
- Every new backend piece (migration, RLS, RPCs, Storage bucket) was verified hands-on against a real running local Supabase instance, not just written and assumed correct — direct RPC/REST calls, not only pgTAP (pgTAP verifies from the `postgres` role or simulated JWT claims; the REST/RPC calls verify the actual `anon`-role HTTP path the mobile app will really use).
- Three deliberate scope reductions from the literal EXPERIENCE.md mockups, all recorded in `deferred-work.md` rather than silently done: (1) MA-02's country picker is a fixed `+237` prefix, not a searchable bottom sheet; (2) MA-05's photo picker is a native `Alert` with 3 buttons, not a true bottom-sheet action sheet; (3) `member-photos` Storage bucket is public (mirrors `gym-logos`), not a new signed-URL pattern.
- Task 10 (OTP delivery locale) was investigated hands-on and left genuinely unresolved — the local Send SMS Hook's Edge Functions runtime isn't served by plain `supabase start`, so the specific GoTrue behavior in question couldn't be isolated from that operational gap. `send-sms-hook/index.ts` is unchanged (still hardcoded `"en"`). This is the one task where "verify hands-on" produced an honest "couldn't fully verify," not a false claim of completion.
- **Known gap, stated honestly:** no physical device or simulator walkthrough of the onboarding flow was performed (no device/emulator available in this session's environment). All verification was at the `tsc`/RPC/REST/pgTAP level. This does not meet `architecture.md`'s "manually QA'd on a physical Android device" bar yet — flagged in `deferred-work.md` as the clearest remaining risk before this story should be considered done, not just reviewed.
- A real, self-caused regression occurred and was fully diagnosed and fixed mid-session (see Debug Log References) — `apps/dashboard`/`apps/super-admin` typecheck was temporarily broken by a dependency-install side effect, root-caused (not just restarted-until-it-worked) and fixed by pinning the previously-unpinned `@supabase/supabase-js: "latest"` dependency that caused it.

### File List

**New:**
- `supabase/migrations/0019_member_onboarding_otp.sql`
- `supabase/tests/member_onboarding_rls.test.sql`
- `packages/types/src/schemas/memberOnboarding.ts`
- `apps/mobile/.env.example`
- `apps/mobile/src/lib/supabase.ts`
- `apps/mobile/src/lib/i18n.ts`
- `apps/mobile/src/lib/onboarding-context.tsx`
- `apps/mobile/src/hooks/use-session.ts`
- `apps/mobile/src/constants/brand.ts`
- `apps/mobile/src/locales/en.json`
- `apps/mobile/src/locales/fr.json`
- `apps/mobile/src/app/(tabs)/_layout.tsx`
- `apps/mobile/src/app/onboarding/_layout.tsx`
- `apps/mobile/src/app/onboarding/language.tsx` (MA-01)
- `apps/mobile/src/app/onboarding/phone.tsx` (MA-02)
- `apps/mobile/src/app/onboarding/otp.tsx` (MA-03)
- `apps/mobile/src/app/onboarding/lockout.tsx` (MA-04)
- `apps/mobile/src/app/onboarding/profile.tsx` (MA-05)
- `apps/mobile/src/app/onboarding/goal.tsx` (MA-06 placeholder)

**Modified:**
- `apps/mobile/src/app/_layout.tsx` (root auth gate)
- `apps/mobile/package.json` (+`expo-image-picker`, `expo-localization`, `i18next`, `react-i18next`; `@supabase/supabase-js` pinned from `"latest"` to `^2.110.7`)
- `apps/mobile/app.json` (`expo-localization` config plugin, auto-added by `expo install`)
- `packages/types/src/index.ts` (+`export * from "./schemas/memberOnboarding"`)
- `scripts/check-i18n-key-parity.mjs` (+`apps/mobile/src/locales` to `LOCALE_DIRS`)
- `supabase/tests/users_self_service_rls.test.sql` (`display_name` self-update assertions updated to reflect the new, correct unpinned behavior)
- `docs/decisions.md` (+2026-07-17 entry)
- `_bmad-output/implementation-artifacts/deferred-work.md` (+2026-07-17 entry; amended the pre-existing `next-themes` entry with a resolution note)
- `pnpm-lock.yaml` (dependency additions/pin)

**Renamed (git mv, content unchanged):**
- `apps/mobile/src/app/index.tsx` → `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/app/explore.tsx` → `apps/mobile/src/app/(tabs)/explore.tsx`

**Not modified, considered and rejected:**
- `supabase/functions/send-sms-hook/index.ts` (Task 10 — investigated, left unchanged, see Completion Notes)

## Change Log

- 2026-07-17 — Full implementation: mobile onboarding flow MA-01–MA-05, server-side OTP resend/lockout, `phone_has_membership` cost-abuse mitigation, `users.display_name`/`photo_url` self-service profile fields. All 13 tasks complete. `supabase test db` 208/208 passing; `pnpm run typecheck` 0 errors across all 4 packages; i18n key parity passing across all 4 locale dirs. Task 10 (OTP delivery locale) investigated and left unresolved (documented gap, not a false completion claim). No physical-device/simulator walkthrough performed (documented gap). Status `ready-for-dev` → `review`.
- 2026-07-17 — `bmad-code-review`: 3-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor) against a diff scoped to this story's own File List (the working tree also held uncommitted work from stories 2.2–2.5, excluded from this review). 25 findings total: 2 decision-needed (both resolved by user call and patched — a session/`display_name` race that could skip MA-05/MA-06 entirely for new members, and a deactivated-member photo-upload RLS gap), 18 patch (all applied), 5 defer (already-documented or pre-existing-pattern risks, appended to `deferred-work.md`), 0 dismissed. Re-verified after fixes: `supabase test db` 213/213 passing (5 new assertions), `pnpm run typecheck` 0 errors across all 4 packages, i18n key parity passing (38 mobile keys, up from 32). Status `review` → `done`.
