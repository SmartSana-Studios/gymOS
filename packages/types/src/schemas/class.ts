import { z } from "zod";

// Story 12.1: Class Creation & Scheduling (FR-104).
//
// Postgres int4 upper bound -- values beyond this overflow the DB column
// (matches plan.ts/tier.ts's own local MAX_INT4 -- kept per-file, not
// shared, per those files' established convention).
const MAX_INT4 = 2147483647;

export const scheduleTypeSchema = z.enum(["one_off", "recurring"]);

/** A class can have at most this many weekly times (0181: the cap trigger on class_schedule_slots and private.validate_class_slots). */
export const MAX_CLASS_SLOTS = 14;

/** One weekly time: weekday 0 = Sunday .. 6 = Saturday (Postgres extract(dow)), start time "HH:mm" in the gym's time zone. */
export const classSlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time in HH:mm format"),
});

export type ClassSlot = z.infer<typeof classSlotSchema>;

// Mirrors classes_schedule_matches_type (0180: a recurring class needs only its start date; its times are the slots) -- Zod is the
// friendly first line, the DB constraint and private.validate_class_slots are the backstop, same pairing plan.ts/0017 already establish.
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
    // Story 29.2: one to fourteen weekly times, required and only valid for recurring (null for a one-off class).
    slots: z.array(classSlotSchema).max(MAX_CLASS_SLOTS, "A class can have at most 14 weekly times").nullable(),
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
        ? data.slots !== null && data.slots.length >= 1 && data.recurrenceStartDate !== null
        : data.slots === null && data.recurrenceStartDate === null,
    {
      message:
        "A recurring class requires at least one weekly time and a start date, and these must be empty for a one-off class",
      path: ["slots"],
    },
  )
  .refine(
    (data) => {
      if (data.slots === null) return true;
      const seen = new Set<string>();
      for (const s of data.slots) {
        const key = `${s.weekday}|${s.startTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: "The same day and time appears twice", path: ["slots"] },
  );

export type ClassInput = z.infer<typeof classSchema>;
