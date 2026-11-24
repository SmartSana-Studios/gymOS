import { createInstance } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, storage } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
  return { store, storage };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { Engagement } from '@/services/engagement';

import {
  buildCalendarView,
  cacheWithMonth,
  calendarCacheKey,
  milestonesOf,
  readyFromCache,
  readyFromServer,
  savedWeeksChoice,
  readCalendarCache,
  type CalendarCache,
  myVisitsRowAfterRead,
  myVisitsRowFromCache,
  SKELETON_CELLS,
  writeCalendarFirstVisitDay,
  writeCalendarMonth,
  type CalendarInput,
  type CalendarView,
  type DayCellView,
} from './calendarView';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr' = 'en', resources: { en: object; fr: object } = { en, fr }): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: resources.en }, fr: { translation: resources.fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

// Wednesday 25 Nov 2026 in Africa/Douala (UTC+1): the gym's day runs 23:00Z to 23:00Z. 17:00Z is six hours before the day ends.
const SERVER_NOW = '2026-11-25T17:00:00+00:00';
const DAY_STARTS = '2026-11-24T23:00:00+00:00';
const DAY_ENDS = '2026-11-25T23:00:00+00:00';
const NOW_MS = Date.parse(SERVER_NOW);
const TODAY = '2026-11-25';
const MONTH = '2026-11-01';
const DAYS = ['2026-11-03', '2026-11-10', '2026-11-12'];

const ROW: Engagement = {
  enabled: true,
  gymToday: TODAY,
  weekStart: '2026-11-23',
  weekEnd: '2026-11-29',
  inReleaseWeek: false,
  goal: 3,
  goalIsDefault: false,
  pendingGoal: null,
  pendingEffectiveWeek: null,
  visitsThisWeek: 2,
  goalMet: false,
  visitedToday: false,
  streakWeeks: 5,
  streakIfMet: null,
  bestStreakWeeks: 8,
  hasSettledWeek: true,
  daysLeftInWeek: 5,
  visitsNeeded: 1,
  atRiskWeekly: false,
  atRiskDaily: false,
  dailyRun: null,
  shieldsHeld: 0,
  comebackState: 'none',
  dayStartsAt: DAY_STARTS,
  dayEndsAt: DAY_ENDS,
  serverNow: SERVER_NOW,
  needsSettle: false,
  shieldEveryWeeks: 4,
  shieldCap: 2,
  weeksToNextShield: 3,
  savedWeekStart: null,
  savedWeekStreak: null,
  shieldEarnedWeek: null,
  comebackVisitsDone: 0,
  comebackVisitsGoal: 3,
  comebackWindowDays: 10,
  comebackWindowStart: null,
  comebackWindowEndsOn: null,
  pendingMilestone: null,
};

type Over = Partial<Omit<CalendarInput, 'snapshot'>> & { row?: Partial<Engagement>; fromCache?: boolean; noSnapshot?: boolean };

function input(over: Over = {}): CalendarInput {
  const { row, fromCache, noSnapshot, ...rest } = over;
  return {
    month: MONTH,
    snapshot: noSnapshot ? null : { engagement: { ...ROW, ...row }, fetchedAtDeviceMs: NOW_MS, fromCache: fromCache ?? false },
    engagementLoading: false,
    monthData: { kind: 'ready', days: DAYS, fromCache: false },
    firstVisitDay: '2026-03-05',
    selected: null,
    offline: false,
    connected: true,
    queuedScanTimes: [],
    deviceNowMs: NOW_MS,
    t: makeT('en'),
    language: 'en',
    ...rest,
  };
}

function build(over: Over = {}): CalendarView {
  return buildCalendarView(input(over));
}

function cell(view: CalendarView, date: string): DayCellView {
  for (const week of view.weeks) for (const c of week.cells) if (c.kind === 'day' && c.date === date) return c;
  throw new Error(`no cell for ${date}`);
}

const LANGS = ['en', 'fr'] as const;
const MILESTONE_MONTH = { kind: 'ready', days: DAYS, fromCache: false, milestones: { '2026-11-10': 30 } } as const;
const withLang = (lang: 'en' | 'fr', over: Over = {}): Over => ({ ...over, t: makeT(lang), language: lang });

// One fixture per cell state of MA-18, in both languages.
describe('cell states', () => {
  it.each(LANGS)('empty past day (%s)', (lang) => {
    expect(cell(build(withLang(lang)), '2026-11-04')).toEqual({
      kind: 'day',
      date: '2026-11-04',
      numeral: '4',
      lit: false,
      outline: 'none',
      glyph: null,
      milestone: null,
      shield: false,
      hoursText: null,
      bold: false,
      faded: false,
      tappable: true,
      selected: false,
      atRisk: false,
      accessibilityLabel: lang === 'en' ? 'Wednesday 4 November: no visit' : 'mercredi 4 novembre : pas de visite',
    });
  });

  it.each(LANGS)('visit day (%s)', (lang) => {
    expect(cell(build(withLang(lang)), '2026-11-10')).toEqual({
      kind: 'day',
      date: '2026-11-10',
      numeral: '10',
      lit: true,
      outline: 'none',
      glyph: 'check',
      milestone: null,
      shield: false,
      hoursText: null,
      bold: false,
      faded: false,
      tappable: true,
      selected: false,
      atRisk: false,
      accessibilityLabel: lang === 'en' ? 'Tuesday 10 November: visited' : 'mardi 10 novembre : visite',
    });
  });

  it.each(LANGS)('today, not visited, nothing at risk (%s)', (lang) => {
    const view = build(withLang(lang));
    expect(cell(view, TODAY)).toEqual({
      kind: 'day',
      date: TODAY,
      numeral: '25',
      lit: false,
      outline: 'accent',
      glyph: null,
      milestone: null,
      shield: false,
      hoursText: null,
      bold: true,
      faded: false,
      tappable: true,
      selected: false,
      atRisk: false,
      accessibilityLabel: lang === 'en' ? 'Today, Wednesday 25 November: no visit yet' : "Aujourd'hui, mercredi 25 novembre : pas encore de visite",
    });
    expect(view.atRiskLine).toBeNull();
  });

  it.each(LANGS)('today, visited: lit plus the outline (%s)', (lang) => {
    const view = build(withLang(lang, { monthData: { kind: 'ready', days: [...DAYS, TODAY], fromCache: false }, row: { visitedToday: true } }));
    expect(cell(view, TODAY)).toMatchObject({ lit: true, outline: 'accent', glyph: 'check', bold: true, atRisk: false });
    expect(cell(view, TODAY).accessibilityLabel).toBe(lang === 'en' ? 'Today, Wednesday 25 November: visited' : "Aujourd'hui, mercredi 25 novembre : visite");
  });

  it.each(LANGS)('today, at risk: warning outline, schedule glyph, hours left, and the line under the grid (%s)', (lang) => {
    const view = build(withLang(lang, { row: { atRiskWeekly: true } }));
    expect(cell(view, TODAY)).toEqual({
      kind: 'day',
      date: TODAY,
      numeral: '25',
      lit: false,
      outline: 'warning',
      glyph: 'schedule',
      milestone: null,
      shield: false,
      hoursText: '6 h',
      bold: true,
      faded: false,
      tappable: true,
      selected: false,
      atRisk: true,
      accessibilityLabel: lang === 'en' ? 'Today, Wednesday 25 November: no visit yet. 6 hours left' : "Aujourd'hui, mercredi 25 novembre : pas encore de visite. 6 heures restantes",
    });
    expect(view.atRiskLine).toEqual(
      lang === 'en'
        ? { text: 'Visit today to close your ring.', timeLeft: '6 hours left', label: 'Visit today to close your ring. 6 hours left' }
        : { text: "Venez aujourd'hui pour fermer votre cercle.", timeLeft: '6 heures restantes', label: "Venez aujourd'hui pour fermer votre cercle. 6 heures restantes" },
    );
  });

  it('the at-risk hours read in minutes under an hour', () => {
    const en40 = build({ row: { atRiskWeekly: true, dayEndsAt: '2026-11-25T17:45:00+00:00' } });
    expect(cell(en40, TODAY).hoursText).toBe('45 m');
    expect(en40.atRiskLine?.timeLeft).toBe('45 min left');
    const fr40 = build(withLang('fr', { row: { atRiskWeekly: true, dayEndsAt: '2026-11-25T17:45:00+00:00' } }));
    expect(cell(fr40, TODAY).hoursText).toBe('45 min');
  });

  it('the hours left follow the server clock, not the phone clock', () => {
    // The phone is two hours fast when the row arrives: 19:00Z on the phone, 17:00Z on the server. An hour later on both clocks, five hours remain.
    const view = buildCalendarView({
      ...input({ row: { atRiskWeekly: true } }),
      snapshot: { engagement: { ...ROW, atRiskWeekly: true }, fetchedAtDeviceMs: NOW_MS + 2 * 3600_000, fromCache: false },
      deviceNowMs: NOW_MS + 3 * 3600_000,
    });
    expect(cell(view, TODAY).hoursText).toBe('5 h');
  });

  it.each(LANGS)('future day: faded, no outline, not tappable (%s)', (lang) => {
    expect(cell(build(withLang(lang)), '2026-11-26')).toMatchObject({
      lit: false,
      outline: 'none',
      glyph: null,
      faded: true,
      tappable: false,
      accessibilityLabel: lang === 'en' ? 'Thursday 26 November' : 'jeudi 26 novembre',
    });
  });

  it('days outside the month are blank cells', () => {
    const first = build().weeks[0].cells;
    expect(first.slice(0, 6).every((c) => c.kind === 'blank')).toBe(true);
    expect(first[6]).toMatchObject({ kind: 'day', date: '2026-11-01' });
    const last = build().weeks[5].cells;
    expect(last[0]).toMatchObject({ kind: 'day', date: '2026-11-30', faded: true });
    expect(last.slice(1).every((c) => c.kind === 'blank')).toBe(true);
  });

  it.each(LANGS)('a scan queued on this phone lights today dashed with the waiting line (%s)', (lang) => {
    const view = build(withLang(lang, { offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }));
    expect(cell(view, TODAY)).toMatchObject({ lit: true, outline: 'dashed', glyph: 'check', atRisk: false });
    expect(cell(view, TODAY).accessibilityLabel).toBe(lang === 'en' ? 'Wednesday 25 November: waiting to sync' : 'mercredi 25 novembre : en attente de synchronisation');
    expect(view.detail).toBe(lang === 'en' ? 'Wednesday 25 November: waiting to sync' : 'mercredi 25 novembre : en attente de synchronisation');
    expect(view.atRiskLine).toBeNull();
  });

  it('a queued scan beside a visit the server already knows lights nothing extra (closes the 30.4 deferral)', () => {
    const view = build({
      offline: true,
      queuedScanTimes: ['2026-11-25T10:00:00.000Z'],
      row: { visitedToday: true },
      monthData: { kind: 'ready', days: [...DAYS, TODAY], fromCache: true },
    });
    expect(cell(view, TODAY)).toMatchObject({ lit: true, outline: 'accent' });
    expect(view.detail).toBe('Today, Wednesday 25 November: visited');
  });

  it('a queued scan lights today dashed even when the goal is met or in the release week', () => {
    for (const row of [{ goalMet: true, visitsThisWeek: 3 }, { inReleaseWeek: true }]) {
      const view = build({ row, offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] });
      expect(cell(view, TODAY)).toMatchObject({ lit: true, outline: 'dashed' });
      expect(view.detail).toBe('Wednesday 25 November: waiting to sync');
    }
  });

  it('a past month on screen still has the waiting-to-sync detail line for a visit queued today', () => {
    const view = build({ month: '2026-10-01', offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'], monthData: { kind: 'ready', days: [], fromCache: true } });
    expect(view.detail).toBe('Wednesday 25 November: waiting to sync');
  });

  it('a scan queued yesterday does not light today', () => {
    const view = build({ offline: true, queuedScanTimes: ['2026-11-20T10:00:00.000Z'] });
    expect(cell(view, TODAY)).toMatchObject({ lit: false, outline: 'accent' });
  });

  it('a queued scan shows only on the current month', () => {
    const view = build({ month: '2026-10-01', offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'], monthData: { kind: 'ready', days: [], fromCache: true } });
    expect(view.weeks.flatMap((w) => w.cells).some((c) => c.kind === 'day' && c.outline !== 'none')).toBe(false);
  });
});

describe('the at-risk rule (the Home rule, on the current month only)', () => {
  it.each([
    ['visited today', { atRiskWeekly: true, visitedToday: true }],
    ['the release week', { atRiskWeekly: true, inReleaseWeek: true }],
    ['the goal met', { atRiskWeekly: true, goalMet: true, visitsThisWeek: 3 }],
    ['an expired member (the server flag is false)', { atRiskWeekly: false }],
  ])('no at-risk cell or line for %s', (_name, row) => {
    const view = build({ row });
    expect(cell(view, TODAY).atRisk).toBe(false);
    expect(cell(view, TODAY).outline).toBe('accent');
    expect(view.atRiskLine).toBeNull();
  });

  it('the day has ended: no cell and no line', () => {
    const view = build({ row: { atRiskWeekly: true }, deviceNowMs: Date.parse(DAY_ENDS) + 1000 });
    expect(view.atRiskLine).toBeNull();
    expect(cell(view, TODAY).atRisk).toBe(false);
  });

  it('a past month shows no at-risk cell or line, but the detail line is still about today', () => {
    const view = build({ month: '2026-10-01', row: { atRiskWeekly: true }, monthData: { kind: 'ready', days: ['2026-10-05'], fromCache: false } });
    expect(view.atRiskLine).toBeNull();
    expect(view.weeks.flatMap((w) => w.cells).some((c) => c.kind === 'day' && c.atRisk)).toBe(false);
    expect(view.detail).toBe('Today, Wednesday 25 November: no visit yet. 6 hours left');
    // The hint itself survives the month change (the screen keeps it mounted, hidden), so returning does not replay its announcement.
    expect(view.atRiskHint).not.toBeNull();
    expect(build({ row: { atRiskWeekly: true } }).atRiskHint).toEqual(build({ row: { atRiskWeekly: true } }).atRiskLine);
    expect(build({}).atRiskHint).toBeNull();
  });

  it('a cached row follows the device clock for the end of the gym day, like Home', () => {
    const nextDay = Date.parse(DAY_ENDS) + 3600_000;
    expect(build({ row: { atRiskWeekly: true }, fromCache: true, deviceNowMs: nextDay }).atRiskLine).toBeNull();
    expect(build({ row: { atRiskWeekly: true }, fromCache: true }).atRiskLine).not.toBeNull();
  });
});

describe('the summary, the heading and the week rows', () => {
  it.each(LANGS)('a month with visits (%s)', (lang) => {
    const view = build(withLang(lang));
    expect(view.summary).toEqual(
      lang === 'en'
        ? { text: '3 visit days in November', before: '', numeral: '3', after: ' visit days in November' }
        : { text: '3 jours de visite en novembre', before: '', numeral: '3', after: ' jours de visite en novembre' },
    );
    expect(view.heading).toEqual(lang === 'en' ? { text: 'November 2026', accessibilityLabel: 'November 2026. 3 visit days.' } : { text: 'novembre 2026', accessibilityLabel: 'novembre 2026. 3 jours de visite.' });
  });

  it('one visit day is singular', () => {
    expect(build({ monthData: { kind: 'ready', days: ['2026-11-03'], fromCache: false } }).summary?.text).toBe('1 visit day in November');
    expect(build(withLang('fr', { monthData: { kind: 'ready', days: ['2026-11-03'], fromCache: false } })).summary?.text).toBe('1 jour de visite en novembre');
  });

  it.each(LANGS)('the empty current month (%s)', (lang) => {
    const view = build(withLang(lang, { monthData: { kind: 'ready', days: [], fromCache: false } }));
    expect(view.face).toBe('grid');
    expect(view.summary?.text).toBe(lang === 'en' ? 'No visits yet this month. Your first one lights today.' : "Aucune visite ce mois-ci pour l'instant. La première s'allumera aujourd'hui.");
    expect(view.weeks).toHaveLength(6);
  });

  it.each(LANGS)('an empty past month (%s)', (lang) => {
    const view = build(withLang(lang, { month: '2026-10-01', monthData: { kind: 'ready', days: [], fromCache: false } }));
    expect(view.summary?.text).toBe(lang === 'en' ? 'No visits in October.' : 'Aucune visite en octobre.');
    expect(view.weeks.length).toBeGreaterThanOrEqual(4);
  });

  it.each(LANGS)('each week row is grouped and labelled with its visit days (%s)', (lang) => {
    const view = build(withLang(lang));
    const rows = Object.fromEntries(view.weeks.map((w) => [w.key, w.accessibilityLabel]));
    expect(rows['2026-11-09']).toBe(lang === 'en' ? 'Week of 9 November, 2 visit days' : 'Semaine du 9 novembre, 2 jours de visite');
    expect(rows['2026-11-02']).toBe(lang === 'en' ? 'Week of 2 November, 1 visit day' : 'Semaine du 2 novembre, 1 jour de visite');
    expect(rows['2026-10-26']).toBe(lang === 'en' ? 'Week of 26 October, 0 visit days' : 'Semaine du 26 octobre, 0 jour de visite');
  });

  it('the weekday header starts on Monday', () => {
    expect(build().weekdays).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(build(withLang('fr')).weekdays).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
  });
});

describe('the month bar', () => {
  it('the current month: next is disabled, previous follows the first visit', () => {
    const bar = build().monthBar;
    expect(bar).toEqual({ label: 'November 2026', prevLabel: 'Previous month', nextLabel: 'Next month', canPrev: true, canNext: false });
    expect(build(withLang('fr')).monthBar).toMatchObject({ label: 'novembre 2026', prevLabel: 'Mois précédent', nextLabel: 'Mois suivant' });
  });
  it('the earliest month with a visit disables previous, and next opens', () => {
    const bar = build({ month: '2026-03-01', monthData: { kind: 'ready', days: ['2026-03-05'], fromCache: false } }).monthBar;
    expect(bar).toMatchObject({ canPrev: false, canNext: true });
  });
  it('with no visit at all, previous is disabled on the current month', () => {
    expect(build({ firstVisitDay: null }).monthBar.canPrev).toBe(false);
  });
  it('opens on the gym month when no month is given', () => {
    expect(build({ month: null }).monthBar.label).toBe('November 2026');
  });
});

describe('the detail line', () => {
  it('opens on today', () => {
    expect(build().detail).toBe('Today, Wednesday 25 November: no visit yet');
    expect(build({ row: { atRiskWeekly: true } }).detail).toBe('Today, Wednesday 25 November: no visit yet. 6 hours left');
    expect(build(withLang('fr', { row: { atRiskWeekly: true } })).detail).toBe("Aujourd'hui, mercredi 25 novembre : pas encore de visite. 6 heures restantes");
  });
  it.each(LANGS)('names the tapped date and says visited for a lit day (%s)', (lang) => {
    const view = build(withLang(lang, { selected: '2026-11-10' }));
    expect(view.detail).toBe(lang === 'en' ? 'Tuesday 10 November: visited' : 'mardi 10 novembre : visite');
    expect(cell(view, '2026-11-10').selected).toBe(true);
    expect(cell(view, '2026-11-12').selected).toBe(false);
  });
  it('says no visit for an unlit day', () => {
    expect(build({ selected: '2026-11-11' }).detail).toBe('Wednesday 11 November: no visit');
  });
  it('a selection outside the month on screen is ignored', () => {
    expect(build({ selected: '2026-10-10' }).detail).toBe('Today, Wednesday 25 November: no visit yet');
  });
  it('never shows a check-in time', () => {
    const view = build({ row: { atRiskWeekly: true }, selected: '2026-11-10' });
    const all = JSON.stringify(view);
    expect(all).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it('is absent when no month is drawn', () => {
    expect(build({ monthData: { kind: 'error' } }).detail).toBeNull();
  });
});

describe('the screen states', () => {
  it('loading: the month bar and the legend at once, no grid, no summary', () => {
    const view = build({ monthData: { kind: 'loading' } });
    expect(view.face).toBe('loading');
    expect(view.monthBar.label).toBe('November 2026');
    expect(view.legend).toEqual([
      { kind: 'visit', label: 'Visited' },
      { kind: 'today', label: 'Today' },
      { kind: 'milestone', label: 'Milestone' },
      { kind: 'shield', label: 'Saved by a Shield' },
    ]);
    expect(view.weeks).toEqual([]);
    expect(view.summary).toBeNull();
    expect(SKELETON_CELLS).toBe(35);
  });
  it('loading before today is known: the face is loading and the chevrons are disabled', () => {
    const view = build({ noSnapshot: true, engagementLoading: true, month: null });
    expect(view.face).toBe('loading');
    expect(view.monthBar).toMatchObject({ label: '', canPrev: false, canNext: false });
  });
  it.each(LANGS)('error: the message sits in the grid slot (%s)', (lang) => {
    const view = build(withLang(lang, { monthData: { kind: 'error' } }));
    expect(view.face).toBe('error');
    expect(view.message).toBe(lang === 'en' ? "Couldn't load your calendar. Pull down to refresh." : 'Impossible de charger votre calendrier. Tirez pour actualiser.');
    expect(view.weeks).toEqual([]);
    expect(view.retryLabel).toBeNull();
  });
  it('engagement not a success: the error face, no guess from the phone clock', () => {
    const view = build({ noSnapshot: true });
    expect(view.face).toBe('error');
    expect(view.message).toBe("Couldn't load your calendar. Pull down to refresh.");
    expect(view.weeks).toEqual([]);
  });
  it('engagement not enabled: the error face', () => {
    expect(build({ row: { enabled: false } }).face).toBe('error');
  });
  it.each(LANGS)('offline with a cached month: the grid and the banner (%s)', (lang) => {
    const view = build(withLang(lang, { offline: true, monthData: { kind: 'ready', days: DAYS, fromCache: true } }));
    expect(view.face).toBe('grid');
    expect(view.banner).toBe(lang === 'en' ? "You're offline. Showing your last saved calendar." : 'Vous êtes hors ligne. Dernier calendrier enregistré affiché.');
    expect(cell(view, '2026-11-10').lit).toBe(true);
  });
  it('online with fresh data: no banner', () => {
    expect(build().banner).toBeNull();
  });
  it.each(LANGS)('offline and a month never loaded: the message and a retry (%s)', (lang) => {
    const view = build(withLang(lang, { offline: true, connected: false, monthData: { kind: 'unavailable' } }));
    expect(view.face).toBe('offlineNone');
    expect(view.message).toBe(lang === 'en' ? "This month isn't saved on your phone yet. Connect to see it." : "Ce mois n'est pas encore enregistré sur votre téléphone. Connectez-vous pour le voir.");
    expect(view.retryLabel).toBe(lang === 'en' ? 'Try again' : 'Réessayer');
    expect(view.weeks).toEqual([]);
  });
  it('a failed read while connected is the error face, not offline; not connected is offlineNone', () => {
    expect(build({ noSnapshot: true, offline: true, connected: true }).face).toBe('error');
    expect(build({ noSnapshot: true, offline: true, connected: false }).face).toBe('offlineNone');
    expect(build({ noSnapshot: true, offline: true, connected: true }).message).toBe("Couldn't load your calendar. Pull down to refresh.");
  });
  it('offline with nothing on the device at all (no today): the offline message, not the error', () => {
    expect(build({ noSnapshot: true, offline: true, connected: false }).face).toBe('offlineNone');
  });
});

describe('milestone markers (Story 30.7)', () => {
  it.each(LANGS)('a milestone day: the star, the catalog label, in %s', (lang) => {
    const view = build(withLang(lang, { monthData: MILESTONE_MONTH }));
    expect(cell(view, '2026-11-10')).toMatchObject({ lit: true, glyph: 'check', milestone: 30 });
    expect(cell(view, '2026-11-10').accessibilityLabel).toBe(lang === 'en' ? 'Tuesday 10 November: your 30th visit' : 'mardi 10 novembre : votre 30e visite');
    expect(cell(view, '2026-11-12').milestone).toBeNull();
  });
  it.each(LANGS)('the legend lists Milestone third and the Shield fourth, in %s', (lang) => {
    const view = build(withLang(lang));
    expect(view.legend.map((item) => item.kind)).toEqual(['visit', 'today', 'milestone', 'shield']);
    expect(view.legend[2].label).toBe(lang === 'en' ? 'Milestone' : 'Étape');
    expect(view.legend[3].label).toBe(lang === 'en' ? 'Saved by a Shield' : 'Sauvé par un bouclier');
  });
  it.each(LANGS)('the day detail line of a tapped milestone day reads the catalog line (%s)', (lang) => {
    const view = build(withLang(lang, { monthData: MILESTONE_MONTH, selected: '2026-11-10' }));
    expect(view.detail).toBe(lang === 'en' ? 'Tuesday 10 November: your 30th visit' : 'mardi 10 novembre : votre 30e visite');
  });
  it.each([7, 100] as const)('the %s marker uses its own label key', (n) => {
    const view = build({ monthData: { kind: 'ready', days: DAYS, fromCache: false, milestones: { '2026-11-03': n } } });
    expect(cell(view, '2026-11-03').milestone).toBe(n);
    expect(cell(view, '2026-11-03').accessibilityLabel).toBe(`Tuesday 3 November: your ${n === 7 ? '7th' : '100th'} visit`);
  });
  it('a number that is not a milestone, a marker on an unlit day and a month without markers draw nothing', () => {
    const view = build({ monthData: { kind: 'ready', days: DAYS, fromCache: false, milestones: { '2026-11-03': 8, '2026-11-04': 30 } } });
    expect(cell(view, '2026-11-03').milestone).toBeNull();
    expect(cell(view, '2026-11-04').milestone).toBeNull();
    expect(build().weeks.flatMap((w) => w.cells).every((c) => c.kind === 'blank' || c.milestone === null)).toBe(true);
  });
  it('a milestone is never colour alone: the cell carries the number and the label names it', () => {
    const cellView = cell(build({ monthData: MILESTONE_MONTH }), '2026-11-10');
    expect(cellView.milestone).not.toBeNull();
    expect(cellView.accessibilityLabel).toContain('30th');
  });
  it('a milestone today keeps the milestone label (the visit that earned it)', () => {
    const view = build({ monthData: { kind: 'ready', days: [...DAYS, TODAY], fromCache: false, milestones: { [TODAY]: 7 } }, row: { visitedToday: true } });
    expect(cell(view, TODAY)).toMatchObject({ lit: true, outline: 'accent', milestone: 7 });
  });
});

describe('wording is data (sentinel)', () => {
  function swapped(path: string[], value: string): TFn {
    const clone = JSON.parse(JSON.stringify(en)) as Record<string, unknown>;
    let node = clone;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[path[path.length - 1]] = value;
    return makeT('en', { en: clone, fr });
  }
  const atRisk = { row: { atRiskWeekly: true } };
  it.each([
    [['engage', 'calendar', 'prev'], {}, (v: CalendarView) => v.monthBar.prevLabel],
    [['engage', 'calendar', 'next'], {}, (v: CalendarView) => v.monthBar.nextLabel],
    [['engage', 'calendar', 'monthSummary_other'], {}, (v: CalendarView) => v.summary?.text],
    [['engage', 'calendar', 'legend', 'visit'], {}, (v: CalendarView) => v.legend[0].label],
    [['engage', 'calendar', 'legend', 'today'], {}, (v: CalendarView) => v.legend[1].label],
    [['engage', 'calendar', 'legend', 'milestone'], {}, (v: CalendarView) => v.legend[2].label],
    [['engage', 'calendar', 'day', 'milestone30'], { monthData: MILESTONE_MONTH }, (v: CalendarView) => cell(v, '2026-11-10').accessibilityLabel],
    [['engage', 'calendar', 'day', 'milestone7'], { monthData: { ...MILESTONE_MONTH, milestones: { '2026-11-12': 7 } } }, (v: CalendarView) => cell(v, '2026-11-12').accessibilityLabel],
    [['engage', 'calendar', 'day', 'milestone100'], { monthData: { ...MILESTONE_MONTH, milestones: { '2026-11-03': 100 } } }, (v: CalendarView) => cell(v, '2026-11-03').accessibilityLabel],
    [['engage', 'calendar', 'day', 'milestone30'], { monthData: MILESTONE_MONTH, selected: '2026-11-10' }, (v: CalendarView) => v.detail],
    [['engage', 'calendar', 'day', 'visited'], {}, (v: CalendarView) => cell(v, '2026-11-10').accessibilityLabel],
    [['engage', 'calendar', 'day', 'none'], {}, (v: CalendarView) => cell(v, '2026-11-04').accessibilityLabel],
    [['engage', 'calendar', 'day', 'today', 'none'], {}, (v: CalendarView) => cell(v, TODAY).accessibilityLabel],
    [['engage', 'calendar', 'day', 'today', 'atRisk'], atRisk, (v: CalendarView) => cell(v, TODAY).accessibilityLabel],
    [['engage', 'calendar', 'cell', 'hours_other'], atRisk, (v: CalendarView) => cell(v, TODAY).hoursText],
    [['engage', 'calendar', 'week', 'a11y_other'], {}, (v: CalendarView) => v.weeks[2].accessibilityLabel],
    [['engage', 'calendar', 'heading', 'a11y_other'], {}, (v: CalendarView) => v.heading.accessibilityLabel],
    [['engage', 'calendar', 'empty', 'current'], { monthData: { kind: 'ready', days: [], fromCache: false } }, (v: CalendarView) => v.summary?.text],
    [['engage', 'calendar', 'empty', 'past'], { month: '2026-10-01', monthData: { kind: 'ready', days: [], fromCache: false } }, (v: CalendarView) => v.summary?.text],
    [['engage', 'calendar', 'offline', 'banner'], { offline: true, monthData: { kind: 'ready', days: DAYS, fromCache: true } }, (v: CalendarView) => v.banner],
    [['engage', 'calendar', 'offline', 'none'], { monthData: { kind: 'unavailable' } }, (v: CalendarView) => v.message],
    [['engage', 'calendar', 'error'], { monthData: { kind: 'error' } }, (v: CalendarView) => v.message],
    [['engage', 'calendar', 'title'], {}, (v: CalendarView) => v.title],
    [['engage', 'atRisk', 'weekly'], atRisk, (v: CalendarView) => v.atRiskLine?.text],
  ] as const)('%s', (path, over, pick) => {
    const sentinel = `SENTINEL-${path.join('.')}`;
    const view = build({ ...(over as object), t: swapped([...path], sentinel) });
    const value = (pick as (v: CalendarView) => string | null | undefined)(view);
    expect(value).toContain(sentinel);
  });
});

describe('the Profile "My visits" row gate', () => {
  it('after a live read: the server answers when it can, a failed read leaves what is showing', () => {
    for (const current of [true, false]) {
      expect(myVisitsRowAfterRead(current, { status: 'success', engagement: { ...ROW, enabled: true } })).toBe(true);
      expect(myVisitsRowAfterRead(current, { status: 'success', engagement: { ...ROW, enabled: false } })).toBe(false);
      expect(myVisitsRowAfterRead(current, { status: 'unavailable' })).toBe(false);
      expect(myVisitsRowAfterRead(current, { status: 'error' })).toBe(current);
    }
  });

  it('from the device copy: only a copy that says the area is on shows the row (offline, before the live read)', () => {
    expect(myVisitsRowFromCache({ engagement: { ...ROW, enabled: true }, fetchedAtDeviceMs: 1 })).toBe(true);
    expect(myVisitsRowFromCache({ engagement: { ...ROW, enabled: false }, fetchedAtDeviceMs: 1 })).toBe(false);
    expect(myVisitsRowFromCache(null)).toBe(false);
  });
});

describe('the device cache', () => {
  beforeEach(() => {
    store.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
  });

  it('keeps the milestone markers per month, in parallel to the days (Story 30.7)', async () => {
    await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03', '2026-11-10'], { '2026-11-10': 30 });
    await writeCalendarMonth('u1', 'g1', '2026-10-01', ['2026-10-05'], {});
    expect(await readCalendarCache('u1', 'g1')).toEqual({
      months: { '2026-11-01': ['2026-11-03', '2026-11-10'], '2026-10-01': ['2026-10-05'] },
      firstVisitDay: null,
      milestones: { '2026-11-01': { '2026-11-10': 30 }, '2026-10-01': {} },
    });
  });
  it('an old copy with no markers still reads, and a later write adds them', async () => {
    store.set(calendarCacheKey('u1', 'g1'), JSON.stringify({ months: { '2026-11-01': ['2026-11-03'] }, firstVisitDay: '2026-03-05' }));
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: { '2026-11-01': ['2026-11-03'] }, firstVisitDay: '2026-03-05' });
    await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03'], { '2026-11-03': 7 });
    expect((await readCalendarCache('u1', 'g1')).milestones).toEqual({ '2026-11-01': { '2026-11-03': 7 } });
  });
  it('keeps the Shield-saved weeks per month in parallel, drops a damaged one, and trims them with the month (Story 31.1)', async () => {
    await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03'], {}, ['2026-11-09']);
    expect((await readCalendarCache('u1', 'g1')).savedWeeks).toEqual({ '2026-11-01': ['2026-11-09'] });
    await writeCalendarMonth('u1', 'g1', '2026-10-01', ['2026-10-05'], {});
    expect((await readCalendarCache('u1', 'g1')).savedWeeks).toEqual({ '2026-11-01': ['2026-11-09'] });
    store.set(calendarCacheKey('u1', 'g1'), JSON.stringify({ months: { '2026-11-01': [] }, firstVisitDay: null, savedWeeks: { '2026-11-01': ['2026-11-09', 'x', 5], bad: ['2026-11-09'] } }));
    expect((await readCalendarCache('u1', 'g1')).savedWeeks).toEqual({ '2026-11-01': ['2026-11-09'] });
  });
  it('a damaged marker is dropped, never drawn', async () => {
    store.set(
      calendarCacheKey('u1', 'g1'),
      JSON.stringify({ months: { '2026-11-01': ['2026-11-03'] }, firstVisitDay: null, milestones: { '2026-11-01': { '2026-11-03': 8, '2026-10-03': 7, 'x': 30 }, bad: { '2026-11-03': 7 } } }),
    );
    expect((await readCalendarCache('u1', 'g1')).milestones).toEqual({ '2026-11-01': {} });
  });
  it('the markers of a month trimmed past the latest 36 go with it', async () => {
    for (let i = 0; i < 38; i++) {
      const month = `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
      await writeCalendarMonth('u1', 'g1', month, [], {});
    }
    const cache = await readCalendarCache('u1', 'g1');
    expect(Object.keys(cache.milestones ?? {})).toEqual(Object.keys(cache.months));
  });

  it('keys by member and gym', () => {
    expect(calendarCacheKey('u1', 'g1')).not.toBe(calendarCacheKey('u1', 'g2'));
    expect(calendarCacheKey('u1', 'g1')).not.toBe(calendarCacheKey('u2', 'g1'));
  });
  it('round-trips a month and the first visit day', async () => {
    expect(await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03', '2026-11-10'])).toBe(true);
    expect(await writeCalendarMonth('u1', 'g1', '2026-10-01', ['2026-10-05'])).toBe(true);
    expect(await writeCalendarFirstVisitDay('u1', 'g1', '2026-03-05')).toBe(true);
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: { '2026-11-01': ['2026-11-03', '2026-11-10'], '2026-10-01': ['2026-10-05'] }, firstVisitDay: '2026-03-05' });
    expect(await readCalendarCache('u2', 'g1')).toEqual({ months: {}, firstVisitDay: null });
  });
  it('a month is overwritten by a later load', async () => {
    await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03']);
    await writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03', '2026-11-04']);
    expect((await readCalendarCache('u1', 'g1')).months['2026-11-01']).toEqual(['2026-11-03', '2026-11-04']);
  });
  it('keeps the latest 36 months', async () => {
    for (let i = 0; i < 40; i++) {
      const month = `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`;
      await writeCalendarMonth('u1', 'g1', month, []);
    }
    const months = Object.keys((await readCalendarCache('u1', 'g1')).months).sort();
    expect(months).toHaveLength(36);
    expect(months[0]).toBe('2020-05-01');
    expect(months[35]).toBe('2023-04-01');
  });
  it('overlapping writes each keep their change', async () => {
    await Promise.all([
      writeCalendarMonth('u1', 'g1', '2026-11-01', ['2026-11-03']),
      writeCalendarFirstVisitDay('u1', 'g1', '2026-03-05'),
      writeCalendarMonth('u1', 'g1', '2026-10-01', ['2026-10-05']),
    ]);
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: { '2026-11-01': ['2026-11-03'], '2026-10-01': ['2026-10-05'] }, firstVisitDay: '2026-03-05' });
  });
  it('reads damaged data as no cache, never throws', async () => {
    store.set(calendarCacheKey('u1', 'g1'), '{not json');
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: {}, firstVisitDay: null });
    store.set(calendarCacheKey('u1', 'g1'), JSON.stringify({ months: { '2026-11-15': ['2026-11-03'], '2026-10-01': ['2026-11-03'], '2026-09-01': 'x', '2026-08-01': ['2026-08-03'] }, firstVisitDay: 'soon' }));
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: { '2026-08-01': ['2026-08-03'] }, firstVisitDay: null });
  });
  it('fails open when storage throws', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('denied'));
    expect(await readCalendarCache('u1', 'g1')).toEqual({ months: {}, firstVisitDay: null });
    storage.getItem.mockRejectedValueOnce(new Error('denied'));
    expect(await writeCalendarMonth('u1', 'g1', '2026-11-01', [])).toBe(false);
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await writeCalendarMonth('u1', 'g1', '2026-11-01', [])).toBe(false);
  });
});

describe('the milestone plumbing of the calendar hook (Story 30.7)', () => {
  const SERVER_DAYS = [
    { visitDay: '2026-11-03', milestone: null },
    { visitDay: '2026-11-10', milestone: 30 },
  ];

  it('a server month with milestone 30 reaches monthData.milestones and then the cell', () => {
    expect(milestonesOf(SERVER_DAYS)).toEqual({ '2026-11-10': 30 });
    const monthData = readyFromServer(SERVER_DAYS);
    expect(monthData).toEqual({ kind: 'ready', days: ['2026-11-03', '2026-11-10'], fromCache: false, milestones: { '2026-11-10': 30 } });
    expect(cell(build({ monthData }), '2026-11-10').milestone).toBe(30);
  });

  it('the offline fallback carries the cached markers; an old copy without them still reads', () => {
    const cache = { months: { '2026-11-01': ['2026-11-03', '2026-11-10'], '2026-10-01': ['2026-10-05'] }, firstVisitDay: null, milestones: { '2026-11-01': { '2026-11-10': 30 } } };
    const fromCache = readyFromCache(cache, '2026-11-01');
    expect(fromCache).toEqual({ kind: 'ready', days: ['2026-11-03', '2026-11-10'], fromCache: true, milestones: { '2026-11-10': 30 } });
    expect(cell(build({ monthData: fromCache ?? { kind: 'error' } }), '2026-11-10').milestone).toBe(30);
    const old = readyFromCache({ months: cache.months, firstVisitDay: null }, '2026-11-01');
    expect(old).toMatchObject({ kind: 'ready', fromCache: true, days: ['2026-11-03', '2026-11-10'] });
    expect(cell(build({ monthData: old ?? { kind: 'error' } }), '2026-11-10').milestone).toBeNull();
    expect(readyFromCache(cache, '2026-09-01')).toBeNull();
    expect(readyFromCache(null, '2026-11-01')).toBeNull();
  });

  it('the in-memory cache keeps the markers of the month just read and every other month', () => {
    const next = cacheWithMonth({ months: { '2026-10-01': ['2026-10-05'] }, firstVisitDay: '2026-03-05', milestones: { '2026-10-01': { '2026-10-05': 7 } } }, '2026-11-01', ['2026-11-10'], { '2026-11-10': 30 });
    expect(next).toEqual({
      months: { '2026-10-01': ['2026-10-05'], '2026-11-01': ['2026-11-10'] },
      firstVisitDay: '2026-03-05',
      milestones: { '2026-10-01': { '2026-10-05': 7 }, '2026-11-01': { '2026-11-10': 30 } },
    });
    expect(readyFromCache(next, '2026-11-01')).toMatchObject({ milestones: { '2026-11-10': 30 } });
  });
});

describe('Shield-saved weeks (Story 31.1)', () => {
  // The week of Monday 9 November 2026: its Sunday is the 15th.
  const SAVED = { kind: 'ready' as const, days: DAYS, fromCache: false, savedWeeks: ['2026-11-09'] };

  it.each(LANGS)('the Sunday of a saved week carries the shield glyph and its words, no other day does (%s)', (lang) => {
    const view = build({ ...withLang(lang), monthData: SAVED });
    expect(cell(view, '2026-11-15').shield).toBe(true);
    expect(cell(view, '2026-11-14').shield).toBe(false);
    expect(cell(view, '2026-11-09').shield).toBe(false);
    expect(cell(view, '2026-11-08').shield).toBe(false);
    const words = lang === 'en' ? 'Your Shield saved Sunday 15 November. Your run goes on.' : 'Votre bouclier a sauvé le dimanche 15 novembre. Votre série continue.';
    expect(cell(view, '2026-11-15').accessibilityLabel).toContain(words);
    expect(cell(view, '2026-11-14').accessibilityLabel).not.toContain('Shield');
  });

  it('the saved row has the hairline flag, the others do not', () => {
    const view = build({ monthData: SAVED });
    expect(view.weeks.filter((w) => w.saved).map((w) => w.key)).toEqual(['2026-11-09']);
  });

  it.each(LANGS)('a tapped day inside the saved week adds the short saved-week sentence to the detail line (%s)', (lang) => {
    const view = build({ ...withLang(lang), monthData: SAVED, selected: '2026-11-12' });
    expect(view.detail).toContain(lang === 'en' ? 'Your Shield saved the week of 9 November.' : 'Votre bouclier a sauvé la semaine du 9 novembre.');
    expect(build({ ...withLang(lang), monthData: SAVED, selected: '2026-11-04' }).detail).not.toContain('Shield');
  });

  it('a month with no saved weeks, or a copy stored before 31.1, shows no glyph and no hairline', () => {
    const view = build();
    expect(view.weeks.some((w) => w.saved)).toBe(false);
    expect(view.weeks.flatMap((w) => w.cells).some((c) => c.kind === 'day' && c.shield)).toBe(false);
  });

  it('the saved weeks travel through the server read and the in-memory cache, and an old cache still reads', () => {
    expect(readyFromServer([], ['2026-11-09'])).toMatchObject({ savedWeeks: ['2026-11-09'] });
    expect('savedWeeks' in readyFromServer([])).toBe(false);
    const cache = cacheWithMonth({ months: {}, firstVisitDay: null }, '2026-11-01', ['2026-11-10'], {}, ['2026-11-09']);
    expect(cache.savedWeeks).toEqual({ '2026-11-01': ['2026-11-09'] });
    expect(readyFromCache(cache, '2026-11-01')).toMatchObject({ fromCache: true, savedWeeks: ['2026-11-09'] });
    expect(readyFromCache({ months: { '2026-11-01': ['2026-11-10'] }, firstVisitDay: null }, '2026-11-01')).not.toHaveProperty('savedWeeks');
  });

  it('savedWeeksChoice: only a successful read is authoritative for the cache', () => {
    // success: shown and stored, an empty list included (the server said "none")
    expect(savedWeeksChoice({ status: 'success', weeks: ['2026-11-09'] }, ['2026-10-26'])).toEqual({ shown: ['2026-11-09'], store: ['2026-11-09'] });
    expect(savedWeeksChoice({ status: 'success', weeks: [] }, ['2026-10-26'])).toEqual({ shown: [], store: [] });
    // failure with a cached copy: the copy is shown and nothing new is stored
    expect(savedWeeksChoice({ status: 'error' }, ['2026-10-26'])).toEqual({ shown: ['2026-10-26'], store: undefined });
    // failure without a copy: nothing is shown, and the empty fallback is NOT written as if the server had said so
    expect(savedWeeksChoice({ status: 'error' }, undefined)).toEqual({ shown: [], store: undefined });
    const base: CalendarCache = { months: {}, firstVisitDay: null, savedWeeks: { '2026-11-01': ['2026-11-09'] } };
    expect(cacheWithMonth(base, '2026-11-01', ['2026-11-10'], {}, undefined).savedWeeks).toEqual({ '2026-11-01': ['2026-11-09'] });
    expect(cacheWithMonth({ months: {}, firstVisitDay: null }, '2026-11-01', [], {}, undefined)).not.toHaveProperty('savedWeeks');
  });
});
