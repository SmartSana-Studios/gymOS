"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { changeSupportContact, recertifySupportAccount, startSupportFactorReset, type SupportLifecycleRow } from "../actions";
import { type SupportMessage } from "./constants";
import { PagedTable } from "./PagedTable";
import { RowActions } from "./RowActions";
import { SupportActionModal } from "./SupportActionModal";

type Target = { kind: "recertify" | "reset" | "email"; row: SupportLifecycleRow } | null;

/**
 * Story 23.11 / 23.12: the lifecycle of each activated support person: recertification (due date, lapsed), authenticator reset
 * (identity check, 30-minute cooling-off, step-up with a fresh code) and the e-mail change. Every action opens its own modal.
 * The individual's name is shown here only. "Run due resets" lives with the page's top buttons.
 */
export function SupportLifecyclePanel({ rows, onMessage }: { rows: SupportLifecycleRow[]; onMessage: (m: SupportMessage) => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [target, setTarget] = useState<Target>(null);
  const [newEmail, setNewEmail] = useState("");
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const visible = rows.filter((r) => r.activated && !r.deactivated);

  function open(kind: "recertify" | "reset" | "email", row: SupportLifecycleRow) {
    setNewEmail("");
    setTarget({ kind, row });
  }
  function done(text: string) {
    onMessage({ kind: "ok", text });
    setTarget(null);
    router.refresh();
  }

  function resetLabel(r: SupportLifecycleRow): string {
    if (!r.resetState) return r.resetPendingAt ? t("support.lifecycle.reset.pending") : "—";
    const when = r.resetExecutesAt ? fmt(r.resetExecutesAt) : "";
    return t(`support.lifecycle.reset.${r.resetState}`, { when, defaultValue: t("support.lifecycle.reset.pending") });
  }

  function statusLabel(r: SupportLifecycleRow): string {
    const due = r.recertifyDueAt
      ? r.recertificationLapsed
        ? t("support.lifecycle.lapsed", { date: fmt(r.recertifyDueAt) })
        : t("support.lifecycle.due", { date: fmt(r.recertifyDueAt) })
      : t("support.lifecycle.noDue");
    return (
      due +
      (r.lastActiveAt ? ` · ${t("support.lifecycle.lastActive", { date: fmt(r.lastActiveAt) })}` : "") +
      (r.lockedAt ? ` · ${t(`support.locks.reasons.${r.lockedReason ?? "unknown"}`, { defaultValue: t("support.locks.reasons.unknown") })}` : "")
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("support.lifecycle.hint")}</p>
      <PagedTable
        items={visible}
        empty={t("support.lifecycle.empty")}
        label={t("support.lifecycle.title")}
        head={[t("support.columns.name"), t("support.lifecycle.columns.status"), t("support.lifecycle.columns.reset"), t("support.columns.actions")]}
        row={(r) => {
          const resetOpen = r.resetPendingAt !== null || r.resetState !== null;
          return (
            <tr key={r.userId} className="border-b last:border-b-0">
              <td className="py-2 pl-3 pr-4">
                <span className="font-medium">{r.displayName ?? "—"}</span> <span className="text-muted-foreground">{r.email}</span>
              </td>
              <td className="py-2 pr-4">{statusLabel(r)}</td>
              <td className="py-2 pr-4">{resetLabel(r)}</td>
              <td className="py-2 pr-3">
                <RowActions
                  name={r.displayName ?? r.email ?? "—"}
                  actions={[
                    { key: "recertify", label: t("support.lifecycle.recertify"), icon: <ShieldCheck size={14} />, onSelect: () => open("recertify", r) },
                    ...(resetOpen
                      ? []
                      : [
                          { key: "reset", label: t("support.lifecycle.reset.action"), icon: <KeyRound size={14} />, onSelect: () => open("reset", r) },
                          { key: "email", label: t("support.lifecycle.changeEmail"), icon: <Mail size={14} />, onSelect: () => open("email", r) },
                        ]),
                  ]}
                />
              </td>
            </tr>
          );
        }}
      />
      {target?.kind === "recertify" && (
        <SupportActionModal
          key={`recertify-${target.row.userId}`}
          title={t("support.modal.title.recertify")}
          description={t("support.lifecycle.confirmRecertify")}
          submitLabel={t("support.lifecycle.recertify")}
          run={(reason) => recertifySupportAccount({ userId: target.row.userId, reason })}
          onDone={() => done(t("support.lifecycle.recertified"))}
          onClose={() => setTarget(null)}
        />
      )}
      {target?.kind === "reset" && (
        <SupportActionModal
          key={`reset-${target.row.userId}`}
          title={t("support.modal.title.reset")}
          description={t("support.lifecycle.resetExplain")}
          submitLabel={t("support.lifecycle.reset.start")}
          reasonLabel={t("support.lifecycle.identityNote")}
          reasonHint={t("support.lifecycle.identityNoteHint")}
          stepUp={{ action: "start_support_factor_reset", subjectId: target.row.userId }}
          run={(identityNote) => startSupportFactorReset({ userId: target.row.userId, identityNote })}
          onDone={(data) => done(t("support.lifecycle.resetStarted", { when: data?.executesAt ? fmt(data.executesAt) : "" }))}
          onClose={() => setTarget(null)}
        />
      )}
      {target?.kind === "email" && (
        <SupportActionModal
          key={`email-${target.row.userId}`}
          title={t("support.modal.title.email")}
          description={t("support.lifecycle.emailExplain")}
          submitLabel={t("support.lifecycle.changeEmailSubmit")}
          extraValid={newEmail.trim().length > 0}
          extra={
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t("support.lifecycle.newEmail")}</span>
              <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@gymosapps.com" />
            </label>
          }
          run={(reason) => changeSupportContact({ userId: target.row.userId, email: newEmail, reason })}
          onDone={() => done(t("support.lifecycle.emailChanged"))}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
