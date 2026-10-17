"use server";

import { localeSchema, type AppError } from "@gymos/types";
import { authorizePlatformAction } from "@/lib/authz";
import { updateLanguagePreference as updateLanguagePreferenceRow } from "@/services/gyms";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Top-nav language toggle. Never trusts client input -- re-validates
 * `locale` server-side even though the toggle UI only ever sends "en"/"fr". */
export async function updateLanguagePreference(
  input: unknown,
): Promise<{ error: AppError | null }> {
  // Story 22 retro item 53: every Super Admin Server Action is gated (aal2, session limits, live role).
  const authz = await authorizePlatformAction("platform.admin_access");
  if (!authz.ok) return { error: authz.error };
  const parsed = localeSchema.safeParse(input);
  if (!parsed.success) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  return updateLanguagePreferenceRow(parsed.data);
}
