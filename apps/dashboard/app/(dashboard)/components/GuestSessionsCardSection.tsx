import { getGuestSessionsSummary } from "@/services/guestSessions";
import { GuestSessionsCard } from "./GuestSessionsCard";

/**
 * Story 19.10: the Overview's Guest sessions card, in its OWN <Suspense> so
 * its read never holds back the rows above or the tables below. Streams
 * today's figures; the client card owns the period control from there. A
 * failed read renders the card in its in-card error state and nothing else.
 */
export async function GuestSessionsCardSection() {
  const { data, error } = await getGuestSessionsSummary("today");
  if (error || !data) {
    console.error(`GuestSessionsCardSection: getGuestSessionsSummary failed -- ${error?.message ?? "no data returned"}`);
  }
  return <GuestSessionsCard initialSummary={data ?? null} initialFailed={Boolean(error) || !data} />;
}

// One full-width block, so the card does not jump when it streams in.
export function GuestSessionsCardSkeleton() {
  return <div className="h-[150px] w-full animate-pulse rounded-md bg-muted" />;
}
