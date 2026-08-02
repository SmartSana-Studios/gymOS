import { z } from "zod";

// Story 5.1: Manager/Owner -- Coach Member Assignment (FR-055).
export const assignCoachSchema = z.object({
  memberId: z.uuid("Select a valid member"),
  coachId: z.uuid("Select a coach"),
});

export type AssignCoachInput = z.infer<typeof assignCoachSchema>;
