"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Trash2, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  deactivateSupportAccount,
  removeSupportAccount,
  sendSupportInvite,
  type SupportAccountRow,
  type SupportLifecycleRow,
} from "../actions";
import type { SupportMessage } from "./constants";
import { PagedTable } from "./PagedTable";
import { RowActions } from "./RowActions";
import { SupportActionModal } from "./SupportActionModal";

type Target = { kind: "deactivate" | "remove"; row: SupportAccountRow } | null;

/** Story 23.4 / 23.12: the support accounts table. Names and addresses are visible here only. */
export function SupportAccountsPanel({
  accounts,
  lifecycle,
  onMessage,
}: {
  accounts: SupportAccountRow[];
  lifecycle: SupportLifecycleRow[];
  onMessage: (m: SupportMessage) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Target>(null);

  // Story 23.11: after an executed authenticator reset the person is re-invited from this table
  const resetExecuted = new Set(lifecycle.filter((l) => l.resetState === "executed").map((l) => l.userId));

  function invite(userId: string) {
    startTransition(async () => {
      const { error } = await sendSupportInvite(userId);
      onMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.toast.inviteSent") });
      router.refresh();
    });
  }

  function inviteLabel(row: SupportAccountRow): string {
    if (row.inviteState === "pending" && row.inviteExpiresAt) {
      return t("support.invite.pending", { when: new Date(row.inviteExpiresAt).toLocaleString(i18n.language) });
    }
    return t(`support.invite.${row.inviteState}`);
  }

  return (
    <>
      <PagedTable
        items={accounts}
        empty={t("support.empty")}
        label={t("support.tabs.accounts")}
        head={[t("support.columns.name"), t("support.columns.email"), t("support.columns.state"), t("support.columns.invite"), t("support.columns.actions")]}
        row={(row) => (
          <tr key={row.userId} className="border-b last:border-b-0">
            <td className="py-2 pl-3 pr-4">{row.displayName ?? "—"}</td>
            <td className="py-2 pr-4">{row.email}</td>
            <td className="py-2 pr-4">
              {row.inviteState === "deactivated" ? t("support.state.deactivated") : row.activated ? t("support.state.active") : t("support.state.inactive")}
              {row.assignable ? ` · ${t("support.state.assignable")}` : ""}
            </td>
            <td className="py-2 pr-4">{inviteLabel(row)}</td>
            <td className="py-2 pr-3">
              <RowActions
                name={row.displayName ?? row.email}
                disabled={pending}
                actions={[
                  ...((!row.activated || resetExecuted.has(row.userId)) && row.inviteState !== "deactivated"
                    ? [
                        {
                          key: "invite",
                          label: row.inviteState === "none" ? t("support.actions.sendInvite") : t("support.actions.resendInvite"),
                          icon: <Send size={14} />,
                          onSelect: () => invite(row.userId),
                        },
                      ]
                    : []),
                  ...(row.inviteState !== "deactivated"
                    ? [{ key: "deactivate", label: t("support.actions.deactivate"), icon: <UserX size={14} />, destructive: true, onSelect: () => setTarget({ kind: "deactivate", row }) }]
                    : []),
                  ...(!row.activated
                    ? [{ key: "remove", label: t("support.actions.remove"), icon: <Trash2 size={14} />, destructive: true, onSelect: () => setTarget({ kind: "remove", row }) }]
                    : []),
                ]}
              />
            </td>
          </tr>
        )}
      />
      {target && (
        <SupportActionModal
          key={`${target.kind}-${target.row.userId}`}
          title={t(`support.modal.title.${target.kind}`)}
          description={t(target.kind === "deactivate" ? "support.actions.confirmDeactivate" : "support.actions.confirmRemove")}
          submitLabel={t(`support.actions.${target.kind}`)}
          run={(reason) => (target.kind === "deactivate" ? deactivateSupportAccount : removeSupportAccount)({ userId: target.row.userId, reason })}
          onDone={() => {
            onMessage({ kind: "ok", text: t(target.kind === "deactivate" ? "support.toast.deactivated" : "support.toast.removed") });
            setTarget(null);
            router.refresh();
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
