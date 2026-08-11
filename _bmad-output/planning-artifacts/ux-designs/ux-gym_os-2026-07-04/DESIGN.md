---
name: GymOS
status: final
created: 2026-07-04
updated: 2026-08-11
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
| success | #1E8E3E | Status badges (active), success toasts, check-in success overlay, positive progress-trend deltas |
| warning | #D97706 | Status badges (expiring_soon, grace_period, pending_activation), front-desk grace alert, "already checked in" / "wrong QR" overlays, quiet-gym/reminder-adjacent warning icons |
| danger | #DC2626 | Status badges (expired, suspended), front-desk denied alert, check-in denied overlay, destructive-action confirmations |
| neutral | #6B7280 | Status badges with no active signal (no plan, deactivated), disabled states, secondary/muted text on status rows |

**Fixed vs. per-gym color:** `accent` is the only token a gym's own branding ever overrides (member-facing surfaces, after the branding cache loads — see frontmatter note). `primary`, `background`, and all four status-semantic tokens (`success`/`warning`/`danger`/`neutral`) are platform-fixed and never change per gym — a red badge means "expired" the same way at every gym, regardless of that gym's brand color.
