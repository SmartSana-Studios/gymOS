import type { TFn } from '@/lib/weeklyGoalSheet';

/** Story 31.2 (FR-233, FR-232; MA-12 Notifications Card, the "Streak reminder" row): the pure view model of the row. The screen renders what this
 * module returns and holds no rule of its own. Every sentence comes from `t()` (`engage.profile.reminder.*`); the one number the row shows is the
 * hour the server's reminder window opens, read by `my_streak_reminder_hour()` from the same configuration the job uses. This module never picks
 * an hour itself: when the read failed there is no hour, and the helper line is left out (never a guessed time). No React, no storage, no network,
 * and no date construction (the hour is formatted by arithmetic on a whole number). */

/** "6 pm" in English, "18 h" in French. Null for anything that is not a whole hour from 0 to 23, so a malformed answer reads as "no hour". */
export function formatReminderHour(hour: number | null | undefined, language: string): string | null {
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (language.toLowerCase().startsWith('fr')) return `${hour} h`;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? 'am' : 'pm'}`;
}

export interface StreakReminderRowView {
  label: string;
  /** `engage.profile.reminder.helper` with the send time, or null when the hour is unknown (the line is omitted). */
  helper: string | null;
  /** The switch is on while the member is NOT opted out (on by default). */
  checked: boolean;
  disabled: boolean;
  /** What a screen reader reads. The state itself ("on" or "off") is announced by the switch, as on the other notification toggles. */
  accessibilityLabel: string;
}

export interface StreakReminderRowInput {
  optedOut: boolean;
  /** A save is in flight: the switch is off-limits so a second tap cannot overlap it. */
  pending: boolean;
  /** The server's reminder hour, or null when the read failed. */
  hour: number | null;
  language: string;
  t: TFn;
}

export function buildStreakReminderRow(input: StreakReminderRowInput): StreakReminderRowView {
  const label = input.t('engage.profile.reminder.label');
  const time = formatReminderHour(input.hour, input.language);
  return {
    label,
    helper: time === null ? null : input.t('engage.profile.reminder.helper', { time }),
    checked: !input.optedOut,
    disabled: input.pending,
    accessibilityLabel: label,
  };
}

export interface StreakReminderToggleResult {
  /** The value the screen shows after the save: the new choice on success, the previous one (the optimistic flip reverted) on failure. */
  optedOut: boolean;
  /** The save failed: the screen shows its existing inline error toast. */
  showError: boolean;
}

/** The optimistic flip and its outcome. `previous` is the stored value before the tap; the flip is `!previous`. */
export function streakReminderAfterToggle(previous: boolean, saved: boolean): StreakReminderToggleResult {
  return saved ? { optedOut: !previous, showError: false } : { optedOut: previous, showError: true };
}
