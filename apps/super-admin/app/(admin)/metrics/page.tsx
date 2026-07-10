import { Suspense } from "react";

import { getPlatformMetrics } from "@/services/metrics";
import MetricsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// SA-05 Platform Metrics. Read-only, no filters, values load on page
// arrival (per SA-05's spec) -- no client component needed at all.
export default function MetricsPage() {
  return (
    <Suspense fallback={<MetricsLoading />}>
      <MetricsData />
    </Suspense>
  );
}

async function MetricsData() {
  const { data: metrics, error } = await getPlatformMetrics();
  const { t } = await getServerTranslation(await getRequestLocale());

  if (error || !metrics) {
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("metrics.title")}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">{t("metrics.totalGyms")}</p>
          <p className="text-2xl font-semibold">{metrics.totalGyms.toLocaleString()}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">{t("metrics.totalMembers")}</p>
          <p className="text-2xl font-semibold">{metrics.totalMembers.toLocaleString()}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">{t("metrics.totalPayments")}</p>
          <p className="text-2xl font-semibold">
            XAF {metrics.totalPaymentsProcessed.toLocaleString()}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("metrics.summary", {
          active: metrics.activeGyms,
          suspended: metrics.suspendedGyms,
          deactivated: metrics.deactivatedGyms,
        })}
      </p>
    </div>
  );
}
