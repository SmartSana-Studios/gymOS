import type { SetWeeklyGoalOutcome, WeeklyGoal } from '@/services/weeklyGoal';

/** Story 30.1 (FR-219, FR-232; MA-23 and the MA-12 Training row): the pure view model of the weekly goal sheet and the Profile row. The screens
 * render only what this module returns, and every string in it comes from `t()`, so the wording is data in the locale files (a test swaps one
 * catalog value for a sentinel and finds it here). No React, no storage, no network. */

export type TFn = (key: string, options?: Record<string, unknown>) => string;

export const PILL_MIN_TARGET = 44;
/** Gap between pills, and the sheet's horizontal padding on each side (goal.tsx lays out with these, equal to Spacing.two and Spacing.four). */
export const PILL_GAP = 8;
export const SHEET_HORIZONTAL_PADDING = 24;
const FULL_PILL_COUNT = 7;
/** Below this window width the pills wrap to two rows (1 to 4, then 5 to 7); at or above it all seven sit in one row of 44pt targets: seven
 * targets, six gaps and the padding on both sides (7 x 44 + 6 x 8 + 2 x 24 = 404). */
export const ONE_ROW_MIN_WIDTH = FULL_PILL_COUNT * PILL_MIN_TARGET + (FULL_PILL_COUNT - 1) * PILL_GAP + 2 * SHEET_HORIZONTAL_PADDING;

export interface PillView {
  value: number;
  /** The pill the member has chosen. */
  selected: boolean;
  /** The goal in force. */
  isCurrent: boolean;
  /** The chosen pill and the goal in force carry a check glyph. */
  showCheck: boolean;
  accessibilityLabel: string;
}

export type EffectLineKey = 'engage.goal.noChange' | 'engage.goal.pending' | 'engage.goal.effective';

export interface SheetViewModel {
  title: string;
  prompt: string;
  why: string;
  saveLabel: string;
  /** The default-goal hint, shown while the member has never set a goal. */
  hint: string | null;
  pills: PillView[];
  /** The pills laid out in rows: one row at or above ONE_ROW_MIN_WIDTH, otherwise 1-4 and the rest. */
  pillRows: PillView[][];
  effectLineKey: EffectLineKey;
  effectLine: string;
  saveEnabled: boolean;
  /** Shown above the button when the last save failed. */
  errorLine: string | null;
  /** Shown instead of the effect line's company when offline: the options work, Save does not. */
  offlineLine: string | null;
}

export interface SheetInput {
  goal: WeeklyGoal;
  choice: number;
  isConnected: boolean;
  saving: boolean;
  saveFailed: boolean;
  screenWidth: number;
  t: TFn;
  /** `en` or `fr`; anything else formats as English. */
  language: string;
}

function intlLocale(language: string): string {
  return language === 'fr' ? 'fr-FR' : 'en-GB';
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function part(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
}

/** "24 Nov" / "24 novembre" for a `YYYY-MM-DD` date. A date-only string has no time zone: it is formatted as the UTC calendar day it names. French spells
 * the month out: its short form ends in a full stop, which doubles at the end of a sentence ("Commence le lundi 24 nov..."). */
export function formatDayMonth(value: string, language: string): string {
  const date = parseDateOnly(value);
  const locale = intlLocale(language);
  return `${part(date, locale, { day: 'numeric' })} ${part(date, locale, { month: language === 'fr' ? 'long' : 'short' })}`;
}

/** "Mon 24 Nov" / "lun. 24 novembre". */
export function formatWeekdayDayMonth(value: string, language: string): string {
  const date = parseDateOnly(value);
  return `${part(date, intlLocale(language), { weekday: 'short' })} ${formatDayMonth(value, language)}`;
}

/** The effect line's catalog key. A choice equal to the goal in force reads "this is your current goal" (saving it cancels a pending change);
 * a choice made while a change is pending replaces it; otherwise it starts next Monday. */
export function effectLineKeyFor(goal: WeeklyGoal, choice: number): EffectLineKey {
  if (choice === goal.currentGoal) return 'engage.goal.noChange';
  if (goal.pendingGoal !== null) return 'engage.goal.pending';
  return 'engage.goal.effective';
}

/** Save is enabled when the choice differs from the pending goal (if one is pending) or from the goal in force (if not), and a save is possible
 * at all: online, and not already saving. */
export function isSaveEnabled(goal: WeeklyGoal, choice: number, isConnected: boolean, saving: boolean): boolean {
  if (!isConnected || saving) return false;
  const reference = goal.pendingGoal !== null ? goal.pendingGoal : goal.currentGoal;
  return choice !== reference;
}

/** The choice the sheet opens on: the pending goal if one exists (it is what the member last chose), otherwise the goal in force. */
export function initialChoice(goal: WeeklyGoal): number {
  return goal.pendingGoal !== null ? goal.pendingGoal : goal.currentGoal;
}

function pillValues(goal: WeeklyGoal): number[] {
  const values: number[] = [];
  for (let n = goal.goalMin; n <= goal.goalMax; n++) values.push(n);
  return values;
}

export function buildSheetViewModel(input: SheetInput): SheetViewModel {
  const { goal, choice, isConnected, saving, saveFailed, screenWidth, t, language } = input;

  const pills: PillView[] = pillValues(goal).map((value) => {
    const isCurrent = value === goal.currentGoal;
    const selected = value === choice;
    const base = t('engage.goal.option.a11y', { count: value });
    return {
      value,
      selected,
      isCurrent,
      showCheck: isCurrent || selected,
      accessibilityLabel: isCurrent ? `${base}, ${t('engage.goal.current')}` : base,
    };
  });

  const pillRows = screenWidth >= ONE_ROW_MIN_WIDTH ? [pills] : [pills.slice(0, 4), pills.slice(4)].filter((row) => row.length > 0);

  const effectLineKey = effectLineKeyFor(goal, choice);
  let effectLine: string;
  if (effectLineKey === 'engage.goal.noChange') {
    effectLine = t('engage.goal.noChange');
  } else if (effectLineKey === 'engage.goal.pending') {
    effectLine = t('engage.goal.pending', { n: choice, date: formatWeekdayDayMonth(goal.pendingEffectiveWeek ?? goal.nextEffectiveWeek, language) });
  } else {
    effectLine = t('engage.goal.effective', { date: formatDayMonth(goal.nextEffectiveWeek, language), current: goal.currentGoal });
  }

  return {
    title: t('engage.goal.title'),
    prompt: t('engage.goal.prompt'),
    why: t('engage.goal.why'),
    saveLabel: t('engage.goal.cta.save'),
    hint: goal.currentGoalIsDefault && goal.pendingGoal === null ? t('engage.ring.goalHint.default', { count: goal.currentGoal }) : null,
    pills,
    pillRows,
    effectLineKey,
    effectLine,
    saveEnabled: isSaveEnabled(goal, choice, isConnected, saving),
    errorLine: saveFailed ? t('engage.goal.error') : null,
    offlineLine: isConnected ? null : t('engage.goal.offline'),
  };
}

/** The Profile "Weekly goal" row value: "3 days", or "3 days, then 4 from Mon 24 Nov" while a change is pending. */
export function profileGoalValue(goal: WeeklyGoal, t: TFn, language: string): string {
  if (goal.pendingGoal !== null && goal.pendingEffectiveWeek !== null) {
    return t('engage.profile.goal.pending', {
      count: goal.currentGoal,
      next: goal.pendingGoal,
      date: formatWeekdayDayMonth(goal.pendingEffectiveWeek, language),
    });
  }
  return t('engage.profile.goal.value', { count: goal.currentGoal });
}

/** The toast shown after the sheet closes: "Goal saved. Starts Mon 24 Nov". A save that left nothing pending (the pending change was cancelled)
 * says the goal is the current one. */
export function savedToastMessage(outcome: SetWeeklyGoalOutcome, t: TFn, language: string): string {
  if (outcome.effectiveWeek === null) return t('engage.goal.noChange');
  return t('engage.goal.saved', { date: formatWeekdayDayMonth(outcome.effectiveWeek, language) });
}
