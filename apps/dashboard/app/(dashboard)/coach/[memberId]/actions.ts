"use server";

import { addSessionNoteSchema, editSessionNoteSchema, type AppError } from "@gymos/types";
import { addSessionNote, editSessionNote } from "@/services/coaches";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

// Story 5.3: Coach Portal -- Member Detail & Session Notes. Same thin
// Zod-validated Server Action shape as subscriptions/actions.ts's
// confirmRenewalAction.

export async function addSessionNoteAction(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = addSessionNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return addSessionNote(parsed.data.memberId, parsed.data.noteText);
}

export async function editSessionNoteAction(
  input: unknown,
): Promise<{ data: null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = editSessionNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return editSessionNote(parsed.data.noteId, parsed.data.noteText);
}
