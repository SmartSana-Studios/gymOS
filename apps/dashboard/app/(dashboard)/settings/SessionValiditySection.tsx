"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { SESSION_VALIDITY_VALUES, type SessionValidity } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { saveSessionValidity } from "./actions";
import { SectionHeader } from "./SectionHeader";

/** Minutes shown as hours: a whole number when the limit is a whole hour, one decimal otherwise (UX AD-13). */
export function visitLimitHours(minutes: number): number {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
}

/**
 * Story 28.1 (UX AD-13 "Session validity"): the Whole day / Single use radio. Saves through its own RPC and its own button;
 * [Save Settings] never sends it (the column is pinned against the general save). No confirmation dialog: the consequences are
 * written on the screen. Always editable: with charging off it shows a note instead of disabling the choice. The visit limit comes
 * from the platform value and is never typed into a string.
 */
export function SessionValiditySection({
  initial,
  chargingOn,
  loyaltyOn,
  onSaved,
  onSavedValueChange,
}: {
  initial: { sessionValidity: SessionValidity; visitLimitMinutes: number };
  /** "Charge guests per session" is on; off shows the "takes effect when charging is on" line. */
  chargingOn: boolean;
  /** The loyalty program is on; the loyalty note shows only together with Single use. */
  loyaltyOn: boolean;
  onSaved: (message: string) => void;
  /** Reports the stored value after a save (the Charge guests helper reads it). */
  onSavedValueChange?: (value: SessionValidity) => void;
}) {
  const { t, i18n } = useTranslation();
  const groupId = useId();
  const [saved, setSaved] = useState<SessionValidity>(initial.sessionValidity);
  const [choice, setChoice] = useState<SessionValidity>(initial.sessionValidity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hours = visitLimitHours(initial.visitLimitMinutes);
  const hoursText = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(hours);

  const labelKey = { whole_day: "settings.sessionValidity.wholeDay", single_use: "settings.sessionValidity.singleUse" } as const;
  const descriptionOf = (value: SessionValidity) =>
    value === "whole_day"
      ? t("settings.sessionValidity.wholeDayDesc")
      : t("settings.sessionValidity.singleUseDesc", { hours: hoursText, count: hours });

  async function handleSave() {
    if (saving || choice === saved) return;
    setError(null);
    const submitted = choice;
    setSaving(true);
    try {
      const { error: saveError } = await saveSessionValidity(submitted);
      if (saveError) {
        setError(saveError.message || t("settings.sessionValidity.error"));
        return;
      }
      setSaved(submitted);
      onSavedValueChange?.(submitted);
      onSaved(t("settings.sessionValidity.saved"));
    } catch {
      setError(t("settings.sessionValidity.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <SectionHeader
        icon={CalendarClock}
        accent="cyan"
        title={t("settings.sessionValidity.title")}
        description={t("settings.sessionValidity.description")}
      />
      <CardContent className="space-y-4">
        <fieldset className="space-y-3" disabled={saving}>
          <legend className="sr-only">{t("settings.sessionValidity.title")}</legend>
          {SESSION_VALIDITY_VALUES.map((value) => (
            <label key={value} className="flex cursor-pointer items-start gap-3" htmlFor={`${groupId}-${value}`}>
              <input
                id={`${groupId}-${value}`}
                type="radio"
                name={`${groupId}-session-validity`}
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                aria-describedby={`${groupId}-${value}-desc`}
                className="mt-1"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t(labelKey[value])}</span>
                <span id={`${groupId}-${value}-desc`} className="block text-xs text-muted-foreground">
                  {descriptionOf(value)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="text-sm text-muted-foreground">{t("settings.sessionValidity.classNote")}</p>
        <p className="text-sm text-muted-foreground">{t("settings.sessionValidity.applies")}</p>
        {!chargingOn && <p className="text-sm text-muted-foreground">{t("settings.sessionValidity.chargingOff")}</p>}
        {loyaltyOn && choice === "single_use" && (
          <p className="text-sm text-muted-foreground">{t("settings.sessionValidity.loyaltyNote")}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={saving || choice === saved}>
            {t("settings.sessionValidity.save")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
