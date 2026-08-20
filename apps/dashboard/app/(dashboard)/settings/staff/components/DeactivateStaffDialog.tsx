"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { deactivateStaffSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { StaffListRow } from "@/services/staff";
import { deactivateStaffMemberAction } from "../actions";

/**
 * Story 9.3 Task 14: mirrors `DeactivateMemberDialog.tsx`'s three-element
 * shape (title/body/labeled reason textarea) rather than AD-16's own
 * single-string mockup copy -- that mockup text isn't independently
 * reconcilable into a literal `<textarea>` vs. bare placeholder spec, and
 * this is an existing, already-reviewed component to copy near-verbatim
 * instead of inventing new dialog markup. AC #3: deactivation requires a
 * mandatory reason. UX-DR12's destructive-confirmation accessibility floor:
 * the confirm button names its specific target ("Deactivate Jane Doe", not
 * "Confirm").
 *
 * Escape is disabled unconditionally (not just while submitting) --
 * EXPERIENCE.md line 2262's destructive-confirmation rule reads
 * unconditional, which DeactivateMemberDialog.tsx's own `onCancel` handler
 * doesn't quite satisfy (it only blocks Escape while submitting); this new
 * dialog satisfies the rule as written rather than silently "fixing" the
 * Member dialog as an unrelated drive-by.
 */
export function DeactivateStaffDialog({
  staff,
  onClose,
  onDone,
}: {
  staff: StaffListRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = deactivateStaffSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await deactivateStaffMemberAction(staff.id, parsed.data);
      if (actionError) {
        setError(actionError.message);
        return;
      }
      onDone();
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
      onCancel={(e) => e.preventDefault()}
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">
          {t("staff.deactivateDialog.title", { name: staff.name })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("staff.deactivateDialog.body")}</p>

        <div className="space-y-2">
          <Label htmlFor="deactivateStaffReason">{t("staff.deactivateDialog.reason")}</Label>
          <textarea
            id="deactivateStaffReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 5}>
            {submitting
              ? t("staff.deactivateDialog.deactivating")
              : t("staff.deactivateDialog.confirmButton", { name: staff.name })}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
