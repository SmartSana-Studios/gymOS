"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { initiateRegistrationFeePaymentSchema, recordRegistrationFeeSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { createClient } from "@/lib/supabase/client";
import {
  fetchPaymentStatus,
  subscribeToPaymentStatus,
  type WatchedPaymentStatus,
} from "@/lib/realtime/paymentStatus";
import type { MemberListRow } from "@/services/members";
import { PAYMENT_METHOD_LABEL_KEY } from "@/app/(dashboard)/payments/paymentLabels";
import {
  getPendingRegistrationFeePaymentAction,
  initiateRegistrationFeePaymentAction,
  recordRegistrationFeeAction,
} from "@/app/(dashboard)/payments/actions";

type CollectMethod = "cash" | "bank_transfer" | "manual_momo" | "mobile_money";

const MANUAL_METHODS: CollectMethod[] = ["cash", "bank_transfer", "manual_momo"];

// Same defaults as RenewalModal.tsx (per-file copy, not a cross-import): the
// member's own number pre-fills the payer field, "+237" when none is on file.
const DEFAULT_PHONE_PREFIX = "+237";
const STILL_WAITING_MS = 45_000;
const POLL_INTERVAL_MS = 5000;
// The reconciliation job flags a `processing` row at ten minutes, and the next
// collect call flags it too (0100). A row at or past this age is offered as a
// retry, not a wait.
const PENDING_EXPIRY_MS = 10 * 60 * 1000;

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type Phase = "idle" | "sending" | "pending" | "stillWaiting" | "failed";

/**
 * Story 18.6: collect a member's registration fee. The amount is the gym's fee,
 * shown but never editable: both RPCs read it server-side. Cash, bank transfer
 * and manual mobile money settle the member at once. Tara Money (offered only
 * when `mobileMoneyEnabled`) sends a payment request and waits for the webhook;
 * the watch effect is RenewalModal's pattern. Opening the dialog while a request
 * is still `processing` resumes the wait instead of allowing a second prompt.
 */
export function CollectRegistrationFeeDialog({
  member,
  registrationFee,
  mobileMoneyEnabled,
  onClose,
  onCollected,
}: {
  member: MemberListRow;
  registrationFee: number;
  mobileMoneyEnabled: boolean;
  onClose: () => void;
  /** The member is settled (manual record done, or the Tara webhook verified). */
  onCollected: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [method, setMethod] = useState<CollectMethod>("cash");
  const [reason, setReason] = useState(() => t("members.feeCollect.reasonPrefill"));
  const [payerPhone, setPayerPhone] = useState(member.phone ?? DEFAULT_PHONE_PREFIX);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [initiatedPaymentId, setInitiatedPaymentId] = useState<string | null>(null);
  // False until the open-time pending check resolves, so the form cannot be
  // submitted before we know a request is not already in flight.
  const [pendingChecked, setPendingChecked] = useState(false);
  // A `processing` row 10+ minutes old: the form is shown with a retry notice.
  const [stalePending, setStalePending] = useState(false);

  // The latest callback, read from inside the watch effect so a parent
  // re-render does not tear down and recreate the subscription.
  const onCollectedRef = useRef(onCollected);
  useEffect(() => {
    onCollectedRef.current = onCollected;
  });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Discover a Tara request already in flight for this member. Not gated on
  // `mobileMoneyEnabled`: a `processing` row blocks the manual methods too
  // (registration_fee_already_pending), so it must be surfaced either way.
  useEffect(() => {
    let active = true;
    getPendingRegistrationFeePaymentAction(member.id)
      .then(({ data }) => {
        if (!active) return;
        if (data) {
          const ageMs = Date.now() - new Date(data.createdAt).getTime();
          if (ageMs < PENDING_EXPIRY_MS) {
            setInitiatedPaymentId(data.paymentId);
            setPhase("pending");
          } else {
            // Only a Tara retry is meaningful for the notice; with Tara off the
            // manual methods still work (the RPCs flag the stale row).
            if (mobileMoneyEnabled) {
              setStalePending(true);
              setMethod("mobile_money");
            }
          }
        }
        setPendingChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setPendingChecked(true);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  // Watches the initiated payment for a terminal state: Realtime with a
  // polling degrade, RenewalModal's AD-20 pattern.
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

    function handleUpdate(row: { status: WatchedPaymentStatus }) {
      if (!active) return;
      if (row.status === "verified") {
        stopPolling();
        onCollectedRef.current();
      } else if (row.status === "flagged") {
        stopPolling();
        setPhase("failed");
      }
      // "processing" is a no-op: still waiting.
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void fetchPaymentStatus(paymentId).then((row) => {
          if (row) handleUpdate(row);
        });
      }, POLL_INTERVAL_MS);
    }

    function handleStatusChange(status: string) {
      // removeChannel in the cleanup reports CLOSED; polling then must not restart.
      if (!active) return;
      if (status === "SUBSCRIBED") {
        stopPolling();
        // A payment that settled before the channel was ready (a resumed row, or
        // one just initiated) produces no event; read it once.
        void fetchPaymentStatus(paymentId).then((row) => {
          if (row) handleUpdate(row);
        });
        return;
      }
      startPolling();
    }

    const channel = subscribeToPaymentStatus(paymentId, handleUpdate, handleStatusChange);
    const supabase = createClient();

    const stillWaitingTimer = setTimeout(() => {
      setPhase((current) => (current === "pending" ? "stillWaiting" : current));
    }, STILL_WAITING_MS);

    return () => {
      active = false;
      stopPolling();
      clearTimeout(stillWaitingTimer);
      void supabase.removeChannel(channel);
    };
  }, [initiatedPaymentId]);

  function methodLabel(value: CollectMethod): string {
    const key = PAYMENT_METHOD_LABEL_KEY[value];
    return key ? t(key) : value;
  }

  async function handleManualSubmit() {
    const parsed = recordRegistrationFeeSchema.safeParse({ memberId: member.id, method, reason });
    if (!parsed.success) {
      setReasonError(t("members.feeCollect.errors.reasonInvalid"));
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await recordRegistrationFeeAction(parsed.data);
      if (error) {
        setFormError(error.message || t("members.feeCollect.errors.collectFailed"));
        return;
      }
      onCollected();
    } catch {
      setFormError(t("members.feeCollect.errors.collectFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTaraSubmit() {
    const parsed = initiateRegistrationFeePaymentSchema.safeParse({
      memberId: member.id,
      phoneNumber: payerPhone.trim(),
    });
    if (!parsed.success) {
      setPhoneError(t("members.feeCollect.errors.payerPhoneInvalid"));
      return;
    }

    setSubmitting(true);
    setPhase("sending");
    try {
      const { data, error } = await initiateRegistrationFeePaymentAction(parsed.data);
      if (error || !data) {
        setFormError(error?.message || t("members.feeCollect.errors.initiateFailed"));
        setPhase("idle");
        return;
      }
      setStalePending(false);
      setInitiatedPaymentId(data.paymentId);
      setPhase("pending");
    } catch {
      setFormError(t("members.feeCollect.errors.initiateFailed"));
      setPhase("idle");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !pendingChecked) return;
    setFormError(null);
    setReasonError(null);
    setPhoneError(null);

    if (method === "mobile_money") {
      await handleTaraSubmit();
    } else {
      await handleManualSubmit();
    }
  }

  // A flagged attempt: back to the form to send a fresh request.
  function handleRetry() {
    setInitiatedPaymentId(null);
    setPhase("idle");
    setFormError(null);
    setMethod(mobileMoneyEnabled ? "mobile_money" : "cash");
  }

  function handleMethodChange(next: CollectMethod) {
    setMethod(next);
    setFormError(null);
    setReasonError(null);
    setPhoneError(null);
  }

  const isWatching = phase === "pending" || phase === "stillWaiting" || phase === "failed";
  const blockClose = submitting;
  const methods: CollectMethod[] = mobileMoneyEnabled ? [...MANUAL_METHODS, "mobile_money"] : MANUAL_METHODS;
  const feeLabel = registrationFee.toLocaleString(i18n.language);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (blockClose) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("members.feeCollect.title", { name: member.name })}</h2>

        <div className="space-y-1 rounded-md border p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("members.feeCollect.amountLabel")}</span>
            <span className="font-medium">{t("members.feeCollect.amountValue", { amount: feeLabel })}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t("members.feeCollect.amountHint")}</p>
        </div>

        {isWatching ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            {phase === "failed" ? (
              <>
                <p className="text-red-600">{t("members.feeCollect.pending.failed")}</p>
                <Button type="button" onClick={handleRetry}>
                  {t("members.feeCollect.pending.retryButton")}
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">{t("members.feeCollect.pending.title", { name: member.name })}</p>
                <p className="text-muted-foreground">{t("members.feeCollect.pending.description")}</p>
                {phase === "stillWaiting" && (
                  <p className="text-muted-foreground">{t("members.feeCollect.pending.stillWaiting")}</p>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {stalePending && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {t("members.feeCollect.pending.expired")}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="feeCollectMethod">{t("members.feeCollect.method")}</Label>
              <select
                id="feeCollectMethod"
                value={method}
                onChange={(e) => handleMethodChange(e.target.value as CollectMethod)}
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

            {method === "mobile_money" ? (
              <div className="space-y-2">
                <Label htmlFor="feeCollectPayerPhone">{t("members.feeCollect.payerPhone")}</Label>
                <PhoneInput
                  id="feeCollectPayerPhone"
                  countries="tara-money"
                  value={payerPhone}
                  onChange={(value) => setPayerPhone(value ?? "")}
                  disabled={submitting}
                />
                <p className="text-xs text-muted-foreground">{t("members.feeCollect.payerPhoneHint")}</p>
                {phoneError && <p className="text-sm text-red-600">{phoneError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="feeCollectReason">{t("members.feeCollect.reason")}</Label>
                <textarea
                  id="feeCollectReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submitting}
                  className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {reasonError && <p className="text-sm text-red-600">{reasonError}</p>}
              </div>
            )}
          </>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={blockClose}>
            {isWatching ? t("members.feeCollect.pending.closeButton") : t("common.cancel")}
          </Button>
          {!isWatching && (
            <Button type="submit" disabled={submitting || !pendingChecked}>
              {method === "mobile_money"
                ? submitting
                  ? t("members.feeCollect.sendingRequest")
                  : stalePending
                    ? t("members.feeCollect.retryRequestButton")
                    : t("members.feeCollect.sendRequestButton")
                : submitting
                  ? t("members.feeCollect.collecting")
                  : t("members.feeCollect.collectButton")}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
