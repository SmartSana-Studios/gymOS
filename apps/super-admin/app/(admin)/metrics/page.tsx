import { Suspense } from "react";

import { getPlatformMetrics, getRecentJobFailures } from "@/services/metrics";
import { JobFailuresTable } from "./JobFailuresTable";
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
  const locale = await getRequestLocale();
  const [
    { data: metrics, error },
    { data: jobFailures, error: jobFailuresError },
    { t },
  ] = await Promise.all([
    getPlatformMetrics(),
    getRecentJobFailures(),
    getServerTranslation(locale),
  ]);

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

      {jobFailuresError && (
        <div className="text-sm text-red-600">{t("common.loadError")}</div>
      )}

      {jobFailures && jobFailures.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("metrics.jobFailuresTitle")}</h2>
          <JobFailuresTable failures={jobFailures} locale={locale} />
        </div>
      )}
    </div>
  );
}
