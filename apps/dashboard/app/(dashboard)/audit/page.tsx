import { Suspense } from "react";

import { listAuditLog, listAuditActors, AUDIT_LOG_PAGE_SIZE, resolveAuditDateRange } from "@/services/auditLog";
import { getDashboardShellContext } from "@/services/session";
import { AuditLogPageClient } from "./components/AuditLogPageClient";
import AuditLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-12 Audit Log. Server Component + explicit <Suspense> -- same
 * requirement as subscriptions/page.tsx: the cookie-based Supabase read
 * must sit inside an explicit Suspense boundary under this app's
 * `cacheComponents: true`.
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s gym-scoped-
 * staff gate -- the Sidebar's `NAV_ITEMS` already restricts this link to
 * `manager`/`owner`, but that's UI-only; the real enforcement is Task 1's
 * `manager_or_owner_read_own_audit_log` RLS policy. A Receptionist/Coach
 * reaching `/audit` directly gets zero rows, not a 403.
 */
export default function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actorId?: string; page?: string }>;
}) {
  return (
    <Suspense fallback={<AuditLoading />}>
      <AuditData searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditData({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actorId?: string; page?: string }>;
}) {
  const params = await searchParams;
  const parsedPage = params.page ? Number(params.page) : 1;
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const { from, to } = resolveAuditDateRange(params.from, params.to);

  const [
    { data: auditLogPage, error: auditLogError },
    { data: actorOptions, error: actorsError },
    { data: shell, error: shellError },
  ] = await Promise.all([
    listAuditLog({ from, to, actorId: params.actorId, page }),
    listAuditActors(),
    getDashboardShellContext(),
  ]);

  if (auditLogError || shellError || !shell) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  // An actor-list failure degrades to an empty dropdown rather than
  // blanking the whole page -- the table above it is the business-critical
  // part and must keep rendering regardless (same degrade-not-fail
  // precedent as payments/page.tsx's discrepancies-only failure).
  if (actorsError) {
    console.error(`AuditData: listAuditActors failed -- ${actorsError.message}`);
  }

  return (
    <AuditLogPageClient
      initialRows={auditLogPage?.rows ?? []}
      total={auditLogPage?.total ?? 0}
      page={page}
      pageSize={AUDIT_LOG_PAGE_SIZE}
      from={from}
      to={to}
      actorId={params.actorId ?? ""}
      role={shell.role}
      actorOptions={actorsError ? [] : (actorOptions ?? [])}
    />
  );
}
