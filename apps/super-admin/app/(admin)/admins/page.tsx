import { Suspense } from "react";

import { listSuperAdmins } from "./actions";
import { AdminsPageClient } from "./components/AdminsPageClient";
import AdminsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 1.16 (AC #1): Admins list. Server Component, same shape as SA-02's
// gyms/page.tsx -- the cookie-based Supabase read (listSuperAdmins) is
// isolated in AdminsData and explicitly wrapped in <Suspense> here, since
// next.config.ts's `cacheComponents: true` requires dynamic/cookie-based
// data access to sit inside an explicit Suspense boundary or the route
// errors ("Uncached data ... accessed outside of Suspense").
export default function AdminsPage() {
  return (
    <Suspense fallback={<AdminsLoading />}>
      <AdminsData />
    </Suspense>
  );
}

async function AdminsData() {
  const { data: admins, error } = await listSuperAdmins();

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return <AdminsPageClient initialAdmins={admins ?? []} />;
}
