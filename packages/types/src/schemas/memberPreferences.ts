import { z } from "zod";

// Story 6.4: Notification Preferences (FR-076). Partial-update shape --
// the mobile UI toggles one category at a time, so both fields are
// optional but at least one must be present on any given write.
export const memberPreferencesUpdateSchema = z
  .object({
    quietGymAlertsOptedOut: z.boolean().optional(),
    classReminderOptedOut: z.boolean().optional(),
  })
  .refine(
    (v) => v.quietGymAlertsOptedOut !== undefined || v.classReminderOptedOut !== undefined,
    { message: "At least one preference field must be provided" },
  );

export type MemberPreferencesUpdateInput = z.infer<typeof memberPreferencesUpdateSchema>;
