"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createGymSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TierOption } from "@/services/gyms";
import { createGym } from "../actions";

interface FieldErrors {
  gymName?: string;
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  tierId?: string;
}

const initialForm = {
  gymName: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  tierId: "",
  status: "active" as const,
};

export function CreateGymModal({
  open,
  onClose,
  onCreated,
  tiers,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ownerPhone: string, smsSent: boolean) => void;
  tiers: TierOption[];
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Native <dialog> gives focus-trapping + Escape-to-close + backdrop for
  // free (UX-DR12's "focus-trapped modals"), no extra dependency needed.
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
    setForm(initialForm);
    setFieldErrors({});
    setFormError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, per UX-DR11
    setFieldErrors({});
    setFormError(null);

    const parsed = createGymSchema.safeParse(form);
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
      const { data, error } = await createGym(parsed.data);

      if (error) {
        if (error.code === "gym_name_taken") {
          setFieldErrors({ gymName: error.message });
        } else if (error.code === "owner_email_taken") {
          setFieldErrors({ ownerEmail: error.message });
        } else if (error.code === "owner_phone_taken") {
          setFieldErrors({ ownerPhone: error.message });
        } else {
          setFormError(error.message);
        }
        return;
      }

      if (data) {
        onCreated(data.ownerPhone, data.smsSent);
        setForm(initialForm);
        setFieldErrors({});
      }
    } catch {
      // createGym is contracted to always return { data, error } and never
      // throw for expected errors, but an unexpected exception (network
      // drop, etc.) must not leave the submit button stuck disabled forever
      // (code review finding).
      setFormError(t("common.somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        // Fired on Escape (before `close`), cancelable. Blocking it while a
        // request is in flight prevents the admin from dismissing the modal
        // mid-request and losing visibility into an operation that's
        // already creating real records (code review finding).
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("gyms.create.title")}</h2>
          <button
            type="button"
            aria-label={t("gyms.create.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gymName">{t("gyms.create.gymName")}</Label>
          <Input
            id="gymName"
            value={form.gymName}
            onChange={(e) => setForm({ ...form, gymName: e.target.value })}
          />
          {fieldErrors.gymName && (
            <p className="text-sm text-red-600">{fieldErrors.gymName}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerName">{t("gyms.create.ownerName")}</Label>
          <Input
            id="ownerName"
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
          />
          {fieldErrors.ownerName && (
            <p className="text-sm text-red-600">{fieldErrors.ownerName}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerPhone">{t("gyms.create.ownerPhone")}</Label>
          <Input
            id="ownerPhone"
            placeholder={t("gyms.create.ownerPhonePlaceholder")}
            value={form.ownerPhone}
            onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
          />
          {fieldErrors.ownerPhone && (
            <p className="text-sm text-red-600">{fieldErrors.ownerPhone}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerEmail">{t("gyms.create.ownerEmail")}</Label>
          <Input
            id="ownerEmail"
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          />
          {fieldErrors.ownerEmail && (
            <p className="text-sm text-red-600">{fieldErrors.ownerEmail}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tierId">{t("gyms.create.tier")}</Label>
          <select
            id="tierId"
            value={form.tierId}
            onChange={(e) => setForm({ ...form, tierId: e.target.value })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">{t("gyms.create.selectTier")}</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
          {fieldErrors.tierId && (
            <p className="text-sm text-red-600">{fieldErrors.tierId}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">{t("gyms.create.status")}</Label>
          <select
            id="status"
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as typeof form.status })
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="active">{t("gyms.create.statusActive")}</option>
            <option value="suspended">{t("gyms.create.statusSuspended")}</option>
            <option value="deactivated">{t("gyms.create.statusDeactivated")}</option>
          </select>
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("gyms.create.creating") : t("gyms.create.title")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
