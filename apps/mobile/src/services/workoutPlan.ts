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

/** Story 11.9: the outcome of a completion submission. `reason` is only ever
 * set on a failure that was positively traced to the gym's own suspension --
 * never guessed, so an ordinary network failure keeps the generic retry copy. */
export interface LogWorkoutCompletionResult {
  success: boolean;
  reason?: 'gym_suspended';
}

/** Story 11.9: confirms whether the caller's own gym is non-active.
 *
 * WHY THIS EXISTS INSTEAD OF isGymSuspendedError(). That predicate matches the
 * `<fn>: gym <uuid> is not active` RAISE text shared by the SECURITY DEFINER
 * write-RPCs (0090/0091), and its three sibling services use it because they
 * call those RPCs. This file calls NONE of them -- the three workout-plan RPCs
 * (create/update/take_ownership) are coach-facing and dashboard-only. Every
 * path here is direct table access, so no such message is ever produced and
 * importing that predicate would add a branch that can never fire.
 *
 * What actually happens at a suspended gym is subtler than Story 11.9's Open
 * Question 1 assumed. The 42501 it describes is real but UNREACHABLE from this
 * service: getCurrentMember() queries `members`, which has been gated since
 * 0073, so it returns null and every writer below bails out before its INSERT
 * is ever attempted. The failure therefore arrives with no distinguishing code
 * or message at all -- which is exactly why the cause has to be confirmed
 * rather than inferred from the error.
 *
 * `gyms` is deliberately never gated (0009's "read own gym" policy) precisely
 * so both apps can detect and render this state, and the gym_id claim is minted
 * regardless of status (0009's custom_access_token_hook). This mirrors
 * use-session.tsx's own claim-then-gyms-read sequence.
 *
 * ON FAILURE IT RETURNS `false`, i.e. "not confirmed suspended" -- deliberately,
 * because a wrong `true` tells a member their gym is suspended on a guess. Note
 * this is conservative about the CLAIM, not about access: the caller falls back
 * to the generic retry copy, so an unrelated outage still reads as "Check your
 * connection". use-session.tsx:85-95 makes the opposite call on the same error
 * -- it bails out rather than committing to a guess -- because it is choosing a
 * route, and misrouting a suspended member to onboarding is worse than a
 * delay. Here the only thing at stake is which message is shown. */
export async function isCurrentGymSuspended(): Promise<boolean> {
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    const claimGymId = (claimsData?.claims as { gym_id?: string } | undefined)?.gym_id ?? null;
    if (!claimGymId) return false;

    const { data, error } = await supabase.from('gyms').select('status').eq('id', claimGymId).maybeSingle();
    if (error || !data) return false;
    return data.status !== 'active';
  } catch {
    return false;
  }
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
): Promise<LogWorkoutCompletionResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { success: false };

  const current = await getCurrentMember(userId);
  // Story 11.9: this is the branch a suspended gym actually takes -- `members`
  // is gated, so the lookup comes back empty long before the INSERT below.
  if (!current) return (await isCurrentGymSuspended()) ? { success: false, reason: 'gym_suspended' } : { success: false };

  const parsed = logWorkoutCompletionSchema.safeParse({ planId, exerciseId, clientCompletionId });
  if (!parsed.success) return { success: false };

  const { error } = await supabase.from('workout_plan_completions').insert({
    gym_id: current.gymId,
    member_id: current.memberId,
    plan_id: parsed.data.planId,
    exercise_id: parsed.data.exerciseId,
    client_completion_id: parsed.data.clientCompletionId,
  });

  if (error && error.code !== '23505') {
    // Story 11.9: the direct-INSERT half of the gate. Reachable only if the
    // members lookup above somehow succeeded while the gym is non-active
    // (a status flip landing between the two statements); 42501 is what
    // tenant_active_gate's WITH CHECK half raises here. Still confirmed
    // against `gyms` rather than trusted, because 42501 is a generic
    // insufficient-privilege code and mislabelling an unrelated RLS denial
    // as "your gym is suspended" is the failure mode Open Question 1
    // rejected option (c) for.
    if (error.code === '42501' && (await isCurrentGymSuspended())) {
      return { success: false, reason: 'gym_suspended' };
    }
    return { success: false };
  }

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
    // Story 11.9 (Open Question 3), CONFIRMED AND DELIBERATELY UNCHANGED: while
    // the gym is suspended this insert is refused, the record stays queued, and
    // the pending badge does not drain until reactivation. That is the CORRECT
    // outcome -- no completion is lost and it self-heals the moment the gym is
    // active again. It is the deliberate opposite of the check-in bug Story
    // 11.8's review fixed, where the queued record was being DELETED on a
    // suspension refusal and the member's scan was silently discarded.
    //
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
export async function loadWorkoutPlan(
  memberId: string,
): Promise<{ data: WorkoutPlanScreenData | null; error: unknown; gymSuspended: boolean }> {
  const { data: planData, error: planError } = await supabase
    .from('workout_plans')
    .select('id, name, workout_plan_exercises(id, exercise_id, order_index, sets, reps, note, exercise_library(name))')
    .eq('member_id', memberId)
    .order('order_index', { referencedTable: 'workout_plan_exercises', ascending: true })
    .maybeSingle<WorkoutPlanRowFromDb>();

  // Story 11.9 / Open Question 2: an RLS-denied SELECT returns zero rows with
  // NO error, so maybeSingle() yields null -- indistinguishable from "no plan
  // yet" and rendered as the empty state, making a gated plan look DELETED
  // rather than unavailable. That is inherent to how tenant_active_gate behaves
  // on all 21 tables it covers and is NOT fixed generally here (teaching every
  // read surface to tell "denied" from "absent" is its own story). It is fixed
  // on THIS surface only, and only in the null case, because AC #5 requires a
  // member who hits the denial on a still-rendered screen to get the neutral
  // FR-132 copy instead of "Check your connection". Costs one extra indexed
  // read on `gyms`, and only when there is no plan to show.
  if (planError) {
    return { data: null, error: planError, gymSuspended: await isCurrentGymSuspended() };
  }
  if (!planData) {
    if (await isCurrentGymSuspended()) {
      // Deliberately NOT cached: the empty result is an artefact of the gate,
      // not the member's real plan state, and caching it would outlive the
      // suspension.
      return { data: null, error: null, gymSuspended: true };
    }
    cachedWorkoutPlan = { memberId, data: null };
    return { data: null, error: null, gymSuspended: false };
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
  return { data, error: null, gymSuspended: false };
}
