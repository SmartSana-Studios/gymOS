"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { overrideGymCapSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GymDetail } from "@/services/gyms";
import { overrideGymCap } from "../../actions";

/** SA-03 "Override cap": numeric input inline, confirm to save. Empty
 * value clears the override, reverting to the tier's own cap. */
export function CapOverrideEditor({
  gym,
  onSaved,
}: {
  gym: GymDetail;
  onSaved: (warning?: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    gym.memberCapOverride !== null ? String(gym.memberCapOverride) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    const raw = value.trim();
    if (raw !== "" && Number.isNaN(Number(raw))) {
      setError(t("gyms.detail.enterPositiveNumber"));
      return;
    }
    const capOverride = raw === "" ? null : Number(raw);
    const parsed = overrideGymCapSchema.safeParse({ capOverride });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("gyms.detail.enterPositiveNumber"));
      return;
    }

    setSaving(true);
    try {
      const { error: actionError } = await overrideGymCap(gym.id, parsed.data);
      if (actionError) {
        // "no_op" (override already at that value) and "audit_log_failed"
        // (the override saved, only the audit entry failed to write) both
        // mean the gym's real cap override already matches what was
        // entered -- treat them as done rather than leaving the editor
        // stuck open on the pre-save value.
        if (actionError.code === "no_op") {
          setEditing(false);
          onSaved();
          return;
        }
        if (actionError.code === "audit_log_failed") {
          setEditing(false);
          onSaved(actionError.message);
          return;
        }
        setError(actionError.message);
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(gym.memberCapOverride !== null ? String(gym.memberCapOverride) : "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        {t("gyms.detail.overrideCap")}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("gyms.detail.overrideCapPlaceholder")}
        className="h-8 w-40"
      />
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving ? t("common.saving") : t("common.save")}
      </Button>
      <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
        {t("common.cancel")}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
