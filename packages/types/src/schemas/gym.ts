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
