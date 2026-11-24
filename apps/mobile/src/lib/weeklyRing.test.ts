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

import type { TFn } from './weeklyGoalSheet';
import {
  arcPaths,
  buildHomeEngagementView,
  buildSegments,
  engagementCacheKey,
  isEngagement,
  loadEngagement,
  msLeftInDay,
  queuedTodayCount,
  readEngagementCache,
  shouldStack,
  timeLeftParts,
  writeEngagementCache,
  type CardView,
  type HomeEngagementInput,
} from './weeklyRing';

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

const ROW: Engagement = {
  enabled: true,
  gymToday: '2026-11-25',
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

function input(over: Partial<Omit<HomeEngagementInput, 'snapshot'>> & { row?: Partial<Engagement>; fromCache?: boolean; fetchedAtDeviceMs?: number } = {}): HomeEngagementInput {
  const { row, fromCache, fetchedAtDeviceMs, ...rest } = over;
  return {
    snapshot: { engagement: { ...ROW, ...row }, fetchedAtDeviceMs: fetchedAtDeviceMs ?? NOW_MS, fromCache: fromCache ?? false },
    dark: false,
    busy: false,
    skeletonExpired: false,
    cachedEnabled: null,
    loadFailed: false,
    offline: false,
    settleFailed: false,
    queuedScanTimes: [],
    goalHintSeen: true,
    shieldSeen: new Set<string>(),
    deviceNowMs: NOW_MS,
    t: makeT('en'),
    language: 'en',
    ...rest,
  };
}

function card(over: Parameters<typeof input>[0] = {}): CardView {
  const view = buildHomeEngagementView(input(over));
  if (view.kind !== 'card') throw new Error(`expected a card, got ${view.kind}`);
  return view;
}

// One fixture per state of the N1 table, rendered in both languages through real i18next instances. `expect` holds the strings each language shows.
interface Fixture {
  name: string;
  over: Parameters<typeof input>[0];
  en: { centre: string; caption: string; streak: string | null; hint?: string; a11y: string; note?: string };
  fr: { centre: string; caption: string; streak: string | null; hint?: string; a11y: string; note?: string };
}

const FIXTURES: Fixture[] = [
  {
    name: 'in progress: goal 3, 2 visits',
    over: {},
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: '5 weeks in a row', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: "5 semaines d'affilée", a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'over goal: 5 visits, goal 3',
    over: { row: { visitsThisWeek: 5, goalMet: true, visitsNeeded: 0 } },
    en: { centre: '3 / 3', caption: '2 extra visits this week.', streak: '5 weeks in a row', a11y: 'Weekly goal met: 3 of 3.' },
    fr: { centre: '3 / 3', caption: '2 visites en plus cette semaine.', streak: "5 semaines d'affilée", a11y: 'Objectif de la semaine atteint : 3 sur 3.' },
  },
  {
    name: 'fresh week: 0 visits, chip kept',
    over: { row: { visitsThisWeek: 0, visitsNeeded: 3 } },
    en: { centre: '0 / 3', caption: 'A fresh week. 3 visits close your ring.', streak: '5 weeks in a row', a11y: 'Weekly goal: 0 of 3 visit days this week. 3 more visits close your ring.' },
    fr: { centre: '0 / 3', caption: 'Nouvelle semaine. 3 visites pour fermer votre cercle.', streak: "5 semaines d'affilée", a11y: 'Objectif de la semaine : 0 sur 3 jours de visite. Encore 3 visites pour fermer votre cercle.' },
  },
  {
    name: 'streak of 1 reads First week done',
    over: { row: { streakWeeks: 1 } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: 'First week done', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: 'Première semaine réussie', a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'streak 0 with a best of 8',
    over: { row: { streakWeeks: 0, bestStreakWeeks: 8 } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: 'Best: 8 weeks', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: 'Meilleure série : 8 semaines', a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'streak 0 with best 0 shows nothing',
    over: { row: { streakWeeks: 0, bestStreakWeeks: 0 } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: null, a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: null, a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'release week: ring only',
    over: { row: { inReleaseWeek: true, hasSettledWeek: false, streakWeeks: 0, bestStreakWeeks: 0, atRiskWeekly: true } },
    en: { centre: '2 / 3', caption: "Your streak starts next Monday. This week's visits still show on your calendar.", streak: null, a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Votre série démarre lundi prochain. Les visites de cette semaine figurent déjà dans votre calendrier.', streak: null, a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'first week: no chip, the first-week line',
    over: { row: { hasSettledWeek: false, streakWeeks: 0, bestStreakWeeks: 0 } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: 'Close your ring to start your streak.', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: 'Fermez votre cercle pour lancer votre série.', a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'goal met: the chip shows the settled count, the caption the count it becomes',
    over: { row: { visitsThisWeek: 3, goalMet: true, visitsNeeded: 0, streakWeeks: 5, streakIfMet: 6 } },
    en: { centre: '3 / 3', caption: 'Goal met. Your streak becomes 6 weeks when the week ends.', streak: '5 weeks in a row', a11y: 'Weekly goal met: 3 of 3.' },
    fr: { centre: '3 / 3', caption: 'Objectif atteint. Votre série passera à 6 semaines à la fin de la semaine.', streak: "5 semaines d'affilée", a11y: 'Objectif de la semaine atteint : 3 sur 3.' },
  },
  {
    name: 'goal met with no streak yet',
    over: { row: { visitsThisWeek: 3, goalMet: true, visitsNeeded: 0, streakWeeks: 0, bestStreakWeeks: 0, hasSettledWeek: true, streakIfMet: null } },
    en: { centre: '3 / 3', caption: 'Goal met. Nice week.', streak: null, a11y: 'Weekly goal met: 3 of 3.' },
    fr: { centre: '3 / 3', caption: 'Objectif atteint. Belle semaine.', streak: null, a11y: 'Objectif de la semaine atteint : 3 sur 3.' },
  },
  {
    name: 'at risk: 6 hours left',
    over: { row: { atRiskWeekly: true } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: '5 weeks in a row', hint: 'Visit today to close your ring. 6 hours left', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: "5 semaines d'affilée", hint: "Venez aujourd'hui pour fermer votre cercle. 6 heures restantes", a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'at risk: 40 minutes left',
    over: { row: { atRiskWeekly: true, dayEndsAt: '2026-11-25T17:40:00+00:00' } },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: '5 weeks in a row', hint: 'Visit today to close your ring. 40 min left', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: "5 semaines d'affilée", hint: "Venez aujourd'hui pour fermer votre cercle. 40 min restantes", a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.' },
  },
  {
    name: 'offline: one scan queued today',
    over: { offline: true, queuedScanTimes: ['2026-11-25T15:30:00.000Z'] },
    en: { centre: '2 / 3', caption: '1 more visit closes your ring.', streak: '5 weeks in a row', a11y: 'Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring.', note: '1 visit waiting to sync' },
    fr: { centre: '2 / 3', caption: 'Encore 1 visite pour fermer votre cercle.', streak: "5 semaines d'affilée", a11y: 'Objectif de la semaine : 2 sur 3 jours de visite. Encore 1 visite pour fermer votre cercle.', note: '1 visite en attente de synchronisation' },
  },
];

describe.each(['en', 'fr'] as const)('the card in %s', (lang) => {
  it.each(FIXTURES)('$name', (fixture) => {
    const view = card({ ...fixture.over, t: makeT(lang), language: lang });
    const expected = fixture[lang];
    expect(view.ring.centre).toBe(expected.centre);
    expect(view.caption).toBe(expected.caption);
    expect(view.ring.accessibilityLabel).toBe(expected.a11y);
    expect(view.ring.unit).toBe(lang === 'en' ? 'days' : 'jours');
    expect(view.title).toBe(lang === 'en' ? 'This week' : 'Cette semaine');
    const streakText = view.streak.kind === 'none' ? null : view.streak.label;
    expect(streakText).toBe(expected.streak);
    expect(view.hint ? view.hint.label : undefined).toBe(expected.hint);
    expect(view.pendingSyncNote ?? undefined).toBe(expected.note);
  });
});

describe('the first-week line', () => {
  it('is not shown beside a closed ring', () => {
    const view = card({ row: { hasSettledWeek: false, streakWeeks: 0, bestStreakWeeks: 0, goalMet: true, visitsThisWeek: 3, visitsNeeded: 0 } });
    expect(view.streak).toEqual({ kind: 'none' });
    expect(view.captionKey).toBe('engage.ring.caption.met');
  });
});

describe('the ring sentence in French reads for 0 and 1 visit', () => {
  it.each([
    [0, 3, 'Objectif de la semaine : 0 sur 3 jours de visite. Encore 3 visites pour fermer votre cercle.'],
    [1, 2, 'Objectif de la semaine : 1 sur 3 jours de visite. Encore 2 visites pour fermer votre cercle.'],
  ])('%i visit', (visits, needed, expected) => {
    expect(card({ row: { visitsThisWeek: visits, visitsNeeded: needed }, t: makeT('fr'), language: 'fr' }).ring.accessibilityLabel).toBe(expected);
  });
});

describe('ring segments', () => {
  it('2 of 3: two accent, one empty', () => {
    expect(card().ring.segments).toEqual(['filled', 'filled', 'empty']);
  });

  it('over goal: all success, the centre stays at the goal and the extra visits add no segment', () => {
    const view = card({ row: { visitsThisWeek: 5, goalMet: true, visitsNeeded: 0 } });
    expect(view.ring.segments).toEqual(['success', 'success', 'success']);
    expect(view.ring.centre).toBe('3 / 3');
    expect(view.ring.met).toBe(true);
    expect(view.captionKey).toBe('engage.ring.caption.extra');
  });

  it('fresh week: every segment empty and the figure reads 0 / 3', () => {
    const view = card({ row: { visitsThisWeek: 0, visitsNeeded: 3 } });
    expect(view.ring.segments).toEqual(['empty', 'empty', 'empty']);
    expect(view.ring.centre).toBe('0 / 3');
  });

  it('one segment per goal day, for every goal from 1 to 7', () => {
    for (let goal = 1; goal <= 7; goal++) {
      expect(card({ row: { goal, visitsThisWeek: 0, visitsNeeded: goal } }).ring.segments).toHaveLength(goal);
      expect(arcPaths(goal)).toHaveLength(goal);
    }
  });

  it('is one progressbar value: min 0, max goal, now visits (clamped to the goal)', () => {
    expect(card().ring.accessibilityValue).toEqual({ min: 0, max: 3, now: 2 });
    expect(card({ row: { visitsThisWeek: 5, goalMet: true } }).ring.accessibilityValue).toEqual({ min: 0, max: 3, now: 3 });
  });

  it('buildSegments caps dashed so that filled plus dashed never exceeds the goal', () => {
    expect(buildSegments(3, 2, false, 5)).toEqual(['filled', 'filled', 'dashed']);
    expect(buildSegments(3, 0, false, 2)).toEqual(['dashed', 'dashed', 'empty']);
    expect(buildSegments(3, 3, true, 2)).toEqual(['success', 'success', 'success']);
    expect(buildSegments(7, 1, false, 0)).toEqual(['filled', 'empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
  });
});

describe('arc geometry', () => {
  it('draws a full circle for a goal of one (no gap) and a gap between the segments otherwise', () => {
    expect(arcPaths(1)[0]).toMatch(/^M [\d.]+ [\d.]+ A 54 54 0 1 1 /);
    const [a, b] = arcPaths(2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^M [\d.]+ [\d.]+ A 54 54 0 0 1 /);
  });

  it('starts at twelve o clock', () => {
    // 60 +- (gap/2) degrees from the top: x is just right of the centre, y at the top of the ring (stroke centre line r = 54 from centre 60).
    const start = arcPaths(3)[0].split(' ');
    expect(Number(start[1])).toBeGreaterThan(60);
    expect(Number(start[2])).toBeLessThan(7);
  });
});

describe('hours left, from the server clock', () => {
  it('is the day end minus the server now, on a right phone clock', () => {
    expect(msLeftInDay(ROW, NOW_MS, NOW_MS)).toBe(6 * 3600_000);
  });

  it('shows the gym hours on a phone clock that is days wrong (skewed fixtures)', () => {
    for (const skew of [3 * 24 * 3600_000, -5 * 24 * 3600_000, 7 * 3600_000, -11 * 3600_000]) {
      const fetchedAt = NOW_MS + skew;
      expect(msLeftInDay(ROW, fetchedAt, fetchedAt)).toBe(6 * 3600_000);
      // thirty minutes later on the same wrong clock: 5 hours 30 minutes, which floors to 5.
      const left = msLeftInDay(ROW, fetchedAt, fetchedAt + 30 * 60_000) as number;
      expect(timeLeftParts(left)).toEqual({ unit: 'hours', value: 5 });
      const view = card({ row: { atRiskWeekly: true }, fetchedAtDeviceMs: fetchedAt, deviceNowMs: fetchedAt, offline: false });
      expect(view.hint?.timeLeft).toBe('6 hours left');
    }
  });

  it('floors whole hours from 60 minutes and switches to minutes below, at least one', () => {
    expect(timeLeftParts(6 * 3600_000)).toEqual({ unit: 'hours', value: 6 });
    expect(timeLeftParts(119 * 60_000)).toEqual({ unit: 'hours', value: 1 });
    expect(timeLeftParts(60 * 60_000)).toEqual({ unit: 'hours', value: 1 });
    expect(timeLeftParts(59 * 60_000 + 59_000)).toEqual({ unit: 'minutes', value: 59 });
    expect(timeLeftParts(40 * 60_000)).toEqual({ unit: 'minutes', value: 40 });
    expect(timeLeftParts(10_000)).toEqual({ unit: 'minutes', value: 1 });
  });

  it('reads 1 hour left in the singular', () => {
    const view = card({ row: { atRiskWeekly: true, dayEndsAt: '2026-11-25T18:20:00+00:00' } });
    expect(view.hint?.timeLeft).toBe('1 hour left');
  });

  it('is gone once the day has ended', () => {
    expect(msLeftInDay(ROW, NOW_MS, Date.parse(DAY_ENDS))).toBeNull();
    expect(card({ row: { atRiskWeekly: true }, deviceNowMs: Date.parse(DAY_ENDS) + 1000 }).hint).toBeNull();
  });
});

describe('the at-risk hint', () => {
  it('shows only when the server says so', () => {
    expect(card().hint).toBeNull();
    expect(card({ row: { atRiskWeekly: true } }).hint?.text).toBe('Visit today to close your ring.');
  });

  it('is never shown once the goal is met, nor in the release week', () => {
    expect(card({ row: { atRiskWeekly: true, goalMet: true, visitsThisWeek: 3 } }).hint).toBeNull();
    expect(card({ row: { atRiskWeekly: true, inReleaseWeek: true } }).hint).toBeNull();
  });

  it('first week keeps the hint when it applies', () => {
    expect(card({ row: { atRiskWeekly: true, hasSettledWeek: false, streakWeeks: 0, bestStreakWeeks: 0 } }).hint).not.toBeNull();
  });

  it('the expired member: server false means no hint, with ring and chip as normal', () => {
    const view = card({ row: { atRiskWeekly: false } });
    expect(view.hint).toBeNull();
    expect(view.streak.kind).toBe('chip');
  });

  it('a cached row shows the hint only while the device clock is before its cached day end', () => {
    expect(card({ row: { atRiskWeekly: true }, fromCache: true }).hint).not.toBeNull();
    // a cache from an earlier day: the phone is past that day's end, whatever the offset says
    const nextDay = Date.parse(DAY_ENDS) + 3600_000;
    expect(card({ row: { atRiskWeekly: true }, fromCache: true, deviceNowMs: nextDay }).hint).toBeNull();
    expect(card({ row: { atRiskWeekly: true }, offline: true, deviceNowMs: nextDay }).hint).toBeNull();
  });

  it('is not shown offline once a scan is queued today (that is the visit it asks for)', () => {
    expect(card({ row: { atRiskWeekly: true }, offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }).hint).toBeNull();
    expect(card({ row: { atRiskWeekly: true }, offline: true, queuedScanTimes: ['2026-11-20T10:00:00.000Z'] }).hint).not.toBeNull();
    expect(card({ row: { atRiskWeekly: true }, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }).hint).not.toBeNull();
  });

  it('keeps its announced text fixed while the hours left tick', () => {
    const at = (ms: number) => card({ row: { atRiskWeekly: true }, deviceNowMs: NOW_MS + ms }).hint!;
    expect(at(0).text).toBe(at(2 * 3600_000).text);
    expect(at(0).timeLeft).not.toBe(at(2 * 3600_000).timeLeft);
  });
});

describe('the section faces', () => {
  it('is hidden when the area is dark, whatever else is known', () => {
    expect(buildHomeEngagementView(input({ dark: true })).kind).toBe('hidden');
    expect(buildHomeEngagementView(input({ row: { enabled: false } })).kind).toBe('hidden');
    expect(buildHomeEngagementView(input({ dark: true, busy: true, cachedEnabled: true })).kind).toBe('hidden');
  });

  it('with no result yet: the skeleton shows for a cache that says enabled, and for at most two seconds with no cache', () => {
    const none = { snapshot: null, busy: true };
    expect(buildHomeEngagementView({ ...input(), ...none, cachedEnabled: true, skeletonExpired: true }).kind).toBe('skeleton');
    expect(buildHomeEngagementView({ ...input(), ...none, cachedEnabled: null, skeletonExpired: false }).kind).toBe('skeleton');
    expect(buildHomeEngagementView({ ...input(), ...none, cachedEnabled: null, skeletonExpired: true }).kind).toBe('hidden');
    expect(buildHomeEngagementView({ ...input(), ...none, cachedEnabled: false }).kind).toBe('hidden');
  });

  it('with no result and nothing running, Home is exactly today Home', () => {
    expect(buildHomeEngagementView({ ...input(), snapshot: null, busy: false }).kind).toBe('hidden');
  });

  it('a cache that says dark stays hidden even when the read fails (the epoch is unset, Home is unchanged)', () => {
    expect(buildHomeEngagementView({ ...input(), snapshot: null, loadFailed: true, offline: true, cachedEnabled: false }).kind).toBe('hidden');
    expect(buildHomeEngagementView({ ...input(), snapshot: null, loadFailed: true, cachedEnabled: true }).kind).toBe('error');
  });

  it('no cache and no connection: the error card', () => {
    const view = buildHomeEngagementView({ ...input(), snapshot: null, loadFailed: true, offline: true });
    expect(view).toEqual({ kind: 'error', title: 'This week', message: "Couldn't load your week. Pull down to refresh." });
    const fr = buildHomeEngagementView({ ...input({ t: makeT('fr'), language: 'fr' }), snapshot: null, loadFailed: true });
    expect(fr.kind === 'error' && fr.message).toBe('Impossible de charger votre semaine. Tirez pour actualiser.');
  });

  it('a settle shows the skeleton for two seconds at most, then the row', () => {
    expect(buildHomeEngagementView(input({ row: { needsSettle: true }, busy: true })).kind).toBe('skeleton');
    expect(buildHomeEngagementView(input({ row: { needsSettle: true }, busy: true, skeletonExpired: true })).kind).toBe('card');
    expect(buildHomeEngagementView(input({ row: { needsSettle: false }, busy: true })).kind).toBe('card');
  });

  it('a failed settle keeps the last row and adds the small line', () => {
    const view = card({ settleFailed: true });
    expect(view.settleError).toBe("Couldn't update your streak just now. We'll try again.");
    expect(view.ring.centre).toBe('2 / 3');
    expect(card().settleError).toBeNull();
  });
});

describe('the goal button and the default-goal hint', () => {
  it('reads Goal: N days, or the pending change with its date', () => {
    expect(card().goalButton).toEqual({ label: 'Goal: 3 days', pending: false });
    expect(card({ row: { goal: 1, visitsNeeded: 1 } }).goalButton.label).toBe('Goal: 1 day');
    expect(card({ row: { pendingGoal: 4, pendingEffectiveWeek: '2026-11-30' } }).goalButton).toEqual({ label: 'Changes to 4 days on 30 Nov', pending: true });
    const fr = card({ row: { pendingGoal: 4, pendingEffectiveWeek: '2026-11-30' }, t: makeT('fr'), language: 'fr' });
    expect(fr.goalButton.label).toBe('Passe à 4 jours le 30 novembre');
  });

  it('the pending change leaves the ring on the current week goal', () => {
    expect(card({ row: { pendingGoal: 4, pendingEffectiveWeek: '2026-11-30' } }).ring.segments).toHaveLength(3);
  });

  it('shows the hint once, with the goal in force, until it has been seen', () => {
    expect(card({ row: { goalIsDefault: true }, goalHintSeen: false }).goalHint).toBe('We started you at 3 days a week. Change it any time; a new goal starts next Monday.');
    expect(card({ row: { goalIsDefault: true, goal: 4, visitsNeeded: 2 }, goalHintSeen: false }).goalHint).toContain('4 days a week');
    expect(card({ row: { goalIsDefault: true }, goalHintSeen: true }).goalHint).toBeNull();
    expect(card({ row: { goalIsDefault: false }, goalHintSeen: false }).goalHint).toBeNull();
  });
});

describe('offline overlay', () => {
  it('adds one dashed segment per scan queued at or after the cached day start, with the note', () => {
    const view = card({ offline: true, row: { visitsThisWeek: 1, visitsNeeded: 2 }, queuedScanTimes: ['2026-11-25T08:00:00.000Z', '2026-11-24T22:59:59.000Z'] });
    expect(view.ring.segments).toEqual(['filled', 'dashed', 'empty']);
    expect(view.pendingSyncNote).toBe('1 visit waiting to sync');
  });

  it('counts a scan exactly at the day start and ignores an earlier one, by instant, not by string', () => {
    expect(queuedTodayCount(DAY_STARTS, ['2026-11-24T23:00:00.000Z'])).toBe(1);
    expect(queuedTodayCount(DAY_STARTS, ['2026-11-25T00:00:00.000+01:00'])).toBe(1);
    expect(queuedTodayCount(DAY_STARTS, ['2026-11-24T22:59:59.999Z', 'garbage'])).toBe(0);
  });

  it('never exceeds the goal, and shows the plural note for the segments shown', () => {
    const view = card({ offline: true, row: { visitsThisWeek: 1, visitsNeeded: 2 }, queuedScanTimes: Array(5).fill('2026-11-25T10:00:00.000Z') });
    expect(view.ring.segments).toEqual(['filled', 'dashed', 'dashed']);
    expect(view.pendingSyncNote).toBe('2 visits waiting to sync');
  });

  it('adds nothing when online, when the goal is met, or when nothing is queued today', () => {
    expect(card({ queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }).ring.segments).toEqual(['filled', 'filled', 'empty']);
    expect(card({ offline: true, row: { goalMet: true, visitsThisWeek: 3 }, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }).pendingSyncNote).toBeNull();
    expect(card({ offline: true, queuedScanTimes: ['2026-11-20T10:00:00.000Z'] }).pendingSyncNote).toBeNull();
  });

  it('a cached row gets the overlay even when the phone reports a connection', () => {
    expect(card({ fromCache: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }).ring.segments).toEqual(['filled', 'filled', 'dashed']);
  });
});

describe('the card as a button (Story 30.5)', () => {
  it('carries the hint and one label that hides nothing the card says', () => {
    const view = card({ row: { atRiskWeekly: true } });
    expect(view.cardHint).toBe('Double tap to open your calendar');
    // The caption repeats the ring sentence's last sentence here, so it is not read twice.
    expect(view.cardLabel).toBe('This week. Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring. 5 weeks in a row. Visit today to close your ring. 6 hours left.');
    expect(card().cardLabel).toBe('This week. Weekly goal: 2 of 3 visit days this week. 1 more visit closes your ring. 5 weeks in a row.');
  });
  it('adds the caption, streak, pending-sync note and settle error when present (EN)', () => {
    const view = card({
      row: { goalMet: true, visitsThisWeek: 3, streakIfMet: 6 },
      offline: true,
      queuedScanTimes: ['2026-11-25T10:00:00.000Z'],
      settleFailed: true,
    });
    expect(view.cardLabel).toBe(
      "This week. Weekly goal met: 3 of 3. 5 weeks in a row. Goal met. Your streak becomes 6 weeks when the week ends. Couldn't update your streak just now. We'll try again.",
    );
    const queued = card({ offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] });
    expect(queued.cardLabel).toContain('1 visit waiting to sync.');
  });
  it('reads in French with the same parts', () => {
    const view = card({ row: { goalMet: true, visitsThisWeek: 3, streakIfMet: 6 }, settleFailed: true, t: makeT('fr'), language: 'fr' });
    expect(view.cardHint).toBe('Appuyez deux fois pour ouvrir votre calendrier');
    expect(view.cardLabel.startsWith('Cette semaine.')).toBe(true);
    expect(view.cardLabel).toContain(view.streak.kind === 'chip' ? view.streak.label : 'x');
    expect(view.cardLabel).toContain(view.caption);
    expect(view.cardLabel).toContain(view.settleError as string);
  });
});

describe('Epic 31 Shield and comeback on the card (Story 31.1)', () => {
  it('a member with no Shield and no comeback gets no chip, no line about holding, no notice and no comeback card (nothing changes while the area is dark or quiet)', () => {
    const view = card({ row: { weeksToNextShield: null, streakWeeks: null, bestStreakWeeks: 0, hasSettledWeek: false } });
    expect(view.shield.chip).toBeNull();
    expect(view.shield.nextLine).toBeNull();
    expect(view.shield.notice).toBeNull();
    expect(view.shield.comeback).toBeNull();
    expect(view.shield.shieldReady).toBeNull();
    expect(view.hint).toBeNull();
  });

  it('the card carries the shield view and nothing else new, and never a bare zero', () => {
    const view = card({ row: { shieldsHeld: 0 } });
    expect(Object.keys(view).sort()).toEqual(
      ['captionKey', 'caption', 'cardHint', 'cardLabel', 'goalButton', 'goalHint', 'hint', 'kind', 'pendingSyncNote', 'ring', 'settleError', 'shield', 'streak', 'title'].sort(),
    );
    expect(JSON.stringify(view.shield)).not.toMatch(/"label":"0|0 Shield|0 bouclier/);
  });

  it('a null streak (no run) reads as no run: the best line, never a bare 0', () => {
    const view = card({ row: { streakWeeks: null, bestStreakWeeks: 8 } });
    expect(view.streak).toEqual({ kind: 'best', label: 'Best: 8 weeks' });
    expect(card({ row: { streakWeeks: null, bestStreakWeeks: 0 } }).streak).toEqual({ kind: 'none' });
  });

  it('the at-risk hint gains the Shield-ready second line only while a Shield is held, in both languages', () => {
    const plain = card({ row: { atRiskWeekly: true } });
    expect(plain.hint?.shieldReady ?? null).toBeNull();
    const held = card({ row: { atRiskWeekly: true, shieldsHeld: 1 } });
    expect(held.hint?.shieldReady).toBe("A Shield is ready if you can't make it.");
    expect(held.hint?.label).toBe("Visit today to close your ring. 6 hours left A Shield is ready if you can't make it.");
    expect(held.hint?.text).toBe('Visit today to close your ring.');
    const fr = card({ row: { atRiskWeekly: true, shieldsHeld: 2 }, t: makeT('fr'), language: 'fr' });
    expect(fr.hint?.shieldReady).toBe('Un bouclier est prêt si vous ne pouvez pas venir.');
  });

  it('a queued scan today turns ONE comeback segment dashed while the comeback is active, and only offline (or from the cache) and not already visited today', () => {
    const comeback = { comebackState: 'active' as const, comebackVisitsDone: 1, streakWeeks: null };
    const queuedScanTimes = ['2026-11-25T15:30:00.000Z'];
    const offline = card({ row: comeback, offline: true, queuedScanTimes });
    expect(offline.shield.comeback?.phase).toBe('progress');
    expect(offline.shield.comeback?.segments).toEqual({ total: 3, done: 1, dashed: 1 });
    // the figures never move: still 1 of 3
    expect(offline.shield.comeback?.numeral).toBe('1 / 3');
    expect(card({ row: comeback, fromCache: true, queuedScanTimes }).shield.comeback?.segments?.dashed).toBe(1);
    expect(card({ row: comeback, queuedScanTimes }).shield.comeback?.segments?.dashed).toBe(0);
    expect(card({ row: { ...comeback, visitedToday: true }, offline: true, queuedScanTimes }).shield.comeback?.segments?.dashed).toBe(0);
    expect(card({ row: comeback, offline: true, queuedScanTimes: ['2026-11-24T10:00:00.000Z'] }).shield.comeback?.segments?.dashed).toBe(0);
  });

  it('the "Shield saved" notice shows for the newest settled week and goes once its id is in the device set', () => {
    const row = { savedWeekStart: '2026-11-16', savedWeekStreak: 6, shieldsHeld: 1 };
    const shown = card({ row }).shield;
    expect(shown.notice).toMatchObject({ id: 'saved:2026-11-16', kind: 'saved' });
    expect(shown.chip).not.toBeNull();
    expect(card({ row, shieldSeen: new Set(['saved:2026-11-16']) }).shield.notice).toBeNull();
    expect(card({ row, shieldSeen: null }).shield.notice).toBeNull();
    // a saved week older than the newest settled week is not announced
    expect(card({ row: { ...row, savedWeekStart: '2026-11-09' } }).shield.notice).toBeNull();
  });

  it('the daily slots stay unrendered: atRiskDaily and dailyRun change nothing on the card', () => {
    const base = card();
    const daily = card({ row: { atRiskDaily: true, dailyRun: 4 } });
    expect(JSON.stringify(daily)).toBe(JSON.stringify(base));
  });
});

// FR-232: wording is data. A catalog value swapped for a sentinel must show up in the view.
describe('wording is data (sentinel)', () => {
  function swapped(path: string[], value: string): TFn {
    const clone = JSON.parse(JSON.stringify(en)) as Record<string, unknown>;
    let node = clone;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
    node[path[path.length - 1]] = value;
    return makeT('en', { en: clone, fr });
  }

  it.each([
    [['engage', 'ring', 'caption', 'met'], { row: { goalMet: true, visitsThisWeek: 3, streakIfMet: null } }, (v: CardView) => v.caption],
    [['engage', 'ring', 'caption', 'progress_one'], {}, (v: CardView) => v.caption],
    [['engage', 'ring', 'caption', 'fresh_other'], { row: { visitsThisWeek: 0, visitsNeeded: 3 } }, (v: CardView) => v.caption],
    [['engage', 'ring', 'caption', 'extra_other'], { row: { goalMet: true, visitsThisWeek: 5 } }, (v: CardView) => v.caption],
    [['engage', 'ring', 'caption', 'metStreak_other'], { row: { goalMet: true, visitsThisWeek: 3, streakIfMet: 6 } }, (v: CardView) => v.caption],
    [['engage', 'streak', 'startsMonday'], { row: { inReleaseWeek: true } }, (v: CardView) => v.caption],
    [['engage', 'ring', 'title'], {}, (v: CardView) => v.title],
    [['engage', 'ring', 'unit'], {}, (v: CardView) => v.ring.unit],
    [['engage', 'ring', 'goalLabel_other'], {}, (v: CardView) => v.goalButton.label],
    [['engage', 'ring', 'goalPending_other'], { row: { pendingGoal: 4, pendingEffectiveWeek: '2026-11-30' } }, (v: CardView) => v.goalButton.label],
    [['engage', 'ring', 'goalHint', 'default_other'], { row: { goalIsDefault: true }, goalHintSeen: false }, (v: CardView) => v.goalHint],
    [['engage', 'ring', 'a11y', 'progress_one'], {}, (v: CardView) => v.ring.accessibilityLabel],
    [['engage', 'ring', 'a11y', 'met'], { row: { goalMet: true, visitsThisWeek: 3 } }, (v: CardView) => v.ring.accessibilityLabel],
    [['engage', 'ring', 'pendingSync_one'], { offline: true, queuedScanTimes: ['2026-11-25T10:00:00.000Z'] }, (v: CardView) => v.pendingSyncNote],
    [['engage', 'streak', 'weeks_other'], {}, (v: CardView) => (v.streak.kind === 'chip' ? v.streak.label : null)],
    [['engage', 'streak', 'first'], { row: { streakWeeks: 1 } }, (v: CardView) => (v.streak.kind === 'chip' ? v.streak.label : null)],
    [['engage', 'streak', 'best_other'], { row: { streakWeeks: 0 } }, (v: CardView) => (v.streak.kind === 'best' ? v.streak.label : null)],
    [['engage', 'streak', 'firstWeek'], { row: { hasSettledWeek: false } }, (v: CardView) => (v.streak.kind === 'firstWeek' ? v.streak.label : null)],
    [['engage', 'atRisk', 'weekly'], { row: { atRiskWeekly: true } }, (v: CardView) => v.hint?.text],
    [['engage', 'atRisk', 'hoursLeft_other'], { row: { atRiskWeekly: true } }, (v: CardView) => v.hint?.timeLeft],
    [['engage', 'atRisk', 'minutesLeft'], { row: { atRiskWeekly: true, dayEndsAt: '2026-11-25T17:40:00+00:00' } }, (v: CardView) => v.hint?.timeLeft],
    [['engage', 'home', 'settleError'], { settleFailed: true }, (v: CardView) => v.settleError],
  ] as const)('%s', (path, over, pick) => {
    const sentinel = `SENTINEL-${path.join('.')}`;
    const view = card({ ...(over as object), t: swapped([...path], sentinel) });
    const value = (pick as (v: CardView) => string | null | undefined)(view);
    expect(value).toContain(sentinel);
  });

  it('the error card reads the catalog', () => {
    const view = buildHomeEngagementView({ ...input({ t: swapped(['engage', 'home', 'error'], 'SENTINEL-error') }), snapshot: null, loadFailed: true });
    expect(view.kind === 'error' && view.message).toBe('SENTINEL-error');
  });
});

describe('loadEngagement: one settle per focus', () => {
  function deps(get: Engagement | 'unavailable' | 'error', open: Engagement | 'unavailable' | 'error' | 'gym_suspended') {
    const getMyEngagement = vi.fn(async () => (typeof get === 'string' ? { status: get } : { status: 'success', engagement: get })) as never;
    const openEngagement = vi.fn(async () => (typeof open === 'string' ? { status: open } : { status: 'success', engagement: open })) as never;
    return { getMyEngagement, openEngagement };
  }

  it('does not settle a row that has nothing to settle, and never writes for a dark epoch', async () => {
    const d = deps(ROW, ROW);
    expect(await loadEngagement(d)).toEqual({ kind: 'row', engagement: ROW, settleFailed: false });
    expect(d.openEngagement).not.toHaveBeenCalled();
    const dark = deps({ ...ROW, enabled: false }, ROW);
    expect((await loadEngagement(dark)).kind).toBe('dark');
    expect(dark.openEngagement).not.toHaveBeenCalled();
  });

  it('calls openEngagement exactly once and renders the returned row as it is, even when the flag is still true', async () => {
    const stuck = { ...ROW, needsSettle: true, visitsThisWeek: 3 };
    const d = deps({ ...ROW, needsSettle: true }, stuck);
    const outcome = await loadEngagement(d);
    expect(d.openEngagement).toHaveBeenCalledTimes(1);
    expect(d.getMyEngagement).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'row', engagement: stuck, settleFailed: false });
  });

  it('a failed settle keeps the row read before it, and does not retry', async () => {
    for (const failure of ['error', 'gym_suspended'] as const) {
      const read = { ...ROW, needsSettle: true };
      const d = deps(read, failure);
      expect(await loadEngagement(d)).toEqual({ kind: 'row', engagement: read, settleFailed: true });
      expect(d.openEngagement).toHaveBeenCalledTimes(1);
    }
  });

  it('is dark when the caller is not a live member, and failed when the read fails', async () => {
    expect(await loadEngagement(deps('unavailable', ROW))).toEqual({ kind: 'dark', engagement: null });
    expect(await loadEngagement(deps('error', ROW))).toEqual({ kind: 'failed' });
    const refused = deps({ ...ROW, needsSettle: true }, 'unavailable');
    expect(await loadEngagement(refused)).toEqual({ kind: 'dark', engagement: null });
  });
});

describe('the device cache', () => {
  beforeEach(() => {
    store.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
  });

  it('is keyed per member and gym', () => {
    expect(engagementCacheKey('u1', 'g1')).toBe('gymos.engageHome.v2.u1.g1');
  });

  it('round-trips a row with the phone clock it arrived on', async () => {
    expect(await readEngagementCache('u1', 'g1')).toBeNull();
    expect(await writeEngagementCache('u1', 'g1', ROW, 123)).toBe(true);
    expect(await readEngagementCache('u1', 'g1')).toEqual({ engagement: ROW, fetchedAtDeviceMs: 123 });
    expect(await readEngagementCache('u1', 'g2')).toBeNull();
    expect(await readEngagementCache('u2', 'g1')).toBeNull();
  });

  it('keeps a dark row too, so a dark member sees no skeleton next time', async () => {
    await writeEngagementCache('u1', 'g1', { ...ROW, enabled: false }, 5);
    expect((await readEngagementCache('u1', 'g1'))?.engagement.enabled).toBe(false);
  });

  it('fails open as no cache: corrupt, damaged, or unreadable storage', async () => {
    store.set(engagementCacheKey('u1', 'g1'), '{not json');
    expect(await readEngagementCache('u1', 'g1')).toBeNull();
    store.set(engagementCacheKey('u1', 'g1'), JSON.stringify({ engagement: { ...ROW, goal: 'three' }, fetchedAtDeviceMs: 1 }));
    expect(await readEngagementCache('u1', 'g1')).toBeNull();
    store.set(engagementCacheKey('u1', 'g1'), JSON.stringify({ engagement: ROW }));
    expect(await readEngagementCache('u1', 'g1')).toBeNull();
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await readEngagementCache('u1', 'g1')).toBeNull();
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await writeEngagementCache('u1', 'g1', ROW, 1)).toBe(false);
  });

  it('isEngagement checks every field and the three timestamps', () => {
    expect(isEngagement(ROW)).toBe(true);
    expect(isEngagement({ ...ROW, serverNow: 'nope' })).toBe(false);
    expect(isEngagement({ ...ROW, pendingGoal: undefined })).toBe(false);
    expect(isEngagement(null)).toBe(false);
    for (const goal of [0, 8, -1, 3.5]) expect(isEngagement({ ...ROW, goal })).toBe(false);
    for (const goal of [1, 7]) expect(isEngagement({ ...ROW, goal })).toBe(true);
  });
});

describe('layout', () => {
  it('stacks the card under 360pt width or above 1.3 font scale', () => {
    expect(shouldStack(359, 1)).toBe(true);
    expect(shouldStack(360, 1)).toBe(false);
    expect(shouldStack(412, 1.3)).toBe(false);
    expect(shouldStack(412, 1.31)).toBe(true);
  });
});
