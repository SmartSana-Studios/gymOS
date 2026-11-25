import { intlLocale } from '@/lib/weeklyGoalSheet';

/** The time of day of an instant on THIS phone ("14:30"), for "Updated {{time}}" beside a copy kept on the device. It is the phone's own clock and
 * zone on purpose: it says when this phone last heard from the server, and it is never used to decide a day, a month or a rank. Kept out of the
 * screen and view-model files, which do no date construction (the source scans in lib/weeklyRing.source.test.ts). */
export function formatClockTime(ms: number, language: string): string {
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat(intlLocale(language), { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}
