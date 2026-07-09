import { Suspense } from "react";

import { getPlatformMetrics } from "@/services/metrics";
import MetricsLoading from "./loading";

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

  if (error || !metrics) {
    return (
      <div className="text-sm text-red-600">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Platform Metrics</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Total Gyms</p>
          <p className="text-2xl font-semibold">{metrics.totalGyms.toLocaleString()}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Total Members</p>
          <p className="text-2xl font-semibold">{metrics.totalMembers.toLocaleString()}</p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Total Payments</p>
          <p className="text-2xl font-semibold">
            XAF {metrics.totalPaymentsProcessed.toLocaleString()}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Active: {metrics.activeGyms} | Suspended: {metrics.suspendedGyms} | Deactivated:{" "}
        {metrics.deactivatedGyms}
      </p>
    </div>
  );
}
