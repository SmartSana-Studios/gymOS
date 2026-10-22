"use client";

import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Story 23-6c: the fresh authenticator code a GymOS Support session types in a money- or access-changing dialog. */
export function isSupportCodeWellFormed(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s+/g, ""));
}

/** The account was locked (too many wrong codes): the session is over, so go to the login page with the expired notice. */
export function goToLoginExpired(): void {
  window.location.assign("/auth/login?expired=1");
}

export function SupportCodeField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("supportStepUp.codeLabel")}</Label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <p className="text-xs text-muted-foreground">{t("supportStepUp.codeHelp")}</p>
    </div>
  );
}
