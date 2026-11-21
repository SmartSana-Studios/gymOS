"use client";

import { useTranslation } from "react-i18next";

import type { SessionNoteRow } from "@/services/coaches";

function noteTimestamp(iso: string, locale: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale)} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Story 29.4 (UX AD-32, picker mode of AD-15): the chosen coach's own notes on the member, newest first, each with its author and time. Read-only by
 * construction: no add, edit or hover affordance exists in this file, and nothing here imports a write. The empty line is the Coach's own ("no notes
 * yet"): a missing note is not a body or progress item. */
export function PickerSessionNotes({ notes }: { notes: SessionNoteRow[] }) {
  const { t, i18n } = useTranslation();

  if (notes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("coachPortal.detail.notes.empty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {notes.map((note) => (
        <li key={note.id} className="space-y-1 rounded-md border p-3">
          <p className="whitespace-pre-wrap break-words text-sm">{note.noteText}</p>
          <p className="text-xs text-muted-foreground">
            {note.coachName} · {noteTimestamp(note.createdAt, i18n.language)}
            {note.editedAt &&
              ` · ${t("coachPortal.detail.notes.edited", { timestamp: noteTimestamp(note.editedAt, i18n.language) })}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
