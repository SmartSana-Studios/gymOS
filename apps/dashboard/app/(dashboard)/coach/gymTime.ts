import type { Locale } from "@/lib/i18n/config";

/**
 * Gym-local time helpers shared by the Coach Portal's server-rendered pages
 * (Story 17.4's My Classes, Story 17.5's Overview). Every label is formatted
 * on the server in the gym's own timezone -- never the runtime's, which is
 * UTC on Vercel and the browser's zone on the client -- so there is no
 * SSR/client hydration mismatch and no wrong hour.
 *
 * A plain module rather than helpers exported from a page: `next build`
 * rejects a `page.tsx` export that is not a Page field.
 */

const MS_PER_DAY = 86_400_000;

/** Formats an instant in the gym's timezone: 24-hour, per the AD-21 mockup,
 * keeping the locale's own ordering rather than hand-building a string. The
 * year is added only when the date's gym-local year is not the current one --
 * a finished one-off class stays listed indefinitely, and "Mon, Aug 31" a year
 * on would read like an upcoming date. It builds three formatters per call,
 * so call it once per timezone per render, not once per row. */
export function gymDateFormatter(locale: Locale, timeZone: string): (iso: string) => string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const withoutYear = new Intl.DateTimeFormat(locale, options);
  const withYear = new Intl.DateTimeFormat(locale, { ...options, year: "numeric" });
  const yearOf = new Intl.DateTimeFormat("en", { timeZone, year: "numeric" });
  const currentYear = yearOf.format(new Date());

  return (iso) => {
    const date = new Date(iso);
    return (yearOf.format(date) === currentYear ? withoutYear : withYear).format(date);
  };
}

// One calendar-date formatter per timezone, reused across renders.
const calendarDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The instant's gym-local calendar date, as the UTC midnight of that date --
 * read from `formatToParts`, never by parsing a formatted string, whose shape
 * varies by locale and ICU release. */
function gymLocalDateAsUtc(instant: Date, timeZone: string): number {
  let formatter = calendarDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    calendarDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

/** How many gym-local CALENDAR days lie between `iso` and `now` -- a note
 * written at 23:30 yesterday is one day ago at 08:00 today, not zero. Comparing
 * calendar dates, not instants, keeps this right across DST. Clamped at 0:
 * `progress_entries.logged_at` is client-supplied for offline entries (0066),
 * so a fast device clock can put it in the future. */
export function gymLocalDaysAgo(iso: string, now: Date, timeZone: string): number {
  const days = Math.round((gymLocalDateAsUtc(now, timeZone) - gymLocalDateAsUtc(new Date(iso), timeZone)) / MS_PER_DAY);
  return Math.max(0, days);
}

/** Phrases a count of days ago in the viewer's locale -- "today",
 * "yesterday", "21 days ago"; "aujourd’hui", "hier", "il y a 21 jours". Built
 * once per render. */
export function relativeDaysFormatter(locale: Locale): (days: number) => string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return (days) => format.format(days === 0 ? 0 : -days, "day");
}
