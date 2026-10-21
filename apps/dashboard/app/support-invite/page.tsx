import { Suspense } from "react";
import type { Metadata } from "next";

import { inspectInvite } from "@/services/supportInvite";
import { SupportInviteFlow } from "./components/SupportInviteFlow";

// Public route, a sibling of `(dashboard)` like `privacy`: the invitee has no session. The link's token is the credential,
// so the page must never be indexed or cached by a shared proxy.
export const metadata: Metadata = {
  title: "GymOS support",
  robots: { index: false, follow: false },
  // The token is in the URL: never leak it in a Referer header.
  referrer: "no-referrer",
};

export default function SupportInvitePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  return (
    <Suspense fallback={null}>
      <InviteData searchParams={searchParams} />
    </Suspense>
  );
}

async function InviteData({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const raw = (await searchParams).t;
  const token = typeof raw === "string" ? raw : "";
  const result = await inspectInvite(token);
  // A bad link shows one generic message; the token is not echoed.
  return <SupportInviteFlow token={result.ok ? token : null} initialStep={result.ok ? result.step : null} />;
}
