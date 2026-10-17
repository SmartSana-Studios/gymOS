import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

type SearchParams = Promise<{ expired?: string; denied?: string }>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <LoginPage searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { expired, denied } = await searchParams;
  // Story 22.7: the (admin) layout sends an idle, over-age or locked session here with ?expired=1,
  // and a signed-in account that is not a Super Admin with ?denied=1.
  return <LoginForm expired={expired === "1"} denied={denied === "1"} />;
}
