---
baseline_commit: 69c348ffeec2400515dbba6ab7b487a0ed05e646
---

# Story 15.2: Shared Component Library — Card Elevation, Icon Chip, List Item, Stat Tile

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a mobile app developer,
I want the shared UI primitives DESIGN.md now specifies (Card `raised`, Icon Chip, List Item, Stat Tile) built as reusable components,
so that Home and Profile — and future screens — can apply them without each screen hand-rolling its own bordered-row treatment.

## Acceptance Criteria

1. **Given** `apps/mobile/src/components/ui/Card.tsx`'s `elevated` prop currently only swaps background color, with no shadow/elevation styling defined, and zero current callers pass `elevated` anywhere in the codebase (confirmed via `grep -rn "elevated\b" apps/mobile/src` — the prop is dead weight today), **when** this story ships, **then** `Card` gains a `variant?: 'flat' | 'raised'` prop (replacing `elevated`, default `'flat'`) implementing DESIGN.md's Elevation & Depth spec: `flat` renders byte-identical to today's default (no-prop-passed) output — `theme.surface` background, `borderWidth: 1` / `theme.border`, `borderRadius: 16`, no shadow; `raised` renders `theme.surfaceElevated` background, no border, `borderRadius: 16`, and a real shadow (iOS `shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: {width: 0, height: 4}`; Android `elevation: 4`). Every existing caller (`renew.tsx`, `workout-plan.tsx`, `(tabs)/history/payment/[id].tsx`, `plan.tsx`, `(tabs)/profile.tsx`, `onboarding/plan.tsx`) passes only `style`, never `elevated` — none need updating, and none change visually.

2. **Given** no Icon Chip component exists yet, **when** this story ships, **then** a new `IconChip.tsx` exists at `apps/mobile/src/components/ui/`, taking a MaterialIcons glyph name and a semantic tint (`accent`/`success`/`warning`/`danger`/`primary`), rendering a 36×36, `borderRadius: 8`, 1px-bordered, centered-icon chip per DESIGN.md's `iconChip` spec — with the exact per-tint color resolution specified in Dev Notes (not left to implementation judgment: `success`/`warning`/`danger` reuse this codebase's already-tuned dark-theme status hues verbatim, `accent`/`primary` use a solid computed-contrast fill matching `Button.tsx`'s existing treatment).

3. **Given** no List Item component exists yet (Home/Profile currently hand-roll bordered rows per-screen), **when** this story ships, **then** a new `ListItem.tsx` exists, composing `IconChip` + title + trailing meta text, matching EXPERIENCE.md's Member App Component Library List Item spec, with a row `minHeight` of 44pt per the existing Interaction Primitives / Accessibility Floor rule. `ListItem` renders one row only — it does not wrap itself in a `Card` and does not render its own inter-row divider; grouping multiple `ListItem`s inside one shared `flat` Card (per EXPERIENCE.md's "the group wrapped in one flat Card" wording) is Story 15.3/15.4's job, done against real screen content, not pre-baked here.

4. **Given** no Stat Tile component exists yet, and `ThemedText`'s `type` prop has no numeral-emphasis variant, **when** this story ships, **then** `ThemedText` gains a `statNumeral` type (Barlow ExtraBold 800, 32/36, `fontVariant: ['tabular-nums']`, no uppercase/letter-spacing — distinct from `title`/`subtitle`'s uppercase treatment) and a new `StatTile.tsx` composes it with a `small`/`textSecondary` caption inside a `raised` Card (via the `variant` prop from AC #1).

5. **Given** these are new shared primitives with no existing screen consuming them yet, **when** this story ships, **then** it ships the four components but does **not** modify Home or Profile screens — that's Stories 15.3/15.4, kept separate so a primitives regression and a screen-layout regression are never bisected together. **Given** `apps/mobile` has zero test runner wired anywhere in the codebase today (no `jest`/`vitest` config, no `.test.ts*` files, confirmed via repo-wide search — a pre-existing, project-wide, already-logged gap, not something this story introduces), **then** "isolated coverage matching this repo's existing component-testing convention" is satisfied by there being no mobile component-testing convention to match — installing a new test framework is explicit **out of scope** for this story (it would be an unapproved new dependency addition, and the decision to adopt one is a standing open action item owned by the user, not a dev-story judgment call) — disclosed explicitly in Completion Notes, matching every prior mobile story's precedent, not silently skipped.

## Tasks / Subtasks

- [x] **Task 1: Card `raised` variant** (AC: #1)
  - [x] `apps/mobile/src/components/ui/Card.tsx`: replace `elevated?: boolean` with `variant?: 'flat' | 'raised'` (default `'flat'`).
  - [x] `flat`: `backgroundColor: theme.surface`, `borderWidth: 1`, `borderColor: theme.border`, `borderRadius: 16`, no shadow/elevation keys present (must match today's default output exactly).
  - [x] `raised`: `backgroundColor: theme.surfaceElevated`, no border (`borderWidth: 0`), `borderRadius: 16`, plus `Platform.select`-gated shadow: iOS `{ shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }`, Android `{ elevation: 4 }`.
  - [x] Confirm via `grep -rn "elevated\b" apps/mobile/src` that no caller passes the old prop — no other files change.

- [x] **Task 2: `ThemedText` `statNumeral` type** (AC: #4)
  - [x] `apps/mobile/src/components/themed-text.tsx`: add `'statNumeral'` to the `type` union.
  - [x] Style: `fontFamily: 'Barlow_800ExtraBold'`, `fontSize: 32`, `lineHeight: 36`, `fontVariant: ['tabular-nums']`. No `textTransform`/`letterSpacing` (unlike `title`/`subtitle`).

- [x] **Task 3: `IconChip.tsx`** (AC: #2)
  - [x] New file `apps/mobile/src/components/ui/IconChip.tsx`. Export `IconChipTint = 'accent' | 'success' | 'warning' | 'danger' | 'primary'` and `IconChipProps = { icon: MaterialIconsIconName; tint: IconChipTint }` (import `MaterialIconsIconName` from `@react-native-vector-icons/material-icons` — a public named export of that package, confirmed in its shipped `.d.ts`). `ListItem.tsx` (Task 4) imports `IconChipTint` from this file rather than redeclaring the union.
  - [x] 36×36 `View`, `borderRadius: 8`, `borderWidth: 1`, `alignItems`/`justifyContent: 'center'`, centered `MaterialIcons` glyph at size 20.
  - [x] Per-tint fill/border/icon-color resolution — see Dev Notes' exact table. `accent` calls `useGymAccentColor()`; `primary`/`success`/`warning`/`danger` use fixed hex values (no per-gym override).

- [x] **Task 4: `ListItem.tsx`** (AC: #3)
  - [x] New file `apps/mobile/src/components/ui/ListItem.tsx`. Props: `{ icon: MaterialIconsIconName; tint: IconChipTint; title: string; meta?: string; onPress?: () => void }`.
  - [x] Row: `flexDirection: 'row'`, `alignItems: 'center'`, `gap: Spacing.two`, `minHeight: 44`. Renders `Pressable` (with `accessibilityRole="button"`) when `onPress` is given, plain `View` otherwise.
  - [x] Leading `IconChip`, then title as `ThemedText type="smallBold"` (`flex: 1`, `numberOfLines={1}`), then optional trailing `meta` as `ThemedText type="small" themeColor="textSecondary"`.

- [x] **Task 5: `StatTile.tsx`** (AC: #4)
  - [x] New file `apps/mobile/src/components/ui/StatTile.tsx`. Props: `{ value: string; caption: string }` (caller pre-formats `value`, e.g. `"12"` — no new formatting logic in this component).
  - [x] `<Card variant="raised">` containing `<ThemedText type="statNumeral">{value}</ThemedText>` + `<ThemedText type="small" themeColor="textSecondary">{caption}</ThemedText>`, `gap: Spacing.half`.

- [x] **Task 6: Disclose the testing-infrastructure gap** (AC: #5)
  - [x] Confirm via repo search (`find apps/mobile/src -iname "*.test.ts*"`, check `apps/mobile/package.json` for a `test` script / jest config) that zero test infrastructure exists.
  - [x] Do **not** install Jest/RNTL or any test runner as part of this story. Record the gap explicitly in Completion Notes (matching Stories 9.5/10.x/13.5's identical disclosures), not silently.

- [x] **Task 7: Verify** (AC: #1–#5)
  - [x] `pnpm --filter mobile typecheck` clean.
  - [x] Re-run the Task 1 `elevated` grep to confirm zero existing-caller impact.
  - [x] Confirm (read, don't run — no mobile test/build harness to execute a real render in this environment) that `Home`/`Profile` (`(tabs)/index.tsx`, `(tabs)/profile.tsx`) are untouched by this story's diff — `git diff --stat` should show only the 5 files in this story's own File List.
  - [x] On-device visual confirmation of these primitives is deferred to whichever of Stories 15.3/15.4 first renders them on a real screen — this story ships zero screen integration by design (AC #5), so there is nothing to visually check in isolation yet.

## Dev Notes

### The `elevated` → `variant` rename is safe — verified, not assumed

`grep -rn "elevated\b" apps/mobile/src` today only matches `Card.tsx`'s own prop declaration and its one internal usage — **zero callers** (`renew.tsx`, `workout-plan.tsx`, `(tabs)/history/payment/[id].tsx`, `plan.tsx`, `(tabs)/profile.tsx`, `onboarding/plan.tsx` — every current `<Card>` usage in the app) pass it. This is a clean, non-breaking API replacement, not a deprecation needing a compat shim. DESIGN.md's own Components section (line 114) explicitly permits this: *"existing `flat`/`elevated` background-swap prop is renamed in behavior (not code necessarily)"* — but `variant: 'flat' | 'raised'` is the better fit here since it matches this codebase's own established naming convention (`Button.tsx`'s `variant?: 'primary' | 'secondary'`), and `StatTile`/future callers need to say `variant="raised"` legibly rather than a bare boolean.

### IconChip tint → color resolution (explicit, not a judgment call left to implementation)

DESIGN.md/EXPERIENCE.md say tints are "tinted to the same status color the Status Badge already uses" (EXPERIENCE.md:620) for status-like tints, but don't spell out exact hex per generic tint name. Resolved here by tracing which existing color family each tint maps to, so Story 15.3's later reuse (`grace_period`'s warning glyph "moves into the chip, not duplicated") produces an **identical** visual to what already ships today:

| tint | fill/bg | border | icon color | rationale |
|---|---|---|---|---|
| `success` | `#123321` | `#1F5C3A` | `#4ADE80` | = `subscription-status.ts`'s `STATUS_COLORS.active` (already the dark-theme-tuned "success" hue) |
| `warning` | `#3A2A12` | `#5C4420` | `#FBBF24` | = `STATUS_COLORS.expiring_soon`/`.grace_period` (already the dark-theme-tuned "warning" hue) |
| `danger` | `#3A1414` | `#5C1F1F` | `#F87171` | = `STATUS_COLORS.expired` (already the dark-theme-tuned "danger" hue) |
| `primary` | `Brand.primary` (`#1B2A41`) | `theme.border` | `getContrastTextColor(Brand.primary)` | solid fill, same "flat brand-color surface + computed contrast label" pattern `Button.tsx`'s primary variant already uses — not a low-opacity wash, since `#1B2A41` is too close to the dark theme's own background/surface tones to read as a wash |
| `accent` | `useGymAccentColor()` | `theme.border` | `getContrastTextColor(fill)` | same solid-fill + computed-contrast pattern; **must** call the hook (per-gym override), never hardcode `Brand.accent` directly — matches `Button.tsx`'s own accent resolution |

Do **not** import `STATUS_COLORS` from `subscription-status.ts` directly (wrong semantic coupling — that module is subscription-specific). Colocate a small `success`/`warning`/`danger` hex map inside `IconChip.tsx` itself with a comment cross-referencing this table's rationale — this repo's own established pattern for this exact kind of intentional value overlap (see `subscription-status.ts`'s own comment: *"Meaning matches the dashboard's existing... badge families... not identical hex values, since no cross-app design-token doc mandates parity"*).

`success`/`warning`/`danger`/`primary` are platform-fixed (DESIGN.md: never vary per gym or theme) — only `accent` is dynamic.

DESIGN.md also mentions Icon Chip can be "fully circular per context" — **not built**: no AC in this epic (15.2–15.4) calls for a circular chip anywhere. Building an unused `shape` prop now would be speculative API surface with no caller; add it later if a story actually needs it.

### `ListItem` does not own Card-wrapping or dividers — deliberately

EXPERIENCE.md (line 1896) and DESIGN.md (line 118) both describe **one shared** `flat` Card wrapping a *group* of rows, not each row wrapping itself. `ListItem` renders exactly one row (chip + title + meta) and nothing else. How multiple stacked `ListItem`s get visually separated inside that shared Card (a `gap`, a per-row top hairline, something else) is a real layout decision Stories 15.3/15.4 should make while looking at actual Home/Profile content — guessing it now, two stories early and with no real content to validate against, risks over-specifying something they'd have to rework anyway.

### Card usage inside `StatTile`

`StatTile` is the first real caller of `Card`'s new `variant="raised"` — it exercises Task 1's shadow/elevation styling end-to-end within this same story, so Task 1 isn't shipped fully unverified-by-any-caller.

### No i18n keys needed

All four components take pre-translated plain-string props (`title`, `meta`, `value`, `caption`) — same pattern as `Badge`'s `label: string` and `Button`'s `label: string`. Callers (15.3/15.4) own `t()` calls; these primitives don't.

### Testing gap — read this before attempting to add test infra

`apps/mobile` has **zero** test runner wired anywhere (`find apps/mobile/src -iname "*.test.ts*"` → 0 results; no jest/vitest config; no `test` script in `apps/mobile/package.json`). This is a long-standing, repeatedly-logged, project-wide gap (`deferred-work.md` lines 397, 634, 657; `sprint-status.yaml`'s epic-7 action item: *"Make an explicit, one-time decision on the 'no test runner' question"*, status **open**, owned by the user — not a decision a dev-story pass should make unilaterally mid-feature-story). AC #5's "isolated coverage matching this repo's existing convention" is satisfied by disclosure, matching every single prior mobile story (9.5, 10.1–10.4, 13.5's own explicit precedent) — do **not** attempt to install Jest/React Native Testing Library as part of this story; that's a new-dependency addition requiring separate user approval per the dev-story workflow's own HALT condition, and well outside this story's stated scope.

### `apps/mobile/AGENTS.md`'s Expo-version warning — not applicable here

All four components are plain React Native (`View`/`Text`/`Pressable`/`StyleSheet`), no Expo-specific APIs. Noted for completeness per this repo's convention of citing that file, not because anything here touches Expo's changed surfaces.

### Git Intelligence

`apps/mobile/src/components/ui/` was established in one commit, `d5bb7c4` ("feat(mobile): Story 8.4 - Shared UI primitives", 2026-08-05) — `Card.tsx`/`Badge.tsx`/`Button.tsx`/`collapsible.tsx`/`OtpInput.tsx`/`ProgressSteps.tsx`/`SegmentedControl.tsx` all originate there and no `ui/` file has been touched since (confirmed: only 2 commits ever touch this directory, the other being the initial monorepo scaffold). This story is a direct continuation of that same primitive-library pattern — new files should match its established shape (named-export function component, `ViewProps`/`PressableProps` extension via `interface ...Props extends ...`, `StyleSheet.create` at module scope, `useTheme()` for theme colors) rather than introduce a different component style.

### Project Structure Notes

- Modified: `apps/mobile/src/components/ui/Card.tsx`, `apps/mobile/src/components/themed-text.tsx`.
- New: `apps/mobile/src/components/ui/IconChip.tsx`, `apps/mobile/src/components/ui/ListItem.tsx`, `apps/mobile/src/components/ui/StatTile.tsx`.
- No changes to `apps/mobile/src/app/**` (no screens) — enforced by AC #5, verified in Task 7.
- No new dependencies (`@react-native-vector-icons/material-icons` is already installed and already used in `(tabs)/index.tsx`/`plan.tsx`).
- No database/migration/RLS/pgTAP surface, no i18n key changes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 15: Mobile Experience Quality Pass / Story 15.2] — full AC text and origin
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md#Elevation & Depth, #Components, frontmatter `components:` block] — `flat`/`raised`/`iconChip`/`statNumeral` exact specs
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#Member App Component Library] — Icon Chip / List Item / Stat Tile behavioral spec (lines 1888–1898)
- [Source: apps/mobile/src/components/ui/Card.tsx] — current `elevated` implementation being replaced
- [Source: apps/mobile/src/components/ui/Button.tsx] — `variant` naming precedent + solid-fill/computed-contrast tint pattern reused for `accent`/`primary`
- [Source: apps/mobile/src/components/ui/Badge.tsx] — colocated-semantic-color-map precedent reused for `success`/`warning`/`danger`
- [Source: apps/mobile/src/constants/subscription-status.ts] — `STATUS_COLORS` hex values this story's `success`/`warning`/`danger` tints intentionally match
- [Source: apps/mobile/src/constants/theme.ts] — `Colors.dark.surface`/`surfaceElevated`/`border`, `Spacing` tokens
- [Source: apps/mobile/src/constants/brand.ts] — `Brand.primary`
- [Source: apps/mobile/src/hooks/use-gym-accent-color.tsx] — `useGymAccentColor()`, required for the `accent` tint (never hardcode `Brand.accent`)
- [Source: apps/mobile/src/lib/color-contrast.ts] — `getContrastTextColor()`, reused for `accent`/`primary` icon color
- [Source: apps/mobile/src/components/themed-text.tsx] — current `type` union being extended with `statNumeral`
- [Source: apps/mobile/src/app/(tabs)/index.tsx:4,356] — existing `MaterialIcons` import path and usage precedent
- [Source: deferred-work.md:397,634,657; sprint-status.yaml epic-7 action items] — the pre-existing "no mobile test runner" gap and its open, user-owned decision

## Change Log

- 2026-09-02: dev-story: implemented all 7 tasks. `Card.tsx`'s dead `elevated?: boolean` prop (zero existing callers) replaced with `variant?: 'flat' | 'raised'` implementing DESIGN.md's Elevation & Depth spec; `ThemedText` gained a `statNumeral` type; three new primitives shipped (`IconChip.tsx`, `ListItem.tsx`, `StatTile.tsx`), all colocated in `apps/mobile/src/components/ui/` matching the existing Story 8.4 primitive-library shape. No screens touched (by design, AC #5). Full regression clean: typecheck 0 errors across all 4 workspace packages. `apps/mobile`'s pre-existing zero-test-runner gap confirmed and explicitly not addressed (out of scope, separate open decision). Status: ready-for-dev → review.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `grep -rn "elevated\b" apps/mobile/src` — 0 matches both before writing `IconChip`/`ListItem`/`StatTile` (confirming the AC #1 premise) and after the `Card.tsx` edit (confirming the rename introduced no dangling references).
- `pnpm --filter mobile typecheck` and `pnpm -r typecheck` (all 4 workspace packages) — both clean, 0 errors.
- `find apps/mobile/src -iname "*.test.ts*"` → 0 results; `grep -n '"test"' apps/mobile/package.json` → no match; no `jest`/`vitest` config file in `apps/mobile/` — confirms Task 6/AC #5's testing-gap premise.
- `git status --short apps/mobile/src` post-implementation shows exactly this story's 5 intended files plus one pre-existing unrelated modification (`src/app/_layout.tsx`, carried over uncommitted from Story 14.1, not touched by this story) — confirms AC #5's "no screen changes" boundary held.
- Verified the `getContrastTextColor` outputs used by `IconChip`'s `accent`/`primary` tints match expectations: `#1B2A41` (primary) → white icon, `#E0971F` (default gym accent) → black icon — same computation `Button.tsx`'s primary variant already relies on.

### Completion Notes List

- **Card `variant` rename:** confirmed via grep (both before and after) that `elevated` had zero callers anywhere in the app — this was a clean rename, not a breaking change requiring caller updates.
- **IconChip tint colors:** implemented exactly per the story's Dev Notes table — `success`/`warning`/`danger` reuse `subscription-status.ts`'s `STATUS_COLORS.active`/`.expiring_soon`/`.expired` hex values verbatim (colocated in `IconChip.tsx`, not imported, per the story's explicit "wrong semantic coupling" guidance); `accent`/`primary` use solid fill + `getContrastTextColor()`, with `accent` resolved via `useGymAccentColor()` (never hardcoded `Brand.accent`) so it follows a gym's own branding override.
- **No circular IconChip variant built** — per the story's own explicit scope note, DESIGN.md mentions a circular option but no AC in Epic 15 (15.2–15.4) calls for it; not built.
- **ListItem composition boundary honored** — renders one row only, no self-wrapping `Card`, no inter-row divider. Left for Stories 15.3/15.4 to decide against real content, per the story's Dev Notes.
- **Testing-infrastructure gap (AC #5) — disclosed, not fixed:** `apps/mobile` has zero test runner wired anywhere (0 `.test.ts*` files, no `test` script, no jest/vitest config) — this is a pre-existing, project-wide, already-logged gap (`deferred-work.md` lines 397/634/657), not introduced by this story. Per the story's explicit instruction, no test framework was installed as part of this work — that's a separate, user-owned, still-open decision (`sprint-status.yaml` epic-7 action items), not a dev-story judgment call. "Isolated coverage" for these four components does not exist and is not claimed to exist.
- **On-device visual verification:** not performed — this story ships zero screen integration by design (AC #5), so there is no rendered surface to visually check yet. The first real visual confirmation of these primitives happens in Stories 15.3/15.4.

### File List

**Modified:**
- `apps/mobile/src/components/ui/Card.tsx`
- `apps/mobile/src/components/themed-text.tsx`

**Added:**
- `apps/mobile/src/components/ui/IconChip.tsx`
- `apps/mobile/src/components/ui/ListItem.tsx`
- `apps/mobile/src/components/ui/StatTile.tsx`
