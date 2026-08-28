"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchSaasBillingPaymentStatus } from "@/lib/realtime/paymentStatus";
import { payNow } from "@/app/(dashboard)/settings/actions";

/**
 * Story 11.3's "Pay Now" flow (dialog + polling watch), extracted out of
 * `SettingsForm.tsx`'s Billing section in Story 11.4 so the same flow can be
 * reused, unchanged, by the new suspended-gym Owner recovery screen
 * (`(dashboard)/layout.tsx`) without duplicating `initiate_saas_billing_payment()`
 * submission/polling logic a second time. Mirrors `RenewalModal`'s own
 * subscribeToPaymentStatus/fetchPaymentStatus pattern, minus the realtime
 * fast path -- `saas_billing_payments` is deliberately not on the
 * `supabase_realtime` publication (Story 11.3 Dev Notes), so this is
 * polling-only.
 *
 * `initialOwnerPhone` pre-fills the payer-phone field but is optional -- the
 * suspended screen (Task 2) deliberately does not fetch `getGymBillingInfo()`
 * for this, per the story's own "needs no data beyond the gyms row already
 * fetched" scoping; the field is simply blank there until the Owner types a
 * number, same as it would be for an Owner with no phone on file today.
 *
 * `onPaymentConfirmed` lets each caller decide what "verified" means for it
 * -- `SettingsForm.tsx` refetches its own `billingInfo` and shows a toast;
 * the suspended screen calls `router.refresh()` so the layout re-reads
 * `gyms.status` and swaps back to the normal dashboard shell.
 */
export function PayNowButton({
  initialOwnerPhone,
  onPaymentConfirmed,
}: {
  initialOwnerPhone?: string | null;
  onPaymentConfirmed: () => void;
}) {
  const { t } = useTranslation();

  const [payNowError, setPayNowError] = useState<string | null>(null);
  const [payNowLoading, setPayNowLoading] = useState(false);
  const [watchedPaymentId, setWatchedPaymentId] = useState<string | null>(null);
  const [paymentPhase, setPaymentPhase] = useState<"idle" | "pending" | "stillWaiting" | "failed">("idle");
  // Real-user-testing finding (Story 11.3): the Owner's own on-file phone
  // isn't always the right mobile-money payer line -- "Pay Now" opens a
  // dialog with an editable field instead of silently using the on-file
  // number with no confirmation.
  const [payNowOpen, setPayNowOpen] = useState(false);
  const [payNowPhone, setPayNowPhone] = useState(initialOwnerPhone ?? "");
  const payNowDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (payNowOpen) {
      payNowDialogRef.current?.showModal();
    }
  }, [payNowOpen]);

  useEffect(() => {
    if (!watchedPaymentId) return;

    let active = true;
    const pollTimer = setInterval(() => {
      void fetchSaasBillingPaymentStatus(watchedPaymentId)
        .then((row) => {
          if (!active || !row) return;
          if (row.status === "verified") {
            clearInterval(pollTimer);
            setWatchedPaymentId(null);
            setPaymentPhase("idle");
            onPaymentConfirmed();
          } else if (row.status === "flagged") {
            clearInterval(pollTimer);
            setWatchedPaymentId(null);
            setPaymentPhase("failed");
          }
          // "processing" is a no-op here -- still waiting.
        })
        .catch((err) => {
          // A thrown/rejected status check must not leave the UI stuck on
          // "pending" with a silent recurring failure -- log and keep
          // polling (a transient network blip shouldn't give up after one
          // failed tick; the real send/webhook is still the authority).
          console.error("[PayNowButton] failed to check pending saas billing payment status", err);
        });
    }, 5000);

    const stillWaitingTimer = setTimeout(() => {
      setPaymentPhase((current) => (current === "pending" ? "stillWaiting" : current));
    }, 45000);

    return () => {
      active = false;
      clearInterval(pollTimer);
      clearTimeout(stillWaitingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedPaymentId]);

  function openPayNowDialog() {
    setPayNowError(null);
    setPayNowPhone(initialOwnerPhone ?? "");
    setPayNowOpen(true);
  }

  async function handlePayNowSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPayNowError(null);
    setPayNowLoading(true);
    try {
      const { data, error } = await payNow({ phoneNumber: payNowPhone.trim() });
      if (error || !data) {
        setPayNowError(error?.message ?? t("common.somethingWentWrong"));
        return;
      }
      setPaymentPhase("pending");
      setWatchedPaymentId(data.paymentId);
      payNowDialogRef.current?.close();
      setPayNowOpen(false);
    } catch {
      setPayNowError(t("common.somethingWentWrong"));
    } finally {
      setPayNowLoading(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {paymentPhase === "pending" && (
          <p className="text-sm text-muted-foreground">{t("settings.billing.payPending")}</p>
        )}
        {paymentPhase === "stillWaiting" && (
          <p className="text-sm text-muted-foreground">{t("settings.billing.payStillWaiting")}</p>
        )}
        {paymentPhase === "failed" && <p className="text-sm text-red-600">{t("settings.billing.payFailed")}</p>}
        <Button
          type="button"
          size="sm"
          className="w-fit"
          disabled={paymentPhase === "pending" || paymentPhase === "stillWaiting"}
          onClick={openPayNowDialog}
        >
          {t("settings.billing.payNow")}
        </Button>
      </div>

      <dialog
        ref={payNowDialogRef}
        onClose={() => setPayNowOpen(false)}
        onCancel={(e) => {
          if (payNowLoading) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <form onSubmit={handlePayNowSubmit} className="space-y-4 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("settings.billing.payNowDialogTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.billing.payNowDialogBody")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payNowPhone">{t("settings.billing.payerPhoneLabel")}</Label>
            <Input
              id="payNowPhone"
              type="tel"
              value={payNowPhone}
              onChange={(e) => setPayNowPhone(e.target.value)}
              placeholder="+237600000000"
              disabled={payNowLoading}
            />
          </div>
          {payNowError && <p className="text-sm text-red-600">{payNowError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={payNowLoading}
              onClick={() => payNowDialogRef.current?.close()}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={payNowLoading}>
              {payNowLoading ? t("settings.billing.payNowLoading") : t("settings.billing.payNow")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
