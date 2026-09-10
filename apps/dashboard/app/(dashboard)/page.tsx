import { Suspense } from "react";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getDashboardShellContext } from "@/services/session";
import { listActiveFrontDeskAlerts } from "@/services/frontDeskAlerts";
import { getCurrentlyCheckedIn } from "@/services/attendance";
import { listSubscriptions } from "@/services/subscriptions";
import { getRevenueMtd } from "@/services/payments";
import { FrontDeskAlertPanel } from "@/components/shared/FrontDeskAlertPanel";
import { StatCard } from "@/components/ui/stat-card";
import { canOfferMobileMoneyPayment } from "@/lib/featureFlags";
import { CheckedInTable } from "./components/CheckedInTable";
import { ExpiringTable } from "./components/ExpiringTable";
import { OverviewAutoRefresh } from "./components/OverviewAutoRefresh";

// AD-02: each table shows at most 10 rows. Neither service takes a limit
// (their page sizes are module constants), so the cap is applied here, to the
// same call whose `total` feeds the matching card -- one call per pair.
const OVERVIEW_TABLE_MAX_ROWS = 10;

/**
 * AD-02 Overview. Story 17.1 builds out what Story 4.6 deferred: beneath the
 * Front-Desk Alert Panel, a three-card stat row (Checked in now / Expiring
 * this week / Revenue this month), then the Currently Checked-In and
 * Expiring This Week tables.
 *
 * Front-Desk Alert Panel (Story 4.6), unchanged: mounted whenever `shell`
 * resolves, regardless of whether the alerts fetch itself succeeded (a Story
 * 4.6 review finding -- a failed alerts fetch used to skip mounting the panel
 * entirely, so no Realtime subscription ever opened for that session).
 *
 * Per-surface failure isolation: every service returns `{ data, error }` and
 * never throws for expected errors, so the `Promise.all` below cannot reject
 * on one of them. Each read is branched on independently -- a failed revenue
 * aggregate degrades the revenue card only, a failed check-in read its card
 * and table only -- matching payments/page.tsx's discipline. None of these
 * reads is one the page cannot exist without, so none of them blanks it.
 *
 * The skeleton is this page's own <Suspense> fallback, deliberately NOT an
 * `app/(dashboard)/loading.tsx`: that file would sit at the route-group root
 * and its boundary would also cover child routes that have no loading.tsx of
 * their own (e.g. /settings), flashing an Overview skeleton elsewhere
 * (deferred-work.md, Story 17.1). The outer sync shell + Suspense-wrapped
 * async child shape is required under `cacheComponents: true`; a missing
 * boundary here would not fail the build, it would bubble to layout.tsx's
 * `fallback={null}` and blank the whole dashboard chrome while streaming.
 */
export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewData />
    </Suspense>
  );
}

async function OverviewData() {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);

  const [
    { data: shell },
    { data: alertsData },
    mobileMoneyEnabled,
    { data: checkedIn, error: checkedInError },
    { data: expiring, error: expiringError },
    { data: revenueMtd, error: revenueError },
  ] = await Promise.all([
    getDashboardShellContext(),
    listActiveFrontDeskAlerts(),
    canOfferMobileMoneyPayment(),
    getCurrentlyCheckedIn(),
    // The status (0021's nightly-maintained definition), never a hand-rolled
    // 7-day date filter -- and a literal, because listSubscriptions() silently
    // ignores an unrecognised status and returns every subscription. Sorted by
    // expiry on this same call (ascending -- soonest first): the service
    // otherwise defaults to member name, and the table keeps only the first
    // 10 rows, so a name-ordered read could cut a member expiring tomorrow.
    listSubscriptions({ status: "expiring_soon", sort: "expiry" }),
    getRevenueMtd(),
  ]);

  if (checkedInError) {
    console.error(`OverviewData: getCurrentlyCheckedIn failed -- ${checkedInError.message}`);
  }
  if (expiringError) {
    console.error(`OverviewData: listSubscriptions(expiring_soon) failed -- ${expiringError.message}`);
  }
  if (revenueError) {
    console.error(`OverviewData: getRevenueMtd failed -- ${revenueError.message}`);
  }

  const checkedInFailed = Boolean(checkedInError) || !checkedIn;
  const expiringFailed = Boolean(expiringError) || !expiring;
  const revenueFailed = Boolean(revenueError) || revenueMtd == null;

  const unavailable = t("overview.cards.unavailable");

  return (
    <div className="flex flex-col gap-6">
      <OverviewAutoRefresh />

      {shell && (
        <FrontDeskAlertPanel
          gymId={shell.gymId}
          initialAlerts={alertsData?.alerts ?? []}
          autoDismissMinutes={alertsData?.autoDismissMinutes ?? 30}
          mobileMoneyEnabled={mobileMoneyEnabled}
        />
      )}

      <h1 className="text-2xl font-semibold">{t("overview.title")}</h1>

      {/* Every number carries an explicit locale -- a bare toLocaleString()
          was a real shipped bug (PaymentsPageClient.tsx). The revenue figure
          is shown as-is, minus sign included: a month whose refunds exceed
          its takings is exactly what an Owner needs to see. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("overview.cards.checkedInNow")}
          value={checkedInFailed ? unavailable : checkedIn.total.toLocaleString(locale)}
          href="/attendance"
        />
        <StatCard
          label={t("overview.cards.expiringThisWeek")}
          value={expiringFailed ? unavailable : expiring.total.toLocaleString(locale)}
          href="/subscriptions?status=expiring_soon&sort=expiry"
        />
        <StatCard
          label={t("overview.cards.revenueThisMonth")}
          value={revenueFailed ? unavailable : `XAF ${revenueMtd.toLocaleString(locale)}`}
          href="/payments"
        />
      </div>

      {/* Story 17.2 seam: the Manager-plus gym-health card row slots in here,
          in its OWN <Suspense> boundary so a slow aggregate never delays the
          operational cards above. Not built in 17.1. */}

      <CheckedInTable
        rows={checkedInFailed ? [] : checkedIn.rows.slice(0, OVERVIEW_TABLE_MAX_ROWS)}
        loadError={checkedInFailed}
      />

      <ExpiringTable
        rows={expiringFailed ? [] : expiring.rows.slice(0, OVERVIEW_TABLE_MAX_ROWS)}
        loadError={expiringFailed}
        mobileMoneyEnabled={mobileMoneyEnabled}
      />
    </div>
  );
}

// AD-02 loading: 3 skeleton stat cards and 5 skeleton rows per table. Carries
// no text, so it reads the same for every role that briefly sees it.
function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[86px] w-full animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, table) => (
        <div key={table} className="space-y-3">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, row) => (
              <div key={row} className="h-12 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
