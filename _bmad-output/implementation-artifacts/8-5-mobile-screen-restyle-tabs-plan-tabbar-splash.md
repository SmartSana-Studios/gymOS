---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.5: Mobile Screen Restyle — Tabs, Plan Modal, Tab Bar & Splash

Status: done

## Story

As a gym member,
I want the Home, Check-In, History, Profile, and Plan screens to use the new design system,
so that the app's main daily-use surfaces match the new visual quality.

**Context:** consumes Stories 8.3 (tokens/accent/font) and 8.4 (primitives). Full context in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`.

## Acceptance Criteria

1. **Given** `(tabs)/index.tsx`, `checkin.tsx`, `history/index.tsx`, `history/payment/[id].tsx`, `profile.tsx`, and `app/plan.tsx`, **when** restyled, **then** they use Story 8.4's primitives and Story 8.3's tokens, with all existing data-fetching, navigation, and business logic unchanged — check-in's scan/result states keep clear green=success/red=error semantics.
2. **Given** the native tab bar (`components/app-tabs.tsx`), **when** restyled, **then** only `backgroundColor`/`indicatorColor`/label colors change to the new tokens — `NativeTabs` structure/shape is not replaced.
3. **Given** `components/app-tabs.web.tsx` and the splash screen (`components/animated-icon.tsx`/`.web.tsx`), **when** restyled, **then** the leftover "Expo Starter" placeholder branding/Docs link is replaced with real app branding, and the splash badge's Expo-blue gradient is recolored to the new brand tokens.

## Tasks / Subtasks

- [x] **Task 1: `GymAccentColorProvider` wiring** (AC: #1) — `(tabs)/_layout.tsx` wraps `<AppTabs/>` (covers all 4 tab screens); `app/plan.tsx` wraps its own content directly (outside the `(tabs)` route group, can't safely wrap inside `Stack.Protected`'s `Stack.Screen` children — see Dev Notes).
- [x] **Task 2: `(tabs)/index.tsx` (Home)** (AC: #1) — quick-action buttons → `Button`; avatar/card/activity-row colors → theme tokens; `STATUS_COLORS`/`OCCUPANCY_COLORS` re-tuned for dark surfaces (`constants/subscription-status.ts`, local map in this file).
- [x] **Task 3: `(tabs)/checkin.tsx`** (AC: #1) — permission-denied button → `Button`; scan-corner flash + "already checked in"/"wrong QR"/"network error" overlays unified to gym accent color; success (green) and denied-expired (red) overlays kept distinct/unchanged in meaning, green re-tuned to `#4ADE80`.
- [x] **Task 4: `(tabs)/history/index.tsx`** (AC: #1) — Payments/Check-ins toggle → `SegmentedControl`; empty-state check-in CTA → `Button`; `PAYMENT_STATUS_COLORS` re-tuned (`constants/payment-status.ts`); row/card borders → theme tokens.
- [x] **Task 5: `(tabs)/history/payment/[id].tsx`** (AC: #1) — receipt card → `Card`.
- [x] **Task 6: `(tabs)/profile.tsx`** (AC: #1) — error card → `Card`; save button → `Button`; language toggle recolored to gym accent; row/input borders → theme tokens.
- [x] **Task 7: `app/plan.tsx`** (AC: #1) — plan summary/error cards → `Card`; wrapped in its own `GymAccentColorProvider` (Task 1).
- [x] **Task 8: `components/app-tabs.tsx`** (AC: #2) — `backgroundColor`/`indicatorColor`/label color from `useTheme()`/`useGymAccentColor()`, no structural change.
- [x] **Task 9: `components/app-tabs.web.tsx`** (AC: #3) — removed "Expo Starter" text + "Docs" external link (confirmed-unused-elsewhere starter remnants per Story 8.5 planning audit); recolored the existing pill (kept the shape — not a new Figma clone); active tab now fills with gym accent.
- [x] **Task 10: `components/animated-icon.tsx`** (AC: #3) — splash badge gradient/background recolored from Expo blue (`#3C9FFE`/`#0274DF`/`#208AEF`) to `Brand.accent`/`Brand.primary`. Note: the logo image asset itself (`assets/images/expo-logo.png`, the Expo bird mark) is unchanged — no GymOS logo asset was available to substitute; flagged for whoever has the real asset.
- [ ] **Task 11: Manual verification** (AC: all) — deferred to the consolidated end-of-epic verification pass.

### Review Findings

- [x] [Review][Patch] Check-in's "already checked in" and "wrong QR"/"network error" overlays (`apps/mobile/src/app/(tabs)/checkin.tsx` ~line 374, ~line 404) switched from a fixed neutral amber (`#B8860B`) to the unconstrained gym `accent` color, risking collision with the fixed green/red success/error overlays for some gyms. Decision (2026-08-05): revert to a fixed neutral/warning color — do not use `accent` for these two states. Fixed: both overlays now use a new fixed `overlayWarning` style (`#B8860B`) instead of `accent`.
- [x] [Review][Patch] Hardcoded `color: '#000000'` text on `accent`-colored backgrounds breaks the pattern this same diff establishes elsewhere. `apps/mobile/src/app/(tabs)/profile.tsx` (`languageOptionActiveLabel`) and `apps/mobile/src/components/app-tabs.web.tsx` (`selectedLabel`) both pin black text over `backgroundColor: accent`, while `Button.tsx` and `SegmentedControl.tsx` (Story 8.4, both consumers of `accent` as a background in this same restyle) correctly call `getContrastTextColor(accent)`. For any gym with a dark `primary_color`, the active language toggle and the selected web tab label render illegible black-on-dark text. Fixed: both now call `getContrastTextColor(accent)`.
- [x] [Review][Patch] Splash screen's web variant still ships the un-recolored Expo-blue gradient — AC#3 incomplete [apps/mobile/src/components/animated-icon.module.css:2]. AC#3 requires the splash badge gradient recolored from Expo blue to the new brand tokens on both native and web. `animated-icon.tsx` was recolored to `Brand.accent`/`Brand.primary`, but `animated-icon.web.tsx`'s CSS module (`background-image: linear-gradient(180deg, #3c9ffe, #0274df)`) was never touched, so the web splash still renders the old Expo-blue gradient. Fixed: gradient stops updated to `#e0971f`/`#1b2a41` (`Brand.accent`/`Brand.primary`).

## Dev Notes

### Technical Requirements & Architecture Compliance

- `GymAccentColorProvider` is **not** wired by wrapping it between `Stack.Protected` and its `Stack.Screen` children in `app/_layout.tsx` — untested whether expo-router's static route config tolerates a Context.Provider in that position, and the risk of silently breaking route resolution outweighed sharing one fetch instance. Instead: `(tabs)/_layout.tsx` (a genuine layout component, safe to wrap arbitrarily) covers the 4 tab screens, and `app/plan.tsx` wraps its own content directly (one small extra query on mount, negligible cost, zero routing risk).
- Every screen's restyle is presentational-only — no `useState`/`useEffect`/service-call logic was touched, confirmed by re-reading each full diff against the pre-existing file before considering the task done.
- `constants/subscription-status.ts`'s `STATUS_COLORS` and `constants/payment-status.ts`'s `PAYMENT_STATUS_COLORS` are shared modules — re-tuning them here affects every consumer (Home, History, Plan), all restyled together in this same story, so no screen is left with a mismatched half-migrated palette.

### Previous Story Intelligence

- Story 8.4's primitives (`Button`, `Card`, `SegmentedControl`) all default their accent to `useGymAccentColor()` internally — screens using them inside a `GymAccentColorProvider` need no extra prop-drilling.
