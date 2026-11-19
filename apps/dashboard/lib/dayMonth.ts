/**
 * Story 27.4 (UX AD-31, AD-12): the day-first dates of the Correct plan wording ("02 Nov 2026", "10 Nov"). English uses the en-GB order so
 * the day leads in both locales; the date-only strings (yyyy-mm-dd) are read as the calendar day they name, never shifted by a timezone.
 */
function intlLocale(language: string | undefined): string {
  return language === "fr" ? "fr" : "en-GB";
}

/** A `yyyy-mm-dd` (or ISO timestamp, read by its date part) as a local calendar date. */
export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDayMonthYear(value: string, language: string | undefined): string {
  return parseCalendarDate(value).toLocaleDateString(intlLocale(language), { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDayMonth(date: Date, language: string | undefined): string {
  return date.toLocaleDateString(intlLocale(language), { day: "2-digit", month: "short" });
}
