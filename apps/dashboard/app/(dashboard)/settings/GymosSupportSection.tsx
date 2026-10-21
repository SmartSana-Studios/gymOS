"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LifeBuoy } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { GymosSupportStatus } from "@/services/gym-settings";
import { loadGymosSupportStatus, saveAllowGymosSupport } from "./actions";
import { SectionHeader } from "./SectionHeader";

/**
 * Story 23.3: the Owner's "Allow GymOS Support" switch with a one-state readout. Never shows an individual or a count.
 * Saves through its own RPC (confirm first); [Save Settings] never writes it. Rendered for the Owner only.
 */
export function GymosSupportSection({
  initial,
  onSaved,
}: {
  initial: GymosSupportStatus;
  onSaved: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (saving) return;
    const next = !status.allowed;
    if (!window.confirm(t(next ? "settings.gymosSupport.confirmOn" : "settings.gymosSupport.confirmOff"))) return;
    setSaving(true);
    setError(null);
    try {
      const { error: saveError } = await saveAllowGymosSupport(next);
      if (saveError) {
        setError(t("settings.gymosSupport.saveFailed"));
        setSaving(false);
        return;
      }
    } catch {
      setError(t("settings.gymosSupport.saveFailed"));
      setSaving(false);
      return;
    }
    // Saved. A failed re-read keeps the previous readout with only the switch flipped.
    let fresh: GymosSupportStatus | null = null;
    try {
      fresh = (await loadGymosSupportStatus()).data ?? null;
    } catch {
      fresh = null;
    }
    setStatus(fresh ?? { ...status, allowed: next, state: next ? (status.state === "off" ? "none" : status.state) : "off" });
    onSaved(t(next ? "settings.gymosSupport.savedOn" : "settings.gymosSupport.savedOff"));
    setSaving(false);
  }

  const lastActed = status.lastActedAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(status.lastActedAt),
      )
    : t("settings.gymosSupport.lastActedNever");

  return (
    <Card>
      <SectionHeader
        icon={LifeBuoy}
        accent="teal"
        title={t("settings.gymosSupport.title")}
        description={t("settings.gymosSupport.description")}
      />
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <Label id="gymosSupportLabel">{t("settings.gymosSupport.label")}</Label>
          <button
            type="button"
            role="switch"
            aria-checked={status.allowed}
            aria-labelledby="gymosSupportLabel"
            disabled={saving}
            onClick={() => void toggle()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
              status.allowed ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
                status.allowed ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-sm" aria-live="polite">
          {t(`settings.gymosSupport.state.${status.state}`)}
        </p>
        {status.allowed && (
          <p className="text-xs text-muted-foreground">
            {t("settings.gymosSupport.lastActed", { when: lastActed })}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
