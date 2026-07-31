import { Suspense } from "react";

import { listPaymentProviders } from "@/services/payment-providers";
import { PaymentProvidersPageClient } from "./components/PaymentProvidersPageClient";
import PaymentProvidersLoading from "./loading";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 4.1 AC #6. Same Server Component + explicit <Suspense> pattern as
// tiers/page.tsx (Story 1.6) -- this app's `cacheComponents: true` requires
// the cookie-based Supabase read to sit inside an explicit Suspense
// boundary, not just rely on the route's loading.tsx.
export default function PaymentProvidersPage() {
  return (
    <Suspense fallback={<PaymentProvidersLoading />}>
      <PaymentProvidersData />
    </Suspense>
  );
}

async function PaymentProvidersData() {
  const { data: providers, error } = await listPaymentProviders();

  if (error) {
    const { t } = await getServerTranslation(await getRequestLocale());
    return <div className="text-sm text-red-600">{t("common.loadError")}</div>;
  }

  return <PaymentProvidersPageClient initialProviders={providers ?? []} />;
}
