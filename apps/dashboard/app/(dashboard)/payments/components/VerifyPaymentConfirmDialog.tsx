"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { PendingPaymentRow } from "@/services/payments";
import { verifyPaymentAction } from "../actions";

/**
 * Mirrors CheckOutMemberConfirmDialog's structural pattern (native
 * `<dialog>`, same submitting/error state shape) -- no reason field, plain
 * confirm. UX-DR12: the confirm title names the specific target, not
 * "Confirm".
 */
export function VerifyPaymentConfirmDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: PendingPaymentRow;
  onClose: () => void;
  onDone: (warning?: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: actionError } = await verifyPaymentAction(payment.id);
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
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">
          {t("payments.verifyDialog.title", {
            amount: payment.amount.toLocaleString(i18n.language),
            name: payment.memberName,
          })}
        </h2>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("payments.verifyDialog.verifying") : t("payments.verifyDialog.confirmButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
