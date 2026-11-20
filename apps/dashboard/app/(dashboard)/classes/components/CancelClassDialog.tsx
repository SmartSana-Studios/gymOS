"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { ClassRow } from "@/services/classes";
import { cancelClassAction } from "../actions";

/**
 * Story 29.2 (UX AD-18): the Cancel class dialog. Escape is disabled (the destructive-confirmation rule, as DeactivateStaffDialog), the buttons are
 * named by action ([Keep class] / [Cancel class], never the generic [Cancel]), and the body shows how many bookings the cancel will take with it
 * (the same count the server computes when it cancels). `onDone` receives the class name for the success toast; `onClose` is [Keep class] or
 * the end of a refused attempt the caller wants to refresh after (an already-cancelled class).
 */
export function CancelClassDialog({
  cls,
  onClose,
  onDone,
}: {
  cls: ClassRow;
  onClose: (opts?: { refresh?: boolean }) => void;
  onDone: (className: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const { error: actionError } = await cancelClassAction(cls.id);
      if (actionError) {
        setError({ code: actionError.code, message: actionError.message });
        return;
      }
      onDone(cls.name);
    } catch {
      setError({ code: "class_cancel_failed", message: t("classes.cancel.error") });
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyCancelled = error?.code === "class_already_cancelled";

  return (
    <dialog
      ref={dialogRef}
      onClose={() => onClose({ refresh: alreadyCancelled })}
      onCancel={(e) => e.preventDefault()}
      aria-labelledby="cancelClassTitle"
      className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <h2 id="cancelClassTitle" className="text-lg font-semibold">
          {t("classes.cancel.title", { name: cls.name })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {cls.upcomingBookingCount > 0
            ? t("classes.cancel.body", { count: cls.upcomingBookingCount })
            : t("classes.cancel.bodyNoBookings")}
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error.message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()} disabled={submitting}>
            {t("classes.cancel.keep")}
          </Button>
          {!alreadyCancelled && (
            <Button type="button" variant="destructive" onClick={() => void handleConfirm()} disabled={submitting}>
              {t("classes.cancel.action")}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
