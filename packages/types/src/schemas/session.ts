import { z } from "zod";

// Story 9.6: Multi-Gym Session Switching. Server-side re-validation for the
// gym switcher's Server Action -- never trust the client-supplied gymId,
// matching every other Server Action in this codebase's own stated
// discipline (see locale.ts).
export const switchActiveGymSchema = z.object({
  gymId: z.string().uuid(),
});

export type SwitchActiveGymInput = z.infer<typeof switchActiveGymSchema>;
