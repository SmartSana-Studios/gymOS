import { Suspense } from "react";

import { listGyms, listTiers } from "@/services/gyms";
import { GymsPageClient } from "./components/GymsPageClient";
import GymsLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// SA-02 Gym List. Server Component: initial data loads server-side per
// architecture's "Server Components for read-heavy pages" pattern; the
// Create Gym modal (client-side interactivity) is a child client component.
//
// The actual cookie-based Supabase read (listGyms/listTiers) is isolated in
// GymsData and explicitly wrapped in <Suspense> here -- relying only on the
// route's loading.tsx was not sufficient under this app's `cacheComponents:
// true` (next.config.ts, pre-existing starter setting): dynamic/cookie-based
// data access must sit inside an explicit Suspense boundary or Next.js
// errors the whole route ("Uncached data ... accessed outside of Suspense"),
// which otherwise surfaced as a silently-caught query error.
export default function GymsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<GymsLoading />}>
      <GymsData searchParams={searchParams} />
    </Suspense>
  );
}

async function GymsData({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = params.page ? Number(params.page) : 1;
  const status =
    params.status === "active" || params.status === "suspended" || params.status === "deactivated"
      ? params.status
      : undefined;

  const [{ data: gymsPage, error: gymsError }, { data: tiers, error: tiersError }] =
    await Promise.all([
      listGyms({ page, search: params.search, status }),
      listTiers(),
    ]);

  if (gymsError || tiersError) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <GymsPageClient
      initialGyms={gymsPage?.rows ?? []}
      total={gymsPage?.total ?? 0}
      page={gymsPage?.page ?? 1}
      pageSize={gymsPage?.pageSize ?? 20}
      search={params.search ?? ""}
      status={params.status ?? ""}
      tiers={tiers ?? []}
    />
  );
}
