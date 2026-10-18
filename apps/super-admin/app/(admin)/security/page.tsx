import { Suspense } from "react";
import { LoadError } from "@/components/load-error";

import { listFactors } from "./actions";
import { getRecoveryStatus } from "./recovery-actions";
import { SecurityClient } from "./SecurityClient";

export default function SecurityPage() {
  return (
    <Suspense fallback={null}>
      <SecurityData />
    </Suspense>
  );
}

async function SecurityData() {
  const [{ data, error }, recovery] = await Promise.all([listFactors(), getRecoveryStatus()]);
  if (error || recovery.error || !recovery.data) {
    return <LoadError />;
  }
  return <SecurityClient initialFactors={data ?? []} recovery={recovery.data} />;
}
