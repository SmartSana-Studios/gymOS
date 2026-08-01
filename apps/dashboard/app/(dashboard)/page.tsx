import { Suspense } from "react";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getDashboardShellContext } from "@/services/session";
import { listActiveFrontDeskAlerts } from "@/services/frontDeskAlerts";
import { FrontDeskAlertPanel } from "@/components/shared/FrontDeskAlertPanel";

/**
 * AD-02 Overview -- still a minimal shell (story Dev Notes -> Scope
 * Boundary / Open Question 2, resolved: no stat cards or tables here --
 * those remain deferred to a future story, nothing in the FR Coverage Map
 * assigns them to 4.6). Story 4.6 adds the Front-Desk Alert Panel above the
 * heading -- its own data fetch has its own error handling, so a failed
 * alert-list load falls back to an empty initial list rather than breaking
 * the whole page (same "own error handling per surface" discipline as
 * attendance/page.tsx). Review finding (Story 4.6): the panel is mounted
 * whenever `shell` resolves, regardless of whether the alerts fetch itself
 * succeeded -- previously a failed alerts fetch skipped mounting the panel
 * entirely, which also meant no Realtime subscription ever opened for that
 * session, unlike Attendance's page which always mounts it.
 */
export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewFallback />}>
      <OverviewData />
    </Suspense>
  );
}

async function OverviewData() {
  const { t } = await getServerTranslation(await getRequestLocale());

  const [{ data: shell }, { data: alertsData }] = await Promise.all([
    getDashboardShellContext(),
    listActiveFrontDeskAlerts(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {shell && (
        <FrontDeskAlertPanel
          gymId={shell.gymId}
          initialAlerts={alertsData?.alerts ?? []}
          autoDismissMinutes={alertsData?.autoDismissMinutes ?? 30}
        />
      )}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("overview.title")}</h1>
        <p className="text-muted-foreground">{t("overview.body")}</p>
      </div>
    </div>
  );
}

async function OverviewFallback() {
  const { t } = await getServerTranslation(await getRequestLocale());
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("overview.title")}</h1>
      <p className="text-muted-foreground">{t("overview.body")}</p>
    </div>
  );
}
