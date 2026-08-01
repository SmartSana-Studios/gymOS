"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { createMemberSchema, editMemberSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberListRow, MemberSubscriptionStatus } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import { createMember, editMember } from "../actions";

interface FieldErrors {
  name?: string;
  phone?: string;
  email?: string;
  dob?: string;
  planId?: string;
  joinDate?: string;
  expiryDate?: string;
}

const SUBSCRIPTION_STATUSES: MemberSubscriptionStatus[] = [
  "active",
  "expiring_soon",
  "grace_period",
  "expired",
];

const SUBSCRIPTION_STATUS_LABEL_KEY: Record<MemberSubscriptionStatus, string> = {
  active: "members.status.active",
  expiring_soon: "members.status.expiringSoon",
  grace_period: "members.status.gracePeriod",
  expired: "members.status.expired",
};

// createMemberSchema/editMemberSchema's own issue messages are hardcoded
// English literals (matches plan.ts/gym.ts/tier.ts's established,
// project-wide pattern) -- map every reachable field to its own translated
// fallback instead of ever displaying issue.message directly (matches
// PlanModal's own FIELD_ERROR_KEY discipline).
const FIELD_ERROR_KEY: Record<keyof FieldErrors, string> = {
  name: "members.modal.errors.nameInvalid",
  phone: "members.modal.errors.phoneInvalid",
  email: "members.modal.errors.emailInvalid",
  dob: "members.modal.errors.dobInvalid",
  planId: "members.modal.errors.planRequired",
  joinDate: "members.modal.errors.joinDateInvalid",
  expiryDate: "members.modal.errors.expiryDateInvalid",
};

// new Date().toISOString() always renders the UTC calendar date, not the
// viewer's local one -- for a UTC+1 viewer (this product's Cameroon market),
// that silently shows yesterday's date for the first hour after local
// midnight (code review fix; packages/types/src/schemas/member.ts's own
// comment already warns against mixing new Date()'s local/UTC clocks into
// date-only comparisons -- this reintroduced that exact bug class in the UI).
function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  dob: "",
  photoUrl: "",
  emergencyContact: "",
  planId: "",
  joinDate: todayLocalDateString(),
  subscriptionStatus: "active" as MemberSubscriptionStatus,
  expiryDate: "",
};

function formFromMember(member: MemberListRow | null) {
  if (!member) return emptyForm;
  return {
    name: member.name,
    phone: member.phone ?? "",
    email: member.email ?? "",
    dob: member.dob ?? "",
    photoUrl: member.photoUrl ?? "",
    emergencyContact: member.emergencyContact ?? "",
    planId: member.planId ?? "",
    joinDate: member.joinDate,
    subscriptionStatus: (member.status === "no_active_plan" ? "active" : member.status),
    expiryDate: member.expiryDate ?? "",
  };
}

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Create/Edit/View Member. One modal, three modes -- native <dialog>,
 * controlled string-based form state (matches PlanModal/TierModal's
 * established convention, not react-hook-form). `readOnly` is Scope Note
 * #8's "View" mode (AD-04's own tabbed detail page is deferred -- this
 * story's "View" action and row-click both open this same modal instead,
 * read-only for Receptionist, edit mode for Manager/Owner). Create mode
 * shows the full AD-05 form minus Assigned Coach (Scope Note #5, no backing
 * table yet) and Billing Interval as a real input (Scope Note #6, read-only
 * display instead). Edit mode shows identity fields only (Scope Note's
 * Edit-mode boundary) -- plan/join date/subscription status/expiry are
 * shown read-only in View mode but never rendered as editable inputs in
 * Edit mode. */
export function MemberModal({
  open,
  readOnly,
  editingMember,
  plans,
  onClose,
  onSaved,
}: {
  open: boolean;
  readOnly: boolean;
  editingMember: MemberListRow | null;
  plans: PlanRow[];
  onClose: () => void;
  onSaved: (warning?: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCreate = !editingMember;
  const isEdit = Boolean(editingMember) && !readOnly;

  // Adjusted during render (React's documented alternative to an
  // effect-only sync), matches PlanModal's own established pattern -- also
  // catches editingMember changing reference while the dialog stays open
  // (switching from one member's View to another's, e.g.).
  const [syncedWith, setSyncedWith] = useState<{ open: boolean; editingMember: MemberListRow | null }>({
    open: false,
    editingMember: null,
  });
  if (open && (!syncedWith.open || syncedWith.editingMember !== editingMember)) {
    setSyncedWith({ open, editingMember });
    setForm(formFromMember(editingMember));
    setFieldErrors({});
    setFormError(null);
  } else if (!open && syncedWith.open) {
    setSyncedWith({ open, editingMember });
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

  const selectedPlan = plans.find((p) => p.id === form.planId) ?? null;
  const isPayPerSession = selectedPlan?.planType === "pay_per_session";

  function resetAndClose() {
    onClose();
  }

  // Expiry Date is hidden + cleared when the selected plan's plan_type is
  // pay_per_session (mirrors PlanModal's own pay_per_session field-hiding
  // precedent from Story 2.2, applied here to the subscription's expiry
  // instead of the plan's own duration).
  function handlePlanChange(planId: string) {
    const plan = plans.find((p) => p.id === planId) ?? null;
    setForm({
      ...form,
      planId,
      expiryDate: plan?.planType === "pay_per_session" ? "" : form.expiryDate,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (isCreate) {
      const parsed = createMemberSchema.safeParse({
        name: form.name,
        phone: form.phone,
        email: form.email.trim() === "" ? null : form.email,
        dob: form.dob === "" ? null : form.dob,
        photoUrl: form.photoUrl.trim() === "" ? null : form.photoUrl,
        emergencyContact: form.emergencyContact.trim() === "" ? null : form.emergencyContact,
        planId: form.planId,
        joinDate: form.joinDate,
        subscriptionStatus: form.subscriptionStatus,
        expiryDate: isPayPerSession || form.expiryDate === "" ? null : form.expiryDate,
      });

      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as keyof FieldErrors;
          if (!errors[field] && FIELD_ERROR_KEY[field]) {
            errors[field] = t(FIELD_ERROR_KEY[field]);
          }
        }
        setFieldErrors(errors);
        return;
      }

      setSubmitting(true);
      try {
        const { error } = await createMember(parsed.data);
        if (error) {
          if (error.code === "audit_log_failed") {
            onSaved(error.message);
            return;
          }
          if (error.code === "member_already_active_at_gym") {
            setFieldErrors({ phone: error.message });
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
      return;
    }

    if (isEdit && editingMember) {
      const parsed = editMemberSchema.safeParse({
        name: form.name,
        email: form.email.trim() === "" ? null : form.email,
        dob: form.dob === "" ? null : form.dob,
        photoUrl: form.photoUrl.trim() === "" ? null : form.photoUrl,
        emergencyContact: form.emergencyContact.trim() === "" ? null : form.emergencyContact,
      });

      if (!parsed.success) {
        const errors: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as keyof FieldErrors;
          if (!errors[field] && FIELD_ERROR_KEY[field]) {
            errors[field] = t(FIELD_ERROR_KEY[field]);
          }
        }
        setFieldErrors(errors);
        return;
      }

      setSubmitting(true);
      try {
        const { error } = await editMember(editingMember.id, parsed.data);
        if (error) {
          if (error.code === "audit_log_failed") {
            onSaved(error.message);
            return;
          }
          setFormError(error.message);
          return;
        }
        onSaved();
      } catch {
        setFormError(t("common.somethingWentWrong"));
      } finally {
        setSubmitting(false);
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={resetAndClose}
      onCancel={(e) => {
        if (submitting) e.preventDefault();
      }}
      className="w-full max-w-[520px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isCreate
              ? t("members.modal.addTitle")
              : readOnly
                ? t("members.modal.viewTitle", { name: editingMember?.name ?? "" })
                : t("members.modal.editTitle", { name: editingMember?.name ?? "" })}
          </h2>
          <button
            type="button"
            aria-label={t("members.modal.close")}
            onClick={resetAndClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberName">{t("members.modal.name")}</Label>
          <Input
            id="memberName"
            value={form.name}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          {fieldErrors.name && <p className="text-sm text-red-600">{fieldErrors.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberPhone">{t("members.modal.phone")}</Label>
          <Input
            id="memberPhone"
            value={form.phone}
            disabled={readOnly || isEdit}
            placeholder="+237600000000"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          {fieldErrors.phone && <p className="text-sm text-red-600">{fieldErrors.phone}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberEmail">{t("members.modal.email")}</Label>
          <Input
            id="memberEmail"
            type="email"
            value={form.email}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          {fieldErrors.email && <p className="text-sm text-red-600">{fieldErrors.email}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberDob">{t("members.modal.dob")}</Label>
          <Input
            id="memberDob"
            type="date"
            value={form.dob}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, dob: e.target.value })}
          />
          {fieldErrors.dob && <p className="text-sm text-red-600">{fieldErrors.dob}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberPhotoUrl">{t("members.modal.photoUrl")}</Label>
          <Input
            id="memberPhotoUrl"
            value={form.photoUrl}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="memberEmergencyContact">{t("members.modal.emergencyContact")}</Label>
          <Input
            id="memberEmergencyContact"
            value={form.emergencyContact}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
          />
        </div>

        {(isCreate || readOnly) && (
          <>
            <div className="space-y-2">
              <Label htmlFor="memberPlan">{t("members.modal.plan")}</Label>
              {isCreate ? (
                <select
                  id="memberPlan"
                  value={form.planId}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">{t("members.modal.selectPlan")}</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input id="memberPlan" value={editingMember?.planName ?? "—"} disabled />
              )}
              {fieldErrors.planId && <p className="text-sm text-red-600">{fieldErrors.planId}</p>}
              {selectedPlan && (
                <p className="text-xs text-muted-foreground">
                  {t("members.modal.billingIntervalReadonly", {
                    interval:
                      selectedPlan.billingInterval === "annual"
                        ? t("plans.intervalAnnual")
                        : t("plans.intervalMonthly"),
                  })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberJoinDate">{t("members.modal.joinDate")}</Label>
              <Input
                id="memberJoinDate"
                type="date"
                value={form.joinDate}
                disabled={readOnly || !isCreate}
                onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
              />
              {fieldErrors.joinDate && <p className="text-sm text-red-600">{fieldErrors.joinDate}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="memberSubscriptionStatus">{t("members.modal.subscriptionStatus")}</Label>
              {isCreate ? (
                <select
                  id="memberSubscriptionStatus"
                  value={form.subscriptionStatus}
                  onChange={(e) =>
                    setForm({ ...form, subscriptionStatus: e.target.value as MemberSubscriptionStatus })
                  }
                  className={selectClassName}
                >
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(SUBSCRIPTION_STATUS_LABEL_KEY[s])}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="memberSubscriptionStatus"
                  value={
                    editingMember && editingMember.status !== "no_active_plan"
                      ? t(SUBSCRIPTION_STATUS_LABEL_KEY[editingMember.status])
                      : "—"
                  }
                  disabled
                />
              )}
            </div>

            {!isPayPerSession && (
              <div className="space-y-2">
                <Label htmlFor="memberExpiryDate">{t("members.modal.expiryDate")}</Label>
                <Input
                  id="memberExpiryDate"
                  type="date"
                  value={form.expiryDate}
                  disabled={readOnly || !isCreate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                />
                {fieldErrors.expiryDate && (
                  <p className="text-sm text-red-600">{fieldErrors.expiryDate}</p>
                )}
              </div>
            )}
          </>
        )}

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
            {readOnly ? t("common.close") : t("common.cancel")}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={submitting}>
              {submitting
                ? t("common.saving")
                : isCreate
                  ? t("members.addMemberButton")
                  : t("members.modal.saveChanges")}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
