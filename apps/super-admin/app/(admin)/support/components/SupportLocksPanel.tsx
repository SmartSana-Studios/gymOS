"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { unlockSupportAccount, type SupportLockRow } from "../actions";
import type { SupportMessage } from "./constants";
import { PagedTable } from "./PagedTable";
import { RowActions } from "./RowActions";
import { SupportActionModal } from "./SupportActionModal";

/**
 * Story 23.10 / 23.12: accounts locked by the velocity limit or by wrong step-up codes. Super Admin reviews each one and unlocks it with
 * a reason collected in a modal. The lock, the unlock and the reason are audited in the database.
 */
export function SupportLocksPanel({ locks, onMessage }: { locks: SupportLockRow[]; onMessage: (m: SupportMessage) => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [target, setTarget] = useState<SupportLockRow | null>(null);

  return (
    <div className="space-y-3">
      {locks.length > 0 && <p className="text-xs text-muted-foreground">{t("support.locks.hint")}</p>}
      <PagedTable
        items={locks}
        empty={t("support.locks.empty")}
        label={t("support.locks.title")}
        head={[t("support.columns.name"), t("support.locks.columns.reason"), t("support.locks.columns.when"), t("support.locks.columns.gyms"), t("support.columns.actions")]}
        row={(lock) => (
          <tr key={lock.userId} className="border-b last:border-b-0">
            <td className="py-2 pl-3 pr-4">
              <span className="font-medium">{lock.displayName ?? "—"}</span> <span className="text-muted-foreground">{lock.email}</span>
            </td>
            <td className="py-2 pr-4">{t(`support.locks.reasons.${lock.lockedReason ?? "unknown"}`, { defaultValue: t("support.locks.reasons.unknown") })}</td>
            <td className="py-2 pr-4">{new Date(lock.lockedAt).toLocaleString(i18n.language)}</td>
            <td className="py-2 pr-4">{lock.gymNames ?? "—"}</td>
            <td className="py-2 pr-3">
              <RowActions name={lock.displayName ?? lock.email ?? "—"} actions={[{ key: "unlock", label: t("support.locks.unlock"), icon: <Unlock size={14} />, onSelect: () => setTarget(lock) }]} />
            </td>
          </tr>
        )}
      />
      {target && (
        <SupportActionModal
          key={target.userId}
          title={t("support.modal.title.unlock")}
          description={t("support.locks.confirmUnlock")}
          submitLabel={t("support.locks.unlock")}
          run={(reason) => unlockSupportAccount({ userId: target.userId, reason })}
          onDone={() => {
            onMessage({ kind: "ok", text: t("support.locks.unlocked") });
            setTarget(null);
            router.refresh();
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
