"use client";

import { Info, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionNoteRow } from "@/services/coaches";
import type { PickerMemberRow, PickerWorkoutPlan } from "@/services/coachPicker";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";
import { PickerSessionNotes } from "./PickerSessionNotes";
import { PickerWorkoutPlanView } from "./PickerWorkoutPlanView";
import { SectionHeader } from "./SectionHeader";

export type PickerMemberTab = "session-notes" | "workout-plan";

const GOAL_LABEL_KEY: Record<string, string> = {
  lose_weight: "coachPortal.detail.goalOptions.loseWeight",
  build_muscle: "coachPortal.detail.goalOptions.buildMuscle",
  improve_fitness: "coachPortal.detail.goalOptions.improveFitness",
  general_wellness: "coachPortal.detail.goalOptions.generalWellness",
};

const EXPERIENCE_LABEL_KEY: Record<string, string> = {
  beginner: "coachPortal.detail.experienceOptions.beginner",
  intermediate: "coachPortal.detail.experienceOptions.intermediate",
  advanced: "coachPortal.detail.experienceOptions.advanced",
};

function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

/**
 * Story 29.4 (UX AD-32, picker mode of AD-15): a member currently assigned to the chosen coach, read-only, for an Owner, Supervisor or Manager. A fork of
 * CoachMemberDetailPageClient, not a mode of it, so that no write, no body or progress read and no completion mark can reach it:
 *   - header: avatar, name, status, plan, expiry, goal, experience and the phone in full (the profile the coach sees, and nothing about the body);
 *   - tabs: Session Notes and Workout Plan only. The Progress tab is absent from the DOM, not locked, blurred or empty;
 *   - the expired bar is worded for a viewer who is not the coach (coach.picker.expiredBar);
 *   - one persistent line under the tabs: body measurements, photos and progress notes are not shown here;
 *   - no count, chart, thumbnail, "last logged" date or "no data yet" for any body or progress item, so a viewer cannot infer whether a member logs data.
 * It imports no server action and no service: everything arrives as props from the page.
 */
export function CoachPickerMemberDetail({
  member,
  notes,
  plan,
  coachId,
  initialTab,
}: {
  member: PickerMemberRow;
  notes: SessionNoteRow[];
  plan: PickerWorkoutPlan | null;
  coachId: string;
  initialTab: PickerMemberTab;
}) {
  const { t, i18n } = useTranslation();
  const badge = member.status ? (STATUS_BADGE_CONFIG[member.status] ?? STATUS_BADGE_CONFIG.active) : null;
  const StatusIcon = badge?.icon;

  const labelled = (keys: Record<string, string>, value: string | null) =>
    value ? (Object.hasOwn(keys, value) ? t(keys[value]) : value) : t("coachPortal.detail.notSet");
  const goal = labelled(GOAL_LABEL_KEY, member.goal);
  const experience = labelled(EXPERIENCE_LABEL_KEY, member.experienceLevel);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-md border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {member.memberName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{member.memberName}</span>
            {badge && StatusIcon && (
              <Badge variant="outline" className={badge.className}>
                <StatusIcon size={12} className="mr-1" />
                {t(badge.labelKey)}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.planLabel")}</span>
            <p>{member.planName ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.expiresLabel")}</span>
            <p>{member.expiryDate ? formatLocalDate(member.expiryDate, i18n.language) : "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.phoneLabel")}</span>
            <p>{member.phone ?? t("coachPortal.detail.phoneNotSet")}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.goalLabel")}</span>
            <p>{goal}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.experienceLabel")}</span>
            <p>{experience}</p>
          </div>
        </div>

        {member.status === "expired" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("coach.picker.expiredBar")}</div>
        )}
      </div>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="session-notes">{t("coachPortal.detail.tabs.sessionNotes")}</TabsTrigger>
          <TabsTrigger value="workout-plan">{t("coachPortal.detail.tabs.workoutPlan")}</TabsTrigger>
        </TabsList>

        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {t("coach.picker.noBodyData")}
        </p>

        <TabsContent value="session-notes">
          <Card>
            <SectionHeader icon={MessageSquare} accent="rose" title={t("coachPortal.detail.notes.heading")} />
            <CardContent>
              <PickerSessionNotes notes={notes} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workout-plan">
          <PickerWorkoutPlanView plan={plan} coachId={coachId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
