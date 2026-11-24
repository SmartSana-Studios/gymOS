import { isGymSuspendedError } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Story 30.3 (FR-219, FR-220, FR-224): mobile service-layer wrapper over my_engagement() and open_engagement()
 * (0186_engagement_settle_triggers_state_view.sql). Follows weeklyGoal.ts's typed-result-union, never-throw shape. Both RPCs resolve the
 * caller on the server and take no argument: no member id, no date, no clock. my_engagement() only reads; open_engagement() settles the
 * weeks that have closed and returns the same row, so the screens call it once per open when `needsSettle` is true (never in a retry loop
 * on the flag) and my_engagement() otherwise. Every number shown comes from this row: the app never derives a count, a streak
 * or an at-risk flag itself, and hours left come from `dayEndsAt` minus `serverNow`, never the phone clock. The returned rows are untyped
 * (the client has no Database generic), so every field is parsed defensively and a malformed row is an error, never a guess. */

export interface Engagement {
  /** The operator has set the release week; false means nothing engagement-related is shown. */
  enabled: boolean;
  /** Gym-local today, `YYYY-MM-DD`. */
  gymToday: string;
  /** Gym-local Monday and Sunday of the open week, `YYYY-MM-DD`. */
  weekStart: string;
  weekEnd: string;
  /** The open week is before the release week: the ring may show, the streak and the at-risk hint do not. */
  inReleaseWeek: boolean;
  goal: number;
  goalIsDefault: boolean;
  pendingGoal: number | null;
  pendingEffectiveWeek: string | null;
  visitsThisWeek: number;
  goalMet: boolean;
  visitedToday: boolean;
  /** The SETTLED streak: never counts the open week. Null (Story 31.1) when no run is active, never a bare 0. */
  streakWeeks: number | null;
  /** The streak if the open week ends as it is now, or null when the goal is not met yet or the week is not counted. */
  streakIfMet: number | null;
  bestStreakWeeks: number;
  hasSettledWeek: boolean;
  /** Days left in the week, today included. */
  daysLeftInWeek: number;
  visitsNeeded: number;
  atRiskWeekly: boolean;
  /** The daily streak is deferred (Epic 31 keeps the hooks): constant until it ships. */
  atRiskDaily: boolean;
  dailyRun: number | null;
  /** Story 31.1: Shields held now (0 to `shieldCap`), derived by the server's fold. */
  shieldsHeld: number;
  /** Story 31.1: 'none', 'active', 'lapsed' or 'restored'. Completed by a met week reads 'none'. */
  comebackState: string;
  /** The gym-local day around `serverNow`, ISO timestamps. */
  dayStartsAt: string;
  dayEndsAt: string;
  serverNow: string;
  /** True when open_engagement() has something to settle. */
  needsSettle: boolean;
  /** Story 31.1 (configuration read by the server, never hard-coded here): the Shield interval in weeks and the most Shields held. */
  shieldEveryWeeks: number;
  shieldCap: number;
  /** Weeks of met weeks to the next Shield (1 to `shieldEveryWeeks`); null at the cap or with no run. */
  weeksToNextShield: number | null;
  /** The newest effective saved week (its Monday) and the streak after it, else null. */
  savedWeekStart: string | null;
  savedWeekStreak: number | null;
  /** The Monday of the newest week that earned a Shield, else null. */
  shieldEarnedWeek: string | null;
  /** Comeback progress, all from the server: visits done in the window, the goal, the window length, and the window dates (null until a window starts). */
  comebackVisitsDone: number;
  comebackVisitsGoal: number;
  comebackWindowDays: number;
  comebackWindowStart: string | null;
  comebackWindowEndsOn: string | null;
  /** Story 30.7: the highest milestone (7, 30 or 100) waiting to be celebrated, or null. Read only from a live row (lib/celebrationView.ts). */
  pendingMilestone: number | null;
}

export type GetMyEngagementResult =
  | { status: 'success'; engagement: Engagement }
  // The server returned no row: the caller is not a live member of an active gym.
  | { status: 'unavailable' }
  | { status: 'error' };

export type OpenEngagementResult =
  | { status: 'success'; engagement: Engagement }
  // The server refused: the caller is not a live member (42501).
  | { status: 'unavailable' }
  | { status: 'gym_suspended' }
  | { status: 'error' };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isDateOnly(value);
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || isInt(value);
}

/** PostgREST returns a table-returning function as an array of rows; take the first, tolerate a bare object. */
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
}

export function parseEngagement(data: unknown): Engagement | null {
  const row = firstRow(data);
  if (!row) return null;
  const r = row;
  const bools = [r.enabled, r.in_release_week, r.goal_is_default, r.goal_met, r.visited_today, r.has_settled_week, r.at_risk_weekly, r.at_risk_daily, r.needs_settle];
  if (bools.some((b) => typeof b !== 'boolean')) return null;
  const ints = [r.goal, r.visits_this_week, r.best_streak_weeks, r.days_left_in_week, r.visits_needed, r.shields_held, r.shield_every_weeks, r.shield_cap, r.comeback_visits_done, r.comeback_visits_goal, r.comeback_window_days];
  if (ints.some((n) => !isInt(n))) return null;
  if (!isNullableInt(r.streak_weeks) || !isNullableInt(r.weeks_to_next_shield) || !isNullableInt(r.saved_week_streak)) return null;
  if (!isNullableDate(r.saved_week_start) || !isNullableDate(r.shield_earned_week) || !isNullableDate(r.comeback_window_start) || !isNullableDate(r.comeback_window_ends_on)) return null;
  if (!isDateOnly(r.gym_today) || !isDateOnly(r.week_start) || !isDateOnly(r.week_end)) return null;
  if (!isTimestamp(r.day_starts_at) || !isTimestamp(r.day_ends_at) || !isTimestamp(r.server_now)) return null;
  if (!isNullableInt(r.streak_if_met) || !isNullableInt(r.daily_run) || !isNullableInt(r.pending_milestone) || !isNullableInt(r.pending_goal)) return null;
  if (typeof r.comeback_state !== 'string') return null;
  const hasPending = r.pending_goal !== null && r.pending_goal !== undefined;
  if (hasPending && !isDateOnly(r.pending_effective_week)) return null;
  return {
    enabled: r.enabled as boolean,
    gymToday: r.gym_today,
    weekStart: r.week_start,
    weekEnd: r.week_end,
    inReleaseWeek: r.in_release_week as boolean,
    goal: r.goal as number,
    goalIsDefault: r.goal_is_default as boolean,
    pendingGoal: hasPending ? (r.pending_goal as number) : null,
    pendingEffectiveWeek: hasPending ? (r.pending_effective_week as string) : null,
    visitsThisWeek: r.visits_this_week as number,
    goalMet: r.goal_met as boolean,
    visitedToday: r.visited_today as boolean,
    streakWeeks: r.streak_weeks as number | null,
    streakIfMet: (r.streak_if_met ?? null) as number | null,
    bestStreakWeeks: r.best_streak_weeks as number,
    hasSettledWeek: r.has_settled_week as boolean,
    daysLeftInWeek: r.days_left_in_week as number,
    visitsNeeded: r.visits_needed as number,
    atRiskWeekly: r.at_risk_weekly as boolean,
    atRiskDaily: r.at_risk_daily as boolean,
    dailyRun: (r.daily_run ?? null) as number | null,
    shieldsHeld: r.shields_held as number,
    comebackState: r.comeback_state,
    dayStartsAt: r.day_starts_at,
    dayEndsAt: r.day_ends_at,
    serverNow: r.server_now,
    needsSettle: r.needs_settle as boolean,
    shieldEveryWeeks: r.shield_every_weeks as number,
    shieldCap: r.shield_cap as number,
    weeksToNextShield: r.weeks_to_next_shield as number | null,
    savedWeekStart: r.saved_week_start as string | null,
    savedWeekStreak: r.saved_week_streak as number | null,
    shieldEarnedWeek: r.shield_earned_week as string | null,
    comebackVisitsDone: r.comeback_visits_done as number,
    comebackVisitsGoal: r.comeback_visits_goal as number,
    comebackWindowDays: r.comeback_window_days as number,
    comebackWindowStart: r.comeback_window_start as string | null,
    comebackWindowEndsOn: r.comeback_window_ends_on as string | null,
    pendingMilestone: (r.pending_milestone ?? null) as number | null,
  };
}

/** The caller's open-week state. Reads only; never settles. */
export async function getMyEngagement(): Promise<GetMyEngagementResult> {
  try {
    const { data, error } = await supabase.rpc('my_engagement');
    if (error) return { status: 'error' };
    if (Array.isArray(data) && data.length === 0) return { status: 'unavailable' };
    const engagement = parseEngagement(data);
    return engagement ? { status: 'success', engagement } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Settles the weeks that have closed, then returns the caller's open-week state. Call it when `needsSettle` is true. */
export async function openEngagement(): Promise<OpenEngagementResult> {
  try {
    const { data, error } = await supabase.rpc('open_engagement');
    if (error) {
      if (isGymSuspendedError(error)) return { status: 'gym_suspended' };
      if (error.code === '42501') return { status: 'unavailable' };
      return { status: 'error' };
    }
    const engagement = parseEngagement(data);
    return engagement ? { status: 'success', engagement } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
