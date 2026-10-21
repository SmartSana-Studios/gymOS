import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listAssignableGyms, listDisclosureInbox, listSupportAccounts, listSupportAssignments, listSupportLocks } from "./actions";
import { DisclosureInbox } from "./components/DisclosureInbox";
import { SupportPageClient } from "./components/SupportPageClient";

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportData />
    </Suspense>
  );
}

async function SupportData() {
  const [accounts, assignments, gyms, inbox, locks] = await Promise.all([
    listSupportAccounts(),
    listSupportAssignments(),
    listAssignableGyms(),
    listDisclosureInbox(),
    listSupportLocks(),
  ]);
  if (accounts.error || assignments.error || gyms.error) return <LoadError />;
  return (
    <div className="space-y-6">
      <SupportPageClient initialAccounts={accounts.data ?? []} assignments={assignments.data ?? []} gyms={gyms.data ?? []} locks={locks.data ?? []} />
      {locks.error && (
        <p role="alert" className="text-sm text-red-600">
          {locks.error.message}
        </p>
      )}
      {inbox.error && (
        <p role="alert" className="text-sm text-red-600">
          {inbox.error.message}
        </p>
      )}
      <DisclosureInbox requests={inbox.data ?? []} />
    </div>
  );
}
