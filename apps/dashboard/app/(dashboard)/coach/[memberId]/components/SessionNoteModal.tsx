"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { addSessionNoteSchema, editSessionNoteSchema } from "@gymos/types";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addSessionNoteAction, editSessionNoteAction } from "../actions";

const NOTE_MAX = 2000;

const textareaClassName =
  "flex min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Session-note add/edit modal -- same `<dialog>` pattern as RenewalModal.tsx/
 * RecordPaymentModal.tsx/RecordRefundModal.tsx (per-user direction: all
 * forms in this app are modals, not embedded inline in the page -- matches
 * docs/decisions.md's own recorded precedent for RenewalModal's inline-to-
 * modal conversion). One component handles both add (`note` prop null) and
 * edit (`note` prop set) -- same textarea/character-count/submitting/
 * fieldError/formError local-state shape either way.
 */
export function SessionNoteModal({
  memberId,
  note,
  onClose,
  onSaved,
}: {
  memberId: string;
  note: { id: string; noteText: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isEdit = note !== null;

  const [text, setText] = useState(note?.noteText ?? "");
  // noteTextSchema validates the `.trim()`'d value -- the counter must match
  // what will actually pass/fail on submit (code review finding).
  const trimmedLength = text.trim().length;
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function resetAndClose() {
    onClose();
  }

  // Matches on the failing issue's `path`/`code` rather than its message
  // text -- a literal-string match against noteTextSchema's own message
  // would mislabel a malformed memberId/noteId issue (which precedes
  // noteText in the schema) as "note too long" (code review finding).
  function fieldErrorFor(issues: { path: PropertyKey[]; code?: string }[]): string {
    const noteTextIssue = issues.find((issue) => issue.path.includes("noteText"));
    if (!noteTextIssue) return t("coachPortal.detail.notes.errors.tooLong");
    return noteTextIssue.code === "too_small"
      ? t("coachPortal.detail.notes.errors.required")
      : t("coachPortal.detail.notes.errors.tooLong");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    if (isEdit) {
      const parsed = editSessionNoteSchema.safeParse({ noteId: note.id, noteText: text });
      if (!parsed.success) {
        setFieldError(fieldErrorFor(parsed.error.issues));
        return;
      }
      setSubmitting(true);
      const { error } = await editSessionNoteAction(parsed.data);
      setSubmitting(false);
      if (error) {
        setFormError(error.message);
        return;
      }
    } else {
      const parsed = addSessionNoteSchema.safeParse({ memberId, noteText: text });
      if (!parsed.success) {
        setFieldError(fieldErrorFor(parsed.error.issues));
        return;
      }
      setSubmitting(true);
      const { error } = await addSessionNoteAction(parsed.data);
      setSubmitting(false);
      if (error) {
        setFormError(error.message);
        return;
      }
    }

    onSaved();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEdit ? t("coachPortal.detail.notes.editTitle") : t("coachPortal.detail.notes.addTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("coachPortal.detail.notes.cancel")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
            autoFocus
            maxLength={NOTE_MAX}
            placeholder={t("coachPortal.detail.notes.placeholder")}
            className={textareaClassName}
          />
          <p className={`text-xs ${trimmedLength > NOTE_MAX ? "text-red-600" : "text-muted-foreground"}`}>
            {t("coachPortal.detail.notes.charCount", { count: trimmedLength, max: NOTE_MAX })}
          </p>
          {fieldError && <p className="text-sm text-red-600">{fieldError}</p>}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("coachPortal.detail.notes.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("coachPortal.detail.notes.saving") : t("coachPortal.detail.notes.save")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
