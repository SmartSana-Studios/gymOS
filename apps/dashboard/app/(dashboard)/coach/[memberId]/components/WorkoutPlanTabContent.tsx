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
 */
export function WorkoutPlanTabContent({
  plan,
  onCreateClick,
  onEditClick,
}: {
  plan: WorkoutPlanRow | null;
  onCreateClick: () => void;
  onEditClick: () => void;
}) {
  const { t, i18n } = useTranslation();

  return (
    <Card>
      <SectionHeader
        icon={Dumbbell}
        accent="violet"
        title={t("coachPortal.detail.workoutPlanTab.heading")}
        action={
          plan ? (
            <Button type="button" size="sm" variant="outline" onClick={onEditClick}>
              {t("coachPortal.detail.workoutPlanTab.editButton")}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onCreateClick}>
              {t("coachPortal.detail.workoutPlanTab.addButton")}
            </Button>
          )
        }
      />
      <CardContent>
        {plan ? (
          <div className="space-y-3">
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
