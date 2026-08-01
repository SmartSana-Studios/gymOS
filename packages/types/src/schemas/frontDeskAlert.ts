import { z } from "zod";

// Story 4.6: validates apps/dashboard/lib/realtime/frontDeskAlerts.ts's
// dismissFrontDeskAlert input -- the outermost boundary receiving this input
// (a direct browser-native client write, not a Server Action), same
// precedent as every other schema in this file.
export const dismissFrontDeskAlertSchema = z.object({
  alertId: z.uuid(),
});

export type DismissFrontDeskAlertInput = z.infer<typeof dismissFrontDeskAlertSchema>;
