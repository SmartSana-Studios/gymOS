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
  // Story 30.6: the leaderboard screen, its notice, row and Home card, their hooks and view model. Same rules: no sentence in a screen file, no date
  // construction. (The one time-of-day format lives in lib/clockTime.ts, which is not scanned: it decides no day, month or rank.)
  'app/leaderboard.tsx',
  'components/LeaderboardRow.tsx',
  'components/LeaderboardNotice.tsx',
  'components/LeaderboardHomeCard.tsx',
  'hooks/use-leaderboard.ts',
  'hooks/use-leaderboard-notice.ts',
  'hooks/use-home-leaderboard.ts',
  'lib/leaderboardView.ts',
  // Story 30.7: the milestone celebration, its mini month, its Home hook and view model. Same rules: no sentence in a screen file, no date construction
  // (the mini month goes through lib/calendarGrid.ts).
  'app/celebration/[milestoneId].tsx',
  'components/CelebrationMiniMonth.tsx',
  'hooks/use-home-celebration.ts',
  'lib/celebrationView.ts',
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
    expect(profile).toMatch(/setEngagementEnabled\(\(current\) => myVisitsRowAfterRead\(current, result\)\)/);
    expect(profile).toMatch(/readEngagementCache\(sessionUserId, gymId\)/);
    expect(profile).toMatch(/setEngagementEnabled\(myVisitsRowFromCache\(cached\)\)/);
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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Story 30.6: the gym leaderboard (FR-226, FR-227, FR-228, NFR-027)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const BOARD_FILES = [
  'app/leaderboard.tsx',
  'components/LeaderboardRow.tsx',
  'components/LeaderboardNotice.tsx',
  'components/LeaderboardHomeCard.tsx',
  'hooks/use-leaderboard.ts',
  'hooks/use-leaderboard-notice.ts',
  'hooks/use-home-leaderboard.ts',
  'lib/leaderboardView.ts',
];

const stripped = (path: string) => stripComments(source(path));

describe('the device never derives a label, a rank, a tie or a total', () => {
  // The server decides everything about a member. A sort, a reduce, a split of a name, a first letter, a case change, a comparison of names, or
  // arithmetic on a rank, a visit count or the total would be the device deriving one of them.
  const FORBIDDEN: [string, RegExp][] = [
    ['sort', /\.(sort|toSorted)\(/],
    ['reduce', /\.(reduce|reduceRight)\(/],
    ['split', /\.split\(/],
    ['charAt', /\.charAt\(|\.at\(0\)|\[0\]\.toUpperCase/],
    ['case change', /\.(toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase)\(/],
    ['name comparison', /\.localeCompare\(|\.substring\(|\.substr\(/],
    ['Math', /Math\./],
    ['arithmetic on a rank, a count or the total', /\b(rank|rankedTotal|visits|visitsBehind)\b\s*[-+*/%]\s*[\w(]|[\w)]\s*[-+*/%]\s*\b(rank|rankedTotal|visits|visitsBehind)\b/],
    ['a count of rows used as a total', /rows\.length\s*[<>=!]|items\.length\s*[<>=!]/],
  ];

  it.each(BOARD_FILES.flatMap((path) => FORBIDDEN.map(([name, rule]) => [path, name, rule] as const)))('%s has no %s', (path, _name, rule) => {
    expect(rule.test(stripped(path))).toBe(false);
  });

  it('the scanner can see each violation (positive control)', () => {
    const samples = [
      'rows.sort((a, b) => a.rank - b.rank)',
      'rows.reduce((n, r) => n + r.visits, 0)',
      'name.split(" ")',
      'name.charAt(0)',
      'label.toUpperCase()',
      'a.label.localeCompare(b.label)',
      'Math.max(rank)',
      'const next = rank + 1;',
      'const n = rankedTotal - 1;',
      'if (rows.length < 3) {}',
    ];
    for (const sample of samples) expect(FORBIDDEN.some(([, rule]) => rule.test(sample)), sample).toBe(true);
    // The separator compares server positions: that is allowed, and is not a rank.
    expect(FORBIDDEN.some(([, rule]) => rule.test('row.position !== previous + 1'))).toBe(false);
  });

  it('the view model takes its labels and numbers from the rows and chooses the state from the server total', () => {
    const view = stripped('lib/leaderboardView.ts');
    expect(view).toMatch(/row\.label/);
    expect(view).toMatch(/String\(row\.rank\)/);
    expect(view).toMatch(/board\.rows\[0\]\.rankedTotal < MIN_RANKED/);
    expect(view).toMatch(/standing\.rankedTotal < MIN_RANKED/);
  });
});

describe('the leaderboard service is the only caller of the four RPCs, and touches nothing else', () => {
  it('calls exactly the four functions, never attendance, and never the preferences table', () => {
    const service = stripped('services/leaderboard.ts');
    for (const name of ['gym_leaderboard', 'my_leaderboard_settings', 'set_leaderboard_visibility', 'mark_leaderboard_notice_seen']) expect(service).toContain(`rpc('${name}'`);
    expect(service.match(/\.rpc\(/g)).toHaveLength(4);
    expect(service).not.toMatch(/attendance_events|attendance_counted|member_preferences|updateMemberPreferences|\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
    for (const path of BOARD_FILES) expect(stripped(path)).not.toMatch(/attendance_events|attendance_counted|member_preferences|updateMemberPreferences|\.from\(/);
  });

  it('the Profile toggle never goes through updateMemberPreferences', () => {
    const profile = stripped('app/(tabs)/profile.tsx');
    const handler = profile.slice(profile.indexOf('async function handleToggleAnonymous'), profile.indexOf('function renderAnonymousRow'));
    expect(handler).toContain('setLeaderboardVisibility(');
    expect(handler).not.toContain('updateMemberPreferences');
  });
});

describe('the notice: nothing is marked by opening or leaving, and the board waits for the choice', () => {
  it('markLeaderboardNoticeSeen is reached only from the notice hook, through runNoticeChoice', () => {
    expect(stripped('hooks/use-leaderboard-notice.ts')).toMatch(/markSeen: markLeaderboardNoticeSeen/);
    for (const path of ['app/leaderboard.tsx', 'hooks/use-leaderboard.ts', 'hooks/use-home-leaderboard.ts', 'app/(tabs)/profile.tsx', 'app/(tabs)/index.tsx', 'components/LeaderboardNotice.tsx']) {
      expect(stripped(path)).not.toContain('markLeaderboardNoticeSeen');
    }
  });

  it('the notice component is shared: the route renders it in place and Profile in a full-screen modal that only closes', () => {
    expect(stripped('app/leaderboard.tsx')).toContain('<LeaderboardNotice');
    const profile = stripped('app/(tabs)/profile.tsx');
    expect(profile).toContain('<LeaderboardNotice');
    expect(profile).toMatch(/<Modal visible=\{noticeOpen\} animationType="slide" presentationStyle="fullScreen" onRequestClose=\{\(\) => setNoticeOpen\(false\)\}>/);
    expect(profile).not.toMatch(/pageSheet|formSheet/);
    expect(profile).toMatch(/onPress=\{\(\) => setNoticeOpen\(false\)\}/);
  });

  it('gym_leaderboard is called only after the settings say the notice was chosen on', () => {
    const hook = stripped('hooks/use-leaderboard.ts');
    expect(hook.match(/getGymLeaderboard\(/g)).toHaveLength(1);
    // The one board load sits in loadBoard; loadAll, selectTab and the notice result reach it only behind the notice flag.
    expect(hook).toMatch(/if \(next && next\.noticeSeen\) await loadBoard\(/);
    expect(hook).toMatch(/if \(settingsRef\.current\?\.noticeSeen\) void loadBoard\(/);
    expect(hook).toMatch(/if \(outcome\.ok\) \{[\s\S]*?await loadBoard\(/);
    // A device copy is written only after a live board, and with the settings once noticeSeen is true.
    expect(hook.match(/writeLeaderboardBoard\(/g)).toHaveLength(1);
    expect(hook).toMatch(/if \(next && !pendingRef\.current && mayKeepSettingsCopy\(next\) && userId && gymId\) \{\s*void writeLeaderboardSettings\(/);
  });

  it('leaving never calls anything: the screen back button only goes back', () => {
    expect(stripped('app/leaderboard.tsx')).toMatch(/onPress=\{\(\) => router\.back\(\)\}/);
  });
});

describe('the leaderboard is dark while the engagement area is', () => {
  it('Home reuses the ring card\x27s engagement read (never a second one) and calls the board only past the dark check, with one load call from the screen', () => {
    const hook = stripped('hooks/use-home-leaderboard.ts');
    expect(hook).not.toMatch(/getMyEngagement|openEngagement|services\/engagement/);
    expect(hook).toContain('await engagementRead');
    // The anchors are strings the hook really contains (an indexOf of -1 would pass any "less than" check): the gate, then the plan, then the call.
    const gateAt = hook.indexOf('gateFromOutcome(outcome)');
    const planReturnAt = hook.indexOf('if (!plan.call)');
    const callAt = hook.indexOf('getGymLeaderboard(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(planReturnAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(planReturnAt);
    expect(planReturnAt).toBeLessThan(callAt);
    expect(hook.match(/getGymLeaderboard\(/g)).toHaveLength(1);
    const screen = stripped('app/(tabs)/index.tsx');
    expect(screen.match(/loadLeaderboardForHome\(/g)).toHaveLength(1);
    expect(screen).not.toMatch(/getGymLeaderboard|services\/leaderboard|weekStart|weekEnd|dayStartsAt|dayEndsAt|serverNow|gymToday/);
  });

  it('Profile reads the settings only when the pure plan says read (the area is on), and clears the row for a dark area', () => {
    const profile = stripped('app/(tabs)/profile.tsx');
    expect(profile.match(/getMyLeaderboardSettings\(/g)).toHaveLength(1);
    expect(profile).toContain('gateFromResult(result)');
    expect(profile).toContain('profileSettingsPlan(gate, myVisitsRowFromCache(deviceCopy))');
    const planAt = profile.indexOf('profileSettingsPlan(');
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(profile.indexOf("plan === 'read'"));
    expect(profile.indexOf("plan === 'read'")).toBeLessThan(profile.indexOf('getMyLeaderboardSettings('));
    expect(profile).toMatch(/engagementEnabled && renderAnonymousRow\(\)/);
  });

  it('every consumer follows the same pure functions (gate, Home plan, toggle result, notice result)', () => {
    const screen = stripped('hooks/use-leaderboard.ts');
    const home = stripped('hooks/use-home-leaderboard.ts');
    const profile = stripped('app/(tabs)/profile.tsx');
    // The screen calls the settings read only past mayCallLeaderboard, and never in a dark area.
    expect(screen).toContain('gateFromResult(engagement)');
    expect(screen.indexOf('if (mayCallLeaderboard(gate))')).toBeGreaterThan(-1);
    expect(screen.indexOf('if (mayCallLeaderboard(gate))')).toBeLessThan(screen.indexOf('getMyLeaderboardSettings('));
    // Home acts on planHomeLoad and returns before any call when it says not to call.
    expect(home).toMatch(/planHomeLoad\(\{ gate, cached, month \}\)/);
    expect(home).toMatch(/if \(!plan\.call\) \{\s*commit\(plan\.show \?\? \{ kind: 'hidden' \}\);\s*return;\s*\}/);
    expect(home).toContain('writeHomeStanding(userId, gymId, standing, now, board)');
    // The toggle and the notice result go through the same two functions in the screen hook and in Profile.
    for (const code of [screen, profile]) {
      expect(code).toContain('settingsAfterToggle(current, nextHidden, ok)');
      expect(code).toContain('settingsAfterNotice(current, outcome)');
      expect(code).toContain('mayKeepSettingsCopy(after)');
    }
    // A settings read that returns during a save does not overwrite the optimistic value.
    expect(screen).toMatch(/if \(pendingRef\.current\) next = settingsRef\.current;/);
    expect(profile).toContain('anonymousPendingRef.current');
  });

  it('the screen hook reads the engagement row for the months and refuses a dark area', () => {
    const hook = stripped('hooks/use-leaderboard.ts');
    expect(hook.match(/getMyEngagement\(/g)).toHaveLength(1);
    expect(hook).toMatch(/monthsFromToday\(/);
    // The dark gate is its own branch (the `unavailable` settings read also sets `dark`, so a bare /dark = true/ would survive deleting this one).
    expect(hook).toContain("else if (gate === 'dark') dark = true;");
    expect(hook).toContain('gateRef.current = gate;');
  });

  it('the one board call sits behind boardSource, so an unknown or dark gate and a missing connection read the device copy only', () => {
    const hook = stripped('hooks/use-leaderboard.ts');
    const sourceAt = hook.indexOf("boardSource(gateRef.current, connectedRef.current) === 'copy'");
    const callAt = hook.indexOf('getGymLeaderboard(');
    expect(sourceAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(sourceAt).toBeLessThan(callAt);
    // The gate is recorded before any board load of that pass can run.
    expect(hook.indexOf('gateRef.current = gate;')).toBeLessThan(hook.indexOf('await loadBoard(tabRef.current, boardsRef'));
    // An unconfirmed optimistic value of a pending save is never written to the device copy.
    expect(hook).toMatch(/if \(next && !pendingRef\.current && mayKeepSettingsCopy\(next\) && userId && gymId\) \{/);
  });
});

describe('placement and registration', () => {
  it('the route is registered inside the fully-onboarded group', () => {
    const layout = stripped('app/_layout.tsx');
    const group = layout.slice(layout.indexOf('<Stack.Protected guard={isFullyOnboarded}>'), layout.indexOf('</Stack.Protected>'));
    expect(group).toContain('<Stack.Screen name="leaderboard" />');
  });

  it('the Home card sits between the ring section and the Rewards card, and opens /leaderboard', () => {
    const home = stripped('app/(tabs)/index.tsx');
    const ring = home.indexOf('<WeeklyRingSection');
    const card = home.indexOf('<LeaderboardHomeCard');
    const rewards = home.indexOf('<RewardsCard');
    expect(ring).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(ring);
    expect(rewards).toBeGreaterThan(card);
    expect(home).toMatch(/onPress=\{\(\) => router\.push\('\/leaderboard'\)\}/);
  });

  it('the Profile row sits in the Training card after My visits, under the same enabled gate, and links to the board', () => {
    const profile = stripped('app/(tabs)/profile.tsx');
    const visits = profile.indexOf("router.push('/calendar')");
    const row = profile.indexOf('engagementEnabled && renderAnonymousRow()');
    expect(visits).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(visits);
    expect(profile).toMatch(/router\.push\('\/leaderboard'\)/);
    expect(profile).toMatch(/pending: anonymousPending/);
  });

  it('no crown, medal, trophy or star glyph and no rank-based colour anywhere on the board', () => {
    for (const path of BOARD_FILES) {
      expect(stripped(path)).not.toMatch(/emoji-events|military-tech|workspace-premium|\bstars?\b|crown|medal|trophy|gold|silver|bronze/i);
    }
  });

  it('rows are not tappable', () => {
    expect(stripped('components/LeaderboardRow.tsx')).not.toMatch(/Pressable|onPress|TouchableOpacity/);
  });
});

describe('every key the board files ask for exists in both catalogs', () => {
  it.each(['en', 'fr'] as const)('%s', (lang) => {
    const catalog = JSON.parse(readFileSync(fileURLToPath(new URL(`../locales/${lang}.json`, import.meta.url)), 'utf8')) as Record<string, unknown>;
    const lookup = (key: string): unknown => {
      let node: unknown = catalog;
      for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
      return node;
    };
    const missing: string[] = [];
    for (const path of [...BOARD_FILES, 'app/(tabs)/profile.tsx']) {
      for (const [, key] of stripped(path).matchAll(/\bt\(\s*['"](engage\.[\w.]+)['"]/g)) {
        const plain = lookup(key);
        const plural = lookup(`${key}_one`);
        if (typeof plain !== 'string' && typeof plural !== 'string') missing.push(`${path}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Story 30.7: the milestone celebration (FR-229, FR-232; MA-20)
// ---------------------------------------------------------------------------------------------------------------------------------------------

describe('the celebration screen (MA-20)', () => {
  const ROUTE = 'app/celebration/[milestoneId].tsx';
  const CELEBRATION_FILES = [ROUTE, 'components/CelebrationMiniMonth.tsx', 'hooks/use-home-celebration.ts', 'lib/celebrationView.ts'];

  it('has no looping animation, no sound and no confetti', () => {
    for (const path of CELEBRATION_FILES) {
      const code = stripped(path);
      expect(code, path).not.toMatch(/Animated\.loop|\bloop:|\bloop\(|expo-av|expo-audio|\bSound\b|\.mp3|\.wav|\.m4a|confetti|Lottie|lottie|setInterval/i);
    }
    expect(stripped('hooks/use-at-risk-pulse.ts')).toContain('Animated.loop');
  });

  it('the scanner can see a loop and a sound (positive control)', () => {
    expect(/Animated\.loop|expo-av/.test('Animated.loop(x)')).toBe(true);
    expect(/Animated\.loop|expo-av/.test("import { Audio } from 'expo-av'")).toBe(true);
  });

  it('has no Share button and no badges link (Epic 31)', () => {
    for (const path of CELEBRATION_FILES) {
      expect(stripped(path), path).not.toMatch(/cta\.share|cta\.badges|engage\.share|engage\.badges|expo-sharing|Share\./);
    }
    expect(stripped(ROUTE).match(/<Button\b/g)).toHaveLength(1);
    expect(stripped(ROUTE)).toContain('view.continueLabel');
  });

  it('takes no more from the at-risk pulse file than the reduce-motion check', () => {
    const route = stripped(ROUTE);
    const imports = [...route.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/hooks\/use-at-risk-pulse'/g)].map((m) => m[1].trim());
    expect(imports).toEqual(['useReduceMotion']);
    expect(route).not.toMatch(/useAtRiskPulse|use-at-risk-pulse'.*AtRisk/);
  });

  it('plays the Success haptic on appear whatever the motion setting, and runs the plan from the view model', () => {
    const route = stripped(ROUTE);
    expect(route).toMatch(/Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/);
    expect(route).toMatch(/motionPlan\(reduceMotion\)/);
    expect(route).toContain('useReduceMotion()');
    expect(route).toContain('isReduceMotionEnabled');
  });

  it('is announced once as an alert, with the headline focused and the numeral and mini calendar decorative', () => {
    const route = stripped(ROUTE);
    expect(route).toMatch(/accessibilityRole="alert"/);
    expect(route).toMatch(/announceForAccessibility\(view\.a11y\)/);
    expect(route).toContain('setAccessibilityFocus');
    expect(route).toMatch(/accessibilityRole="none"/);
    expect(stripped('components/CelebrationMiniMonth.tsx')).toMatch(/accessibilityRole="none"/);
    // The numeral changes every frame of the count-up: a screen reader must not read the intermediate values (the sentence and the headline carry it).
    expect(route).toMatch(/accessibilityRole="none" accessibilityElementsHidden importantForAccessibility="no" style=\{styles\.numeral\}/);
  });

  it('the route guards come from the tested pure functions, and an unwanted Home redirect goes back or replaces, never stacks', () => {
    const route = stripped(ROUTE);
    expect(route).toContain('const motionKnown = motionRead !== null;');
    expect(route).toContain('reduceMotionFrom(motionRead, hookReduceMotion)');
    expect(route).toContain('celebrationVisible({ dataReady, motionKnown, openHome, hasView: view !== null })');
    expect(route).toContain('closeRecord({ visible, milestone, userId, gymId })');
    expect(route).toContain('if (record) void finishCelebration(CLOSE_DEPS, record.userId, record.gymId, record.milestone)');
    // The only router.replace is the cold-open branch of goHome; the openHome effect goes through goHome.
    expect(route.match(/router\.replace\(/g)).toHaveLength(1);
    expect(route).toMatch(/if \(openHome && !closedRef\.current\) \{\s*closedRef\.current = true;\s*goHome\(\);/);
  });

  it('closes on [Keep going] and Android back only: the record is written before the call, swipe down is off', () => {
    const route = stripped(ROUTE);
    expect(route).toMatch(/hardwareBackPress/);
    expect(route).toMatch(/finishCelebration\(/);
    const view = stripped('lib/celebrationView.ts');
    const finish = view.slice(view.indexOf('export async function finishCelebration'), view.indexOf('export async function retryAcknowledge'));
    expect(finish.indexOf('deps.writeShown(')).toBeGreaterThan(-1);
    expect(finish.indexOf('deps.writeShown(')).toBeLessThan(finish.indexOf('deps.acknowledge('));
    const layout = source('app/_layout.tsx');
    expect(layout).toMatch(/<Stack\.Screen name="celebration\/\[milestoneId\]" options=\{\{ animation: 'fade', gestureEnabled: false \}\} \/>/);
    const group = layout.slice(layout.indexOf('<Stack.Protected guard={isFullyOnboarded}>'), layout.indexOf('</Stack.Protected>'));
    expect(group).toContain('celebration/[milestoneId]');
  });

  it('reads its own gym by id and the mini month through the calendar grid, never a second engagement read', () => {
    expect(stripped('services/milestones.ts')).toMatch(/\.eq\('id', gymId\)/);
    const route = stripped(ROUTE);
    expect(route).not.toMatch(/getMyEngagement|openEngagement|loadEngagement/);
    expect(route).toContain('getMyVisitDays(');
    expect(stripped('lib/celebrationView.ts')).toMatch(/buildMonthGrid\(/);
  });

  it('the Home hook takes the one engagement read it is handed and never reads the row itself', () => {
    const hook = stripped('hooks/use-home-celebration.ts');
    expect(hook).not.toMatch(/getMyEngagement|openEngagement|loadEngagement\(/);
    expect(hook).toContain('await engagementRead');
    // The pick of the milestone and the retry decision are one tested pure function; the hook must call it and act on both halves.
    expect(hook).toContain('homeCelebrationPlan({ outcome, shown, connected: connectedRef.current })');
    expect(hook).toContain('setCandidate(plan.candidate)');
    expect(hook).toContain('if (plan.retry) void retryAcknowledge(DEPS, userId, gymId, shown)');
    expect(hook).toMatch(/PUSH_DELAY_MS = 600/);
    expect(hook).toMatch(/return \(\) => clearTimeout\(timer\)/);
    const home = stripped('app/(tabs)/index.tsx');
    expect(home.match(/loadEngagementForHome\(/g)).toHaveLength(1);
    expect(home.match(/loadCelebrationForHome\(/g)).toHaveLength(1);
    expect(home).not.toMatch(/services\/visitDays|services\/milestones|acknowledgeMilestone/);
    expect(home).toContain('homeReadyForCelebration({ loading, loadError, subscriptionStatus })');
    expect(hook).toContain('celebrationDue({ milestone, today, ready, focused })');
  });

  it('the shown-store is cleared beside clearCachedProgressPayload at the three sign-out sites', () => {
    for (const path of ['app/(tabs)/profile.tsx', 'app/suspended.tsx', 'app/awaiting-registration.tsx']) {
      expect(stripped(path), path).toMatch(/clearCachedProgressPayload\(\);\s*void clearShown\(\);/);
    }
  });

  it('the calendar hook builds its month data through the tested pure functions, so the markers cannot be dropped silently', () => {
    const hook = stripped('hooks/use-calendar.ts');
    expect(hook).toContain('readyFromServer(result.days)');
    expect(hook).toContain('readyFromCache(cacheRef.current, target)');
    expect(hook).toMatch(/writeCalendarMonth\(userId, gymId, target, ready\.days, ready\.milestones \?\? \{\}\)/);
  });

  it('the calendar marker is the star, hidden from a screen reader, and the legend has a third entry', () => {
    const cell = stripped('components/CalendarDayCell.tsx');
    expect(cell).toMatch(/name="star"/);
    expect(cell).toMatch(/\{cell\.milestone !== null && \(\s*<View style={styles\.star}/);
    expect(cell).toMatch(/STAR_SIZE = 14/);
    expect(cell).toMatch(/star: \{\s*position: 'absolute',\s*top: 1,\s*left: 1/);
    expect(stripped('app/calendar.tsx')).toMatch(/'star'/);
  });
});
