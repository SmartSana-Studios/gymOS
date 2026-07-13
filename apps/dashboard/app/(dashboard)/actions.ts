"use server";

import { localeSchema, type AppError } from "@gymos/types";
import { updateLanguagePreference as updateLanguagePreferenceRow } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Sidebar language toggle. Never trusts client input -- re-validates
 * `locale` server-side even though the toggle UI only ever sends "en"/"fr". */
export async function updateLanguagePreference(
  input: unknown,
): Promise<{ error: AppError | null }> {
  const parsed = localeSchema.safeParse(input);
  if (!parsed.success) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  return updateLanguagePreferenceRow(parsed.data);
}
