"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@gymos/types";

import { Button } from "@/components/ui/button";

/**
 * "Trigger retry" -- SA-07 doesn't specify confirm-dialog copy for this
 * action (unlike the other three), but a manual, outside-schedule send
 * still warrants an explicit confirm step rather than firing on a single
 * row-button click.
 */
export function TriggerRetryDialog({
  gymId,
  gymName,
  onClose,
  onDone,
  runAction,
}: {
  gymId: string;
  gymName: string;
  onClose: () => void;
  onDone: (warning?: string) => void;
  runAction: (gymId: string) => Promise<{ error: AppError | null }>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const { error: actionError } = await runAction(gymId);
      if (actionError) {
        // "no_owner_phone"/"audit_log_failed" both mean the action itself
        // completed (the audit trail exists) -- surface as a warning toast
        // rather than a blocking dialog error, matching
        // GymLifecycleDialog's own no_op/audit_log_failed precedent.
        if (actionError.code === "no_owner_phone" || actionError.code === "audit_log_failed") {
          onDone(actionError.message);
          return;
        }
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
      <div className="space-y-4 p-6">
        <p className="text-sm">{t("billing.triggerRetry.confirmText", { gymName })}</p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? t("billing.triggerRetry.sending") : t("billing.triggerRetry.confirmButton")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
