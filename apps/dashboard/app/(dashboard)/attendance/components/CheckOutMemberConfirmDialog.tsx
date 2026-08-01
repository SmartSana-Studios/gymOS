"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { checkOutMemberAction } from "../actions";

/**
 * Mirrors DeactivateMemberDialog's structural pattern (native `<dialog>`,
 * same submitting/error state shape) minus the reason field -- Check Out has
 * no equivalent mandatory-reason requirement.
 */
export function CheckOutMemberConfirmDialog({
  memberId,
  memberName,
  onClose,
  onDone,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
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
      const { error: actionError } = await checkOutMemberAction(memberId);
      if (actionError) {
        // actionError.message is already localized (mapAndLog/mapSupabaseError) --
        // includes the two check_out_member() branches Task 4 added
        // (member_not_found, no_open_check_in).
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
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{t("attendance.checkOutDialog.title", { name: memberName })}</h2>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={submitting}>
            {submitting ? t("attendance.checkOutDialog.checkingOut") : t("attendance.checkOutDialog.confirmButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
