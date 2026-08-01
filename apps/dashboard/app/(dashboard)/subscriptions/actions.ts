"use server";

import { confirmRenewalSchema, type AppError } from "@gymos/types";
import {
  confirmRenewal,
  getRenewalPreview,
  exportSubscriptionsCsv,
  type ConfirmedRenewal,
  type RenewalPreview,
  type ExportSubscriptionsCsvResult,
} from "@/services/subscriptions";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 4.7: Inline Renewal Panel. This directory has no `page.tsx` yet
// (that's Story 4.8) -- architecture.md's own directory listing already
// names `subscriptions/actions.ts # renewSubscription` as the intended home
// for renewal Server Actions, matching the precedent
// `services/subscriptions.ts` (Story 3.2) and `initiatePayment`
// (services/payments.ts, Story 4.2) already set: backend/service code
// landing before the page that uses it.

/**
 * AC #2, #3: Confirm Renewal. No separate audit-log call here (unlike
 * payments/actions.ts's two-step recordPayment/logPaymentChange) --
 * confirm_renewal() already writes its own audit record inside the same
 * transaction (0035_inline_renewal_panel.sql), matching
 * renew_subscription()'s own self-auditing precedent, not the Payments
 * flow's split pattern.
 */
export async function confirmRenewalAction(
  input: unknown,
): Promise<{ data: ConfirmedRenewal | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = confirmRenewalSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  return confirmRenewal(parsed.data);
}

/** Thin wrapper -- same shape as payments/actions.ts's searchMembersForPaymentAction. */
export async function getRenewalPreviewAction(
  memberId: string,
): Promise<{ data: RenewalPreview | null; error: AppError | null }> {
  return getRenewalPreview(memberId);
}

/** AC #3: thin wrapper, same shape as this file's other two Server Actions.
 * `listSubscriptions()` is called directly from `page.tsx` (a Server
 * Component) -- no wrapper needed for it, matching members/page.tsx's
 * calling `listMembers()` directly. */
export async function exportSubscriptionsCsvAction(params: {
  status?: string;
  planType?: string;
}): Promise<ExportSubscriptionsCsvResult> {
  return exportSubscriptionsCsv(params);
}
