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
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<LoginForm />}>
          <LoginFormWithRedirect searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function LoginFormWithRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm redirectTo={next} />;
}
