import { Suspense } from "react";
import { LoadError } from "@/components/load-error";

import { listPaymentProviders } from "@/services/payment-providers";
import { PaymentProvidersPageClient } from "./components/PaymentProvidersPageClient";
import PaymentProvidersLoading from "./loading";

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
    return <LoadError />;
  }

  return <PaymentProvidersPageClient initialProviders={providers ?? []} />;
}
