import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { formatDayMonth, type TFn } from '@/lib/weeklyGoalSheet';
import { BADGE_CODES, isBadgeCode, type BadgeCode, type BadgeRow } from '@/lib/badgeCodes';

/** Story 31.3 (FR-230, FR-232; MA-21): everything the Badge Shelf decides, as plain functions: the five tiles in shelf order, the summary, the progress
 * line and the accessible label of every tile state, the detail sheet, the face the screen draws, and the device copy of the last load. Every string
 * comes from `t()` (wording is data in the locale files); the one date format goes through `formatDayMonth`. Nothing here derives a count: the
 * visits to go and the weeks of progress are the server's (`get_my_badges`). A locked tile never says "locked" as its only text, never shows a lock
 * and never reads "0 of N" (MA-21). */

const GLYPHS: Record<BadgeCode, MaterialIconsIconName> = {
  first_visit: 'flag',
  visits_7: 'looks-one',
  visits_30: 'local-fire-department',
  visits_100: 'military-tech',
  four_weeks: 'shield',
};

const NAME_KEYS: Record<BadgeCode, string> = {
  first_visit: 'engage.badges.first',
  visits_7: 'engage.badges.visits7',
  visits_30: 'engage.badges.visits30',
  visits_100: 'engage.badges.visits100',
  four_weeks: 'engage.badges.weeks4',
};

export function badgeGlyph(code: BadgeCode): MaterialIconsIconName {
  return GLYPHS[code];
}

export function badgeNameKey(code: BadgeCode): string {
  return NAME_KEYS[code];
}

export function earnedCount(rows: readonly BadgeRow[]): number {
  return rows.filter((row) => row.earned).length;
}

export interface BadgeTileView {
  code: BadgeCode;
  name: string;
  glyph: MaterialIconsIconName;
  earned: boolean;
  /** The one line under the name: "Earned 14 Oct" for an earned badge, the progress line for a locked one. */
  line: string;
  /** "14 Oct" for an earned badge (the stored historic date, also for a badge earned silently at release), else null. */
  dateText: string | null;
  /** What a screen reader reads: the name, earned or not, and the date or the progress. */
  accessibilityLabel: string;
}

/** The progress line of a locked badge. A visit badge that is unearned with nothing left to go (the next settle awards it) reads as one more visit
 * rather than "0 more visits to go". */
export function lockedLine(row: BadgeRow, t: TFn): string {
  if (row.code === 'first_visit') return t('engage.badges.locked.first');
  if (row.code === 'four_weeks') {
    const progress = row.weeksProgress ?? 0;
    return progress > 0 ? t('engage.badges.locked.weeksProgress', { n: progress }) : t('engage.badges.locked.weeks');
  }
  if (row.visitsRemaining === null) return '';
  return t('engage.badges.locked.visits', { count: Math.max(1, row.visitsRemaining) });
}

export function buildBadgeTile(row: BadgeRow, t: TFn, language: string): BadgeTileView {
  const name = t(badgeNameKey(row.code));
  if (row.earned) {
    const dateText = row.earnedOn ? formatDayMonth(row.earnedOn, language) : null;
    const line = dateText ? t('engage.badges.earnedOn', { date: dateText }) : '';
    return {
      code: row.code,
      name,
      glyph: badgeGlyph(row.code),
      earned: true,
      line,
      dateText,
      accessibilityLabel: dateText ? t('engage.badges.a11y.earned', { name, date: dateText }) : name,
    };
  }
  const line = lockedLine(row, t);
  return {
    code: row.code,
    name,
    glyph: badgeGlyph(row.code),
    earned: false,
    line,
    dateText: null,
    accessibilityLabel: line ? t('engage.badges.a11y.locked', { name, progress: line }) : name,
  };
}

export type ShelfLoad =
  | { kind: 'loading' }
  /** `fromCache`: the device's copy of the last good load (offline, or while the live read is still running). */
  | { kind: 'ready'; rows: BadgeRow[]; fromCache: boolean }
  | { kind: 'error' };

/** What a read of `get_my_badges` answered (the service's result union, restated here so this module needs no client). */
export type ShelfResult = { status: 'success'; badges: BadgeRow[] } | { status: 'unavailable' } | { status: 'error' };

/** The state after a load, once the device copy has been read and the live read has answered (`result` null: offline, no read was made).
 *   - a live success shows the live rows;
 *   - anything else (offline, a failed read, "not a live member") KEEPS what is already on screen when that is ready, else the device copy, else the
 *     error face: a failed refresh never replaces tiles the member is looking at with the error card. */
export function resolveShelfLoad(input: { cached: BadgeRow[] | null; connected: boolean; result: ShelfResult | null; current: ShelfLoad }): ShelfLoad {
  const { cached, connected, result, current } = input;
  if (connected && result && result.status === 'success') return { kind: 'ready', rows: result.badges, fromCache: false };
  if (current.kind === 'ready') return current;
  if (cached) return { kind: 'ready', rows: cached, fromCache: true };
  return { kind: 'error' };
}

/** The Profile row's rows after a read: live rows on success, else what the row already shows for THIS member, else this member's device copy, else
 * none. (The caller drops the rows of another member or gym before calling.) */
export function resolveBadgeRows(input: { cached: BadgeRow[] | null; connected: boolean; result: ShelfResult | null; current: BadgeRow[] | null }): BadgeRow[] | null {
  const { cached, connected, result, current } = input;
  if (connected && result && result.status === 'success') return result.badges;
  return current ?? cached;
}

/** Rows are kept with the member and gym they were read for (`"<userId>.<gymId>"`). Another member or gym, or no member, never gets them. */
export function rowsForMember(entry: { key: string; rows: BadgeRow[] } | null, memberKey: string | null): BadgeRow[] | null {
  return entry && memberKey !== null && entry.key === memberKey ? entry.rows : null;
}

/** The shelf starts again from the loading face whenever the member or gym it shows changes (the rows on screen are the previous member's). */
export function shouldResetShelf(previousKey: string | null, key: string | null): boolean {
  return previousKey !== key;
}

export type ShelfFace = 'loading' | 'tiles' | 'error';

export interface ShelfView {
  title: string;
  face: ShelfFace;
  /** "2 of 5 earned"; null unless the tiles are shown. */
  summary: string | null;
  tiles: BadgeTileView[];
  footnote: string;
  errorMessage: string;
}

export function buildShelfView(input: { load: ShelfLoad; t: TFn; language: string }): ShelfView {
  const { load, t, language } = input;
  const base = { title: t('engage.badges.title'), footnote: t('engage.badges.grantsNothing'), errorMessage: t('engage.badges.error') };
  if (load.kind === 'ready') {
    return {
      ...base,
      face: 'tiles',
      summary: t('engage.badges.summary', { n: earnedCount(load.rows), total: load.rows.length }),
      tiles: load.rows.map((row) => buildBadgeTile(row, t, language)),
    };
  }
  return { ...base, face: load.kind === 'loading' ? 'loading' : 'error', summary: null, tiles: [] };
}

export interface BadgeSheetView {
  code: BadgeCode;
  glyph: MaterialIconsIconName;
  earned: boolean;
  name: string;
  /** The date line for an earned badge ("Earned 14 Oct"), the progress line for a locked one. */
  line: string;
  /** Share only for an earned badge, and only while sharing is not known to be unavailable on this phone. */
  showShare: boolean;
  shareLabel: string;
  closeLabel: string;
}

export function buildSheetView(tile: BadgeTileView, t: TFn, shareAvailable: boolean): BadgeSheetView {
  return {
    code: tile.code,
    glyph: tile.glyph,
    earned: tile.earned,
    name: tile.name,
    line: tile.line,
    showShare: tile.earned && shareAvailable,
    shareLabel: t('engage.celebration.cta.share'),
    closeLabel: t('engage.badges.sheet.close'),
  };
}

/** The Profile row's value, "2 of 5" (`engage.profile.badges.value`); null while nothing is known (the row shows no value). */
export function profileBadgesValue(rows: readonly BadgeRow[] | null, t: TFn): string | null {
  return rows ? t('engage.profile.badges.value', { n: earnedCount(rows), total: rows.length }) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The device copy (`gymos.badges.v1.<userId>.<gymId>`): the last good load, shown offline. Versioned and fail-safe: anything unreadable is "no copy".
// ---------------------------------------------------------------------------------------------------------------------------------------------

const STORE_PREFIX = 'gymos.badges.v1.';
const STORE_VERSION = 1;

export function badgesStoreKey(userId: string, gymId: string): string {
  return `${STORE_PREFIX}${userId}.${gymId}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function intOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** The five rows in shelf order, or null for anything else. */
export function parseStoredBadges(raw: unknown): BadgeRow[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const { version, rows } = raw as { version?: unknown; rows?: unknown };
  if (version !== STORE_VERSION || !Array.isArray(rows) || rows.length !== BADGE_CODES.length) return null;
  const out: BadgeRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') return null;
    const { code, earned, earnedOn, silent, visitsRemaining, weeksProgress } = row as Record<string, unknown>;
    if (!isBadgeCode(code) || code !== BADGE_CODES[i] || typeof earned !== 'boolean' || typeof silent !== 'boolean') return null;
    if (earnedOn !== null && !(typeof earnedOn === 'string' && DATE_ONLY.test(earnedOn))) return null;
    const remaining = intOrNull(visitsRemaining);
    const progress = intOrNull(weeksProgress);
    if (remaining === undefined || progress === undefined) return null;
    out.push({ code, earned, earnedOn: earnedOn as string | null, silent, visitsRemaining: remaining, weeksProgress: progress });
  }
  return out;
}

export async function readBadgesCache(userId: string, gymId: string): Promise<BadgeRow[] | null> {
  try {
    const raw = await AsyncStorage.getItem(badgesStoreKey(userId, gymId));
    return raw ? parseStoredBadges(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Returns false when the copy could not be stored. */
export async function writeBadgesCache(userId: string, gymId: string, rows: readonly BadgeRow[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(badgesStoreKey(userId, gymId), JSON.stringify({ version: STORE_VERSION, rows }));
    return true;
  } catch {
    return false;
  }
}

/** Sign-out: forgets every member's copy on this device (like `clearShown`). Never throws. */
export async function clearBadgesCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(STORE_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best effort: nothing here may block a sign-out.
  }
}
