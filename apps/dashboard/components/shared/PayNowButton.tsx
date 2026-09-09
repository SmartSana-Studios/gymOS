"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { fetchSaasBillingPaymentStatus } from "@/lib/realtime/paymentStatus";
import { payNow, payNowWithHostedCheckoutLink } from "@/app/(dashboard)/settings/actions";
import type { SelectableTier } from "@/services/billing";

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
 *
 * Story 11.7 (AC #1, #2, #3): `selectableTiers` drives a tier/interval
 * override (excluding Free/Test -- already excluded server-side by
 * `list_selectable_saas_billing_tiers()`), the payer-phone field's country
 * picker drives only its own leading calling code (never sent to TaraMoney --
 * it already auto-detects the operator server-side; Story 16.1 replaced the
 * hand-rolled country `<select>` + phone `<Input>` pair with the shared
 * `PhoneInput` restricted to `TARAMONEY_SUPPORTED_COUNTRIES`, this being the
 * other phone field anywhere that reaches Tara Money besides RenewalModal's
 * payerPhone), and "Continue on Tara" shares the same dialog/tier-interval
 * selection/polling-watch machinery as the direct mobile-money submit
 * button.
 */
export function PayNowButton({
  initialOwnerPhone,
  selectableTiers = [],
  onPaymentConfirmed,
}: {
  initialOwnerPhone?: string | null;
  selectableTiers?: SelectableTier[];
  onPaymentConfirmed: () => void;
}) {
  const { t } = useTranslation();

  const [payNowError, setPayNowError] = useState<string | null>(null);
  const [payNowLoading, setPayNowLoading] = useState(false);
  const [hostedCheckoutLoading, setHostedCheckoutLoading] = useState(false);
  const [watchedPaymentId, setWatchedPaymentId] = useState<string | null>(null);
  const [paymentPhase, setPaymentPhase] = useState<"idle" | "pending" | "stillWaiting" | "failed">("idle");
  // Real-user-testing finding (Story 11.3): the Owner's own on-file phone
  // isn't always the right mobile-money payer line -- "Pay Now" opens a
  // dialog with an editable field instead of silently using the on-file
  // number with no confirmation.
  const [payNowOpen, setPayNowOpen] = useState(false);
  const [payNowPhone, setPayNowPhone] = useState(initialOwnerPhone ?? "");
  const [tierId, setTierId] = useState("");
  const [billingInterval, setBillingInterval] = useState("");
  const payNowDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (payNowOpen) {
      payNowDialogRef.current?.showModal();
    }
  }, [payNowOpen]);

  // Story 1.19 review decision: this watch is INTENTIONALLY not preserved
  // across a gym switch. Keying the page subtree on `gymId`
  // ((dashboard)/layout.tsx) remounts this component, which cancels the poll
  // below -- whereas before that fix `router.refresh()` left it running.
  // That is the behaviour we want: polling gym A's payment while the user is
  // looking at gym B was never right. Nothing is lost financially -- the
  // send/webhook is the authority (`saas_billing_payments` is deliberately
  // off the `supabase_realtime` publication, Story 11.3), so a payment that
  // verifies after a switch still lands server-side and shows on the next
  // load of that gym. Only the live in-page confirmation is forfeited.
  // Do not "fix" this by persisting `watchedPaymentId` across the switch
  // without first deciding what the confirmation banner should say when it
  // fires on a different gym than the one that was paid for.
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
    setTierId("");
    setBillingInterval("");
    setPayNowOpen(true);
  }

  async function handlePayNowSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Story 1.20 review finding: `preventDefault()` alone is not enough here.
    // Story 1.20 portaled this dialog to <body> so its <form> is no longer a
    // DOM descendant of SettingsForm's own <form> -- but React propagates
    // events along the REACT tree, not the DOM tree, and <PayNowButton> is
    // still rendered inside that form (SettingsForm.tsx:880). Without this,
    // submitting Pay Now also runs SettingsForm's full validate-and-save
    // path, silently persisting whatever unsaved edits the Owner had in the
    // gym-settings fields. Verified against React 19.2.7 with the exact
    // post-portal shape: handlers fired ["INNER", "OUTER"].
    e.stopPropagation();
    setPayNowError(null);
    setPayNowLoading(true);
    try {
      const { data, error } = await payNow({
        phoneNumber: payNowPhone.trim(),
        tierId: tierId || undefined,
        interval: billingInterval || undefined,
      });
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

  async function handleContinueOnTara() {
    setPayNowError(null);
    setHostedCheckoutLoading(true);
    try {
      const { data, error } = await payNowWithHostedCheckoutLink({
        tierId: tierId || undefined,
        interval: billingInterval || undefined,
      });
      if (error || !data) {
        setPayNowError(error?.message ?? t("common.somethingWentWrong"));
        return;
      }
      const opened = window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        // Popup blocked -- don't close the dialog on a checkout page the
        // Owner never actually saw (review finding: previously this
        // silently proceeded to poll for a payment the Owner had no way to
        // complete).
        setPayNowError(t("settings.billing.payNowPopupBlocked"));
        return;
      }
      setPaymentPhase("pending");
      setWatchedPaymentId(data.paymentId);
      payNowDialogRef.current?.close();
      setPayNowOpen(false);
    } catch {
      setPayNowError(t("common.somethingWentWrong"));
    } finally {
      setHostedCheckoutLoading(false);
    }
  }

  const busy = payNowLoading || hostedCheckoutLoading;

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

      {/*
        Story 1.20: portaled to <body> and rendered only while open.
        This component is used inside SettingsForm's main <form> (the
        Billing section), and a <form> cannot legally descend from
        another <form> -- the HTML parser drops the inner one, which
        surfaced as a hydration error on /settings for any gym whose
        billing status is not `active`. Portaling moves the dialog out
        of that subtree entirely, so both forms stand alone.

        PhoneInput's country-picker popover still renders IN PLACE
        inside this dialog (Story 16.1) -- portaling the dialog itself
        keeps the popover within the dialog's own subtree, so it stays
        interactive under showModal()'s inertness rules.

        Gated on `payNowOpen` rather than a `mounted` flag: it is
        already false during SSR (where document.body does not exist),
        and every field the dialog edits is component state, so
        unmounting it while closed loses nothing -- openPayNowDialog()
        resets those values anyway.
      */}
      {payNowOpen &&
        createPortal(
          <dialog
            ref={payNowDialogRef}
            onClose={() => setPayNowOpen(false)}
            onCancel={(e) => {
              if (busy) e.preventDefault();
            }}
            className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
          >
            <form onSubmit={handlePayNowSubmit} className="space-y-4 p-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{t("settings.billing.payNowDialogTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("settings.billing.payNowDialogBody")}</p>
              </div>

              <div className={selectableTiers.length > 0 ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
                {selectableTiers.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="payNowTier">{t("settings.billing.tierLabel")}</Label>
                    <select
                      id="payNowTier"
                      value={tierId}
                      onChange={(e) => setTierId(e.target.value)}
                      disabled={busy}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">{t("settings.billing.tierKeepCurrent")}</option>
                      {selectableTiers.map((tier) => (
                        <option key={tier.id} value={tier.id}>
                          {tier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="payNowInterval">{t("settings.billing.intervalLabel")}</Label>
                  <select
                    id="payNowInterval"
                    value={billingInterval}
                    onChange={(e) => setBillingInterval(e.target.value)}
                    disabled={busy}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">{t("settings.billing.tierKeepCurrent")}</option>
                    <option value="monthly">{t("settings.billing.intervalMonthly")}</option>
                    <option value="annual">{t("settings.billing.intervalAnnual")}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payNowPhone">{t("settings.billing.payerPhoneLabel")}</Label>
                <PhoneInput
                  id="payNowPhone"
                  countries="tara-money"
                  value={payNowPhone}
                  onChange={(value) => setPayNowPhone(value ?? "")}
                  disabled={busy}
                />
              </div>

              {payNowError && <p className="text-sm text-red-600">{payNowError}</p>}

              <div className="flex flex-col gap-2 border-t pt-4">
                <Button type="submit" disabled={busy}>
                  {payNowLoading ? t("settings.billing.payNowLoading") : t("settings.billing.payNow")}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={handleContinueOnTara}>
                  {hostedCheckoutLoading ? t("settings.billing.payNowLoading") : t("settings.billing.continueOnTara")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => payNowDialogRef.current?.close()}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
