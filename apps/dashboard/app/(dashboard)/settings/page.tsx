import { getGymSettings } from "@/services/gym-settings";
import { getGymPaymentConnectionStatus } from "@/services/gym-payment-credentials";
import { getGymBillingInfo } from "@/services/billing";
import { listStaff } from "@/services/staff";
import { SettingsForm } from "./SettingsForm";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { TARAMONEY_PROVIDER_KEY } from "@/lib/featureFlags";

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

  // Not owner-gated at the RPC level (any gym-scoped session can read it),
  // and a failure here shouldn't block the rest of Settings from rendering
  // -- treat an error the same as "not connected" rather than failing the
  // whole page.
  const { data: paymentConnection } = await getGymPaymentConnectionStatus(TARAMONEY_PROVIDER_KEY);

  // Story 9.1 (AD-13): a live staff count for the new Staff section's
  // summary row. Same "don't fail the whole page" treatment as the payment
  // connection lookup above -- an error here just shows a 0 count rather
  // than blocking Settings.
  const { data: staff } = await listStaff();

  // Story 11.3: same "don't fail the whole page" treatment as the payment
  // connection lookup above -- an error here just hides the Billing
  // section (SettingsForm's own null-check) rather than blocking Settings.
  const { data: billingInfo } = await getGymBillingInfo();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsForm
        initial={settings}
        initialPaymentConnection={paymentConnection}
        initialBillingInfo={billingInfo}
        staffCount={staff?.length ?? 0}
      />
    </div>
  );
}
