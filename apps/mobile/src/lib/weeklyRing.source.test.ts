import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Story 30.4: the mobile Vitest has no renderer (node environment), so the rules a render test would pin are pinned on the source: no literal sentence
// in the screen or its pieces (FR-232), no date library or day arithmetic to derive a week (NFR-028), the goal hint flag written by the sheet and read
// by Home, and exactly one settle call per focus. The view model's behaviour is in weeklyRing.test.ts.

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Quoted strings and JSX text with two or more words, i.e. a sentence in either language. Import paths, style values and identifiers have none. */
function literalSentences(code: string): string[] {
  const body = stripComments(code);
  const quoted = [...body.matchAll(/(['"`])((?:(?!\1)[^\n\\])*)\1/g)].map((m) => m[2]).filter((text) => /[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}/.test(text) && !text.includes('${'));
  const jsxText = [...body.matchAll(/>\s*([^<>{}\n]*[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}[^<>{}\n]*)\s*</g)].map((m) => m[1]);
  return [...quoted, ...jsxText];
}

const SCREEN_FILES = [
  'app/(tabs)/index.tsx',
  'components/WeeklyRingCard.tsx',
  'components/GoalRing.tsx',
  'hooks/use-home-engagement.ts',
  'hooks/use-focus-toast.ts',
  'lib/weeklyRing.ts',
  // Story 30.5: the calendar and the pieces shared with Home. The grid file (lib/calendarGrid.ts) is the one place that builds dates, and has its own scan below.
  'app/calendar.tsx',
  'components/AtRiskHint.tsx',
  'components/CalendarGrid.tsx',
  'components/CalendarDayCell.tsx',
  'hooks/use-calendar.ts',
  'hooks/use-at-risk-pulse.ts',
  'lib/calendarView.ts',
];

describe('no literal sentence (FR-232)', () => {
  it.each(SCREEN_FILES)('%s', (path) => {
    expect(literalSentences(source(path))).toEqual([]);
  });

  it('the scanner can see a sentence (positive control)', () => {
    expect(literalSentences(`const a = 'Goal met, nice week';`)).toHaveLength(1);
    expect(literalSentences(`<Text>Visit today</Text>`)).toHaveLength(1);
    expect(literalSentences(`import { x } from '@/components/ui/Card'; const c = "no-hide-descendants"; // a comment here`)).toEqual([]);
  });
});

describe('no date library, no week or day arithmetic (NFR-028)', () => {
  const IMPORT = /from\s+['"](date-fns[^'"]*|dayjs[^'"]*|luxon|moment[^'"]*|@internationalized\/date|temporal-polyfill|@js-temporal\/polyfill)['"]/;
  const ARITHMETIC = /new Date\(|\.getDay\(|\.getDate\(|\.setDate\(|\.getUTC\w+\(|\.setUTC\w+\(|Date\.UTC\(|toLocale\w*\(|Intl\.DateTimeFormat|toDateString|\.getTimezoneOffset\(/;

  it.each(SCREEN_FILES)('%s imports no date library', (path) => {
    expect(IMPORT.test(stripComments(source(path)))).toBe(false);
  });

  it.each(SCREEN_FILES.filter((p) => p !== 'app/(tabs)/index.tsx'))('%s does no date construction or week arithmetic', (path) => {
    expect(ARITHMETIC.test(stripComments(source(path)))).toBe(false);
  });

  it('the screen file does not touch the engagement dates (it hands the member and gym ids to the hook and renders its view)', () => {
    const screen = stripComments(source('app/(tabs)/index.tsx'));
    expect(screen).not.toMatch(/weekStart|weekEnd|dayStartsAt|dayEndsAt|serverNow|gymToday/);
    expect(screen).toContain('useHomeEngagement(');
  });

  it('only the view model reads the instants, and only to subtract them', () => {
    const lib = stripComments(source('lib/weeklyRing.ts'));
    expect(lib.match(/Date\.\w+/g)?.every((use) => use === 'Date.parse')).toBe(true);
    expect(stripComments(source('components/WeeklyRingCard.tsx'))).not.toMatch(/Date\./);
  });
});

describe('the default-goal hint flag (closes the 30.1 deferral)', () => {
  it('the goal sheet writes it on open, and the Home flow reads it and clears it on tap', () => {
    const sheet = stripComments(source('app/goal.tsx'));
    expect(sheet).toMatch(/markGoalHintSeen\(\s*userId\s*\)/);
    expect(sheet).toMatch(/useEffect\(\(\) => \{[\s\S]*?markGoalHintSeen[\s\S]*?\}, \[loadGoal\]\)/);
    const home = stripComments(source('hooks/use-home-engagement.ts'));
    expect(home).toMatch(/readGoalHintSeen\(\s*userId\s*\)/);
    expect(home).toMatch(/markGoalHintSeen\(\s*userId\s*\)/);
    const card = stripComments(source('components/WeeklyRingCard.tsx'));
    expect(card).toContain('onGoalHintPress');
  });
});

describe('one settle per focus (closes the 30.3 deferral)', () => {
  it('the view model calls openEngagement once, after the read, and never in a loop', () => {
    const lib = stripComments(source('lib/weeklyRing.ts'));
    const body = lib.slice(lib.indexOf('export async function loadEngagement'), lib.indexOf('const CACHE_KEY_PREFIX'));
    expect(body.match(/deps\.openEngagement\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/\bwhile\b|\bfor\b|\.forEach\(|\.map\(|setInterval|setTimeout/);
    expect(body.indexOf('deps.getMyEngagement(')).toBeLessThan(body.indexOf('deps.openEngagement('));
  });

  it('the hook passes it to the view model once, and the screen starts one load per loadHome', () => {
    const hook = stripComments(source('hooks/use-home-engagement.ts'));
    expect(hook.match(/\bopenEngagement\b/g)).toHaveLength(2); // the import and the one dependency
    expect(hook.match(/loadEngagement\(/g)).toHaveLength(1);
    const screen = stripComments(source('app/(tabs)/index.tsx'));
    expect(screen).not.toMatch(/openEngagement|getMyEngagement/);
    expect(screen.match(/loadEngagementForHome\(/g)).toHaveLength(1);
  });
});

describe('one shared pending-toast hook', () => {
  it('Home and Profile both consume the toast through it, and neither calls consumePendingToast itself', () => {
    for (const path of ['app/(tabs)/index.tsx', 'app/(tabs)/profile.tsx']) {
      const code = stripComments(source(path));
      expect(code).toContain('useFocusToast()');
      expect(code).not.toContain('consumePendingToast');
    }
    expect(stripComments(source('hooks/use-focus-toast.ts'))).toContain('consumePendingToast()');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Story 30.5: the attendance calendar
// ---------------------------------------------------------------------------------------------------------------------------------------------

describe('the calendar grid is date arithmetic on strings (NFR-028)', () => {
  const FORBIDDEN = [
    /Date\.now\(/,
    /new Date\((?!\s*Date\.UTC\()/,
    /\.(getDay|getDate|getMonth|getFullYear|getHours|getMinutes|getSeconds|getTime|getTimezoneOffset)\(/,
    /\.set(Date|Month|FullYear|Hours)\(/,
    /toLocale\w*\(/,
    /toDateString|toISOString/,
  ];
  const code = () => stripComments(source('lib/calendarGrid.ts'));

  it.each(FORBIDDEN.map((rule) => [String(rule), rule] as const))('lib/calendarGrid.ts has no %s', (_name, rule) => {
    expect(rule.test(code())).toBe(false);
  });

  it('formats through Intl pinned to UTC, and reads dates back with the UTC accessors only', () => {
    const grid = code();
    expect(grid).toMatch(/timeZone: 'UTC'/);
    expect(grid.match(/timeZone:/g)).toHaveLength(1);
    expect(grid.match(/\.get\w+\(/g)?.every((use) => use.startsWith('.getUTC'))).toBe(true);
  });

  it('the scanner can see a violation (positive control)', () => {
    expect(FORBIDDEN.some((rule) => rule.test('const a = Date.now();'))).toBe(true);
    expect(FORBIDDEN.some((rule) => rule.test('const a = new Date(value);'))).toBe(true);
    expect(FORBIDDEN.some((rule) => rule.test('const a = d.getDate();'))).toBe(true);
    expect(FORBIDDEN.some((rule) => rule.test('const a = new Date(Date.UTC(2026, 0, 1)); a.getUTCDate();'))).toBe(false);
  });

  it('only the grid file builds dates: the view model, the hook and the screen never do', () => {
    for (const path of ['lib/calendarView.ts', 'hooks/use-calendar.ts', 'app/calendar.tsx', 'components/CalendarGrid.tsx', 'components/CalendarDayCell.tsx']) {
      expect(stripComments(source(path))).not.toMatch(/new Date\(|Date\.UTC\(/);
    }
  });
});

describe('the calendar reads only what the spec allows', () => {
  const CALENDAR_FILES = ['app/calendar.tsx', 'hooks/use-calendar.ts', 'lib/calendarView.ts', 'components/CalendarGrid.tsx', 'components/CalendarDayCell.tsx', 'services/visitDays.ts'];

  it('calls getMyEngagement once and never openEngagement: opening the calendar settles nothing', () => {
    for (const path of CALENDAR_FILES) expect(stripComments(source(path))).not.toContain('openEngagement');
    const hook = stripComments(source('hooks/use-calendar.ts'));
    expect(hook.match(/getMyEngagement\(/g)).toHaveLength(1);
  });

  it('never reads attendance_events (check:attendance-readers) and goes through the two RPCs', () => {
    for (const path of CALENDAR_FILES) expect(stripComments(source(path))).not.toMatch(/attendance_events|attendance_counted/);
    const service = stripComments(source('services/visitDays.ts'));
    expect(service).toMatch(/rpc\('my_visit_days'/);
    expect(service).toMatch(/rpc\('my_first_visit_day'/);
  });

  it('never remembers the month viewed: the screen and the hook write no storage themselves, only the loaded days go through the cache functions', () => {
    for (const path of ['app/calendar.tsx', 'hooks/use-calendar.ts']) {
      const code = stripComments(source(path));
      expect(code).not.toMatch(/AsyncStorage|localStorage|SecureStore|setItem/);
    }
    const cacheWrites = stripComments(source('hooks/use-calendar.ts')).match(/writeCalendar\w+\(/g) ?? [];
    expect(cacheWrites.sort()).toEqual(['writeCalendarFirstVisitDay(', 'writeCalendarMonth(']);
  });

  it('swipes with PanResponder and no gesture library', () => {
    const screen = stripComments(source('app/calendar.tsx'));
    expect(screen).toContain('PanResponder');
    expect(screen).not.toMatch(/react-native-gesture-handler|reanimated/);
    expect(screen).toMatch(/isScreenReaderEnabled/);
  });

  it('calls the calendar functions from nothing else (no Home, no Profile)', () => {
    for (const path of ['app/(tabs)/index.tsx', 'app/(tabs)/profile.tsx', 'hooks/use-home-engagement.ts']) {
      expect(stripComments(source(path))).not.toMatch(/getMyVisitDays|getMyFirstVisitDay|services\/visitDays/);
    }
  });
});

describe('Home card and Profile row open /calendar (closes the 30.4 card-tap deferral)', () => {
  it('Home passes the push to the card, and the card is one button that uses it', () => {
    const home = stripComments(source('app/(tabs)/index.tsx'));
    expect(home).toMatch(/onPressCard=\{\(\) => router\.push\('\/calendar'\)\}/);
    const card = stripComments(source('components/WeeklyRingCard.tsx'));
    expect(card).toMatch(/onPress=\{onPressCard\}/);
    expect(card).toMatch(/accessibilityRole="button" accessibilityLabel=\{view\.cardLabel\} accessibilityHint=\{view\.cardHint\}/);
    // The goal button and the goal hint stay their own targets, outside the card button.
    expect(card).toMatch(/onPress=\{onGoalPress\}/);
    expect(card).toMatch(/onPress=\{onGoalHintPress\}/);
  });

  it('Profile has a "My visits" row inside the Training card, shown only while the engagement area is on', () => {
    const profile = stripComments(source('app/(tabs)/profile.tsx'));
    expect(profile).toMatch(/engagementEnabled && \(\s*<Pressable[\s\S]*?router\.push\('\/calendar'\)[\s\S]*?t\('engage\.calendar\.title'\)/);
    expect(profile).toContain('getMyEngagement');
    expect(profile).toMatch(/setEngagementEnabled\(showMyVisitsRow\(result\)\)/);
    expect(profile).not.toContain('openEngagement');
  });

  it('the route is registered inside the fully-onboarded group, next to workout-plan', () => {
    const layout = stripComments(source('app/_layout.tsx'));
    const group = layout.slice(layout.indexOf('<Stack.Protected guard={isFullyOnboarded}>'), layout.indexOf('</Stack.Protected>'));
    expect(group).toContain('<Stack.Screen name="calendar" />');
    expect(group).toContain('<Stack.Screen name="workout-plan" />');
  });
});

describe('the at-risk hint is shared, not copied (Story 30.5)', () => {
  it('Home and the calendar import AtRiskHint, and the pulse and the reduce-motion check live in one hook', () => {
    const card = stripComments(source('components/WeeklyRingCard.tsx'));
    expect(card).toContain("from '@/components/AtRiskHint'");
    expect(card).not.toMatch(/function AtRiskHint|Animated\.|reduceMotion|isReduceMotionEnabled/);
    expect(stripComments(source('app/calendar.tsx'))).toContain("from '@/components/AtRiskHint'");
    for (const path of ['components/AtRiskHint.tsx', 'components/CalendarDayCell.tsx']) expect(stripComments(source(path))).toContain('useAtRiskPulse');
    const hook = stripComments(source('hooks/use-at-risk-pulse.ts'));
    expect(hook).toMatch(/iterations: PULSE_CYCLES/);
    expect(hook).toContain('isReduceMotionEnabled');
    expect(stripComments(source('components/AtRiskHint.tsx'))).not.toContain('isReduceMotionEnabled');
  });

  it('the calendar uses the same rule as Home through the exported hintFor', () => {
    expect(stripComments(source('lib/weeklyRing.ts'))).toMatch(/export function hintFor\(/);
    const view = stripComments(source('lib/calendarView.ts'));
    expect(view).toMatch(/hintFor\(/);
    expect(view).toMatch(/msLeftInDay\(/);
    expect(view).toMatch(/queuedTodayCount\(/);
    expect(view).toMatch(/timeLeftParts\(/);
  });
});
