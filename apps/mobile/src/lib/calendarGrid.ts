import { intlLocale, parseDateOnly } from '@/lib/weeklyGoalSheet';

/** Story 30.5 (FR-224, NFR-028; MA-18): the month grid and every date label of the calendar, as plain calendar-date arithmetic on `YYYY-MM-DD`
 * strings. A date-only string has no time zone, so nothing here reads the device zone or the device clock: dates are built with `Date.UTC` and read
 * back with the `getUTC*` accessors, and formatting goes through `Intl` pinned to `timeZone: 'UTC'`. "Today" is never computed here: it is the
 * gym-local day the server returned, and the month shown starts from it. Weeks start on Monday, matching the weekly goal week. */

export const DAYS_IN_WEEK = 7;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A Monday, used only to name the seven weekdays in header order. */
const A_MONDAY = '2024-01-01';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateOnly(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isDateOnly(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The first day of the month that contains `date`. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function isMonthStart(value: string): boolean {
  return isDateOnly(value) && value.endsWith('-01');
}

/** `monthStart` moved by `delta` months (negative goes back), as the first of that month. */
export function addMonths(monthStart: string, delta: number): string {
  const date = parseDateOnly(monthStart);
  return toDateOnly(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1)));
}

export function addDays(date: string, delta: number): string {
  const d = parseDateOnly(date);
  return toDateOnly(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta)));
}

export function daysInMonth(monthStart: string): number {
  const d = parseDateOnly(monthStart);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(date: string): number {
  return (parseDateOnly(date).getUTCDay() + 6) % DAYS_IN_WEEK;
}

/** The Monday of the week that contains `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export interface GridWeek {
  /** The Monday of this row, which may fall in the previous month. */
  weekStart: string;
  /** Seven entries, Monday first: the date, or null for a blank cell outside the month. */
  days: (string | null)[];
}

/** The rows of a month: 4 to 6 weeks of seven, a blank before the first and after the last day. */
export function buildMonthGrid(monthStart: string): GridWeek[] {
  const lead = weekdayIndex(monthStart);
  const total = daysInMonth(monthStart);
  const rows = Math.ceil((lead + total) / DAYS_IN_WEEK);
  return Array.from({ length: rows }, (_, row) => {
    const days = Array.from({ length: DAYS_IN_WEEK }, (_, col): string | null => {
      const dayNumber = row * DAYS_IN_WEEK + col - lead + 1;
      return dayNumber >= 1 && dayNumber <= total ? addDays(monthStart, dayNumber - 1) : null;
    });
    return { weekStart: mondayOf(addDays(monthStart, row * DAYS_IN_WEEK - lead)), days };
  });
}

/** `YYYY-MM-DD` dates compare correctly as strings. */
export function isAfter(a: string, b: string): boolean {
  return a > b;
}

/** The next-month chevron: never past the month of gym-local today. */
export function canGoNext(month: string, currentMonth: string): boolean {
  return month < currentMonth;
}

/** The previous-month chevron: never before the member's earliest month with a visit (the current month when there is none). */
export function canGoPrev(month: string, earliestMonth: string): boolean {
  return month > earliestMonth;
}

export function earliestMonth(firstVisitDay: string | null, currentMonth: string): string {
  if (!firstVisitDay) return currentMonth;
  const first = monthStartOf(firstVisitDay);
  return first < currentMonth ? first : currentMonth;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------------------------------------------------------

function part(date: Date, language: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(language), { ...options, timeZone: 'UTC' }).format(date);
}

/** "November 2026" / "novembre 2026". */
export function formatMonthYear(monthStart: string, language: string): string {
  return part(parseDateOnly(monthStart), language, { month: 'long', year: 'numeric' });
}

/** "November" / "novembre". */
export function formatMonthName(monthStart: string, language: string): string {
  return part(parseDateOnly(monthStart), language, { month: 'long' });
}

/** "12 November" / "12 novembre". */
export function formatDayMonthLong(date: string, language: string): string {
  const d = parseDateOnly(date);
  return `${part(d, language, { day: 'numeric' })} ${part(d, language, { month: 'long' })}`;
}

/** "Tuesday 12 November" / "mardi 12 novembre": built from parts so no ICU version adds a comma. */
export function formatLongDate(date: string, language: string): string {
  return `${part(parseDateOnly(date), language, { weekday: 'long' })} ${formatDayMonthLong(date, language)}`;
}

/** The day number inside a cell. */
export function dayNumeral(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** The weekday header, Monday first, one letter each ("M T W T F S S" / "L M M J V S D"). */
export function weekdayInitials(language: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => part(parseDateOnly(addDays(A_MONDAY, i)), language, { weekday: 'narrow' }));
}
