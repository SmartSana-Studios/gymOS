"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GYM_CATEGORIES, gymCategoryLabel, setGymCategorySchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import type { GymDetail } from "@/services/gyms";
import { changeGymCategory } from "../../actions";

/** SA-03 `Category: [label] [Change]` row (Story 21.1). Turns into an inline
 * select with [Save] / [Cancel]. No confirmation: the change is descriptive
 * and audited by set_gym_category(). A refusal shows inline. */
export function GymCategoryEditor({
  gym,
  onSaved,
}: {
  gym: GymDetail;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(gym.category);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    const parsed = setGymCategorySchema.safeParse({ category: value });
    if (!parsed.success) {
      setError(t("gyms.create.categoryInvalid"));
      return;
    }

    setSaving(true);
    try {
      const { error: actionError } = await changeGymCategory(gym.id, parsed.data);
      if (actionError) {
        setError(actionError.message);
        return;
      }
      setEditing(false);
      setSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(gym.category);
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        {gymCategoryLabel(gym.category, i18n.language)}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setValue(gym.category);
            setSaved(false);
            setEditing(true);
          }}
        >
          {t("gyms.detail.change")}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {saved ? t("gyms.detail.categoryUpdated") : ""}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("gyms.detail.category")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        className="flex h-8 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {GYM_CATEGORIES.map((code) => (
          <option key={code} value={code}>
            {gymCategoryLabel(code, i18n.language)}
          </option>
        ))}
      </select>
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
