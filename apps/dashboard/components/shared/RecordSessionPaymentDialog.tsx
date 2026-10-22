"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import {
  getSessionPaymentPanelContextAction,
  recordSessionPaymentAction,
} from "@/app/(dashboard)/payments/actions";
import { dismissFrontDeskAlert } from "@/lib/realtime/frontDeskAlerts";

type SessionPaymentMethod = "cash" | "manual_momo" | "bank_transfer";

const NOTE_MAX_LENGTH = 200;

// Bank transfer is a manager-and-above method (record_session_payment, 0108);
// for a receptionist it is absent from the DOM, not just disabled. The RPC
// is the authority either way.
const BANK_TRANSFER_ROLES = ["manager", "supervisor", "owner", "support"];

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Story 19.9b: the Record Session Payment panel -- one native <dialog> modelled
 * on RenewalModal, opened from the session-required alert, the member modal
 * header and the Classes refusal row. The amount is the member's plan price,
 * shown but never editable (the RPC reads it server-side). Cash is the
 * default; Tara Money is not offered here (a guest paying in the app has its
 * own flow). Each refusal keeps the panel open with its own inline message;
 * focus returns to the control that opened it.
 */
export function RecordSessionPaymentDialog({
  memberId,
  memberName,
  role,
  alertId,
  fallbackFocusId,
  onClose,
  onRecorded,
}: {
  memberId: string;
  memberName: string;
  /** The signed-in staff role, for the Bank Transfer option. Absent = lowest. */
  role?: string;
  /** Set when opened from an alert: dismissed once the payment is recorded. */
  alertId?: string;
  /** Element id to focus on close when the opening control no longer exists
   * (e.g. the alert row it lived in was removed by the success). */
  fallbackFocusId?: string;
  onClose: () => void;
  /** The session payment was recorded (the panel is done; the caller closes it). */
  onRecorded: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // One call at a time: a ref, not just state, so a double click inside the
  // same tick cannot start a second RPC.
  const inFlightRef = useRef(false);

  const [context, setContext] = useState<{
    price: number;
    currency: string;
    recordedByName: string;
  } | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [method, setMethod] = useState<SessionPaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canBankTransfer = role !== undefined && BANK_TRANSFER_ROLES.includes(role);
  const methods: SessionPaymentMethod[] = canBankTransfer
    ? ["cash", "manual_momo", "bank_transfer"]
    : ["cash", "manual_momo"];

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    const trigger = triggerRef.current;
    return () => {
      // Focus returns to the control that opened the panel (native dialog
      // restoration is not guaranteed once that control re-rendered).
      if (trigger && trigger.isConnected) trigger.focus();
      else if (fallbackFocusId) document.getElementById(fallbackFocusId)?.focus();
    };
    // Mount-only: the trigger is captured once; the fallback id is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    getSessionPaymentPanelContextAction(memberId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setContextError(error?.message || t("sessionPayment.errors.previewLoadFailed"));
          return;
        }
        setContext({ price: data.price, currency: data.currency, recordedByName: data.recordedByName });
      })
      .catch(() => {
        if (active) setContextError(t("sessionPayment.errors.previewLoadFailed"));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  function methodLabel(value: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[value];
    return key ? t(key) : value;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlightRef.current) return;
    setFormError(null);
    setNoteError(null);

    const trimmed = note.trim();
    if (trimmed.length > NOTE_MAX_LENGTH) {
      setNoteError(t("sessionPayment.errors.noteTooLong"));
      return;
    }

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const { error } = await recordSessionPaymentAction({
        memberId,
        method,
        reason: trimmed || undefined,
      });
      if (error) {
        // A clean refusal: the panel stays open with its own message.
        setFormError(error.message || t("sessionPayment.errors.generic"));
        return;
      }

      if (alertId) {
        const { error: dismissError } = await dismissFrontDeskAlert(alertId);
        if (dismissError) {
          console.error(
            `RecordSessionPaymentDialog: session for member ${memberId} recorded but dismissing alert ${alertId} failed -- ${dismissError.message}`,
          );
        }
      }
      onRecorded();
    } catch {
      setFormError(t("sessionPayment.errors.generic"));
    } finally {
      inFlightRef.current = false;
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
      aria-labelledby="sessionPaymentTitle"
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 id="sessionPaymentTitle" className="text-lg font-semibold">
          {t("sessionPayment.title", { name: memberName })}
        </h2>

        <div className="space-y-1 rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("sessionPayment.amount")}</span>
            <span className="font-medium">
              {context ? `${context.price.toLocaleString(i18n.language)} ${context.currency}` : "—"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("sessionPayment.amountHint")}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sessionPaymentMethod">{t("sessionPayment.method")}</Label>
          <select
            id="sessionPaymentMethod"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as SessionPaymentMethod);
              setFormError(null);
            }}
            disabled={submitting}
            className={selectClassName}
          >
            {methods.map((value) => (
              <option key={value} value={value}>
                {methodLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sessionPaymentNote">{t("sessionPayment.note")}</Label>
          <textarea
            id="sessionPaymentNote"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            maxLength={NOTE_MAX_LENGTH}
            className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            {t("sessionPayment.noteCount", { count: note.length })}
          </p>
          {noteError && <p className="text-sm text-red-600">{noteError}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sessionPaymentRecordedBy">{t("sessionPayment.recordedBy")}</Label>
          <Input id="sessionPaymentRecordedBy" value={context?.recordedByName ?? ""} readOnly tabIndex={-1} />
        </div>

        {contextError && <p className="text-sm text-red-600">{contextError}</p>}
        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}

        {/* DOM order is the tab order: Method, Note, Record, Cancel. */}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={submitting || !context} className="order-2">
            {submitting ? t("sessionPayment.recording") : t("sessionPayment.recordButton")}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="order-1">
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
