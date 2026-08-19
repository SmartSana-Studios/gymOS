import { Suspense } from "react";

import { listStaff } from "@/services/staff";
import { getDashboardShellContext } from "@/services/session";
import { StaffPageClient } from "./components/StaffPageClient";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-16 Staff List. Server Component + explicit <Suspense>, matching
 * members/page.tsx's own established requirement under this app's
 * `cacheComponents: true`.
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s existing
 * gym-staff gate (matches settings/page.tsx's own documented "Sidebar hides
 * the link, RLS is the real gate" precedent): a non-Owner/Supervisor
 * reaching this route directly only sees what `gym_staff_read_own_members`
 * already grants their role -- for Manager/Receptionist/Coach that's read
 * access to the same roster they can already see via other pages (AC #3's
 * "no staff-creation UI is available" is enforced by hiding the Add Staff
 * button below via role, backstopped by `create_staff_member()`'s own
 * server-side ceiling check).
 */
export default function StaffPage() {
  return (
    <Suspense fallback={<StaffLoading />}>
      <StaffData />
    </Suspense>
  );
}

// Mirrors members/loading.tsx's own skeleton shape.
function StaffLoading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}

async function StaffData() {
  const [{ data: staff, error: staffError }, { data: shell, error: shellError }] = await Promise.all([
    listStaff(),
    getDashboardShellContext(),
  ]);

  if (staffError || shellError || !shell) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return <StaffPageClient initialStaff={staff ?? []} role={shell.role} />;
}
