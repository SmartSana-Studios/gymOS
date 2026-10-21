import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listSupportAccounts } from "./actions";
import { SupportPageClient } from "./components/SupportPageClient";

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportData />
    </Suspense>
  );
}

async function SupportData() {
  const { data, error } = await listSupportAccounts();
  if (error) return <LoadError />;
  return <SupportPageClient initialAccounts={data ?? []} />;
}
