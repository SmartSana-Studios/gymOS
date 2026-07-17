/** Platform brand tokens (DESIGN.md, UX-DR1). The onboarding flow is part
 * of the platform shell (not an authenticated, gym-branded surface), so it
 * always uses the platform `accent`, never a per-gym `primary_color`
 * override -- that override only applies to authenticated member-facing
 * surfaces once a gym context exists (post-onboarding), which this story
 * doesn't reach. */
export const Brand = {
  primary: '#1B2A41',
  accent: '#E0971F',
  background: '#FAFAF7',
} as const;
