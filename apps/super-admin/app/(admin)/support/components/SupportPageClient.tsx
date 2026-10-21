"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSupportAccount,
  deactivateSupportAccount,
  removeSupportAccount,
  sendSupportInvite,
  type SupportAccountRow,
  type SupportAssignmentRow,
} from "../actions";
import { REASON_MAX, REASON_MIN, SupportAssignmentsPanel } from "./SupportAssignmentsPanel";

/** Story 23.4: GymOS support accounts (names and addresses are visible here only). Create, then send the invite. */
export function SupportPageClient({
  initialAccounts,
  assignments,
  gyms,
}: {
  initialAccounts: SupportAccountRow[];
  assignments: SupportAssignmentRow[];
  gyms: { id: string; name: string }[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const { error } = await createSupportAccount({ displayName, email });
      if (error) {
        setMessage({ kind: "error", text: error.message });
        return;
      }
      setDisplayName("");
      setEmail("");
      setMessage({ kind: "ok", text: t("support.toast.created") });
      router.refresh();
    });
  }

  function invite(userId: string) {
    startTransition(async () => {
      const { error } = await sendSupportInvite(userId);
      setMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.toast.inviteSent") });
      router.refresh();
    });
  }

  function accountAction(kind: "deactivate" | "remove", userId: string) {
    if (!window.confirm(t(kind === "deactivate" ? "support.actions.confirmDeactivate" : "support.actions.confirmRemove"))) return;
    startTransition(async () => {
      const run = kind === "deactivate" ? deactivateSupportAccount : removeSupportAccount;
      const { error } = await run({ userId, reason });
      setMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t(kind === "deactivate" ? "support.toast.deactivated" : "support.toast.removed") });
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("support.title")}</h1>

      <form onSubmit={create} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("support.create.name")}</span>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("support.create.email")}</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gymosapps.com" required />
        </label>
        <Button type="submit" disabled={pending}>
          {t("support.create.submit")}
        </Button>
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("support.create.hint")}</p>
      </form>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t("support.assign.reason")}</span>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder={t("support.assign.reasonHint")} />
      </label>

      {message && (
        <p role="status" className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}

      {initialAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pl-3 pr-4 font-medium">{t("support.columns.name")}</th>
                <th className="py-2 pr-4 font-medium">{t("support.columns.email")}</th>
                <th className="py-2 pr-4 font-medium">{t("support.columns.state")}</th>
                <th className="py-2 pr-4 font-medium">{t("support.columns.invite")}</th>
                <th className="py-2 pr-3 font-medium">{t("support.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {initialAccounts.map((row) => (
                <tr key={row.userId} className="border-b last:border-b-0">
                  <td className="py-2 pl-3 pr-4">{row.displayName ?? "—"}</td>
                  <td className="py-2 pr-4">{row.email}</td>
                  <td className="py-2 pr-4">
                    {row.inviteState === "deactivated" ? t("support.state.deactivated") : row.activated ? t("support.state.active") : t("support.state.inactive")}
                    {row.assignable ? ` · ${t("support.state.assignable")}` : ""}
                  </td>
                  <td className="py-2 pr-4">{inviteLabel(row)}</td>
                  <td className="py-2 pr-3">
                    {!row.activated && row.inviteState !== "deactivated" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => invite(row.userId)}>
                        {row.inviteState === "none" ? t("support.actions.sendInvite") : t("support.actions.resendInvite")}
                      </Button>
                    )}
                    {row.inviteState !== "deactivated" && (
                      <Button size="sm" variant="outline" className="ml-2" disabled={pending || !reasonOk} onClick={() => accountAction("deactivate", row.userId)}>
                        {t("support.actions.deactivate")}
                      </Button>
                    )}
                    {!row.activated && (
                      <Button size="sm" variant="outline" className="ml-2" disabled={pending || !reasonOk} onClick={() => accountAction("remove", row.userId)}>
                        {t("support.actions.remove")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SupportAssignmentsPanel assignments={assignments} accounts={initialAccounts} gyms={gyms} reason={reason} onMessage={setMessage} />
    </div>
  );
}
