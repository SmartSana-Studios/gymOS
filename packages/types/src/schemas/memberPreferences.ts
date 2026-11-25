import { z } from "zod";

// Story 6.4: Notification Preferences (FR-076). Partial-update shape --
// the mobile UI toggles one category at a time, so every field is
// optional but at least one must be present on any given write.
// Story 31.2 (FR-233): streakReminderOptedOut is the N-08 off-switch and is
// accepted alone, like the other two.
export const memberPreferencesUpdateSchema = z
  .object({
    quietGymAlertsOptedOut: z.boolean().optional(),
    classReminderOptedOut: z.boolean().optional(),
    streakReminderOptedOut: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.quietGymAlertsOptedOut !== undefined ||
      v.classReminderOptedOut !== undefined ||
      v.streakReminderOptedOut !== undefined,
    { message: "At least one preference field must be provided" },
  );

export type MemberPreferencesUpdateInput = z.infer<typeof memberPreferencesUpdateSchema>;
