"use client";

import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./SectionHeader";
import { type FieldErrors, type SettingsFormState } from "./settingsFormTypes";

export function FrontDeskAlertsSection({
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
            icon={Bell}
            accent="rose"
            title={t("settings.sections.frontDeskAlerts")}
            description={t("settings.sectionDescriptions.frontDeskAlerts")}
          />
          <CardContent>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="alertAutoDismissMinutes">{t("settings.fields.alertAutoDismiss")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="alertAutoDismissMinutes"
                  type="number"
                  value={form.alertAutoDismissMinutes}
                  onChange={(e) =>
                    setForm({ ...form, alertAutoDismissMinutes: e.target.value })
                  }
                />
                <span className="text-sm text-muted-foreground">
                  {t("settings.fields.alertAutoDismissUnit")}
                </span>
              </div>
              {fieldErrors.alertAutoDismissMinutes && (
                <p className="text-sm text-red-600">{fieldErrors.alertAutoDismissMinutes}</p>
              )}
            </div>
          </CardContent>
        </Card>
  );
}
