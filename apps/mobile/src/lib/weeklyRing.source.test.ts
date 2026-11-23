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
