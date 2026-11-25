import { addDays } from '@/lib/calendarGrid';
import { formatDayMonth, type TFn } from '@/lib/weeklyGoalSheet';
import type { Engagement } from '@/services/engagement';

/** Story 31.1 (FR-222, FR-223, FR-232; MA-09 Shield and comeback states): the pure view model of the Shield chip, the next-Shield line, the notice
 * row, the explainer sheet and the comeback card on Home. Every number is the server's (`shieldsHeld`, `weeksToNextShield`, `shieldCap`,
 * `comebackVisitsDone` ...): this module never derives a Shield or a comeback figure, and a visit queued on this phone only turns one empty segment
 * dashed. Every string comes from `t()`. The only date arithmetic is one call of the calendar grid's `addDays` (the Monday of the newest settled week). */

export type NoticeKind = 'saved' | 'earned' | 'restored';

export function noticeId(kind: NoticeKind, date: string): string {
  return `${kind}:${date}`;
}

export interface ShieldChipView {
  label: string;
  /** What a screen reader reads: the label, so the chip is announced as "2 Shields, button". */
  accessibilityLabel: string;
}

export interface ShieldNoticeView {
  /** The id the device store records on dismissal. */
  id: string;
  kind: 'saved' | 'earned';
  text: string;
}

export interface ShieldExplainerView {
  title: string;
  body: string;
  gotIt: string;
}

export type ComebackPhase = 'empty' | 'progress' | 'lapsed' | 'restored';

export interface ComebackView {
  phase: ComebackPhase;
  title: string;
  /** "Your best streak: 8 weeks. It stays on your record." split around the numeral (rendered as `statNumeral`); null when there is no best. */
  best: { text: string; before: string; numeral: string; after: string } | null;
  /** The goal sentence ("Visit 3 times in 10 days ..."), built from the server's goal and window. */
  goalLine: string | null;
  /** The stamp segments of an active window: the server's visits done, the goal, and at most one dashed segment for a visit queued on this phone. */
  segments: { total: number; done: number; dashed: number } | null;
  /** "1 / 3"; null while no visit is done (no "0 / 3" numeral). */
  numeral: string | null;
  /** `engage.comeback.progress` for 1 or 2 visits. */
  progressLabel: string | null;
  /** `engage.comeback.windowRestart`, in the lapsed phase. */
  restartLine: string | null;
  restored: { title: string; body: string; id: string } | null;
  /** The one accessibility sentence of the whole card. */
  accessibilityLabel: string;
}

export interface ShieldView {
  chip: ShieldChipView | null;
  /** `engage.streak.nextShield` or `engage.streak.shieldMax`, or null. */
  nextLine: string | null;
  notice: ShieldNoticeView | null;
  explainer: ShieldExplainerView;
  /** `engage.atRisk.shieldReady`: the optional second line of the at-risk hint, only while a Shield is held. */
  shieldReady: string | null;
  comeback: ComebackView | null;
}

export interface ShieldViewInput {
  row: Engagement;
  /** The ids the device has recorded (dismissed notices, restored cards already shown); null when the store cannot be read or is not loaded yet: no
   * notice and no restored card then (fail closed). */
  seen: ReadonlySet<string> | null;
  /** A visit is queued on this phone for today and the server does not know of it yet (offline or a cached row). */
  queuedVisit: boolean;
  t: TFn;
  language: string;
}

function splitAround(text: string, numeral: string): { text: string; before: string; numeral: string; after: string } {
  const at = text.indexOf(numeral);
  if (at < 0) return { text, before: text, numeral: '', after: '' };
  return { text, before: text.slice(0, at), numeral, after: text.slice(at + numeral.length) };
}

/** The Shield chip: only while 1 or more are held, never "0 Shields". */
function chipFor(row: Engagement, t: TFn): ShieldChipView | null {
  if (row.inReleaseWeek || row.shieldsHeld < 1) return null;
  const label = t('engage.shield.chip', { count: row.shieldsHeld });
  return { label, accessibilityLabel: label };
}

/** The muted line under the streak: weeks to the next Shield below the cap, the maximum line at the cap. Both need an active run. */
function nextLineFor(row: Engagement, t: TFn): string | null {
  if (row.inReleaseWeek || row.streakWeeks === null) return null;
  if (row.shieldCap > 0 && row.shieldsHeld >= row.shieldCap) return t('engage.streak.shieldMax', { max: row.shieldCap });
  if (row.weeksToNextShield !== null) return t('engage.streak.nextShield', { count: row.weeksToNextShield });
  return null;
}

/** At most one notice, newest first: a saved week or an earned Shield counts only while it belongs to the newest settled week, and only until it is
 * dismissed (each on its own). */
function noticeFor(row: Engagement, seen: ReadonlySet<string> | null, t: TFn, language: string): ShieldNoticeView | null {
  if (seen === null || row.inReleaseWeek) return null;
  const newestSettled = addDays(row.weekStart, -7);
  const candidates: ShieldNoticeView[] = [];
  if (row.savedWeekStart === newestSettled && row.savedWeekStreak !== null) {
    candidates.push({
      id: noticeId('saved', row.savedWeekStart),
      kind: 'saved',
      text: t('engage.shield.saved.week', { date: formatDayMonth(row.savedWeekStart, language), count: row.savedWeekStreak }),
    });
  }
  if (row.shieldEarnedWeek === newestSettled) {
    candidates.push({ id: noticeId('earned', row.shieldEarnedWeek), kind: 'earned', text: t('engage.shield.earned') });
  }
  return candidates.find((c) => !seen.has(c.id)) ?? null;
}

function comebackFor(input: ShieldViewInput): ComebackView | null {
  const { row, seen, queuedVisit, t } = input;
  if (row.inReleaseWeek) return null;
  const state = row.comebackState;
  if (state !== 'active' && state !== 'lapsed' && state !== 'restored') return null;

  const title = t('engage.comeback.title');
  const bestText = row.bestStreakWeeks >= 1 ? t('engage.comeback.best', { count: row.bestStreakWeeks }) : null;
  const best = bestText ? splitAround(bestText, String(row.bestStreakWeeks)) : null;
  const base = { title, best, goalLine: null, segments: null, numeral: null, progressLabel: null, restartLine: null, restored: null } as const;

  if (state === 'restored') {
    // One time: shown until the id is recorded, then gone. An unreadable store shows nothing.
    if (seen === null || row.comebackWindowStart === null) return null;
    const id = noticeId('restored', row.comebackWindowStart);
    if (seen.has(id)) return null;
    const restored = { title: t('engage.comeback.restored.title'), body: t('engage.comeback.restored.body'), id };
    return { ...base, phase: 'restored', restored, accessibilityLabel: [title, restored.title, restored.body].join('. ') };
  }

  if (state === 'lapsed') {
    const restartLine = t('engage.comeback.windowRestart', { days: row.comebackWindowDays });
    return { ...base, phase: 'lapsed', restartLine, accessibilityLabel: [title, bestText, restartLine].filter(Boolean).join('. ') };
  }

  const goalLine = t('engage.comeback.goal', { n: row.comebackVisitsGoal, days: row.comebackWindowDays });
  const done = Math.min(Math.max(row.comebackVisitsDone, 0), row.comebackVisitsGoal);
  // A day counts once: a queued visit turns the first empty segment dashed (when one is left) and moves no figure.
  const dashed = queuedVisit && done < row.comebackVisitsGoal ? 1 : 0;
  const segments = { total: row.comebackVisitsGoal, done, dashed };
  if (done === 0) {
    return { ...base, phase: 'empty', goalLine, segments, accessibilityLabel: [title, bestText, goalLine].filter(Boolean).join('. ') };
  }
  const progressLabel = t('engage.comeback.progress', { done, total: row.comebackVisitsGoal });
  return {
    ...base,
    phase: 'progress',
    goalLine,
    segments,
    numeral: `${done} / ${row.comebackVisitsGoal}`,
    progressLabel,
    accessibilityLabel: [title, bestText, goalLine, progressLabel].filter(Boolean).join('. '),
  };
}

export function buildShieldView(input: ShieldViewInput): ShieldView {
  const { row, seen, t, language } = input;
  return {
    chip: chipFor(row, t),
    nextLine: nextLineFor(row, t),
    notice: noticeFor(row, seen, t, language),
    explainer: {
      title: t('engage.shield.explainer.title'),
      body: t('engage.shield.explainer.body', { count: row.shieldEveryWeeks, max: row.shieldCap }),
      gotIt: t('engage.shield.gotIt'),
    },
    shieldReady: !row.inReleaseWeek && row.shieldsHeld >= 1 ? t('engage.atRisk.shieldReady') : null,
    comeback: comebackFor(input),
  };
}
