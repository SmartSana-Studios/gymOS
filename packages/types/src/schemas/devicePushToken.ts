import { z } from "zod";

// Story 6.1: Expo Push Token Registration & Cleanup (FR-074, FR-077).
export const devicePushTokenSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export type DevicePushTokenInput = z.infer<typeof devicePushTokenSchema>;
