import { createClient } from "@/lib/supabase/server";
import { type AppError, type WorkoutPlanInput, workoutPlanSchema } from "@gymos/types";
import { mapAndLog } from "@/services/session";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getServerTranslation } from "@/lib/i18n/get-server-translation";

/** Shared by every "0 rows affected" (RLS-denied) / "no gym_id claim" branch
 * in this file -- same discipline as plans.ts's planNotFoundError /
 * coaches.ts's coachNotFoundError: `context` is logged server-side only,
 * never shown to the caller. */
async function workoutPlanNotFoundError(context: string): Promise<AppError> {
  console.warn(`[workoutPlans] resolved to not_found: ${context}`);
  const { t } = await getServerTranslation(await getRequestLocale());
  return { code: "not_found", message: t("workoutPlans.errors.gymNotFound") };
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
    return { gymId: null, error: await workoutPlanNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, error: null };
}

export interface WorkoutPlanExerciseRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  note: string | null;
  orderIndex: number;
}

export interface WorkoutPlanRow {
  id: string;
  name: string;
  coachId: string;
  exercises: WorkoutPlanExerciseRow[];
}

interface WorkoutPlanExerciseRowFromDb {
  id: string;
  exercise_id: string;
  order_index: number;
  sets: number;
  reps: number;
  note: string | null;
  // Dual-shape acceptance matches classes.ts's ClassRowFromDb -- PostgREST's
  // embed cardinality inference isn't reflected in the query builder's
  // inferred TS type here.
  exercise_library: { name: string } | { name: string }[] | null;
}

interface WorkoutPlanRowFromDb {
  id: string;
  name: string;
  coach_id: string;
  workout_plan_exercises: WorkoutPlanExerciseRowFromDb[];
}

function toWorkoutPlanRow(row: WorkoutPlanRowFromDb): WorkoutPlanRow {
  return {
    id: row.id,
    name: row.name,
    coachId: row.coach_id,
    exercises: row.workout_plan_exercises.map((ex) => {
      const exercise = Array.isArray(ex.exercise_library) ? ex.exercise_library[0] : ex.exercise_library;
      return {
        id: ex.id,
        exerciseId: ex.exercise_id,
        exerciseName: exercise?.name ?? "",
        sets: ex.sets,
        reps: ex.reps,
        note: ex.note,
        orderIndex: ex.order_index,
      };
    }),
  };
}

/** RLS (`self_read_own_workout_plan[_exercises]`/`coach_read_assigned_workout_plan[_exercises]`)
 * already scopes to "own plan, assigned-coach's plan, or nothing" --
 * `.maybeSingle()`'s `null` result means "no plan yet" (the empty-state UX),
 * not an error, matching `idx_workout_plans_member_unique`'s
 * one-plan-per-member invariant. */
export async function getWorkoutPlan(
  memberId: string,
): Promise<{ data: WorkoutPlanRow | null; error: AppError | null }> {
  const supabase = await createClient();
  const { gymId, error: gymIdError } = await getCallerGymId(supabase);
  if (gymIdError || !gymId) {
    return { data: null, error: gymIdError };
  }

  const { data, error } = await supabase
    .from("workout_plans")
    .select(
      "id, name, coach_id, workout_plan_exercises(id, exercise_id, order_index, sets, reps, note, exercise_library(name))",
    )
    .eq("gym_id", gymId)
    .eq("member_id", memberId)
    .order("order_index", { referencedTable: "workout_plan_exercises", ascending: true })
    .maybeSingle();

  if (error) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: data ? toWorkoutPlanRow(data) : null, error: null };
}

/** Calls `create_workout_plan` (0080) -- a single SECURITY DEFINER
 * transaction that resolves the caller's own coach id, checks the
 * assignment (AC #4), and inserts the plan plus its ordered exercise rows
 * atomically. `{ data, error }` never throws (AD-9) -- an RLS/assignment/
 * cross-gym-exercise rejection from the RPC surfaces through `mapAndLog(error)`
 * like every other RPC-calling service function (`insertClass`'s exact
 * shape). */
export async function createWorkoutPlan(
  memberId: string,
  input: WorkoutPlanInput,
): Promise<{ data: { id: string } | null; error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = workoutPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_workout_plan", {
    p_member_id: memberId,
    p_name: parsed.data.name,
    p_exercises: parsed.data.exercises.map((e) => ({
      exercise_id: e.exerciseId,
      sets: e.sets,
      reps: e.reps,
      note: e.note,
    })),
  });

  if (error || !data) {
    return { data: null, error: await mapAndLog(error) };
  }

  return { data: { id: data }, error: null };
}

/** Calls `update_workout_plan` (0080) -- same `mapAndLog` shape as
 * `updateClass`. The RPC's own ownership check (only the authoring coach
 * may edit, FR-111 scaffolding) surfaces as a plain RPC rejection here, same
 * as every other permission-denied raise this file's callers already
 * handle. */
export async function updateWorkoutPlan(
  planId: string,
  input: WorkoutPlanInput,
): Promise<{ error: AppError | null }> {
  const { t } = await getServerTranslation(await getRequestLocale());
  const parsed = workoutPlanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: { code: "validation_error", message: t("common.invalidInput") } };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("update_workout_plan", {
    p_plan_id: planId,
    p_name: parsed.data.name,
    p_exercises: parsed.data.exercises.map((e) => ({
      exercise_id: e.exerciseId,
      sets: e.sets,
      reps: e.reps,
      note: e.note,
    })),
  });

  if (error) {
    return { error: await mapAndLog(error) };
  }

  return { error: null };
}
