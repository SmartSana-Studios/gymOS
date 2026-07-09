import { Suspense } from "react";
import { notFound } from "next/navigation";

import { getGymDetail, listTiers } from "@/services/gyms";
import { GymDetailPageClient } from "./components/GymDetailPageClient";
import GymDetailLoading from "./loading";

// SA-03 Gym Detail. Same Server Component + explicit <Suspense> pattern as
// gyms/page.tsx (Story 1.5's cacheComponents: true requirement).
//
// Explicitly NOT built here: the "Access gym data" escalation and the Audit
// trail tab shown in SA-03's mockup -- both are Story 1.7's job (FR-072).
export default function GymDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<GymDetailLoading />}>
      <GymDetailData params={params} />
    </Suspense>
  );
}

async function GymDetailData({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: gym, error: gymError }, { data: tiers, error: tiersError }] =
    await Promise.all([getGymDetail(id), listTiers()]);

  if (gymError || tiersError) {
    return (
      <div className="text-sm text-red-600">
        Something went wrong on our end. Try refreshing the page.
      </div>
    );
  }

  if (!gym) {
    notFound();
  }

  return <GymDetailPageClient gym={gym} tiers={tiers ?? []} />;
}
