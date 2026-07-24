import { z } from "zod";

// Story 3.2: Manual Renewal Reset. Validates the input to
// apps/dashboard/services/subscriptions.ts's `renewSubscription()`, which
// calls the `renew_subscription()` Postgres RPC (0022_manual_renewal_reset.sql).
// This story builds no Server Action/UI of its own (backend-only, see the
// story file's Scope Note #1) -- Epic 4 Stories 4.7/4.8 will import this
// schema directly for their own Inline Renewal Panel / Subscriptions page.

// Per-file-const convention, not a shared import (matches gym.ts/member.ts's
// own established precedent -- each file keeps its own REASON_MIN_LENGTH).
const REASON_MIN_LENGTH = 5;
// Matches member.ts's emergencyContactSchema's 200-char cap for a similar
// free-text note field -- keeps the RPC's audit_log.metadata jsonb bounded.
const REASON_MAX_LENGTH = 200;

export const renewSubscriptionSchema = z.object({
  memberId: z.uuid("Invalid member id"),
  reason: z
    .string()
    .trim()
    .min(REASON_MIN_LENGTH, "Add a reason describing this renewal")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type RenewSubscriptionInput = z.infer<typeof renewSubscriptionSchema>;
