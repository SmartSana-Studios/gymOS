import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listAssignableGyms, listDisclosureInbox, listSupportAccounts, listSupportAssignments, listSupportLifecycle, listSupportLocks } from "./actions";
import { SupportPageClient } from "./components/SupportPageClient";

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportData />
    </Suspense>
  );
}

async function SupportData() {
  const [accounts, assignments, gyms, inbox, locks, lifecycle] = await Promise.all([
    listSupportAccounts(),
    listSupportAssignments(),
    listAssignableGyms(),
    listDisclosureInbox(),
    listSupportLocks(),
    listSupportLifecycle(),
  ]);
  if (accounts.error || assignments.error || gyms.error) return <LoadError />;
  return (
    <SupportPageClient
      initialAccounts={accounts.data ?? []}
      assignments={assignments.data ?? []}
      gyms={gyms.data ?? []}
      locks={locks.data ?? []}
      lifecycle={lifecycle.data ?? []}
      disclosures={inbox.data ?? []}
      loadErrors={{ locks: locks.error?.message, lifecycle: lifecycle.error?.message, disclosure: inbox.error?.message }}
    />
  );
}
