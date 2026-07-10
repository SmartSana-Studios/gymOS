"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { escalateGymAccessSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { GymDetail } from "@/services/gyms";
import { escalateGymAccess } from "../../actions";

/**
 * SA-03 "Access gym data" escalation (FR-072/AC #2). Mandatory reason,
 * audit-logged with the Super Admin's identity/reason/timestamp. Same
 * native <dialog> pattern as GymLifecycleDialog/ChangeTierDialog. Unlike
 * those dialogs, a failure here is always a real, blocking error -- there
 * is no "no_op"/"audit_log_failed" benign-outcome code for this action,
 * since the audit write IS the grant (nothing else could have "already
 * saved").
 */
export function EscalateAccessDialog({
  gym,
  onClose,
  onDone,
}: {
  gym: GymDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = escalateGymAccessSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await escalateGymAccess(gym.id, parsed.data);
      if (actionError) {
        setError(actionError.message);
        return;
      }
      onDone();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("gyms.escalate.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("gyms.escalate.body", { gymName: gym.name })}
        </p>

        <div className="space-y-2">
          <Label htmlFor="reason">{t("gyms.lifecycle.reason")}</Label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("gyms.escalate.requesting") : t("gyms.escalate.accessButton", { gymName: gym.name })}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
