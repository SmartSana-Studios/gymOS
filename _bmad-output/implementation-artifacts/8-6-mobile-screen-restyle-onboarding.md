---
baseline_commit: 7ee32069916cd5731ed2dc132e604ee04fefc252
---

# Story 8.6: Mobile Screen Restyle — Onboarding Flow

Status: done

## Story

As a new gym member,
I want the onboarding flow (language, phone, OTP, profile, goal, experience, plan confirmation) to match the app's new visual quality,
so that first impressions of the app are polished, not the current plain/minimal styling.

**Context:** consumes Stories 8.3/8.4. Full context in `C:\Users\Admin\.claude\plans\peaceful-inventing-umbrella.md`. Per `constants/brand.ts`'s pre-existing doc comment, onboarding never mounts `GymAccentColorProvider` — every accent color here resolves to the platform default `Brand.accent` via the context's default value (Story 8.3), not any gym's custom color. This is intentional, existing platform-shell behavior, not a gap in this story.

## Acceptance Criteria

1. **Given** all 8 onboarding screens (`language`, `phone`, `otp`, `lockout`, `profile`, `goal`, `experience`, `plan`), **when** restyled, **then** they use Story 8.4's primitives (`Button`, `Card`, `ProgressSteps`, `OtpInput`) and Story 8.3's tokens/Barlow typography, with the existing step sequencing/guards (`onboarding/_layout.tsx`'s `SequencingGuard`) and all validation/submission logic unchanged.
2. **Given** the 4-segment progress bar currently copy-pasted across `profile`/`goal`/`experience`/`plan`, **when** restyled, **then** all four screens use the single extracted `ProgressSteps` component from Story 8.4.

## Tasks / Subtasks

- [x] **Task 1: `language.tsx`** (AC: #1) — card borders → theme tokens, highlighted state → gym-accent-context default (`Brand.accent`).
- [x] **Task 2: `phone.tsx`** (AC: #1) — Continue button → `Button`; input row border → theme token.
- [x] **Task 3: `otp.tsx`** (AC: #1) — 6-box entry → `OtpInput` (Story 8.4's presentational component); `verifyCode`/`handleResend`/shake-`Animated.Value`/countdown logic all untouched, only the box-row/hidden-`TextInput` JSX was replaced.
- [x] **Task 4: `lockout.tsx`** (AC: #1) — "Try Again" button → `Button`; countdown/lockout-resync logic untouched.
- [x] **Task 5: `profile.tsx`** (AC: #1, #2) — progress bar → `ProgressSteps`; Continue button → `Button`; photo circle/name input → theme tokens.
- [x] **Task 6: `goal.tsx`** (AC: #1, #2) — progress bar → `ProgressSteps`; option cards → theme/accent tokens; Continue button → `Button`.
- [x] **Task 7: `experience.tsx`** (AC: #1, #2) — identical pattern to Task 6.
- [x] **Task 8: `plan.tsx`** (AC: #1, #2) — progress bar → `ProgressSteps`; plan summary/error cards → `Card`; Confirm button → `Button`; `handleConfirm`'s sequenced writes (`users.preferred_language` → `members.goal`/`experience_level`/`onboarding_completed_at` → `refreshSession()`) untouched.
- [ ] **Task 9: Manual verification** (AC: all) — deferred to the consolidated end-of-epic verification pass.

## Dev Notes

### Technical Requirements & Architecture Compliance

- Every screen's restyle is presentational-only. `OtpInput`'s adoption in Task 3 is the highest-risk swap in this story (real auth-flow logic sits right next to it) — verified line-by-line that `verifyCode`, `handleResend`, `playShake`, and the countdown effect are byte-identical to before, only the render block changed.
- `useGymAccentColor()` is called directly (not via a Provider) in `language.tsx`/`goal.tsx`/`experience.tsx` for cases needing the resolved color inline (e.g. conditional border color) — outside any `GymAccentColorProvider`, this always returns the context's default `Brand.accent`, matching pre-existing behavior exactly.

### Previous Story Intelligence

- Story 8.5's tab/plan-modal screens are the only place `GymAccentColorProvider` is actually mounted — onboarding correctly never touches it, per Story 8.3's Dev Notes.
