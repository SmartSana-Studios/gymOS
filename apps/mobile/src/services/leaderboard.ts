import { isGymSuspendedError } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Story 30.6 (FR-226, FR-227, FR-228, NFR-027; MA-19, MA-12, MA-09 N3): mobile service-layer wrapper over the four leaderboard RPCs of
 * 0188_gym_leaderboard.sql: gym_leaderboard(p_month), my_leaderboard_settings(), set_leaderboard_visibility(p_hidden) and
 * mark_leaderboard_notice_seen(). Follows visitDays.ts and weeklyGoal.ts's typed-result-union, never-throw shape. Every RPC resolves the caller on
 * the server and none takes a member id. The preference columns are written ONLY through the two writers (a direct UPDATE is refused by a trigger),
 * and attendance is never read here. The returned rows are untyped (the client has no Database generic), so every field is parsed defensively and a
 * malformed row is an error, never a guess. The server alone decides who is "Anonymous" and builds every label, rank, tie and total: this file only
 * carries what it sent. */

/** One row of the board, as the server sent it. A board of fewer than 3 ranked members is ONE row whose `position`, `rank`, `label` and `visits` are
 * null (so nobody can be identified by elimination); only `rankedTotal` and `selfRanked` mean anything on it. */
export interface LeaderboardRow {
  /** 1-based place in the full order (lets the screen draw the separator where positions are not consecutive); null on the fewer-than-3 row. */
  position: number | null;
  rank: number | null;
  /** The label as OTHER members see it ("CHANTAL N." or the literal 'Anonymous'); null on the fewer-than-3 row. */
  label: string | null;
  isAnonymous: boolean;
  visits: number | null;
  isSelf: boolean;
  isTied: boolean;
  /** Set on the caller's row only: the visits of the position above minus the caller's (0 when level, null when first). */
  visitsBehind: number | null;
  rankedTotal: number;
  selfRanked: boolean;
}

export interface LeaderboardSettings {
  /** The stored choice: true means "Appear as Anonymous". */
  hidden: boolean;
  noticeSeen: boolean;
  /** The label the server would show the caller IF visible ("MIREILLE K."): the caller's own name, on the caller's own device. */
  ownLabel: string;
}

export type GetGymLeaderboardResult =
  | { status: 'success'; rows: LeaderboardRow[] }
  // The server returned no row: the caller is not a live member of an active gym.
  | { status: 'unavailable' }
  | { status: 'invalid_month' }
  | { status: 'error' };

export type GetMyLeaderboardSettingsResult =
  | { status: 'success'; settings: LeaderboardSettings }
  | { status: 'unavailable' }
  | { status: 'error' };

export type LeaderboardWriteResult = { status: 'success' } | { status: 'gym_suspended' } | { status: 'error' };

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || isInt(value);
}

/** Maps PostgREST rows to LeaderboardRow[]; null when anything is malformed. An empty list is valid (an empty list means "not a live member"). The
 * two row forms are checked as forms: a detail row has a position, a rank, a label and visits (all of them), the fewer-than-3 row has none of them. */
export function parseLeaderboardRows(data: unknown): LeaderboardRow[] | null {
  if (!Array.isArray(data)) return null;
  const rows: LeaderboardRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!isNullableInt(r.position) || !isNullableInt(r.rank) || !isNullableInt(r.visits) || !isNullableInt(r.visits_behind)) return null;
    if (r.label !== null && typeof r.label !== 'string') return null;
    if (typeof r.is_anonymous !== 'boolean' || typeof r.is_self !== 'boolean' || typeof r.is_tied !== 'boolean' || typeof r.self_ranked !== 'boolean') return null;
    if (!isInt(r.ranked_total) || r.ranked_total < 0) return null;
    const detail = [r.position, r.rank, r.label, r.visits].map((v) => v !== null);
    if (!(detail.every(Boolean) || !detail.some(Boolean))) return null;
    rows.push({
      position: r.position,
      rank: r.rank,
      label: r.label,
      isAnonymous: r.is_anonymous,
      visits: r.visits,
      isSelf: r.is_self,
      isTied: r.is_tied,
      visitsBehind: r.visits_behind,
      rankedTotal: r.ranked_total,
      selfRanked: r.self_ranked,
    });
  }
  return rows;
}

export function parseLeaderboardSettings(data: unknown): LeaderboardSettings | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.hidden !== 'boolean' || typeof r.notice_seen !== 'boolean' || typeof r.own_label !== 'string') return null;
  return { hidden: r.hidden, noticeSeen: r.notice_seen, ownLabel: r.own_label };
}

/** The board of the caller's gym for the gym-local month that starts on `month` (`YYYY-MM-DD`: the gym's current month or the previous one; the
 * caller builds it from the server's own `gymToday`, never from the phone). */
export async function getGymLeaderboard(month: string): Promise<GetGymLeaderboardResult> {
  try {
    const { data, error } = await supabase.rpc('gym_leaderboard', { p_month: month });
    if (error) {
      if (error.code === '22023' || error.message?.includes('invalid_month')) return { status: 'invalid_month' };
      return { status: 'error' };
    }
    const rows = parseLeaderboardRows(data);
    if (!rows) return { status: 'error' };
    return rows.length === 0 ? { status: 'unavailable' } : { status: 'success', rows };
  } catch {
    return { status: 'error' };
  }
}

/** The caller's stored choice, whether the first-open notice has been chosen on, and the preview of their own label. */
export async function getMyLeaderboardSettings(): Promise<GetMyLeaderboardSettingsResult> {
  try {
    const { data, error } = await supabase.rpc('my_leaderboard_settings');
    if (error) return { status: 'error' };
    if (Array.isArray(data) && data.length === 0) return { status: 'unavailable' };
    const settings = parseLeaderboardSettings(data);
    return settings ? { status: 'success', settings } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Writes the caller's choice. `hidden: true` is "Appear as Anonymous". Never touches the notice. */
export async function setLeaderboardVisibility(hidden: boolean): Promise<LeaderboardWriteResult> {
  try {
    const { error } = await supabase.rpc('set_leaderboard_visibility', { p_hidden: hidden });
    if (error) return isGymSuspendedError(error) ? { status: 'gym_suspended' } : { status: 'error' };
    return { status: 'success' };
  } catch {
    return { status: 'error' };
  }
}

/** Marks the first-open notice as chosen on (idempotent on the server). Opening the leaderboard never calls this: only a button of the notice. */
export async function markLeaderboardNoticeSeen(): Promise<LeaderboardWriteResult> {
  try {
    const { error } = await supabase.rpc('mark_leaderboard_notice_seen');
    if (error) return isGymSuspendedError(error) ? { status: 'gym_suspended' } : { status: 'error' };
    return { status: 'success' };
  } catch {
    return { status: 'error' };
  }
}

/** The caller's gym name, for the screen header and the notice. The gym is named by id: a member of two gyms can read both rows, and an unfiltered
 * single-row read would then fail and leave the name blank. Null when it cannot be read. */
export async function getMyGymName(gymId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('gyms').select('name').eq('id', gymId).maybeSingle();
    if (error || !data || typeof data.name !== 'string' || data.name.trim() === '') return null;
    return data.name;
  } catch {
    return null;
  }
}
