"use client";

import { Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { WorkoutPlanRow } from "@/services/workoutPlans";
import { formatChartDate } from "./ProgressTabContent";
import { SectionHeader } from "./SectionHeader";

/**
 * Story 13.2 -- current plan (name header, `[Edit]` button, ordered
 * exercise rows) or the empty state (`"No workout plan yet."` +
 * `[+ New plan]`, EXPERIENCE.md line 2104's explicit empty-states table
 * entry). No `[+ New plan]` button when a plan already exists --
 * `idx_workout_plans_member_unique` makes "one plan per member" a real DB
 * invariant, and the more-authoritative Empty States table scopes
 * `[+ New plan]` to the empty state only (see this story's own Dev Notes
 * scope/ambiguity note). The section heading itself stays the generic
 * "Workout Plan" label (matching every other tab's SectionHeader
 * convention -- "Session Notes", "Coach Notes" -- rather than the mockup's
 * literal `[Plan Name]` header row); the plan's own name renders as a
 * sub-heading in the card body instead.
 *
 * Story 13.4 -- adds a third render state on top of the plan/empty states
 * above, selected by `plan.viewerCanEdit`/`plan.handoffCoachName`:
 *   - `viewerCanEdit === true` (authoring coach): unchanged -- `[Edit]`.
 *   - `viewerCanEdit === false && handoffCoachName !== null` (reassigned
 *     coach, plan not yet owned): no `[Edit]`, a `[Take ownership]` button
 *     in its place, plus the mockup's verbatim handoff banner
 *     (EXPERIENCE.md line 1715) above the (still read-only) exercise list.
 *   - `viewerCanEdit === false && handoffCoachName === null` (Owner/Manager,
 *     or any other non-author non-reassigned-coach case): read-only, no
 *     button at all -- also closes the rough edge Story 13.4's new
 *     Owner/Manager read grant would otherwise introduce on its own (a live
 *     `[Edit]` button that fails when clicked, since `update_workout_plan()`
 *     rejects any non-coach caller outright).
 */
export function WorkoutPlanTabContent({
  plan,
  canCreatePlan,
  onCreateClick,
  onEditClick,
  onTakeOwnershipClick,
  takeOwnershipPending = false,
  takeOwnershipError = null,
}: {
  plan: WorkoutPlanRow | null;
  /** Story 13.4: only a coach may ever create a plan (`create_workout_plan()`
   * rejects any non-coach caller) -- gates the empty-state "+ New plan"
   * button so an Owner/Manager viewing a plan-less member (now reachable to
   * them via this story's own new read grant) doesn't see a button that
   * fails when clicked. */
  canCreatePlan: boolean;
  onCreateClick: () => void;
  onEditClick: () => void;
  onTakeOwnershipClick: () => void;
  /** Story 13.4: mirrors WorkoutPlanModal.tsx's own `submitting`/`formError`
   * convention -- disables the button mid-flight and surfaces a rejected
   * take_ownership_of_workout_plan() call instead of failing silently. */
  takeOwnershipPending?: boolean;
  takeOwnershipError?: string | null;
}) {
  const { t, i18n } = useTranslation();

  function renderAction() {
    if (!plan) {
      if (!canCreatePlan) return null;
      return (
        <Button type="button" size="sm" onClick={onCreateClick}>
          {t("coachPortal.detail.workoutPlanTab.addButton")}
        </Button>
      );
    }
    if (plan.viewerCanEdit) {
      return (
        <Button type="button" size="sm" variant="outline" onClick={onEditClick}>
          {t("coachPortal.detail.workoutPlanTab.editButton")}
        </Button>
      );
    }
    if (plan.handoffCoachName !== null) {
      return (
        <Button type="button" size="sm" variant="outline" onClick={onTakeOwnershipClick} disabled={takeOwnershipPending}>
          {takeOwnershipPending
            ? t("coachPortal.detail.workoutPlanTab.saving")
            : t("coachPortal.detail.workoutPlanTab.takeOwnershipButton")}
        </Button>
      );
    }
    return null;
  }

  return (
    <Card>
      <SectionHeader
        icon={Dumbbell}
        accent="violet"
        title={t("coachPortal.detail.workoutPlanTab.heading")}
        action={renderAction()}
      />
      <CardContent>
        {plan ? (
          <div className="space-y-3">
            {!plan.viewerCanEdit && plan.handoffCoachName !== null && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {t("coachPortal.detail.workoutPlanTab.handoffBanner", { coachName: plan.handoffCoachName })}
              </p>
            )}
            {takeOwnershipError && <p className="text-sm text-red-600">{takeOwnershipError}</p>}
            <p className="font-medium">{plan.name}</p>
            <ol className="space-y-3">
              {plan.exercises.map((exercise) => (
                <li key={exercise.id} className="text-sm">
                  <span className="font-medium">
                    {exercise.orderIndex}. {exercise.exerciseName}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {t("coachPortal.detail.workoutPlanTab.setsReps", { sets: exercise.sets, reps: exercise.reps })}
                  </span>
                  {exercise.note && (
                    <p className="pl-4 text-xs text-muted-foreground">
                      {t("coachPortal.detail.workoutPlanTab.noteLine", { note: exercise.note })}
                    </p>
                  )}
                  {exercise.completionCount > 0 && exercise.lastCompletedAt && (
                    <p className="pl-4 text-xs text-emerald-600">
                      {t("coachPortal.detail.workoutPlanTab.completedCount", {
                        count: exercise.completionCount,
                        date: formatChartDate(exercise.lastCompletedAt, i18n.language),
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("coachPortal.detail.workoutPlanTab.emptyState")}</p>
        )}
      </CardContent>
    </Card>
  );
}
