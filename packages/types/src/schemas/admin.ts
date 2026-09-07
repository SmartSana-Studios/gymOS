import { z } from "zod";

// Story 1.16: In-app Admins page -- create-or-promote-to-Super-Admin by
// email. New file, not added to gym.ts -- this isn't gym-domain, matching
// staff.ts's own precedent of a dedicated file per non-gym domain.
//
// `currentPassword` (post-review addition, 2026-09-07, requested during
// manual testing): step-up re-authentication -- the acting Super Admin must
// re-enter their OWN account password immediately before this action mints
// the platform's highest privilege. This is a stronger safeguard than AC
// #5's original named-target-button-only design and supersedes it; the
// Server Action re-verifies this password via `signInWithPassword` against
// the caller's own email before proceeding (see admins/actions.ts).
export const createOrPromoteSuperAdminSchema = z.object({
  // Trimmed before the email-format check (code review follow-up) -- a
  // pasted address with leading/trailing whitespace previously failed
  // z.email() with a generic "invalid email" message even though the UI's
  // own trimmed copy (used only for the submit button's label) would have
  // been valid.
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.email("Enter a valid email address"),
  ),
  currentPassword: z.string().min(1, "Enter your password to confirm"),
});

export type CreateOrPromoteSuperAdminInput = z.infer<typeof createOrPromoteSuperAdminSchema>;
