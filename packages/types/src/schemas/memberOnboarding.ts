import { z } from "zod";

// Story 2.6: Member App -- Phone/OTP Onboarding Through Profile Setup.
//
// E.164 phone regex kept local per this project's established "no shared
// cross-file consts" convention (matches gym.ts/plan.ts/tier.ts/member.ts's
// own precedent, each redeclaring the same pattern rather than importing a
// shared one) -- identical bounds to member.ts's e164Phone and
// supabase/functions/send-sms-hook/index.ts's E164_DIGITS (/^\+[1-9]\d{7,14}$/,
// 8-15 total digits).
const e164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");

// MA-02: submit-time validation only (UX-DR11), not per-keystroke.
export const phoneEntrySchema = z.object({
  phone: e164Phone,
});

export type PhoneEntryInput = z.infer<typeof phoneEntrySchema>;

// MA-03: six digit boxes rendered as one logical input; auto-submits once
// all six are filled (paste or type) -- this schema is what gates that
// auto-submit, not a visible "Verify" button.
export const otpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export type OtpCodeInput = z.infer<typeof otpCodeSchema>;

// MA-05: name required (>=1 non-space character, EXPERIENCE.md's own
// Continue-enablement rule), photo optional. Writes to users.display_name /
// users.photo_url, never members.name / members.photo_url (Story 2.6 Scope
// Note #2).
export const profileSetupSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(100, "Name is too long"),
  photoUrl: z.url("Enter a valid URL").max(2048, "URL is too long").optional().nullable(),
});

export type ProfileSetupInput = z.infer<typeof profileSetupSchema>;

// MA-06/MA-08: goal is one of four fixed options (EXPERIENCE.md), captured
// for the assigned coach (FR-054). Writes to members.goal, not users --
// gym-membership-level, not account-level (Story 2.7 Scope Note #2).
export const memberGoalSchema = z.enum(["lose_weight", "build_muscle", "improve_fitness", "general_wellness"]);

export type MemberGoalInput = z.infer<typeof memberGoalSchema>;

// MA-07/MA-08: experience level is one of three fixed options
// (EXPERIENCE.md). Writes to members.experience_level.
export const experienceLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);

export type ExperienceLevelInput = z.infer<typeof experienceLevelSchema>;
