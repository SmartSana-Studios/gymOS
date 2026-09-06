"use client";

import { useEffect, useState } from "react";

/**
 * A clock that re-renders on an interval, so time-dependent copy stops being
 * a static server render (Story 1.15 review).
 *
 * The Gym Detail page's escalation UI is entirely about a deadline: the
 * "Access granted -- expires {time}" indicator and every row of the Active
 * data access list. Those values were computed once, server-side, and never
 * re-evaluated -- so leaving the tab open past the deadline left the page
 * asserting that access was live while RLS had already stopped honouring the
 * grant, with Revoke buttons sitting on dead grants.
 *
 * Returns `null` until the first tick rather than seeding with `Date.now()`.
 * That is deliberate on two counts. These components render on the server
 * too, so a clock reading baked into the HTML would differ from the browser's
 * on hydration; and seeding would mean calling setState synchronously in the
 * effect body, which cascades renders (react-hooks/set-state-in-effect).
 *
 * Callers treat `null` as "not yet known" and fall back to the server's view
 * -- which is correct at the moment the page loads, since that is when the
 * server computed it. The only gap is a grant that lapses within the first
 * tick of page load, which then corrects itself on that tick.
 *
 * 30s rather than 1s: nothing here is a countdown, the values are rendered to
 * the minute, and the deadline is 24 hours away. The database remains the
 * authority on expiry either way -- this only keeps the UI from lying about
 * it.
 */
export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/**
 * True once `isoTimestamp` is known to have passed on the client's clock.
 * False while the clock is still unknown (first render), so the server's view
 * holds until the first tick.
 */
export function hasLapsed(isoTimestamp: string, now: number | null): boolean {
  return now !== null && new Date(isoTimestamp).getTime() <= now;
}
