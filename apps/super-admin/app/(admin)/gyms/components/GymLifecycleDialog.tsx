"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gymStatusChangeSchema, type AppError } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { GymListRow } from "@/services/gyms";

// Full-phrase keys per action/state, not word-by-word concatenation --
// composing a translated verb + translated noun at render time produces
// broken grammar in French (conjugation/gender don't compose the way
// English string concatenation does).
const ACTION_COPY_KEYS = {
  suspend: { titleKey: "gyms.lifecycle.suspendTitle", progressKey: "gyms.lifecycle.suspending" },
  deactivate: {
    titleKey: "gyms.lifecycle.deactivateTitle",
    progressKey: "gyms.lifecycle.deactivating",
  },
  reinstate: {
    titleKey: "gyms.lifecycle.reinstateTitle",
    progressKey: "gyms.lifecycle.reinstating",
  },
} as const;

/**
 * AC #3: suspend/deactivate/reinstate all require a reason. UX-DR12:
 * destructive-confirmation buttons name their specific target ("Suspend
 * FitZone Yaoundé", not "Confirm"). Same native <dialog> pattern as
 * CreateGymModal (Story 1.5).
 */
export function GymLifecycleDialog({
  gym,
  action,
  onClose,
  onDone,
  runAction,
}: {
  // Review fix: narrowed from the full GymListRow to just the fields this
  // component actually reads (gym.id/gym.name) -- lets any caller with a
  // GymListRow-shaped superset (e.g. BillingPageClient's GymBillingRow) pass
  // its row through directly, with the compiler still catching a real
  // structural mismatch, instead of an `as unknown as GymListRow` cast that
  // suppressed all type-checking at the call site.
  gym: Pick<GymListRow, "id" | "name" | "status">;
  action: "suspend" | "deactivate" | "reinstate";
  onClose: () => void;
  onDone: (warning?: string) => void;
  runAction: (gymId: string, input: unknown) => Promise<{ error: AppError | null }>;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const copy = ACTION_COPY_KEYS[action];
  const title = t(copy.titleKey, { name: gym.name });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = gymStatusChangeSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("common.invalidInput"));
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await runAction(gym.id, parsed.data);
      if (actionError) {
        // "no_op" (already in the target state) and "audit_log_failed" (the
        // change saved, only the audit entry failed to write) both mean the
        // gym's real state already matches what this dialog is asking for --
        // treat them as done rather than a blocking error, so the list
        // doesn't stay stuck showing stale data.
        if (actionError.code === "no_op") {
          onDone();
          return;
        }
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
      className="w-full max-w-[420px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{title}</h2>

        <div className="space-y-2">
          <Label htmlFor="reason">{t("gyms.lifecycle.reason")}</Label>
          <textarea
            id="reason"
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
          <Button type="submit" variant="destructive" disabled={submitting}>
            {submitting ? t(copy.progressKey) : title}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
