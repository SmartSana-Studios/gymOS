import { getGymSettings } from "@/services/gym-settings";
import { SettingsForm } from "./SettingsForm";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Route-level role guard beyond `(dashboard)/layout.tsx`'s gym-scoped-staff
 * gate is unnecessary here: Sidebar's `NAV_ITEMS` already restricts this
 * link to `owner`, but that's UI-only -- the real enforcement is the
 * `owner_update_own_gym` RLS policy (0014_gym_settings_owner_access.sql),
 * same defense-in-depth discipline as every prior story. A non-owner who
 * reaches this route directly still only gets read access via "read own
 * gym" and every write silently no-ops at the RLS layer.
 */
export default async function SettingsPage() {
  const { data: settings, error } = await getGymSettings();
  const { t } = await getServerTranslation(await getRequestLocale());

  if (error || !settings) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-destructive">
        {t("common.loadError")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
