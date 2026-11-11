"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { RowActions } from "../../support/components/RowActions";
import { decideHeldPageName, type HeldPageNameRow } from "../actions";

const REASON_MIN = 3;
const REASON_MAX = 500;

/** `generic_word:fitness` becomes the translated reason with the word filled in. */
export function heldReasonParts(heldReason: string): { code: string; detail: string } {
  const i = heldReason.indexOf(":");
  return i === -1 ? { code: heldReason, detail: "" } : { code: heldReason.slice(0, i), detail: heldReason.slice(i + 1) };
}

/**
 * Story 24.7 (FR-202): the held-names queue. One row per name waiting for a decision, oldest first, with its due date (2 business
 * days) and an overdue flag. Approve or reject opens a dialog that collects the reason (required for both); the Owner gets a notice
 * with the outcome and the reason. The dialog lives in this component's state so a stale reason can never decide a different name.
 */
export function HeldNamesClient({ rows }: { rows: HeldPageNameRow[] }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [target, setTarget] = useState<{ row: HeldPageNameRow; approve: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  function open(row: HeldPageNameRow, approve: boolean) {
    setReason("");
    setError(null);
    setDone(null);
    setTarget({ row, approve });
  }

  async function submit() {
    if (!target || !reasonOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await decideHeldPageName({ id: target.row.id, approve: target.approve, reason: reason.trim() });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setDone(t(target.approve ? "pageNames.approved" : "pageNames.rejected", { name: target.row.name }));
      setTarget(null);
      router.refresh();
    } catch {
      // a thrown server action (network, deploy skew) must not leave the dialog silent
      setError(t("pageNames.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("pageNames.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("pageNames.hint")}</p>
      </div>
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pageNames.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm" aria-label={t("pageNames.title")}>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pl-3 pr-4 font-medium">{t("pageNames.columns.name")}</th>
                <th className="py-2 pr-4 font-medium">{t("pageNames.columns.gym")}</th>
                <th className="py-2 pr-4 font-medium">{t("pageNames.columns.kind")}</th>
                <th className="py-2 pr-4 font-medium">{t("pageNames.columns.reason")}</th>
                <th className="py-2 pr-4 font-medium">{t("pageNames.columns.due")}</th>
                <th className="py-2 pr-3 font-medium">{t("pageNames.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { code, detail } = heldReasonParts(row.heldReason);
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="py-2 pl-3 pr-4 font-medium">{row.name}</td>
                    <td className="py-2 pr-4">{row.gymName}</td>
                    <td className="py-2 pr-4">
                      {row.origin === "rename"
                        ? t("pageNames.kind.rename", { current: row.currentName ?? "—" })
                        : t("pageNames.kind.claim")}
                    </td>
                    <td className="py-2 pr-4">{t(`pageNames.reasons.${code}`, { word: detail, defaultValue: code })}</td>
                    <td className="py-2 pr-4">
                      {fmt(row.dueAt)}
                      {row.overdue && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                          {t("pageNames.overdue")}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <RowActions
                        name={row.name}
                        actions={[
                          { key: "approve", label: t("pageNames.approve"), icon: <Check size={14} />, onSelect: () => open(row, true) },
                          { key: "reject", label: t("pageNames.reject"), icon: <X size={14} />, destructive: true, onSelect: () => open(row, false) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <Dialog open onOpenChange={(o) => !o && !busy && setTarget(null)}>
          <DialogContent closeLabel={t("pageNames.cancel")}>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t(target.approve ? "pageNames.approveTitle" : "pageNames.rejectTitle", { name: target.row.name })}</DialogTitle>
                <DialogDescription>{t("pageNames.reasonNote")}</DialogDescription>
              </DialogHeader>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">{t("pageNames.reason")}</span>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} aria-invalid={!reasonOk || undefined} />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setTarget(null)}>
                  {t("pageNames.cancel")}
                </Button>
                <Button type="submit" disabled={!reasonOk || busy}>
                  {busy ? t("pageNames.working") : t(target.approve ? "pageNames.approve" : "pageNames.reject")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
