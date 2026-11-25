import AsyncStorage from '@react-native-async-storage/async-storage';
import { isGymSuspendedError } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Story 30.1 (FR-219): mobile service-layer wrapper over my_weekly_goal() and set_weekly_goal() (0184_engagement_config_weekly_goal.sql).
 * Follows classes.ts's typed-result-union, never-throw shape. A goal change is never queued offline (the effective Monday is the server's
 * gym-local next Monday), so there is no offline plumbing here. Both RPCs resolve the caller on the server; neither takes a member id or a
 * date. The returned rows are untyped (the client has no Database generic), so every field is parsed defensively and a malformed row is an
 * error, never a guess. */

export interface WeeklyGoal {
  /** The goal in force this week (the config default until the member has an explicit row in force). */
  currentGoal: number;
  currentGoalIsDefault: boolean;
  /** A change that starts on `pendingEffectiveWeek`, or null. */
  pendingGoal: number | null;
  /** Gym-local Monday, `YYYY-MM-DD`. */
  pendingEffectiveWeek: string | null;
  /** The next gym-local Monday, `YYYY-MM-DD`: the date any change made now starts on. */
  nextEffectiveWeek: string;
  goalMin: number;
  goalMax: number;
}

export type GetMyWeeklyGoalResult =
  | { status: 'success'; goal: WeeklyGoal }
  // The server returned no row: the caller is not a live member of an active gym.
  | { status: 'unavailable' }
  | { status: 'error' };

export interface SetWeeklyGoalOutcome {
  /** The goal now pending, or the goal in force when nothing is pending (a cancel or a no-op). */
  goal: number;
  /** The Monday the pending goal starts on; null when nothing is pending afterwards. */
  effectiveWeek: string | null;
  currentGoal: number;
  currentGoalIsDefault: boolean;
}

export type SetWeeklyGoalResult =
  | { status: 'success'; outcome: SetWeeklyGoalOutcome }
  | { status: 'invalid_goal' }
  | { status: 'gym_suspended' }
  | { status: 'error' };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

/** PostgREST returns a table-returning function as an array of rows; take the first, tolerate a bare object. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
}

export function parseWeeklyGoal(data: unknown): WeeklyGoal | null {
  const row = firstRow(data);
  if (!row) return null;
  const { current_goal, current_goal_is_default, pending_goal, pending_effective_week, next_effective_week, goal_min, goal_max } = row;
  if (!isInt(current_goal) || typeof current_goal_is_default !== 'boolean') return null;
  if (!isDateOnly(next_effective_week) || !isInt(goal_min) || !isInt(goal_max)) return null;
  const hasPending = pending_goal !== null && pending_goal !== undefined;
  if (hasPending && (!isInt(pending_goal) || !isDateOnly(pending_effective_week))) return null;
  return {
    currentGoal: current_goal,
    currentGoalIsDefault: current_goal_is_default,
    pendingGoal: hasPending ? (pending_goal as number) : null,
    pendingEffectiveWeek: hasPending ? (pending_effective_week as string) : null,
    nextEffectiveWeek: next_effective_week,
    goalMin: goal_min,
    goalMax: goal_max,
  };
}

export function parseSetWeeklyGoalOutcome(data: unknown): SetWeeklyGoalOutcome | null {
  const row = firstRow(data);
  if (!row) return null;
  const { goal, effective_week, current_goal, current_goal_is_default } = row;
  if (!isInt(goal) || !isInt(current_goal) || typeof current_goal_is_default !== 'boolean') return null;
  if (effective_week !== null && effective_week !== undefined && !isDateOnly(effective_week)) return null;
  return {
    goal,
    effectiveWeek: typeof effective_week === 'string' ? effective_week : null,
    currentGoal: current_goal,
    currentGoalIsDefault: current_goal_is_default,
  };
}

/** The caller's goal in force, the pending change and the allowed range. */
export async function getMyWeeklyGoal(): Promise<GetMyWeeklyGoalResult> {
  try {
    const { data, error } = await supabase.rpc('my_weekly_goal');
    if (error) return { status: 'error' };
    if (Array.isArray(data) && data.length === 0) return { status: 'unavailable' };
    const goal = parseWeeklyGoal(data);
    return goal ? { status: 'success', goal } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Sets the caller's weekly goal from the next gym-local Monday. */
export async function setWeeklyGoal(goal: number): Promise<SetWeeklyGoalResult> {
  try {
    const { data, error } = await supabase.rpc('set_weekly_goal', { p_goal: goal });
    if (error) {
      if (isGymSuspendedError(error)) return { status: 'gym_suspended' };
      if (error.message?.includes('invalid_goal')) return { status: 'invalid_goal' };
      return { status: 'error' };
    }
    const outcome = parseSetWeeklyGoalOutcome(data);
    return outcome ? { status: 'success', outcome } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

// Device-local flag: the member has opened the goal sheet, so the Home hint about the default goal (Story 30.4) is not shown again. One flag per
// user (the hint is about the account's default, not a gym).
const HINT_KEY_PREFIX = 'gymos.engageGoalHintSeen.v1.';

/** True when the sheet has been opened on this device; false when it has not or storage cannot be read (the hint then shows once more, which
 * is harmless). */
export async function readGoalHintSeen(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HINT_KEY_PREFIX + userId)) === '1';
  } catch {
    return false;
  }
}

/** Written when the goal sheet opens. Returns false when it could not be stored. */
export async function markGoalHintSeen(userId: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(HINT_KEY_PREFIX + userId, '1');
    return true;
  } catch {
    return false;
  }
}
