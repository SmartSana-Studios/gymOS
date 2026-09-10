"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// AD-02: "Values refresh on page load and via polling every 60 seconds."
export const OVERVIEW_REFRESH_INTERVAL_MS = 60_000;

/**
 * Story 17.1 (AC #10): re-renders the Overview's Server Components every 60s
 * so the stat cards and tables stay current. Renders nothing.
 *
 * Deliberately separate from FrontDeskAlertPanel's own mechanisms -- its
 * Supabase Realtime channel and its 5s POLL_INTERVAL_MS degrade poll serve a
 * different purpose, and neither is touched, wrapped or duplicated here.
 * `router.refresh()` is safe against that panel: its effect depends on
 * `gymId` (a string, unchanged by a refresh) and TanStack Query ignores
 * `initialData` after the first mount.
 *
 * A tick is SKIPPED while any modal is open. Every modal in this app is a
 * native `<dialog>` opened with showModal() -- including the RenewalModal
 * that FrontDeskAlertPanel owns internally -- so checking the document for
 * an open dialog covers the panel's modal without reaching into the panel.
 * The next tick after the modal closes refreshes as normal.
 *
 * A tick is also SKIPPED while the tab is hidden: a front-desk tab left in the
 * background all day would otherwise re-run every Overview read each minute
 * for nobody. If a tick was skipped that way, the tab refreshes once the
 * moment it becomes visible again -- waiting for the next tick would show
 * figures older than the 60s AD-02 promises.
 */
export function OverviewAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let skippedWhileHidden = false;

    const handle = setInterval(() => {
      if (document.hidden) {
        skippedWhileHidden = true;
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      skippedWhileHidden = false;
      router.refresh();
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.hidden || !skippedWhileHidden) return;
      if (document.querySelector("dialog[open]")) return;
      skippedWhileHidden = false;
      router.refresh();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}
