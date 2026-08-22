"use client";

import { useTranslation } from "react-i18next";

import type { SessionNoteRow } from "@/services/coaches";

// MembersPageClient.tsx's/CoachPortalPageClient.tsx's exact local-date-
// parsing pattern -- per-file copy, this app's established convention.
function noteTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Extracted from `CoachMemberDetailPageClient.tsx` (Story 10.4) -- the
 * notes list itself, presentational only. Heading + "Add note" action live
 * in the parent's `SectionHeader` (icon/color-badge treatment matching
 * Settings' own section pattern), not here. */
export function SessionNotesSection({
  notes,
  onEditClick,
  emptyLabel,
}: {
  notes: SessionNoteRow[];
  onEditClick: (note: { id: string; noteText: string }) => void;
  emptyLabel: string;
}) {
  const { t, i18n } = useTranslation();

  return (
    <div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="space-y-1 rounded-md border p-3">
              <p className="whitespace-pre-wrap break-words text-sm">{note.noteText}</p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {note.coachName} · {noteTimestamp(note.createdAt, i18n.language)}
                  {note.editedAt &&
                    ` · ${t("coachPortal.detail.notes.edited", { timestamp: noteTimestamp(note.editedAt, i18n.language) })}`}
                </span>
                <button
                  type="button"
                  onClick={() => onEditClick({ id: note.id, noteText: note.noteText })}
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
  );
}
