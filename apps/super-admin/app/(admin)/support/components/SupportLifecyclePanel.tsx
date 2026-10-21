"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepUpPrompt } from "@/components/step-up-prompt";
import {
  changeSupportContact,
  recertifySupportAccount,
  runDueFactorResets,
  startSupportFactorReset,
  type SupportLifecycleRow,
} from "../actions";
import { REASON_MAX, REASON_MIN } from "./SupportAssignmentsPanel";

const STEP_UP_REQUIRED_CODE = "step_up_required"; // same value as lib/authz (server-only)

type Form = { userId: string; kind: "reset" | "email" } | null;

/**
 * Story 23.11: the lifecycle of each activated support person: recertification (due date, lapsed), authenticator reset (identity check,
 * 30-minute cooling-off, step-up with a fresh code) and the e-mail change. The individual's name is shown here only.
 */
export function SupportLifecyclePanel({
  rows,
  reason,
  onMessage,
}: {
  rows: SupportLifecycleRow[];
  /** The page's shared reason field (3 to 500 characters), used for recertification and the e-mail change. */
  reason: string;
  onMessage: (m: { kind: "ok" | "error"; text: string }) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Form>(null);
  const [identityNote, setIdentityNote] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [stepUpFor, setStepUpFor] = useState<string | null>(null);
  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  const noteOk = identityNote.trim().length >= REASON_MIN && identityNote.trim().length <= REASON_MAX;
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const visible = rows.filter((r) => r.activated && !r.deactivated);

  function close() {
    setForm(null);
    setIdentityNote("");
    setNewEmail("");
    setStepUpFor(null);
  }

  function recertify(userId: string) {
    if (!window.confirm(t("support.lifecycle.confirmRecertify"))) return;
    startTransition(async () => {
      const { error } = await recertifySupportAccount({ userId, reason });
      onMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.lifecycle.recertified") });
      router.refresh();
    });
  }

  function startReset(userId: string) {
    startTransition(async () => {
      const { data, error } = await startSupportFactorReset({ userId, identityNote });
      if (error?.code === STEP_UP_REQUIRED_CODE) {
        setStepUpFor(userId);
        return;
      }
      if (error) {
        onMessage({ kind: "error", text: error.message });
        return;
      }
      setStepUpFor(null);
      onMessage({ kind: "ok", text: t("support.lifecycle.resetStarted", { when: data?.executesAt ? fmt(data.executesAt) : "" }) });
      close();
      router.refresh();
    });
  }

  function changeEmail(userId: string) {
    startTransition(async () => {
      const { error } = await changeSupportContact({ userId, email: newEmail, reason });
      onMessage(error ? { kind: "error", text: error.message } : { kind: "ok", text: t("support.lifecycle.emailChanged") });
      if (!error) close();
      router.refresh();
    });
  }

  function runDue() {
    startTransition(async () => {
      const { data, error } = await runDueFactorResets();
      onMessage(
        error
          ? { kind: "error", text: error.message }
          : { kind: "ok", text: t("support.lifecycle.ran", { done: data?.done ?? 0, failed: data?.failed ?? 0 }) },
      );
      router.refresh();
    });
  }

  function resetLabel(r: SupportLifecycleRow): string | null {
    if (!r.resetState) return r.resetPendingAt ? t("support.lifecycle.reset.pending") : null;
    const when = r.resetExecutesAt ? fmt(r.resetExecutesAt) : "";
    return t(`support.lifecycle.reset.${r.resetState}`, { when, defaultValue: t("support.lifecycle.reset.pending") });
  }

  return (
    <section className="space-y-3 rounded-md border p-6" aria-label={t("support.lifecycle.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("support.lifecycle.title")}</h2>
        <Button size="sm" variant="outline" disabled={pending} onClick={runDue}>
          {t("support.lifecycle.runDue")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("support.lifecycle.hint")}</p>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("support.lifecycle.empty")}</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {visible.map((r) => {
            const label = resetLabel(r);
            const resetOpen = r.resetPendingAt !== null || r.resetState !== null;
            return (
              <li key={r.userId} className="space-y-2 border-b pb-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {r.displayName ?? "—"} <span className="font-normal text-muted-foreground">{r.email}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.recertifyDueAt
                        ? r.recertificationLapsed
                          ? t("support.lifecycle.lapsed", { date: fmt(r.recertifyDueAt) })
                          : t("support.lifecycle.due", { date: fmt(r.recertifyDueAt) })
                        : t("support.lifecycle.noDue")}
                      {r.lastActiveAt ? ` · ${t("support.lifecycle.lastActive", { date: fmt(r.lastActiveAt) })}` : ""}
                      {r.lockedAt ? ` · ${t(`support.locks.reasons.${r.lockedReason ?? "unknown"}`, { defaultValue: t("support.locks.reasons.unknown") })}` : ""}
                      {label ? ` · ${label}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={pending || !reasonOk} onClick={() => recertify(r.userId)}>
                      {t("support.lifecycle.recertify")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending || resetOpen} onClick={() => setForm({ userId: r.userId, kind: "reset" })}>
                      {t("support.lifecycle.reset.action")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending || resetOpen} onClick={() => setForm({ userId: r.userId, kind: "email" })}>
                      {t("support.lifecycle.changeEmail")}
                    </Button>
                  </div>
                </div>

                {form?.userId === r.userId && form.kind === "reset" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <label className="block space-y-1 text-xs">
                      <span className="font-medium">{t("support.lifecycle.identityNote")}</span>
                      <Input value={identityNote} onChange={(e) => setIdentityNote(e.target.value)} maxLength={REASON_MAX} placeholder={t("support.lifecycle.identityNoteHint")} />
                    </label>
                    <p className="text-xs text-muted-foreground">{t("support.lifecycle.resetExplain")}</p>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending || !noteOk} onClick={() => startReset(r.userId)}>
                        {t("support.lifecycle.reset.start")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={close}>
                        {t("support.lifecycle.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
                {form?.userId === r.userId && form.kind === "email" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <label className="block space-y-1 text-xs">
                      <span className="font-medium">{t("support.lifecycle.newEmail")}</span>
                      <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@gymosapps.com" />
                    </label>
                    <p className="text-xs text-muted-foreground">{t("support.lifecycle.emailExplain")}</p>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={pending || !reasonOk || newEmail.trim().length === 0} onClick={() => changeEmail(r.userId)}>
                        {t("support.lifecycle.changeEmailSubmit")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={close}>
                        {t("support.lifecycle.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {stepUpFor && (
        <StepUpPrompt action="start_support_factor_reset" subjectId={stepUpFor} onCancel={() => setStepUpFor(null)} onIssued={() => startReset(stepUpFor)} />
      )}
    </section>
  );
}
