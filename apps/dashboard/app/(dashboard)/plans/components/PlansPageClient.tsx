"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { PlanRow } from "@/services/plans";
import { PlanModal } from "./PlanModal";
import { deletePlan } from "../actions";
import { PLAN_TYPE_LABEL_KEY } from "../planLabels";

export function PlansPageClient({ initialPlans }: { initialPlans: PlanRow[] }) {
  const { t, i18n } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  function openCreate() {
    setEditingPlan(null);
    setModalOpen(true);
  }

  function openEdit(plan: PlanRow) {
    setEditingPlan(plan);
    setModalOpen(true);
  }

  function openDeleteConfirm(plan: PlanRow) {
    setConfirmPlan(plan);
    setDeleteError(null);
    dialogRef.current?.showModal();
  }

  function closeDeleteConfirm() {
    dialogRef.current?.close();
    setConfirmPlan(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!confirmPlan) return;
    setDeleting(true);
    try {
      const { error } = await deletePlan(confirmPlan.id);
      if (error) {
        // The plan was actually deleted -- only the audit entry failed to
        // write -- so this isn't a blocking error like a real deletion
        // failure; still close and refresh, just surface the warning.
        if (error.code === "audit_log_failed") {
          dialogRef.current?.close();
          setConfirmPlan(null);
          showToast(error.message);
          router.refresh();
          return;
        }
        setDeleteError(error.message);
        return;
      }
      dialogRef.current?.close();
      setConfirmPlan(null);
      router.refresh();
    } catch {
      // A thrown/rejected Server Action call (e.g. a network failure) was
      // previously unhandled here, leaving the confirm dialog stuck with no
      // user-facing message (Review finding).
      setDeleteError(t("common.somethingWentWrong"));
    } finally {
      setDeleting(false);
    }
  }

  // AC #2: the annual discount is "reflected," not just stored -- previously
  // annualDiscountPercent was captured and persisted but never surfaced
  // anywhere in the UI (Review finding). Appends the discount alongside the
  // stored annual price rather than inventing an unspecified computed
  // "effective monthly rate" -- the schema has no separate monthly-price
  // field to derive one from (see this story's own Scope Note on `price`
  // being the single stored amount for whichever billing interval is set).
  function priceLabel(plan: PlanRow): string {
    const intervalLabel =
      plan.billingInterval === "annual" ? t("plans.intervalAnnual") : t("plans.intervalMonthly");
    const base = t("plans.priceLabel", {
      price: plan.price.toLocaleString(i18n.language),
      interval: intervalLabel,
    });
    if (plan.billingInterval === "annual" && plan.annualDiscountPercent !== null) {
      return `${base} ${t("plans.discountSuffix", { percent: plan.annualDiscountPercent })}`;
    }
    return base;
  }

  function durationLabel(plan: PlanRow): string {
    return plan.durationDays === null
      ? t("plans.durationPerVisit")
      : t("plans.durationDaysLabel", { days: plan.durationDays });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("plans.title")}</h1>
        <Button onClick={openCreate}>{t("plans.addPlan")}</Button>
      </div>

      {initialPlans.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("plans.emptyNoPlans")}</p>
          <Button onClick={openCreate}>{t("plans.addPlanButton")}</Button>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {initialPlans.map((plan) => (
            <div key={plan.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {plan.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    {t(PLAN_TYPE_LABEL_KEY[plan.planType])}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {priceLabel(plan)} · {durationLabel(plan)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                  {t("plans.edit")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openDeleteConfirm(plan)}>
                  {t("plans.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PlanModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(warning) => {
          setModalOpen(false);
          if (warning) showToast(warning);
          router.refresh();
        }}
        editingPlan={editingPlan}
      />

      <dialog
        ref={dialogRef}
        onClose={closeDeleteConfirm}
        onCancel={(e) => {
          if (deleting) e.preventDefault();
        }}
        className="w-full max-w-[420px] rounded-md border bg-background p-0 text-foreground backdrop:bg-black/50"
      >
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">
            {t("plans.deleteConfirmTitle", { name: confirmPlan?.name ?? "" })}
          </h2>
          <p className="text-sm text-muted-foreground">{t("plans.deleteConfirmBody")}</p>
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeDeleteConfirm} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting
                ? t("plans.deleting")
                : t("plans.deleteButton", { name: confirmPlan?.name ?? "" })}
            </Button>
          </div>
        </div>
      </dialog>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
