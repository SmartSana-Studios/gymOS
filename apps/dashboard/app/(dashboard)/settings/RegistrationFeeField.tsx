"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { registrationFeeSchema } from "@gymos/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveRegistrationFee } from "./actions";

export function RegistrationFeeField({
  initialFee,
  showToast,
}: {
  initialFee: number;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  // Story 18.1: the registration fee saves through its own RPC (the column is
  // pinned against the main form's UPDATE), so it has its own state and Save
  // button, mirroring the billing notification email.
  const [registrationFee, setRegistrationFee] = useState(String(initialFee));
  const [registrationFeeError, setRegistrationFeeError] = useState<string | null>(null);
  const [savingRegistrationFee, setSavingRegistrationFee] = useState(false);

  async function handleSaveRegistrationFee() {
    setRegistrationFeeError(null);
    const trimmed = registrationFee.trim();
    // Number("") is 0 and Number("1e3") is 1000 -- accept only plain digits so
    // a blank field never silently turns the fee off.
    const parsed = /^\d+$/.test(trimmed) ? registrationFeeSchema.safeParse(Number(trimmed)) : null;
    if (!parsed || !parsed.success) {
      setRegistrationFeeError(t("settings.errors.registrationFeeInvalid"));
      return;
    }
    setSavingRegistrationFee(true);
    try {
      const { error } = await saveRegistrationFee(parsed.data);
      if (error) {
        setRegistrationFeeError(error.message);
        return;
      }
      setRegistrationFee(String(parsed.data));
      showToast(t("settings.fields.registrationFeeSavedToast"));
    } catch {
      setRegistrationFeeError(t("settings.errors.registrationFeeSaveFailed"));
    } finally {
      setSavingRegistrationFee(false);
    }
  }

  return (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="registrationFee">{t("settings.fields.registrationFee")}</Label>
          <p className="text-xs text-muted-foreground">{t("settings.fields.registrationFeeHint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Input
                id="registrationFee"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={registrationFee}
                onChange={(e) => {
                  setRegistrationFee(e.target.value);
                  setRegistrationFeeError(null);
                }}
                onKeyDown={(e) => {
                  // Enter inside this field must save the fee, not submit the main settings form.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSaveRegistrationFee();
                  }
                }}
                disabled={savingRegistrationFee}
                className="sm:max-w-40"
              />
              <span className="text-sm text-muted-foreground">{t("settings.fields.registrationFeeUnit")}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingRegistrationFee}
              onClick={handleSaveRegistrationFee}
            >
              {savingRegistrationFee ? t("common.saving") : t("settings.fields.registrationFeeSave")}
            </Button>
          </div>
          {registrationFeeError && <p className="text-sm text-red-600">{registrationFeeError}</p>}
        </div>
  );
}
