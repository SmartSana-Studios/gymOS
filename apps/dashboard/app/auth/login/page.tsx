import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

// Outer Server Component stays static; only the `searchParams`-dependent
// part is wrapped in <Suspense> (Next.js 16 Cache Components requires
// dynamic APIs to resolve inside a Suspense boundary, not the whole page --
// same pattern as apps/super-admin/app/(admin)/gyms/[id]/page.tsx). The
// fallback renders the same form without a redirect target -- visually
// identical, since resolving `next` from the URL is a local, near-instant
// operation with no network I/O.
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  return (
    <Suspense fallback={<LoginForm />}>
      <LoginFormWithRedirect searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginFormWithRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const { next, expired } = await searchParams;
  // Story 23-6b: the request proxy sends an idle, over-age, locked or revoked second-factor session here with ?expired=1.
  return <LoginForm redirectTo={next} expired={expired === "1"} />;
}
