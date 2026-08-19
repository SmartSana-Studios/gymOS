import { z } from "zod";

// Story 12.1: Class Creation & Scheduling (FR-104).
//
// Postgres int4 upper bound -- values beyond this overflow the DB column
// (matches plan.ts/tier.ts's own local MAX_INT4 -- kept per-file, not
// shared, per those files' established convention).
const MAX_INT4 = 2147483647;

export const scheduleTypeSchema = z.enum(["one_off", "recurring"]);

// Mirrors classes_schedule_matches_type (0057) exactly -- Zod is the
// friendly first line, the DB constraint is the backstop, same pairing
// plan.ts/0017 already establish.
export const classSchema = z
  .object({
    name: z.string().trim().min(1, "Class name is required"),
    description: z.string().trim().optional(),
    // Not z.uuid()/z.string().uuid(): Zod's UUID validator enforces RFC
    // 4122's version/variant nibbles, which Postgres's own uuid column type
    // does not -- a hand-seeded id (e.g. a fixture/demo row) is a
    // syntactically valid Postgres uuid but fails that stricter check,
    // rejecting a correctly-selected coach on every submit. Matches
    // member.ts's planId field, which hit this exact bug in production.
    // materialize_class_sessions() and the classes_gym_id/coach_id FKs are
    // the real authority on whether coachId refers to a real row -- this
    // only needs to reject an empty selection.
    coachId: z.string().min(1, "Select a coach"),
    capacity: z
      .number()
      .int()
      .positive("Enter a capacity of at least 1")
      .max(MAX_INT4, "Value is too large"),
    scheduleType: scheduleTypeSchema,
    // ISO datetime string -- required and only valid for one_off.
    oneOffSessionAt: z.string().datetime().nullable(),
    // 0 = Sunday .. 6 = Saturday, matching Postgres's own extract(dow from
    // ...) convention the materializer reads directly (see 0057's Dev
    // Notes) -- required and only valid for recurring.
    recurrenceDays: z.array(z.number().int().min(0).max(6)).nullable(),
    recurrenceTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time in HH:mm format")
      .nullable(),
    recurrenceStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date in YYYY-MM-DD format")
      .nullable(),
  })
  .refine(
    (data) =>
      data.scheduleType === "one_off"
        ? data.oneOffSessionAt !== null
        : data.oneOffSessionAt === null,
    {
      message: "A one-off class requires a session date/time, and it must be empty for a recurring class",
      path: ["oneOffSessionAt"],
    },
  )
  .refine(
    (data) =>
      data.scheduleType === "recurring"
        ? data.recurrenceDays !== null &&
          data.recurrenceDays.length >= 1 &&
          data.recurrenceTime !== null &&
          data.recurrenceStartDate !== null
        : data.recurrenceDays === null &&
          data.recurrenceTime === null &&
          data.recurrenceStartDate === null,
    {
      message:
        "A recurring class requires at least one day of the week, a time, and a start date, and these must be empty for a one-off class",
      path: ["recurrenceDays"],
    },
  );

export type ClassInput = z.infer<typeof classSchema>;
