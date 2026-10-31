"use client";

import { useEffect } from "react";

import type { SupportMessage } from "./constants";

/** Outcome message as a floating toast; it dismisses itself (errors stay a little longer). */
export function SupportToast({ message, onDismiss }: { message: SupportMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, message.kind === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg ${
        message.kind === "error" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"
      }`}
    >
      {message.text}
    </div>
  );
}
