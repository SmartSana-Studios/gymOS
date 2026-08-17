import { Suspense } from "react";

import {
  ATTENDANCE_LOG_PAGE_SIZE,
  getCurrentlyCheckedIn,
  getTodayAttendanceCount,
  listAttendanceLog,
  resolveDateParam,
  todayUtcDate,
} from "@/services/attendance";
import { getDashboardShellContext } from "@/services/session";
import { listActiveFrontDeskAlerts } from "@/services/frontDeskAlerts";
import { AttendancePageClient } from "./components/AttendancePageClient";
import AttendanceLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import { isMobileMoneyInitiationEnabled } from "@/lib/featureFlags";

type AttendanceSearchParams = Promise<{
  page?: string;
  checkedInPage?: string;
  from?: string;
  to?: string;
  memberSearch?: string;
}>;

/**
 * AD-11 Attendance. Server Component + explicit <Suspense> -- same
 * requirement as members/page.tsx: the cookie-based Supabase read must sit
 * inside an explicit Suspense boundary under this app's `cacheComponents:
 * true`.
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's existing
 * gym-staff gate -- the Sidebar already hides this nav entry from Coach
 * (Scope Note #1), and RLS is the real enforcement (this app's established
 * "Sidebar hides it, RLS is the real gate" precedent): a Coach or Member
 * session reaching /attendance directly gets zero rows back from every
 * query on this page, not a 404.
 */
export default function AttendancePage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  return (
    <Suspense fallback={<AttendanceLoading />}>
      <AttendanceData searchParams={searchParams} />
    </Suspense>
  );
}

async function AttendanceData({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const params = await searchParams;
  const parsedPage = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedCheckedInPage = params.checkedInPage ? Number(params.checkedInPage) : 1;
  const checkedInPage = Number.isInteger(parsedCheckedInPage) && parsedCheckedInPage > 0 ? parsedCheckedInPage : 1;

  const today = todayUtcDate();
  // Review Finding: a hand-edited or cleared date param could otherwise
  // reach the service layer's date-boundary math unvalidated and crash the
  // render -- resolveDateParam falls back to today for anything malformed.
  const from = resolveDateParam(params.from, today);
  const to = resolveDateParam(params.to, today);

  const [
    { data: checkedIn, error: checkedInError },
    { count: todayCount, error: todayCountError },
    { data: logPage, error: logError },
    { data: shell, error: shellError },
    { data: alertsData },
  ] = await Promise.all([
    getCurrentlyCheckedIn({ page: checkedInPage }),
    getTodayAttendanceCount(),
    listAttendanceLog({ page, from, to, memberSearch: params.memberSearch }),
    getDashboardShellContext(),
    listActiveFrontDeskAlerts(),
  ]);

  if (checkedInError || todayCountError || logError || shellError || !shell) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <AttendancePageClient
      currentlyCheckedIn={checkedIn?.rows ?? []}
      checkedInTotal={checkedIn?.total ?? 0}
      checkedInPage={checkedIn?.page ?? checkedInPage}
      checkedInPageSize={ATTENDANCE_LOG_PAGE_SIZE}
      todayCount={todayCount ?? 0}
      logRows={logPage?.rows ?? []}
      logTotal={logPage?.total ?? 0}
      page={logPage?.page ?? page}
      pageSize={ATTENDANCE_LOG_PAGE_SIZE}
      from={from}
      to={to}
      memberSearch={params.memberSearch ?? ""}
      gymId={shell.gymId}
      initialAlerts={alertsData?.alerts ?? []}
      autoDismissMinutes={alertsData?.autoDismissMinutes ?? 30}
      mobileMoneyEnabled={isMobileMoneyInitiationEnabled()}
    />
  );
}
