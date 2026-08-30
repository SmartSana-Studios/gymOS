import { Suspense } from "react";

import { listGymsBilling } from "@/services/billing";
import { BillingPageClient } from "./components/BillingPageClient";
import BillingLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// SA-07 Billing view. Same Server Component + explicit <Suspense> shape as
// gyms/page.tsx (required under this app's `cacheComponents: true` -- see
// that file's own comment for why relying on loading.tsx alone isn't
// sufficient).
export default function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  return (
    <Suspense fallback={<BillingLoading />}>
      <BillingData searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingData({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = params.page ? Number(params.page) : 1;
  const status =
    params.status === "active" ||
    params.status === "past_due" ||
    params.status === "grace_period" ||
    params.status === "suspended"
      ? params.status
      : undefined;

  const { data: billingPage, error } = await listGymsBilling({ page, search: params.search, status });

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return (
    <BillingPageClient
      initialRows={billingPage?.rows ?? []}
      total={billingPage?.total ?? 0}
      page={billingPage?.page ?? 1}
      pageSize={billingPage?.pageSize ?? 20}
      search={params.search ?? ""}
      status={params.status ?? ""}
    />
  );
}
