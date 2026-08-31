import { z } from "zod";

// Story 13.1: Shared Exercise Library (FR-112). Mirrors class.ts's plain-CRUD
// shape -- a single required field, no conditional logic, no .refine() needed.
export const exerciseNameSchema = z.object({
  name: z.string().trim().min(1, "Exercise name is required").max(100, "Value is too long"),
});

export type ExerciseInput = z.infer<typeof exerciseNameSchema>;
