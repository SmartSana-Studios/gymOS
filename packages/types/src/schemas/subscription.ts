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

// Story 4.7: Inline Renewal Panel. Validates
// apps/dashboard/services/subscriptions.ts's `confirmRenewal()`, which calls
// the `confirm_renewal()` RPC (0035_inline_renewal_panel.sql). `.extend()`s
// this file's own renewSubscriptionSchema per that schema's original
// comment naming this story as its intended consumer -- inherits
// memberId/reason (5-200 chars) verbatim; a 5-char minimum, not the 10-char
// minimum recordManualPaymentSchema uses for its note field (an accepted
// inconsistency from reusing this schema's shape, not a bug). `method` stays
// this same 3-value closed manual-methods enum -- Story 4.12 added a 4th,
// automated `mobile_money` option to RenewalModal's own local UI-only
// `RenewalMethod` union, but that branch calls `initiatePaymentAction`/
// `initiatePaymentSchema` instead of `confirmRenewalAction`/this schema, so
// this enum itself is intentionally unchanged.
export const confirmRenewalSchema = renewSubscriptionSchema.extend({
  method: z.enum(["cash", "bank_transfer", "manual_momo"]),
  backdate: z.boolean().optional(),
});

export type ConfirmRenewalInput = z.infer<typeof confirmRenewalSchema>;
