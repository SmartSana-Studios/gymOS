import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildMonthGrid, isDateOnly, monthStartOf } from '@/lib/calendarGrid';
import type { TFn } from '@/lib/weeklyGoalSheet';
import type { EngagementLoadOutcome } from '@/lib/weeklyRing';
import type { AcknowledgeMilestoneResult } from '@/services/milestones';

/** Story 30.7 (FR-229, FR-232; MA-20): everything the milestone celebration decides, as plain functions. The screen, the Home hook and the services
 * stay thin: which milestone to show, the device's record of what was shown, the motion plan, the label keys and the mini month. Every string comes from
 * `t()` (wording is data in the locale files). Nothing here derives a date or a count: the milestone number is the server's `pending_milestone`, the
 * month is built from the gym-local day the server returned, and the lit days are the server's `my_visit_days`. */

export const MILESTONES = [7, 30, 100] as const;

export function isMilestone(value: unknown): value is number {
  return typeof value === 'number' && (MILESTONES as readonly number[]).includes(value);
}

/** The route parameter `milestoneId`: exactly 7, 30 or 100. Anything else (an unknown number, an array, nothing) is null and the route opens Home. */
export function parseMilestoneParam(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^(7|30|100)$/.test(raw)) return null;
  return Number(raw);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Which milestone to celebrate
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** The server's pending milestone from a LIVE engagement read: only an outcome of kind `row` (never the device copy, never a dark or failed read).
 * The cached row's `pendingMilestone` is stale by construction and is never read here. */
export function pendingFromOutcome(outcome: EngagementLoadOutcome | null): number | null {
  if (!outcome || outcome.kind !== 'row') return null;
  const pending = outcome.engagement.pendingMilestone;
  return isMilestone(pending) ? pending : null;
}

/** Home's own state allows a celebration: it has painted (not the first-load spinner), has no load error, and the plan is not expired (an expired member
 * is held by the root guards and is never celebrated to). */
export function homeReadyForCelebration(input: { loading: boolean; loadError: boolean; subscriptionStatus: string | null }): boolean {
  return !input.loading && !input.loadError && input.subscriptionStatus !== 'expired';
}

/** The push is due: there is a milestone to show (and the gym-local day for its mini month), Home is ready and Home is focused. The caller starts the
 * 600 ms timer when this is true and cancels it when it turns false (blur, unmount). */
export function celebrationDue(input: { milestone: number | null; today: string | null; ready: boolean; focused: boolean }): boolean {
  return input.milestone !== null && input.today !== null && input.ready && input.focused;
}

export interface ShownEntry {
  /** The highest milestone the member has seen close on this device. */
  milestone: number;
  /** The server has acknowledged it (or refused for good). False: retried silently on each Home load. */
  acked: boolean;
}

export type ShownRead =
  | { kind: 'none' }
  | { kind: 'entry'; entry: ShownEntry }
  /** The store cannot be read: fail closed, nothing is celebrated, so a broken store can never show a celebration twice. */
  | { kind: 'unreadable' };

/** The milestone to push over Home, or null. A number the device has already shown (this one or a higher one) is not shown again, whatever the server
 * still says: the server flag may simply not have landed yet. Only a number that is a milestone is shown. */
export function chooseMilestone(pending: number | null, shown: ShownRead): number | null {
  if (!isMilestone(pending)) return null;
  if (shown.kind === 'unreadable') return null;
  if (shown.kind === 'entry' && shown.entry.milestone >= pending) return null;
  return pending;
}

/** The route opens Home instead of the celebration when its number is not a milestone, or the device has already shown it, or the store is unreadable. */
export function shouldOpenHome(milestone: number | null, shown: ShownRead): boolean {
  return milestone === null || chooseMilestone(milestone, shown) === null;
}

/** The milestone a Home load re-acknowledges silently: the one shown whose acknowledgement has not landed. */
export function retryTarget(shown: ShownRead): number | null {
  return shown.kind === 'entry' && !shown.entry.acked && isMilestone(shown.entry.milestone) ? shown.entry.milestone : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The device record of what was shown (`gymos.celebration.v1.<userId>.<gymId>`)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const STORE_PREFIX = 'gymos.celebration.v1.';

export function celebrationStoreKey(userId: string, gymId: string): string {
  return `${STORE_PREFIX}${userId}.${gymId}`;
}

function parseEntry(value: unknown): ShownEntry | null {
  if (!value || typeof value !== 'object') return null;
  const { milestone, acked } = value as Record<string, unknown>;
  return isMilestone(milestone) && typeof acked === 'boolean' ? { milestone, acked } : null;
}

/** Fail closed, like services/loyaltySeen.ts: a storage failure is `unreadable` (nothing is celebrated); a corrupt value is `none`, so the next write
 * replaces it. */
export async function readShown(userId: string, gymId: string): Promise<ShownRead> {
  try {
    const raw = await AsyncStorage.getItem(celebrationStoreKey(userId, gymId));
    if (!raw) return { kind: 'none' };
    const entry = parseEntry(JSON.parse(raw));
    return entry ? { kind: 'entry', entry } : { kind: 'none' };
  } catch (error) {
    return error instanceof SyntaxError ? { kind: 'none' } : { kind: 'unreadable' };
  }
}

/** Returns false when the entry could not be stored. */
export async function writeShown(userId: string, gymId: string, entry: ShownEntry): Promise<boolean> {
  try {
    await AsyncStorage.setItem(celebrationStoreKey(userId, gymId), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

/** Marks `milestone` acknowledged, only when it is still the entry on the device: a retry that finishes after a higher milestone was shown must not
 * overwrite that newer entry (which would let it show again). */
export async function markShownAcked(userId: string, gymId: string, milestone: number): Promise<boolean> {
  const current = await readShown(userId, gymId);
  if (current.kind !== 'entry' || current.entry.milestone !== milestone) return false;
  return writeShown(userId, gymId, { milestone, acked: true });
}

/** Sign-out: forgets every member's record on this device (the store is keyed by user and gym, and there is no gym-switch flow in the app, so a
 * sign-out is the only moment a record becomes someone else's). Never throws. */
export async function clearShown(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(STORE_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best effort: nothing here may block a sign-out.
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Closing: store first, then the server
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** A result no retry can improve: the server accepted it, or refused it for good. A suspended gym and a transient error are retried later. */
export function ackSettled(result: AcknowledgeMilestoneResult): boolean {
  return result.status === 'success' || (result.status === 'error' && !result.retryable);
}

export interface CloseDeps {
  writeShown: (userId: string, gymId: string, entry: ShownEntry) => Promise<boolean>;
  markShownAcked: (userId: string, gymId: string, milestone: number) => Promise<boolean>;
  acknowledge: (milestone: number) => Promise<AcknowledgeMilestoneResult>;
}

/** [Keep going] and Android back. The record is written BEFORE the acknowledge call, so a failed call can only delay the server flag, never show the
 * celebration again. The screen closes without waiting for this. Never throws. */
export async function finishCelebration(deps: CloseDeps, userId: string, gymId: string, milestone: number): Promise<void> {
  try {
    await deps.writeShown(userId, gymId, { milestone, acked: false });
    const result = await deps.acknowledge(milestone);
    if (ackSettled(result)) await deps.markShownAcked(userId, gymId, milestone);
  } catch {
    // The record says `acked: false`, so a later Home load retries.
  }
}

/** A Home load (or a reconnect) re-acknowledges a shown milestone whose call did not land. Silent; never throws. Returns whether it settled. */
export async function retryAcknowledge(deps: CloseDeps, userId: string, gymId: string, shown: ShownRead): Promise<boolean> {
  const milestone = retryTarget(shown);
  if (milestone === null) return false;
  try {
    const result = await deps.acknowledge(milestone);
    if (!ackSettled(result)) return false;
    await deps.markShownAcked(userId, gymId, milestone);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// What the Home hook and the route decide (pure, so a test can run them: there is no renderer)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface HomeCelebrationPlan {
  /** The milestone to push over Home (and the gym-local day for its mini month), or null. */
  candidate: { milestone: number; today: string } | null;
  /** A shown milestone whose acknowledgement has not landed is re-acknowledged now (connected only). */
  retry: boolean;
}

/** One Home engagement load, once the device's shown-store has been read: the candidate (a LIVE row's pending milestone the device has not shown) and
 * whether to silently retry a shown milestone whose call did not land. `use-home-celebration.ts` consumes only this. */
export function homeCelebrationPlan(input: { outcome: EngagementLoadOutcome | null; shown: ShownRead; connected: boolean }): HomeCelebrationPlan {
  const { outcome, shown, connected } = input;
  const chosen = chooseMilestone(pendingFromOutcome(outcome), shown);
  const candidate = chosen !== null && outcome !== null && outcome.kind === 'row' ? { milestone: chosen, today: outcome.engagement.gymToday } : null;
  return { candidate, retry: connected && retryTarget(shown) !== null };
}

/** The route's reduce-motion value: the screen's own read (`motionRead`, null until it resolves; the first frame waits for it) or the hook's live one,
 * so a reduce-motion member never starts the count-up or plays a second haptic. */
export function reduceMotionFrom(motionRead: boolean | null, hookReduceMotion: boolean): boolean {
  return (motionRead ?? false) || hookReduceMotion;
}

/** The card is on screen only once the shown-store and the motion read are in, the route is not opening Home, and a view exists. */
export function celebrationVisible(input: { dataReady: boolean; motionKnown: boolean; openHome: boolean; hasView: boolean }): boolean {
  return input.dataReady && input.motionKnown && !input.openHome && input.hasView;
}

/** What [Keep going] and Android back record and acknowledge: the milestone shown, only when the card was actually on screen. Before that the member has
 * seen nothing, so back only goes Home (null). */
export function closeRecord(input: {
  visible: boolean;
  milestone: number | null;
  userId: string | null;
  gymId: string | null;
}): { userId: string; gymId: string; milestone: number } | null {
  const { visible, milestone, userId, gymId } = input;
  return visible && milestone !== null && userId && gymId ? { userId, gymId, milestone } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const COUNT_UP_MS = 700;
export const CARD_IN_MS = 400;
export const CARD_SCALE_FROM = 0.96;
export const CROSS_FADE_MS = 150;

export interface MotionPlan {
  /** The Success notification haptic: always, with reduced motion too. */
  haptic: true;
  /** Count the numeral from 0 over `countUpMs`; false shows the final number at once. */
  countUp: boolean;
  countUpMs: number;
  /** The card scales from `scaleFrom` to 1; 1 means no scale. */
  scaleFrom: number;
  /** The card fades in over `fadeMs` (400 ms with the scale, a 150 ms cross-fade with reduced motion). */
  fadeMs: number;
}

/** No loop, no sound, no confetti: one count-up and one fade. With the system reduce-motion setting there is no count-up and no scale. */
export function motionPlan(reduceMotion: boolean): MotionPlan {
  if (reduceMotion) return { haptic: true, countUp: false, countUpMs: 0, scaleFrom: 1, fadeMs: CROSS_FADE_MS };
  return { haptic: true, countUp: true, countUpMs: COUNT_UP_MS, scaleFrom: CARD_SCALE_FROM, fadeMs: CARD_IN_MS };
}

/** The numeral shown at `progress` (0 to 1) of the count-up. */
export function numeralAt(progress: number, milestone: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return Math.round(clamped * milestone);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface CelebrationKeys {
  headline: string;
  sub: string;
  mascot: string;
  unit: string;
  continueLabel: string;
  a11y: string;
}

export function celebrationKeys(milestone: number): CelebrationKeys {
  return {
    headline: `engage.celebration.${milestone}.headline`,
    sub: `engage.celebration.${milestone}.sub`,
    mascot: `engage.celebration.mascot.${milestone}`,
    unit: 'engage.celebration.unit',
    continueLabel: 'engage.celebration.cta.continue',
    a11y: 'engage.celebration.a11y',
  };
}

export interface CelebrationView {
  milestone: number;
  /** The final numeral, "30". */
  numeral: string;
  unit: string;
  headline: string;
  sub: string;
  /** The reserved mascot slot: empty while the catalog keys are empty (the slot then has zero height), the key's text when one is set. */
  mascot: string;
  /** The gym's name, or an empty line when it could not be read. */
  gymName: string;
  continueLabel: string;
  /** The one announcement: `engage.celebration.a11y`. */
  a11y: string;
}

export function buildCelebrationView(input: { milestone: number; gymName: string | null; t: TFn }): CelebrationView {
  const { milestone, t } = input;
  const gym = input.gymName ?? '';
  const keys = celebrationKeys(milestone);
  return {
    milestone,
    numeral: String(milestone),
    unit: t(keys.unit),
    headline: t(keys.headline),
    sub: t(keys.sub, { gym }),
    mascot: t(keys.mascot),
    gymName: gym,
    continueLabel: t(keys.continueLabel),
    a11y: t(keys.a11y, { n: milestone, gym }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The mini month
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const MINI_CALENDAR_MIN_HEIGHT = 640;
/** The +2 text size step (130%, the same bound the Home card stacks at): at or above it the mini calendar is dropped rather than clip the card. */
export const MINI_CALENDAR_MAX_FONT_SCALE = 1.3;
export const MINI_CELL_SIZE = 28;

/** Room for the mini calendar: a window at least 640pt high, and a font scale below the +2 step. */
export function showMiniCalendar(windowHeight: number, fontScale: number): boolean {
  return windowHeight >= MINI_CALENDAR_MIN_HEIGHT && fontScale < MINI_CALENDAR_MAX_FONT_SCALE;
}

/** The first of the month of the gym-local day the server returned (passed to the route as `today`), or null when it is not a date. */
export function celebrationMonth(today: unknown): string | null {
  return typeof today === 'string' && isDateOnly(today) ? monthStartOf(today) : null;
}

export interface MiniCell {
  /** Null for a blank cell outside the month. */
  date: string | null;
  lit: boolean;
}

/** The rows of the month, lit days only: no numerals and no at-risk state. */
export function buildMiniMonth(month: string, litDays: readonly string[]): MiniCell[][] {
  const lit = new Set(litDays);
  return buildMonthGrid(month).map((week) => week.days.map((date): MiniCell => ({ date, lit: date !== null && lit.has(date) })));
}
