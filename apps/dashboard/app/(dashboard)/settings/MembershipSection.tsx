"use client";

import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "./SectionHeader";
import { type FieldErrors, type SettingsFormState } from "./settingsFormTypes";
import { RegistrationFeeField } from "./RegistrationFeeField";
import { GuestChargingControl, useGuestCharging } from "./GuestChargingSection";

export function MembershipSection({
  form,
  setForm,
  fieldErrors,
  initialFee,
  canManageGuestCharging,
  charge,
  showToast,
}: {
  form: SettingsFormState;
  setForm: (next: SettingsFormState) => void;
  fieldErrors: FieldErrors;
  initialFee: number;
  canManageGuestCharging: boolean;
  charge: ReturnType<typeof useGuestCharging>;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  return (
        <Card>
          <SectionHeader
            icon={Users}
            accent="amber"
            title={t("settings.sections.membership")}
            description={t("settings.sectionDescriptions.membership")}
          />
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="gracePeriodDays">{t("settings.fields.gracePeriod")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="gracePeriodDays"
                  type="number"
                  value={form.gracePeriodDays}
                  onChange={(e) => setForm({ ...form, gracePeriodDays: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">{t("settings.fields.gracePeriodUnit")}</span>
              </div>
              {fieldErrors.gracePeriodDays && (
                <p className="text-sm text-red-600">{fieldErrors.gracePeriodDays}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="capacity">{t("settings.fields.capacity")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="capacity"
                  type="number"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">{t("settings.fields.capacityUnit")}</span>
              </div>
              {fieldErrors.capacity && <p className="text-sm text-red-600">{fieldErrors.capacity}</p>}
            </div>

            <RegistrationFeeField initialFee={initialFee} showToast={showToast} />

            {canManageGuestCharging && <GuestChargingControl charge={charge} />}
          </CardContent>
        </Card>
  );
}
