import { getGymSettings, getGymosSupportStatus } from "@/services/gym-settings";
import { getGymPaymentConnectionStatus } from "@/services/gym-payment-credentials";
import { getGymBillingInfo, listSelectableTiers } from "@/services/billing";
import { listStaff } from "@/services/staff";
import { listPlans } from "@/services/plans";
import { SettingsForm } from "./SettingsForm";
import { getDashboardShellContext } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { TARAMONEY_PROVIDER_KEY } from "@/lib/featureFlags";
import { getLandingPageState } from "@/services/landing-page";

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
  // The queries below are independent of each other, so they run together rather than one after
  // another -- sequential awaits made Settings visibly slower to open than every other menu.
  // Each keeps its own "don't fail the whole page" treatment further down.
  const [
    { data: settings, error },
    { t },
    { data: paymentConnection },
    { data: staff },
    { data: billingInfo },
    { data: selectableTiers },
    { data: shell },
    { data: plans },
  ] = await Promise.all([
    getGymSettings(),
    getRequestLocale().then(getServerTranslation),
    getGymPaymentConnectionStatus(TARAMONEY_PROVIDER_KEY),
    listStaff(),
    getGymBillingInfo(),
    listSelectableTiers(),
    getDashboardShellContext(),
    listPlans(),
  ]);

  if (error || !settings) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-destructive">
        {t("common.loadError")}
      </div>
    );
  }

  const loyaltyPlans = (plans ?? [])
    .filter((plan) => plan.planType !== "pay_per_session" && plan.durationDays !== null)
    .map((plan) => ({ name: plan.name, durationDays: plan.durationDays as number }));

  // Story 23.3: the Owner-only GymOS Support readout; a failure just hides the section.
  const gymosSupportStatus = shell?.role === "owner" ? (await getGymosSupportStatus()).data : null;

  // Story 24.9: the Landing page row (Owner, Supervisor, assigned support only). A failed read just shows no badge.
  const showLandingPage = shell?.role === "owner" || shell?.role === "supervisor" || shell?.role === "support";
  const landingPageState = showLandingPage ? await getLandingPageState() : null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <SettingsForm
        initial={settings}
        initialPaymentConnection={paymentConnection}
        initialBillingInfo={billingInfo}
        selectableTiers={selectableTiers ?? []}
        staffCount={staff?.length ?? 0}
        role={shell?.role ?? null}
        loyaltyPlans={loyaltyPlans}
        gymosSupportStatus={gymosSupportStatus}
        landingPageState={landingPageState}
        landingPageUserKey={`${shell?.gymId ?? "gym"}:${shell?.memberId ?? shell?.role ?? "user"}`}
      />
    </div>
  );
}
