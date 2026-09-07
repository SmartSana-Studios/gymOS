"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createOrPromoteSuperAdminSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrPromoteSuperAdmin } from "../actions";

interface FieldErrors {
  email?: string;
  currentPassword?: string;
}

/**
 * Story 1.16 (AC #2, #3, #4, #5). Copies CreateGymModal.tsx's structure
 * (single-field modal, client-side Zod validation mirroring the server
 * schema).
 *
 * AC #5: the submit button names the target explicitly ("Add {email} as
 * Super Admin"), updating live as the email is typed -- UX-DR12's
 * destructive/sensitive-action confirmation convention
 * (RevokeAccessDialog.tsx/ChangeTierDialog.tsx precedent).
 *
 * Post-review addition (2026-09-07, requested during manual testing): a
 * step-up password field. The acting Super Admin must re-enter their OWN
 * password every time this modal is submitted -- proof-of-presence beyond
 * just holding a valid session cookie, verified server-side via
 * `signInWithPassword` (admins/actions.ts). This supersedes AC #5's original
 * "no separate preview/confirmation round-trip" framing; it's still a
 * single-step form (no second screen), just with one more required field.
 * Never persisted/remembered across opens -- cleared on every close.
 */
export function AddAdminModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (
    outcome: "created" | "promoted" | "already_super_admin",
    email: string,
    tempPassword: string | null,
  ) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function resetAndClose() {
    setEmail("");
    setCurrentPassword("");
    setFieldErrors({});
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, per UX-DR11
    setFieldErrors({});
    setFormError(null);

    const parsed = createOrPromoteSuperAdminSchema.safeParse({ email, currentPassword });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await createOrPromoteSuperAdmin(parsed.data);

      if (error) {
        if (error.code === "incorrect_password") {
          setFieldErrors({ currentPassword: error.message });
        } else {
          setFormError(error.message);
        }
        return;
      }

      if (data) {
        onDone(data.outcome, parsed.data.email, data.tempPassword);
        setEmail("");
        setCurrentPassword("");
        setFieldErrors({});
      }
    } catch {
      // createOrPromoteSuperAdmin is contracted to always return
      // { data, error } and never throw for expected errors, but an
      // unexpected exception (network drop, etc.) must not leave the submit
      // button stuck disabled forever (mirrors CreateGymModal's own guard).
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  const trimmedEmail = email.trim();

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        // Blocking Escape mid-request prevents dismissing the modal while
        // an operation that's already minting real privilege is in flight.
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("admins.create.title")}</h2>
          <button
            type="button"
            aria-label={t("admins.create.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("admins.create.email")}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {fieldErrors.email && <p className="text-sm text-red-600">{fieldErrors.email}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="currentPassword">{t("admins.create.currentPassword")}</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          {fieldErrors.currentPassword && (
            <p className="text-sm text-red-600">{fieldErrors.currentPassword}</p>
          )}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          {/* AC #5's named-target text has no length ceiling (it echoes
              whatever was typed) -- override the base Button's
              whitespace-nowrap so a long email wraps onto a second line
              instead of overflowing the dialog's edge. */}
          <Button
            type="submit"
            disabled={submitting || !trimmedEmail || !currentPassword}
            className="h-auto min-h-9 whitespace-normal text-center"
          >
            {submitting
              ? t("admins.create.submitting")
              : trimmedEmail
                ? t("admins.create.submit", { email: trimmedEmail })
                : t("admins.create.submitEmpty")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
