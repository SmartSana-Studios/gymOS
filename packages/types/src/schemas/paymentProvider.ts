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

// Story 4.13: the 3 credential fields captured by "Connect payment account"
// -- shape dictated by what TaraMoneyProvider.ts already reads from env vars
// (see the story file's Dev Notes), so Story 4.14 only has to change *where*
// the values come from, not renegotiate what they are. Max-length guards
// are generous (real Tara Money values are short) purely to bound payload
// size, not a documented real constraint.
export const connectGymPaymentCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1, "API key is required").max(500),
  businessId: z.string().trim().min(1, "Business ID is required").max(200),
  webhookSecret: z.string().trim().min(1, "Webhook secret is required").max(500),
});

export type ConnectGymPaymentCredentialsInput = z.infer<typeof connectGymPaymentCredentialsSchema>;
