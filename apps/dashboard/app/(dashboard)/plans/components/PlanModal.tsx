"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { planSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlanRow } from "@/services/plans";
import { createPlan, editPlan } from "../actions";
import { ACCESS_DESCRIPTION_KEY, PLAN_TYPE_LABEL_KEY } from "../planLabels";

type PlanType = PlanRow["planType"];
type BillingInterval = PlanRow["billingInterval"];

interface FieldErrors {
  name?: string;
  price?: string;
  durationDays?: string;
  billingInterval?: string;
  annualDiscountPercent?: string;
}

const PLAN_TYPES: PlanType[] = ["pay_per_session", "monthly", "coach_inclusive", "class_only"];

// planSchema's own issue messages are hardcoded English literals (matches
// tier.ts/gym.ts's established, project-wide pattern of un-translated Zod
// messages -- out of scope to fix per-schema-file here). The pre-Zod guards
// above catch the common cases with translated copy, but a value that slips
// past them (e.g. a discount > 100, a price overflowing MAX_INT4) still hits
// safeParse -- map every field to its own translated fallback instead of
// ever displaying issue.message directly (Review finding). `billingInterval`
// covers planSchema's third .refine() (pay_per_session must be monthly) --
// only reachable via a direct-SQL/service-role row bypassing app validation,
// but without this entry the failure was a completely silent no-op (Review
// Round 2 finding: fieldErrors.billingInterval was never rendered).
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "plans.modal.errors.nameRequired",
  price: "plans.modal.errors.priceInvalid",
  durationDays: "plans.modal.errors.durationInvalid",
  billingInterval: "plans.modal.errors.billingIntervalInvalid",
  annualDiscountPercent: "plans.modal.errors.discountInvalid",
};

const emptyForm = {
  name: "",
  planType: "monthly" as PlanType,
  price: "",
  durationDays: "",
  billingInterval: "monthly" as BillingInterval,
  annualDiscountPercent: "",
};

function formFromPlan(plan: PlanRow | null) {
  if (!plan) return emptyForm;
  return {
    name: plan.name,
    planType: plan.planType,
    price: String(plan.price),
    durationDays: plan.durationDays === null ? "" : String(plan.durationDays),
    billingInterval: plan.billingInterval,
    annualDiscountPercent:
      plan.annualDiscountPercent === null ? "" : String(plan.annualDiscountPercent),
  };
}

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Membership Plan Create/Edit. One modal, `mode` picks the Server Action --
 * same native <dialog> pattern as TierModal (Story 1.6)/CreateGymModal
 * (Story 1.5), no new Dialog primitive dependency. */
export function PlanModal({
  open,
  onClose,
  onSaved,
  editingPlan,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (warning?: string) => void;
  editingPlan: PlanRow | null;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Tracks the (open, editingPlan) combo the form was last synced against.
  // Adjusted during render (React's documented alternative to an
  // effect-only sync -- avoids a cascading-render effect body that's pure
  // setState calls) rather than in the effect below, so it also catches
  // editingPlan changing reference while the dialog is already open (Review
  // finding: the prior single-effect version keyed only on `open` never
  // resynced in that case -- e.g. a stale invalid billingInterval/planType
  // combo from a prior selection could survive into the newly-loaded plan's
  // form).
  const [syncedWith, setSyncedWith] = useState<{ open: boolean; editingPlan: PlanRow | null }>({
    open: false,
    editingPlan: null,
  });
  if (open && (!syncedWith.open || syncedWith.editingPlan !== editingPlan)) {
    setSyncedWith({ open, editingPlan });
    setForm(formFromPlan(editingPlan));
    setFieldErrors({});
    setFormError(null);
  } else if (!open && syncedWith.open) {
    setSyncedWith({ open, editingPlan });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const isPerVisit = form.planType === "pay_per_session";
  const isAnnual = form.billingInterval === "annual";

  function resetAndClose() {
    onClose();
  }

  function handlePlanTypeChange(planType: PlanType) {
    // A per-visit plan has no fixed duration and no billing cycle -- force
    // billingInterval back to monthly and clear duration/discount so a
    // stale value from a prior selection can't sneak through submit.
    setForm({
      ...form,
      planType,
      billingInterval: planType === "pay_per_session" ? "monthly" : form.billingInterval,
      durationDays: planType === "pay_per_session" ? "" : form.durationDays,
      annualDiscountPercent:
        planType === "pay_per_session" ? "" : form.annualDiscountPercent,
    });
  }

  function handleBillingIntervalChange(billingInterval: BillingInterval) {
    setForm({
      ...form,
      billingInterval,
      annualDiscountPercent: billingInterval === "annual" ? form.annualDiscountPercent : "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // validate on submit only, UX-DR11
    setFieldErrors({});
    setFormError(null);

    // Number("") is 0, which would otherwise sail through
    // z.number().nonnegative() and silently create a free plan -- required
    // fields must fail validation when left blank, not coerce to 0.
    // Number.isFinite (not just !Number.isNaN) also catches "Infinity"/
    // "-Infinity". Matches TierModal's own pre-Zod numeric-string guards.
    const preErrors: FieldErrors = {};

    if (form.name.trim() === "") {
      preErrors.name = t("plans.modal.errors.nameRequired");
    }

    const priceRaw = form.price.trim();
    const priceNum = Number(priceRaw);
    if (priceRaw === "") {
      preErrors.price = t("plans.modal.errors.priceRequired");
    } else if (!Number.isFinite(priceNum)) {
      preErrors.price = t("plans.modal.errors.priceInvalid");
    }

    const durationRaw = form.durationDays.trim();
    const durationNum = durationRaw === "" ? null : Number(durationRaw);
    if (!isPerVisit) {
      if (durationRaw === "") {
        preErrors.durationDays = t("plans.modal.errors.durationRequired");
      } else if (!Number.isFinite(durationNum)) {
        preErrors.durationDays = t("plans.modal.errors.durationInvalid");
      }
    }

    const discountRaw = form.annualDiscountPercent.trim();
    const discountNum = discountRaw === "" ? null : Number(discountRaw);
    if (isAnnual) {
      if (discountRaw === "") {
        preErrors.annualDiscountPercent = t("plans.modal.errors.discountRequired");
      } else if (!Number.isFinite(discountNum)) {
        preErrors.annualDiscountPercent = t("plans.modal.errors.discountInvalid");
      }
    }

    if (Object.keys(preErrors).length > 0) {
      setFieldErrors(preErrors);
      return;
    }

    const parsed = planSchema.safeParse({
      name: form.name,
      planType: form.planType,
      price: priceNum,
      durationDays: isPerVisit ? null : durationNum,
      billingInterval: form.billingInterval,
      annualDiscountPercent: isAnnual ? discountNum : null,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (!errors[field]) errors[field] = t(FIELD_ERROR_KEY[field] ?? "common.invalidInput");
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = editingPlan
        ? await editPlan(editingPlan.id, parsed.data)
        : await createPlan(parsed.data);

      if (error) {
        // The plan was actually saved -- only the audit entry failed to
        // write -- so this isn't a blocking error like the others below;
        // still close and refresh, just pass the warning along.
        if (error.code === "audit_log_failed") {
          onSaved(error.message);
          return;
        }
        if (error.code === "plan_name_taken") {
          setFieldErrors({ name: error.message });
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
      className="w-full max-w-[480px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {editingPlan
              ? t("plans.modal.editTitle", { name: editingPlan.name })
              : t("plans.modal.addTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("plans.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="planName">{t("plans.modal.name")}</Label>
          <Input
            id="planName"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="planType">{t("plans.modal.planType")}</Label>
          <select
            id="planType"
            value={form.planType}
            onChange={(e) => handlePlanTypeChange(e.target.value as PlanType)}
            className={selectClassName}
          >
            {PLAN_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(PLAN_TYPE_LABEL_KEY[type])}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t(ACCESS_DESCRIPTION_KEY[form.planType])}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="planPrice">{t("plans.modal.price")}</Label>
          <Input
            id="planPrice"
            type="number"
            min={0}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
          {fieldErrors.price && <p className="text-sm text-red-600">{fieldErrors.price}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="planDuration">{t("plans.modal.durationDays")}</Label>
          <Input
            id="planDuration"
            type="number"
            min={1}
            value={isPerVisit ? "" : form.durationDays}
            disabled={isPerVisit}
            onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
          />
          {isPerVisit ? (
            <p className="text-xs text-muted-foreground">{t("plans.durationPerVisit")}</p>
          ) : (
            fieldErrors.durationDays && (
              <p className="text-sm text-red-600">{fieldErrors.durationDays}</p>
            )
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="billingInterval">{t("plans.modal.billingInterval")}</Label>
          <select
            id="billingInterval"
            value={form.billingInterval}
            disabled={isPerVisit}
            onChange={(e) => handleBillingIntervalChange(e.target.value as BillingInterval)}
            className={selectClassName}
          >
            <option value="monthly">{t("plans.intervalMonthly")}</option>
            <option value="annual">{t("plans.intervalAnnual")}</option>
          </select>
          {fieldErrors.billingInterval && (
            <p className="text-sm text-red-600">{fieldErrors.billingInterval}</p>
          )}
        </div>

        {isAnnual && (
          <div className="space-y-2">
            <Label htmlFor="annualDiscountPercent">{t("plans.modal.annualDiscountPercent")}</Label>
            <Input
              id="annualDiscountPercent"
              type="number"
              min={0}
              max={100}
              value={form.annualDiscountPercent}
              onChange={(e) => setForm({ ...form, annualDiscountPercent: e.target.value })}
            />
            {fieldErrors.annualDiscountPercent && (
              <p className="text-sm text-red-600">{fieldErrors.annualDiscountPercent}</p>
            )}
          </div>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting
              ? t("common.saving")
              : editingPlan
                ? t("plans.modal.saveChanges")
                : t("plans.addPlanButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
