"use client";

import { Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import type { PickerWorkoutPlan } from "@/services/coachPicker";
import { SectionHeader } from "./SectionHeader";

/** Story 29.4 (UX AD-32, picker mode of AD-15): the plan as authored: its name, the ordered exercises with sets, reps and note, and the line "Workout plan
 * written by [Name]" when the author is not the chosen coach. No [Edit], [+ New plan], drag handle, Move up/down, [Take ownership] banner, and no
 * completion or progress mark of any kind: this file takes no completion data and imports nothing that reads it (not the Coach's WorkoutPlanTabContent, which
 * also formats progress dates). */
export function PickerWorkoutPlanView({ plan, coachId }: { plan: PickerWorkoutPlan | null; coachId: string }) {
  const { t } = useTranslation();
  const writtenByAnother = plan !== null && plan.authorName !== null && plan.authorId !== coachId;

  return (
    <Card>
      <SectionHeader icon={Dumbbell} accent="violet" title={t("coachPortal.detail.workoutPlanTab.heading")} />
      <CardContent>
        {plan ? (
          <div className="space-y-3">
            <p className="font-medium">{plan.planName}</p>
            {writtenByAnother && (
              <p className="text-sm text-muted-foreground">{t("coach.picker.planAuthor", { name: plan.authorName })}</p>
            )}
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
