"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CoachPortalMemberDetail, SessionNoteRow } from "@/services/coaches";
import { PLAN_TYPE_LABEL_KEY } from "@/app/(dashboard)/plans/planLabels";
import { STATUS_BADGE_CONFIG } from "@/app/(dashboard)/subscriptions/subscriptionLabels";
import { SessionNoteModal } from "./SessionNoteModal";

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

export function CoachMemberDetailPageClient({
  member,
  notes,
}: {
  member: CoachPortalMemberDetail;
  notes: SessionNoteRow[];
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [modalState, setModalState] = useState<ModalState>(null);

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

  function noteTimestamp(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString(i18n.language)} ${d.toLocaleTimeString(i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function handleSaved() {
    setModalState(null);
    router.refresh();
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
            <p>{member.phone ?? t("coachPortal.detail.phoneNotSet")}</p>
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("coachPortal.detail.notes.heading")}</h2>
          <Button type="button" size="sm" onClick={() => setModalState({ note: null })}>
            {t("coachPortal.detail.notes.addButton")}
          </Button>
        </div>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("coachPortal.detail.notes.empty")}</p>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="space-y-1 rounded-md border p-3">
                <p className="whitespace-pre-wrap break-words text-sm">{note.noteText}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {note.coachName} · {noteTimestamp(note.createdAt)}
                    {note.editedAt && ` · ${t("coachPortal.detail.notes.edited", { timestamp: noteTimestamp(note.editedAt) })}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalState({ note: { id: note.id, noteText: note.noteText } })}
                    className="text-primary hover:underline"
                  >
                    {t("coachPortal.detail.notes.edit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalState && (
        <SessionNoteModal
          memberId={member.memberId}
          note={modalState.note}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
