import { Suspense } from "react";

import { listPlans } from "@/services/plans";
import { PlansPageClient } from "./components/PlansPageClient";
import PlansLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * Membership Plan Configuration. Server Component + explicit <Suspense>,
 * same pattern as apps/super-admin/app/(admin)/tiers/page.tsx --
 * apps/dashboard's `cacheComponents: true` requires the cookie-based
 * Supabase read to sit inside an explicit Suspense boundary, not just rely
 * on loading.tsx (same requirement settings/page.tsx already establishes).
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's gym-staff gate
 * -- same discipline as settings/page.tsx: Sidebar hides this link from
 * non-Manager/Owner roles (UI-only), the real enforcement is the RLS write
 * policies (0017_membership_plan_configuration.sql). A Receptionist/Coach
 * who reaches this route directly gets read-only data via
 * "gym_staff_read_own_plans"; every write silently no-ops at RLS.
 */
export default function PlansPage() {
  return (
    <Suspense fallback={<PlansLoading />}>
      <PlansData />
    </Suspense>
  );
}

async function PlansData() {
  const { data: plans, error } = await listPlans();

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return <PlansPageClient initialPlans={plans ?? []} />;
}
