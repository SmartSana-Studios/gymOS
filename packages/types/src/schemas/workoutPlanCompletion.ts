import { z } from "zod";

// Story 13.3: Member Plan View & Completion Tracking (FR-110).
//
// planId/exerciseId deliberately NOT z.uuid() -- matches workoutPlan.ts's
// exerciseId precedent: the DB (workout_plan_completions' own RLS insert
// policy) is the real authority, Zod's RFC-4122-nibble validator is
// stricter than the column type needs. clientCompletionId IS .uuid() --
// mirrors logProgressEntrySchema.clientEntryId's precedent for a
// client-generated dedupe id.
export const logWorkoutCompletionSchema = z.object({
  planId: z.string().min(1),
  exerciseId: z.string().min(1),
  clientCompletionId: z.string().uuid(),
});

export type WorkoutCompletionInput = z.infer<typeof logWorkoutCompletionSchema>;
