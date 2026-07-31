"use server";

import { flagPaymentSchema, recordManualPaymentSchema, type AppError } from "@gymos/types";
import {
  flagPayment,
  logPaymentChange,
  recordManualPayment,
  searchMembersForPayment,
  verifyPayment,
} from "@/services/payments";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

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
