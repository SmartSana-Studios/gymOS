import { createInstance } from 'i18next';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, storage } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    }),
  };
  return { store, storage };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { BadgeRow } from '@/lib/badgeCodes';

import {
  badgeGlyph,
  badgesStoreKey,
  buildBadgeTile,
  buildShelfView,
  buildSheetView,
  clearBadgesCache,
  earnedCount,
  lockedLine,
  parseStoredBadges,
  profileBadgesValue,
  readBadgesCache,
  resolveBadgeRows,
  resolveShelfLoad,
  writeBadgesCache,
  type ShelfLoad,
  type ShelfResult,
} from './badgesView';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr' = 'en'): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: en }, fr: { translation: fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

const earned = (code: BadgeRow['code'], earnedOn: string, silent = false): BadgeRow => ({ code, earned: true, earnedOn, silent, visitsRemaining: null, weeksProgress: null });
const locked = (code: BadgeRow['code'], visitsRemaining: number | null, weeksProgress: number | null): BadgeRow => ({
  code,
  earned: false,
  earnedOn: null,
  silent: false,
  visitsRemaining,
  weeksProgress,
});

/** The member of the story's example: first visit and 7 earned, 12 more visits to the 30th, and two of four weeks. */
const SHELF: BadgeRow[] = [
  earned('first_visit', '2026-10-14'),
  earned('visits_7', '2026-10-20', true),
  locked('visits_30', 12, null),
  locked('visits_100', 82, null),
  locked('four_weeks', null, 2),
];
const NEW_MEMBER: BadgeRow[] = [locked('first_visit', null, null), locked('visits_7', 7, null), locked('visits_30', 30, null), locked('visits_100', 100, null), locked('four_weeks', null, 0)];

beforeEach(() => {
  store.clear();
  for (const fn of Object.values(storage)) fn.mockClear();
});

describe('tile states in English and French', () => {
  it('an earned tile: the accent chip glyph, the name, and "Earned 14 Oct" (en) / "Obtenu le 14 octobre" (fr)', () => {
    const en1 = buildBadgeTile(SHELF[0], makeT('en'), 'en');
    expect(en1).toMatchObject({ earned: true, name: 'First visit', glyph: 'flag', line: 'Earned 14 Oct', dateText: '14 Oct' });
    expect(en1.accessibilityLabel).toBe('First visit, earned 14 Oct');
    const fr1 = buildBadgeTile(SHELF[0], makeT('fr'), 'fr');
    expect(fr1).toMatchObject({ earned: true, name: 'Première visite', line: 'Obtenu le 14 octobre' });
    expect(fr1.accessibilityLabel).toBe('Première visite, obtenu le 14 octobre');
  });

  it('a badge earned silently at release reads exactly like any earned badge, with the stored historic date', () => {
    const silent = buildBadgeTile(earned('visits_30', '2025-03-02', true), makeT('en'), 'en');
    const loud = buildBadgeTile(earned('visits_30', '2025-03-02', false), makeT('en'), 'en');
    expect(silent).toEqual(loud);
    expect(silent.line).toBe('Earned 2 Mar');
  });

  it.each([
    ['en', 'First visit', 'Check in once to earn it'],
    ['fr', 'Première visite', 'Venez une fois pour l\'obtenir'],
  ] as const)('locked, first visit (%s): the progress line is the message', (lang, name, line) => {
    const tile = buildBadgeTile(NEW_MEMBER[0], makeT(lang), lang);
    expect(tile).toMatchObject({ earned: false, name, line, dateText: null });
  });

  it.each([
    ['en', 12, '12 more visits to go'],
    ['en', 1, '1 more visit to go'],
    ['fr', 12, 'Encore 12 visites'],
    ['fr', 1, 'Encore 1 visite'],
  ] as const)('locked, in reach (%s, %i visits): "%s"', (lang, remaining, line) => {
    expect(buildBadgeTile(locked('visits_30', remaining, null), makeT(lang), lang).line).toBe(line);
  });

  it('a visit badge with nothing left to go but not yet awarded reads as one more visit, never "0 more visits"', () => {
    expect(lockedLine(locked('visits_7', 0, null), makeT('en'))).toBe('1 more visit to go');
  });

  it.each([
    ['en', 2, '2 of 4 weeks'],
    ['en', 0, 'Keep a streak going for 4 weeks'],
    ['fr', 3, '3 semaines sur 4'],
    ['fr', 0, 'Gardez une série pendant 4 semaines'],
  ] as const)('locked, 4 weeks (%s, progress %i): "%s"', (lang, progress, line) => {
    expect(buildBadgeTile(locked('four_weeks', null, progress), makeT(lang), lang).line).toBe(line);
  });

  it.each(['en', 'fr'] as const)('a locked tile never says "locked" alone, never "0 of", and its label states name and progress (%s)', (lang) => {
    const t = makeT(lang);
    for (const row of [...NEW_MEMBER, ...SHELF.filter((r) => !r.earned)]) {
      const tile = buildBadgeTile(row, t, lang);
      expect(tile.line.length).toBeGreaterThan(0);
      expect(tile.line.toLowerCase()).not.toMatch(/locked|verrouill/);
      expect(tile.line).not.toMatch(/^0 (of|sur)|\b0 (of|sur) \d/);
      expect(tile.accessibilityLabel).toContain(tile.name);
      expect(tile.accessibilityLabel).toContain(tile.line);
    }
  });

  it('the glyphs are the UX table\'s', () => {
    expect(SHELF.map((row) => badgeGlyph(row.code))).toEqual(['flag', 'looks-one', 'local-fire-department', 'military-tech', 'shield']);
  });
});

describe('the shelf', () => {
  it.each([
    ['en', '2 of 5 earned', 'Badges are just for you. They don\'t unlock anything.'],
    ['fr', '2 sur 5 obtenus', 'Les badges sont pour vous. Ils ne débloquent rien.'],
  ] as const)('five tiles in order with the summary and the footnote (%s)', (lang, summary, footnote) => {
    const view = buildShelfView({ load: { kind: 'ready', rows: SHELF, fromCache: false }, t: makeT(lang), language: lang });
    expect(view.face).toBe('tiles');
    expect(view.summary).toBe(summary);
    expect(view.footnote).toBe(footnote);
    expect(view.tiles.map((tile) => tile.code)).toEqual(['first_visit', 'visits_7', 'visits_30', 'visits_100', 'four_weeks']);
    expect(earnedCount(SHELF)).toBe(2);
  });

  it('a new member sees five locked tiles with progress lines, never an empty screen', () => {
    const view = buildShelfView({ load: { kind: 'ready', rows: NEW_MEMBER, fromCache: false }, t: makeT('en'), language: 'en' });
    expect(view.face).toBe('tiles');
    expect(view.tiles).toHaveLength(5);
    expect(view.tiles.every((tile) => !tile.earned && tile.line !== '')).toBe(true);
    expect(view.summary).toBe('0 of 5 earned');
  });

  it('the device copy shows the same tiles (offline)', () => {
    const live = buildShelfView({ load: { kind: 'ready', rows: SHELF, fromCache: false }, t: makeT('en'), language: 'en' });
    const cached = buildShelfView({ load: { kind: 'ready', rows: SHELF, fromCache: true }, t: makeT('en'), language: 'en' });
    expect(cached).toEqual(live);
  });

  it.each([
    ['en', "Couldn't load your badges. Pull down to refresh."],
    ['fr', 'Impossible de charger vos badges. Tirez pour actualiser.'],
  ] as const)('loading has no tiles; the error face carries the catalog message (%s)', (lang, message) => {
    const loading = buildShelfView({ load: { kind: 'loading' }, t: makeT(lang), language: lang });
    expect(loading).toMatchObject({ face: 'loading', tiles: [], summary: null });
    const error = buildShelfView({ load: { kind: 'error' }, t: makeT(lang), language: lang });
    expect(error).toMatchObject({ face: 'error', tiles: [], summary: null, errorMessage: message });
  });
});

describe('the detail sheet', () => {
  const t = makeT('en');
  const earnedTile = buildBadgeTile(SHELF[0], t, 'en');
  const lockedTile = buildBadgeTile(SHELF[2], t, 'en');

  it('an earned badge: large chip data, name, date line and Share', () => {
    const view = buildSheetView(earnedTile, t, true);
    expect(view).toMatchObject({ earned: true, name: 'First visit', line: 'Earned 14 Oct', showShare: true, shareLabel: 'Share', closeLabel: 'Close' });
  });

  it('a locked badge opens the same sheet without Share, showing the progress line', () => {
    const view = buildSheetView(lockedTile, t, true);
    expect(view).toMatchObject({ earned: false, line: '12 more visits to go', showShare: false });
  });

  it('an earned badge loses Share once sharing is known to be unavailable on this phone', () => {
    expect(buildSheetView(earnedTile, t, false).showShare).toBe(false);
  });

  it('the French sheet reads the catalog', () => {
    const tf = makeT('fr');
    const view = buildSheetView(buildBadgeTile(SHELF[0], tf, 'fr'), tf, true);
    expect(view).toMatchObject({ shareLabel: 'Partager', closeLabel: 'Fermer' });
  });
});

describe('resolveShelfLoad: what the shelf shows after a load', () => {
  const LIVE: BadgeRow[] = SHELF;
  const CACHED: BadgeRow[] = NEW_MEMBER;
  const ON_SCREEN: ShelfLoad = { kind: 'ready', rows: [...SHELF].reverse().reverse(), fromCache: true };
  const SCREEN_ROWS = (ON_SCREEN as { rows: BadgeRow[] }).rows;
  const RESULTS: [string, ShelfResult][] = [
    ['success', { status: 'success', badges: LIVE }],
    ['unavailable', { status: 'unavailable' }],
    ['error', { status: 'error' }],
  ];

  const table: { cached: boolean; connected: boolean; result: string; onScreen: boolean; expected: ShelfLoad }[] = [];
  for (const cached of [false, true]) {
    for (const connected of [false, true]) {
      for (const [result] of RESULTS) {
        for (const onScreen of [false, true]) {
          let expected: ShelfLoad;
          if (connected && result === 'success') expected = { kind: 'ready', rows: LIVE, fromCache: false };
          else if (onScreen) expected = ON_SCREEN;
          else if (cached) expected = { kind: 'ready', rows: CACHED, fromCache: true };
          else expected = { kind: 'error' };
          table.push({ cached, connected, result, onScreen, expected });
        }
      }
    }
  }

  it.each(table)('cached=$cached connected=$connected result=$result onScreen=$onScreen', ({ cached, connected, result, onScreen, expected }) => {
    const read = RESULTS.find(([name]) => name === result)?.[1] ?? null;
    // Offline no read is made, so there is no result.
    const got = resolveShelfLoad({
      cached: cached ? CACHED : null,
      connected,
      result: connected ? read : null,
      current: onScreen ? ON_SCREEN : { kind: 'loading' },
    });
    // An offline row of the table has no live success to show whatever the (unused) result column says.
    const want = !connected && expected.kind === 'ready' && !expected.fromCache ? (onScreen ? ON_SCREEN : cached ? { kind: 'ready', rows: CACHED, fromCache: true } : { kind: 'error' }) : expected;
    expect(got).toEqual(want);
    void SCREEN_ROWS;
  });

  it('a failed or offline refresh never replaces tiles on screen with the error card, even with no device copy', () => {
    expect(resolveShelfLoad({ cached: null, connected: true, result: { status: 'error' }, current: ON_SCREEN })).toBe(ON_SCREEN);
    expect(resolveShelfLoad({ cached: null, connected: false, result: null, current: ON_SCREEN })).toBe(ON_SCREEN);
  });

  it('the error card only shows with nothing at all to show', () => {
    expect(resolveShelfLoad({ cached: null, connected: true, result: { status: 'unavailable' }, current: { kind: 'loading' } })).toEqual({ kind: 'error' });
    expect(resolveShelfLoad({ cached: null, connected: false, result: null, current: { kind: 'error' } })).toEqual({ kind: 'error' });
  });
});

describe('resolveBadgeRows: the Profile row', () => {
  const RESULTS: ShelfResult[] = [{ status: 'success', badges: SHELF }, { status: 'unavailable' }, { status: 'error' }];

  it.each([false, true].flatMap((cached) => [false, true].flatMap((connected) => RESULTS.flatMap((result) => [false, true].map((current) => ({ cached, connected, result, current }))))))(
    'cached=$cached connected=$connected result=$result.status current=$current',
    ({ cached, connected, result, current }) => {
      const currentRows = current ? NEW_MEMBER : null;
      const got = resolveBadgeRows({ cached: cached ? [...SHELF] : null, connected, result: connected ? result : null, current: currentRows });
      if (connected && result.status === 'success') expect(got).toEqual(SHELF);
      else if (current) expect(got).toBe(currentRows);
      else expect(got).toEqual(cached ? SHELF : null);
    },
  );
});

describe('the Profile row value', () => {
  it('"2 of 5" / "2 sur 5", and nothing while nothing is known', () => {
    expect(profileBadgesValue(SHELF, makeT('en'))).toBe('2 of 5');
    expect(profileBadgesValue(SHELF, makeT('fr'))).toBe('2 sur 5');
    expect(profileBadgesValue(null, makeT('en'))).toBeNull();
  });
});

describe('the device copy', () => {
  it('is keyed per user and gym and versioned', () => {
    expect(badgesStoreKey('u1', 'g1')).toBe('gymos.badges.v1.u1.g1');
  });

  it('round-trips the five rows and is per member and gym', async () => {
    expect(await readBadgesCache('u1', 'g1')).toBeNull();
    expect(await writeBadgesCache('u1', 'g1', SHELF)).toBe(true);
    expect(await readBadgesCache('u1', 'g1')).toEqual(SHELF);
    expect(await readBadgesCache('u1', 'g2')).toBeNull();
    expect(await readBadgesCache('u2', 'g1')).toBeNull();
  });

  it('fails safe: a corrupt value, a wrong version, a wrong row count and a storage failure all read as no copy', async () => {
    store.set(badgesStoreKey('u1', 'g1'), '{not json');
    expect(await readBadgesCache('u1', 'g1')).toBeNull();
    store.set(badgesStoreKey('u1', 'g1'), JSON.stringify({ version: 2, rows: SHELF }));
    expect(await readBadgesCache('u1', 'g1')).toBeNull();
    store.set(badgesStoreKey('u1', 'g1'), JSON.stringify({ version: 1, rows: SHELF.slice(0, 4) }));
    expect(await readBadgesCache('u1', 'g1')).toBeNull();
    expect(parseStoredBadges({ version: 1, rows: [...SHELF.slice(0, 4), { ...SHELF[4], earned: 'x' }] })).toBeNull();
    storage.getItem.mockRejectedValueOnce(new Error('denied'));
    expect(await readBadgesCache('u1', 'g1')).toBeNull();
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await writeBadgesCache('u1', 'g1', SHELF)).toBe(false);
  });

  it('sign-out clears every badge copy and nothing else', async () => {
    await writeBadgesCache('u1', 'g1', SHELF);
    await writeBadgesCache('u2', 'g2', SHELF);
    store.set('gymos.other', 'keep');
    await clearBadgesCache();
    expect([...store.keys()]).toEqual(['gymos.other']);
    storage.getAllKeys.mockRejectedValueOnce(new Error('x'));
    await expect(clearBadgesCache()).resolves.toBeUndefined();
  });
});

describe('the screen files', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never draw a lock', () => {
    for (const path of ['components/BadgeTile.tsx', 'components/BadgeDetailSheet.tsx', 'app/badges.tsx', 'lib/badgesView.ts']) {
      expect(read(path), path).not.toMatch(/['"]lock(-outline|-open)?['"]|icon="lock|name="lock/i);
    }
  });

  it('the screen is registered inside the signed-in group beside calendar and leaderboard', () => {
    const layout = readFileSync(fileURLToPath(new URL('../app/_layout.tsx', import.meta.url)), 'utf8');
    const group = layout.slice(layout.indexOf('<Stack.Protected guard={isFullyOnboarded}>'), layout.indexOf('</Stack.Protected>'));
    expect(group).toContain('<Stack.Screen name="badges" />');
    expect(group.indexOf('name="leaderboard"')).toBeLessThan(group.indexOf('name="badges"'));
  });

  it('the Profile row sits after the calendar row inside the engagement gate and opens /badges', () => {
    const profile = read('app/(tabs)/profile.tsx');
    const calendar = profile.indexOf("router.push('/calendar')");
    const badges = profile.indexOf("router.push('/badges')");
    expect(calendar).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(calendar);
    const gate = profile.lastIndexOf('{engagementEnabled && (', badges);
    expect(gate).toBeGreaterThan(calendar);
    expect(profile).toContain("t('engage.profile.badges.row')");
    expect(profile).toContain('useBadgeRows(engagementEnabled,');
  });

  it('the tiles are two equal columns: a cell is half the row and never grows, so the lone fifth tile keeps its column (skeletons share the cell)', () => {
    const tile = read('components/BadgeTile.tsx');
    expect(tile).toMatch(/cell: \{\s*width: '50%',/);
    expect(tile).not.toMatch(/flexGrow|flexBasis/);
    expect(tile.match(/style=\{styles\.cell\}/g)).toHaveLength(2);
    expect(read('app/badges.tsx')).not.toMatch(/gap: Spacing\.three,\s*\},\s*errorCard/);
  });

  it('both hooks decide through the tested pure functions', () => {
    const hook = read('hooks/use-badges.ts');
    expect(hook).toContain('resolveShelfLoad({');
    expect(hook).toContain('resolveBadgeRows({');
  });

  it('the hook reads on focus with a sequence ref, caches per member and gym, and the shelf screen pulls to refresh', () => {
    const hook = read('hooks/use-badges.ts');
    expect(hook).toContain('useFocusEffect(');
    expect(hook).toContain('++seq.current');
    expect(hook).toContain('writeBadgesCache(userId, gymId, result.badges)');
    expect(hook).not.toMatch(/react-query|useQuery/);
    expect(read('app/badges.tsx')).toContain('<RefreshControl');
  });
});
