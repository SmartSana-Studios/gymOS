"use client";

import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./SectionHeader";
import { TIMEZONE_OPTIONS, type FieldErrors, type SettingsFormState } from "./settingsFormTypes";

export function LocalizationSection({
  form,
  setForm,
  fieldErrors,
  countryOptions,
}: {
  form: SettingsFormState;
  setForm: (next: SettingsFormState) => void;
  fieldErrors: FieldErrors;
  countryOptions: { code: string; name: string; callingCode: string }[];
}) {
  const { t } = useTranslation();
  return (
        <Card>
          <SectionHeader
            icon={Globe}
            accent="emerald"
            title={t("settings.sections.localization")}
            description={t("settings.sectionDescriptions.localization")}
          />
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultLanguage">{t("settings.fields.defaultLanguage")}</Label>
              <select
                id="defaultLanguage"
                value={form.defaultLanguage}
                onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="en">{t("settings.languageOptionEnglish")}</option>
                <option value="fr">{t("settings.languageOptionFrench")}</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country">{t("settings.fields.country")}</Label>
              <select
                id="country"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {countryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.callingCode})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("settings.fields.countryHint")}</p>
              {fieldErrors.country && <p className="text-sm text-red-600">{fieldErrors.country}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">{t("settings.fields.timezone")}</Label>
              <select
                id="timezone"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              {fieldErrors.timezone && <p className="text-sm text-red-600">{fieldErrors.timezone}</p>}
            </div>
          </CardContent>
        </Card>
  );
}
