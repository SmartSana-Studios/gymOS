import { z } from "zod";

// Story 13.2: Coach-Authored Workout Plans (FR-109, FR-110).
//
// Postgres smallint upper bound -- values beyond this overflow the DB
// columns (sets/reps/order_index are smallint, not int4, unlike class.ts's
// MAX_INT4-bounded fields -- kept per-file, not shared, per this package's
// established convention).
const MAX_SMALLINT = 32767;

export const workoutExerciseSchema = z.object({
  // Not z.uuid(): matches class.ts's coachId precedent -- Zod's UUID
  // validator enforces RFC 4122 nibbles the DB column type does not, and
  // create_workout_plan()/update_workout_plan()'s own exercise_id
  // validation is the real authority on whether the selection is valid.
  exerciseId: z.string().min(1, "Select an exercise"),
  sets: z.number().int().positive("Enter at least 1 set").max(MAX_SMALLINT, "Value is too large"),
  reps: z.number().int().positive("Enter at least 1 rep").max(MAX_SMALLINT, "Value is too large"),
  note: z.string().trim().max(200, "Value is too long").nullable(),
});

// Mirrors create_workout_plan()'s own non-empty-array check (0080) -- Zod
// is the friendly first line, the DB check is the backstop, same pairing
// class.ts/0057 establish.
export const workoutPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required").max(100, "Value is too long"),
  // Upper bound mirrors `name`'s own max(100) pushback -- no AC calls for a
  // specific ceiling, but order_index is a smallint (Subtask 1.2), so an
  // unbounded array has no client-side guard before nearing that range.
  exercises: z
    .array(workoutExerciseSchema)
    .min(1, "At least one exercise is required")
    .max(100, "A plan can have at most 100 exercises"),
});

export type WorkoutExerciseInput = z.infer<typeof workoutExerciseSchema>;
export type WorkoutPlanInput = z.infer<typeof workoutPlanSchema>;
