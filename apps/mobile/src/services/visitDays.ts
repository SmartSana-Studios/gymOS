import { supabase } from '@/lib/supabase';

/** Story 30.5 (FR-224, FR-225): mobile service-layer wrapper over my_visit_days(p_month) and my_first_visit_day()
 * (0187_attendance_calendar.sql). Follows engagement.ts's typed-result-union, never-throw shape. Both RPCs resolve the caller on the server;
 * neither takes a member id. The month is the first day of a gym-local month as `YYYY-MM-DD`: the screen only ever sends that, and never a month
 * after the gym's current one (the server refuses both with `invalid_month`). The returned rows are untyped (the client has no Database
 * generic), so every field is parsed defensively and a malformed row is an error, never a guess. `milestone` is 7, 30 or 100 on the day of that visit (Story 30.7, derived on the server). */

export interface VisitDay {
  /** Gym-local day, `YYYY-MM-DD`. */
  visitDay: string;
  /** 7, 30 or 100 on the day of that milestone visit, else null. */
  milestone: number | null;
}

export type GetMyVisitDaysResult =
  // An empty list is a month with no visits (or a caller who is not a live member: the server answers both with no row).
  | { status: 'success'; days: VisitDay[] }
  | { status: 'invalid_month' }
  | { status: 'error' };

export type GetMyFirstVisitDayResult =
  // `day` is null when the member has no counted visit day (or is not a live member).
  | { status: 'success'; day: string | null }
  | { status: 'error' };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

export function parseVisitDays(data: unknown): VisitDay[] | null {
  if (!Array.isArray(data)) return null;
  const days: VisitDay[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') return null;
    const { visit_day, milestone } = row as Record<string, unknown>;
    if (!isDateOnly(visit_day)) return null;
    if (milestone !== null && milestone !== undefined && !(typeof milestone === 'number' && Number.isInteger(milestone))) return null;
    days.push({ visitDay: visit_day, milestone: typeof milestone === 'number' ? milestone : null });
  }
  return days;
}

/** The caller's distinct visit days in the gym-local month that starts on `month` (`YYYY-MM-DD`, the first of a month). */
export async function getMyVisitDays(month: string): Promise<GetMyVisitDaysResult> {
  try {
    const { data, error } = await supabase.rpc('my_visit_days', { p_month: month });
    if (error) {
      if (error.code === '22023' || error.message?.includes('invalid_month')) return { status: 'invalid_month' };
      return { status: 'error' };
    }
    const days = parseVisitDays(data);
    return days ? { status: 'success', days } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** The caller's earliest counted visit day, or null: the lower bound of the previous-month chevron. */
export async function getMyFirstVisitDay(): Promise<GetMyFirstVisitDayResult> {
  try {
    const { data, error } = await supabase.rpc('my_first_visit_day');
    if (error) return { status: 'error' };
    if (data === null || data === undefined) return { status: 'success', day: null };
    return isDateOnly(data) ? { status: 'success', day: data } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

export type GetMySavedWeeksResult =
  // `weeks` are the Mondays (`YYYY-MM-DD`) of the weeks a Shield saved that touch the month; empty for a month with none or a caller who is not a live member.
  | { status: 'success'; weeks: string[] }
  | { status: 'invalid_month' }
  | { status: 'error' };

export function parseSavedWeeks(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  const weeks: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') return null;
    const { week_start } = row as Record<string, unknown>;
    if (!isDateOnly(week_start)) return null;
    weeks.push(week_start);
  }
  return weeks;
}

/** Story 31.1 (MA-18): the Mondays of the caller's Shield-saved weeks that touch the gym-local month that starts on `month`
 * (`my_saved_weeks`, 0190_streak_shields_comeback.sql). Same shape and refusals as `getMyVisitDays`; the server decides which weeks are saved. */
export async function getMySavedWeeks(month: string): Promise<GetMySavedWeeksResult> {
  try {
    const { data, error } = await supabase.rpc('my_saved_weeks', { p_month: month });
    if (error) {
      if (error.code === '22023' || error.message?.includes('invalid_month')) return { status: 'invalid_month' };
      return { status: 'error' };
    }
    const weeks = parseSavedWeeks(data);
    return weeks ? { status: 'success', weeks } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
