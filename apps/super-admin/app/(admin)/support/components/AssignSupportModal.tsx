"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { REASON_MAX, reasonValid, type SupportMessage } from "./constants";
import { Input } from "@/components/ui/input";
import { assignSupport, type SupportAccountRow } from "../actions";

/** Story 23.12: assign a support person to a gym with a reason. On the gym detail page `fixedGymId` pins the gym. */
export function AssignSupportModal({
  accounts,
  gyms,
  fixedGymId,
  onClose,
  onMessage,
}: {
  accounts: SupportAccountRow[];
  gyms?: { id: string; name: string }[];
  fixedGymId?: string;
  onClose: () => void;
  onMessage: (m: SupportMessage) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [gymId, setGymId] = useState(fixedGymId ?? "");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assignable = accounts.filter((a) => a.assignable && a.inviteState !== "deactivated");
  const valid = !!userId && !!(fixedGymId ?? gymId) && reasonValid(reason);
  const showReasonError = touched && !reasonValid(reason);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await assignSupport({ userId, gymId: fixedGymId ?? gymId, reason: reason.trim() });
      if (err) {
        setError(err.message);
        return;
      }
      onMessage({ kind: "ok", text: t(`support.assign.done.${data?.code ?? "ok"}`, { defaultValue: t("support.assign.done.ok") }) });
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent closeLabel={t("support.modal.cancel")}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("support.modal.title.assign")}</DialogTitle>
            <DialogDescription>{t("support.assign.hint")}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("support.assign.person")}</span>
            <select className="h-9 w-full rounded-md border bg-background px-2" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t("support.assign.choose")}</option>
              {assignable.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {(a.displayName ?? a.email) + (a.activated ? "" : ` (${t("support.state.inactive")})`)}
                </option>
              ))}
            </select>
          </label>
          {!fixedGymId && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t("support.assign.gym")}</span>
              <select className="h-9 w-full rounded-md border bg-background px-2" value={gymId} onChange={(e) => setGymId(e.target.value)}>
                <option value="">{t("support.assign.choose")}</option>
                {(gyms ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("support.modal.reason")}</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} maxLength={REASON_MAX} placeholder={t("support.modal.reasonHint")} />
          </label>
          {showReasonError && (
            <p role="alert" className="text-sm text-destructive">
              {t("support.modal.reasonInvalid")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("support.modal.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {t("support.assign.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
