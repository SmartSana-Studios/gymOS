---
name: GymOS
status: final
created: 2026-07-04
updated: 2026-11-08
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-gym_os-2026-08-11/ARCHITECTURE-SPINE.md
  - _bmad-output/implementation-artifacts/spec-24-8-publish-gate-snapshot-and-unpublish.md
  - _bmad-output/implementation-artifacts/deferred-work.md
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
  info: '#2563EB'
  # V1.6 action-required / pending status token, platform-fixed like the four above.
  # Used for the session-required check-in overlay and front-desk alert, the offline
  # "will be verified" overlay and post-sync notice, and the guest "no paid session" badge.
  # Contrast: white text on it 5.17:1; as text on #FFFFFF 5.17:1, on #FAFAF7 4.94:1 (AA body);
  # on mobile dark #0A0F17 3.72:1 (AA large text / UI only, same class as danger at 3.98:1).
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
  loyaltyProgress: { numeral: statNumeral, segmentHeight: 8, segmentGap: 4, segmentRadius: 999, maxSegments: 12, fill: accent, track: border } # V1.6
  sessionChip: { iconChip: iconChip, paidTint: accent, freeTint: success, dormantTint: neutral } # V1.6
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
| info *(V1.6)* | #2563EB | Action-required or pending-verification states: "Pay for your session" and "Check-in saved — will be verified" overlays, session-required front-desk alert, post-sync denial notice, guest "no paid session" badge, AD-18 refusal row border, AD-09 session-refund notice border. A recoverable step, not a failure, so not `danger`; and not `warning`, which on the alert panel means "entry allowed". Contrast: 5.17:1 with white text, 4.94:1 as text on `#FAFAF7` |

**Fixed vs. per-gym color:** `accent` is the only token a gym's own branding ever overrides (member-facing surfaces, after the branding cache loads — see frontmatter note). `primary`, `background`, and all five status-semantic tokens (`success`/`warning`/`danger`/`neutral`/`info`) are platform-fixed and never change per gym — a red badge means "expired" the same way at every gym, regardless of that gym's brand color.

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

**Loyalty Progress** *(V1.6, `components.loyaltyProgress`)* — "3 / 5" in `statNumeral`, then a row of N pill segments (8px tall, 4px gap, `radius: pill`). Filled segments are `accent` (the gym colour on member surfaces); empty segments are the `border` colour. Above 12 segments, render one continuous 8px pill bar filled to n/N instead. A `small` caption sits beneath. It lives inside a `flat` Card (the Rewards card), never `raised`.

**Session Chip** *(V1.6, `components.sessionChip`)* — a List Item whose leading Icon Chip is keyed to the session source: paid → ticket glyph (`confirmation_number`) in `accent`; free → gift glyph (`card_giftcard`) in `success`; dormant free → same gift glyph in `neutral`. The title is in `smallBold` and the trailing "use by [date]" in `small`.

**Status Badge — V1.6 guest values** — "Pay per session" in `neutral`, "Today covered" in `success`, and the no-session state in `info`. Same pill spec as above, with no new shape.

**Check-in result overlay — `info` variant** *(V1.6)* — the same full-screen overlay as success/denied/amber, filled with `info` and white text and icon. Icons: `confirmation_number` (Pay for your session) and `hourglass_top` (will be verified).

**Front-desk alert — session-required variant** *(V1.6, dashboard)* — the same row anatomy as the grace and denied variants, with an `info` status dot and header text. It uses system-ui like the rest of the dashboard.

**Category label** *(V1.6, dashboard only)* — plain text in the table cell or field. No chip and no colour: the category is descriptive data (FR-172) and must not look like a status.

## Public Page Templates

*(V1.7, decided 2026-10-15.)* A gym's public page is rendered by a template chosen from a growing library; GymOS generates templates over time. This section holds the visual rules every template shares. Behavior, section order and the conformance rules are in EXPERIENCE.md PS-01 "Template contract".

| Rule | Value |
|---|---|
| Variable color | `gym.primary_color` only, replacing `colors.accent` for actions and one accent rule; `primary`, `background`, `success`, `warning`, `danger`, `neutral`, `info` stay platform-fixed |
| Backgrounds | Template choice: platform `{colors.background}` (light) or the member-app dark palette (`#0A0F17`, surface `#141F30`); the page declares one |
| Type | Barlow 700 and 800 from the self-hosted allowlist for headings and prices, system sans-serif for body; hierarchy by weight, uppercase and tracking only for headings, as in Typography above |
| Shape | `rounded.card` 16 for cards, `rounded.pill` for actions, `rounded.chip` 8 for chips; no hero radius |
| Spacing | The `spacing` scale only; 16 px page gutter. Gym pages are for mobile, tablet and desktop *(product owner, 2026-11-08, supersedes "one column at every width up to 640, optional two columns above")*. Three breakpoints, `[ASSUMPTION — exact numbers]`: **mobile** under 641 px, one column; **tablet** 641 to 1023 px, content column up to 800 px; **desktop** 1024 px and up, content column up to 1120 px. Placement per breakpoint is in EXPERIENCE.md PS-01 "Layout by breakpoint"; the DOM and reading order never change |
| Banner *(2026-11-08)* | `[ASSUMPTION]` Edge to edge under 641 px (no radius, as in the first mock); from 641 px rounded (`rounded.card` 16) inside the content column, with the same gutter. Height is reserved so nothing jumps |
| Header card *(2026-11-08)* | `[ASSUMPTION]` The header card (logo, name, category chip, language link) overlaps the lower edge of the banner at every width; under 641 px it spans the column, from 641 px it stays inside the content column, and at 1024 px and up it sits beside the contact card on the same overlap line. The overlap never covers text of the banner (the banner is decorative) |
| Contact card, desktop *(2026-11-08)* | `[ASSUMPTION]` From 1024 px a contact card sits beside the header card, overlapping the banner the same way. It holds Call, WhatsApp and Directions as tiles in a row, and the phone number as visible text (a `tel:` link may not open a call on a desktop). Under 1024 px the actions are tiles in the content column under the header card (stacked full width under 641 px, in a row from 641 px). Tiles stay at least 44 px tall at every width |
| Motion | None required; no animation that depends on script. Respect `prefers-reduced-motion` for any CSS transition |
| Imagery | Banner and gallery images come from the opaque media origin; every image has a text alternative from the gym's description or is marked decorative |
| Language link *(2026-11-08)* | When the page has two complete languages (each supported content language whose required fields are filled), one plain text link to the other language sits in the header or the footer, in the **target** language's own name ("Français" on the English page, "English" on the French page) with `hreflang` and `lang` of its target. **With more than two complete languages the link becomes a menu** of the same plain links, each entry in its own language's name, the current language marked and not a link; it needs no script (a native disclosure or an inline list). **No flags**, ever: a flag stands for a country, not a language. Styled as a text link (or a text menu), never a pill or button (it is navigation, not a contact action), each entry at least 44 px tall, in the body text colour with an underline, so it does not compete with Call, WhatsApp and Directions. With only one complete language, no link, no menu and no placeholder. Tokens are unchanged |
| `lang` attribute *(2026-11-08)* | `<html lang>` is the language shown. Any block of gym-entered content that is shown in another language (a fallback because the chosen language was empty) carries its own `lang` for that block. Chrome strings (section headings, labels, buttons) follow the language shown. Typography does not change by language |

**Classic template (first real template)** `[ASSUMPTION — name]` *(product owner, 2026-11-08; redesigned 2026-11-10 in story 24.13 after the owner judged the first card design "horrible" in the browser pass, with two fitness template kits as references; still no HTML mock, this table is the design)*. Bold and photographic: a full-bleed hero, light content bands under a heavy uppercase heading, one dark band for the visit. Placement per breakpoint is EXPERIENCE.md PS-01 "Layout by breakpoint". The DOM, the ten sections and their order are unchanged.

| Element | Specification |
|---|---|
| Surface | Page `#F5F5F1`; Plans band white with a hairline `#E3E1DA`; hero, Visit band and footer ink `#121B2B`; Services panel `#1B2A41`. No shadows. Sharp corners: 6 px on buttons, plan cards, media and the map tile |
| Hero | Full width, 560 px tall (640 on desktop; on a short phone, the screen height minus 24 px). The banner fills it under a dark gradient (about 72% at the top, 62% mid, 93% at the foot) so white text reads on any photo; with no banner the hero is a plain ink field with an 8 px bar in the gym fill at the bottom right. Inside: logo (56 px circle, ringed in the gym fill) and the language link in a top row; at the foot the eyebrow, the gym name and the contact actions |
| Type | Headings Barlow 800 uppercase: gym name `clamp(36px, 11vw, 76px)`, line 0.98, at most 16 characters wide; section headings `clamp(28px, 6vw, 40px)`. Eyebrow (category · city) Barlow 700 14 px, uppercase, letter-spaced. Plan name Barlow 700 18 px uppercase, price Barlow 800 up to 44 px with tabular numerals. Body system sans 16/1.6 (17 for About), measure up to 62 characters |
| Heading mark | A 48 px by 4 px bar in the gym fill above every section heading; a 36 px bar before the eyebrow |
| Contact actions | In the hero, under the name. Three buttons, 52 px tall, icon left of an uppercase Barlow label, white 2 px outline; Call filled with the gym fill (text in the on-gym color), WhatsApp and Directions transparent on a dark scrim. Numbers as white text under the buttons |
| About and Services | About on the page color, large text. Services in a dark panel beside it, one line per item with a filled round check in the gym fill |
| Plans | White band, one card per plan with a 5 px top edge in the gym fill: name, large price with its currency code, details as a checked list (type, interval, duration) |
| Visit band | One dark band holding Hours and Location side by side. Hours: one row per day, uppercase day on the left, times right, hairlines; closed days read "Closed". Location: the drawn map tile (pin in the gym fill), address, and an outlined "Open the map" button (omitted with no map position) |
| Gallery | Sharp images; on mobile the first is wide and the rest in two columns; on desktop four columns and, with three or more images, the first spans two columns and two rows |
| Repeat action | A full-width band in the gym fill: the gym name, then Call as a dark button (centred, at least 280 px wide) |
| Footer | Ink band; "Report this page" and the GymOS link in white |
| Gym color use | Fill only: the accent bars, the Call button, the check marks, the logo ring, the map pin, the hero bar and the repeat band. Text on the fill uses the on-gym color; no text is ever the gym color itself, so contrast never depends on it. The Call button also carries a white outline so a near-black gym color stays visible on the dark hero |
| Contrast rule `[ASSUMPTION]` | The server-side renderer (no script) computes the text color on a gym-color fill: white or ink, whichever reaches 4.5:1 on the gym color, else the platform accent pairing; it supplies the result to the template as an on-gym color (`--on-gym`) |

**Seed templates** (not alternatives; the first two of the library):

| Seed | Character | Mock |
|---|---|---|
| A, dark | Member-app echo: navy-black, uppercase headings, card sections, gym color on the three action buttons | `mockups/template-seed-a-dark.html` |
| B, light | Plain and fast: light background, high contrast, one accent rule, hairline rows | `mockups/template-seed-b-light.html` |

The mocks are references for the seed templates; if a mock and this spine disagree, the spine wins.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Keep status colours platform-fixed (`success`/`warning`/`danger`/`neutral`/`info`) so a colour means the same thing at every gym | Let a gym's `primary_color` tint any status badge, alert, or check-in overlay |
| Use `info` for a recoverable "act now" state (pay for a session, wait for verification) | Use `danger` for session-required. Red means an expired membership, and a guest who needs to pay is not expired |
| Pair every status colour with a label and an icon | Signal session-required, pending verification, or a reward by colour alone |
| Keep one `raised` card per screen (Home: the status card) | Make the Rewards card `raised` to make it "pop" |
| Show loyalty progress as the plain "n / N" numeral plus segments | Add confetti, badges, or celebratory animation to a reward. The tone stays factual (Voice and Tone) |
| Show category as plain text | Give categories colours, icons, or chips that read as status |
