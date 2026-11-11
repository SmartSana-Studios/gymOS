---
name: GymOS Main Site
description: A confident gym-software landing: navy hero and bands, cool white sections, orange as the one accent, big Bricolage type.
colors:
  bg: "#F6F8FB"
  surface: "#FFFFFF"
  line: "#E1E7EF"
  line-strong: "#7F8FA6"
  ink: "#0F1B2D"
  body: "#3A485C"
  muted: "#59687C"
  navy: "#1B2A41"
  navy-deep: "#0F1B2D"
  on-navy: "#FFFFFF"
  on-navy-muted: "#A9B7CB"
  accent: "#E0971F"
  accent-hover: "#EBA73A"
  accent-ink: "#9A5200"
  accent-display: "#BA6500"
  accent-tint: "#FDF1DC"
  selection: "#F6D9A0"
typography:
  display-xl:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  display-xl-tablet:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "4rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  display-xl-mobile:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  display-lg:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.028em"
  display-lg-mobile:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.028em"
  display-md:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  display-md-mobile:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  numeral:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "5.5rem"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body-lg:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  focus: "4px"
  logo: "9px"
  control: "12px"
  card: "16px"
  pill: "999px"
spacing:
  gutter-mobile: "20px"
  gutter: "32px"
  section-mobile: "64px"
  section: "96px"
  stack: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.navy-deep}"
    rounded: "{rounded.control}"
    padding: "12px 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 24px"
    height: "48px"
  button-store:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.control}"
    padding: "12px 24px"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  chip-tint:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
---

# Design System: GymOS Main Site

## Overview

**Creative North Star: "The Daylight Front Desk"** *(proposed by the build; the owner has not named it)*. A clean, confident gym-software landing, the category standard played straight at the craft level of Glofox, Mindbody, Wodify, Paystack and Flutterwave. It reads on a phone in daylight: light content sections, bold navy and orange bands at page scale, big type, and photographs that run edge to edge. No quirk, no gradients, glows or blur.

Key characteristics:
- **Page-scale colour fields.** Navy hero, orange stats band, navy features field, orange member-app band, navy close; light sections between them.
- **One accent.** Orange is a fill with navy text on it; on navy it is also bright headline colour; on light grounds, as text, it takes a darker contrast-safe value.
- **Big, tight display type** (Bricolage Grotesque 800) over calm Figtree body text.
- **Photography is plain**: edge to edge, no scrim, never carrying text.
- **Static by default**: one authored moment (the hero scanner sweep), no scroll reveals, no count-up.

## Colors

Cool neutrals tinted toward the brand navy plus the GymOS orange `#E0971F`, shared with the dashboard and the member app. Text selection uses a pale orange (`{colors.selection}`) with ink text.

- **Light sections** alternate `{colors.bg}` and `{colors.surface}`. Hairlines (`{colors.line}`) are decorative only; interactive borders use `{colors.line-strong}` (3.3:1 on white).
- **Navy fields** (`{colors.navy-deep}` for header, hero, features and footer; `{colors.navy}` for the phone screen and store buttons) carry white text, `{colors.on-navy-muted}` for secondary text (8.50:1 on navy-deep), and `{colors.accent}` for the headline fragment, section label and icons (7.09:1 on navy-deep).
- **Orange fields** (`{colors.accent}`) carry navy text only (7.09:1): the stats band and the member-app band.
- **Text on light:** ink for headings, body for paragraphs (9.29:1 on white), muted for secondary text (5.68:1 on white).
- **Orange as text on light grounds:** `{colors.accent-ink}` for small text (5.86:1 on white), `{colors.accent-display}` for large headline fragments and step numerals only (3.99:1 on the page ground). `{colors.accent}` itself is 2.44:1 on white and is never text there.

## Typography

Bricolage Grotesque (800, 700 for the wordmark) for headlines, numerals and figures; Figtree for everything else. Both are self-hosted by `next/font` at build time and carry French accents.

- **Display XL** is the home headline: 40px on a phone, 60px at tablet, 64px from 1024px, 72px from 1280px, tight tracking, final phrase in the accent colour.
- **Display LG** is every section heading (32px on a phone up to 52px); **Display MD** is the pillar titles, early-access title and the close on small screens.
- **Numeral** (88px) marks the three steps; stats use 48px (60px at 1024px and up). **Title** is the proof pull-quotes and step titles.
- **Body** is 16px, **Body LG** 18px for intro paragraphs; both on a 1.625 line height. Headings use `text-wrap: balance`, paragraphs `pretty`. Centred paragraphs cap near 34rem.
- **Label** is 15px semibold, used for buttons, navigation and the small section label above headings.

## Layout

- **Container** is 76rem with a 20px gutter on phones and 32px from 640px. Bands are 80px tall padding on phones and up to 128px on large screens.
- **Hero:** navy field. Under 1280px the photo is a band the check-in panel overlaps; from 1280px the photo owns the right 45% edge to edge and the panel straddles its left seam. Text sits only on navy.
- **Header:** solid navy, continuous with the hero. The full navigation appears from 1280px; below that a menu button opens a panel. The contact action is an icon button under 768px and a labelled button above.
- **Pillars** are three full-width rows: photo edge to edge on one half, text on the other, alternating sides and alternating white and ground backgrounds. **About** is the same split.
- **Features** are a ruled list on a navy field (a top hairline per item, a bare orange line icon). **Proof** is three columns divided by hairlines. **Steps** are a real sequence with large numerals.
- Tap targets are at least 44px; the page has no horizontal scroll at 320px in either language.

## Elevation & Depth

Flat, with one soft offset shadow where an object lifts off the page. A card never carries both a border and a shadow.

- **Card shadow:** `0 1px 2px rgba(15,27,45,.06), 0 16px 32px -16px rgba(15,27,45,.22)` for the early-access card and the sample chips.
- **Panel shadow:** `0 2px 4px rgba(15,27,45,.06), 0 32px 56px -24px rgba(15,27,45,.32)` for the hero check-in panel and the phone frame.
- No glow halos, no backdrop blur, no gradient text, no scrim on photographs.

## Shapes

Radius 16 for cards and panels, 12 for buttons and controls, 9 for the logo tile, 4 for the keyboard focus ring (with a 2px navy outline, white on navy fields), full radius only for small chips (status and sample labels). Photographs in the pillar rows and the About split are rectangles that meet the viewport edge.

## Components

- **Primary button:** orange fill, navy text, 48px tall, 12px radius; hover lightens to `{colors.accent-hover}`. The contact action is the only filled orange control in a viewport (except on the orange bands, where the buttons are navy).
- **On-navy ghost button:** transparent, light border, white text; **ghost button** on light: white fill, `{colors.line-strong}` border, ink text.
- **Header:** navy, 68px, white logo tile and wordmark left, navigation centre (from 1280px), language, Owner login and contact right.
- **Hero check-in panel:** decorative and `aria-hidden`; a scanner square with orange corner brackets, two sample check-ins, and (from 1280px) two sample chips. The scan line sweeps once and the rows settle in, only under `prefers-reduced-motion: no-preference`.
- **Store buttons:** navy-filled, white text and glyph, self-drawn rather than the official badges; they sit on the orange band.
- **Phone frame:** deep-navy device with a member QR pass on screen (the same illustrative, non-encodable code as the hero).
- **Closing band and footer:** navy, white text, orange primary button; focus rings flip to white inside `.on-navy`.

## Do's and Don'ts

Do:
- Use `{colors.accent}` as a fill with navy text (or as bright text on navy); use the darker orange values for text on light grounds.
- Let colour fields own whole bands; keep photographs plain and edge to edge.
- Keep every sentence in `lib/copy.ts` in both languages, and check French at 320px.
- Keep content visible by default; animation only decorates and only runs under `motion-safe`.

Don't:
- Don't add gradients, glows, backdrop blur or floating animated chips.
- Don't build a section as a grid of identical icon-heading-text boxes.
- Don't add scroll-reveal fades to every section or a count-up on the stats.
- Don't put text on a photograph.
- Don't invent customers, counts or testimonials; the Testimonials section stays empty until a real, permitted quote exists.
- Don't put a border and a shadow on the same card.
