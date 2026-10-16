import { Suspense } from "react";

import { CancelRecoveryForm } from "./cancel-form";

/** Story 22.8: opened from the email link. A GET never cancels (mail scanners prefetch links); the button does. */
export default function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={null}>
      <CancelRecoveryPage searchParams={searchParams} />
    </Suspense>
  );
}

async function CancelRecoveryPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <CancelRecoveryForm token={typeof token === "string" ? token : ""} />;
}
