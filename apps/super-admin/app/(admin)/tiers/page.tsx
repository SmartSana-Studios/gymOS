import { Suspense } from "react";

import { listTiersWithGymCounts } from "@/services/tiers";
import { TiersPageClient } from "./components/TiersPageClient";
import TiersLoading from "./loading";

// SA-06 Tier Management. Same Server Component + explicit <Suspense>
// pattern as gyms/page.tsx (Story 1.5) -- this app's `cacheComponents: true`
// requires the cookie-based Supabase read to sit inside an explicit
// Suspense boundary, not just rely on the route's loading.tsx.
export default function TiersPage() {
  return (
    <Suspense fallback={<TiersLoading />}>
      <TiersData />
    </Suspense>
  );
}

async function TiersData() {
  const { data: tiers, error } = await listTiersWithGymCounts();

  if (error) {
    return (
      <div className="text-sm text-red-600">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  return <TiersPageClient initialTiers={tiers ?? []} />;
}
