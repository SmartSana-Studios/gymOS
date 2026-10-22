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
    <div className="space-y-6">
      <SupportPageClient initialAccounts={accounts.data ?? []} assignments={assignments.data ?? []} gyms={gyms.data ?? []} locks={locks.data ?? []} lifecycle={lifecycle.data ?? []} disclosures={inbox.data ?? []} />
      {locks.error && (
        <p role="alert" className="text-sm text-red-600">
          {locks.error.message}
        </p>
      )}
      {lifecycle.error && (
        <p role="alert" className="text-sm text-red-600">
          {lifecycle.error.message}
        </p>
      )}
      {inbox.error && (
        <p role="alert" className="text-sm text-red-600">
          {inbox.error.message}
        </p>
      )}
    </div>
  );
}
