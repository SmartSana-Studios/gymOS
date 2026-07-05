---
name: GymOS
status: draft
created: 2026-07-04
updated: 2026-07-04
sources:
  - _bmad-output/planning-artifacts/prds/prd-gym_os-2026-06-20/prd.md
colors:
  primary: '#1B2A41'
  accent: '#E0971F'
  background: '#FAFAF7'
  # Per-gym override: gym.primary_color replaces accent on all member-facing surfaces
  # (header, buttons, accents, navigation highlights) after the gym branding cache loads.
  # The base GymOS shell (onboarding, auth screens) always uses the platform accent.
experience_spine: EXPERIENCE.md
---

## Brand & Style

GymOS is a white-label platform. The platform shell (onboarding, login, Super Admin) uses the three tokens above.
On authenticated member-facing surfaces the gym's `primary_color` replaces `accent` for interactive elements.
Admin dashboard uses `primary` as the sidebar/navigation color; `accent` for highlights and CTAs.

## Colors

Three platform tokens. All other visual decisions (typography, shadows, radius) are deferred to the UI framework
defaults and are not specified here — the experience spine governs behavior.

| Token | Hex | Use |
|---|---|---|
| primary | #1B2A41 | Sidebar background, nav text, headings |
| accent | #E0971F | Primary CTA buttons, active states, highlights; overridden by gym color on member surfaces |
| background | #FAFAF7 | Page/screen background |
