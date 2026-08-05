---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.4: Mobile Shared UI Primitives

Status: done

## Story

As a developer building/maintaining the mobile app,
I want a shared library of themed UI primitives,
so that button, card, badge, progress-bar, OTP-input, and segmented-control styling isn't copy-pasted and drifting across every screen.

**Context:** builds on Story 8.3's tokens/accent hook. Full context in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`. This story only builds the primitives — wiring them into actual screens is Stories 8.5/8.6.

## Acceptance Criteria

1. **Given** the patterns duplicated per-screen today (buttons, bordered cards, status badges, the 4-segment onboarding progress bar, the 6-box OTP entry, History's segmented control), **when** this story is complete, **then** each has exactly one themed implementation under `apps/mobile/src/components/ui/`, consuming Story 8.3's tokens (`useTheme()`) and, where relevant, `useGymAccentColor()`.
2. **Given** `OtpInput`, **when** built, **then** it is a presentational component only (`value`, `onChangeText`, `length`, `editable`, `shakeValue` props) — the auto-advance/paste-fill logic (a single hidden `TextInput` driving visual boxes) and the shake `Animated.Value` stay owned by the screen using it (wired in Story 8.6), so behavior is provably unchanged.
3. **Given** `ProgressSteps`, **when** built, **then** it takes `{ totalSteps, currentStep }` and renders the same segment-fill visual as today's copy-pasted `progressTrack`/`progressSegment` styles, using `accent` for filled segments.

## Tasks / Subtasks

- [x] **Task 1: `components/ui/Button.tsx`** (AC: #1) — primary (solid `accent` pill), secondary (outline), disabled/loading states, accepts optional `accentColor` override (defaults to `useGymAccentColor()`).
- [x] **Task 2: `components/ui/Card.tsx`** (AC: #1) — rounded, `surface`/`surfaceElevated` background, `border` outline.
- [x] **Task 3: `components/ui/Badge.tsx`** (AC: #1) — pill chip taking explicit `{ bg, border, text }` colors (callers keep owning their own semantic color maps — `STATUS_COLORS`/`PAYMENT_STATUS_COLORS`/`OCCUPANCY_COLORS` re-tuned for dark surfaces in Story 8.5, not moved into this component).
- [x] **Task 4: `components/ui/ProgressSteps.tsx`** (AC: #3).
- [x] **Task 5: `components/ui/OtpInput.tsx`** (AC: #2).
- [x] **Task 6: `components/ui/SegmentedControl.tsx`** (AC: #1) — generic `{ options, value, onChange }`, pill-style active indicator.
- [ ] **Task 7: Manual verification** — deferred; these primitives have no screen consumers until Stories 8.5/8.6, verified there.

## Dev Notes

Each primitive is deliberately unopinionated about business logic — screens pass data/handlers in, primitives only own visual presentation. This keeps Stories 8.5/8.6 pure "swap old inline styles for these components" diffs against otherwise-untouched screen logic.

### Review Findings

- [x] [Review][Patch] `Button`/`SegmentedControl` hardcode `#000000` label text over `accent`, with no contrast handling anywhere in the codebase [Button.tsx, SegmentedControl.tsx] — On authenticated/gym-branded screens (wired in Story 8.5), `accent` resolves to `useGymAccentColor()`, which is the gym owner's freely-chosen `primary_color` (dashboard Settings form, regex-validated for hex format only, no luminance/contrast check). A gym picking a dark brand color makes every primary button and the active segmented-control tab illegible. User decision (2026-08-05): fix at the primitive layer. Fixed: added `apps/mobile/src/lib/color-contrast.ts`'s `getContrastTextColor()` (YIQ perceived-brightness formula) and applied it to `Button.tsx`'s primary label/spinner and `SegmentedControl.tsx`'s selected label.
- [x] [Review][Patch] `ProgressSteps` segment gap regresses from 4px to 6px [ProgressSteps.tsx:41] — `track.gap` is hardcoded to `6`, but all four onboarding screens it replaces (`profile.tsx`, `goal.tsx`, `experience.tsx`, `plan.tsx`) used `gap: Spacing.one` (4px) for the identical bar. Violates AC3's "same segment-fill visual" requirement. Fixed: now uses `Spacing.one`.
- [x] [Review][Patch] `OtpInput` embeds numeric-filter/truncation logic that AC2 requires the screen to own [OtpInput.tsx:53] — `onChangeText={(v) => onChangeText(v.replace(/[^0-9]/g, '').slice(0, length))}` moved this filtering into the primitive; `otp.tsx` now just passes `setCode` directly. AC2 states OtpInput is "a presentational component only" and that filter/paste-fill logic "stay[s] owned by the screen using it." Fixed: `OtpInput` now passes the raw text straight through; `otp.tsx`'s `onChangeText` handler owns the regex filter/slice again.
- [x] [Review][Patch] `SegmentedControl`/`Badge` pill labels have no truncation guard [SegmentedControl.tsx:39, Badge.tsx:22] — no `numberOfLines` on the label `ThemedText`. The app is bilingual; the one live consumer already wired in this working tree (History screen) passes `fr.json`'s `"Enregistrements"` (13 chars) vs `en.json`'s `"Check-ins"` (9 chars) into a fixed `flex:1` pill, risking a wrapped/broken pill in French. Fixed: added `numberOfLines={1}` to both labels.
- [x] [Review][Patch] `Button`'s `{...rest}` spread can silently override `accessibilityRole` [Button.tsx:27,37] — `accessibilityRole="button"` is set before `{...rest}` is spread on the same `Pressable`, and `ButtonProps` only omits `style` from `PressableProps`, so a caller passing `accessibilityRole` overrides the intended semantics with no type error. Fixed: `rest` is now spread first, followed by `accessibilityRole={rest.accessibilityRole ?? 'button'}`.
- [x] [Review][Defer] `Badge.tsx`'s `paddingHorizontal: 10` doesn't match the `Spacing` token scale [Badge.tsx:33] — deferred, pre-existing ambiguity (no design-source confirmation available for whether 10px is an intentional Figma value or should normalize to `Spacing.two`=8)
