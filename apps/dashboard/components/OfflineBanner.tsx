"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

/**
 * Tells the user when the browser has lost its connection, and on reconnect offers to reload the page's data.
 * Nothing is retried silently: a form submitted while offline fails and the user decides when to resend.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOffline = () => {
      setOnline(false);
      setJustReconnected(false);
    };
    const goOnline = () => {
      setOnline(true);
      setJustReconnected(true);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (online && !justReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium ${
        online ? "bg-emerald-700 text-white" : "bg-amber-600 text-white"
      }`}
    >
      <span>{online ? t("network.backOnline") : t("network.offline")}</span>
      {online && (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              router.refresh();
              setJustReconnected(false);
            }}
          >
            {t("network.reload")}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/20 hover:text-white" onClick={() => setJustReconnected(false)}>
            {t("network.dismiss")}
          </Button>
        </>
      )}
    </div>
  );
}
