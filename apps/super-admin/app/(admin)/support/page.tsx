import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listAssignableGyms, listSupportAccounts, listSupportAssignments } from "./actions";
import { SupportPageClient } from "./components/SupportPageClient";

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportData />
    </Suspense>
  );
}

async function SupportData() {
  const [accounts, assignments, gyms] = await Promise.all([listSupportAccounts(), listSupportAssignments(), listAssignableGyms()]);
  if (accounts.error || assignments.error || gyms.error) return <LoadError />;
  return <SupportPageClient initialAccounts={accounts.data ?? []} assignments={assignments.data ?? []} gyms={gyms.data ?? []} />;
}
