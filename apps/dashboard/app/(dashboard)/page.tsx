import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { getDashboardShellContext, type DashboardShellContext, type MemberRole } from "@/services/session";
import { listActiveFrontDeskAlerts } from "@/services/frontDeskAlerts";
import { getCurrentlyCheckedIn } from "@/services/attendance";
import { listSubscriptions } from "@/services/subscriptions";
import { getRevenueMtd } from "@/services/payments";
import { FrontDeskAlertPanel } from "@/components/shared/FrontDeskAlertPanel";
import { StatCard } from "@/components/ui/stat-card";
import { canOfferMobileMoneyPayment } from "@/lib/featureFlags";
import { CheckedInTable } from "./components/CheckedInTable";
import { ExpiringTable } from "./components/ExpiringTable";
import { GymHealthRow, GymHealthRowSkeleton } from "./components/GymHealthRow";
import { OverviewAutoRefresh } from "./components/OverviewAutoRefresh";

// AD-02: each table shows at most 10 rows. Neither service takes a limit
// (their page sizes are module constants), so the cap is applied here, to the
// same call whose `total` feeds the matching card -- one call per pair.
const OVERVIEW_TABLE_MAX_ROWS = 10;

// Story 17.2 (AC #1): who sees the gym-health row. An explicit allowlist, like
// Sidebar.tsx's role lists -- not `role !== "receptionist"` -- so a future role
// does not inherit management figures by default. This hides management
// information from the front desk; it is NOT an authorization boundary: RLS
// already lets a Receptionist read every figure on the row.
const GYM_HEALTH_ROLES: readonly MemberRole[] = ["manager", "supervisor", "owner"];

function canSeeGymHealth(shell: DashboardShellContext | null): boolean {
  return shell != null && GYM_HEALTH_ROLES.includes(shell.role);
}

/**
 * AD-02 Overview. Story 17.1 builds out what Story 4.6 deferred: beneath the
 * Front-Desk Alert Panel, a three-card stat row (Checked in now / Expiring
 * this week / Revenue this month), then the Currently Checked-In and
 * Expiring This Week tables.
 *
 * Story 17.2 adds a second, Manager-plus card row between the first and the
 * tables: Active members / New this month / Today's classes / At risk
 * (`GymHealthRow`). It streams in its OWN <Suspense> boundary, so its reads
 * never hold back row 1 or the tables. It is rendered only for
 * owner/manager/supervisor (`canSeeGymHealth`), and the staff skeleton
 * reserves its four tiles for exactly those roles, so they see no layout jump
 * and a Receptionist never sees a four-card shape. Its reads start once
 * `OverviewData`'s own reads resolve -- an accepted small waterfall: the
 * boundary protects row 1 from row 2, not the reverse.
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
 * Two boundaries, not one (Story 17.3). A Coach is redirected off this page,
 * and `redirect()` inside a streamed boundary is a client-side bounce: the
 * fallback is flushed to the browser first. So the OUTER boundary, the only
 * one a Coach ever reaches, does nothing but read the shell, and its fallback
 * is role-neutral: a heading bar and one plain block, no text and no
 * stat-card shape. The AD-02 skeleton sits on the INNER boundary, which only
 * staff reach. On a full page load the shell read is a `cache()` hit, since
 * the layout made it in the same request. On a client-side navigation to `/`
 * the shared layout does not re-render, so the outer boundary pays a real
 * round trip -- which is why its fallback is a skeleton, not `null` (Story
 * 17.3 review: staff saw a blank content area there).
 *
 * The skeleton is this page's own <Suspense> fallback, deliberately NOT an
 * `app/(dashboard)/loading.tsx`: that file would sit at the route-group root
 * and its boundary would also cover child routes that have no loading.tsx of
 * their own (e.g. /settings), flashing an Overview skeleton elsewhere
 * (deferred-work.md, Story 17.1). The outer sync shell + Suspense-wrapped
 * async child shape is required under `cacheComponents: true`; a missing
 * boundary here would not fail the build, it would bubble to layout.tsx's
 * `fallback={null}` and blank the whole dashboard chrome while streaming.
 * The same holds for row 2's boundary: without it, row 2 would suspend to the
 * inner boundary and hold row 1 back, and the build would still pass.
 */
export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewGateSkeleton />}>
      <OverviewGate />
    </Suspense>
  );
}

/**
 * Story 17.3 (AC #1, #2): a Coach lands on the Coach Portal. Decided here,
 * before any Overview fetch starts, and outside any `Promise.all` or
 * `try` -- `redirect()` throws a control-flow signal. Not in
 * `(dashboard)/layout.tsx`: that layout also wraps `/coach/*`, so a redirect
 * there would loop without path matching.
 */
async function OverviewGate() {
  const { data: shell } = await getDashboardShellContext();

  if (shell?.role === "coach") {
    redirect("/coach/overview");
  }

  return (
    <Suspense fallback={<OverviewSkeleton showGymHealth={canSeeGymHealth(shell)} />}>
      <OverviewData shell={shell} />
    </Suspense>
  );
}

async function OverviewData({ shell }: { shell: DashboardShellContext | null }) {
  const locale = await getRequestLocale();
  const { t } = await getServerTranslation(locale);

  const [
    { data: alertsData },
    mobileMoneyEnabled,
    { data: checkedIn, error: checkedInError },
    { data: expiring, error: expiringError },
    { data: revenueMtd, error: revenueError },
  ] = await Promise.all([
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

      {/* Story 17.2: the Manager-plus gym-health row, in its OWN boundary. */}
      {canSeeGymHealth(shell) && (
        <Suspense fallback={<GymHealthRowSkeleton />}>
          <GymHealthRow locale={locale} />
        </Suspense>
      )}

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

// AD-02 loading: 3 skeleton stat cards and 5 skeleton rows per table, plus row
// 2's four tiles for the roles that will get it. Carries no text. Only staff
// see it -- see OverviewPage's comment on the two boundaries.
function OverviewSkeleton({ showGymHealth }: { showGymHealth: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[86px] w-full animate-pulse rounded-md bg-muted" />
        ))}
      </div>
      {showGymHealth && <GymHealthRowSkeleton />}
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

// The gate boundary's fallback, shown to every role while the shell -- and so
// the role -- resolves. Role-neutral by construction: no text and no stat-card
// grid, so a Coach about to be redirected sees nothing of the staff Overview.
// Its heading bar lines up with both AD-02's skeleton and the Coach Portal
// heading.
function OverviewGateSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
