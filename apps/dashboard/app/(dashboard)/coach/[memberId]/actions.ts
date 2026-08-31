"use server";

import {
  addSessionNoteSchema,
  editSessionNoteSchema,
  exerciseNameSchema,
  workoutPlanSchema,
  type AppError,
} from "@gymos/types";
import { addSessionNote, editSessionNote } from "@/services/coaches";
import { addCustomExercise, type ExerciseLibraryRow } from "@/services/exercises";
import { createWorkoutPlan, updateWorkoutPlan } from "@/services/workoutPlans";
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

// Story 13.2: Coach-Authored Workout Plans. Same thin Zod-validated Server
// Action shape as the two above. `memberId`/`planId` are plain-string
// pre-checks (this app has no direct `zod` dependency outside `@gymos/types`'
// own re-exports, so a new combined schema isn't added here) -- `input`'s
// remaining `name`/`exercises` fields still go through `workoutPlanSchema`
// itself, which strips the extra identifier field like every other Zod
// object schema.

export async function createWorkoutPlanAction(
  input: unknown,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const memberId = (input as { memberId?: unknown } | null)?.memberId;
  if (typeof memberId !== "string" || memberId.length === 0) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  const parsed = workoutPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return createWorkoutPlan(memberId, parsed.data);
}

export async function updateWorkoutPlanAction(
  input: unknown,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const planId = (input as { planId?: unknown } | null)?.planId;
  if (typeof planId !== "string" || planId.length === 0) {
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  const parsed = workoutPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return updateWorkoutPlan(planId, parsed.data);
}

export async function addCustomExerciseAction(
  input: unknown,
): Promise<{ data: ExerciseLibraryRow | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = exerciseNameSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }
  return addCustomExercise(parsed.data);
}
