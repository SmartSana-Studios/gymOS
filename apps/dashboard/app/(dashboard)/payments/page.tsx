import { Suspense } from "react";
import { parsePage, parsePageSize } from "@gymos/types";

import {
  listAllPayments,
  listPendingPayments,
  listPaymentDiscrepancies,
  listRefundHistory,
  normalizeLedgerFilters,
  PAYMENTS_LEDGER_PAGE_SIZE,
} from "@/services/payments";
import { getDashboardShellContext } from "@/services/session";
import { getGymSettings } from "@/services/gym-settings";
import { PaymentsPageClient } from "./components/PaymentsPageClient";
import PaymentsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-09: the Verification Queue, Discrepancies and (Story 19.9c) a minimal
 * All Payments ledger driven by `?purpose=&memberId=&page=`. Server Component + explicit
 * <Suspense> -- same requirement as attendance/page.tsx: the cookie-based
 * Supabase read must sit inside an explicit Suspense boundary under this
 * app's `cacheComponents: true`.
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's existing
 * gym-staff gate -- the Sidebar already hides `/payments` from Coach
 * (Sidebar.tsx's NAV_ITEMS), RLS (0031 migration) is the real gate.
 */
type PaymentsSearchParams = Promise<{
  purpose?: string;
  memberId?: string;
  page?: string;
  size?: string;
}>;

export default function PaymentsPage({ searchParams }: { searchParams: PaymentsSearchParams }) {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <PaymentsData searchParams={searchParams} />
    </Suspense>
  );
}

async function PaymentsData({ searchParams }: { searchParams: PaymentsSearchParams }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.size, PAYMENTS_LEDGER_PAGE_SIZE);
  const filters = normalizeLedgerFilters({ purpose: params.purpose, memberId: params.memberId });

  const [
    { data: pendingPayments, error: pendingError },
    { data: discrepancies, error: discrepanciesError },
    { data: shell, error: shellError },
    { data: gymSettings },
    { data: ledger, error: ledgerError },
    { data: refunds, error: refundsError },
  ] = await Promise.all([
    listPendingPayments(),
    listPaymentDiscrepancies(),
    getDashboardShellContext(),
    // Story 19.9b: only drives the AD-10 hint; a failed read means no hint.
    getGymSettings(),
    listAllPayments({ ...filters, page, pageSize }),
    listRefundHistory(),
  ]);

  if (pendingError || shellError || !shell) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  // A Discrepancies-only failure degrades to an empty section rather than
  // blanking the whole page -- the Pending Payments verification queue above
  // it is the business-critical part and must keep rendering regardless.
  if (discrepanciesError) {
    console.error(`PaymentsData: listPaymentDiscrepancies failed -- ${discrepanciesError.message}`);
  }

  // A ledger-only failure degrades the same way: the queue stays usable.
  if (ledgerError) {
    console.error(`PaymentsData: listAllPayments failed -- ${ledgerError.message}`);
  }

  // Same degrade as the ledger: a refunds-only failure shows its own error.
  if (refundsError) {
    console.error(`PaymentsData: listRefundHistory failed -- ${refundsError.message}`);
  }

  return (
    <PaymentsPageClient
      refunds={refundsError || !refunds ? null : refunds}
      refundsError={Boolean(refundsError || !refunds)}
      ledger={ledgerError || !ledger ? null : { ...ledger, page, pageSize }}
      ledgerError={Boolean(ledgerError || !ledger)}
      ledgerPurpose={filters.purpose ?? ""}
      ledgerMemberId={filters.memberId ?? ""}
      pendingPayments={pendingPayments ?? []}
      discrepancies={discrepanciesError ? [] : (discrepancies ?? [])}
      recordedByName={shell.memberName}
      role={shell.role}
      chargeGuestsPerSession={gymSettings?.chargeGuestsPerSession ?? false}
    />
  );
}
