import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listHeldPageNames } from "./actions";
import PageNamesLoading from "./loading";
import { HeldNamesClient } from "./components/HeldNamesClient";

export default function PageNamesPage() {
  return (
    <Suspense fallback={<PageNamesLoading />}>
      <PageNamesData />
    </Suspense>
  );
}

async function PageNamesData() {
  const held = await listHeldPageNames();
  if (held.error || !held.data) return <LoadError />;
  return <HeldNamesClient rows={held.data} />;
}
