"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VOID_REASON_MAX_LENGTH, VOID_REASON_MIN_LENGTH } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SupportCodeField, goToLoginExpired, isSupportCodeWellFormed } from "@/components/support-code-field";
import { voidStaffCheckInAction } from "../actions";

/** The row the modal acts on: what the page already knows, as the database reported it (list_attendance_log). */
export interface VoidTarget {
  attendanceId: string;
  memberName: string;
  checkedInAt: string;
  consumedSession: boolean | null;
  /** Paid (true) or free loyalty (false) session, for the wording; absent or null is read as paid. */
  consumedSessionPaid?: boolean | null;
  earnedStamp: boolean | null;
}

type Refusal = "laterVisit" | "laterVisitStaff" | "notToday" | "already" | "notStaff" | "notFound";

/**
 * Story 27.3, UX AD-11 V1.8: the Void modal (Manager and above, GymOS Support behind a code). Focus opens on [Keep check-in] and
 * Escape is disabled: a void is consequential. The conditional lines appear only when the server reported that the entry used a session
 * or earned a stamp. A refusal stays inline with `role="alert"` and a [Close]; "already voided" also refreshes the list. A network
 * failure keeps [Void check-in] enabled. The member is not notified.
 */
export function VoidCheckInModal({
  target,
  isSupport = false,
  onClose,
  onVoided,
  onStale,
}: {
  target: VoidTarget;
  /** A GymOS Support session types a fresh authenticator code; staff roles see no change. */
  isSupport?: boolean;
  onClose: () => void;
  /** The void succeeded: the page closes the modal, refreshes, and shows the toast. */
  onVoided: () => void;
  /** The row is already voided (or otherwise out of date): refresh the list. */
  onStale: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const [reason, setReason] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reasonError, setReasonError] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const time = new Date(target.checkedInAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false });
  const trimmedLength = reason.trim().length;
  const reasonValid = trimmedLength >= VOID_REASON_MIN_LENGTH && trimmedLength <= VOID_REASON_MAX_LENGTH;
  const codeValid = !isSupport || isSupportCodeWellFormed(authCode);

  useEffect(() => {
    dialogRef.current?.showModal();
    // The native dialog focuses its first control; the modal opens on [Keep check-in] instead.
    keepRef.current?.focus();
  }, []);

  async function handleVoid() {
    if (inFlightRef.current) return;
    setReasonError(false);
    setNetworkError(false);
    setActionError(null);
    if (!reasonValid) {
      setReasonError(true);
      return;
    }
    if (!codeValid) {
      setActionError(t("supportStepUp.codeRequired"));
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      const input = { attendanceId: target.attendanceId, reason: reason.trim() };
      const { data, error } = await voidStaffCheckInAction(isSupport ? { ...input, authCode } : input);
      setAuthCode("");
      if (error || !data) {
        if (error?.code === "account_locked") {
          goToLoginExpired();
          return;
        }
        setActionError(error?.message ?? null);
        setNetworkError(!error);
        return;
      }
      switch (data.outcome) {
        case "voided":
          onVoided();
          return;
        case "invalid_reason":
          setReasonError(true);
          return;
        case "later_visit_relies":
          setRefusal(data.laterIsStaffEntry ? "laterVisitStaff" : "laterVisit");
          return;
        case "not_same_day":
          setRefusal("notToday");
          return;
        case "already_voided":
          setRefusal("already");
          onStale();
          return;
        case "not_staff_entry":
          setRefusal("notStaff");
          return;
        default:
          setRefusal("notFound");
          onStale();
      }
    } catch {
      setAuthCode("");
      setNetworkError(true);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const refusalText =
    refusal === null
      ? null
      : refusal === "laterVisit" || refusal === "laterVisitStaff"
        ? t("attendance.void.refused.laterVisit", { name: target.memberName })
        : t(
            refusal === "notToday"
              ? "attendance.void.refused.notToday"
              : refusal === "already"
                ? "attendance.void.refused.already"
                : refusal === "notStaff"
                  ? "attendance.void.refused.notStaff"
                  : "attendance.void.refused.notFound",
          );

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // Escape is disabled: closing is a choice made with a button, never by a stray key.
      onCancel={(e) => e.preventDefault()}
      aria-labelledby="voidCheckInTitle"
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <h2 id="voidCheckInTitle" className="text-lg font-semibold">
          {t("attendance.void.title")}
        </h2>
        <p className="text-sm">{t("attendance.void.body", { name: target.memberName, time })}</p>

        {target.consumedSession && (
          <div className="space-y-1 text-sm">
            <p>{t(target.consumedSessionPaid === false ? "attendance.void.sessionBackFree" : "attendance.void.sessionBack", { name: target.memberName })}</p>
            {target.consumedSessionPaid !== false && <p className="text-muted-foreground">{t("attendance.void.paymentStays")}</p>}
          </div>
        )}
        {target.earnedStamp && <p className="text-sm">{t("attendance.void.stampRemoved")}</p>}

        <div className="space-y-2">
          <Label htmlFor="voidReason">{t("attendance.void.reason.label")} *</Label>
          <textarea
            id="voidReason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(false);
            }}
            maxLength={VOID_REASON_MAX_LENGTH}
            placeholder={t("attendance.void.reason.placeholder")}
            disabled={submitting || refusal !== null}
            aria-invalid={reasonError}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-right text-xs text-muted-foreground">{t("attendance.void.reason.count", { count: reason.length })}</p>
          {reasonError && (
            <p role="alert" className="text-sm text-red-600">
              {t("attendance.void.reason.error")}
            </p>
          )}
        </div>

        {isSupport && refusal === null && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("attendance.void.supportAbout", { name: target.memberName })}</p>
            <SupportCodeField id="voidAuthCode" value={authCode} onChange={setAuthCode} disabled={submitting} />
          </div>
        )}

        {refusalText && (
          <div role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p>{refusalText}</p>
            {refusal === "laterVisitStaff" && <p>{t("attendance.void.refused.laterVisitStaff")}</p>}
          </div>
        )}
        {networkError && (
          <p role="alert" className="text-sm text-red-600">
            {t("attendance.void.network")}
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-red-600">
            {actionError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {refusal !== null ? (
            <Button type="button" onClick={onClose}>
              {t("common.close")}
            </Button>
          ) : (
            <>
              <Button ref={keepRef} type="button" variant="outline" onClick={onClose} disabled={submitting}>
                {t("attendance.void.keep")}
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleVoid()} disabled={submitting || !reasonValid || !codeValid}>
                {submitting ? t("attendance.void.voiding") : t("attendance.void.confirm")}
              </Button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
