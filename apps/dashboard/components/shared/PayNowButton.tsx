"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TARAMONEY_SUPPORTED_COUNTRIES } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchSaasBillingPaymentStatus } from "@/lib/realtime/paymentStatus";
import { payNow, payNowWithHostedCheckoutLink } from "@/app/(dashboard)/settings/actions";
import type { SelectableTier } from "@/services/billing";

const DEFAULT_COUNTRY_CODE = "CM";

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
 * `list_selectable_saas_billing_tiers()`), a country selector drives the
 * phone input's leading calling code only (never sent to TaraMoney -- it
 * already auto-detects the operator server-side), and "Continue on Tara"
 * shares the same dialog/tier-interval selection/polling-watch machinery as
 * the direct mobile-money submit button.
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
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [tierId, setTierId] = useState("");
  const [billingInterval, setBillingInterval] = useState("");
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
    setCountryCode(DEFAULT_COUNTRY_CODE);
    setTierId("");
    setBillingInterval("");
    setPayNowOpen(true);
  }

  function handleCountryChange(newCode: string) {
    const previousCountry = TARAMONEY_SUPPORTED_COUNTRIES.find((c) => c.code === countryCode);
    const newCountry = TARAMONEY_SUPPORTED_COUNTRIES.find((c) => c.code === newCode);
    setCountryCode(newCode);
    if (!newCountry) return;
    // Only replaces the leading calling code when the field is empty or
    // still exactly the previous country's own bare prefix -- never
    // clobbers a number the Owner has actually started typing.
    if (!payNowPhone.trim() || (previousCountry && payNowPhone === `+${previousCountry.callingCode}`)) {
      setPayNowPhone(`+${newCountry.callingCode}`);
    }
  }

  async function handlePayNowSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      window.open(data.checkoutUrl, "_blank", "noopener,noreferrer");
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

          {selectableTiers.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
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
          )}

          <div className="grid grid-cols-[minmax(0,140px)_1fr] gap-3">
            <div className="space-y-2">
              <Label htmlFor="payNowCountry">{t("settings.billing.countryLabel")}</Label>
              <select
                id="payNowCountry"
                value={countryCode}
                onChange={(e) => handleCountryChange(e.target.value)}
                disabled={busy}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TARAMONEY_SUPPORTED_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    +{country.callingCode} {country.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payNowPhone">{t("settings.billing.payerPhoneLabel")}</Label>
              <Input
                id="payNowPhone"
                type="tel"
                value={payNowPhone}
                onChange={(e) => setPayNowPhone(e.target.value)}
                placeholder="+237600000000"
                disabled={busy}
              />
            </div>
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
      </dialog>
    </>
  );
}
