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

export const initiatePaymentSchema = z.object({
  memberId: z.uuid("Invalid member id"),
  phoneNumber: e164Phone,
  method: z.enum(["mtn_momo", "orange_money"]),
});

export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;

// Story 4.3: validates apps/dashboard/services/payments.ts's
// recordManualPayment input (the Record Payment modal, AD-10). `method`'s
// 3-value enum is deliberately narrower than the full 5-value payment_method
// Postgres enum -- mtn_momo/orange_money are initiatePaymentSchema's own
// automated-only methods above; the two schemas' method sets are
// intentionally disjoint. `min(10, ...)` is AD-10's own explicit
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
