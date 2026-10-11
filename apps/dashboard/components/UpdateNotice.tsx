"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { BUILD_ID } from "@/lib/build-id";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Small card, bottom-right, shown when the server is running a newer build
 * than the one this tab loaded. A tab left open across a deploy keeps its old
 * JavaScript until it reloads, and can hit a Server Action or chunk the new
 * build no longer has. Refreshing is the person's choice (they may be mid-form),
 * so it is a prompt, never an automatic reload. "Later" hides it until the
 * server moves to yet another build. */
export function UpdateNotice() {
  const { t } = useTranslation();
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return;
      const body: unknown = await res.json();
      const version = (body as { version?: unknown }).version;
      if (typeof version === "string" && version !== "" && version !== BUILD_ID) {
        setLatest(version);
      }
    } catch {
      // Offline or a transient failure: say nothing, try again on the next tick.
    }
  }, []);

  useEffect(() => {
    if (BUILD_ID === "dev") return;

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [check]);

  if (!latest || latest === dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-md border bg-background p-4 text-foreground shadow-lg"
    >
      <p className="text-sm font-medium">{t("updateNotice.title")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("updateNotice.body")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(latest)}>
          {t("updateNotice.later")}
        </Button>
        <Button type="button" size="sm" onClick={() => window.location.reload()}>
          {t("updateNotice.refresh")}
        </Button>
      </div>
    </div>
  );
}
