import { Suspense } from "react";

import { LoadError } from "@/components/load-error";

import { listAssignableGyms, listDisclosureInbox, listSupportAccounts, listSupportAssignments } from "./actions";
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
  const [accounts, assignments, gyms, inbox] = await Promise.all([
    listSupportAccounts(),
    listSupportAssignments(),
    listAssignableGyms(),
    listDisclosureInbox(),
  ]);
  if (accounts.error || assignments.error || gyms.error) return <LoadError />;
  return (
    <div className="space-y-6">
      <SupportPageClient initialAccounts={accounts.data ?? []} assignments={assignments.data ?? []} gyms={gyms.data ?? []} />
      {inbox.error && (
        <p role="alert" className="text-sm text-red-600">
          {inbox.error.message}
        </p>
      )}
      <DisclosureInbox requests={inbox.data ?? []} />
    </div>
  );
}
