---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.3: Mobile Design System Foundation — Dark Theme, Per-Gym Accent & Barlow Typography

Status: done

## Story

As a gym member using the mobile app,
I want the app to use my gym's branded accent color on a polished dark theme with proper typography,
so that the app feels premium and reflects my specific gym's branding rather than a generic hardcoded color.

**Context:** foundation story for the mobile redesign (Stories 8.4–8.6 consume what this story builds). Full context in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`. Per `constants/brand.ts`'s own existing doc comment (pre-dating this story): the onboarding flow is part of the platform shell and always uses the platform `Brand.accent`, never a per-gym override — that override only applies to authenticated, gym-context screens post-onboarding. This story's per-gym accent mechanism respects that existing constraint exactly (it is not a new decision, just newly wired up).

## Acceptance Criteria

1. **Given** a gym has set `gyms.primary_color`, **when** a member of that gym is on an authenticated, gym-context screen (post-onboarding — tabs, plan modal), **then** the accent color resolves to that gym's color; gyms with no `primary_color` set (or the member still in onboarding, per the existing platform-shell constraint) fall back to `Brand.accent` (`#E0971F`).
2. **Given** `constants/theme.ts`'s existing `Colors.light`/`Colors.dark` shape, **when** extended, **then** `dark` gains a full token set (`background`, `surface`, `surfaceElevated`, `border`, `text`, `textSecondary`) additively. `dark.backgroundElement`/`backgroundSelected` are byte-for-byte unchanged; `dark.text`/`background`/`textSecondary` are intentionally retuned (navy-tinted near-black/off-white, not pure black/white) as part of this story's dark-theme polish — a negligible visual shift, not a breaking one, so no currently-compiling screen breaks before its own restyle story runs. `light` gains the same new keys with placeholder values (its `background` is also retuned to `Brand.background`; all other keys are unchanged), keeping the shape light-mode-extensible per the user's explicit direction, without a real light mode shipping yet. *(Review finding, 2026-08-05: original wording claimed all 5 existing keys were untouched — corrected to reflect the actual, accepted deviation.)*
3. **Given** `useTheme()` (`hooks/use-theme.ts`), **when** called, **then** it returns `Colors.dark` unconditionally (device color scheme ignored) — this is an intentional, commented-in-code override, not a bug, until a real light-mode toggle is built.
4. **Given** the app's headers, **when** they render, **then** they use Barlow (`@expo-google-fonts/barlow`) — ExtraBold/Bold for `title`/`subtitle` (uppercase, letter-spaced), Regular/Medium/SemiBold for `default`/`small`/`smallBold` — loaded via `expo-font`'s `useFonts` in `app/_layout.tsx`, gated so nothing renders in the system font (verified against the current Expo v57 `expo-font`/`@expo-google-fonts` docs per `AGENTS.md`'s standing instruction).

## Tasks / Subtasks

- [x] **Task 1: Install `@expo-google-fonts/barlow`** (AC: #4)
  - [x] `npx expo install @expo-google-fonts/barlow` from `apps/mobile`. Confirmed available exports: `Barlow_400Regular`, `Barlow_500Medium`, `Barlow_600SemiBold`, `Barlow_700Bold`, `Barlow_800ExtraBold`.
- [x] **Task 2: Extend `constants/theme.ts`** (AC: #2)
  - [x] Add `background`/`surface`/`surfaceElevated`/`border`/`accent`/`text`/`textSecondary` to both `Colors.light` and `Colors.dark`, additive alongside the 5 existing keys. Dark values: navy-tinted near-black background, `Brand.primary` as `surfaceElevated`, `Brand.accent` as the `accent` fallback.
- [x] **Task 3: Force dark theme** (AC: #3)
  - [x] `hooks/use-theme.ts`: return `Colors.dark` unconditionally, comment explaining this is intentional pending a future light-mode toggle.
- [x] **Task 4: Load Barlow** (AC: #4)
  - [x] `app/_layout.tsx`: `useFonts` call inside `RootNavigator` (alongside the existing `isLoading` session gate — same early-return pattern, hooks called unconditionally before any return per Rules of Hooks), gate `RootNavigator`'s real render until `loaded || error`.
- [x] **Task 5: Barlow in `ThemedText`** (AC: #4)
  - [x] `title`/`subtitle` → `Barlow_800ExtraBold`/`Barlow_700Bold`, `textTransform: 'uppercase'`, `letterSpacing`. `default`/`small` → `Barlow_400Regular`/`500Medium`. `smallBold` → `Barlow_600SemiBold`.
- [x] **Task 6: Per-gym accent color mechanism** (AC: #1)
  - [x] New `hooks/use-gym-accent-color.tsx`: `GymAccentColorProvider` (fetches the caller's own gym's `primary_color` once via existing `read own gym` RLS, hex-validates it, falls back to `Brand.accent`) + `useGymAccentColor()` consumer hook (context default = `Brand.accent`, so any component using it outside a Provider — i.e. onboarding — safely gets the platform default, matching the existing documented constraint).
  - [ ] Wire `GymAccentColorProvider` around the authenticated `(tabs)`/`plan` branch in `app/_layout.tsx` — **deferred to Story 8.5**, since that's when those screens actually start consuming it; the Provider/hook exist and are ready to use starting this story.
- [ ] **Task 7: Manual verification** (AC: all) — deferred to the consolidated end-of-epic verification pass.

## Dev Notes

### Technical Requirements & Architecture Compliance

- Verified current `expo-font`/`@expo-google-fonts` API against live Expo v57 docs (`docs.expo.dev/versions/v57.0.0/sdk/font/`, `docs.expo.dev/develop/user-interface/fonts/`) per `AGENTS.md`'s mandate to check exact versioned docs before writing Expo code — `useFonts` returns `[loaded, error]`, gate rendering on `loaded || error`, `SplashScreen.preventAutoHideAsync()` already called at module scope in `_layout.tsx`.
- `components/animated-icon.tsx`'s `AnimatedSplashOverlay` already calls `SplashScreen.hideAsync()` independently on its own `onLayout` — that's the native launch-screen hide, unrelated to font readiness. `RootNavigator`'s own gate (now `isLoading || (!fontsLoaded && !fontsError)`) controls when *real screens* render, same pattern the existing session-loading gate already used.
- `GymAccentColorProvider`'s own Supabase query is intentionally self-contained (queries `gyms.primary_color` itself) rather than refactoring `(tabs)/index.tsx`'s existing data-fetching shape — keeps this story's diff isolated from Home's own logic, which Story 8.5 restyles separately without needing to also refactor its data layer.

### Previous Story Intelligence

- `constants/brand.ts`'s doc comment (pre-existing, not written by this story) is the source of truth for the onboarding-never-uses-gym-color constraint — re-confirmed here, not re-litigated.

### Review Findings

- [x] [Review][Patch] AC #2's "5 existing keys untouched" claim is false — `dark.text`/`dark.background`/`dark.textSecondary`/`light.background` were all changed [apps/mobile/src/constants/theme.ts]. **Decision: accept the deviation** (navy-tinted near-black is intentional polish, negligible visual impact, reverting would fight this story's own "polished dark theme" goal) — fixed the AC #2 wording and the in-code comment to accurately state only `backgroundElement`/`backgroundSelected` (dark) and `text`/`backgroundElement`/`backgroundSelected`/`textSecondary` (light) are unchanged.
- [x] [Review][Patch] `default`/`small` Barlow weights are swapped from AC #4/Task 5's literal mapping [apps/mobile/src/components/themed-text.tsx]. **Decision: fix the code** — swapped so `default`→`Barlow_400Regular`, `small`→`Barlow_500Medium`, matching the spec.
- [x] [Review][Patch] Navigation chrome theme is decoupled from the forced-dark content theme [apps/mobile/src/app/_layout.tsx] — `RootLayout` still picked `DarkTheme`/`DefaultTheme` via `useColorScheme()`, no `<StatusBar>` override existed anywhere. **Decision: fix it** — forced `DarkTheme` unconditionally (mirroring `useTheme()`'s AC #3 approach) and added `expo-status-bar`'s `<StatusBar style="light" />`.
- [x] [Review][Dismiss] `type="subtitle"`'s uppercase/letter-spacing applies to `plan.planName` and `OtpInput`'s digits — **Decision: accept as-is.** OTP digits are numerals (uppercase is a no-op there); bold-uppercase plan labels are a plausible, common premium-app design choice consistent with this story's own "bold condensed-header look" language. Covered by the already-tracked manual/Figma verification action item in `sprint-status.yaml` — no code change.
- [x] [Review][Patch] `GymAccentColorProvider` re-fetches and flashes back to `Brand.accent` on every independent mount [apps/mobile/src/hooks/use-gym-accent-color.tsx] — verified two live mount points (`(tabs)/_layout.tsx`, `plan.tsx`), each started cold and re-fetched `gyms.primary_color` independently. Fixed with a module-level cache shared across mounts.
- [x] [Review][Patch] Supabase call has no `.catch()` [apps/mobile/src/hooks/use-gym-accent-color.tsx] — a rejected promise became an unhandled rejection instead of falling back to `Brand.accent`. Fixed via try/catch in the extracted `resolveGymAccentColor()`.
- [x] [Review][Patch] `.single()` should be `.maybeSingle()` [apps/mobile/src/hooks/use-gym-accent-color.tsx] — a zero-row result was treated as a query error rather than an expected fallback case. Fixed.
- [x] [Review][Patch] `fontsError` is captured but never logged [apps/mobile/src/app/_layout.tsx] — a Barlow load failure in production failed silently with zero observability. Fixed with a `console.error` in a new `useEffect`.
- [x] [Review][Patch] `Colors.light.accent`/`Colors.dark.accent` are dead code [apps/mobile/src/constants/theme.ts] — verified zero consumers anywhere in the codebase; the real per-gym accent flows exclusively through `useGymAccentColor()`. Removed.
- [x] [Review][Defer] `linkPrimary` still hardcoded to legacy blue `#3c87f7` [apps/mobile/src/components/themed-text.tsx] — deferred, pre-existing; out of scope for this story's AC.

**Post-review verification:** `npx tsc --noEmit` clean across `apps/mobile` after all patches applied (2026-08-05).
