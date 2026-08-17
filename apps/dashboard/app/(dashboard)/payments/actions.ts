"use server";

import { flagPaymentSchema, initiatePaymentSchema, recordManualPaymentSchema, recordRefundSchema, type AppError } from "@gymos/types";
import {
  flagPayment,
  getPendingMobileMoneyPayment,
  initiatePayment,
  listRefundEligiblePayments,
  logPaymentChange,
  logRefundChange,
  recordManualPayment,
  recordRefund,
  searchMembersForPayment,
  verifyPayment,
  type RefundEligiblePaymentRow,
} from "@/services/payments";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getMobileMoneyAvailability } from "@/lib/featureFlags";

/** AC #1, #4: Record Payment. Same `audit_log_failed`-code-means-"saved but
 * log the warning" pattern as `createMember`/`deactivateMember` -- the
 * payment row is not rolled back if only the audit write fails. */
export async function recordPayment(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = recordManualPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const { data, error } = await recordManualPayment(parsed.data);
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logPaymentChange("manual_payment_recorded", data.id, {
    member_id: parsed.data.memberId,
    amount: parsed.data.amount,
    method: parsed.data.method,
    reason: parsed.data.reason,
  });
  if (auditError) {
    return {
      data: { id: data.id },
      error: { code: "audit_log_failed", message: t("payments.errors.auditLogFailedRecord") },
    };
  }

  return { data: { id: data.id }, error: null };
}

/** AC #3, #4: Verify. Audit metadata comes from `verifyPayment`'s own
 * authoritative read of the row at UPDATE time, not a client-supplied
 * `context` object -- a stale or fabricated client value must never land in
 * the audit trail, even though the actual mutation is already RLS-gated. */
export async function verifyPaymentAction(paymentId: string): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const { data, error } = await verifyPayment(paymentId);
  if (error || !data) {
    return { error };
  }

  const { error: auditError } = await logPaymentChange("payment_verified", paymentId, {
    member_id: data.memberId,
    amount: data.amount,
    method: data.method,
    reason: data.reason,
  });
  if (auditError) {
    return { error: { code: "audit_log_failed", message: t("payments.errors.auditLogFailedVerify") } };
  }

  return { error: null };
}

/** AC #3, #4: Flag for Review. Audit metadata (other than the flag reason
 * itself) comes from `flagPayment`'s own authoritative read of the row, same
 * rationale as `verifyPaymentAction` above. */
export async function flagPaymentAction(
  paymentId: string,
  flagReason: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = flagPaymentSchema.safeParse(flagReason);
  if (!parsed.success) {
    return {
      error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? t("common.invalidInput") },
    };
  }

  const { data, error } = await flagPayment(paymentId);
  if (error || !data) {
    return { error };
  }

  const { error: auditError } = await logPaymentChange("payment_flagged", paymentId, {
    member_id: data.memberId,
    amount: data.amount,
    method: data.method,
    flag_reason: parsed.data.reason,
  });
  if (auditError) {
    return { error: { code: "audit_log_failed", message: t("payments.errors.auditLogFailedFlag") } };
  }

  return { error: null };
}

/** Thin wrapper -- a bare search string, nothing else to validate (same
 * rationale as `checkOutMemberAction`). */
export async function searchMembersForPaymentAction(
  query: string,
): Promise<{ data: { id: string; name: string; phone: string | null }[] | null; error: AppError | null }> {
  return searchMembersForPayment(query);
}

/** Thin wrapper, same shape as `searchMembersForPaymentAction`. */
export async function listRefundEligiblePaymentsAction(
  memberId: string,
): Promise<{ data: RefundEligiblePaymentRow[] | null; error: AppError | null }> {
  return listRefundEligiblePayments(memberId);
}

/** AC #1: Record Refund. Same `audit_log_failed`-code-means-"saved but log
 * the warning" pattern as `recordPayment`/`verifyPaymentAction`/
 * `flagPaymentAction` -- the refund row is not rolled back if only the
 * audit write fails. */
export async function recordRefundAction(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = recordRefundSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const { data, error } = await recordRefund(parsed.data);
  if (error || !data) {
    return { data: null, error };
  }

  const { error: auditError } = await logRefundChange(data.id, {
    payment_id: parsed.data.paymentId,
    member_id: data.memberId,
    amount: parsed.data.amount,
    reason: parsed.data.reason,
  });
  if (auditError) {
    return {
      data: { id: data.id },
      error: { code: "audit_log_failed", message: t("payments.errors.auditLogFailedRefund") },
    };
  }

  return { data: { id: data.id }, error: null };
}

/**
 * Story 4.12 (AC #1): the first real UI-reachable caller of
 * `initiatePayment()` (`services/payments.ts`, built since Story 4.2 but
 * never wired to any dashboard screen until now). Inserts a `processing`
 * `payments` row and triggers a real Tara Money USSD prompt on the member's
 * phone -- the caller (RenewalModal) must not treat a successful `{ data }`
 * response as a completed renewal; the subscription only actually renews
 * once Tara Money's webhook later confirms via `complete_verified_payment()`
 * (Story 4.2's Decision 2).
 */
export async function initiatePaymentAction(
  input: unknown,
): Promise<{ data: { paymentId: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());

  // Story 4.13 review fix: routed through the shared
  // `getMobileMoneyAvailability()` helper (same one `canOfferMobileMoneyPayment()`
  // uses) instead of re-checking the kill switch and connection status
  // inline -- still surfaces the 3 distinct outcomes this action needs
  // ("feature disabled" / "connect Tara Money in Settings" / a real
  // backend error mean different things to an Owner deciding what to do
  // next), but a real RPC failure no longer gets misreported as "not
  // connected."
  const availability = await getMobileMoneyAvailability();
  if (!availability.available) {
    if (availability.reason === "disabled") {
      return { data: null, error: { code: "not_found", message: t("renewalPanel.errors.mobileMoneyDisabled") } };
    }
    if (availability.reason === "not_connected") {
      return { data: null, error: { code: "not_found", message: t("renewalPanel.errors.mobileMoneyNotConnected") } };
    }
    return { data: null, error: availability.error };
  }

  const parsed = initiatePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  return initiatePayment(parsed.data);
}

/**
 * Review finding (Story 4.12): lets `RenewalModal` discover an existing
 * `processing` mobile_money payment for this member on open, so it can
 * resume watching it instead of allowing a second, duplicate initiation.
 * Not kill-switch-gated -- this is a read of existing state, not a new
 * initiation, so it must still resolve even if the flag is currently off.
 */
export async function getPendingMobileMoneyPaymentAction(
  memberId: string,
): Promise<{ data: { paymentId: string } | null; error: AppError | null }> {
  return getPendingMobileMoneyPayment(memberId);
}
