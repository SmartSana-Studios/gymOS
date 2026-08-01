import { z } from "zod";

// Story 4.2: validates apps/dashboard/services/payments.ts's initiatePayment
// input. No actions.ts exists yet (Scope Note) -- this is the outermost
// boundary receiving this input, same precedent as subscription.ts's
// renewSubscriptionSchema.

// members.phone is stored E.164 with a leading '+' (member.ts's own
// e164Phone regex, written verbatim by insertMember) -- kept consistent
// with that rather than defining a bare-digit-only regex here. TaraMoney's
// real API takes bare-digit Cameroon numbers with no '+' (confirmed from
// Story 4.1's real request/response evidence, docs/decisions.md) --
// initiatePayment strips the leading '+' before calling the Edge Function;
// not this schema's job.
const e164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number");

// Open string, not a closed enum (Story 4.7 follow-up, 0036_open_payment_method.sql):
// this app never actually tells TaraMoney which operator to use -- it sends
// `network: ""` and TaraMoney auto-detects the operator from the payer's
// phone number server-side (confirmed via real spike evidence,
// docs/decisions.md). `method` is purely this app's own record-keeping
// label; a closed 2-value enum would hard-block recording any operator/
// country TaraMoney adds beyond Cameroon MTN/Orange (e.g. Wave, used in
// Senegal/Burkina Faso/Ivory Coast) as this project expands beyond Cameroon.
export const initiatePaymentSchema = z.object({
  memberId: z.uuid("Invalid member id"),
  phoneNumber: e164Phone,
  method: z.string().trim().min(1, "Select a payment method").max(50, "Invalid payment method"),
});

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;

// Story 4.3: validates apps/dashboard/services/payments.ts's
// recordManualPayment input (the Record Payment modal, AD-10). `method`'s
// 3-value enum stays closed and manual-only (cash/bank_transfer/
// manual_momo) -- these represent genuinely distinct payment instruments a
// receptionist chooses in person, not a TaraMoney country/operator
// restriction, so unlike initiatePaymentSchema.method above (widened,
// 0036_open_payment_method.sql) this one is not opened up. `payments.method`
// itself is a plain `text` column at the DB level (not a Postgres enum,
// since 0036) -- both schemas' validation is purely a TS/Zod-layer concern
// now. `min(10, ...)` is AD-10's own explicit
// field-validation value for this specific note, distinct from this
// codebase's general REASON_MIN_LENGTH = 5 convention (member.ts's
// deactivateMemberSchema) -- not a copy-paste of that default.
// Mirrors subscription.ts's own REASON_MAX_LENGTH precedent -- both this
// story's Record Payment note and the Flag for Review reason are free-text
// fields the UI implies are bounded (the modal's live "N / min 10" counter),
// so a ceiling is added alongside the existing minimums.
const REASON_MAX_LENGTH = 200;

export const recordManualPaymentSchema = z.object({
  memberId: z.uuid("Select a member"),
  method: z.enum(["cash", "bank_transfer", "manual_momo"]),
  amount: z.number().int().positive().max(10_000_000, "Enter a valid amount"),
  reason: z
    .string()
    .trim()
    .min(10, "Add a note (at least 10 characters)")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

// AD-09 gives no explicit minimum for the "Flag for Review" reason prompt --
// uses the project's general REASON_MIN_LENGTH = 5 convention instead
// (matches deactivateMemberSchema/gymStatusChangeSchema).
export const flagPaymentSchema = z.object({
  reason: z.string().trim().min(5, "Add a reason describing this flag").max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type FlagPaymentInput = z.infer<typeof flagPaymentSchema>;

// Story 4.5: validates apps/dashboard/services/payments.ts's recordRefund
// input. No memberId field -- unlike recordManualPaymentSchema, recordRefund
// derives member_id/gym_id from the target payment row itself (authoritative,
// not client-supplied). The "amount <= original payment amount" rule is not
// expressible here (it depends on DB state) -- enforced in recordRefund for a
// friendly error message, and mirrored in the refunds INSERT RLS policy's own
// `with check` (0033_refund_recording.sql) as the real, uncircumventable gate.
export const recordRefundSchema = z.object({
  paymentId: z.uuid("Select a payment to refund"),
  amount: z.number().int().positive().max(10_000_000, "Enter a valid amount"),
  reason: z
    .string()
    .trim()
    .min(10, "Add a reason (at least 10 characters)")
    .max(REASON_MAX_LENGTH, "Reason is too long"),
});

export type RecordRefundInput = z.infer<typeof recordRefundSchema>;
