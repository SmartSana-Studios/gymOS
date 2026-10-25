"use client";

import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./SectionHeader";
import { type FieldErrors, type SettingsFormState } from "./settingsFormTypes";

export function AttendanceSection({
  form,
  setForm,
  fieldErrors,
}: {
  form: SettingsFormState;
  setForm: (next: SettingsFormState) => void;
  fieldErrors: FieldErrors;
}) {
  const { t } = useTranslation();
  return (
        <Card>
          <SectionHeader
            icon={Clock}
            accent="cyan"
            title={t("settings.sections.attendance")}
            description={t("settings.sectionDescriptions.attendance")}
          />
          <CardContent>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="checkinTimeoutHours">{t("settings.fields.checkinTimeout")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="checkinTimeoutHours"
                  type="number"
                  value={form.checkinTimeoutHours}
                  onChange={(e) =>
                    setForm({ ...form, checkinTimeoutHours: e.target.value })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {t("settings.fields.checkinTimeoutUnit")}
                </span>
              </div>
              {fieldErrors.checkinTimeoutHours && (
                <p className="text-sm text-red-600">{fieldErrors.checkinTimeoutHours}</p>
              )}
            </div>

            <div className="mt-6 max-w-md space-y-2">
              <p className="text-sm font-medium">{t("settings.fields.openingHours")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.fields.openingHoursHint")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="space-y-1">
                  <Label htmlFor="openingTime" className="text-xs text-muted-foreground">
                    {t("settings.fields.openingTime")}
                  </Label>
                  <Input
                    id="openingTime"
                    type="time"
                    value={form.openingTime}
                    onChange={(e) => setForm({ ...form, openingTime: e.target.value })}
                    className="w-32"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="closingTime" className="text-xs text-muted-foreground">
                    {t("settings.fields.closingTime")}
                  </Label>
                  <Input
                    id="closingTime"
                    type="time"
                    value={form.closingTime}
                    onChange={(e) => setForm({ ...form, closingTime: e.target.value })}
                    className="w-32"
                  />
                </div>
              </div>
              {(fieldErrors.openingTime || fieldErrors.closingTime) && (
                <p className="text-sm text-red-600">{fieldErrors.openingTime ?? fieldErrors.closingTime}</p>
              )}
            </div>
          </CardContent>
        </Card>
  );
}
