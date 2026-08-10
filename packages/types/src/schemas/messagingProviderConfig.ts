import { z } from "zod";

// Story 1.13: mirrors activatePaymentProviderSchema's shape/comment style
// (packages/types/src/schemas/paymentProvider.ts) -- the Server Action
// parses raw `unknown` with this schema first, same as every other action.
export const updateMessagingInstanceSchema = z.object({
  instanceId: z.string().trim().min(1, "Instance ID is required"),
});

export type UpdateMessagingInstanceInput = z.infer<typeof updateMessagingInstanceSchema>;
