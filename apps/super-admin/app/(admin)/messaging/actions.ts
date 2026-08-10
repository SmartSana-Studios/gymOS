"use server";

import { updateMessagingInstanceSchema, type AppError } from "@gymos/types";
import { updateMessagingInstance as updateMessagingInstanceRow } from "@/services/messaging-provider-config";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Story 1.13 AC #2/#3: the RPC itself is atomic (update + audit log in one
 * transaction) -- this action is a thin validate-then-call wrapper,
 * `{ error }` contract, never throws for expected errors (matches
 * setActivePaymentProvider's established Process Pattern). */
export async function updateMessagingInstance(input: unknown): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = updateMessagingInstanceSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: { code: "validation_error", message: firstIssue?.message ?? t("common.invalidInput") },
    };
  }

  const { error } = await updateMessagingInstanceRow(parsed.data.instanceId);
  if (error) {
    return { error };
  }

  return { error: null };
}
