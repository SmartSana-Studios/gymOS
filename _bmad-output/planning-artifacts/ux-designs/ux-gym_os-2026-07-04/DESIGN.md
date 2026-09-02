---
name: GymOS
status: final
created: 2026-07-04
updated: 2026-09-02
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
colors:
  primary: '#1B2A41'
  accent: '#E0971F'
  background: '#FAFAF7'
  # Per-gym override: gym.primary_color replaces accent on all member-facing surfaces
  # (header, buttons, accents, navigation highlights) after the gym branding cache loads.
  # The base GymOS shell (onboarding, auth screens) always uses the platform accent.
  success: '#1E8E3E'
  warning: '#D97706'
  danger: '#DC2626'
  neutral: '#6B7280'
  # Status-semantic tokens (added V1.5, backfilled for V1.0 usage). Fixed platform-wide —
  # unlike accent, these never take the per-gym override, so a status badge means the same
  # thing regardless of which gym's branding is active. Used by every status badge, the
  # front-desk alert panel, check-in result overlays, and the V1.5 progress trend chart line.
experience_spine: EXPERIENCE.md
typography:
  family: Barlow
  weights: [400, 500, 600, 700, 800]
rounded:
  chip: 8
  card: 16
  hero: 24
  pill: 999
spacing:
  half: 2
  one: 4
  two: 8
  three: 16
  four: 24
  five: 32
  six: 64
components:
  card:
    flat: { radius: 16, border: 1, padding: 16 }
    raised: { radius: 16, border: 0, shadowOpacity: 0.24, shadowRadius: 8, shadowOffsetY: 4, androidElevation: 4 }
  iconChip: { size: 36, radius: 8, border: 1 }
  statNumeral: { fontFamily: Barlow_800ExtraBold, fontSize: 32, lineHeight: 36 }
---

## Brand & Style

GymOS is a white-label platform. The platform shell (onboarding, login, Super Admin) uses the three tokens above.
On authenticated member-facing surfaces the gym's `primary_color` replaces `accent` for interactive elements.
Admin dashboard uses `primary` as the sidebar/navigation color; `accent` for highlights and CTAs.

**Member App is dark-themed** (`apps/mobile/src/constants/theme.ts` `dark` palette — navy-tinted near-black `#0A0F17` background, `#141F30` surface, `Brand.primary` for elevated surfaces). This was already correct going into the *Epic 15 UX pass* (Story 8.3); it is not being revisited. What Epic 15 fixes is craft on top of that foundation: elevation, iconography, and card/list treatment that were never fully specified (see Components below) — diagnosed by comparing shipped screens against `apps/mobile/src/app/(tabs)/index.tsx` and reference craft in `imports/gymnation-ui-kit-*.png` (inspiration only — a single-brand kit; GymOS stays icon + data-forward rather than photography-heavy, since per-gym stock photography would look generic/fake across tenants — see `.memlog.md`).

**Icon & Launch identity.** The real GymOS mark is the orange bar-glyph + wordmark in `apps/dashboard/public/gymos-logo-full-white.webp` (`accent` orange "OS" + bar glyph, white "Gym"). `apps/mobile`'s icon is unbranded Expo-starter default across all three surfaces Expo (SDK 57) actually uses — `icon.png`, the iOS `expo.icon` Icon Composer bundle (`assets/expo.icon/` — generic Expo-blue gradient fill + "expo-symbol" layer), and `android.adaptiveIcon` (its own separate `backgroundColor: #E6F4FE`) — plus `splash-icon.png` and the splash `backgroundColor` (`#208AEF`). None of this was ever a gym_os design decision — all leftover scaffolding defaults. Fix: splash `backgroundColor` → the mobile dark theme's `background` (`#0A0F17`); every icon surface's fill/background → `primary` (`#1B2A41`); every icon surface's mark → the bar-glyph cropped from the existing wordmark asset, rendered in `accent` orange. No new brand design is needed — this is asset production from an asset that already exists (see `EXPERIENCE.md`'s App Launch section and epics.md Story 15.1 for the full three-surface breakdown).

## Colors

Three platform tokens. All other visual decisions (typography, shadows, radius) are deferred to the UI framework
defaults and are not specified here — the experience spine governs behavior.

| Token | Hex | Use |
|---|---|---|
| primary | #1B2A41 | Sidebar background, nav text, headings |
| accent | #E0971F | Primary CTA buttons, active states, highlights; overridden by gym color on member surfaces |
| background | #FAFAF7 | Page/screen background |
| success | #1E8E3E | Status badges (active), success toasts, check-in success overlay, positive progress-trend deltas |
| warning | #D97706 | Status badges (expiring_soon, grace_period, pending_activation), front-desk grace alert, "already checked in" / "wrong QR" overlays, quiet-gym/reminder-adjacent warning icons |
| danger | #DC2626 | Status badges (expired, suspended), front-desk denied alert, check-in denied overlay, destructive-action confirmations |
| neutral | #6B7280 | Status badges with no active signal (no plan, deactivated), disabled states, secondary/muted text on status rows |

**Fixed vs. per-gym color:** `accent` is the only token a gym's own branding ever overrides (member-facing surfaces, after the branding cache loads — see frontmatter note). `primary`, `background`, and all four status-semantic tokens (`success`/`warning`/`danger`/`neutral`) are platform-fixed and never change per gym — a red badge means "expired" the same way at every gym, regardless of that gym's brand color.

## Typography

Barlow, app-wide (Member App; Admin/Super Admin dashboards use system-ui per platform default — unchanged). Weight carries the hierarchy, not size alone — this is what gives GymOS its "bold condensed-header" identity rather than a generic system-font feel. Already shipped (Story 8.3); documented here for the first time as part of Epic 15's UX pass.

| Style | Family / Weight | Size / Line | Case | Use |
|---|---|---|---|---|
| title | Barlow ExtraBold (800) | 40 / 46 | UPPERCASE, +0.5 tracking | Screen-level headlines (onboarding, empty-state heroes) |
| subtitle | Barlow Bold (700) | 26 / 32 | UPPERCASE, +0.5 tracking | Section headers, card titles |
| statNumeral *(new)* | Barlow ExtraBold (800) | 32 / 36 | As-typed, tabular figures | Bold standalone numbers — see Stat Tile below. Never uppercase/letter-spaced; numerals don't take a case |
| default | Barlow Regular (400) | 16 / 24 | Sentence case | Body copy |
| smallBold | Barlow SemiBold (600) | 14 / 20 | Sentence case | List item titles, button labels, emphasis within body |
| small | Barlow Medium (500) | 14 / 20 | Sentence case | Secondary/meta text, captions |

## Elevation & Depth

Two card elevation levels — this is the primary fix for the "flat" finding (`.memlog.md`): every card previously used `flat` regardless of whether it was actionable content or a passive container, and shadow was never defined at all.

| Level | Use | Spec |
|---|---|---|
| `flat` | Passive containers grouping related content (status info, settings sections) — depth via 1px border only, no shadow | `border: 1px solid {colors.border}`, `radius: 16` |
| `raised` | Actionable/tappable cards the user is meant to notice first (primary status card, list items promoted from bare rows) — border replaced by shadow so the card visually lifts off the dark background | iOS: `shadowColor: #000, shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: {0,4}`. Android: `elevation: 4`. No border. |

`raised` only reads correctly against the dark theme's near-black background — do not apply it to the light-mode/platform-shell tokens.

## Shapes

Radius scale (`rounded` in frontmatter):

| Token | Value | Use |
|---|---|---|
| `chip` | 8 | Icon chips, small inline elements |
| `card` | 16 | Card (flat and raised), status card — existing, unchanged |
| `hero` | 24 | Large hero/header modules only (splash mark container, if used) |
| `pill` | 999 | Buttons, Badge — existing, unchanged |

## Components

Visual specs only — behavior lives in `EXPERIENCE.md`'s Member App Component Library.

**Card** (`apps/mobile/src/components/ui/Card.tsx`) — existing `flat`/`elevated` background-swap prop is renamed in behavior (not code necessarily) to carry the `raised` elevation spec above; `elevated` today only swaps background color and must gain the shadow/elevation styling to actually mean something visually.

**Icon Chip** *(new)* — 36×36, radius `chip` (8) or fully circular per context, 1px `border` token, centered icon glyph (MaterialIcons, already the app's icon set — see `apps/mobile/src/app/(tabs)/index.tsx`'s existing `warning` usage). Replaces bare-glyph or no-glyph treatment on list rows and section headers.

**List Item** *(new)* — leading Icon Chip (glyph + tint keyed to item type: check-in → `accent`, payment → `success`, class → `primary`) + title/timestamp text, the whole row living inside a `flat` Card instead of a bare `borderTopWidth: 1` divider row. Replaces `activityRow`'s current bare-row treatment.

**Stat Tile** *(new)* — `statNumeral` + a `small` caption beneath, inside a `raised` Card. Used only for data the app already has (e.g., days-until-expiry as a number, not just prose) — this pass does not add new backend data to support new stats.

**Status Badge** (`apps/mobile/src/components/ui/Badge.tsx`) — pill, `border: 1`, `radius: pill`, `paddingHorizontal: 10` (existing, unchanged; the `Spacing.two`=8 mismatch flagged in `deferred-work.md` is accepted as-is, not a target of this pass). Colors per status — see `EXPERIENCE.md` MA-09 Status Badge States table.

**Button** (`apps/mobile/src/components/ui/Button.tsx`) — existing pill (`radius: pill`, height 52) primary/secondary treatment is correct and unchanged by this pass.
