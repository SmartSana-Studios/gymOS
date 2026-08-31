import { createClient } from "@/lib/supabase/server";
import { type AppError, type WorkoutPlanInput, workoutPlanSchema } from "@gymos/types";
import { mapAndLog, type MemberRole } from "@/services/session";
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
 * established per-file-copy discipline. Extended beyond that copy to also
 * return `role` (`claims.app_role as MemberRole`, per auditLog.ts's own
 * identical extension) -- Story 13.4's `getWorkoutPlan()` needs it to decide
 * whether to call `get_workout_plan_viewer_context`, without a second
 * `getClaims()` round trip. */
async function getCallerGymId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ gymId: string | null; role: MemberRole | null; error: AppError | null }> {
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError) {
    return { gymId: null, role: null, error: await mapAndLog(claimsError) };
  }

  const claims = claimsData?.claims as { gym_id?: string; app_role?: string } | undefined;
  const gymId = claims?.gym_id ?? null;
  const role = (claims?.app_role as MemberRole | undefined) ?? null;
  if (!gymId) {
    return { gymId: null, role, error: await workoutPlanNotFoundError("no gym_id claim on caller's session") };
  }

  return { gymId, role, error: null };
}

export interface WorkoutPlanExerciseRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  note: string | null;
  orderIndex: number;
  /** Story 13.3: grouped by exercise_id, not workout_plan_exercises.id (see
   * getWorkoutPlan()'s own comment) -- when a plan has two rows sharing the
   * same exerciseId, both rows carry the identical completionCount/
   * lastCompletedAt. Documented, accepted limitation, not a bug. */
  completionCount: number;
  lastCompletedAt: string | null;
}

export interface WorkoutPlanRow {
  id: string;
  name: string;
  coachId: string;
  exercises: WorkoutPlanExerciseRow[];
  /** Story 13.4: whether the current viewer may edit this plan. `false` for
   * every non-authoring-coach viewer, including Owner/Manager (who never
   * edit) and a reassigned coach who has not yet taken ownership. */
  viewerCanEdit: boolean;
  /** Story 13.4: the previous coach's name, populated only for a reassigned
   * coach viewing a plan they have not yet taken ownership of -- drives the
   * handoff banner. `null` for the authoring coach and for every non-coach
   * viewer. */
  handoffCoachName: string | null;
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

/** Story 13.3: keyed by exercise_id (workout_plan_completions' own join
 * key -- see the migration's Dev Notes for why it can't be
 * workout_plan_exercises.id). `count`/`latest` are pre-aggregated here so
 * `toWorkoutPlanRow()` stays a pure per-row lookup. */
type CompletionSummaryByExerciseId = Map<string, { count: number; latest: string }>;

function toWorkoutPlanRow(
  row: WorkoutPlanRowFromDb,
  completions: CompletionSummaryByExerciseId,
  viewerContext: { viewerCanEdit: boolean; handoffCoachName: string | null },
): WorkoutPlanRow {
  return {
    id: row.id,
    name: row.name,
    coachId: row.coach_id,
    viewerCanEdit: viewerContext.viewerCanEdit,
    handoffCoachName: viewerContext.handoffCoachName,
    exercises: row.workout_plan_exercises.map((ex) => {
      const exercise = Array.isArray(ex.exercise_library) ? ex.exercise_library[0] : ex.exercise_library;
      const summary = completions.get(ex.exercise_id);
      return {
        id: ex.id,
        exerciseId: ex.exercise_id,
        exerciseName: exercise?.name ?? "",
        sets: ex.sets,
        reps: ex.reps,
        note: ex.note,
        orderIndex: ex.order_index,
        completionCount: summary?.count ?? 0,
        lastCompletedAt: summary?.latest ?? null,
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
  const { gymId, role, error: gymIdError } = await getCallerGymId(supabase);
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

  if (!data) {
    return { data: null, error: null };
  }

  // Story 13.3: a second, independent query -- no FK from
  // workout_plan_exercises to workout_plan_completions for PostgREST to
  // auto-embed (completions are keyed by exercise_id, not
  // workout_plan_exercises.id, per the migration's own design). Grouped
  // in-memory by exercise_id, not a DB view. A failure here degrades to
  // "no completions" for every row rather than failing the whole plan
  // fetch, matching apps/mobile/src/services/progress.ts's
  // loadProgressScreenData's own "entries/photos are independent,
  // secondary reads" precedent.
  const { data: completionRows, error: completionsError } = await supabase
    .from("workout_plan_completions")
    .select("exercise_id, completed_at")
    .eq("gym_id", gymId)
    .eq("plan_id", data.id)
    .order("completed_at", { ascending: false })
    // Safety cap on an otherwise-unbounded history; "latest" per exercise_id
    // stays exact regardless (newest-first ordering means the first row seen
    // for each exercise_id is already its latest), only "count" could
    // undercount for a single plan with 200+ completions across all its
    // exercises combined -- an edge case at realistic usage.
    .limit(200);

  if (completionsError) {
    console.error("[workoutPlans] workout_plan_completions query failed, degrading to zero completions", completionsError);
  }

  const completions: CompletionSummaryByExerciseId = new Map();
  if (!completionsError && completionRows) {
    for (const row of completionRows) {
      const existing = completions.get(row.exercise_id);
      if (existing) {
        existing.count += 1;
        // Rows arrive newest-first, so the first one seen per exercise_id
        // is already the latest -- no comparison needed.
      } else {
        completions.set(row.exercise_id, { count: 1, latest: row.completed_at });
      }
    }
  }

  // Story 13.4: viewer-relative edit/ownership state, resolved via
  // get_workout_plan_viewer_context() -- a coach has no RLS path to read
  // another coach's `members` row (see the RPC's own migration comment), so
  // this must go through the SECURITY DEFINER helper, not a PostgREST embed.
  // Only a coach viewer ever needs this: Owner/Manager never edit or take
  // ownership, and the member-app has its own separate read path
  // (untouched by this story). Same degrade-on-failure discipline as the
  // completions query above -- a coach who can't determine ownership state
  // sees the safe, read-only-with-no-banner state, not a broken page.
  let viewerCanEdit = false;
  let handoffCoachName: string | null = null;

  if (role === "coach") {
    const { data: viewerContextRows, error: viewerContextError } = await supabase.rpc(
      "get_workout_plan_viewer_context",
      { p_plan_id: data.id },
    );

    if (viewerContextError) {
      console.error(
        "[workoutPlans] get_workout_plan_viewer_context query failed, degrading to read-only with no banner",
        viewerContextError,
      );
    } else if (viewerContextRows && viewerContextRows.length > 0) {
      const viewerContext = viewerContextRows[0] as { is_authoring_coach: boolean; author_name: string | null };
      viewerCanEdit = viewerContext.is_authoring_coach ?? false;
      handoffCoachName = viewerContext.author_name ?? null;
    }
  }

  return { data: toWorkoutPlanRow(data, completions, { viewerCanEdit, handoffCoachName }), error: null };
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

/** Calls `take_ownership_of_workout_plan` (0082) -- reassigns a plan's
 * authoring coach to the caller, unlocking `updateWorkoutPlan()` for them.
 * Same thin `mapAndLog` shape as `updateWorkoutPlan()`. No Zod schema --
 * `planId` is a plain, unvalidated function argument matching
 * `updateWorkoutPlan()`'s own precedent; the RPC itself is the authority on
 * existence/assignment. */
export async function takeOwnershipOfWorkoutPlan(planId: string): Promise<{ error: AppError | null }> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("take_ownership_of_workout_plan", { p_plan_id: planId });

  if (error) {
    return { error: await mapAndLog(error) };
  }

  return { error: null };
}
