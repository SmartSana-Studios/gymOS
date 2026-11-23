import AsyncStorage from '@react-native-async-storage/async-storage';

import { formatDayMonth, type TFn } from '@/lib/weeklyGoalSheet';
import type { Engagement, GetMyEngagementResult, OpenEngagementResult } from '@/services/engagement';

/** Story 30.4 (FR-219, FR-220, FR-224, FR-232; MA-09 amendment N1): the pure view model of the Home "This week" section. The card and the ring
 * render only what this module returns. Every string comes from `t()` (wording is data in the locale files, so a test can swap a catalog value for a
 * sentinel and find it here), and every number is the server's: `visitsThisWeek`, `goal`, `streakWeeks`, `streakIfMet`, `visitsNeeded`,
 * `atRiskWeekly`. This module imports no date library and does no week or day arithmetic; the only time arithmetic is an instant minus an instant
 * (hours left, and the offline cut-off), done with the server's own timestamps and an offset that corrects the phone clock. */

export const RING_DIAMETER = 120;
export const RING_STROKE = 12;
export const RING_GAP_DEGREES = 8;
/** The skeleton never shows longer than this (a first fetch with no cache, or a settle). */
export const SKELETON_MAX_MS = 2000;
/** The hours left are recomputed this often while Home is focused. */
export const TICK_MS = 60_000;
/** Below this window width, or above this font scale, the card stacks the ring above the text. */
export const STACK_MAX_WIDTH = 360;
export const STACK_MIN_FONT_SCALE = 1.3;

export function shouldStack(windowWidth: number, fontScale: number): boolean {
  return windowWidth < STACK_MAX_WIDTH || fontScale > STACK_MIN_FONT_SCALE;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Hours left
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** Milliseconds left in the gym's day, or null when it has ended. The phone clock may be wrong or travelling: at fetch time the offset between the
 * server's clock and the phone's is taken (`offset = serverNow - fetchedAtDeviceMs`), so `now = deviceNow + offset` runs on the server's clock. */
export function msLeftInDay(row: Pick<Engagement, 'serverNow' | 'dayEndsAt'>, fetchedAtDeviceMs: number, deviceNowMs: number): number | null {
  const offset = Date.parse(row.serverNow) - fetchedAtDeviceMs;
  const left = Date.parse(row.dayEndsAt) - (deviceNowMs + offset);
  return Number.isFinite(left) && left > 0 ? left : null;
}

export type TimeLeft = { unit: 'hours'; value: number } | { unit: 'minutes'; value: number };

/** Whole hours from 60 minutes up (floored, so 60 to 119 minutes reads "1 hour left"), minutes below, at least one. */
export function timeLeftParts(leftMs: number): TimeLeft {
  const minutes = Math.floor(leftMs / 60_000);
  if (minutes >= 60) return { unit: 'hours', value: Math.floor(minutes / 60) };
  return { unit: 'minutes', value: Math.max(1, minutes) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Ring geometry and segments
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type SegmentKind = 'filled' | 'success' | 'dashed' | 'empty';

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One SVG arc path per segment of a ring of `goal` equal segments with a gap between them, starting at twelve o'clock and running clockwise. A
 * ring of one segment is a full circle with no gap. */
export function arcPaths(goal: number, diameter = RING_DIAMETER, stroke = RING_STROKE, gapDegrees = RING_GAP_DEGREES): string[] {
  const centre = diameter / 2;
  const radius = (diameter - stroke) / 2;
  const span = 360 / goal;
  const gap = goal === 1 ? 0 : gapDegrees;
  const point = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${round(centre + radius * Math.cos(radians))} ${round(centre + radius * Math.sin(radians))}`;
  };
  return Array.from({ length: goal }, (_, i) => {
    const start = -90 + i * span + gap / 2;
    // An SVG arc cannot start and end on the same point, so a full circle stops a hair short.
    const sweep = Math.min(span - gap, 359.99);
    const end = start + sweep;
    return `M ${point(start)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${point(end)}`;
  });
}

/** The segments of the ring: the first `min(visits, goal)` filled (all `success` once the goal is met), then one dashed segment per scan queued on
 * this device (capped so filled plus dashed never exceeds the goal), then empty ones. */
export function buildSegments(goal: number, visits: number, goalMet: boolean, queuedScans: number): SegmentKind[] {
  if (goalMet) return Array.from({ length: goal }, () => 'success' as const);
  const filled = Math.min(Math.max(visits, 0), goal);
  const dashed = Math.min(Math.max(queuedScans, 0), goal - filled);
  return Array.from({ length: goal }, (_, i): SegmentKind => (i < filled ? 'filled' : i < filled + dashed ? 'dashed' : 'empty'));
}

/** Scans queued on this device at or after the cached `dayStartsAt`. The two strings are compared as instants (no time zone arithmetic); a scan
 * from an earlier day lights its own day after it syncs. */
export function queuedTodayCount(dayStartsAt: string, scannedAt: readonly string[]): number {
  const start = Date.parse(dayStartsAt);
  if (!Number.isFinite(start)) return 0;
  return scannedAt.filter((value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= start;
  }).length;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The load sequence
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface EngagementLoadDeps {
  getMyEngagement: () => Promise<GetMyEngagementResult>;
  openEngagement: () => Promise<OpenEngagementResult>;
}

export type EngagementLoadOutcome =
  /** `settleFailed`: the row has something to settle and the one settle call did not succeed, so the row is the one read before it. */
  | { kind: 'row'; engagement: Engagement; settleFailed: boolean }
  /** Nothing to show: the epoch is not set (`engagement` is that row, for the cache) or the caller is not a live member. */
  | { kind: 'dark'; engagement: Engagement | null }
  /** The read failed (offline or a server error). */
  | { kind: 'failed' };

/** One focus (or one pull to refresh): read the row, and when it says `needsSettle`, ONE `openEngagement()` whose returned row is rendered as it is.
 * Never a loop on the flag, so a settle that keeps failing, or a flag that stays true, costs one call per focus. */
export async function loadEngagement(deps: EngagementLoadDeps): Promise<EngagementLoadOutcome> {
  const read = await deps.getMyEngagement();
  if (read.status === 'unavailable') return { kind: 'dark', engagement: null };
  if (read.status !== 'success') return { kind: 'failed' };
  const row = read.engagement;
  if (!row.enabled) return { kind: 'dark', engagement: row };
  if (!row.needsSettle) return { kind: 'row', engagement: row, settleFailed: false };

  const settled = await deps.openEngagement();
  if (settled.status === 'success') {
    return settled.engagement.enabled ? { kind: 'row', engagement: settled.engagement, settleFailed: false } : { kind: 'dark', engagement: settled.engagement };
  }
  if (settled.status === 'unavailable') return { kind: 'dark', engagement: null };
  return { kind: 'row', engagement: row, settleFailed: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The device cache
// ---------------------------------------------------------------------------------------------------------------------------------------------

// Last good row per member and gym, with the phone clock at the moment it arrived (the offset of the hours left). Same fail-open pattern as
// services/loyaltySeen.ts: a storage failure is "no cache".
const CACHE_KEY_PREFIX = 'gymos.engageHome.v1.';

export interface CachedEngagement {
  engagement: Engagement;
  fetchedAtDeviceMs: number;
}

export function engagementCacheKey(userId: string, gymId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}.${gymId}`;
}

type FieldKind = 'boolean' | 'int' | 'string' | 'nullableInt' | 'nullableString';
const ENGAGEMENT_FIELDS: Record<keyof Engagement, FieldKind> = {
  enabled: 'boolean',
  gymToday: 'string',
  weekStart: 'string',
  weekEnd: 'string',
  inReleaseWeek: 'boolean',
  goal: 'int',
  goalIsDefault: 'boolean',
  pendingGoal: 'nullableInt',
  pendingEffectiveWeek: 'nullableString',
  visitsThisWeek: 'int',
  goalMet: 'boolean',
  visitedToday: 'boolean',
  streakWeeks: 'int',
  streakIfMet: 'nullableInt',
  bestStreakWeeks: 'int',
  hasSettledWeek: 'boolean',
  daysLeftInWeek: 'int',
  visitsNeeded: 'int',
  atRiskWeekly: 'boolean',
  atRiskDaily: 'boolean',
  dailyRun: 'nullableInt',
  shieldsHeld: 'int',
  comebackState: 'string',
  dayStartsAt: 'string',
  dayEndsAt: 'string',
  serverNow: 'string',
  needsSettle: 'boolean',
  pendingMilestone: 'nullableInt',
};

function fieldMatches(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'int':
      return typeof value === 'number' && Number.isInteger(value);
    case 'nullableInt':
      return value === null || (typeof value === 'number' && Number.isInteger(value));
    case 'string':
      return typeof value === 'string';
    case 'nullableString':
      return value === null || typeof value === 'string';
  }
}

/** True when `value` has every field of an Engagement with the right type (a stored row from an older or damaged write is "no cache"). */
export function isEngagement(value: unknown): value is Engagement {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  // The ring divides by the goal: a stored row outside the 1 to 7 range is no cache.
  if (typeof record.goal !== 'number' || !Number.isInteger(record.goal) || record.goal < 1 || record.goal > 7) return false;
  const typed = (Object.keys(ENGAGEMENT_FIELDS) as (keyof Engagement)[]).every((key) => fieldMatches(ENGAGEMENT_FIELDS[key], record[key]));
  return typed && ['serverNow', 'dayStartsAt', 'dayEndsAt'].every((key) => Number.isFinite(Date.parse(record[key] as string)));
}

export async function readEngagementCache(userId: string, gymId: string): Promise<CachedEngagement | null> {
  try {
    const raw = await AsyncStorage.getItem(engagementCacheKey(userId, gymId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { engagement?: unknown; fetchedAtDeviceMs?: unknown } | null;
    if (!parsed || !isEngagement(parsed.engagement) || typeof parsed.fetchedAtDeviceMs !== 'number' || !Number.isFinite(parsed.fetchedAtDeviceMs)) return null;
    return { engagement: parsed.engagement, fetchedAtDeviceMs: parsed.fetchedAtDeviceMs };
  } catch {
    return null;
  }
}

/** Returns false when the row could not be stored. */
export async function writeEngagementCache(userId: string, gymId: string, engagement: Engagement, fetchedAtDeviceMs: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(engagementCacheKey(userId, gymId), JSON.stringify({ engagement, fetchedAtDeviceMs }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** The row on screen, with the phone clock at the moment it was received (live) or stored (cache). */
export interface EngagementSnapshot {
  engagement: Engagement;
  fetchedAtDeviceMs: number;
  fromCache: boolean;
}

export interface HomeEngagementInput {
  snapshot: EngagementSnapshot | null;
  /** The server said the area is dark for this member (epoch not set, or not a live member). */
  dark: boolean;
  /** A read or a settle is running. */
  busy: boolean;
  /** `busy` has lasted SKELETON_MAX_MS. */
  skeletonExpired: boolean;
  /** What the device cache says about `enabled`; null when there is no cache. */
  cachedEnabled: boolean | null;
  /** The last read failed. */
  loadFailed: boolean;
  /** The phone is offline, or the last read failed: queued scans are overlaid and the hint follows the device clock. */
  offline: boolean;
  settleFailed: boolean;
  /** `scannedAt` of every scan queued on this device (device-wide). */
  queuedScanTimes: readonly string[];
  goalHintSeen: boolean;
  deviceNowMs: number;
  t: TFn;
  /** `en` or `fr`; anything else formats as English. */
  language: string;
}

export type StreakView =
  | { kind: 'none' }
  | { kind: 'chip'; label: string }
  /** 0 streak with a best of at least one: a muted line in place of the chip. */
  | { kind: 'best'; label: string }
  | { kind: 'firstWeek'; label: string };

export interface HintView {
  /** `engage.atRisk.weekly`: never changes while the hint shows (it is what a live region announces). */
  text: string;
  /** "6 hours left" / "40 min left": recomputed every minute. */
  timeLeft: string;
  /** `text` and `timeLeft` as one sentence. */
  label: string;
}

export interface RingView {
  goal: number;
  /** The centre numeral "V / G": visits beyond the goal add nothing. */
  centre: string;
  unit: string;
  met: boolean;
  segments: SegmentKind[];
  accessibilityLabel: string;
  accessibilityValue: { min: number; max: number; now: number };
}

export interface CardView {
  kind: 'card';
  title: string;
  goalButton: { label: string; pending: boolean };
  /** The one-time hint under the goal button. */
  goalHint: string | null;
  ring: RingView;
  streak: StreakView;
  captionKey: string;
  caption: string;
  /** `engage.ring.pendingSync` while dashed segments show. */
  pendingSyncNote: string | null;
  hint: HintView | null;
  settleError: string | null;
}

export type HomeEngagementView =
  | { kind: 'hidden' }
  | { kind: 'skeleton'; title: string }
  | { kind: 'error'; title: string; message: string }
  | CardView;

interface Caption {
  key: string;
  options?: Record<string, unknown>;
}

function captionFor(row: Engagement): Caption {
  if (row.inReleaseWeek) return { key: 'engage.streak.startsMonday' };
  if (row.goalMet) {
    const extra = row.visitsThisWeek - row.goal;
    if (extra > 0) return { key: 'engage.ring.caption.extra', options: { count: extra } };
    if (row.streakIfMet !== null) return { key: 'engage.ring.caption.metStreak', options: { count: row.streakIfMet } };
    return { key: 'engage.ring.caption.met' };
  }
  const needed = Math.max(1, row.visitsNeeded);
  if (row.visitsThisWeek === 0) return { key: 'engage.ring.caption.fresh', options: { count: needed } };
  return { key: 'engage.ring.caption.progress', options: { count: needed } };
}

function streakFor(row: Engagement, t: TFn): StreakView {
  if (row.inReleaseWeek) return { kind: 'none' };
  // A member with no settled week has no streak to show, and a bare zero is never shown.
  if (!row.hasSettledWeek) {
    // A closed ring beside "close your ring to start" would contradict itself.
    if (row.goalMet) return { kind: 'none' };
    return { kind: 'firstWeek', label: t('engage.streak.firstWeek') };
  }
  if (row.streakWeeks >= 2) return { kind: 'chip', label: t('engage.streak.weeks', { count: row.streakWeeks }) };
  if (row.streakWeeks === 1) return { kind: 'chip', label: t('engage.streak.first') };
  if (row.bestStreakWeeks >= 1) return { kind: 'best', label: t('engage.streak.best', { count: row.bestStreakWeeks }) };
  return { kind: 'none' };
}

function hintFor(snapshot: EngagementSnapshot, overlay: boolean, queued: number, deviceNowMs: number, t: TFn): HintView | null {
  const row = snapshot.engagement;
  // A visit already queued on this phone today is the visit the hint asks for.
  if (overlay && queued > 0) return null;
  // Never in the release week, never once the goal is met. The server returns false for an expired member; a stale cache must not say otherwise.
  if (row.inReleaseWeek || row.goalMet || !row.atRiskWeekly) return null;
  // Offline, or a cached row: only while the phone's own clock is still before the cached end of that gym day.
  if (overlay && !(deviceNowMs < Date.parse(row.dayEndsAt))) return null;
  const left = msLeftInDay(row, snapshot.fetchedAtDeviceMs, deviceNowMs);
  if (left === null) return null;
  const parts = timeLeftParts(left);
  const timeLeft = parts.unit === 'hours' ? t('engage.atRisk.hoursLeft', { count: parts.value }) : t('engage.atRisk.minutesLeft', { m: parts.value });
  const text = t('engage.atRisk.weekly');
  return { text, timeLeft, label: `${text} ${timeLeft}` };
}

/** Which of the section's four faces shows, and everything the card needs for the face that is a card. */
export function buildHomeEngagementView(input: HomeEngagementInput): HomeEngagementView {
  const { snapshot, t, language } = input;
  const title = t('engage.ring.title');

  if (input.dark) return { kind: 'hidden' };

  if (!snapshot) {
    // A cache that says dark means this gym has no epoch: a failed read must not turn Home into an error card for a member who never had a card.
    if (input.cachedEnabled === false) return { kind: 'hidden' };
    if (input.loadFailed) return { kind: 'error', title, message: t('engage.home.error') };
    if (!input.busy) return { kind: 'hidden' };
    // A cache that says enabled promises a card, so the skeleton holds the place for the whole read; with no cache the member is waiting on a card
    // that may never come (the epoch is dark for most gyms), so it shows for two seconds at most.
    if (input.cachedEnabled === true || (input.cachedEnabled === null && !input.skeletonExpired)) return { kind: 'skeleton', title };
    return { kind: 'hidden' };
  }

  const row = snapshot.engagement;
  if (!row.enabled) return { kind: 'hidden' };
  if (input.busy && row.needsSettle && !input.skeletonExpired) return { kind: 'skeleton', title };

  const overlay = input.offline || snapshot.fromCache;
  const queued = overlay && !row.goalMet && !row.inReleaseWeek ? queuedTodayCount(row.dayStartsAt, input.queuedScanTimes) : 0;
  const segments = buildSegments(row.goal, row.visitsThisWeek, row.goalMet, queued);
  const dashed = segments.filter((s) => s === 'dashed').length;

  const shown = Math.min(row.visitsThisWeek, row.goal);
  const caption = captionFor(row);
  const pendingGoal = row.pendingGoal !== null && row.pendingEffectiveWeek !== null;

  return {
    kind: 'card',
    title,
    goalButton: pendingGoal
      ? { label: t('engage.ring.goalPending', { count: row.pendingGoal, date: formatDayMonth(row.pendingEffectiveWeek as string, language) }), pending: true }
      : { label: t('engage.ring.goalLabel', { count: row.goal }), pending: false },
    goalHint: row.goalIsDefault && !input.goalHintSeen ? t('engage.ring.goalHint.default', { count: row.goal }) : null,
    ring: {
      goal: row.goal,
      centre: `${shown} / ${row.goal}`,
      unit: t('engage.ring.unit'),
      met: row.goalMet,
      segments,
      accessibilityLabel: row.goalMet
        ? t('engage.ring.a11y.met', { goal: row.goal })
        : t('engage.ring.a11y.progress', { visits: row.visitsThisWeek, goal: row.goal, count: Math.max(1, row.visitsNeeded) }),
      // A progressbar's value never exceeds its maximum: visits beyond the goal read as a full ring.
      accessibilityValue: { min: 0, max: row.goal, now: shown },
    },
    streak: streakFor(row, t),
    captionKey: caption.key,
    caption: t(caption.key, caption.options),
    pendingSyncNote: dashed > 0 ? t('engage.ring.pendingSync', { count: dashed }) : null,
    hint: hintFor(snapshot, overlay, queued, input.deviceNowMs, t),
    settleError: input.settleFailed ? t('engage.home.settleError') : null,
  };
}
