import { z } from "zod";

// Matches the `gym_status` Postgres enum (0001_extensions_and_enums.sql) exactly.
export const gymStatusSchema = z.enum(["active", "suspended", "deactivated"]);

// E.164: leading '+', country code, up to 15 digits total, no spaces/punctuation.
const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");

// Single source of truth for the Create Gym form (SA-04), consumed client-side
// (submit-time feedback) and server-side (createGym Server Action, which never
// trusts client input) per architecture's Process Patterns.
//
// `ownerEmail` is not part of SA-04's literal mockup (Gym Name / Owner Name /
// Owner Phone / Tier / Status only) — added because the owner's account is
// authenticated via Supabase email+password (matching the already-scaffolded
// AD-01/SA-01 login forms), which has no email-less path. See story 1-5's Dev
// Notes → Open Question 2.
export const createGymSchema = z.object({
  gymName: z.string().trim().min(1, "Gym name is required"),
  ownerName: z.string().trim().min(1, "Owner name is required"),
  ownerPhone: e164Phone,
  ownerEmail: z.email("Enter a valid email address"),
  tierId: z.uuid("Select a subscription tier"),
  status: gymStatusSchema.default("active"),
});

export type CreateGymInput = z.infer<typeof createGymSchema>;

// Shared minimum length for every free-text audit "reason" field in this
// schema file (gymStatusChangeSchema, escalateGymAccessSchema below) --
// factored into one constant so the length policy can't drift between them
// while each still keeps its own action-specific error copy.
const REASON_MIN_LENGTH = 5;

// Story 1.6: suspend/deactivate/reinstate all require a reason (AC #3,
// audit-logged). The target status isn't part of this schema -- it's implied
// by which Server Action is called (suspendGym/deactivateGym/reinstateGym),
// closing off an invalid-transition class entirely rather than validating a
// free-form target-status field.
export const gymStatusChangeSchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing this change"),
});

export type GymStatusChangeInput = z.infer<typeof gymStatusChangeSchema>;

// SA-03: Super Admin can move a gym to a different tier (existing members
// are not automatically reclassified, AC #1) or override its effective
// member cap (null clears the override, reverting to the tier's own cap).
export const changeGymTierSchema = z.object({
  tierId: z.uuid("Select a subscription tier"),
});

export type ChangeGymTierInput = z.infer<typeof changeGymTierSchema>;

export const overrideGymCapSchema = z.object({
  capOverride: z
    .number()
    .int()
    .positive("Enter a positive number")
    .max(2147483647, "Value is too large")
    .nullable(),
});

export type OverrideGymCapInput = z.infer<typeof overrideGymCapSchema>;

// Validates the `gymId` positional argument on the lifecycle/tier/cap
// Server Actions below -- the payload schemas above only cover the request
// body, not the id itself.
export const gymIdSchema = z.uuid("Invalid gym id");

// Story 1.7 (FR-072): "Access gym data" escalation requires a mandatory
// reason, audit-logged with the Super Admin's identity/reason/timestamp.
// Shares gymStatusChangeSchema's REASON_MIN_LENGTH policy (one constant, so
// the two can't silently drift) but keeps its own name/error copy -- this
// action-intent (why you're viewing a gym's private data) reads differently
// from a lifecycle status change at every call site.
export const escalateGymAccessSchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH, "Add a reason describing why you need access"),
});

export type EscalateGymAccessInput = z.infer<typeof escalateGymAccessSchema>;

// Story 1.9 (FR-069): Settings page field validation, copy taken
// character-for-character from EXPERIENCE.md's AD-13 field table. `capacity`
// here is `gyms.capacity` (FR-046 occupancy denominator) -- NOT
// `gyms.member_cap_override` (Story 1.6, tier-based member ceiling); the two
// columns are unrelated despite the similar naming. The `gyms.capacity`
// column itself stays nullable (existing gyms provisioned before this story
// may have capacity = null) -- this is form-level "required" only, no DB
// constraint added.
export const gymSettingsSchema = z.object({
  gymName: z.string().trim().min(2, "Gym name is required").max(120, "Gym name is too long"),
  // Only null (no logo) or a URL under this bucket's own public object path
  // is accepted -- `uploadGymLogo` is the only legitimate producer of this
  // value, so this rejects an arbitrary/data:/blob: string submitted by
  // calling this schema directly, bypassing the upload flow.
  logoUrl: z
    .url()
    .refine((url) => url.includes("/storage/v1/object/public/gym-logos/"), {
      message: "Logo URL must come from the gym-logos upload flow",
    })
    .nullable(),
  // `gyms.primary_color` is nullable with no default -- gyms provisioned
  // before this story (or that simply haven't set a color yet) must still be
  // able to save every other field without being forced to pick a color.
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Enter a valid hex colour (e.g. #E0971F)")
    .nullable(),
  timezone: z.enum(["Africa/Douala", "Africa/Lagos", "Africa/Bangui", "Africa/Kinshasa", "UTC"]),
  defaultLanguage: z.enum(["en", "fr"]),
  gracePeriodDays: z.number().int().min(1, "Grace period must be between 1 and 30 days").max(30, "Grace period must be between 1 and 30 days"),
  capacity: z.number().int().positive("Enter the gym's member capacity").max(2147483647, "Value is too large"),
  alertAutoDismissMinutes: z.number().int().min(1, "Auto-dismiss must be between 1 and 120 minutes").max(120, "Auto-dismiss must be between 1 and 120 minutes"),
  checkinTimeoutHours: z.number().int().min(1, "Check-in timeout must be between 1 and 24 hours").max(24, "Check-in timeout must be between 1 and 24 hours"),
});

export type GymSettingsInput = z.infer<typeof gymSettingsSchema>;
