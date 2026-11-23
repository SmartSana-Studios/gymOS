import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildMonthGrid,
  canGoNext,
  canGoPrev,
  dayNumeral,
  earliestMonth,
  formatDayMonthLong,
  formatLongDate,
  formatMonthName,
  formatMonthYear,
  isDateOnly,
  isMonthStart,
  monthStartOf,
  weekdayInitials,
} from '@/lib/calendarGrid';
import type { TFn } from '@/lib/weeklyGoalSheet';
import type { GetMyEngagementResult } from '@/services/engagement';
import { hintFor, msLeftInDay, queuedTodayCount, timeLeftParts, type CachedEngagement, type EngagementSnapshot, type HintView } from '@/lib/weeklyRing';

/** Story 30.5 (FR-224, FR-225, NFR-028; MA-18): the pure view model of the attendance calendar. The screen renders only what this module returns. Every
 * string comes from `t()` (wording is data in the locale files), the grid is plain date arithmetic on strings (lib/calendarGrid.ts: no device time
 * zone, no device clock for the month shown), "today" is the gym-local day the server returned in `my_engagement()`, and the visit days are the
 * server's: this module counts rows and nothing else. The only instant arithmetic is the hours left (an instant minus an instant, with the server
 * offset, through msLeftInDay) and the queued-scan cut-off (queuedTodayCount), both reused from the Home ring. No check-in time is ever shown. */

/** Whether Profile's Training card shows the "My visits" row, from Home's device copy of the engagement row: only a copy that says the area is on.
 * No copy (a member who never opened Home, or a dark area) leaves Profile exactly as it was. */
export function myVisitsRowFromCache(cached: CachedEngagement | null): boolean {
  return cached !== null && cached.engagement.enabled;
}

/** The row after a live `my_engagement()` read: the server's word when it answers (on, or off for a dark area or a non-member), and what is showing
 * when the read fails, so a transient failure neither hides a visible row nor shows a hidden one. */
export function myVisitsRowAfterRead(current: boolean, result: GetMyEngagementResult): boolean {
  if (result.status === 'success') return result.engagement.enabled;
  if (result.status === 'unavailable') return false;
  return current;
}

/** Story 30.7: the server's marker of each day of a month (`my_visit_days`), day to 7, 30 or 100; days without one are left out. */
export function milestonesOf(days: readonly { visitDay: string; milestone: number | null }[]): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const d of days) if (d.milestone !== null) marks[d.visitDay] = d.milestone;
  return marks;
}

/** A month just read from the server: its days and its markers. */
export function readyFromServer(days: readonly { visitDay: string; milestone: number | null }[]): MonthData {
  return { kind: 'ready', days: days.map((d) => d.visitDay), fromCache: false, milestones: milestonesOf(days) };
}

/** The device's copy of a month, with the markers stored beside its days (none for a copy stored before 30.7); null when the month was never stored. */
export function readyFromCache(cache: CalendarCache | null, month: string): MonthData | null {
  const days = cache?.months[month];
  return days ? { kind: 'ready', days, fromCache: true, milestones: cache?.milestones?.[month] } : null;
}

/** The in-memory cache after a month was read from the server: the days and the markers of that month replaced, everything else kept. */
export function cacheWithMonth(cache: CalendarCache, month: string, days: readonly string[], milestones: Readonly<Record<string, number>>): CalendarCache {
  return { ...cache, months: { ...cache.months, [month]: [...days] }, milestones: { ...(cache.milestones ?? {}), [month]: { ...milestones } } };
}

/** The skeleton grid while a month loads: 5 rows of 7. */
export const SKELETON_CELLS = 35;
/** Months kept on the device per member and gym. */
const MAX_CACHED_MONTHS = 36;

export type MonthData =
  | { kind: 'loading' }
  // `fromCache`: the days are the device's last good copy of this month, not this load's. `milestones` (Story 30.7): day to 7, 30 or 100, the server's
  // derived marker of that day; absent on a copy stored before 30.7.
  | { kind: 'ready'; days: readonly string[]; fromCache: boolean; milestones?: Readonly<Record<string, number>> }
  // Offline and this month has never been loaded on this phone.
  | { kind: 'unavailable' }
  | { kind: 'error' };

export interface CalendarInput {
  /** The first of the month on screen, or null until gym-local today is known (the screen opens on the gym's current month). */
  month: string | null;
  /** The `my_engagement()` row (live, or the device's last good copy), with the phone clock when it arrived; null when there is none. */
  snapshot: EngagementSnapshot | null;
  /** The engagement read is running and there is nothing to show yet. */
  engagementLoading: boolean;
  monthData: MonthData;
  /** The member's earliest counted visit day (`my_first_visit_day()`), or null. */
  firstVisitDay: string | null;
  /** The date the member tapped, or null. */
  selected: string | null;
  /** The phone is offline, or the last read failed: the cached-calendar banner shows and queued scans are overlaid. */
  offline: boolean;
  /** Real connectivity only (a failed read while connected is not "not connected"): it alone chooses `offlineNone` over `error`. */
  connected: boolean;
  /** `scannedAt` of every scan queued on this device (device-wide). */
  queuedScanTimes: readonly string[];
  deviceNowMs: number;
  t: TFn;
  /** `en` or `fr`; anything else formats as English. */
  language: string;
}

export type CalendarFace = 'loading' | 'grid' | 'error' | 'offlineNone';
export type CellOutline = 'none' | 'accent' | 'warning' | 'dashed';

export interface DayCellView {
  kind: 'day';
  date: string;
  numeral: string;
  /** Accent fill, check glyph, on-accent numeral. */
  lit: boolean;
  /** Today's 2pt ring: accent, warning (at risk), or dashed (a visit waiting to sync). */
  outline: CellOutline;
  glyph: 'check' | 'schedule' | null;
  /** Story 30.7: 7, 30 or 100 on the day of that visit (the star badge in a corner of the cell); null on every other day. */
  milestone: number | null;
  /** "6 h" / "45 m", only in the at-risk cell. */
  hoursText: string | null;
  bold: boolean;
  /** A future day: 40% opacity, not tappable. */
  faded: boolean;
  tappable: boolean;
  /** The 2pt focus ring of the tapped cell. */
  selected: boolean;
  atRisk: boolean;
  accessibilityLabel: string;
}

export interface BlankCellView {
  kind: 'blank';
}

export interface WeekView {
  /** The Monday of the row. */
  key: string;
  /** "Week of 10 November, 3 visit days". */
  accessibilityLabel: string;
  cells: (DayCellView | BlankCellView)[];
}

export interface SummaryView {
  /** The whole line. */
  text: string;
  /** The line split around the numeral (rendered as `statNumeral`); `numeral` is empty for an empty month. */
  before: string;
  numeral: string;
  after: string;
}

export interface LegendItem {
  kind: 'visit' | 'today' | 'milestone';
  label: string;
}

export interface CalendarView {
  title: string;
  face: CalendarFace;
  monthBar: { label: string; prevLabel: string; nextLabel: string; canPrev: boolean; canNext: boolean };
  /** The month heading and what a screen reader reads for it: "November 2026. 9 visit days." */
  heading: { text: string; accessibilityLabel: string };
  /** "9 visit days in November", or the empty-month line; null when no month is loaded. */
  summary: SummaryView | null;
  /** `engage.calendar.offline.banner` while cached data is on screen. */
  banner: string | null;
  /** The text in the grid slot for the `error` and `offlineNone` faces. */
  message: string | null;
  retryLabel: string | null;
  weekdays: string[];
  weeks: WeekView[];
  /** The at-risk line under the grid (current month only): the same strings as Home's hint. */
  atRiskLine: HintView | null;
  /** Today's at-risk hint whichever month is on screen. The screen keeps the line mounted (hidden off the current month) so its once-per-focus
   * announcement and pulse are not replayed each time the member returns to the current month. */
  atRiskHint: HintView | null;
  legend: LegendItem[];
  /** Today's line, or the tapped day's; null when today is not known. */
  detail: string | null;
}

/** The marker of a day: 7, 30 or 100, else null (any other number from a damaged copy draws nothing). */
function milestoneOn(milestones: Readonly<Record<string, number>>, date: string): number | null {
  const value = milestones[date];
  return value === 7 || value === 30 || value === 100 ? value : null;
}

function splitSummary(text: string, count: number): SummaryView {
  const numeral = String(count);
  const at = text.indexOf(numeral);
  if (at < 0) return { text, before: text, numeral: '', after: '' };
  return { text, before: text.slice(0, at), numeral, after: text.slice(at + numeral.length) };
}

/** The face of the grid slot: a month is only drawn when today is known (it needs `gymToday`) and the month's days are in hand. */
export function faceFor(input: Pick<CalendarInput, 'snapshot' | 'engagementLoading' | 'monthData' | 'connected'>): CalendarFace {
  const usable = input.snapshot !== null && input.snapshot.engagement.enabled;
  if (!usable) {
    if (input.engagementLoading) return 'loading';
    return input.connected ? 'error' : 'offlineNone';
  }
  switch (input.monthData.kind) {
    case 'loading':
      return 'loading';
    case 'unavailable':
      return 'offlineNone';
    case 'error':
      return 'error';
    case 'ready':
      return 'grid';
  }
}

export function buildCalendarView(input: CalendarInput): CalendarView {
  const { snapshot, t, language } = input;
  const face = faceFor(input);
  const usable = snapshot !== null && snapshot.engagement.enabled ? snapshot : null;
  const today = usable ? usable.engagement.gymToday : null;
  const month = input.month ?? (today ? monthStartOf(today) : null);
  const currentMonth = today ? monthStartOf(today) : null;
  const viewingCurrent = month !== null && month === currentMonth;
  const days = input.monthData.kind === 'ready' ? new Set(input.monthData.days) : new Set<string>();
  const milestones = input.monthData.kind === 'ready' ? (input.monthData.milestones ?? {}) : {};
  const loaded = face === 'grid';

  const monthYear = month ? formatMonthYear(month, language) : '';
  const earliest = currentMonth ? earliestMonth(input.firstVisitDay, currentMonth) : null;
  const monthBar = {
    label: monthYear,
    prevLabel: t('engage.calendar.prev'),
    nextLabel: t('engage.calendar.next'),
    canPrev: month !== null && earliest !== null && canGoPrev(month, earliest),
    canNext: month !== null && currentMonth !== null && canGoNext(month, currentMonth),
  };

  // The overlay (queued scans, the device clock for the hint) applies offline or on a cached row, exactly as on Home.
  const overlay = input.offline || (usable?.fromCache ?? false) || (input.monthData.kind === 'ready' && input.monthData.fromCache);
  const row = usable?.engagement ?? null;
  const queued = row && overlay ? queuedTodayCount(row.dayStartsAt, input.queuedScanTimes) : 0;

  // Today's state. The server's `visitedToday` covers a month that is not on screen; the rows cover a stale flag.
  const todayInRows = today !== null && days.has(today);
  const todayVisited = row ? row.visitedToday || todayInRows : false;
  // A scan queued on this phone lights today dashed, only while the server does not yet know of a visit today.
  const pending = row !== null && !todayVisited && queued > 0;
  // The at-risk rule is Home's (hintFor), plus: no visit today, and the screen shows the current month.
  const todayHint = usable && row && !row.visitedToday && !todayInRows && !pending ? hintFor(usable, overlay, queued, input.deviceNowMs, t) : null;
  const atRisk = todayHint !== null;
  const atRiskHours = (() => {
    if (!usable || !atRisk) return null;
    const left = msLeftInDay(usable.engagement, usable.fetchedAtDeviceMs, input.deviceNowMs);
    if (left === null) return null;
    const parts = timeLeftParts(left);
    return parts.unit === 'hours' ? t('engage.calendar.cell.hours', { count: parts.value }) : t('engage.calendar.cell.minutes', { count: parts.value });
  })();

  const selected = input.selected && month && input.selected.slice(0, 7) === month.slice(0, 7) && isDateOnly(input.selected) ? input.selected : null;

  function dayCell(date: string): DayCellView {
    const isToday = date === today;
    const future = today !== null && date > today;
    const lit = !future && (days.has(date) || (isToday && pending));
    const cellAtRisk = isToday && atRisk && viewingCurrent;
    const long = formatLongDate(date, language);
    const milestone = lit && !future ? milestoneOn(milestones, date) : null;
    let label: string;
    if (future) label = long;
    else if (milestone !== null) label = t(`engage.calendar.day.milestone${milestone}`, { date: long });
    else if (isToday && pending) label = t('engage.calendar.day.pending', { date: long });
    else if (isToday && cellAtRisk) label = t('engage.calendar.day.today.atRisk', { date: long, hoursLeft: todayHint?.timeLeft ?? '' });
    else if (isToday) label = t(lit ? 'engage.calendar.day.today.visited' : 'engage.calendar.day.today.none', { date: long });
    else label = t(lit ? 'engage.calendar.day.visited' : 'engage.calendar.day.none', { date: long });
    return {
      kind: 'day',
      date,
      numeral: dayNumeral(date),
      lit,
      outline: !isToday ? 'none' : cellAtRisk ? 'warning' : pending ? 'dashed' : 'accent',
      glyph: cellAtRisk ? 'schedule' : lit ? 'check' : null,
      milestone,
      hoursText: cellAtRisk ? atRiskHours : null,
      bold: isToday,
      faded: future,
      tappable: !future,
      selected: selected === date,
      atRisk: cellAtRisk,
      accessibilityLabel: label,
    };
  }

  const weeks: WeekView[] =
    loaded && month
      ? buildMonthGrid(month).map((week) => {
          const cells = week.days.map((date): DayCellView | BlankCellView => (date ? dayCell(date) : { kind: 'blank' }));
          const lit = cells.filter((cell) => cell.kind === 'day' && cell.lit && !cell.faded).length;
          return {
            key: week.weekStart,
            accessibilityLabel: t('engage.calendar.week.a11y', { date: formatDayMonthLong(week.weekStart, language), count: lit }),
            cells,
          };
        })
      : [];

  // The summary line, or the empty-month line in its place.
  let summary: SummaryView | null = null;
  let headingLabel = monthYear;
  if (loaded && month) {
    const count = days.size;
    if (count > 0) {
      summary = splitSummary(t('engage.calendar.monthSummary', { count, month: formatMonthName(month, language) }), count);
      headingLabel = t('engage.calendar.heading.a11y', { month: monthYear, count });
    } else {
      const empty = viewingCurrent ? t('engage.calendar.empty.current') : t('engage.calendar.empty.past', { month: formatMonthName(month, language) });
      summary = { text: empty, before: empty, numeral: '', after: '' };
      headingLabel = `${monthYear}. ${empty}`;
    }
  }

  // The detail line: today's, or the tapped day's.
  let detail: string | null = null;
  if (today && loaded) {
    const target = selected ?? today;
    const long = formatLongDate(target, language);
    const targetMilestone = target <= today && days.has(target) ? milestoneOn(milestones, target) : null;
    if (targetMilestone !== null) detail = t(`engage.calendar.day.milestone${targetMilestone}`, { date: long });
    else if (target === today) {
      if (pending) detail = t('engage.calendar.day.pending', { date: long });
      else if (todayVisited) detail = t('engage.calendar.day.today.visited', { date: long });
      else if (atRisk) detail = t('engage.calendar.day.today.atRisk', { date: long, hoursLeft: todayHint?.timeLeft ?? '' });
      else detail = t('engage.calendar.day.today.none', { date: long });
    } else {
      detail = t(days.has(target) ? 'engage.calendar.day.visited' : 'engage.calendar.day.none', { date: long });
    }
  }

  const slotMessage = face === 'error' ? t('engage.calendar.error') : face === 'offlineNone' ? t('engage.calendar.offline.none') : null;

  return {
    title: t('engage.calendar.title'),
    face,
    monthBar,
    heading: { text: monthYear, accessibilityLabel: headingLabel },
    summary,
    banner: loaded && input.monthData.kind === 'ready' && (input.monthData.fromCache || input.offline) ? t('engage.calendar.offline.banner') : null,
    message: slotMessage,
    retryLabel: face === 'offlineNone' ? t('common.tryAgain') : null,
    weekdays: weekdayInitials(language),
    weeks,
    atRiskLine: loaded && viewingCurrent ? todayHint : null,
    atRiskHint: loaded ? todayHint : null,
    legend: [
      { kind: 'visit', label: t('engage.calendar.legend.visit') },
      { kind: 'today', label: t('engage.calendar.legend.today') },
      { kind: 'milestone', label: t('engage.calendar.legend.milestone') },
    ],
    detail,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The device cache: every month loaded, per member and gym. Same fail-open pattern as the ring's cache: a storage failure is "no cache".
// ---------------------------------------------------------------------------------------------------------------------------------------------

const CACHE_KEY_PREFIX = 'gymos.engageCalendar.v1.';

export interface CalendarCache {
  /** `YYYY-MM-01` to the visit days of that month. */
  months: Record<string, string[]>;
  firstVisitDay: string | null;
  /** Story 30.7: `YYYY-MM-01` to day to milestone number (7, 30 or 100). Optional and parallel to `months`: a copy stored before 30.7 has none and reads
   * as a month with no markers. */
  milestones?: Record<string, Record<string, number>>;
}

export function calendarCacheKey(userId: string, gymId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}.${gymId}`;
}

const EMPTY_CACHE: CalendarCache = { months: {}, firstVisitDay: null };

function parseCache(raw: string | null): CalendarCache {
  if (!raw) return { months: {}, firstVisitDay: null };
  try {
    const parsed = JSON.parse(raw) as { months?: unknown; firstVisitDay?: unknown } | null;
    if (!parsed || typeof parsed.months !== 'object' || parsed.months === null || Array.isArray(parsed.months)) return { months: {}, firstVisitDay: null };
    const months: Record<string, string[]> = {};
    for (const [month, days] of Object.entries(parsed.months as Record<string, unknown>)) {
      if (!isMonthStart(month) || !Array.isArray(days)) continue;
      if (!days.every((d) => typeof d === 'string' && isDateOnly(d) && d.startsWith(month.slice(0, 7)))) continue;
      months[month] = days as string[];
    }
    const first = typeof parsed.firstVisitDay === 'string' && isDateOnly(parsed.firstVisitDay) ? parsed.firstVisitDay : null;
    const milestones = parseMilestones((parsed as { milestones?: unknown }).milestones);
    return milestones ? { months, firstVisitDay: first, milestones } : { months, firstVisitDay: first };
  } catch {
    return { months: {}, firstVisitDay: null };
  }
}

function parseMilestones(raw: unknown): Record<string, Record<string, number>> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, Record<string, number>> = {};
  for (const [month, byDay] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMonthStart(month) || typeof byDay !== 'object' || byDay === null || Array.isArray(byDay)) continue;
    const marks: Record<string, number> = {};
    for (const [date, value] of Object.entries(byDay as Record<string, unknown>)) {
      if (isDateOnly(date) && date.startsWith(month.slice(0, 7)) && (value === 7 || value === 30 || value === 100)) marks[date] = value;
    }
    out[month] = marks;
  }
  return out;
}

export async function readCalendarCache(userId: string, gymId: string): Promise<CalendarCache> {
  try {
    return parseCache(await AsyncStorage.getItem(calendarCacheKey(userId, gymId)));
  } catch {
    return { ...EMPTY_CACHE, months: {} };
  }
}

// Every write is a read-modify-write of one key, so two overlapping writes (a month and the first visit day, or two months) would each read the
// same old value and the later setItem would drop the earlier one. They run one at a time through this chain.
let writeChain: Promise<unknown> = Promise.resolve();

function update(userId: string, gymId: string, change: (cache: CalendarCache) => CalendarCache): Promise<boolean> {
  const run = writeChain.then(() => updateNow(userId, gymId, change));
  writeChain = run.catch(() => undefined);
  return run;
}

async function updateNow(userId: string, gymId: string, change: (cache: CalendarCache) => CalendarCache): Promise<boolean> {
  try {
    const key = calendarCacheKey(userId, gymId);
    const next = change(parseCache(await AsyncStorage.getItem(key)));
    const keep = Object.keys(next.months).sort().slice(-MAX_CACHED_MONTHS);
    const months: Record<string, string[]> = {};
    for (const month of keep) months[month] = next.months[month];
    let milestones: Record<string, Record<string, number>> | undefined;
    if (next.milestones) {
      milestones = {};
      for (const month of keep) if (next.milestones[month]) milestones[month] = next.milestones[month];
    }
    await AsyncStorage.setItem(key, JSON.stringify({ months, firstVisitDay: next.firstVisitDay, ...(milestones ? { milestones } : {}) }));
    return true;
  } catch {
    return false;
  }
}

/** Stores one loaded month, with its milestone markers when the caller has them (Story 30.7). Returns false when it could not be stored. */
export function writeCalendarMonth(
  userId: string,
  gymId: string,
  month: string,
  days: readonly string[],
  milestones?: Readonly<Record<string, number>>,
): Promise<boolean> {
  return update(userId, gymId, (cache) => ({
    ...cache,
    months: { ...cache.months, [month]: [...days] },
    ...(milestones ? { milestones: { ...(cache.milestones ?? {}), [month]: { ...milestones } } } : {}),
  }));
}

/** Stores the member's earliest visit day (the bound of the previous-month chevron while offline). */
export function writeCalendarFirstVisitDay(userId: string, gymId: string, firstVisitDay: string | null): Promise<boolean> {
  return update(userId, gymId, (cache) => ({ ...cache, firstVisitDay }));
}
