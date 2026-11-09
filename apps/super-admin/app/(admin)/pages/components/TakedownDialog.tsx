"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_TAKEDOWN_NOTE_MAX, PAGE_TAKEDOWN_NOTE_MIN, PAGE_TAKEDOWN_REASONS, PAGE_TAKEDOWN_REASON_LABELS, type PageTakedownReason } from "@gymos/types";

import { StepUpPrompt } from "@/components/step-up-prompt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { takeDownPage } from "../actions";

const STEP_UP_REQUIRED_CODE = "step_up_required"; // same value as lib/authz (server-only)
const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * SA-17: the takedown dialog. A reason code is required (six codes, one source in @gymos/types); "Other" also needs a note. The server asks
 * for a fresh authenticator code (step-up, bound to the gym) and the dialog retries once with it. `reportIds` are the open reports this answers.
 * Mount it only while a takedown is being made, so its state starts fresh each time.
 */
export function TakedownDialog({
  gymId,
  pageName,
  reportIds,
  onDone,
  onClose,
}: {
  gymId: string;
  pageName: string;
  reportIds?: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "fr" ? "fr" : "en";
  const [reason, setReason] = useState<PageTakedownReason>("impersonation");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askStepUp, setAskStepUp] = useState(false);

  const trimmed = note.trim();
  const noteOk = trimmed.length <= PAGE_TAKEDOWN_NOTE_MAX && (reason !== "other" || trimmed.length >= PAGE_TAKEDOWN_NOTE_MIN);

  async function submit() {
    if (!noteOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await takeDownPage({ gymId, reason, ...(trimmed ? { note: trimmed } : {}), ...(reportIds?.length ? { reportIds } : {}) });
      if (res.error) {
        if (res.error.code === STEP_UP_REQUIRED_CODE) {
          setAskStepUp(true);
          return;
        }
        setError(res.error.message);
        return;
      }
      onDone();
    } catch {
      setError(t("pages.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={!askStepUp} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent closeLabel={t("pages.takedown.cancel")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("pages.takedown.title", { name: pageName })}</DialogTitle>
              <DialogDescription>{t("pages.takedown.description")}</DialogDescription>
            </DialogHeader>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t("pages.takedown.reason")}</span>
              <select className={SELECT_CLASS} value={reason} onChange={(e) => setReason(e.target.value as PageTakedownReason)}>
                {PAGE_TAKEDOWN_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {PAGE_TAKEDOWN_REASON_LABELS[code][language]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{reason === "other" ? t("pages.takedown.noteRequired") : t("pages.takedown.note")}</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={PAGE_TAKEDOWN_NOTE_MAX}
                aria-invalid={!noteOk || undefined}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("pages.takedown.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!noteOk || busy}>
                {busy ? t("pages.takedown.working") : t("pages.takedown.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {askStepUp && (
        <StepUpPrompt
          action="take_down_gym_page"
          subjectId={gymId}
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
