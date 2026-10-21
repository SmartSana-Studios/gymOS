import type { Metadata } from "next";

import { SupportResetCancel } from "./components/SupportResetCancel";

// Public route, a sibling of `support-invite`: the person has no session. The link's token is the credential, so the page must
// never be indexed, cached by a shared proxy, or leak the token in a Referer header. Opening the link changes nothing: a button
// press does (link scanners that fetch URLs must not cancel a reset).
export const metadata: Metadata = {
  title: "GymOS support",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SupportResetCancelPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const raw = (await searchParams).t;
  const token = typeof raw === "string" ? raw : "";
  return <SupportResetCancel token={token || null} />;
}
