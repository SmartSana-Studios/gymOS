import { Suspense } from "react";

import { listPendingPayments, listPaymentDiscrepancies } from "@/services/payments";
import { getDashboardShellContext } from "@/services/session";
import { PaymentsPageClient } from "./components/PaymentsPageClient";
import PaymentsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-09's Verification Queue section only (the "All Payments" ledger table
 * is Scope Note-excluded, a later story's job). Server Component + explicit
 * <Suspense> -- same requirement as attendance/page.tsx: the cookie-based
 * Supabase read must sit inside an explicit Suspense boundary under this
 * app's `cacheComponents: true`.
 *
 * No route-level role guard beyond (dashboard)/layout.tsx's existing
 * gym-staff gate -- the Sidebar already hides `/payments` from Coach
 * (Sidebar.tsx's NAV_ITEMS), RLS (0031 migration) is the real gate.
 */
export default function PaymentsPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <PaymentsData />
    </Suspense>
  );
}

async function PaymentsData() {
  const [
    { data: pendingPayments, error: pendingError },
    { data: discrepancies, error: discrepanciesError },
    { data: shell, error: shellError },
  ] = await Promise.all([listPendingPayments(), listPaymentDiscrepancies(), getDashboardShellContext()]);

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

  return (
    <PaymentsPageClient
      pendingPayments={pendingPayments ?? []}
      discrepancies={discrepanciesError ? [] : (discrepancies ?? [])}
      recordedByName={shell.memberName}
      role={shell.role}
    />
  );
}
