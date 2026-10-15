"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./SectionHeader";
import { GymCategoryField } from "./GymCategoryField";
import { HEX_COLOR_RE, type FieldErrors, type SettingsFormState } from "./settingsFormTypes";
import { type LogoUploadState } from "./useLogoUpload";

export function BrandingSection({
  form,
  setForm,
  fieldErrors,
  logo,
  canManageCategory,
  initialCategory,
  showToast,
}: {
  form: SettingsFormState;
  setForm: (next: SettingsFormState) => void;
  fieldErrors: FieldErrors;
  logo: LogoUploadState;
  canManageCategory: boolean;
  initialCategory: string;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { logoUrl, logoError, uploadingLogo, handleLogoSelect, handleRemoveLogo } = logo;
  // Swatch only updates on a *valid* hex value -- kept separate from the raw
  // `form.primaryColor` field so an in-progress, still-invalid keystroke
  // doesn't blank the swatch.
  const [swatchColor, setSwatchColor] = useState(
    form.primaryColor && HEX_COLOR_RE.test(form.primaryColor) ? form.primaryColor : null,
  );

  function handleColorChange(value: string) {
    setForm({ ...form, primaryColor: value });
    if (HEX_COLOR_RE.test(value)) {
      setSwatchColor(value);
    }
  }

  return (
        <Card>
          <SectionHeader
            icon={Palette}
            accent="violet"
            title={t("settings.sections.branding")}
            description={t("settings.sectionDescriptions.branding")}
          />
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="gymName">{t("settings.fields.gymName")}</Label>
              <Input
                id="gymName"
                value={form.gymName}
                onChange={(e) => setForm({ ...form, gymName: e.target.value })}
              />
              {fieldErrors.gymName && <p className="text-sm text-red-600">{fieldErrors.gymName}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">{t("settings.fields.logo")}</Label>
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={t("settings.fields.logoPreviewAlt")}
                    className="size-24 rounded-md border object-cover"
                  />
                ) : (
                  <div className="flex size-24 items-center justify-center rounded-md border text-xs text-muted-foreground">
                    {t("settings.fields.noLogo")}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <label htmlFor="logo" className="cursor-pointer">
                      {uploadingLogo ? t("settings.fields.uploading") : t("settings.fields.uploadNew")}
                    </label>
                  </Button>
                  <input
                    id="logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleLogoSelect}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleRemoveLogo}>
                    {t("settings.fields.remove")}
                  </Button>
                </div>
              </div>
              {logoError && <p className="text-sm text-red-600">{logoError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryColor">{t("settings.fields.primaryColor")}</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="primaryColor"
                  value={form.primaryColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  placeholder="#E0971F"
                  className="max-w-40"
                />
                <div
                  className="size-9 shrink-0 rounded-md border"
                  style={{ backgroundColor: swatchColor ?? "transparent" }}
                  aria-hidden="true"
                />
              </div>
              {fieldErrors.primaryColor && (
                <p className="text-sm text-red-600">{fieldErrors.primaryColor}</p>
              )}
            </div>

            {canManageCategory && (
              <GymCategoryField initialCategory={initialCategory} showToast={showToast} />
            )}
          </CardContent>
        </Card>
  );
}
