import { createInstance } from 'i18next';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn() } }));

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { Engagement } from '@/services/engagement';

import { buildHomeStreakLine } from './homeStreakLine';
import type { TFn } from './weeklyGoalSheet';
import { buildHomeEngagementView, type HomeEngagementInput, type HomeEngagementView } from './weeklyRing';

// Story 31.4: the Home streak line's view model ("3-week streak" or "1 of 3 this week"), in both languages through real i18next.

function makeT(lng: 'en' | 'fr'): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: en }, fr: { translation: fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

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

function build(row: Partial<Engagement>, lng: 'en' | 'fr' = 'en', over: Partial<HomeEngagementInput> = {}): { view: HomeEngagementView; engagement: Engagement; t: TFn } {
  const engagement = { ...ROW, ...row };
  const t = makeT(lng);
  const view = buildHomeEngagementView({
    snapshot: { engagement, fetchedAtDeviceMs: NOW_MS, fromCache: false },
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
    t,
    language: lng,
    ...over,
  });
  return { view, engagement, t };
}

function line(row: Partial<Engagement>, lng: 'en' | 'fr' = 'en'): string | null {
  const { view, engagement, t } = build(row, lng);
  return buildHomeStreakLine(view, engagement, t)?.text ?? null;
}

describe('buildHomeStreakLine', () => {
  it('reads the streak in weeks when a run is active', () => {
    expect(line({ streakWeeks: 3 })).toBe('3-week streak');
    expect(line({ streakWeeks: 12 })).toBe('12-week streak');
    expect(line({ streakWeeks: 3 }, 'fr')).toBe('Série de 3 semaines');
    expect(line({ streakWeeks: 1 }, 'fr')).toBe('Série de 1 semaine');
  });

  it('a first settled week is a one-week streak, not "0"', () => {
    expect(line({ streakWeeks: 1, bestStreakWeeks: 1 })).toBe('1-week streak');
  });

  it('with no streak active it reads the week: "1 of 3 this week"', () => {
    expect(line({ streakWeeks: null, bestStreakWeeks: 2, goal: 3, visitsThisWeek: 1 })).toBe('1 of 3 this week');
    expect(line({ streakWeeks: null, bestStreakWeeks: 2, goal: 3, visitsThisWeek: 1 }, 'fr')).toBe('1 sur 3 cette semaine');
    expect(line({ streakWeeks: null, hasSettledWeek: false, goal: 4, visitsThisWeek: 0 })).toBe('0 of 4 this week');
  });

  it('visits beyond the goal read as a full week, never "5 of 3"', () => {
    expect(line({ streakWeeks: null, bestStreakWeeks: 0, goal: 3, visitsThisWeek: 5, goalMet: true })).toBe('3 of 3 this week');
  });

  it('the release week has no streak line number: it reads the week', () => {
    expect(line({ inReleaseWeek: true, streakWeeks: 5, goal: 3, visitsThisWeek: 2 })).toBe('2 of 3 this week');
  });

  it('no line for hidden, dark, loading or error faces, and none without a row', () => {
    const dark = build({}, 'en', { dark: true });
    expect(dark.view.kind).toBe('hidden');
    expect(buildHomeStreakLine(dark.view, dark.engagement, dark.t)).toBeNull();
    const loading = build({}, 'en', { snapshot: null, busy: true, cachedEnabled: true });
    expect(loading.view.kind).toBe('skeleton');
    expect(buildHomeStreakLine(loading.view, null, loading.t)).toBeNull();
    const error = build({}, 'en', { snapshot: null, loadFailed: true });
    expect(error.view.kind).toBe('error');
    expect(buildHomeStreakLine(error.view, null, error.t)).toBeNull();
    const card = build({});
    expect(buildHomeStreakLine(card.view, null, card.t)).toBeNull();
  });

  it('has no exclamation mark and no loss wording (calm tone)', () => {
    for (const row of [{ streakWeeks: 3 }, { streakWeeks: null, bestStreakWeeks: 2 }]) {
      for (const lng of ['en', 'fr'] as const) expect(line(row, lng)).not.toMatch(/!|lost|perdue/i);
    }
  });
});

describe('Home and the dark path (Story 31.4)', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('Home renders the line only behind the gate being on and a card view, and it opens /streak', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home).toMatch(/const streakLine = engagementGate === 'on' \? buildHomeStreakLine\(engagementView, engagementRow, t\) : null;/);
    expect(home).toMatch(/\{streakLine && <HomeStreakLine line=\{streakLine\} onPress=\{\(\) => router\.push\('\/streak'\)\} \/>\}/);
    // The one engagement read, the celebration and the settle stay on Home exactly as before.
    expect(home).toContain('useHomeEngagement(isConnected, pendingCheckInCount)');
    expect(home).toContain('useHomeCelebration(');
    expect(home).toMatch(/loadCelebrationForHome\(userId, memberResult\.data\.gym_id, isCurrent, engagementRead\)/);
  });

  it('the dark path renders none of the new elements on Home: the line sits behind the gate, and Home has neither section', () => {
    const home = read('app/(tabs)/index.tsx');
    expect(home.match(/<HomeStreakLine/g)).toHaveLength(1);
    expect(home.match(/streakLine/g)?.length).toBe(3); // the const, the guard, the prop
    expect(home).not.toMatch(/<WeeklyRingSection|<LeaderboardHomeCard|router\.push\('\/progress'\)/);
  });

  it('the Profile Progress row is always shown: outside every engagementEnabled block, no gate, the last row of the Training card, opening /progress', () => {
    const profile = read('app/(tabs)/profile.tsx');
    expect(profile.match(/router\.push\('\/progress'\)/g)).toHaveLength(1);
    expect(profile).not.toMatch(/progressRowOn|useEngagementGate/);
    const anonymous = profile.indexOf('engagementEnabled && renderAnonymousRow()');
    const progress = profile.indexOf("router.push('/progress')");
    const cardEnd = profile.indexOf('</Card>', progress);
    expect(anonymous).toBeGreaterThan(-1);
    expect(progress).toBeGreaterThan(anonymous);
    // The text between the Anonymous row and the Progress row closes every conditional block: the row is not inside one.
    const between = profile.slice(anonymous + 'engagementEnabled && renderAnonymousRow()'.length, progress);
    expect(between).not.toMatch(/&&\s*\(|\?\s*\(/);
    expect(profile.slice(progress + 10, cardEnd)).not.toMatch(/router\.push/);
    expect(profile).toContain("t('engage.profile.progress.row')");
    // The Training card itself (the Weekly goal row) is not gated, so a dark gym still has the card with the goal row and this one.
    const trainingStart = profile.indexOf("t('engage.profile.section')");
    const goalRow = profile.indexOf("router.push('/goal')");
    expect(trainingStart).toBeGreaterThan(-1);
    expect(goalRow).toBeGreaterThan(trainingStart);
    expect(profile.slice(trainingStart, goalRow)).not.toMatch(/engagementEnabled/);
  });

  it('the Progress screens and services carry no engagement or gate code (moved, not changed)', () => {
    for (const path of ['app/progress/index.tsx', 'app/progress/entries.tsx', 'services/progress.ts']) {
      expect(read(path)).not.toMatch(/engagementGate|useEngagementGate|streak/i);
    }
  });
});

describe('the Streak screen (Story 31.4)', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('reuses the Home hooks and components unchanged and reads nothing else', () => {
    const hub = read('app/(tabs)/streak/index.tsx');
    for (const piece of ['useHomeEngagement(', 'useHomeLeaderboard()', 'useCalendar(', 'useBadgeRows(', '<WeeklyRingSection', '<LeaderboardHomeCard', '<CalendarPanel']) expect(hub).toContain(piece);
    expect(hub).not.toMatch(/getMyEngagement|openEngagement|getGymLeaderboard|getMyBadges|getMyVisitDays|weekStart|weekEnd|dayStartsAt|dayEndsAt|serverNow|gymToday/);
    expect(hub).toMatch(/onGoalPress=\{\(\) => router\.push\('\/goal'\)\}/);
    expect(hub).toMatch(/onPressCard=\{\(\) => router\.push\('\/calendar'\)\}/);
  });

  it('one pull to refresh reloads the ring, the board card, the calendar and the badge count', () => {
    const hub = read('app/(tabs)/streak/index.tsx');
    expect(hub).toMatch(/await Promise\.all\(\[loadRing\(\), calendar\.refresh\(\)\]\)/);
    expect(hub).toContain('setBadgesReload((n) => n + 1)');
    expect(hub).toMatch(/useBadgeRows\(gate === 'on', isConnected, userId, gymId, badgesReload\)/);
    expect(hub).toMatch(/await Promise\.all\(\[read, loadLeaderboard\(userId, gymId, isCurrent, read\)\]\)/);
  });

  it('the Badges row opens /badges and shows "n of 5" through the Profile value function', () => {
    const hub = read('app/(tabs)/streak/index.tsx');
    expect(hub).toContain("router.push('/badges')");
    expect(hub).toContain('profileBadgesValue(badgeRows, t)');
  });

  it('the hub hides the panel\'s at-risk hint only while the ring card shows its own, and the panel gates the hint on that prop', () => {
    const hub = read('app/(tabs)/streak/index.tsx');
    expect(hub).toContain("const ringShowsHint = engagementView.kind === 'card' && engagementView.hint !== null;");
    expect(hub).toContain('hideAtRiskHint={ringShowsHint}');
    expect(hub).not.toMatch(/hideAtRiskHint\s*\/>|hideAtRiskHint\s+\/>/);
    const panel = read('components/CalendarPanel.tsx');
    expect(panel).toContain('hideAtRiskHint = false');
    expect(panel).toMatch(/\{!hideAtRiskHint && view\.atRiskHint && \(\s*<View[^>]*>\s*<AtRiskHint hint=\{view\.atRiskHint\} \/>/);
  });

  it('the calendar body is one shared panel: the full screen and the hub both render it, and /calendar keeps its header, back and refresh', () => {
    const full = read('app/calendar.tsx');
    expect(full).toContain('<CalendarPanel view={view} refresh={refresh} shift={shift} selectDay={selectDay} />');
    expect(full).toContain('router.back()');
    expect(full).toContain('<RefreshControl');
    expect(full).not.toMatch(/PanResponder|CalendarGrid|LegendEntry/);
    expect(read('components/CalendarPanel.tsx')).toContain('hideAtRiskHint = false');
  });

  it('is registered as a tab folder, not as a root route, and shows a Back-to-Home face only while the gate is off', () => {
    const hub = read('app/(tabs)/streak/index.tsx');
    expect(hub).toMatch(/\{gate !== 'on' && \(\s*<Pressable accessibilityRole="button" accessibilityLabel=\{t\('common\.back'\)\} onPress=\{\(\) => router\.replace\('\/'\)\}/);
    expect(hub).toMatch(/\{gate === 'on' && <CalendarPanel/);
    expect(hub).toMatch(/\{gate === 'on' && \(\s*<Card variant="flat">/);
    expect(read('app/(tabs)/streak/index.tsx')).toContain('export default function StreakScreen');
    expect(read('app/_layout.tsx')).not.toMatch(/name="streak"/);
  });
});
