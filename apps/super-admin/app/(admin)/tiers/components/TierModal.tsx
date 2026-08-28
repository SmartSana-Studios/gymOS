"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { tierSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TierRow } from "@/services/tiers";
import { createTier, editTier } from "../actions";

interface FieldErrors {
  name?: string;
  memberCap?: string;
  monthlyPrice?: string;
  annualPrice?: string;
}

const emptyForm = { name: "", memberCap: "", monthlyPrice: "", annualPrice: "" };

function formFromTier(tier: TierRow | null) {
  if (!tier) return emptyForm;
  return {
    name: tier.name,
    memberCap: tier.memberCap === null ? "" : String(tier.memberCap),
    monthlyPrice: String(tier.monthlyPrice),
    annualPrice: String(tier.annualPrice),
  };
}

/** SA-06 Tier Create/Edit. One modal, `mode` picks the Server Action --
 * same native <dialog> pattern as CreateGymModal (Story 1.5), no new
 * Dialog primitive dependency. */
export function TierModal({
  open,
  onClose,
  onSaved,
  editingTier,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (warning?: string) => void;
  editingTier: TierRow | null;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setForm(formFromTier(editingTier));
      setFieldErrors({});
      setFormError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function resetAndClose() {
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, UX-DR11
    setFieldErrors({});
    setFormError(null);

    // Number("") is 0, which would otherwise sail through
    // z.number().nonnegative() and silently create a free tier -- required
    // fields must fail validation when left blank, not coerce to 0.
    // Non-numeric garbage (Number("abc") === NaN) gets the same treatment
    // rather than falling through to Zod's generic invalid-type message.
    // Number.isFinite (not just !Number.isNaN) also catches "Infinity"/
    // "-Infinity", which Number() parses successfully but Number.isNaN
    // doesn't flag.
    const preErrors: FieldErrors = {};
    const memberCapRaw = form.memberCap.trim();
    const memberCapNum = memberCapRaw === "" ? null : Number(memberCapRaw);
    if (memberCapRaw !== "" && !Number.isFinite(memberCapNum)) {
      preErrors.memberCap = t("tiers.modal.errors.memberCapPositive");
    }

    // priceLocked (Free/Test tier): the DB CHECK constraint is the real
    // enforcement (packages/types/src/errors.ts's tier_price_locked
    // mapping) -- these inputs are rendered disabled/read-only below, so
    // form.monthlyPrice/annualPrice are always "0" here, not user-editable.
    const monthlyPriceRaw = editingTier?.priceLocked ? "0" : form.monthlyPrice.trim();
    const monthlyPriceNum = Number(monthlyPriceRaw);
    if (monthlyPriceRaw === "") {
      preErrors.monthlyPrice = t("tiers.modal.errors.monthlyPriceRequired");
    } else if (!Number.isFinite(monthlyPriceNum)) {
      preErrors.monthlyPrice = t("tiers.modal.errors.monthlyPriceInvalid");
    }

    const annualPriceRaw = editingTier?.priceLocked ? "0" : form.annualPrice.trim();
    const annualPriceNum = Number(annualPriceRaw);
    if (annualPriceRaw === "") {
      preErrors.annualPrice = t("tiers.modal.errors.annualPriceRequired");
    } else if (!Number.isFinite(annualPriceNum)) {
      preErrors.annualPrice = t("tiers.modal.errors.annualPriceInvalid");
    }

    if (Object.keys(preErrors).length > 0) {
      setFieldErrors(preErrors);
      return;
    }

    const parsed = tierSchema.safeParse({
      name: form.name,
      memberCap: memberCapNum,
      monthlyPrice: monthlyPriceNum,
      annualPrice: annualPriceNum,
    });

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
      const { error } = editingTier
        ? await editTier(editingTier.id, parsed.data)
        : await createTier(parsed.data);

      if (error) {
        // The tier was actually saved -- only the audit entry failed to
        // write -- so this isn't a blocking error like the others below;
        // still close and refresh, just pass the warning along.
        if (error.code === "audit_log_failed") {
          onSaved(error.message);
          return;
        }
        if (error.code === "tier_name_taken") {
          setFieldErrors({ name: error.message });
        } else if (error.code === "tier_cap_order_invalid") {
          setFieldErrors({ memberCap: error.message });
        } else {
          setFormError(error.message);
        }
        return;
      }

      onSaved();
    } catch {
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
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[480px] rounded-md border p-0 backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {editingTier
              ? t("tiers.modal.editTitle", { name: editingTier.name })
              : t("tiers.modal.addTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("tiers.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tierName">{t("tiers.modal.tierName")}</Label>
          <Input
            id="tierName"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberCap">{t("tiers.modal.memberCap")}</Label>
          <Input
            id="memberCap"
            type="number"
            min={1}
            value={form.memberCap}
            onChange={(e) => setForm({ ...form, memberCap: e.target.value })}
          />
          {fieldErrors.memberCap && (
            <p className="text-sm text-red-600">{fieldErrors.memberCap}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="monthlyPrice">{t("tiers.modal.monthlyPrice")}</Label>
          <Input
            id="monthlyPrice"
            type="number"
            min={0}
            disabled={editingTier?.priceLocked}
            value={editingTier?.priceLocked ? 0 : form.monthlyPrice}
            onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
          />
          {fieldErrors.monthlyPrice && (
            <p className="text-sm text-red-600">{fieldErrors.monthlyPrice}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="annualPrice">{t("tiers.modal.annualPrice")}</Label>
          <Input
            id="annualPrice"
            type="number"
            min={0}
            disabled={editingTier?.priceLocked}
            value={editingTier?.priceLocked ? 0 : form.annualPrice}
            onChange={(e) => setForm({ ...form, annualPrice: e.target.value })}
          />
          {fieldErrors.annualPrice && (
            <p className="text-sm text-red-600">{fieldErrors.annualPrice}</p>
          )}
        </div>

        {editingTier?.priceLocked && (
          <p className="text-muted-foreground text-sm">{t("tiers.modal.priceLocked")}</p>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting
              ? t("common.saving")
              : editingTier
                ? t("tiers.modal.saveChanges")
                : t("tiers.addTierButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
