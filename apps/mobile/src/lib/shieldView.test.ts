import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { Engagement } from '@/services/engagement';

import { buildShieldView, noticeId, type ShieldView, type ShieldViewInput } from './shieldView';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr'): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: en }, fr: { translation: fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

// The open week starts Monday 23 Nov 2026, so the newest settled week is the one starting 16 Nov.
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
  visitsThisWeek: 1,
  goalMet: false,
  visitedToday: false,
  streakWeeks: 5,
  streakIfMet: null,
  bestStreakWeeks: 8,
  hasSettledWeek: true,
  daysLeftInWeek: 5,
  visitsNeeded: 2,
  atRiskWeekly: false,
  atRiskDaily: false,
  dailyRun: null,
  shieldsHeld: 0,
  comebackState: 'none',
  dayStartsAt: '2026-11-24T23:00:00+00:00',
  dayEndsAt: '2026-11-25T23:00:00+00:00',
  serverNow: '2026-11-25T17:00:00+00:00',
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

const LANGS = ['en', 'fr'] as const;

function build(over: Partial<Engagement> = {}, rest: Partial<Omit<ShieldViewInput, 'row'>> = {}, lang: 'en' | 'fr' = 'en'): ShieldView {
  return buildShieldView({ row: { ...ROW, ...over }, seen: new Set(), queuedVisit: false, t: makeT(lang), language: lang, ...rest });
}

describe('the Shield chip', () => {
  it('shows only while 1 or 2 are held, never "0 Shields"', () => {
    expect(build({ shieldsHeld: 0 }).chip).toBeNull();
    expect(build({ shieldsHeld: 1 }).chip).toEqual({ label: '1 Shield', accessibilityLabel: '1 Shield' });
    expect(build({ shieldsHeld: 2 }).chip?.label).toBe('2 Shields');
  });
  it.each([
    [1, '1 bouclier'],
    [2, '2 boucliers'],
  ])('reads in French at %i', (held, label) => {
    expect(build({ shieldsHeld: held }, {}, 'fr').chip?.label).toBe(label);
  });
  it('is hidden in the release week', () => {
    expect(build({ shieldsHeld: 2, inReleaseWeek: true }).chip).toBeNull();
  });
  it('the explainer takes the interval and the cap from the row, in both languages', () => {
    const en4 = build({ shieldEveryWeeks: 4, shieldCap: 2 }).explainer;
    expect(en4.title).toBe('Streak Shield');
    expect(en4.body).toContain('Every 4 weeks in a row earns a Shield');
    expect(en4.body).toContain('hold up to 2');
    expect(en4.gotIt).toBe('Got it');
    expect(build({ shieldEveryWeeks: 5, shieldCap: 3 }).explainer.body).toContain('Every 5 weeks');
    expect(build({ shieldEveryWeeks: 5, shieldCap: 3 }, {}, 'fr').explainer.body).toContain('tranche de 5 semaines');
    expect(build({}, {}, 'fr').explainer.gotIt).toBe('Compris');
  });
});

describe('the next-Shield line', () => {
  it.each(LANGS)('shows the server weeks below the cap (%s)', (lang) => {
    const line = build({ shieldsHeld: 1, weeksToNextShield: 3 }, {}, lang).nextLine;
    expect(line).toBe(lang === 'en' ? '3 more weeks to your next Shield' : 'Encore 3 semaines avant votre prochain bouclier');
    expect(build({ shieldsHeld: 0, weeksToNextShield: 1 }, {}, lang).nextLine).toBe(lang === 'en' ? '1 more week to your next Shield' : 'Encore 1 semaine avant votre prochain bouclier');
  });
  it('reads the maximum line at the cap, with the cap from the server', () => {
    expect(build({ shieldsHeld: 2, shieldCap: 2, weeksToNextShield: null }).nextLine).toBe("You're holding the maximum of 2 Shields.");
    expect(build({ shieldsHeld: 3, shieldCap: 3, weeksToNextShield: null }, {}, 'fr').nextLine).toBe('Vous détenez le maximum de 3 boucliers.');
  });
  it('shows nothing without a run', () => {
    expect(build({ streakWeeks: null, weeksToNextShield: null }).nextLine).toBeNull();
    expect(build({ streakWeeks: null, shieldsHeld: 2, weeksToNextShield: null }).nextLine).toBeNull();
  });
});

describe('the notice row', () => {
  const SAVED = { savedWeekStart: '2026-11-16', savedWeekStreak: 6 };
  it.each(LANGS)('Shield saved: the server date and streak, for the newest settled week (%s)', (lang) => {
    const notice = build(SAVED, {}, lang).notice;
    expect(notice?.id).toBe('saved:2026-11-16');
    expect(notice?.kind).toBe('saved');
    expect(notice?.text).toBe(lang === 'en' ? 'Your Shield saved the week of 16 Nov. Your streak is still 6 weeks.' : 'Votre bouclier a sauvé la semaine du 16 novembre. Votre série reste à 6 semaines.');
    expect(build({ ...SAVED, savedWeekStreak: 1 }).notice?.text).toContain('still 1 week.');
  });
  it.each(LANGS)('Shield earned (%s)', (lang) => {
    const notice = build({ shieldEarnedWeek: '2026-11-16' }, {}, lang).notice;
    expect(notice?.id).toBe('earned:2026-11-16');
    expect(notice?.text).toBe(lang === 'en' ? 'You earned a Shield. It will keep a missed week from ending your streak.' : "Vous avez gagné un bouclier. Il évitera qu'une semaine manquée mette fin à votre série.");
  });
  it('shows only the newest settled week, never an older one', () => {
    expect(build({ savedWeekStart: '2026-11-09', savedWeekStreak: 6 }).notice).toBeNull();
    expect(build({ shieldEarnedWeek: '2026-11-09' }).notice).toBeNull();
    expect(build({ savedWeekStart: '2026-11-23', savedWeekStreak: 6 }).notice).toBeNull();
  });
  it('a dismissed notice is gone, and each is dismissed on its own', () => {
    expect(build(SAVED, { seen: new Set([noticeId('saved', '2026-11-16')]) }).notice).toBeNull();
    // The earned id of the same week is a different id: dismissing one never hides the other.
    expect(build({ shieldEarnedWeek: '2026-11-16' }, { seen: new Set([noticeId('saved', '2026-11-16')]) }).notice?.kind).toBe('earned');
  });
  it('at most one at a time', () => {
    expect(build({ ...SAVED, shieldEarnedWeek: '2026-11-16' }).notice).not.toBeNull();
    expect(Array.isArray(build({ ...SAVED, shieldEarnedWeek: '2026-11-16' }).notice)).toBe(false);
  });
  it('fails closed: an unreadable or unloaded store shows no notice', () => {
    expect(build(SAVED, { seen: null }).notice).toBeNull();
    expect(build({ shieldEarnedWeek: '2026-11-16' }, { seen: null }).notice).toBeNull();
  });
});

describe('the Shield-ready second line', () => {
  it.each(LANGS)('shows while a Shield is held (%s)', (lang) => {
    expect(build({ shieldsHeld: 1 }, {}, lang).shieldReady).toBe(lang === 'en' ? "A Shield is ready if you can't make it." : 'Un bouclier est prêt si vous ne pouvez pas venir.');
    expect(build({ shieldsHeld: 0 }, {}, lang).shieldReady).toBeNull();
  });
});

describe('the comeback card', () => {
  const ACTIVE = { streakWeeks: null, shieldsHeld: 0, weeksToNextShield: null, comebackState: 'active', bestStreakWeeks: 8 };

  it('is absent while the state is none', () => {
    expect(build().comeback).toBeNull();
    expect(build({ ...ACTIVE, comebackState: 'none' }).comeback).toBeNull();
    expect(build({ ...ACTIVE, inReleaseWeek: true }).comeback).toBeNull();
  });

  it.each(LANGS)('active with no visit yet: empty segments, no "0 / 3" numeral, the goal from the server (%s)', (lang) => {
    const c = build(ACTIVE, {}, lang).comeback;
    expect(c?.phase).toBe('empty');
    expect(c?.numeral).toBeNull();
    expect(c?.progressLabel).toBeNull();
    expect(c?.segments).toEqual({ total: 3, done: 0, dashed: 0 });
    expect(c?.title).toBe(lang === 'en' ? "Let's get going again" : "On s'y remet");
    expect(c?.goalLine).toBe(lang === 'en' ? 'Visit 3 times in 10 days to get back on track.' : 'Venez 3 fois en 10 jours pour reprendre votre élan.');
    expect(c?.best).toMatchObject({ numeral: '8' });
    expect(c?.accessibilityLabel).not.toMatch(/0 \/ 3|0 of 3|0 sur 3/);
  });

  it.each(LANGS)('1 or 2 visits: the numeral and the accessible label (%s)', (lang) => {
    const one = build({ ...ACTIVE, comebackVisitsDone: 1 }, {}, lang).comeback;
    expect(one?.phase).toBe('progress');
    expect(one?.numeral).toBe('1 / 3');
    expect(one?.progressLabel).toBe(lang === 'en' ? '1 of 3 visits' : '1 visites sur 3');
    expect(one?.segments).toEqual({ total: 3, done: 1, dashed: 0 });
    expect(build({ ...ACTIVE, comebackVisitsDone: 2 }).comeback?.numeral).toBe('2 / 3');
    expect(one?.accessibilityLabel).toContain(one?.progressLabel);
  });

  it('never hard-codes 3 and 10: the goal and the window are the server numbers', () => {
    const c = build({ ...ACTIVE, comebackVisitsGoal: 4, comebackWindowDays: 14, comebackVisitsDone: 2 }).comeback;
    expect(c?.goalLine).toBe('Visit 4 times in 14 days to get back on track.');
    expect(c?.numeral).toBe('2 / 4');
    expect(c?.segments?.total).toBe(4);
  });

  it('a visit queued on this phone turns one empty segment dashed and moves no figure', () => {
    const queued = build({ ...ACTIVE, comebackVisitsDone: 1 }, { queuedVisit: true }).comeback;
    expect(queued?.segments).toEqual({ total: 3, done: 1, dashed: 1 });
    expect(queued?.numeral).toBe('1 / 3');
    const none = build(ACTIVE, { queuedVisit: true }).comeback;
    expect(none?.phase).toBe('empty');
    expect(none?.numeral).toBeNull();
    expect(none?.segments).toEqual({ total: 3, done: 0, dashed: 1 });
  });

  it.each(LANGS)('lapsed: the restart line, no segments, no numeral, no warning wording (%s)', (lang) => {
    const c = build({ ...ACTIVE, comebackState: 'lapsed' }, {}, lang).comeback;
    expect(c?.phase).toBe('lapsed');
    expect(c?.restartLine).toBe(lang === 'en' ? 'Your 10 days start again with your next visit.' : 'Vos 10 jours repartent à votre prochaine visite.');
    expect(c?.segments).toBeNull();
    expect(c?.numeral).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/fail|lost|perdu|échec/i);
  });

  it.each(LANGS)('restored: one time per window, then gone (%s)', (lang) => {
    const row = { ...ACTIVE, comebackState: 'restored', comebackWindowStart: '2026-11-17', comebackWindowEndsOn: '2026-11-26', comebackVisitsDone: 3 };
    const c = build(row, {}, lang).comeback;
    expect(c?.phase).toBe('restored');
    expect(c?.restored?.title).toBe(lang === 'en' ? "You're back." : 'Vous voilà de retour.');
    expect(c?.restored?.body).toBe(lang === 'en' ? 'Your new streak starts the first week you close your ring.' : 'Votre nouvelle série démarre la première semaine où vous fermez votre cercle.');
    expect(c?.restored?.id).toBe('restored:2026-11-17');
    // Once recorded as shown, it reads gone on the next load.
    expect(build(row, { seen: new Set(['restored:2026-11-17']) }, lang).comeback).toBeNull();
    // A new window start is a new card.
    expect(build({ ...row, comebackWindowStart: '2026-12-02' }, { seen: new Set(['restored:2026-11-17']) }, lang).comeback?.phase).toBe('restored');
    // Unreadable store: nothing.
    expect(build(row, { seen: null }, lang).comeback).toBeNull();
  });

  it('a state the app does not know draws nothing', () => {
    expect(build({ comebackState: 'weird' }).comeback).toBeNull();
  });
});
