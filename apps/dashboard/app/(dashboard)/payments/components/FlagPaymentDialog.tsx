"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { flagPaymentSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PendingPaymentRow } from "@/services/payments";
import { flagPaymentAction } from "../actions";

/**
 * Mirrors DeactivateMemberDialog exactly (mandatory reason >= 5 chars,
 * submit disabled until met, destructive variant).
 */
export function FlagPaymentDialog({
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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = flagPaymentSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await flagPaymentAction(payment.id, parsed.data);
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
          {t("payments.flagDialog.title", {
            amount: payment.amount.toLocaleString(i18n.language),
            name: payment.memberName,
          })}
        </h2>

        <div className="space-y-2">
          <Label htmlFor="flagReason">{t("payments.flagDialog.reason")}</Label>
          <textarea
            id="flagReason"
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
          <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 5}>
            {submitting ? t("payments.flagDialog.flagging") : t("payments.flagDialog.confirmButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
