import { Suspense } from "react";

import { listAssignedMembers } from "@/services/coaches";
import { CoachPortalPageClient } from "./components/CoachPortalPageClient";
import CoachPortalLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/**
 * AD-14 Coach Portal -- assigned member list. Server Component + explicit
 * <Suspense>, mirroring subscriptions/page.tsx's exact structure (cookie-
 * based Supabase read under this app's `cacheComponents: true`).
 *
 * No route-level role guard beyond `(dashboard)/layout.tsx`'s existing
 * gym-staff gate -- this app's established "Sidebar hides it, RLS is the
 * real gate" precedent (attendance/page.tsx's/subscriptions/page.tsx's own
 * comment). A non-Coach session (Owner/Manager/Receptionist) reaching
 * `/coach` directly isn't blocked by this story -- for those roles,
 * `gym_staff_read_own_members`/`gym_staff_read_own_subscriptions` still
 * include them after 0040's narrowing, so they'd see the entire gym roster
 * here, same shape as the existing accepted gap on `/subscriptions`. No
 * `getDashboardShellContext()` fetch needed -- no role-conditional UI on
 * this page, every visitor who can reach it already sees exactly what their
 * own RLS-scoped query returns.
 */
export default function CoachPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sort?: string; dir?: string }>;
}) {
  return (
    <Suspense fallback={<CoachPortalLoading />}>
      <CoachPortalData searchParams={searchParams} />
    </Suspense>
  );
}

async function CoachPortalData({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const { data: members, error } = await listAssignedMembers({
    search: params.search,
    sort: params.sort,
    dir: params.dir,
  });

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <CoachPortalPageClient
      members={members ?? []}
      search={params.search ?? ""}
      sort={params.sort ?? "name"}
      dir={params.dir ?? "asc"}
    />
  );
}
