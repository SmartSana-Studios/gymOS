"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StepUpPrompt } from "@/components/step-up-prompt";
import { REASON_MAX, reasonValid } from "./constants";

const STEP_UP_REQUIRED_CODE = "step_up_required"; // same value as lib/authz (server-only)

type Outcome<T> = { data: T | null; error: { code?: string; message: string } | null };

/**
 * Story 23.12: one modal for every support action that needs a reason. The reason lives in this modal's own state, so a stale reason
 * can never authorise a different action. Opened only while an action is chosen (mount it conditionally): state starts fresh each time.
 * A server refusal is shown inline and the modal stays open; success closes it through `onDone`.
 */
export function SupportActionModal<T>({
  title,
  description,
  submitLabel,
  reasonLabel,
  reasonHint,
  extra,
  extraValid = true,
  run,
  onDone,
  onClose,
  stepUp,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  /** Overrides the "Reason" label (the factor reset collects an identity check instead). */
  reasonLabel?: string;
  reasonHint?: string;
  /** Extra fields shown above the reason (e.g. the new address). */
  extra?: React.ReactNode;
  extraValid?: boolean;
  run: (reason: string) => Promise<Outcome<T>>;
  onDone: (data: T | null) => void;
  onClose: () => void;
  /** When the server answers `step_up_required`, ask for a fresh code for this action and retry. */
  stepUp?: { action: React.ComponentProps<typeof StepUpPrompt>["action"]; subjectId: string };
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askStepUp, setAskStepUp] = useState(false);
  const valid = reasonValid(reason) && extraValid;
  const showReasonError = touched && !reasonValid(reason);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await run(reason.trim());
      if (err) {
        if (stepUp && err.code === STEP_UP_REQUIRED_CODE) {
          setAskStepUp(true);
          return;
        }
        setError(err.message);
        return;
      }
      onDone(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={!askStepUp} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent closeLabel={t("support.modal.cancel")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className={description ? undefined : "sr-only"}>{description ?? title}</DialogDescription>
            </DialogHeader>
            {extra}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{reasonLabel ?? t("support.modal.reason")}</span>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                maxLength={REASON_MAX}
                placeholder={reasonHint ?? t("support.modal.reasonHint")}
                aria-invalid={showReasonError || undefined}
              />
            </label>
            {showReasonError && (
              <p role="alert" className="text-sm text-destructive">
                {t("support.modal.reasonInvalid")}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("support.modal.cancel")}
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {busy ? t("support.modal.working") : submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {askStepUp && stepUp && (
        <StepUpPrompt
          action={stepUp.action}
          subjectId={stepUp.subjectId}
          onCancel={() => setAskStepUp(false)}
          onIssued={() => {
            setAskStepUp(false);
            void submit();
          }}
        />
      )}
    </>
  );
}
