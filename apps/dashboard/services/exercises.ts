import { createClient } from "@/lib/supabase/server";
import { type AppError, type ExerciseInput, exerciseNameSchema } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- same discipline as plans.ts's planNotFoundError /
 * coaches.ts's coachNotFoundError: `context` is logged server-side only,
 * never shown to the caller. */
async function exerciseLibraryNotFoundError(context: string): Promise<AppError> {
  console.warn(`[exercises] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("exercises.errors.gymNotFound") };
}

/** Every function in this file needs the caller's own `gym_id`, read from
 * claims -- copied verbatim from plans.ts/coaches.ts's own (unexported)
 * helper rather than reaching across service files, matching this app's
 * established per-file-copy discipline. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, error: await mapAndLog(claimsError) };
  }

  const gymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id;
  if (!gymId) {
    return { gymId: null, error: await exerciseLibraryNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export interface ExerciseLibraryRow {
  id: string;
  name: string;
}

/** Platform-default (`gym_id is null`) and the caller's own gym's custom
 * entries, together in one alphabetical `name` list -- RLS
 * (`authenticated_read_exercise_library`) already restricts the row set to
 * exactly that, so the query itself can just select `*` and order, no need
 * to hand-write the OR. No `is_custom`/`gym_id`-based grouping -- neither AC
 * asks for it, Story 13.2's picker UI can add grouping/search later if it
 * wants it. */
export async function listExerciseLibrary(): Promise<{ data: ExerciseLibraryRow[] | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("exercise_library")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: data ?? [], error: null };
}

/** Coach-only per RLS (`coach_insert_own_gym_exercise_library`) -- any other
 * staff role's attempt resolves to `{ data: null, error }` here, never
 * throws (AD-9), matching insertMember/createStaffMember's own "0 rows
 * affected" discipline for an RLS-denied write. */
export async function addCustomExercise(
  input: ExerciseInput,
): Promise<{ data: ExerciseLibraryRow | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = exerciseNameSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("exercise_library")
    .insert({ gym_id: gymId, name: parsed.data.name })
    .select("id, name")
    .single();

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }
  return { data, error: null };
}
