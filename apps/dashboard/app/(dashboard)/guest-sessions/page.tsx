import { Suspense } from "react";

import { parsePage } from "@gymos/types";

import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";
import {
  parseGuestSessionsPeriod,
  parseGuestSessionsTab,
  type BlockedAttemptRow,
  type FreeGuestSessionRow,
  type PaidGuestSessionRow,
} from "@/lib/guest-sessions";
import {
  getGuestSessionsSummary,
  listBlockedSessionAttempts,
  listFreeGuestSessions,
  listPaidGuestSessions,
} from "@/services/guestSessions";
import { getDashboardShellContext, type MemberRole } from "@/services/session";
import { GuestSessionsPageClient } from "./components/GuestSessionsPageClient";
import GuestSessionsLoading from "./loading";

// Manager-plus by construction (AD-22 has no sidebar item). An explicit
// allowlist, like the Overview's: a future role does not inherit it.
const ALLOWED_ROLES: readonly MemberRole[] = ["manager", "supervisor", "owner"];

type SearchParams = {
  tab?: string;
  period?: string;
  page?: string;
  group?: string;
  refunded?: string;
};

/**
 * AD-22 Guest Sessions. Reached from the Overview's Guest sessions card; tab,
 * period, page and the Paid filters all live in the URL. The Receptionist and
 * Coach get the global permission state before any read is made (the RPCs
 * would refuse them with 42501 anyway, and a refusal is mapped to the same
 * state).
 */
export default function GuestSessionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<GuestSessionsLoading />}>
      <GuestSessionsData searchParams={searchParams} />
    </Suspense>
  );
}

async function GuestSessionsData({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const tab = parseGuestSessionsTab(params.tab);
  const period = parseGuestSessionsPeriod(params.period);
  const page = parsePage(params.page);
  const groupByRecorder = params.group !== "none";
  const refundedAfterUseOnly = params.refunded === "1";

  const { t } = await getServerTranslation(await getRequestLocale());
  const { data: shell, error: shellError } = await getDashboardShellContext();

  const common = { tab, period, page, groupByRecorder, refundedAfterUseOnly };

  if (shellError || !shell) {
    return <GuestSessionsPageClient {...common} state="error" message={t("guestSessions.loadError")} />;
  }
  if (!ALLOWED_ROLES.includes(shell.role)) {
    return <GuestSessionsPageClient {...common} state="forbidden" message={t("guestSessions.permissionDenied")} />;
  }

  const [summary, list] = await Promise.all([
    getGuestSessionsSummary(period),
    tab === "paid"
      ? listPaidGuestSessions({ period, page, refundedAfterUseOnly, groupByRecorder })
      : tab === "blocked"
        ? listBlockedSessionAttempts({ period, page })
        : listFreeGuestSessions({ period, page }),
  ]);

  if (summary.error?.code === "forbidden" || list.error?.code === "forbidden") {
    return <GuestSessionsPageClient {...common} state="forbidden" message={t("guestSessions.permissionDenied")} />;
  }
  if (summary.error || list.error || !summary.data || !list.data) {
    console.error(
      `GuestSessionsData: ${tab} read failed -- ${(list.error ?? summary.error)?.message ?? "no data returned"}`,
    );
    return <GuestSessionsPageClient {...common} state="error" message={t("guestSessions.loadError")} />;
  }

  return (
    <GuestSessionsPageClient
      {...common}
      state="ready"
      summary={summary.data}
      total={list.data.total}
      paidRows={tab === "paid" ? (list.data.rows as PaidGuestSessionRow[]) : []}
      blockedRows={tab === "blocked" ? (list.data.rows as BlockedAttemptRow[]) : []}
      freeRows={tab === "free" ? (list.data.rows as FreeGuestSessionRow[]) : []}
    />
  );
}
