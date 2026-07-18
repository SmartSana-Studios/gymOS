---
baseline_commit: 710d0377b2790fa6b7d2ee52e3129068ced96da8
---

# Story 2.8: Member Self-Service Profile Management

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a member,
I want to view and edit my own profile,
so that I can keep my display name, photo, and language preference current.

## Acceptance Criteria

1. **Given** the Profile screen, **when** I edit my name or upload a new photo, **then** the change saves and displays immediately. [Source: epics.md#Story 2.8]
2. **Given** I attempt to change my phone number, **when** I look for that option, **then** it is not editable from the app — the screen states "Contact your gym to change your number." [Source: epics.md#Story 2.8]
3. **Given** I switch my language toggle (EN/FR), **when** I do so, **then** the app re-renders in the new language immediately without requiring re-login. [Source: epics.md#Story 2.8]

## Scope Notes — Read Before the Tasks

**This story is the first to build a real `(tabs)` screen. No migration is needed — every read/write this story performs is already covered by existing RLS policies from Stories 1.10/2.6/2.7. Read all three notes below before writing code.**

### Scope Note #1 — No new migration. Verify, don't assume, then reuse what already exists

Every data operation MA-12 needs already has a working RLS policy — this story is UI-only against the backend:

- **Read own profile** (`display_name`, `photo_url`, `preferred_language`, `phone`): `self_read_own_user` (`0015_users_self_service_language_preference.sql`, `id = auth.uid()`).
- **Edit name/photo**: `self_update_own_language`'s UPDATE policy (same migration, despite its name it's a full-row `id = auth.uid()` USING/WITH CHECK — the *trigger* `protect_self_managed_user_columns`, last redeclared in `0019_member_onboarding_otp.sql`, is what actually restricts which columns pass through on a self-update). Current pinned (non-self-writable) columns: `phone`, `is_super_admin`, `created_at`. `display_name`, `photo_url`, and `preferred_language` are all already self-writable — confirmed by reading the live trigger body, not assumed from its name.
- **Language toggle write**: same `self_update_own_language` policy — despite the name, it covers `preferred_language` writes via the same row-level policy the name/photo edit uses; no separate policy needed.
- **Photo upload**: the `member-photos` Storage bucket and its four policies (`member_select/insert/update/delete_own_photo`, `0019_member_onboarding_otp.sql`) already exist, keyed on `(storage.foldername(name))[1] = auth.uid()::text` + `caller_has_membership()`. Reuse the identical bucket, path convention (`{user_id}/photo.{ext}`), and `upsert: true` from `onboarding/profile.tsx` — do not create a new bucket or policy.
- **Gym name display**: `"read own gym"` policy (`0009_auth_hook_gym_claims.sql`, `id = private.gym_id()`) — querying `gyms` returns exactly one row scoped to the caller's current gym via the JWT claim, no explicit `gym_id` filter needed client-side.
- **Plan name display**: `gym_staff_read_own_plans` (`0017`, ungated by role) + `gym_staff_read_own_subscriptions` (`0018`, includes the member-owns-this-subscription clause) — same reads Story 2.7's `plan.tsx` already performs.

**Do not add a migration for this story.** If a read/write above turns out to be blocked in manual verification (Task 6), that is a signal to re-check the exact policy/trigger text, not to reach for a new migration first.

### Scope Note #2 — This is the first real `(tabs)` screen; the tab bar itself needs to change

`apps/mobile/src/app/(tabs)/` currently has only `index.tsx` (unmodified Expo template placeholder — Story 3.7 replaces it with the real Home screen) and `explore.tsx` (unmodified Expo template placeholder, no product purpose, referenced only by `components/app-tabs.tsx`). Per `architecture.md`'s target tree, the eventual tab bar is Home / Check-In / History / Profile (MA-12) — but Check-In and History don't exist yet (Epic 3, Stories 3.8–3.10). This story's job is only the Profile tab:

- Add `apps/mobile/src/app/(tabs)/profile.tsx` (MA-12) as a **new** file.
- In `apps/mobile/src/components/app-tabs.tsx`, replace the `explore` `NativeTabs.Trigger` (name, label, and icon) with a `profile` trigger pointing at the new screen. Delete `apps/mobile/src/app/(tabs)/explore.tsx` — it has no product purpose and nothing else references it.
- **No dedicated profile/person tab icon asset exists** (`apps/mobile/assets/images/tabIcons/` only has `home.png`/`home@2x/3x.png` and `explore.png`/`explore@2x/3x.png`). Reuse `explore.png` (all three resolutions) for the profile tab's icon rather than generating a new asset — `NativeTabs.Trigger.Icon`'s `renderingMode="template"` tints it monochrome to match the other tab anyway, so the specific glyph is a low-stakes placeholder. Revisit with a dedicated icon when Epic 3 builds out the full tab bar.
- Do not build Check-In or History tabs/screens — out of this story's ACs entirely.

### Scope Note #3 — Reuse the photo-picker/upload logic; extract it, don't re-paste it

`apps/mobile/src/app/onboarding/profile.tsx` (MA-05) already implements the exact photo flow this story needs a second time: permission request → `expo-image-picker` launch (camera or library) → 5MB size check → extension→MIME mapping → upload to `member-photos` with `upsert: true` → `getPublicUrl`. Extract this into a new `apps/mobile/src/lib/photo-upload.ts` (`openPhotoPicker(onPick, t)` for the Alert-based source-picker, `pickPhoto(source)`, `uploadPhoto(userId, uri)`, plus the `EXTENSION_TO_MIME` map and `MAX_PHOTO_BYTES` constant) and have **both** `onboarding/profile.tsx` and the new `(tabs)/profile.tsx` import it — do not leave two independent copies of `EXTENSION_TO_MIME`/`uploadPhoto` in the codebase. This is a real, currently-reachable second call site (not speculative reuse), and the two screens need byte-for-byte identical upload behavior (same bucket, same path convention) so they must not drift.

Keep the `Alert.alert`-as-action-sheet pattern (Take Photo / Choose from Library / Cancel) — matches `onboarding/profile.tsx`'s already-accepted simplification (`deferred-work.md`: "functionally equivalent, visually a dialog rather than a sheet on iOS... revisit if design review flags the visual mismatch").

## Tasks / Subtasks

- [x] **Task 1: Extract shared photo-upload helper** (AC #1; Scope Note #3)
  - [x] Create `apps/mobile/src/lib/photo-upload.ts` exporting `MAX_PHOTO_BYTES`, `pickPhoto(source: 'camera' | 'library'): Promise<{ uri: string } | { error: 'permission_denied' | 'too_large' } | { canceled: true }>`, and `uploadPhoto(userId: string, uri: string): Promise<string | null>` — lift the logic verbatim from `apps/mobile/src/app/onboarding/profile.tsx` (permission request, `ImagePicker.launchCameraAsync`/`launchImageLibraryAsync`, size check, `EXTENSION_TO_MIME`, Storage upload to `member-photos`, `getPublicUrl`).
  - [x] Refactor `onboarding/profile.tsx` to import and call the shared helper instead of its inline copy — behavior must be identical (same error strings via the same i18n keys it already uses); this is a pure extraction, not a behavior change.

- [x] **Task 2: MA-12 Profile tab screen — read-only view** (AC #1, #2)
  - [x] New `apps/mobile/src/app/(tabs)/profile.tsx`. On mount, resolve: (a) own `users` row (`display_name`, `photo_url`, `preferred_language`, `phone`) via `self_read_own_user`; (b) own gym name via `supabase.from('gyms').select('name').single()` (RLS already scopes to exactly one row, Scope Note #1); (c) current plan name via the same member-id tie-break + active-subscription→plan join pattern `onboarding/plan.tsx`'s `loadPlan` already uses (Story 2.7 Scope Note #3) — this screen only needs `plans.name`, not the full plan-detail fields `plan.tsx` fetches. If there is no active subscription (PGRST116, same distinction `plan.tsx` already makes), render a "No active plan" fallback in place of the plan name rather than blank/`null`.
  - [x] Render per EXPERIENCE.md MA-12 layout: centered 64px avatar (falls back to a placeholder if `photo_url` is null, matching `onboarding/profile.tsx`'s empty-state photo circle), name, "`{gymName}` · `{planName}`" subtitle, an "Edit profile" row, a Language row (segmented EN | FR), and a "Log out" row.
  - [x] A load failure (any of the three reads) shows an inline retry state — same `errorLoadFailed` + "Try again" pattern `onboarding/plan.tsx`'s `loadError` branch uses (this story's `t('profile.errorLoadFailed')`).

- [x] **Task 3: Edit profile (inline expand/collapse)** (AC #1, #2)
  - [x] Tapping "Edit profile" expands an inline section (no navigation) with: name field pre-filled and editable, the photo circle (tappable → Task 1's shared `pickPhoto`/action-sheet, same as MA-05), and phone shown as **read-only** text with the label "Contact your gym to change your number" (AC #2 — do not render an editable phone field or any UI affordance to change it).
  - [x] Validate on save via `profileSetupSchema` (`packages/types/src/schemas/memberOnboarding.ts`) — it already validates exactly `{ displayName, photoUrl }`, the same two fields MA-05 writes; **do not** add a new schema for this (Scope Note #1 already confirmed this is the identical write shape). Save writes `users.display_name`/`users.photo_url` via `supabase.from('users').update(...).eq('id', userId).select('id')`, checking the returned row count (matches Story 2.7's review-fixed row-count-verification discipline for self-writes — a zero-row update must not be treated as success).
  - [x] Interaction states per EXPERIENCE.md: spinner during save; success → collapses back to the read-only view with the new values immediately visible (no refetch needed — use the just-saved local values); failure → inline error below the name field, section stays expanded with entered values intact for retry (AC #1's "saves and displays immediately" — an optimistic collapse-then-rollback is not required, a spinner-then-collapse-on-confirmed-success is simpler and matches MA-05's own save pattern).

- [x] **Task 4: Language toggle** (AC #3)
  - [x] Segmented EN | FR control. Tapping the non-active option: (a) immediately calls `i18n.changeLanguage(code)` (re-renders every mounted `useTranslation()` consumer app-wide, matching `apps/dashboard`'s `LanguageToggle.tsx` pattern — same library, same call, no navigation/reload), then (b) persists via `supabase.from('users').update({ preferred_language: code }).eq('id', userId)` in the background.
  - [x] On a failed persist, roll back the local `i18n.changeLanguage()` call to the previous language (exact optimistic-update/rollback shape as `apps/dashboard/components/shared/LanguageToggle.tsx`'s `handleChange` — reference it directly, don't reinvent the rollback logic differently for mobile). No separate error toast/banner is specified by EXPERIENCE.md for this control; the rollback itself is the user-visible feedback (the toggle visually reverts).
  - [x] Note the language change is per-account (FR-015: "persists per account across devices") — this write has no gym-scoping concern, matches `preferred_language`'s existing self-write precedent.

- [x] **Task 5: Log out** (AC — supports the story's overall self-service scope, no dedicated AC number)
  - [x] "Log out" row → confirmation via `Alert.alert` (two buttons: "Log out" / "Cancel") — same native-Alert-as-confirmation pattern as MA-05's photo action sheet, no new bottom-sheet dependency.
  - [x] On confirm: call `supabase.auth.signOut()` only. **Do not** manually `router.replace()` afterward — `signOut()` fires `onAuthStateChange` with `session: null`, which `useSession()` (`apps/mobile/src/hooks/use-session.ts`) already picks up, flipping `_layout.tsx`'s `Stack.Protected guard={!isFullyOnboarded}` to the `onboarding` group automatically. That group's first registered `Stack.Screen` is `language` (`onboarding/_layout.tsx`), which is exactly MA-01 — the existing root-gate mechanism already produces the "navigates to MA-01" behavior EXPERIENCE.md specifies, with no new navigation code needed. Adding a manual `router.replace('/onboarding/language')` on top would race against the gate's own unmount of `(tabs)` — don't add one.

- [x] **Task 6: i18n (EN/FR parity)**
  - [x] Add a new top-level `"profile"` block (sibling of `"onboarding"`, not nested under it — this is a `(tabs)` screen, not an onboarding step) to both `apps/mobile/src/locales/en.json` and `fr.json`: screen elements (edit-profile row label, language row label, log-out row + confirmation dialog title/buttons, phone-not-editable message, load-error + retry, save-error, no-active-plan fallback, avatar placeholder text if needed). Reuse `onboarding.profile.*` keys (`addPhoto`, `removePhoto`, `photoSourceTakePhoto`, `photoSourceChooseFromLibrary`, `errorPhotoTooLarge`, `errorPhotoUploadFailed`, `errorPhotoPermissionDenied`, `errorNameTooLong`) via cross-namespace i18next references (`t('onboarding.profile.addPhoto')`) rather than duplicating those strings under `profile.*` — Task 1's extraction only shares code, not copy; the copy itself is already correct as-is for a second, structurally-identical photo picker.
  - [x] Update `common.*` if a new shared string is needed (e.g. `common.cancel`, `common.logOut` — check for an existing equivalent before adding; `common.close` already exists but reads oddly as a Cancel-button label). Added `common.cancel` and `common.save`; kept the "Log out" row/button label under `profile.logOut` since it's screen-specific copy rather than a cross-screen shared string.
  - [x] `node scripts/check-i18n-key-parity.mjs` must pass across all 4 locale dirs.

- [x] **Task 7: Validation and manual verification** (Scope Note #1)
  - [x] `pnpm run typecheck` (all 4 packages) — 0 errors. `node scripts/check-i18n-key-parity.mjs` — 0 errors.
  - [x] Hands-on verify against the real local Supabase instance (direct RPC/REST as an `authenticated` member session, same discipline as Stories 2.6/2.7): confirm a self-update to `display_name`/`photo_url`/`preferred_language` persists, confirm `phone` stays unchanged if included in the same UPDATE payload (the pin-back trigger should silently protect it — do not rely on the app never sending it; verify the DB-level guarantee independently), confirm `gyms`/`plans`/`subscriptions` reads return exactly the caller's own gym/plan/active subscription.
  - [x] `supabase test db` — zero regressions (227/227 baseline from Story 2.7; this story adds no new migration, so no new pgTAP file is expected unless manual verification surfaces an actual gap).
  - [x] If no physical device/emulator is available in this environment, state that explicitly in Completion Notes rather than claiming a device walkthrough that didn't happen (same documented gap as Stories 2.6/2.7).

- [x] **Task 8 (optional, recommended): record the `docs/decisions.md` follow-up flagged by Story 2.7's review**
  - [x] `deferred-work.md`'s Story 2.6 entry flags that `users.display_name`/`users.photo_url` being member-self-writable, and used as the onboarding "new account" signal, was "this story's own synthesized design decision... worth a `docs/decisions.md` entry once Story 2.8... confirms it builds on the same fields." This story does confirm it (Task 2/3 read and write the same two columns for the same account-level, cross-gym-consistent reason). Add a short `docs/decisions.md` entry noting this — one paragraph, not a new design discussion.

### Review Findings

- [x] [Review][Patch] Deactivated/no-active-membership member sees a generic "couldn't load profile" error instead of a distinct handled state — `memberResult`'s PGRST116 (no rows) isn't special-cased the way `subscriptionResult`'s PGRST116 already is [apps/mobile/src/app/(tabs)/profile.tsx loadProfile] — fixed: PGRST116 on `memberResult` now sets `noActivePlan` and returns, matching the subscription-level handling.
- [x] [Review][Patch] `signOut()` failure is silently swallowed — no feedback to the user if logout fails while offline [apps/mobile/src/app/(tabs)/profile.tsx handleLogOut] — fixed: `signOut()` now has a `.catch` that surfaces an alert on failure.
- [x] [Review][Patch] No ScrollView / bottom-tab-bar inset handling — the deleted `explore.tsx` computed safe-area insets + a `BottomTabInset` and wrapped content in a `ScrollView` specifically to avoid tab-bar clipping; the new screen used a bare `SafeAreaView` with none of that [apps/mobile/src/app/(tabs)/profile.tsx] — fixed: content now wrapped in a `ScrollView` with `paddingBottom: insets.bottom + BottomTabInset + Spacing.three`.
- [x] [Review][Patch] No unmount-safety guard — state setters in `loadProfile`/`handleLanguageChange` can fire after the component unmounts if the user navigates away mid-request [apps/mobile/src/app/(tabs)/profile.tsx] — fixed: added a `mountedRef`, guarding all post-await state setters in both functions.
- [x] [Review][Patch] No accessibility state on the language toggle (missing `accessibilityState`/selected) and no accessible label distinguishing the phone number from its "not editable" caption [apps/mobile/src/app/(tabs)/profile.tsx] — fixed: added `accessibilityState={{ selected, disabled }}` to both language buttons and a combined `accessibilityLabel` on the phone row.
- [x] [Review][Patch] "Edit profile" row's label/arrow never changes to indicate Cancel when tapped again mid-edit — the new `common.cancel` key is added in this diff but never used as a visible affordance here [apps/mobile/src/app/(tabs)/profile.tsx] — fixed: row now toggles label (`profile.editProfile` ↔ `common.cancel`) and glyph (`→` ↔ `×`) based on `editing`.
- [x] [Review][Patch] Save button has no dirty-check — tapping Save with an unchanged name/photo still fires a network `.update()` [apps/mobile/src/app/(tabs)/profile.tsx canSaveEdit] — fixed: added an `isDirty` check (name or photo actually changed) as a precondition for `canSaveEdit`.
- [x] [Review][Patch] `EXTENSION_TO_MIME` is exported from the new shared module with no consumer outside the file, and wasn't requested by the spec (only `MAX_PHOTO_BYTES`/`pickPhoto`/`uploadPhoto` were) — unnecessary public surface [apps/mobile/src/lib/photo-upload.ts] — fixed: dropped the `export` keyword, kept module-private.
- [x] [Review][Dismissed on second look] New Profile screen hardcodes raw hex colors instead of the app's ThemedView/theme-token system — no dark-mode adaptation [apps/mobile/src/app/(tabs)/profile.tsx styles] — verified this matches `onboarding/profile.tsx`'s existing, unmodified, already-shipped pattern exactly (same `#E0E1E6`/`#B3261E`/`#ffffff` for borders/error/button-text alongside `ThemedView`/`ThemedText` for backgrounds and main text). Not a regression introduced by this story; "fixing" only the new screen would create inconsistency with its sibling. Revisit both screens together in a dedicated theming pass if dark-mode support becomes a real requirement.
- [x] [Review][Defer] Storage upload happens before the DB write is confirmed; on a DB-write failure the storage object at the same path is already overwritten with no compensating rollback [apps/mobile/src/lib/photo-upload.ts:39-59 (uploadPhoto)] — deferred, pre-existing (inherited verbatim from `onboarding/profile.tsx`'s original implementation, now duplicated at a second call site, not introduced by this story)
- [x] [Review][Defer] `asset.fileSize` undefined skips the client-side size guard entirely [apps/mobile/src/lib/photo-upload.ts:33-37 (pickPhoto)] — deferred, pre-existing (lifted verbatim from the original onboarding photo-picker logic)
- [x] [Review][Defer] Unmapped photo extension (e.g. heic/heif) silently defaults Content-Type to image/jpeg [apps/mobile/src/lib/photo-upload.ts:12-18, 55-57] — deferred, pre-existing (lifted verbatim, not introduced by this story)
- [x] [Review][Defer] Zero test coverage for the new module/screen [apps/mobile/src/lib/photo-upload.ts, apps/mobile/src/app/(tabs)/profile.tsx] — deferred, matches existing project-wide precedent of no mobile unit tests (already a logged gap in Stories 2.6/2.7)

Dismissed as noise/handled-elsewhere (7): local name-length check duplicating `profileSetupSchema`'s `max(100)` (verified identical, no drift); `gyms` query lacking a defensive `.limit(1)` before `.single()` (Scope Note #1 explicitly reasons the RLS/JWT-claim scoping makes this safe); `isPlanNameRow` guard not distinguishing array from object (unreachable — the `plans` relation is a many-to-one FK, always returned as a single object); tab bar icon still sourced from `explore.png` (explicitly, intentionally specified by Scope Note #2); reusing `onboarding.profile.*` copy keys in a settings context (literally what Task 6 instructs); duplicated thin per-screen `handleOpenPhotoPicker`/`handlePickPhoto` wrappers (intentional per `photo-upload.ts`'s own doc comment — screen-specific error handling is by design); `openPhotoPicker`'s `t` param typed narrower than i18next's real `TFunction` (trivial, zero practical risk).

## Dev Notes

- **No migration in this story.** Every RLS policy and Storage bucket needed already exists (Scope Note #1). If Task 7's manual verification finds an actual gap, treat that as new information requiring its own small migration — don't preemptively add one on a hunch.
- **This is the first story to touch `apps/mobile/src/app/(tabs)/` for real.** `index.tsx` stays the Expo-template placeholder (Story 3.7's job); only `explore.tsx` is removed/replaced (Scope Note #2).
- **Reuse `profileSetupSchema`, don't add a new one.** MA-12's "Edit profile" writes the exact same `{ displayName, photoUrl }` shape as MA-05.
- **No `apps/mobile/src/services/` layer exists** (Story 2.6/2.7 precedent, restated here since it's easy to assume otherwise from `architecture.md`) — call `supabase-js` directly from `profile.tsx`, same as every other mobile screen so far.
- Mirror `apps/dashboard/components/shared/LanguageToggle.tsx`'s optimistic-update/rollback shape for Task 4 exactly — it's a proven, already-reviewed pattern for this exact interaction (immediate `i18n.changeLanguage()`, persist in background, roll back on failure).
- EN/FR parity (FR-016) is a CI gate on every prior story; `apps/mobile`'s own lint still isn't wired into CI (pre-existing, already-logged gap from Story 2.6/2.7) — not this story's job to fix, but don't introduce a hardcoded string banking on that gap staying open.
- UX-DR1 note: the onboarding flow deliberately never uses a gym's `primary_color` override (platform-shell surface). The Profile tab, by contrast, **is** an authenticated member-facing surface where UX-DR1's override would apply — but no gym-branding fetch/context exists anywhere in `apps/mobile` yet (verified: no `primary_color`/branding usage anywhere in the app). Building that infrastructure is not in this story's ACs and belongs with Story 3.7 (Home screen, which owns FR-059's "gym branding header"). Use the existing platform `Brand` tokens (`apps/mobile/src/constants/brand.ts`) for this screen, matching every mobile screen built so far — this is a scope boundary, not an oversight.

### Project Structure Notes

New files:
```
apps/mobile/src/lib/photo-upload.ts       # extracted from onboarding/profile.tsx (Task 1)
apps/mobile/src/app/(tabs)/profile.tsx    # MA-12
```

Modified files:
```
apps/mobile/src/app/onboarding/profile.tsx   # refactored to use lib/photo-upload.ts
apps/mobile/src/components/app-tabs.tsx      # "explore" trigger -> "profile" trigger
apps/mobile/src/locales/en.json / fr.json    # new top-level "profile" block
docs/decisions.md                             # Task 8 (optional/recommended)
```

Deleted files:
```
apps/mobile/src/app/(tabs)/explore.tsx    # unmodified Expo template placeholder, no longer referenced
```

No changes to `apps/dashboard`, `apps/super-admin`, or `supabase/migrations/` — this story is entirely mobile app code (screens + a shared lib extraction), same "backend already covers it" shape as a pure-frontend story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8] — literal AC wording
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-12] — exact layout, components, and interaction rules for the Profile screen (lines 752–787)
- [Source: _bmad-output/implementation-artifacts/2-7-member-app-goal-experience-plan-confirmation.md] — direct predecessor; establishes the member-id/subscription/plan query pattern (Scope Note #3 there) this story's plan-name lookup reuses, the no-services-layer precedent, and the row-count-verification discipline for self-writes
- [Source: apps/mobile/src/app/onboarding/profile.tsx] — MA-05, the exact photo-picker/upload logic this story extracts (Task 1) and the `profileSetupSchema` write shape this story reuses (Task 3)
- [Source: apps/mobile/src/app/onboarding/plan.tsx] — the member-id tie-break + active-subscription→plan query pattern this story's plan-name lookup replicates (lighter — only `plans.name` needed)
- [Source: apps/mobile/src/hooks/use-session.ts, apps/mobile/src/app/_layout.tsx] — the root auth gate this story's log-out flow relies on (Task 5) rather than re-implementing navigation
- [Source: apps/dashboard/components/shared/LanguageToggle.tsx] — the optimistic-update/rollback pattern Task 4 mirrors for the mobile language toggle
- [Source: supabase/migrations/0015_users_self_service_language_preference.sql, 0019_member_onboarding_otp.sql] — current `users` self-read/self-update RLS policy and the live `protect_self_managed_user_columns` trigger body (Scope Note #1) — verified by reading the actual current trigger definition (0019 supersedes 0015's), not assumed from either migration's filename
- [Source: supabase/migrations/0009_auth_hook_gym_claims.sql, 0017_membership_plan_configuration.sql, 0018_member_management.sql] — `gyms`/`plans`/`subscriptions` read policies already covering this screen's gym-name/plan-name lookups (Scope Note #1)
- [Source: architecture.md#Complete Project Directory Structure] — target `(tabs)/profile.tsx` location; confirms no `apps/mobile/services/` exists yet in practice despite being mentioned there (Story 2.6/2.7 precedent already established this)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: code review of story-2-6...] — flags the `docs/decisions.md` entry this story's optional Task 8 completes

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase start` / `supabase db reset` (local Docker via WSL, container `supabase_db_gym_os`) — migrations 0001–0020 apply cleanly; no new migration added by this story (confirmed 0020 remains the latest, from Story 2.7).
- `supabase test db`: 14 files, 227 tests, all passing — matches the story's stated 227/227 baseline from Story 2.7 exactly; zero regressions.
- `pnpm run typecheck`: 4/4 packages (dashboard, super-admin, types, mobile) pass, 0 errors.
- `node scripts/check-i18n-key-parity.mjs`: 4/4 locale dirs in parity (77 keys in `apps/mobile/src/locales`, up from 62 after Story 2.7).
- Manual hands-on verification (Task 7, direct SQL against the live container, not pgTAP — same technique as Story 2.7's Debug Log): seeded a real fixture (tier/gym/auth.users+users/member/plan/subscription) inside a single transaction, ran `set local role authenticated` + `set_config('request.jwt.claims', ...)` to simulate an authenticated member session, then a self-`UPDATE` on `users` setting `display_name`/`photo_url`/`preferred_language` **and** attempting `phone` in the same statement. Result: `display_name`/`photo_url`/`preferred_language` persisted; `phone` stayed at its original value in both the `RETURNING` clause and a follow-up `reset role` re-query as `postgres` — `protect_self_managed_user_columns`'s pin-back fired correctly even with `phone` present in the same payload. Also confirmed `select id, name from gyms` and the subscription→plan join each return exactly one row (the caller's own gym/plan) under the same simulated session. Transaction rolled back afterward — no fixture rows persisted. (First attempt used a separate `commit` before switching role, which left the session on `postgres` due to `SET LOCAL`'s outside-a-transaction-block scoping — caught because the `phone` column visibly changed in that run, which shouldn't be possible under the real trigger; rerun in a single transaction reproduced the correct, protected behavior.)

### Completion Notes List

- All 3 ACs implemented: AC #1 (edit name/photo, save/display immediately) via Task 3's inline expand/collapse section; AC #2 (phone not editable, gym-contact message) via Task 3's read-only phone row — no editable phone field or affordance exists anywhere in `profile.tsx`; AC #3 (language toggle re-renders immediately, no re-login) via Task 4's `i18n.changeLanguage()` call, mirroring `apps/dashboard`'s `LanguageToggle.tsx` exactly.
- No migration was added — Scope Note #1's pre-verification (every read/write already covered by existing RLS from Stories 1.10/2.6/2.7) held up under Task 7's hands-on DB verification; no gap was found that would have required one.
- Task 1's extraction (`apps/mobile/src/lib/photo-upload.ts`) is a pure lift of `onboarding/profile.tsx`'s existing permission/pick/upload logic, plus a new `openPhotoPicker(onPick, t)` wrapper for the shared Alert-based action-sheet (Scope Note #3). `onboarding/profile.tsx` now imports all three; its error-string mapping and `profileSetupSchema` validation are unchanged.
- Scope Note #2's tab-bar swap surfaced one thing the story text didn't call out: `apps/mobile/src/components/app-tabs.web.tsx` (the Expo Router web tab-bar variant) also had a `TabTrigger name="explore" href="/explore"`, which `explore.tsx`'s deletion would have turned into a dead link. Updated it in parallel (`profile`/`/profile`) to keep the native and web tab bars consistent — not listed in the story's own Modified files, but required to avoid introducing a broken reference from the deletion Scope Note #2 explicitly calls for.
- Task 4's language-toggle persist deliberately does **not** do a `.select('id')` row-count check, even though Story 2.7 established that discipline for every other self-write in this app. The task's own instructions are explicit here — mirror `apps/dashboard/components/shared/LanguageToggle.tsx`'s `handleChange` shape exactly, which only checks `{ error }` (confirmed by reading `apps/dashboard/services/session.ts`'s `updateLanguagePreference`, which does the same). Every other write in this story (`Task 3`'s profile save) keeps the row-count check.
- No avatar placeholder copy was added for the read-only, no-photo state — an empty grey circle (same visual treatment as `onboarding/profile.tsx`'s empty state, no text) is shown instead, since EXPERIENCE.md's "Avatar (tappable only in edit mode)" means no tap affordance exists there to explain. The `onboarding.profile.addPhoto` placeholder text is reused only while `editing` is true, where tapping does something.
- No physical device or emulator was available in this environment — no on-device walkthrough was performed, matching the same documented gap in Stories 2.6/2.7. Verification relied on `tsc`/RPC/REST(-equivalent SQL simulation)/pgTAP plus manual comparison against EXPERIENCE.md's MA-12 mockup and interaction rules.

### File List

**New:**
- `apps/mobile/src/lib/photo-upload.ts`
- `apps/mobile/src/app/(tabs)/profile.tsx`

**Modified:**
- `apps/mobile/src/app/onboarding/profile.tsx`
- `apps/mobile/src/components/app-tabs.tsx`
- `apps/mobile/src/components/app-tabs.web.tsx` (not in the story's original Modified list — see Completion Notes)
- `apps/mobile/src/locales/en.json`
- `apps/mobile/src/locales/fr.json`
- `docs/decisions.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (workflow status tracking)

**Deleted:**
- `apps/mobile/src/app/(tabs)/explore.tsx`

## Change Log

- 2026-07-18: Story implemented — extracted shared photo-upload helper (`lib/photo-upload.ts`), built the MA-12 Profile tab (read-only view, inline edit, language toggle, log out), swapped the Explore tab for Profile in both the native and web tab bars, added EN/FR `profile.*` i18n coverage, and recorded the `docs/decisions.md` follow-up confirming `users.display_name`/`photo_url` as the permanent self-service profile fields. No new migration — every read/write already covered by existing RLS/triggers from Stories 1.10/2.6/2.7, confirmed via hands-on DB verification. All 3 ACs satisfied; 227/227 pgTAP tests pass (no regressions); typecheck (4/4 packages) and i18n-parity clean. Status set to `review`.
- 2026-07-18: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, zero AC/spec violations found) surfaced 9 patch findings, all applied: distinct "no active plan" state for a deactivated member (no `members` row), caught `signOut()` failures, wrapped content in a `ScrollView` with proper bottom-tab-bar inset, added an unmount-safety guard (`mountedRef`) around `loadProfile`/`handleLanguageChange`, added accessibility state to the language toggle and a combined label to the phone row, made the "Edit profile" row toggle to a visible Cancel affordance, added a dirty-check before enabling Save, and dropped an unnecessary `EXTENSION_TO_MIME` export. One additional finding (hardcoded hex colors) was investigated and dismissed — it exactly matches `onboarding/profile.tsx`'s existing, unmodified pattern, not a regression. 4 pre-existing issues (inherited verbatim from the onboarding photo-picker) deferred to `deferred-work.md`. `pnpm run typecheck` (4/4 packages) and i18n key-parity re-verified clean after patches. Status set to `done`.
- 2026-07-18 (physical-device walkthrough, Epic 2 retrospective follow-up): **Real bug found and fixed** — AC #1's "the change saves and displays immediately" was silently failing on a real Android device. `photo-upload.ts`'s `uploadPhoto()` read the picked photo via `fetch(uri).arrayBuffer()`; against Android's local `file://`/`content://` picker URIs this can resolve without error while returning a near-empty body (observed: a real photo uploaded as a 14-byte object), so Storage reported a successful upload of a corrupt file with no error surfaced anywhere in the chain. Never caught by `tsc`, lint, or two prior code-review rounds — only surfaced by actually uploading a real photo on a physical device, per the Epic 2 retrospective's decision to close the "no device testing" gap before Epic 3. **Fixed:** switched to `expo-file-system`'s new SDK 57 `File` class (`new File(uri).arrayBuffer()`), which reads the actual filesystem bytes directly instead of routing through `fetch()`. Since `onboarding/profile.tsx` (Story 2.6, MA-05) shares this same `uploadPhoto()` helper, the fix closes the identical latent bug there too. Verified end-to-end on a real Android device post-fix: photo uploads and displays correctly. [apps/mobile/src/lib/photo-upload.ts]
