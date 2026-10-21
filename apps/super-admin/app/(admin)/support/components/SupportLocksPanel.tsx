"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { unlockSupportAccount, type SupportLockRow } from "../actions";
import { REASON_MAX, REASON_MIN } from "./SupportAssignmentsPanel";

/**
 * Story 23.10: accounts locked by the velocity limit or by wrong step-up codes. Super Admin reviews each one and unlocks it with a
 * recorded reason (the shared reason field of the page). The lock, the unlock and the reason are audited in the database.
 */
export function SupportLocksPanel({
  locks,
  reason,
  onMessage,
}: {
  locks: SupportLockRow[];
  reason: string;
  onMessage: (m: { kind: "ok" | "error"; text: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;

  function unlock(userId: string) {
    if (!window.confirm(t("support.locks.confirmUnlock"))) return;
    startTransition(async () => {
      const { error } = await unlockSupportAccount({ userId, reason });
      onMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.locks.unlocked") });
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-md border p-6" aria-label={t("support.locks.title")}>
      <h2 className="text-sm font-semibold text-muted-foreground">{t("support.locks.title")}</h2>
      {locks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.locks.empty")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("support.locks.hint")}</p>
          <ul className="space-y-3 text-sm">
            {locks.map((lock) => (
              <li key={lock.userId} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {lock.displayName ?? "—"} <span className="font-normal text-muted-foreground">{lock.email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`support.locks.reasons.${lock.lockedReason ?? "unknown"}`, { defaultValue: t("support.locks.reasons.unknown") })} ·{" "}
                    {new Date(lock.lockedAt).toLocaleString(i18n.language)}
                    {lock.gymNames ? ` · ${lock.gymNames}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={pending || !reasonOk} onClick={() => unlock(lock.userId)}>
                  {t("support.locks.unlock")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
