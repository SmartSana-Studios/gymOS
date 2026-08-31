import { ANALYTICS_EVENT, logWorkoutCompletionSchema } from '@gymos/types';

import { captureEvent } from '@/lib/analytics';
import {
  deleteOfflineWorkoutCompletion,
  getOfflineWorkoutCompletions,
  insertOfflineWorkoutCompletion,
  type OfflineWorkoutCompletion,
} from '@/lib/sqlite';
import { supabase } from '@/lib/supabase';
import { getCurrentMember } from '@/services/progress';

export interface WorkoutPlanExerciseRow {
  id: string;
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  note: string | null;
  orderIndex: number;
  /** Story 13.3: full completion history (ISO timestamps, newest-first),
   * not just a count -- lets the member see "I did this 3 times this
   * week," unlike the dashboard's coach-facing summary-only view
   * (apps/dashboard/services/workoutPlans.ts's completionCount/
   * lastCompletedAt). Keyed by exercise_id: when a plan has two rows
   * sharing the same exerciseId (13.2's accepted duplicate-exercise
   * case), both rows carry the identical completions array -- documented,
   * accepted limitation, not a bug. */
  completions: string[];
}

export interface WorkoutPlanScreenData {
  planId: string;
  name: string;
  exercises: WorkoutPlanExerciseRow[];
}

/** Story 13.3: the online-immediate path. `clientCompletionId` is supplied
 * by the caller and stays stable across retries of the same submission,
 * matching `logProgressEntry`'s clientEntryId convention. On a unique
 * violation (23505, client_completion_id conflict), treats it as the
 * idempotent-replay case and returns success -- unlike logProgressEntry,
 * there's no dependent second write (a photo upsert) that needs the
 * resolved row id afterward, so there's nothing to look up an existing row
 * for. */
export async function logWorkoutCompletion(
  planId: string,
  exerciseId: string,
  clientCompletionId: string,
): Promise<{ success: boolean }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { success: false };

  const current = await getCurrentMember(userId);
  if (!current) return { success: false };

  const parsed = logWorkoutCompletionSchema.safeParse({ planId, exerciseId, clientCompletionId });
  if (!parsed.success) return { success: false };

  const { error } = await supabase.from('workout_plan_completions').insert({
    gym_id: current.gymId,
    member_id: current.memberId,
    plan_id: parsed.data.planId,
    exercise_id: parsed.data.exerciseId,
    client_completion_id: parsed.data.clientCompletionId,
  });

  if (error && error.code !== '23505') return { success: false };

  captureEvent(ANALYTICS_EVENT.WORKOUT_PLAN_EXERCISE_COMPLETED, { gymId: current.gymId, loggedOffline: false });
  return { success: true };
}

/** Story 13.3: queues an offline completion locally and returns
 * immediately -- no network call -- mirroring `queueOfflineProgressEntry`'s
 * shape exactly. Validated via `logWorkoutCompletionSchema` before ever
 * reaching SQLite. */
export async function queueOfflineWorkoutCompletion(
  planId: string,
  exerciseId: string,
  clientCompletionId: string,
): Promise<{ success: true; id: string } | { success: false }> {
  const parsed = logWorkoutCompletionSchema.safeParse({ planId, exerciseId, clientCompletionId });
  if (!parsed.success) return { success: false };

  const completedAt = new Date().toISOString();
  await insertOfflineWorkoutCompletion({
    id: parsed.data.clientCompletionId,
    planId: parsed.data.planId,
    exerciseId: parsed.data.exerciseId,
    completedAt,
  });
  return { success: true, id: parsed.data.clientCompletionId };
}

async function syncOneWorkoutCompletion(record: OfflineWorkoutCompletion, gymId: string, memberId: string) {
  const { error } = await supabase.from('workout_plan_completions').insert({
    gym_id: gymId,
    member_id: memberId,
    plan_id: record.planId,
    exercise_id: record.exerciseId,
    client_completion_id: record.id,
    completed_at: record.completedAt,
  });

  if (error && error.code !== '23505') {
    // Any rejection other than the idempotent-replay case (e.g. the
    // exercise was removed from the plan before this queued item ever
    // synced) is left queued for a future sync attempt -- matches
    // syncOneProgressEntry's own "leave queued, no business-rule
    // rejection today" precedent.
    return;
  }

  await deleteOfflineWorkoutCompletion(record.id);
  captureEvent(ANALYTICS_EVENT.WORKOUT_PLAN_EXERCISE_COMPLETED, { gymId, loggedOffline: true });
}

/** Story 13.3: replays every queued offline completion, oldest-first,
 * mirroring `syncPendingProgressEntries`'s per-record independent-outcome
 * loop exactly -- one record's outcome must never stop processing the rest
 * of the batch. */
export async function syncPendingWorkoutCompletions(): Promise<void> {
  let pending;
  try {
    pending = await getOfflineWorkoutCompletions();
  } catch (err) {
    console.error('[offline-sync] failed to read the local workout-completion queue', err);
    return;
  }
  if (pending.length === 0) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const current = await getCurrentMember(userId);
  if (!current) return;

  for (const record of pending) {
    try {
      await syncOneWorkoutCompletion(record, current.gymId, current.memberId);
    } catch (err) {
      console.error('[offline-sync] workout-completion insert failed, record left queued for retry', err);
    }
  }
}

// Session-lifetime-only, memberId-keyed cache -- byte-for-byte the same
// shape as services/progress.ts's cachedProgressPayload/
// getCachedProgressPayload/clearCachedProgressPayload (Story 10.3's own
// code-review-hardened precedent: keyed by memberId to prevent a
// same-device member-switch leak).
let cachedWorkoutPlan: { memberId: string; data: WorkoutPlanScreenData | null } | null = null;

export function getCachedWorkoutPlan(memberId: string): WorkoutPlanScreenData | null {
  return cachedWorkoutPlan?.memberId === memberId ? cachedWorkoutPlan.data : null;
}

/** Called from the sign-out flow (mirrors clearCachedProgressPayload's own
 * call sites) so a subsequent sign-in as a different member on the same
 * device never sees a stale cache. */
export function clearCachedWorkoutPlan(): void {
  cachedWorkoutPlan = null;
}

interface WorkoutPlanExerciseRowFromDb {
  id: string;
  exercise_id: string;
  order_index: number;
  sets: number;
  reps: number;
  note: string | null;
  // Dual-shape acceptance matches apps/dashboard/services/workoutPlans.ts's
  // WorkoutPlanExerciseRowFromDb -- PostgREST's embed cardinality
  // inference isn't reflected in the query builder's inferred TS type here.
  exercise_library: { name: string } | { name: string }[] | null;
}

interface WorkoutPlanRowFromDb {
  id: string;
  name: string;
  workout_plan_exercises: WorkoutPlanExerciseRowFromDb[];
}

/** Story 13.3: the workout-plan screen's single on-mount fetch. `null`
 * means "no plan yet" (the empty-state UX), not an error, matching the
 * dashboard's own `getWorkoutPlan()` precedent. A second, independent
 * query for completions degrades to an empty history per exercise on
 * failure rather than failing the whole payload, matching
 * `loadProgressScreenData`'s own degrade-not-fail discipline. */
export async function loadWorkoutPlan(memberId: string): Promise<{ data: WorkoutPlanScreenData | null; error: unknown }> {
  const { data: planData, error: planError } = await supabase
    .from('workout_plans')
    .select('id, name, workout_plan_exercises(id, exercise_id, order_index, sets, reps, note, exercise_library(name))')
    .eq('member_id', memberId)
    .order('order_index', { referencedTable: 'workout_plan_exercises', ascending: true })
    .maybeSingle<WorkoutPlanRowFromDb>();

  if (planError) return { data: null, error: planError };
  if (!planData) {
    cachedWorkoutPlan = { memberId, data: null };
    return { data: null, error: null };
  }

  const { data: completionRows, error: completionsError } = await supabase
    .from('workout_plan_completions')
    .select('exercise_id, completed_at')
    .eq('member_id', memberId)
    .eq('plan_id', planData.id)
    .order('completed_at', { ascending: false })
    .limit(200);

  if (completionsError) {
    console.error('[workout-plan] completions query failed, degrading to empty history', completionsError);
  }

  const completionsByExerciseId = new Map<string, string[]>();
  if (!completionsError && completionRows) {
    for (const row of completionRows) {
      const existing = completionsByExerciseId.get(row.exercise_id);
      if (existing) {
        existing.push(row.completed_at);
      } else {
        completionsByExerciseId.set(row.exercise_id, [row.completed_at]);
      }
    }
  }

  const data: WorkoutPlanScreenData = {
    planId: planData.id,
    name: planData.name,
    exercises: planData.workout_plan_exercises.map((ex) => {
      const exercise = Array.isArray(ex.exercise_library) ? ex.exercise_library[0] : ex.exercise_library;
      return {
        id: ex.id,
        exerciseId: ex.exercise_id,
        exerciseName: exercise?.name ?? '',
        sets: ex.sets,
        reps: ex.reps,
        note: ex.note,
        orderIndex: ex.order_index,
        completions: completionsByExerciseId.get(ex.exercise_id) ?? [],
      };
    }),
  };

  cachedWorkoutPlan = { memberId, data };
  return { data, error: null };
}
