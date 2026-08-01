"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { deactivateMemberSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { MemberListRow } from "@/services/members";
import { deactivateMember } from "../actions";

/**
 * AC #3: deactivation requires a mandatory reason. UX-DR12's
 * destructive-confirmation accessibility floor: the confirm button names
 * its specific target ("Deactivate Jane Doe", not "Confirm") -- same
 * pattern as GymLifecycleDialog (Story 1.6) and EXPERIENCE.md's
 * Destructive-Action-Confirmation row.
 */
export function DeactivateMemberDialog({
  member,
  onClose,
  onDone,
}: {
  member: MemberListRow;
  onClose: () => void;
  onDone: (warning?: string) => void;
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

    // Client-side guard: a blank reason blocks confirm before the request
    // is even sent. deactivateMemberSchema's own min-5 check is the
    // server-side backstop either way.
    const parsed = deactivateMemberSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await deactivateMember(member.id, parsed.data);
      if (actionError) {
        if (actionError.code === "audit_log_failed") {
          onDone(actionError.message);
          return;
        }
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
        <h2 className="text-lg font-semibold">
          {t("members.deactivateDialog.title", { name: member.name })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("members.deactivateDialog.body")}</p>

        <div className="space-y-2">
          <Label htmlFor="deactivateReason">{t("members.deactivateDialog.reason")}</Label>
          <textarea
            id="deactivateReason"
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
          {/* Matches deactivateMemberSchema's trim().min(5) exactly (code
              review fix) -- a mere non-empty check let the button enable for
              a reason that would still fail safeParse on submit. */}
          <Button type="submit" variant="destructive" disabled={submitting || reason.trim().length < 5}>
            {submitting
              ? t("members.deactivateDialog.deactivating")
              : t("members.deactivateDialog.confirmButton", { name: member.name })}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
