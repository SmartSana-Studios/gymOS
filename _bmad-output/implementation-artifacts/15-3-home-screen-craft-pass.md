---
baseline_commit: 69c348ffeec2400515dbba6ab7b487a0ed05e646
---

# Story 15.3: Home Screen Craft Pass (MA-09)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a gym member,
I want the Home screen's status card, upcoming classes, and recent activity to look like a designed product surface instead of a flat list of bordered text rows,
so that the app feels finished rather than a color swap over a starter template.

*Depends on Story 15.2 (Card `raised`, `IconChip`, `ListItem`, `StatTile` — all shipped, status `review`).*

## Acceptance Criteria

1. **Given** the subscription status card in `apps/mobile/src/app/(tabs)/index.tsx` currently renders as a hand-rolled `Pressable`+`View` with a per-status **background color wash** (`statusColors.bg`/`statusColors.border`), **when** this story ships, **then** it renders as `<Card variant="raised">` (Story 15.2) — a fixed neutral `theme.surfaceElevated` background with shadow, **not** a per-status colored background — with a leading `IconChip` tinted per status (see Dev Notes' icon/tint table) as the sole per-status color signal alongside the existing colored status-label text. This is a deliberate visual simplification the new mock (EXPERIENCE.md's MA-09 ASCII, line 593) calls for, not an oversight — the whole-card color wash goes away, the badge text keeps its existing tint. The existing `grace_period` warning glyph (currently inline `<MaterialIcons name="warning">` beside the label) moves into the chip — not duplicated in both places.

2. **Given** `expiring_soon`/`grace_period` states currently show "Expires {{date}}" as plain prose (`home.expiresOn`/`home.gracePeriodNote` i18n keys, existing `expiryDate` value already computed client-side), **when** a valid positive day-count can be derived from that same `expiryDate` (client-side date-diff, no new fetch), **then** the note renders as "Expires in **{{n}}** days" with the numeral in `statNumeral` emphasis inline in the same sentence (EXPERIENCE.md line 623, MA-09 mockup line 596) — `active` is **not** affected (it keeps its existing plain-date phrasing per the Status Badge States table, unchanged). If the computed day count is `<= 0` (an edge case the mock doesn't address — e.g. expiry lands today, or a data race before status flips to `expired`), fall back to the existing plain-date phrasing rather than showing "0 days" or a negative number.

3. **Given** Recent Activity and Upcoming Classes currently render as bare rows (`styles.activityRow`, `borderTopWidth: 1`, no icon), **when** this story ships, **then** each section's populated rows render as `ListItem` components wrapped in one `flat` Card per section (Story 15.2), per EXPERIENCE.md's updated MA-09 spec. Icon Chip tints: check-in → `accent`, payment → `success`, class → **`primary`** (DESIGN.md's List Item component spec, line 118 — epics.md's own AC text says `accent` for class, which conflicts with DESIGN.md; DESIGN.md is the source of truth for exact visual tokens, per its own "Visual specs only" framing, so `primary` is what ships — see Dev Notes). The pre-existing "My Workout Plan" section (added by Story 13.3, not present in EXPERIENCE.md's MA-09 mockup at all — a pre-existing spine gap, not introduced by this story) gets the same `ListItem`-in-`flat`-`Card` treatment as its neighbors for visual consistency, since leaving it as the one remaining unstyled bordered row on an otherwise-restyled screen would look broken, not merely "out of scope."

4. **Given** existing navigation (status card → MA-13, activity rows → History/MA-14, upcoming classes → MA-16, workout-plan row → its own screen via the section header) and all existing `onPress` handlers are correct today, **when** this story ships, **then** every route and handler stays wired exactly as before — this is a presentational-only change. Concretely: Workout Plan's and Upcoming Classes' individual rows are **not** independently tappable today (only their section headers navigate) — their new `ListItem` rows get no `onPress`, matching today's behavior exactly. Recent Activity's rows **are** individually tappable today (no section-header navigation) — their `ListItem` rows keep that per-row `onPress`.

5. **Given** the offline sync banner, the single `ActivityIndicator` loading state, the load-error card, and the "No activity yet…" empty state are pre-existing, **when** this story ships, **then** their copy, trigger conditions, and exact current implementation are unchanged — only the loaded/non-empty row containers (status card, Workout Plan, Upcoming Classes, Recent Activity-when-non-empty) change visually. Note: EXPERIENCE.md's MA-09 "Loading state" section (skeleton rectangles) does **not** match what's actually shipped (a single generic spinner, no skeletons) — this is a separate, pre-existing spec/code gap, **not** something this story builds or fixes (flagged, not silently worked around).

## Tasks / Subtasks

- [x] **Task 1: Status card → `Card variant="raised"` + leading `IconChip`** (AC: #1)
  - [x] Wrap the existing `<Pressable onPress={handleViewPlan}>` around `<Card variant="raised">` instead of a hand-styled `View`; drop the per-status `backgroundColor`/`borderColor` from the outer style (Card's `raised` variant supplies its own fixed background+shadow).
  - [x] Add a `STATUS_ICON_CHIP: Record<BadgeStatus, { icon: MaterialIconsIconName; tint: IconChipTint }>` map (Dev Notes has the exact table) and render `<IconChip icon={...} tint={...} />` as the leading element, beside a text column (badge label / plan name / note).
  - [x] Remove the inline `<MaterialIcons name="warning">` currently rendered in `statusLabelRow` for `grace_period` — that visual now comes from the chip's `icon`/`tint`.
  - [x] Status label text keeps its existing `{ color: statusColors.text }` tint (Story's own Dev Notes: `Badge.tsx` is never actually wired into this screen today — the "Status Badge" the specs reference is this plain colored text; DESIGN.md says Badge is "existing, unchanged," so don't wire it up here — out of scope, flagged only).

- [x] **Task 2: Day-count framing for `expiring_soon`/`grace_period`** (AC: #2)
  - [x] Add a `daysUntil(value: string): number` helper (same local-midnight date construction as the existing `formatDateOnly`, diff against today at local midnight, `Math.round(diffMs / 86400000)`).
  - [x] Add 3 new i18n keys (en + fr, with `_one`/`_other` plural suffixes matching this file's existing `durationDays_one`/`_other` convention): `home.expiresInDaysPrefix` ("Expires in " / "Expire dans "), `home.expiresInDaysSuffix_one`/`_other` (" day" / " days"), `home.gracePeriodDaysSuffix_one`/`_other` (" day — you can still check in" / " days — you can still check in"). Keep `home.expiresOn`/`home.gracePeriodNote` (unchanged) as the `dayCount <= 0` fallback path — don't delete them.
  - [x] Restructure the existing `statusNote` string variable into a `statusNoteContent: ReactNode` that, for `expiring_soon`/`grace_period` with a valid positive `dayCount`, renders `<>{t('home.expiresInDaysPrefix')}<ThemedText type="statNumeral" style={{ color: statusColors.text }}>{dayCount}</ThemedText>{t(isGracePeriod ? 'home.gracePeriodDaysSuffix' : 'home.expiresInDaysSuffix', { count: dayCount })}</>`; every other branch (`no_plan`/`expired`/`active`/the `dayCount <= 0` fallback) keeps producing a plain string, unchanged from today. Render inside the same single outer `<ThemedText type="small" style={{ color: statusColors.text }}>{statusNoteContent}</ThemedText>` wrapper that exists today (nested nested `Text` inline-styling is standard RN, no new pattern needed).
  - [x] Run `pnpm run check:i18n` after adding the keys.

- [x] **Task 3: Recent Activity, Upcoming Classes, Workout Plan → `ListItem` in one `flat` Card per section** (AC: #3, #4)
  - [x] Recent Activity (only when `recentActivity.length > 0` — leave the empty-state branch untouched, AC #5): wrap the mapped rows in `<Card variant="flat">`; each row becomes `<ListItem icon={...} tint={...} title={...} meta={formatCheckInTimestamp(...)} onPress={...} />` — `onPress` preserved exactly as today (check-in → `/history`, payment → `/history/payment/${item.id}`). Icon/tint: check-in → `icon="check-circle"`, `tint="accent"`; payment → `icon="payments"`, `tint="success"`.
  - [x] Upcoming Classes: same `Card variant="flat"` wrap; rows become `ListItem` with `icon="event"`, `tint="primary"`, `title={booking.className}`, `meta={formatCheckInTimestamp(booking.scheduledAt, i18n.language)}`, **no** `onPress` (matches today — only the section header navigates).
  - [x] Workout Plan section: same treatment — `ListItem` with `icon="fitness-center"`, `tint="primary"`, `title={workoutPlanName}`, no `meta`, no `onPress` (matches today).
  - [x] Rows within a multi-row Card (Recent Activity, up to 3; Upcoming Classes, up to 2) need a visual separator between stacked rows — reuse the exact values the old `activityRow` style already used (`borderTopWidth: 1`, `borderTopColor: theme.border`, `paddingTop: Spacing.two`) applied to every row after the first (index > 0), via a plain wrapping `View` around each `ListItem` at the Home-screen call site — **do not** modify `ListItem.tsx` itself to own this (Story 15.2's Dev Notes explicitly left this decision to this story, to be made at the call site against real content, which is what this task does).

- [x] **Task 4: Verify** (AC: #1–#5)
  - [x] `pnpm --filter mobile typecheck` clean.
  - [x] `pnpm run check:i18n` clean (new keys present in both `en.json`/`fr.json`, no orphans).
  - [x] `git diff --stat` shows changes scoped to `(tabs)/index.tsx` + the 2 locale files only (no other screens, no `ui/` component changes — this story is a pure consumer of Story 15.2's primitives).
  - [x] On-device visual confirmation (does the day-count sentence read correctly in both EN/FR, does the status card read as one coherent raised surface, do the three new Card-wrapped sections look consistent with each other) is the user's own manual QA step, per this project's established convention — not simulated here.

### Review Findings

- [x] [Review][Patch] `STATUS_ICON_CHIP.no_plan` used the wrong `IconChip` tint, based on a stale premise [apps/mobile/src/app/(tabs)/index.tsx] — the story's own Dev Notes table (and the code's matching comment) claimed `IconChip` has no `neutral` tint, so `no_plan` shipped as `primary` (blue chip next to the status label's existing gray text — a visible mismatch, and a deviation from EXPERIENCE.md's "Gray" no-plan color signal). That premise was true when this story was authored but stale by the time it shipped: Story 15.2's own code review (2026-09-02) added a 6th `neutral` tint to `IconChip.tsx`, byte-identical to `STATUS_COLORS.no_plan`. Fixed: `no_plan` now uses `tint: 'neutral'` (already applied to the working tree ahead of this review pass — this review corrected the code's comment and this story file's Dev Notes/Completion Notes to match, and re-verified `pnpm --filter mobile typecheck` is clean).
- [x] [Review][Patch] Status card's leading `IconChip` wasn't hidden from screen readers, unlike `ListItem.tsx`'s identical decorative usage [apps/mobile/src/app/(tabs)/index.tsx:467] — `ListItem.tsx` wraps its own leading `IconChip` in `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"` (added by Story 15.2's code review) since the icon is redundant with adjacent text; this diff's new status-card `IconChip` usage was left bare. Fixed: wrapped it the same way.
- [x] [Review][Patch] `dayCount as number` cast wasn't a real type narrowing [apps/mobile/src/app/(tabs)/index.tsx] — `isDayCountEligible` was a separately-computed boolean; TypeScript couldn't actually prove `dayCount` was non-null inside the branch that cast it, so a future refactor reordering this logic could silently reintroduce a null-as-number bug with no compiler warning. Fixed: replaced the boolean with `eligibleDayCount: number | null`, computed once and narrowed through directly — no cast needed.
- [x] [Review][Patch] `daysUntil`'s comment overstated why `Math.round` is needed [apps/mobile/src/app/(tabs)/index.tsx] — claimed both operands are "day-aligned... no fractional edge case to round away," but a DST transition between `today` and `target` can make the raw ms diff land a few minutes off a full day, so the rounding is load-bearing, not a formality. Fixed: corrected the comment.
- [x] [Review][Defer] `dayCount` (client-local-midnight date-diff) and `badgeStatus` (server-computed `subscriptionStatus`) aren't reconciled against the same clock [apps/mobile/src/app/(tabs)/index.tsx:359-361] — deferred, narrow and pre-existing in shape (the status label itself has always been server-computed while dates rendered client-side via `formatDateOnly`); a client with a skewed clock or near a day boundary in a different timezone than the server could see a day count that doesn't quite agree with the status label it's paired with. Self-corrects the next day; fixing it properly would mean having the server return the day count, out of scope for this craft-pass story.

Findings dismissed as noise (reviewed, no action): the whole-card per-status background/border wash being gone is this story's own deliberate AC #1 change, not a regression; the day-count i18n prefix/suffix-key split instead of `<Trans>` (and its consequent trailing-space locale strings) is this story's own deliberately-reasoned Dev Notes decision; zero unit-test coverage for the new date logic matches this app's established, disclosed no-test-runner convention; a malformed `expiryDate` falling back to the same pre-existing "Invalid Date" `formatDateOnly` behavior is not a new regression; three independent per-status `Record<BadgeStatus, …>` maps is a pre-existing pattern this diff extends, not new debt; unverified list-row visual spacing and the status card's lack of a pressed-state affordance are both left to the user's own established manual on-device QA convention.

## Dev Notes

### Status card icon/tint table (resolves an ambiguity neither epics.md nor DESIGN.md spells out per-status)

Only `grace_period`'s icon (`warning`) is named explicitly anywhere in the source docs (as "the existing... glyph, moved into the chip"). The other four statuses need an icon chosen — done here, not left to guesswork:

| `badgeStatus` | icon | tint | rationale |
|---|---|---|---|
| `active` | `check-circle` | `success` | matches the green "Active" signal |
| `expiring_soon` | `schedule` | `warning` | matches the orange "Expiring soon" signal; distinct glyph from `grace_period` so the two orange states still read as different urgency levels |
| `grace_period` | `warning` | `warning` | the pre-existing glyph, moved from inline text into the chip per AC #1 |
| `expired` | `error` | `danger` | matches the red "Membership expired" signal |
| `no_plan` | `info` | `neutral` | matches `STATUS_COLORS.no_plan`'s own muted/no-active-signal hex triad — resolved to `neutral` once Story 15.2's code review added that 6th `IconChip` tint (this table originally said `primary`, written before that tint existed; corrected by this story's own code review, 2026-09-02) |

All 5 glyph names confirmed present in the installed `@react-native-vector-icons/material-icons` glyphmap.

### The whole-card-tint → chip-only-tint change is real and deliberate

Today, `statusCard`'s entire background/border is colored per status (`statusColors.bg`/`.border`). `Card`'s `raised` variant (Story 15.2) has a **fixed** neutral background (`theme.surfaceElevated`) — it takes no per-status color parameter. The MA-09 mockup (line 593-597) shows one plain raised card regardless of status; the per-status color signal moves entirely onto the `IconChip` + the status label's own text color (which was always independently tinted, unchanged). This is a genuine, intentional visual change from what's shipped today, not an oversight to flag — confirmed by tracing `Card.tsx`'s actual (fixed, non-parameterized) `raised` implementation against the mock.

### `class` tint: DESIGN.md vs. epics.md disagree — DESIGN.md wins

DESIGN.md's List Item component spec (line 118): *"tint keyed to item type: check-in → `accent`, payment → `success`, class → `primary`"*. epics.md's own Story 15.3 AC text says *"class → `accent`"* instead. These are the only two sources for this exact mapping and they conflict — DESIGN.md is this project's single source of truth for exact color-token specs ("Visual specs only" is its own section header), while epics.md's AC prose has a track record of small transcription drift elsewhere in this project (e.g. the status-badge table's stale copy noted below). Ships as `primary`.

### Documentation drift found and deliberately not fixed (flagged, per this project's convention)

- **`Badge.tsx` is dead code.** `grep -rn "<Badge" apps/mobile/src` → zero matches anywhere in the app. DESIGN.md/EXPERIENCE.md both refer to a "Status Badge" as an existing, in-use component — it isn't; the status label has always been plain tinted `ThemedText`. DESIGN.md explicitly says Badge is "existing, unchanged" for this pass, so this story does not wire it up — out of scope, noted for whoever eventually picks it up.
- **EXPERIENCE.md's Status Badge States table** (line 629-637) still shows `expiring_soon`/`grace_period`'s "Additional text" as plain "Expires [date]" — pre-Epic-15 content not updated when the day-count framing bullet (line 623, Epic-15-tagged) was added. Same for the older narrative user-journey flows (lines 2411-2441, e.g. "Expire le [date]" for grace_period) — not updated either. The bullet + mockup are authoritative (this AC follows them); the table/narrative text are stale.
- **EXPERIENCE.md's Loading state spec** (line 646-649, skeleton rectangles) doesn't match the shipped implementation (one generic `ActivityIndicator`, no skeletons anywhere). AC #5 explicitly keeps loading state untouched — this story does not build skeleton UI; that's a separate, larger, unscoped piece of work if ever picked up.
- **The "My Workout Plan" section** (Story 13.3) isn't in EXPERIENCE.md's MA-09 mockup or Component list at all. AC #3 resolves this the same way Story 15.4's Dev Notes resolved an analogous gap (Profile's Body Profile row): keep its exact position/behavior, apply only the same visual-grouping treatment as its neighbors, not a new IA slot.

### Day-count i18n design (prefix/suffix split, not `Trans`)

This app has zero existing `<Trans>` usage anywhere (`grep -rln "Trans\b" apps/mobile/src` → none) — introducing it now for one sentence would be a new, unproven pattern for this codebase. Since RN's `<Text>` natively supports nested `<Text>` children with independent styling inline (no library needed), and this app only ever ships English/French (both put the numeral in the same mid-sentence position: "Expires in **12** days" / "Expire dans **12** jours"), a plain prefix/`statNumeral`/suffix split works cleanly and needs no new dependency. Pluralization reuses this file's own existing `_one`/`_other` convention (see `home.durationDays_one`/`_other`, already shipped) — pass `{ count: dayCount }` to `t()` for the suffix key even though the string itself doesn't interpolate `{{count}}`; i18next's pluralization triggers on the `count` option alone.

### Row-divider decision (Story 15.2 explicitly deferred this to whichever screen needs it first)

Reused the exact `borderTopWidth: 1` / `theme.border` / `paddingTop: Spacing.two` values the old bare `activityRow` style already used — familiar, low-risk, zero new visual language introduced. Applied via a plain wrapping `View` at this screen's call site (`index > 0 ? styles.rowDivider : undefined`), not inside `ListItem.tsx` itself, matching Story 15.2's explicit instruction not to bake grouping/divider logic into the primitive.

### Project Structure Notes

- Modified: `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/locales/en.json`, `apps/mobile/src/locales/fr.json`.
- No other files. This story is a pure consumer of Story 15.2's already-shipped `Card`/`IconChip`/`ListItem` — no changes to `apps/mobile/src/components/ui/**`.
- No database/migration/RLS/pgTAP surface. No new dependencies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 15: Mobile Experience Quality Pass / Story 15.3] — AC text and origin (see the `class` tint conflict note above)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/EXPERIENCE.md#MA-09 · Home] — full layout/mockup/component spec (lines 580-649), including the day-count bullet (line 623) and Status Badge States table (line 629, partially stale — see Dev Notes)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-gym_os-2026-07-04/DESIGN.md#Components] — List Item tint spec (line 118), the `class → primary` value this story ships
- [Source: apps/mobile/src/app/(tabs)/index.tsx] — full current implementation being modified; read in full during story creation, not assumed
- [Source: apps/mobile/src/app/onboarding/plan.tsx#formatDateOnly] — the local-midnight date-construction pattern `daysUntil` mirrors
- [Source: apps/mobile/src/locales/en.json:77-78,228-229] — `durationDays_one`/`_other` pluralization precedent this story's new keys follow
- [Source: 15-2-shared-component-library-*.md#`ListItem` does not own Card-wrapping or dividers] — the prior story's explicit deferral of the divider decision to this story
- [Source: apps/mobile/src/components/ui/Badge.tsx; grep -rn "<Badge" apps/mobile/src] — confirms Badge is dead code, not wired anywhere

## Change Log

- 2026-09-02: dev-story: implemented all 4 tasks. Status card converted to `Card variant="raised"` + leading `IconChip` (per-status icon/tint table, `grace_period`'s inline warning glyph moved into the chip); the previous per-status whole-card background wash is gone by design (Card's `raised` variant is fixed-neutral, per Story 15.2). Added day-count framing ("Expires in **12** days") for `expiring_soon`/`grace_period` via a new `daysUntil()` helper + 3 new prefix/suffix i18n keys (en/fr, `_one`/`_other` pluralized), with a `dayCount <= 0` fallback to the existing plain-date phrasing. Recent Activity/Upcoming Classes/Workout Plan sections converted to `ListItem` rows inside one `flat` Card per section, with a reused `rowDivider` style between stacked rows (index > 0); all existing `onPress`/navigation preserved exactly (Recent Activity rows keep per-row `onPress`, Workout Plan/Upcoming Classes rows stay non-interactive, matching today). Full regression clean: typecheck 0 errors across all 4 workspace packages, i18n key-parity clean (314 mobile keys, en/fr in parity). Status: ready-for-dev → review.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm --filter mobile typecheck` and `pnpm -r typecheck` (all 4 workspace packages) — both clean, 0 errors.
- `pnpm run check:i18n` — clean, `apps/mobile/src/locales: 314 keys, en/fr in parity` (up from 309 before this story's 5 new keys minus dropped duplication — net +5 base keys, `_one`/`_other` pairs counted individually by the checker).
- `git status --short apps/mobile/src` post-implementation: `(tabs)/index.tsx` + `locales/en.json` + `locales/fr.json` modified — matches this story's File List exactly; no other screens or `ui/` components touched.

### Completion Notes List

- **Status card redesign is a real visual change, not just a wrapper swap:** the per-status background color wash (today's shipped behavior) is gone — `Card`'s `raised` variant (Story 15.2) has a fixed neutral background, so the per-status signal now lives entirely in the leading `IconChip` + the status label's own existing text tint. This matches the MA-09 mockup and was called out explicitly in the story's own Dev Notes as deliberate, not a regression.
- **Icon/tint choices for `active`/`expiring_soon`/`expired`/`no_plan`** (only `grace_period`'s `warning` icon was inherited from existing code) implemented per the story's resolution table: `check-circle`/`success`, `schedule`/`warning`, `error`/`danger`, `info`/`neutral` respectively (`no_plan`'s tint corrected from `primary` to `neutral` by this story's own code review, 2026-09-02 — see Dev Notes table).
- **`class` tint resolved as `primary`**, per the story's explicit DESIGN.md-over-epics.md resolution (the two source docs disagreed; DESIGN.md's dedicated List Item spec was treated as authoritative).
- **Day-count edge case:** when the computed day count is `<= 0` (expiry today, or a data race before the status flips to `expired`), the code falls through to the pre-existing plain-date phrasing (`home.expiresOn`/`home.gracePeriodNote`) rather than showing "0 days" or a negative number — the fallback path was kept in the locale files rather than deleted, per the story's instruction.
- **Row dividers** implemented as a plain wrapping `View` (`styles.rowDivider`, reusing the exact old `activityRow` border/padding values) at the Home-screen call site for `index > 0` rows — `ListItem.tsx` itself was not modified, per Story 15.2's explicit deferral of this decision.
- **`Badge.tsx` still not wired up** (confirmed still zero usages) — this story's status label stays plain tinted `ThemedText`, unchanged from today, per the story's own explicit scope note.
- **Loading-state skeletons not built** — the single `ActivityIndicator` spinner is unchanged; EXPERIENCE.md's skeleton-rectangle spec remains an unaddressed, separate pre-existing gap (flagged in the story, not fixed here, per AC #5).
- **On-device visual verification:** not performed by this agent — deferred to the user's own manual QA per this project's established convention (does the day-count sentence read naturally in both EN/FR, does the new raised status card and the three flat-Card sections read as one coherent, consistent screen).

### File List

**Modified:**
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/locales/en.json`
- `apps/mobile/src/locales/fr.json`
