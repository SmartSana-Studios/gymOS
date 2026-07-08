import { Suspense } from "react";

import { listGyms, listTiers } from "@/services/gyms";
import { GymsPageClient } from "./components/GymsPageClient";
import GymsLoading from "./loading";

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
export default function GymsPage() {
  return (
    <Suspense fallback={<GymsLoading />}>
      <GymsData />
    </Suspense>
  );
}

async function GymsData() {
  const [{ data: gyms, error: gymsError }, { data: tiers, error: tiersError }] =
    await Promise.all([listGyms(), listTiers()]);

  if (gymsError || tiersError) {
    return (
      <div className="text-sm text-red-600">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  return <GymsPageClient initialGyms={gyms ?? []} tiers={tiers ?? []} />;
}
