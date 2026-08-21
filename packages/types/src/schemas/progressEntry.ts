import { z } from "zod";

// Story 10.1: Body Profile & Progress Entry Logging (FR-093/FR-094).
//
// `z.coerce.number()` on every numeric field -- form inputs arrive as
// strings (unlike memberOnboarding.ts's enum-only schemas, which need no
// coercion). Every field is optional/nullable: none of this is required to
// use the app (FR-093).

// MA-body-profile: height and starting weight are one-time facts, written
// directly to members.height_cm/members.starting_weight_kg (0066).
export const bodyProfileSchema = z.object({
  heightCm: z.coerce.number().positive().max(300).optional().nullable(),
  startingWeightKg: z.coerce.number().positive().max(500).optional().nullable(),
});

export type BodyProfileInput = z.infer<typeof bodyProfileSchema>;

// LogEntrySheet: any subset of weight/measurements/photo/note, but not an
// entirely empty entry -- "any subset" (AC #3) describes which fields, not
// zero fields. clientEntryId is always required -- it's the offline-safe
// dedupe key generated client-side before the entry is queued or sent
// (FR-097), never optional.
export const logProgressEntrySchema = z
  .object({
    weightKg: z.coerce.number().positive().max(500).optional().nullable(),
    waistCm: z.coerce.number().positive().max(300).optional().nullable(),
    chestCm: z.coerce.number().positive().max(300).optional().nullable(),
    hipsCm: z.coerce.number().positive().max(300).optional().nullable(),
    armsCm: z.coerce.number().positive().max(150).optional().nullable(),
    thighsCm: z.coerce.number().positive().max(150).optional().nullable(),
    photoPath: z.string().max(2048).optional().nullable(),
    note: z.string().trim().max(1000).optional().nullable(),
    clientEntryId: z.string().uuid(),
  })
  .refine(
    (value) =>
      value.weightKg != null ||
      value.waistCm != null ||
      value.chestCm != null ||
      value.hipsCm != null ||
      value.armsCm != null ||
      value.thighsCm != null ||
      value.photoPath != null ||
      value.note != null,
    { message: "Log at least one field" },
  );

export type LogProgressEntryInput = z.infer<typeof logProgressEntrySchema>;
