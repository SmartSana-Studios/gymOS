import { z } from "zod";

// Story 5.3: Coach Portal -- Member Detail & Session Notes (FR-054).
const noteTextSchema = z
  .string()
  .trim()
  .min(1, "Enter a note before saving")
  .max(2000, "Note is too long (max 2000 characters)");

export const addSessionNoteSchema = z.object({
  memberId: z.uuid(),
  noteText: noteTextSchema,
});

export type AddSessionNoteInput = z.infer<typeof addSessionNoteSchema>;

export const editSessionNoteSchema = z.object({
  noteId: z.uuid(),
  noteText: noteTextSchema,
});

export type EditSessionNoteInput = z.infer<typeof editSessionNoteSchema>;
