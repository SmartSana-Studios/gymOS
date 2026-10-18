import { Suspense } from "react";
import { LoadError } from "@/components/load-error";

import { listSuperAdmins } from "./actions";
import { AdminsPageClient } from "./components/AdminsPageClient";
import AdminsLoading from "./loading";

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
    return <LoadError />;
  }

  return <AdminsPageClient initialAdmins={admins ?? []} />;
}
