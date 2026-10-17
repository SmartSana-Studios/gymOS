"use server";

import { activatePaymentProviderSchema, type AppError } from "@gymos/types";
import { authorizeOrRedirect } from "@/lib/authz-action";
import { activatePaymentProvider as activatePaymentProviderRow } from "@/services/payment-providers";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 4.1 AC #6/#7: the RPC itself is atomic (deactivate-old +
 * activate-new + audit log in one transaction) -- this action is a thin
 * validate-then-call wrapper, `{ data, error }` contract, never throws for
 * expected errors (matches createTier's established Process Pattern). */
export async function setActivePaymentProvider(
  input: unknown,
): Promise<{ error: AppError | null }> {
  // Story 22 retro item 53: every Super Admin Server Action is gated (aal2, session limits, live role); an ended session redirects to login.
  const authz = await authorizeOrRedirect("platform.admin_access");
  if (!authz.ok) return { error: authz.error };
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = activatePaymentProviderSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { error } = await activatePaymentProviderRow(parsed.data.providerKey);
  if (error) {
    return { error };
  }

  return { error: null };
}
