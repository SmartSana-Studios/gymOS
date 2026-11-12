import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listCitiesPage } from "./actions";
import { CitiesPageClient } from "./components/CitiesPageClient";
import CitiesLoading from "./loading";

// Cities (Story 25.1, AD-49): the controlled list of places a gym can choose from. Same Server Component + explicit <Suspense> pattern as tiers/page.tsx.
export default function CitiesPage() {
  return (
    <Suspense fallback={<CitiesLoading />}>
      <CitiesData />
    </Suspense>
  );
}

async function CitiesData() {
  const { data, error } = await listCitiesPage();
  if (error || !data) return <LoadError />;
  return <CitiesPageClient data={data} />;
}
