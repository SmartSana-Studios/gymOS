"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getGuestChargingImpact, setGuestCharging } from "./actions";

export function useGuestCharging({
  initialValue,
  showToast,
}: {
  initialValue: boolean;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  // Story 19.9a: charge-guests-per-session saves through its own RPC after a
  // confirmation dialog; the toggle only reflects the *stored* value and never
  // flips before the server confirms.
  const [chargeGuests, setChargeGuests] = useState(initialValue);
  const [chargeDialog, setChargeDialog] = useState<"on" | "off" | null>(null);
  const [chargeImpact, setChargeImpact] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; count: number; validityDays: number }
  >({ status: "loading" });
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const chargeOnDialogRef = useRef<HTMLDialogElement>(null);
  const chargeOffDialogRef = useRef<HTMLDialogElement>(null);
  const chargeOnCancelRef = useRef<HTMLButtonElement>(null);
  const chargeOffCancelRef = useRef<HTMLButtonElement>(null);
  const chargeImpactRequestRef = useRef(0);

  useEffect(() => {
    if (chargeDialog === "on") {
      chargeOnDialogRef.current?.showModal();
      chargeOnCancelRef.current?.focus();
    } else if (chargeDialog === "off") {
      chargeOffDialogRef.current?.showModal();
      chargeOffCancelRef.current?.focus();
    }
  }, [chargeDialog]);

  async function loadChargeImpact() {
    const requestId = ++chargeImpactRequestRef.current;
    setChargeImpact({ status: "loading" });
    try {
      const { data, error } = await getGuestChargingImpact();
      if (requestId !== chargeImpactRequestRef.current) return;
      if (error || !data) {
        setChargeImpact({ status: "error" });
        return;
      }
      setChargeImpact({ status: "ready", count: data.count, validityDays: data.validityDays });
    } catch {
      if (requestId === chargeImpactRequestRef.current) setChargeImpact({ status: "error" });
    }
  }

  function openChargeDialog() {
    setChargeError(null);
    setChargeDialog(chargeGuests ? "off" : "on");
    void loadChargeImpact();
  }

  function closeChargeDialog() {
    chargeImpactRequestRef.current++;
    (chargeDialog === "on" ? chargeOnDialogRef : chargeOffDialogRef).current?.close();
  }

  async function handleChargeConfirm() {
    const next = !chargeGuests;
    setChargeSaving(true);
    setChargeError(null);
    try {
      const { error } = await setGuestCharging(next);
      if (error) {
        setChargeError(error.message || t("settings.guestCharging.saveFailed"));
        return;
      }
      setChargeGuests(next);
      closeChargeDialog();
      showToast(next ? t("settings.guestCharging.onToast") : t("settings.guestCharging.offToast"));
    } catch {
      setChargeError(t("settings.guestCharging.saveFailed"));
    } finally {
      setChargeSaving(false);
    }
  }

  return {
    chargeGuests,
    chargeDialog,
    chargeImpact,
    chargeSaving,
    chargeError,
    chargeOnDialogRef,
    chargeOffDialogRef,
    chargeOnCancelRef,
    chargeOffCancelRef,
    setChargeDialog,
    loadChargeImpact,
    openChargeDialog,
    closeChargeDialog,
    handleChargeConfirm,
  };
}

type GuestChargingState = ReturnType<typeof useGuestCharging>;

export function GuestChargingControl({ charge }: { charge: GuestChargingState }) {
  const { t } = useTranslation();
  const { chargeGuests, chargeDialog, chargeSaving, openChargeDialog } = charge;
  return (
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label id="chargeGuestsLabel">{t("settings.guestCharging.label")}</Label>
                <p className="text-xs text-muted-foreground">{t("settings.guestCharging.hint")}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={chargeGuests}
                aria-labelledby="chargeGuestsLabel"
                disabled={chargeDialog !== null || chargeSaving}
                onClick={openChargeDialog}
                className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
                  chargeGuests ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
                    chargeGuests ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
  );
}

export function GuestChargingDialogs({
  charge,
  loyaltyEnabled,
}: {
  charge: GuestChargingState;
  loyaltyEnabled: boolean;
}) {
  const { t } = useTranslation();
  const { chargeImpact, chargeSaving, chargeError, chargeOnDialogRef, chargeOffDialogRef, chargeOnCancelRef, chargeOffCancelRef, setChargeDialog, loadChargeImpact, closeChargeDialog, handleChargeConfirm } = charge;
  return (
    <>
      <dialog
        ref={chargeOnDialogRef}
        onClose={() => setChargeDialog(null)}
        onCancel={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.preventDefault();
        }}
        aria-labelledby="chargeOnTitle"
        className="w-full max-w-[440px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 id="chargeOnTitle" className="text-lg font-semibold">
            {t("settings.guestCharging.onTitle")}
          </h2>
          {chargeImpact.status === "loading" && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t("settings.guestCharging.impactLoading")}
            </p>
          )}
          {chargeImpact.status === "error" && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-red-600">
                {t("settings.guestCharging.impactError")}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadChargeImpact()}>
                {t("settings.guestCharging.retry")}
              </Button>
            </div>
          )}
          {chargeImpact.status === "ready" && (
            <p className="text-sm">
              {chargeImpact.count === 0
                ? t("settings.guestCharging.impactZero")
                : chargeImpact.count === 1
                  ? t("settings.guestCharging.impactOne")
                  : t("settings.guestCharging.impactMany", { count: chargeImpact.count })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t("settings.guestCharging.scope")}</p>
          <div
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="guest-charging-old-app-warning"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("settings.guestCharging.oldAppWarning")}</span>
          </div>
          {chargeError && (
            <p role="alert" className="text-sm text-red-600">
              {chargeError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              ref={chargeOnCancelRef}
              type="button"
              variant="outline"
              disabled={chargeSaving}
              onClick={closeChargeDialog}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={chargeSaving || chargeImpact.status !== "ready"}
              onClick={handleChargeConfirm}
            >
              {chargeSaving ? t("common.saving") : t("settings.guestCharging.start")}
            </Button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={chargeOffDialogRef}
        onClose={() => setChargeDialog(null)}
        onCancel={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.preventDefault();
        }}
        aria-labelledby="chargeOffTitle"
        className="w-full max-w-[440px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 id="chargeOffTitle" className="text-lg font-semibold">
            {t("settings.guestCharging.offTitle")}
          </h2>
          <p className="text-sm">{t("settings.guestCharging.offBody")}</p>
          {chargeImpact.status === "loading" && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t("settings.guestCharging.impactLoading")}
            </p>
          )}
          {chargeImpact.status === "ready" && (
            <p className="text-sm text-muted-foreground">
              {t("settings.guestCharging.offKept", { count: chargeImpact.validityDays })}
            </p>
          )}
          {(loyaltyEnabled) && (
            <p className="text-sm text-muted-foreground">{t("settings.guestCharging.offStamps")}</p>
          )}
          {chargeError && (
            <p role="alert" className="text-sm text-red-600">
              {chargeError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              ref={chargeOffCancelRef}
              type="button"
              variant="outline"
              disabled={chargeSaving}
              onClick={closeChargeDialog}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={chargeSaving || chargeImpact.status === "loading"}
              onClick={handleChargeConfirm}
            >
              {chargeSaving ? t("common.saving") : t("settings.guestCharging.stop")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
