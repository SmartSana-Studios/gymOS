"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { assignInitialPlanSchema } from "@gymos/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberListRow } from "@/services/members";
import type { PlanRow } from "@/services/plans";
import { assignInitialPlan } from "../actions";

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// The viewer's local calendar date, not toISOString()'s UTC one (the same
// off-by-one-day trap MemberModal's todayLocalDateString documents).
function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Story 18.6: gives a settled member with no subscription their first plan
 * (manager, supervisor, owner; the subscriptions INSERT policy enforces the
 * role). Calls `assignInitialPlan` (Story 18.5): no payment is written, and an
 * awaiting member is refused by the database gate. Submit stays disabled while
 * the call is pending.
 */
export function AssignInitialPlanDialog({
  member,
  plans,
  onClose,
  onDone,
}: {
  member: MemberListRow;
  plans: PlanRow[];
  onClose: () => void;
  onDone: (warning?: string) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState(todayLocalDateString);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const parsed = assignInitialPlanSchema.safeParse({ memberId: member.id, planId, startDate });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === "planId"
          ? t("members.assignPlan.errors.planRequired")
          : field === "startDate"
            ? t("members.assignPlan.errors.startDateInvalid")
            : t("common.invalidInput"),
      );
      return;
    }

    setSubmitting(true);
    try {
      const { error: actionError } = await assignInitialPlan(
        parsed.data.memberId,
        parsed.data.planId,
        parsed.data.startDate,
      );
      if (actionError) {
        // The plan was assigned and only its audit write failed: close and warn.
        if (actionError.code === "audit_log_failed") {
          onDone(actionError.message);
          return;
        }
        setError(actionError.message || t("members.assignPlan.errors.assignFailed"));
        return;
      }
      onDone();
    } catch {
      setError(t("members.assignPlan.errors.assignFailed"));
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
        <h2 className="text-lg font-semibold">{t("members.assignPlan.title", { name: member.name })}</h2>
        <p className="text-sm text-muted-foreground">{t("members.assignPlan.body")}</p>

        <div className="space-y-2">
          <Label htmlFor="assignPlanPlan">{t("members.assignPlan.plan")}</Label>
          <select
            id="assignPlanPlan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            disabled={submitting}
            className={selectClassName}
          >
            <option value="">{t("members.assignPlan.planPlaceholder")}</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="assignPlanStartDate">{t("members.assignPlan.startDate")}</Label>
          <Input
            id="assignPlanStartDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submitting}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting || planId === "" || startDate === ""}>
            {submitting ? t("members.assignPlan.assigning") : t("members.assignPlan.confirmButton")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
