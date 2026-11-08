import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listHeldPageNames } from "./actions";
import { HeldNamesClient } from "./components/HeldNamesClient";

export default function PageNamesPage() {
  return (
    <Suspense fallback={null}>
      <PageNamesData />
    </Suspense>
  );
}

async function PageNamesData() {
  const held = await listHeldPageNames();
  if (held.error || !held.data) return <LoadError />;
  return <HeldNamesClient rows={held.data} />;
}
