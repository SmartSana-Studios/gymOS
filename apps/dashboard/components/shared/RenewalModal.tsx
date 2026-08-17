"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, X } from "lucide-react";
import { confirmRenewalSchema, type ConfirmRenewalInput } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { dismissFrontDeskAlert } from "@/lib/realtime/frontDeskAlerts";
import {
  fetchPaymentStatus,
  subscribeToPaymentStatus,
  type WatchedPaymentStatus,
} from "@/lib/realtime/paymentStatus";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import { confirmRenewalAction, getRenewalPreviewAction } from "@/app/(dashboard)/subscriptions/actions";
import { getPendingMobileMoneyPaymentAction, initiatePaymentAction } from "@/app/(dashboard)/payments/actions";
import { createClient } from "@/lib/supabase/client";
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
// Never reachable for the `mobile_money` branch (Story 4.12) -- that branch
// bypasses confirmRenewalSchema entirely (see handleSubmit).
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  reason: "renewalPanel.errors.reasonInvalid",
};

// Story 4.12 (AC #1): `mobile_money` is NOT part of `ConfirmRenewalInput["method"]`
// (that stays confirmRenewalSchema's own closed, manual-methods-only enum,
// per packages/types/src/schemas/subscription.ts's own comment) -- it's a
// UI-only branch that calls `initiatePaymentAction`/`initiatePaymentSchema`
// instead of `confirmRenewalAction`/`confirmRenewalSchema`.
type RenewalMethod = ConfirmRenewalInput["method"] | "mobile_money";

const MANUAL_METHOD_OPTIONS: { value: ConfirmRenewalInput["method"] }[] = [
  { value: "cash" },
  { value: "bank_transfer" },
  { value: "manual_momo" },
];

// Story 4.12 (Task 2): mirrors the reconciliation job's own 10-minute
// stale_processing threshold (0032_payment_reconciliation_job.sql) as the
// outer bound for "this is taking unusually long" -- but the UI surfaces a
// non-blocking "still waiting" state well before that, not a 10-minute
// silent spinner.
const STILL_WAITING_MS = 45_000;
const POLL_INTERVAL_MS = 5000;

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// MembersPageClient.tsx's exact local-date-parsing pattern: building the
// Date from local Y/M/D components (not `new Date(string)` directly) avoids
// the UTC-shift bug where a "YYYY-MM-DD" string parses as UTC midnight and
// then renders a day early for a negative-UTC-offset viewer.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

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
  originalExpiryDate,
  mobileMoneyEnabled,
  onClose,
  onRenewed,
}: {
  alertId?: string;
  memberId: string;
  memberName: string;
  originalExpiryDate?: string | null;
  /** Story 4.12 (AC #4): the UI-level half of the kill switch -- read from
   * `TARAMONEY_INITIATION_ENABLED` by each Server Component caller and
   * threaded down, same convention as `autoDismissMinutes`. Required (no
   * default) so a caller can't accidentally omit it and silently show a
   * dead option; `initiatePaymentAction`'s own server-side check is the real
   * enforcement regardless of what this prop says. */
  mobileMoneyEnabled: boolean;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const domIdSuffix = alertId ?? memberId;

  const [preview, setPreview] = useState<RenewalPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [method, setMethod] = useState<RenewalMethod>("cash");
  const [note, setNote] = useState(t("renewalPanel.notePrefillCash"));
  // Story 4.8: only ever true when `originalExpiryDate` is passed (the
  // Subscriptions page, for grace_period/expired rows with a non-null
  // expiryDate) -- FrontDeskAlertPanel's call site never passes this prop,
  // so the checkbox never renders there and this state is always false/unused
  // for that flow.
  const [backdate, setBackdate] = useState(false);

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

  // Story 4.12 (Task 2): the `mobile_money` branch's own async state machine,
  // entirely separate from `submitting`/`retryBlocked` above (those exist
  // for confirmRenewalAction's synchronous request/response cycle only).
  // "idle": form not yet submitted for this method. "sending": the brief
  // initiatePaymentAction call itself. "pending"/"stillWaiting": watching
  // `initiatedPaymentId` via Realtime (below) for a terminal state. "failed":
  // the payment was flagged (declined/rejected), not initiateAction erroring
  // (that's `formError`, handled the same as the manual-methods branch).
  const [mobileMoneyPhase, setMobileMoneyPhase] = useState<
    "idle" | "sending" | "pending" | "stillWaiting" | "failed"
  >("idle");
  const [initiatedPaymentId, setInitiatedPaymentId] = useState<string | null>(null);

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

  // Review finding (Story 4.12): discover an already-`processing`
  // mobile_money payment for this member on open, so a receptionist who
  // closed the pending panel and reopened the modal (a flow the UI itself
  // invites -- see the pending panel's "close and check back" copy) resumes
  // watching the existing payment instead of being able to submit a second
  // one. Only meaningful when Mobile Money is offered at all.
  useEffect(() => {
    if (!mobileMoneyEnabled) return;
    let active = true;
    getPendingMobileMoneyPaymentAction(memberId).then(({ data }) => {
      if (!active || !data) return;
      setInitiatedPaymentId(data.paymentId);
      setMobileMoneyPhase("pending");
    });
    return () => {
      active = false;
    };
  }, [memberId, mobileMoneyEnabled]);

  // Story 4.12 (Task 2, AC #1): watches the initiated payment row for a
  // terminal state once `initiatedPaymentId` is set (mobile_money branch
  // only). Realtime-subscription-with-polling-degrade, mirroring
  // `FrontDeskAlertPanel`'s established AD-20 pattern exactly -- decided as
  // this story's approach (user direction, 2026-08-17). Deliberately a plain
  // effect + local state, not TanStack Query: this is a single ephemeral
  // row-watch scoped to one modal instance, not a shared cache other
  // components read.
  useEffect(() => {
    if (!initiatedPaymentId) return;
    const paymentId = initiatedPaymentId;

    let active = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    async function handleUpdate(row: { status: WatchedPaymentStatus }) {
      if (!active) return;
      if (row.status === "verified") {
        stopPolling();
        // Same alert-dismiss-then-onRenewed sequence as the synchronous
        // confirmRenewalAction success path below -- see its own comment for
        // why the dismiss error is logged, not surfaced/blocking.
        if (alertId) {
          const { error: dismissError } = await dismissFrontDeskAlert(alertId);
          if (dismissError) {
            console.error(
              `RenewalModal: mobile money renewal for member ${memberId} succeeded but dismissing alert ${alertId} failed -- ${dismissError.message}`,
            );
          }
        }
        if (active) onRenewed();
      } else if (row.status === "flagged") {
        stopPolling();
        setMobileMoneyPhase("failed");
      }
      // "processing" is a no-op here -- still waiting, nothing to update.
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void fetchPaymentStatus(paymentId).then((row) => {
          if (row) void handleUpdate(row);
        });
      }, POLL_INTERVAL_MS);
    }

    function handleStatusChange(status: string) {
      if (status === "SUBSCRIBED") {
        stopPolling();
        return;
      }
      startPolling();
    }

    const channel = subscribeToPaymentStatus(
      paymentId,
      (row) => void handleUpdate(row),
      handleStatusChange,
    );
    const supabase = createClient();

    const stillWaitingTimer = setTimeout(() => {
      setMobileMoneyPhase((current) => (current === "pending" ? "stillWaiting" : current));
    }, STILL_WAITING_MS);

    return () => {
      active = false;
      stopPolling();
      clearTimeout(stillWaitingTimer);
      void supabase.removeChannel(channel);
    };
  }, [initiatedPaymentId, alertId, memberId, onRenewed]);

  // UX: "pre-filled 'Paid at desk' for Cash; cleared when method changes".
  // `mobile_money` (Story 4.12) has no note/reason field at all (
  // initiatePaymentSchema carries none) -- cleared the same as any
  // non-cash manual method for consistency, even though it's unused.
  function handleMethodChange(nextMethod: RenewalMethod) {
    setMethod(nextMethod);
    setNote(nextMethod === "cash" ? t("renewalPanel.notePrefillCash") : "");
    // Review finding (Story 4.12): `retryBlocked`/`formError` are set by a
    // failed manual-method (confirmRenewalAction) attempt, but the submit
    // button's `disabled` check reads `retryBlocked` regardless of method --
    // without this, switching to Mobile Money after a retry-blocked manual
    // attempt left "Send Payment Request" permanently disabled with a stale
    // error message and no way to recover short of closing the modal.
    setRetryBlocked(false);
    setFormError(null);
  }

  function methodLabel(method: string): string {
    const key = PAYMENT_METHOD_LABEL_KEY[method];
    return key ? t(key) : method;
  }

  function resetAndClose() {
    onClose();
  }

  /**
   * Story 4.12 (Task 2, AC #1): the `mobile_money` branch. Does NOT go
   * through `confirmRenewalSchema`/`confirmRenewalAction` (see this file's
   * top-of-file comment) -- `initiatePayment()` inserts a `processing` row
   * and returns immediately; the subscription only actually renews later,
   * once Tara Money's webhook confirms (watched by the effect above).
   */
  async function handleMobileMoneySubmit() {
    setFormError(null);

    if (!preview?.memberPhone) {
      setFormError(t("renewalPanel.errors.noPhoneOnFile"));
      return;
    }

    setMobileMoneyPhase("sending");
    try {
      const { data, error } = await initiatePaymentAction({
        memberId,
        phoneNumber: preview.memberPhone,
        method: "mobile_money",
      });
      if (error || !data) {
        setFormError(error?.message || t("renewalPanel.errors.initiateFailed"));
        setMobileMoneyPhase("idle");
        return;
      }
      setInitiatedPaymentId(data.paymentId);
      setMobileMoneyPhase("pending");
    } catch {
      setFormError(t("renewalPanel.errors.initiateFailed"));
      setMobileMoneyPhase("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (method === "mobile_money") {
      await handleMobileMoneySubmit();
      return;
    }

    const parsed = confirmRenewalSchema.safeParse({ memberId, method, reason: note, backdate });
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
      // Story 4.8: the Subscriptions page has no alert to dismiss -- only
      // call this when opened from FrontDeskAlertPanel (`alertId` truthy).
      if (alertId) {
        const { error: dismissError } = await dismissFrontDeskAlert(alertId);
        if (dismissError) {
          console.error(
            `RenewalModal: renewal for member ${memberId} succeeded but dismissing alert ${alertId} failed -- ${dismissError.message}`,
          );
        }
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

  // Story 4.12 (Task 2): once a mobile_money payment has been initiated,
  // the form's method/note/submit-button area is replaced by the pending
  // panel below -- these three phases all mean "watching initiatedPaymentId",
  // "failed" included since the payment reached a real terminal state
  // (flagged) the user needs to see, not just still-pending ones.
  const isWatchingMobileMoney =
    mobileMoneyPhase === "pending" || mobileMoneyPhase === "stillWaiting" || mobileMoneyPhase === "failed";
  const blockClose = submitting || mobileMoneyPhase === "sending";
  const methodOptions: { value: RenewalMethod }[] = mobileMoneyEnabled
    ? [...MANUAL_METHOD_OPTIONS, { value: "mobile_money" }]
    : MANUAL_METHOD_OPTIONS;

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (blockClose) e.preventDefault();
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
            disabled={blockClose}
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
              <span>{backdate && originalExpiryDate ? formatLocalDate(originalExpiryDate, i18n.language) : t("renewalPanel.startDateToday")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("renewalPanel.price")}</span>
              <span>
                {preview.currency} {preview.price.toLocaleString()}
              </span>
            </div>
            {originalExpiryDate && (
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  checked={backdate}
                  onChange={(e) => setBackdate(e.target.checked)}
                  disabled={submitting}
                />
                {t("renewalPanel.backdateCheckbox", { date: formatLocalDate(originalExpiryDate, i18n.language) })}
              </label>
            )}
          </div>
        ) : null}

        {isWatchingMobileMoney ? (
          // Story 4.12 (Task 2, AC #1): the async wait-for-confirmation
          // state. No form fields here -- this is a read-only status view
          // until the Realtime-watch effect above resolves it, or the
          // receptionist closes the modal to check back later (the payment
          // stays `processing`/`flagged` in the DB either way).
          <div className="space-y-3 rounded-md border p-3 text-sm">
            {mobileMoneyPhase === "failed" ? (
              <p className="text-red-600">{t("renewalPanel.pending.failed")}</p>
            ) : (
              <>
                <p className="font-medium">{t("renewalPanel.pending.title", { name: memberName })}</p>
                <p className="text-muted-foreground">{t("renewalPanel.pending.description")}</p>
                {mobileMoneyPhase === "stillWaiting" && (
                  <p className="text-muted-foreground">{t("renewalPanel.pending.stillWaiting")}</p>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={`renewalMethod-${domIdSuffix}`}>{t("renewalPanel.method")}</Label>
              <select
                id={`renewalMethod-${domIdSuffix}`}
                value={method}
                onChange={(e) => handleMethodChange(e.target.value as RenewalMethod)}
                disabled={submitting || !preview}
                className={selectClassName}
              >
                {methodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {methodLabel(option.value)}
                  </option>
                ))}
              </select>
            </div>

            {method !== "mobile_money" && (
              <div className="space-y-2">
                <Label htmlFor={`renewalNote-${domIdSuffix}`}>{t("renewalPanel.note")} *</Label>
                <textarea
                  id={`renewalNote-${domIdSuffix}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={submitting || !preview}
                  className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">{t("renewalPanel.noteCount", { count: note.length })}</p>
                {fieldErrors.reason && <p className="text-sm text-red-600">{fieldErrors.reason}</p>}
              </div>
            )}
          </>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={blockClose}>
            {isWatchingMobileMoney ? t("renewalPanel.pending.closeButton") : t("common.cancel")}
          </Button>
          {!isWatchingMobileMoney && (
            <Button
              type="submit"
              disabled={submitting || !preview || retryBlocked || mobileMoneyPhase === "sending"}
            >
              {method === "mobile_money" ? (
                mobileMoneyPhase === "sending" ? (
                  t("renewalPanel.sendingPaymentRequest")
                ) : (
                  <>
                    {t("renewalPanel.sendPaymentRequestButton")}
                    <ArrowRight />
                  </>
                )
              ) : submitting ? (
                t("renewalPanel.confirming")
              ) : (
                <>
                  {t("renewalPanel.confirmButton")}
                  <ArrowRight />
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
