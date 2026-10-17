"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { issueStepUp } from "@/app/(admin)/step-up-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Story 22.7: asks for a fresh authenticator code, binds it to (action, subject) and reports
 * success so the caller can re-run the protected action once. The code is never kept after submit.
 *
 * Shown as a modal (native <dialog>, like the enrol and recovery dialogs) and rendered in a portal on
 * document.body, so it opens on top of any other modal and never nests a <form> inside another form.
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={t("stepUp.title")}
      // Esc fires "cancel". There is deliberately no onClose handler: closing the dialog from the effect cleanup
      // (React StrictMode re-mounts in dev) would fire "close" and cancel the prompt the moment it opened.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("stepUp.title")}</h2>
          <button
            type="button"
            aria-label={t("security.close")}
            onClick={onCancel}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{t("stepUp.description")}</p>
        <div className="grid gap-2">
          <Label htmlFor="stepup-code">{t("stepUp.codeLabel")}</Label>
          <Input
            id="stepup-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t("stepUp.cancel")}
          </Button>
          <Button type="submit" disabled={busy || code.trim().length !== 6}>
            {busy ? t("stepUp.verifying") : t("stepUp.confirm")}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
