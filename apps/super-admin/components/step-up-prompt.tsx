"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { issueStepUp } from "@/app/(admin)/step-up-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Story 22.7: asks for a fresh authenticator code, binds it to (action, subject) and reports
 * success so the caller can re-run the protected action once. The code is never kept after submit.
 */
export function StepUpPrompt({
  action,
  subjectId,
  onIssued,
  onCancel,
}: {
  action: "remove_super_admin_factor" | "create_super_admin" | "change_recovery_email" | "remove_recovery_email";
  subjectId: string;
  onIssued: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // This form can sit inside another form (AddAdminModal); never let the submit reach it.
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await issueStepUp({ action, subjectId, code });
      setCode("");
      if (err) {
        setError(err.message);
        return;
      }
      onIssued();
    } catch {
      setError(t("stepUp.invalidCode"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border rounded p-4" aria-label={t("stepUp.title")}>
      <p className="text-sm font-medium">{t("stepUp.title")}</p>
      <p className="text-sm text-muted-foreground">{t("stepUp.description")}</p>
      <div className="grid gap-2">
        <Label htmlFor="stepup-code">{t("stepUp.codeLabel")}</Label>
        <Input
          id="stepup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || code.trim().length !== 6}>
          {busy ? t("stepUp.verifying") : t("stepUp.confirm")}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t("stepUp.cancel")}
        </Button>
      </div>
    </form>
  );
}
