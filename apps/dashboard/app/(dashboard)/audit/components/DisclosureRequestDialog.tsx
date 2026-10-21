"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fileDisclosureRequestAction } from "../actions";

/**
 * Story 23.8: the Owner asks GymOS about one audit entry. The server (file_audit_disclosure_request) is the real gate: Owner only,
 * an entry of this gym only, one open request per entry. The answer comes back outside the product and is listed in the panel.
 */
export function DisclosureRequestDialog({
  auditLogId,
  onClose,
  onDone,
}: {
  auditLogId: string;
  onClose: () => void;
  onDone: (answerDueAt: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: actionError } = await fileDisclosureRequestAction(auditLogId, question);
      if (actionError || !data) {
        setError(actionError?.message ?? t("common.somethingWentWrong"));
        return;
      }
      onDone(data.answerDueAt);
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("audit.disclosure.dialogTitle")}</h2>
        <div className="space-y-2">
          <Label htmlFor="disclosureQuestion">{t("audit.disclosure.questionLabel")}</Label>
          <textarea
            id="disclosureQuestion"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t("audit.disclosure.questionHint")}</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("audit.disclosure.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || question.trim().length < 3}>
            {t("audit.disclosure.submit")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
