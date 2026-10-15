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
          </CardContent>
        </Card>
  );
}
