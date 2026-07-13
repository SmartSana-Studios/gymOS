import { z } from "zod";

// AD-01 login form. Client-side submit-time feedback only (UX-DR11: validate
// on submit only) -- the actual credential check is Supabase Auth's
// signInWithPassword, which is the true source of truth for "invalid
// credentials"; this schema only catches empty/malformed input before that
// call fires.
export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;
