"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gift } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LOYALTY_RANGES,
  guestDiscountPercent,
  parseLoyaltyNumber,
  subscriberReadoutLines,
  type LoyaltyPlanDuration,
} from "./loyaltyReadout";
import { saveLoyaltyProgram } from "./actions";
import { SectionHeader } from "./SectionHeader";

const LOYALTY_READOUT_DELAY_MS = 300;

/** The value after it has stopped changing for `delayMs` (AD-13's 300 ms readout pause). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Story 20.5: the loyalty program section of Settings. Saves through its own RPC and its own
 * [Save loyalty program] button; [Save Settings] never writes it. Extracted from SettingsForm
 * (Epic 20 retro G-1) with no behavior change.
 */
export function LoyaltyProgramSection({
  initial,
  plans: loyaltyPlans,
  chargingOn,
  onSaved,
  onEnabledChange,
}: {
  initial: { enabled: boolean; n: number | null; k: number | null; r: number | null };
  plans: LoyaltyPlanDuration[];
  /** Charge guests per session is on; off shows the "loyalty earns only while charging" line. */
  chargingOn: boolean;
  onSaved: (message: string) => void;
  /** Reports the stored switch after a save (the parent's turn-off dialog reads it). */
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  // Story 20.5: the loyalty program saves through its own RPC, so it has its
  // own state and Save button. `loyaltySaved` is the stored baseline.
  const [loyaltySaved, setLoyaltySaved] = useState({
    enabled: initial.enabled,
    n: initial.n,
    k: initial.k,
    r: initial.r,
  });
  const [loyaltyOn, setLoyaltyOn] = useState(initial.enabled);
  const [loyaltyN, setLoyaltyN] = useState(initial.n === null ? "" : String(initial.n));
  const [loyaltyK, setLoyaltyK] = useState(initial.k === null ? "" : String(initial.k));
  const [loyaltyR, setLoyaltyR] = useState(initial.r === null ? "" : String(initial.r));
  const [loyaltyErrors, setLoyaltyErrors] = useState<{ n?: string; k?: string; r?: string }>({});
  const [loyaltySummaryError, setLoyaltySummaryError] = useState<string | null>(null);
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const loyaltyReadoutInputs = useDebouncedValue(`${loyaltyN}|${loyaltyK}|${loyaltyR}`, LOYALTY_READOUT_DELAY_MS);

  async function handleSave() {
    setLoyaltyErrors({});
    setLoyaltySummaryError(null);

    let payload: { enabled: boolean; n: number; k: number; r: number };
    if (loyaltyOn) {
      const n = parseLoyaltyNumber(loyaltyN, LOYALTY_RANGES.n.min, LOYALTY_RANGES.n.max);
      const k = parseLoyaltyNumber(loyaltyK, LOYALTY_RANGES.k.min, LOYALTY_RANGES.k.max);
      const r = parseLoyaltyNumber(loyaltyR, LOYALTY_RANGES.r.min, LOYALTY_RANGES.r.max);
      if (n === null || k === null || r === null) {
        setLoyaltyErrors({
          ...(n === null && { n: t("settings.loyalty.errors.n") }),
          ...(k === null && { k: t("settings.loyalty.errors.k") }),
          ...(r === null && { r: t("settings.loyalty.errors.r") }),
        });
        return;
      }
      payload = { enabled: true, n, k, r };
    } else {
      // Off stores only the switch: the setter ignores these, and the
      // generated argument type is non-null (2/3/1 when never configured).
      payload = {
        enabled: false,
        n: loyaltySaved.n ?? 2,
        k: loyaltySaved.k ?? 3,
        r: loyaltySaved.r ?? 1,
      };
    }

    setSavingLoyalty(true);
    try {
      const { error } = await saveLoyaltyProgram(payload);
      if (error) {
        setLoyaltySummaryError(t("settings.loyalty.saveFailed"));
        return;
      }
      if (payload.enabled) {
        setLoyaltySaved({ enabled: true, n: payload.n, k: payload.k, r: payload.r });
      } else {
        setLoyaltySaved((current) => ({ ...current, enabled: false }));
        // Edits made before switching off were not stored; show what is.
        setLoyaltyN(loyaltySaved.n === null ? "" : String(loyaltySaved.n));
        setLoyaltyK(loyaltySaved.k === null ? "" : String(loyaltySaved.k));
        setLoyaltyR(loyaltySaved.r === null ? "" : String(loyaltySaved.r));
      }
      onEnabledChange(payload.enabled);
      onSaved(t("settings.loyalty.savedToast"));
    } catch {
      setLoyaltySummaryError(t("settings.loyalty.saveFailed"));
    } finally {
      setSavingLoyalty(false);
    }
  }

    const [debouncedN, debouncedK, debouncedR] = loyaltyReadoutInputs.split("|");
    const readoutN = parseLoyaltyNumber(debouncedN, LOYALTY_RANGES.n.min, LOYALTY_RANGES.n.max);
    const readoutK = parseLoyaltyNumber(debouncedK, LOYALTY_RANGES.k.min, LOYALTY_RANGES.k.max);
    const readoutR = parseLoyaltyNumber(debouncedR, LOYALTY_RANGES.r.min, LOYALTY_RANGES.r.max);
    const subscriberLines =
      readoutK !== null && readoutR !== null ? subscriberReadoutLines(readoutK, readoutR, loyaltyPlans) : [];
    const liveN = parseLoyaltyNumber(loyaltyN, LOYALTY_RANGES.n.min, LOYALTY_RANGES.n.max);
    const liveK = parseLoyaltyNumber(loyaltyK, LOYALTY_RANGES.k.min, LOYALTY_RANGES.k.max);
    const lowered =
      (liveN !== null && loyaltySaved.n !== null && liveN < loyaltySaved.n) ||
      (liveK !== null && loyaltySaved.k !== null && liveK < loyaltySaved.k);
    const showOffNote = !loyaltyOn && loyaltySaved.enabled;
    return (
      <Card>
        <SectionHeader
          icon={Gift}
          accent="amber"
          title={t("settings.loyalty.title")}
          description={t("settings.loyalty.description")}
        />
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <Label id="loyaltyLabel">{t("settings.loyalty.label")}</Label>
            <button
              type="button"
              role="switch"
              aria-checked={loyaltyOn}
              aria-labelledby="loyaltyLabel"
              disabled={savingLoyalty}
              onClick={() => setLoyaltyOn((on) => !on)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
                loyaltyOn ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
                  loyaltyOn ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="loyaltyN">{t("settings.loyalty.guestsLabel")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="loyaltyN"
                type="number"
                inputMode="numeric"
                value={loyaltyN}
                disabled={!loyaltyOn || savingLoyalty}
                onChange={(e) => {
                  setLoyaltyN(e.target.value);
                  setLoyaltyErrors((errs) => ({ ...errs, n: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                aria-describedby="loyaltyNHelp"
                className="max-w-24"
              />
              <span id="loyaltyNHelp" className="text-xs text-muted-foreground">
                {t("settings.loyalty.rangeN")}
              </span>
            </div>
            {loyaltyErrors.n && <p className="text-sm text-red-600">{loyaltyErrors.n}</p>}
            {/* Always mounted so a screen reader announces content that arrives later. */}
            <div aria-live="polite" className="text-xs text-muted-foreground">
              {readoutN !== null && (
                <p>
                  <span aria-hidden="true">
                    {t("settings.loyalty.guestReadout", { n: readoutN, percent: guestDiscountPercent(readoutN) })}
                  </span>
                  <span className="sr-only">
                    {t("settings.loyalty.guestReadoutSr", { n: readoutN, percent: guestDiscountPercent(readoutN) })}
                  </span>
                </p>
              )}
            </div>
            {!chargingOn && (
              <p className="text-xs text-muted-foreground">{t("settings.loyalty.chargingOffInfo")}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="loyaltyR">{t("settings.loyalty.subscribersLabel")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="loyaltyR"
                type="number"
                inputMode="numeric"
                value={loyaltyR}
                disabled={!loyaltyOn || savingLoyalty}
                onChange={(e) => {
                  setLoyaltyR(e.target.value);
                  setLoyaltyErrors((errs) => ({ ...errs, r: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                aria-label={t("settings.loyalty.rewardDaysAria")}
                aria-describedby="loyaltyRHelp"
                className="max-w-24"
              />
              <span id="loyaltyRHelp" className="text-xs text-muted-foreground">
                {t("settings.loyalty.rangeR")}
              </span>
              <Input
                id="loyaltyK"
                type="number"
                inputMode="numeric"
                value={loyaltyK}
                disabled={!loyaltyOn || savingLoyalty}
                onChange={(e) => {
                  setLoyaltyK(e.target.value);
                  setLoyaltyErrors((errs) => ({ ...errs, k: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                aria-label={t("settings.loyalty.renewalsAria")}
                aria-describedby="loyaltyKHelp"
                className="max-w-24"
              />
              <span id="loyaltyKHelp" className="text-xs text-muted-foreground">
                {t("settings.loyalty.rangeK")}
              </span>
            </div>
            {loyaltyErrors.r && <p className="text-sm text-red-600">{loyaltyErrors.r}</p>}
            {loyaltyErrors.k && <p className="text-sm text-red-600">{loyaltyErrors.k}</p>}
            <div aria-live="polite" className="space-y-0.5 text-xs text-muted-foreground">
              {readoutR !== null &&
                readoutK !== null &&
                subscriberLines.map((line) => {
                  const vars = {
                    r: readoutR,
                    k: readoutK,
                    d: line.durationDays,
                    plan: line.planName,
                    percent: line.percent,
                  };
                  return (
                    <p key={line.durationDays}>
                      <span aria-hidden="true">{t("settings.loyalty.subscriberReadout", vars)}</span>
                      <span className="sr-only">{t("settings.loyalty.subscriberReadoutSr", vars)}</span>
                    </p>
                  );
                })}
            </div>
          </div>

          {showOffNote && (
            <p className="text-sm text-muted-foreground">{t("settings.loyalty.offNote")}</p>
          )}
          {lowered && <p className="text-sm text-muted-foreground">{t("settings.loyalty.loweredNote")}</p>}
          {loyaltySummaryError && (
            <p role="alert" className="text-sm text-red-600">
              {loyaltySummaryError}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" variant="outline" disabled={savingLoyalty} onClick={handleSave}>
              {savingLoyalty ? t("common.saving") : t("settings.loyalty.saveButton")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
}
