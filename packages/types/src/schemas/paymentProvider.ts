import { z } from "zod";

// Story 4.1: a provider-key selection has no free-text user input (the
// Super Admin UI only offers "Activate" buttons for already-registered
// rows) -- this schema exists purely to keep activatePaymentProvider's
// Server Action consistent with every other action's "parse raw `unknown`
// with a Zod schema first" pattern (see tierSchema).
export const activatePaymentProviderSchema = z.object({
  providerKey: z.string().trim().min(1, "Provider key is required"),
});

export type ActivatePaymentProviderInput = z.infer<typeof activatePaymentProviderSchema>;
