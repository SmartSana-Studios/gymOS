"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CoachPortalMemberDetail, MemberProgressData, SessionNoteRow } from "@/services/coaches";
import type { ExerciseLibraryRow } from "@/services/exercises";
import type { WorkoutPlanRow } from "@/services/workoutPlans";
import { takeOwnershipOfWorkoutPlanAction } from "../actions";
import { PLAN_TYPE_LABEL_KEY } from "@/app/(dashboard)/plans/planLabels";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";
import { ProgressTabContent } from "./ProgressTabContent";
import { SectionHeader } from "./SectionHeader";
import { SessionNoteModal } from "./SessionNoteModal";
import { SessionNotesSection } from "./SessionNotesSection";
import { WorkoutPlanModal } from "./WorkoutPlanModal";
import { WorkoutPlanTabContent } from "./WorkoutPlanTabContent";

// Keyed on memberGoalSchema/experienceLevelSchema's exact enum values
// (packages/types/src/schemas/memberOnboarding.ts) -- not imported from
// apps/mobile's locales (architecture.md: shared admin-surface locale
// strings only, mobile stays separate).
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

// MembersPageClient.tsx's/CoachPortalPageClient.tsx's exact local-date-
// parsing pattern -- per-file copy, this app's established convention.
function formatLocalDate(dateOnly: string, locale: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

// null = modal closed. { note: null } = add mode. { note: row } = edit mode.
type ModalState = { note: { id: string; noteText: string } | null } | null;

// Second, independent modal-state slot -- not folded into `ModalState`,
// which is session-notes-specific, mirroring this component's existing
// one-slot-per-modal-type pattern. `true` = open (plan prop resolved from
// the `plan` prop at render time, same create/edit dual-purpose shape as
// `WorkoutPlanModal` itself expects).
type WorkoutPlanModalState = boolean;

export function CoachMemberDetailPageClient({
  member,
  notes,
  progressData,
  plan,
  canCreatePlan,
  exerciseLibrary,
}: {
  member: CoachPortalMemberDetail;
  notes: SessionNoteRow[];
  progressData: MemberProgressData;
  plan: WorkoutPlanRow | null;
  canCreatePlan: boolean;
  exerciseLibrary: ExerciseLibraryRow[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [modalState, setModalState] = useState<ModalState>(null);
  const [workoutPlanModalOpen, setWorkoutPlanModalOpen] = useState<WorkoutPlanModalState>(false);
  const [takingOwnership, setTakingOwnership] = useState(false);
  const [takeOwnershipError, setTakeOwnershipError] = useState<string | null>(null);

  const badge = STATUS_BADGE_CONFIG[member.status] ?? STATUS_BADGE_CONFIG.active;
  const StatusIcon = badge.icon;

  function planTypeLabel(): string {
    const key = PLAN_TYPE_LABEL_KEY[member.planType as keyof typeof PLAN_TYPE_LABEL_KEY];
    return key ? t(key) : member.planType;
  }

  function goalLabel(): string {
    if (!member.goal) return t("coachPortal.detail.notSet");
    const key = GOAL_LABEL_KEY[member.goal];
    return key ? t(key) : member.goal;
  }

  function experienceLabel(): string {
    if (!member.experienceLevel) return t("coachPortal.detail.notSet");
    const key = EXPERIENCE_LABEL_KEY[member.experienceLevel];
    return key ? t(key) : member.experienceLevel;
  }

  function expiryLabel(): string {
    if (!member.expiryDate) return "—";
    return formatLocalDate(member.expiryDate, i18n.language);
  }

  function handleSaved() {
    setModalState(null);
    router.refresh();
  }

  function handleWorkoutPlanSaved() {
    setWorkoutPlanModalOpen(false);
    router.refresh();
  }

  async function handleTakeOwnership() {
    if (!plan || takingOwnership) return;
    setTakingOwnership(true);
    setTakeOwnershipError(null);
    try {
      const { error } = await takeOwnershipOfWorkoutPlanAction({ planId: plan.id });
      if (error) {
        setTakeOwnershipError(error.message);
        return;
      }
      router.refresh();
    } finally {
      setTakingOwnership(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
            {member.memberName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{member.memberName}</span>
            <Badge variant="outline" className={badge.className}>
              <StatusIcon size={12} className="mr-1" />
              {t(badge.labelKey)}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.planLabel")}</span>
            <p>{planTypeLabel()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.expiresLabel")}</span>
            <p>{expiryLabel()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.phoneLabel")}</span>
            <p>{member.phoneMasked ?? t("coachPortal.detail.phoneNotSet")}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.goalLabel")}</span>
            <p>{goalLabel()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("coachPortal.detail.experienceLabel")}</span>
            <p>{experienceLabel()}</p>
          </div>
        </div>

        {member.status === "expired" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {t("coachPortal.detail.expiredInfoBar")}
          </div>
        )}
      </div>

      <Tabs defaultValue="session-notes">
        <TabsList>
          <TabsTrigger value="session-notes">{t("coachPortal.detail.tabs.sessionNotes")}</TabsTrigger>
          <TabsTrigger value="progress">{t("coachPortal.detail.tabs.progress")}</TabsTrigger>
          <TabsTrigger value="workout-plan">{t("coachPortal.detail.tabs.workoutPlan")}</TabsTrigger>
        </TabsList>

        <TabsContent value="session-notes">
          <Card>
            <SectionHeader
              icon={MessageSquare}
              accent="rose"
              title={t("coachPortal.detail.notes.heading")}
              action={
                <Button type="button" size="sm" onClick={() => setModalState({ note: null })}>
                  {t("coachPortal.detail.notes.addButton")}
                </Button>
              }
            />
            <CardContent>
              <SessionNotesSection
                notes={notes}
                onEditClick={(note) => setModalState({ note })}
                emptyLabel={t("coachPortal.detail.notes.empty")}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="progress" className="space-y-6">
          <ProgressTabContent progressData={progressData} startingWeightKg={member.startingWeightKg} />
          <Card>
            <SectionHeader
              icon={MessageSquare}
              accent="rose"
              title={t("coachPortal.detail.progressTab.notesHeading")}
              action={
                <Button type="button" size="sm" onClick={() => setModalState({ note: null })}>
                  {t("coachPortal.detail.notes.addButton")}
                </Button>
              }
            />
            <CardContent>
              <SessionNotesSection
                notes={notes}
                onEditClick={(note) => setModalState({ note })}
                emptyLabel={t("coachPortal.detail.progressTab.notesEmpty")}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="workout-plan">
          <WorkoutPlanTabContent
            plan={plan}
            canCreatePlan={canCreatePlan}
            onCreateClick={() => setWorkoutPlanModalOpen(true)}
            onEditClick={() => setWorkoutPlanModalOpen(true)}
            onTakeOwnershipClick={handleTakeOwnership}
            takeOwnershipPending={takingOwnership}
            takeOwnershipError={takeOwnershipError}
          />
        </TabsContent>
      </Tabs>

      {modalState && (
        <SessionNoteModal
          memberId={member.memberId}
          note={modalState.note}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}

      {workoutPlanModalOpen && (
        <WorkoutPlanModal
          memberId={member.memberId}
          plan={plan}
          exerciseLibrary={exerciseLibrary}
          onClose={() => {
            setWorkoutPlanModalOpen(false);
            // A closed-after-failure case (e.g. a two-tab create_workout_plan()
            // race) can leave the `plan` prop stale -- refresh so reopening
            // reflects the real current state instead of repeating the
            // same failure.
            router.refresh();
          }}
          onSaved={handleWorkoutPlanSaved}
        />
      )}
    </div>
  );
}
