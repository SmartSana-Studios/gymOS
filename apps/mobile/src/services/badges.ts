import { BADGE_CODES, isBadgeCode, type BadgeCode, type BadgeRow } from '@/lib/badgeCodes';
import { supabase } from '@/lib/supabase';

/** Story 31.3 (FR-230; MA-21): mobile service-layer wrapper over get_my_badges() (0192_badges.sql). Follows engagement.ts's typed-result-union,
 * never-throw shape. The RPC resolves the caller on the server, takes no argument, never writes and never awards (a read cannot award, AD-53). The
 * client has no Database generic, so every field of every row is parsed defensively and a malformed answer is an error, never a guess. */

export { BADGE_CODES, isBadgeCode, type BadgeCode, type BadgeRow };

export type GetMyBadgesResult =
  /** Exactly five rows in shelf order. */
  | { status: 'success'; badges: BadgeRow[] }
  /** The server returned no row: the caller is not a live member of an active gym. There is no shelf to draw. */
  | { status: 'unavailable' }
  | { status: 'error' };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function nonNegativeInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** The five rows in shelf order, or null for anything else (a wrong count, an unknown or repeated code, a bad field). */
export function parseBadges(data: unknown): BadgeRow[] | null {
  if (!Array.isArray(data) || data.length !== BADGE_CODES.length) return null;
  const rows: BadgeRow[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const raw = data[i];
    if (!raw || typeof raw !== 'object') return null;
    const { code, earned, earned_on, silent, visits_remaining, weeks_progress } = raw as Record<string, unknown>;
    if (code !== BADGE_CODES[i] || typeof earned !== 'boolean') return null;
    if (earned_on !== null && earned_on !== undefined && !(typeof earned_on === 'string' && DATE_ONLY.test(earned_on))) return null;
    if (silent !== null && silent !== undefined && typeof silent !== 'boolean') return null;
    const remaining = nonNegativeInt(visits_remaining);
    const progress = nonNegativeInt(weeks_progress);
    if (remaining === undefined || progress === undefined) return null;
    rows.push({
      code: BADGE_CODES[i],
      earned,
      earnedOn: typeof earned_on === 'string' ? earned_on : null,
      silent: silent === true,
      visitsRemaining: remaining,
      weeksProgress: progress,
    });
  }
  return rows;
}

/** The caller's five badges. Never throws. */
export async function getMyBadges(): Promise<GetMyBadgesResult> {
  try {
    const { data, error } = await supabase.rpc('get_my_badges');
    if (error) return { status: 'error' };
    if (Array.isArray(data) && data.length === 0) return { status: 'unavailable' };
    const badges = parseBadges(data);
    return badges ? { status: 'success', badges } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}
