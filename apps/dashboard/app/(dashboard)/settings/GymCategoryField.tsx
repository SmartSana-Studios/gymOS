"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GYM_CATEGORIES, gymCategoryLabel } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveGymCategory } from "./actions";

export function GymCategoryField({
  initialCategory,
  showToast,
}: {
  initialCategory: string;
  showToast: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // Story 21.2: the category saves through its own RPC (the column is pinned
  // against the main form's UPDATE), so its state is independent of the main
  // form: [Save Settings] never sends it and a general save never resets it.
  const [category, setCategory] = useState(initialCategory);
  const [savedCategory, setSavedCategory] = useState(initialCategory);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  async function handleSaveCategory() {
    if (savingCategory || category === savedCategory) return;
    setCategoryError(null);
    if (!(GYM_CATEGORIES as readonly string[]).includes(category)) {
      setCategoryError(t("settings.category.selectError"));
      return;
    }
    const submitted = category;
    setSavingCategory(true);
    try {
      const { error } = await saveGymCategory(submitted);
      if (error) {
        setCategoryError(error.message);
        return;
      }
      setSavedCategory(submitted);
      showToast(t("settings.category.savedToast"));
    } catch {
      setCategoryError(t("settings.category.saveFailed"));
    } finally {
      setSavingCategory(false);
    }
  }

  return (
          <div className="space-y-2">
            <Label htmlFor="gymCategory">{t("settings.category.label")}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <select
                id="gymCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={savingCategory}
                aria-describedby="gymCategoryHelp"
                className="flex h-9 w-full max-w-64 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {GYM_CATEGORIES.map((code) => (
                  <option key={code} value={code}>
                    {gymCategoryLabel(code, i18n.language)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveCategory}
                disabled={savingCategory || category === savedCategory}
              >
                {t("settings.category.save")}
              </Button>
            </div>
            <p id="gymCategoryHelp" className="text-xs text-muted-foreground">
              {t("settings.category.helper")}
            </p>
            {categoryError && (
              <p role="alert" className="text-sm text-red-600">
                {categoryError}
              </p>
            )}
          </div>
  );
}
