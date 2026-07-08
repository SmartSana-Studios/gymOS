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
