"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import { confirmRenewalSchema, type ConfirmRenewalInput } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { dismissFrontDeskAlert } from "@/lib/realtime/frontDeskAlerts";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import { confirmRenewalAction, getRenewalPreviewAction } from "@/app/(dashboard)/subscriptions/actions";
import type { RenewalPreview } from "@/services/subscriptions";

interface FieldErrors {
  reason?: string;
}

// confirmRenewalSchema's own issue messages are hardcoded English literals
// (matches RecordRefundModal/RecordPaymentModal's established pattern) --
// map every reachable field to its own translated fallback instead of ever
// displaying issue.message directly. `memberId`/`method` are never
// user-editable inputs here (memberId is a prop, method is a closed enum
// select) so only `reason` (the Note field) has a reachable field error.
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  reason: "renewalPanel.errors.reasonInvalid",
};

const METHOD_OPTIONS: { value: ConfirmRenewalInput["method"] }[] = [
  { value: "cash" },
  { value: "bank_transfer" },
  { value: "manual_momo" },
];

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Story 4.7, converted to a `<dialog>` modal per user direction -- matches
 * RecordPaymentModal/RecordRefundModal/FlagPaymentDialog's established
 * modal pattern instead of UX-DR3's original inline-expansion/no-backdrop
 * spec (documented as a deliberate deviation in docs/decisions.md). Only
 * wired up from FrontDeskAlertPanel in this story (Scope Notes) -- built as
 * a standalone reusable component so Story 4.8's Subscriptions page can
 * render it from a table row later.
 */
export function RenewalModal({
  alertId,
  memberId,
  memberName,
  onClose,
  onRenewed,
}: {
  alertId: string;
  memberId: string;
  memberName: string;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [preview, setPreview] = useState<RenewalPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [method, setMethod] = useState<ConfirmRenewalInput["method"]>("cash");
  const [note, setNote] = useState(t("renewalPanel.notePrefillCash"));

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Review finding: set only when confirmRenewalAction's outcome is
  // ambiguous (the request may have reached the server and succeeded even
  // though this client never got a response back -- dropped connection,
  // timeout). Kept separate from `submitting` so Cancel/close still work;
  // only Confirm stays disabled, since a blind retry in that state could
  // double-submit confirm_renewal(). Closing and reopening the panel (a
  // fresh mount, fresh preview fetch) is the safe way to try again.
  const [retryBlocked, setRetryBlocked] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingPreview(true);
    getRenewalPreviewAction(memberId)
      .then(({ data, error }) => {
        if (!active) return;
        setLoadingPreview(false);
        if (error || !data) {
          setPreviewError(error?.message ?? t("renewalPanel.errors.noActivePlan"));
          return;
        }
        setPreview(data);
      })
      .catch(() => {
        // Review finding: an unhandled rejection here previously left the
        // panel stuck on its loading state forever, with Confirm disabled
        // and no way to recover short of closing the panel.
        if (!active) return;
        setLoadingPreview(false);
        setPreviewError(t("renewalPanel.errors.previewLoadFailed"));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // UX: "pre-filled 'Paid at desk' for Cash; cleared when method changes".
  function handleMethodChange(nextMethod: ConfirmRenewalInput["method"]) {
    setMethod(nextMethod);
    setNote(nextMethod === "cash" ? t("renewalPanel.notePrefillCash") : "");
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  }

  function resetAndClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = confirmRenewalSchema.safeParse({ memberId, method, reason: note });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (field === "reason" && !errors[field]) {
          errors[field] = t(FIELD_ERROR_KEY[field]);
        }
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await confirmRenewalAction(parsed.data);
      if (error) {
        // A clean response was received -- the server definitely rejected
        // this call (review finding: previously the specific mapped message
        // was discarded in favor of a generic one, even for already-friendly
        // errors like member_deactivated). Safe to re-enable Confirm for a
        // real retry.
        setFormError(error.message || t("renewalPanel.errors.confirmFailed"));
        setSubmitting(false);
        return;
      }

      // Review finding: the dismiss call's error was previously discarded --
      // a failed dismiss after a successful renewal closed the panel as if
      // nothing went wrong, leaving the alert stuck with no signal to staff.
      const { error: dismissError } = await dismissFrontDeskAlert(alertId);
      if (dismissError) {
        console.error(
          `RenewalModal: renewal for member ${memberId} succeeded but dismissing alert ${alertId} failed -- ${dismissError.message}`,
        );
      }
      onRenewed();
    } catch {
      // Review finding: this request may have reached the server and
      // succeeded even though this client never got a response back. Leave
      // Confirm disabled (retryBlocked) rather than risking a duplicate
      // confirm_renewal() call -- re-enable submitting so Cancel still
      // works.
      setSubmitting(false);
      setRetryBlocked(true);
      setFormError(t("renewalPanel.errors.confirmFailed"));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("renewalPanel.title")}</h2>
          <button
            type="button"
            aria-label={t("renewalPanel.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {memberName.slice(0, 1).toUpperCase()}
          </div>
          <span className="font-medium">{memberName}</span>
        </div>

        {loadingPreview ? null : previewError ? (
          <p className="text-sm text-red-600">{previewError}</p>
        ) : preview ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("renewalPanel.plan")}</span>
              <span>{preview.planName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("renewalPanel.startDate")}</span>
              <span>{t("renewalPanel.startDateToday")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("renewalPanel.price")}</span>
              <span>
                {preview.currency} {preview.price.toLocaleString()}
              </span>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`renewalMethod-${alertId}`}>{t("renewalPanel.method")}</Label>
          <select
            id={`renewalMethod-${alertId}`}
            value={method}
            onChange={(e) => handleMethodChange(e.target.value as ConfirmRenewalInput["method"])}
            disabled={submitting || !preview}
            className={selectClassName}
          >
            {METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {methodLabel(option.value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`renewalNote-${alertId}`}>{t("renewalPanel.note")} *</Label>
          <textarea
            id={`renewalNote-${alertId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting || !preview}
            className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("renewalPanel.noteCount", { count: note.length })}</p>
          {fieldErrors.reason && <p className="text-sm text-red-600">{fieldErrors.reason}</p>}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !preview || retryBlocked}>
            {submitting ? (
              t("renewalPanel.confirming")
            ) : (
              <>
                {t("renewalPanel.confirmButton")}
                <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
