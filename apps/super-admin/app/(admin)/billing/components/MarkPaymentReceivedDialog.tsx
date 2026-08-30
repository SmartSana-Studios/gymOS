"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppError } from "@gymos/types";

import { Button } from "@/components/ui/button";

/**
 * SA-07's confirm-only dialog (no reason/amount field) for "Mark payment
 * received (out-of-band)". Same native <dialog> shape as
 * gyms/components/GymLifecycleDialog.tsx, simplified: no form fields to
 * validate, just a confirm/cancel.
 */
export function MarkPaymentReceivedDialog({
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
        if (actionError.code === "audit_log_failed") {
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
        <p className="text-sm">{t("billing.markPaymentReceived.confirmText", { gymName })}</p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={submitting}>
            {submitting ? t("billing.markPaymentReceived.marking") : t("billing.markPaymentReceived.confirmButton")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
