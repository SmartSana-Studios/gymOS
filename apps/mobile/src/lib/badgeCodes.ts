/** Story 31.3: the five badge codes and the row the shelf reads, as a pure module (no client import), so the view models and the share image can use
 * them in a test without the Supabase client. `services/badges.ts` re-exports them. */

export const BADGE_CODES = ['first_visit', 'visits_7', 'visits_30', 'visits_100', 'four_weeks'] as const;
export type BadgeCode = (typeof BADGE_CODES)[number];

export function isBadgeCode(value: unknown): value is BadgeCode {
  return typeof value === 'string' && (BADGE_CODES as readonly string[]).includes(value);
}

export interface BadgeRow {
  code: BadgeCode;
  earned: boolean;
  /** Gym-local day `YYYY-MM-DD` the badge was earned; null while unearned. */
  earnedOn: string | null;
  /** Earned by the release back-fill. Shown exactly like any earned badge. */
  silent: boolean;
  /** Visits to go for the three visit badges while unearned (never negative); null for first_visit and for an earned badge. */
  visitsRemaining: number | null;
  /** 0 to 3 weeks of the current run toward the first Shield, for four_weeks while unearned; null otherwise. 0 means no run started. */
  weeksProgress: number | null;
}
