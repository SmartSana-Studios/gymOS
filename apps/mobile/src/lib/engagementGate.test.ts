import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useSyncExternalStore: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() } }));

import {
  bindEngagementGate,
  gateKey,
  getEngagementGate,
  INITIAL_GATE,
  reduceGate,
  resetEngagementGate,
  setEngagementGateFromOutcome,
  subscribeEngagementGate,
  type GateState,
} from '@/lib/engagementGate';
import type { CachedEngagement } from '@/lib/weeklyRing';

// Story 31.4: the one engagement gate (Home streak line and Streak screen only: the tab bar always has the Streak tab, and Profile's Progress row is always shown). The reducer is the I/O matrix's pure rows; the store
// wraps it; the source scans pin who may read the engagement flag.

const A = gateKey('user-a', 'gym-1');
const B = gateKey('user-b', 'gym-1');
const on = (key: string): GateState => ({ key, gate: 'on' });
const off = (key: string): GateState => ({ key, gate: 'off' });
const unknown = (key: string): GateState => ({ key, gate: 'unknown' });

describe('reduceGate (the I/O matrix)', () => {
  it('starts unknown with nobody bound', () => {
    expect(INITIAL_GATE).toEqual({ key: null, gate: 'unknown' });
  });

  it('cold start, no device copy: stays unknown (the Streak screen shows its off line) until a read answers', () => {
    const bound = reduceGate(INITIAL_GATE, { type: 'bind', key: A });
    expect(bound).toEqual(unknown(A));
    expect(reduceGate(bound, { type: 'cache', key: A, enabled: null })).toEqual(unknown(A));
  });

  it('offline start with a device copy that says enabled: on from the copy; a copy that says dark: off', () => {
    const bound = reduceGate(INITIAL_GATE, { type: 'bind', key: A });
    expect(reduceGate(bound, { type: 'cache', key: A, enabled: true })).toEqual(on(A));
    expect(reduceGate(bound, { type: 'cache', key: A, enabled: false })).toEqual(off(A));
  });

  it('a row outcome sets on and a dark outcome sets off', () => {
    expect(reduceGate(unknown(A), { type: 'outcome', key: A, outcome: 'row' })).toEqual(on(A));
    expect(reduceGate(unknown(A), { type: 'outcome', key: A, outcome: 'dark' })).toEqual(off(A));
    expect(reduceGate(off(A), { type: 'outcome', key: A, outcome: 'row' })).toEqual(on(A));
    expect(reduceGate(on(A), { type: 'outcome', key: A, outcome: 'dark' })).toEqual(off(A));
  });

  it('a failed or offline read changes nothing', () => {
    for (const state of [unknown(A), on(A), off(A)]) {
      expect(reduceGate(state, { type: 'outcome', key: A, outcome: 'failed' })).toBe(state);
    }
  });

  it('a device copy that arrives after a live answer never overrides it', () => {
    expect(reduceGate(off(A), { type: 'cache', key: A, enabled: true })).toEqual(off(A));
    expect(reduceGate(on(A), { type: 'cache', key: A, enabled: false })).toEqual(on(A));
  });

  it("another member's device copy never moves the gate", () => {
    expect(reduceGate(unknown(A), { type: 'cache', key: B, enabled: true })).toEqual(unknown(A));
  });

  it('a member change resets to unknown; binding the same member keeps the answer', () => {
    expect(reduceGate(on(A), { type: 'bind', key: B })).toEqual(unknown(B));
    const same = on(A);
    expect(reduceGate(same, { type: 'bind', key: A })).toBe(same);
  });

  it('sign-out resets to unknown with nobody bound', () => {
    expect(reduceGate(on(A), { type: 'reset' })).toEqual(INITIAL_GATE);
  });

  it('a live answer for a member not bound yet adopts that member', () => {
    expect(reduceGate(INITIAL_GATE, { type: 'outcome', key: A, outcome: 'row' })).toEqual(on(A));
  });

  it("a stale answer for another member never replaces the bound member's gate, and the new member's cache seed still lands", () => {
    const bound = reduceGate(on(A), { type: 'bind', key: B });
    expect(bound).toEqual(unknown(B));
    expect(reduceGate(bound, { type: 'outcome', key: A, outcome: 'dark' })).toBe(bound);
    expect(reduceGate(bound, { type: 'outcome', key: A, outcome: 'row' })).toBe(bound);
    const seeded = reduceGate(bound, { type: 'cache', key: B, enabled: true });
    expect(seeded).toEqual(on(B));
    expect(reduceGate(seeded, { type: 'outcome', key: A, outcome: 'dark' })).toBe(seeded);
  });
});

function copy(enabled: boolean): CachedEngagement {
  return { engagement: { enabled } as CachedEngagement['engagement'], fetchedAtDeviceMs: 1 };
}

describe('the store', () => {
  it('seeds from the device copy, is corrected by the server, notifies once per change and resets', async () => {
    resetEngagementGate();
    const seen: string[] = [];
    const unsubscribe = subscribeEngagementGate(() => seen.push(getEngagementGate()));
    await bindEngagementGate('user-a', 'gym-1', async () => copy(true));
    expect(getEngagementGate()).toBe('on');
    setEngagementGateFromOutcome('user-a', 'gym-1', 'failed');
    expect(getEngagementGate()).toBe('on');
    setEngagementGateFromOutcome('user-a', 'gym-1', 'dark');
    expect(getEngagementGate()).toBe('off');
    setEngagementGateFromOutcome('user-a', 'gym-1', 'dark'); // no change, no notification
    resetEngagementGate();
    expect(getEngagementGate()).toBe('unknown');
    expect(seen).toEqual(['unknown', 'on', 'off', 'unknown']); // the first is the bind (a new member key, same gate)
    unsubscribe();
    setEngagementGateFromOutcome('user-a', 'gym-1', 'row');
    expect(seen).toHaveLength(4);
    resetEngagementGate();
  });

  it('another member signing in starts from unknown, whatever the first member had', async () => {
    resetEngagementGate();
    await bindEngagementGate('user-a', 'gym-1', async () => copy(true));
    expect(getEngagementGate()).toBe('on');
    await bindEngagementGate('user-b', 'gym-1', async () => null);
    expect(getEngagementGate()).toBe('unknown');
    resetEngagementGate();
  });

  it('a device copy that fails to read is no copy', async () => {
    resetEngagementGate();
    await bindEngagementGate('user-a', 'gym-1', async () => {
      throw new Error('storage');
    });
    expect(getEngagementGate()).toBe('unknown');
    resetEngagementGate();
  });

  it('a live answer that lands while the copy is being read wins', async () => {
    resetEngagementGate();
    let release: (value: CachedEngagement | null) => void = () => {};
    const pending = bindEngagementGate('user-a', 'gym-1', () => new Promise((resolve) => (release = resolve)));
    setEngagementGateFromOutcome('user-a', 'gym-1', 'dark');
    release(copy(true));
    await pending;
    expect(getEngagementGate()).toBe('off');
    resetEngagementGate();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Source scans: the consumers of the gate, and every other way to read the engagement flag
// ---------------------------------------------------------------------------------------------------------------------------------------------

const SRC = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const FILES = walk(SRC).map((full) => ({ path: full.slice(SRC.length).replace(/\\/g, '/'), code: strip(readFileSync(full, 'utf8')) }));
const code = (path: string) => FILES.find((file) => file.path === path)?.code ?? '';

/** The screens that may read the gate: the Home streak line and the Streak screen. (Not the tab bar: the Streak tab is always there. Not Profile: its Progress row is always shown.) */
const GATE_CONSUMERS = ['app/(tabs)/index.tsx', 'app/(tabs)/streak/index.tsx'];
/** Everything that reads the engagement flag any other way: the hooks and libs that own the read, and Profile's older rows (My visits, Badges, the Anonymous toggle), which
 * Story 30.5 gated on its own copy of the flag and Story 31.4 leaves exactly as they were. */
const OTHER_FLAG_READERS = /readEngagementCache|myVisitsRowFromCache|\bengagementEnabled\b|getMyEngagement|openEngagement|\.engagement\.enabled|engagement\.enabled/;
const FLAG_READER_ALLOWLIST = new Set(['app/(tabs)/profile.tsx']);

describe('the gate consumers (Story 31.4)', () => {
  it('only Home and the Streak screen read the gate', () => {
    const readers = FILES.filter((file) => /useEngagementGate\(|getEngagementGate\(|subscribeEngagementGate\(/.test(file.code) && file.path !== 'lib/engagementGate.ts')
      .map((file) => file.path)
      .sort();
    expect(readers).toEqual([...GATE_CONSUMERS].sort());
  });

  it('every consumer uses the hook and no screen or component reads the engagement flag any other way (Profile keeps its older rows only)', () => {
    for (const path of GATE_CONSUMERS) expect(code(path), path).toContain('useEngagementGate()');
    const offenders = FILES.filter((file) => /^(app|components)\//.test(file.path))
      .filter((file) => OTHER_FLAG_READERS.test(file.code))
      .map((file) => file.path)
      .filter((path) => !FLAG_READER_ALLOWLIST.has(path));
    expect(offenders).toEqual([]);
  });

  it('the tab bar reads neither the gate nor the flag, and Profile reads no gate (its Progress row is always shown)', () => {
    for (const path of ['components/app-tabs.tsx', 'components/app-tabs.web.tsx']) expect(code(path), path).not.toMatch(new RegExp(`${OTHER_FLAG_READERS.source}|useEngagementGate|engagementGate`));
    expect(code('app/(tabs)/profile.tsx')).not.toMatch(/useEngagementGate|engagementGate/);
  });

  it('the scan can see a violation (positive control)', () => {
    expect(OTHER_FLAG_READERS.test("const c = await readEngagementCache(u, g); if (c.engagement.enabled) {}")).toBe(true);
    expect(OTHER_FLAG_READERS.test("const gate = useEngagementGate();")).toBe(false);
  });

  it('only the Home engagement hook sets the gate from a read, and the layout binds and resets it', () => {
    const setters = FILES.filter((file) => /setEngagementGateFromOutcome\(/.test(file.code) && file.path !== 'lib/engagementGate.ts').map((file) => file.path);
    expect(setters).toEqual(['hooks/use-home-engagement.ts']);
    expect(code('hooks/use-home-engagement.ts')).toContain('setEngagementGateFromOutcome(userId, gymId, outcome.kind)');
    const layout = code('app/(tabs)/_layout.tsx');
    expect(layout).toContain('bindEngagementGate(userId, gymId)');
    expect(layout.match(/resetEngagementGate/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('the gate reads the device copy through the one existing cache, and adds no storage key of its own', () => {
    const gate = code('lib/engagementGate.ts');
    expect(gate).toContain('readEngagementCache');
    expect(gate).not.toMatch(/AsyncStorage|setItem|getItem|gymos\./);
  });
});

describe('the tab bar (Story 31.4)', () => {
  it('the native bar has five tabs in every state: no Progress trigger, the Streak trigger fourth and never hidden, only its label localised', () => {
    const bar = code('components/app-tabs.tsx');
    expect(bar).toContain('<NativeTabs.Trigger name="streak">');
    expect(bar).not.toMatch(/hidden=|streakOn/);
    expect(bar).not.toMatch(/name="progress"|>Progress</);
    expect(bar).toContain('sf="flame" md="local_fire_department"');
    expect(bar).toContain("{t('engage.streak.tab')}");
    expect(bar.indexOf('name="classes"')).toBeLessThan(bar.indexOf('name="streak"'));
    expect(bar.indexOf('name="streak"')).toBeLessThan(bar.indexOf('name="profile"'));
    for (const label of ['Home', 'Check In', 'Classes', 'Profile']) expect(bar).toContain(`>${label}</NativeTabs.Trigger.Label>`);
  });

  it('the web bar always has the Streak tab and no Progress tab', () => {
    const bar = code('components/app-tabs.web.tsx');
    expect(bar).toMatch(/<TabTrigger name="streak" href="\/streak" asChild>/);
    expect(bar).not.toMatch(/streakOn|useEngagementGate/);
    expect(bar).toContain("{t('engage.streak.tab')}");
    expect(bar).not.toMatch(/name="progress"|>Progress</);
  });

  it('nothing but the Home line (behind the gate) and the web trigger names /streak, and the Home line is gated', () => {
    const pushers = FILES.filter((file) => /['"]\/streak['"]/.test(file.code) && !/\.json$/.test(file.path)).map((file) => file.path);
    expect(pushers.sort()).toEqual(['app/(tabs)/index.tsx', 'components/app-tabs.web.tsx']);
    expect(code('app/(tabs)/index.tsx')).toMatch(/const streakLine = engagementGate === 'on'/);
  });
});

describe('the Progress screens are stack routes, not tabs (Story 31.4)', () => {
  it('live at root app/progress with the same URLs, and are declared in the signed-in stack group', () => {
    for (const path of ['app/progress/index.tsx', 'app/progress/entries.tsx', 'app/progress/photo/[id].tsx']) expect(code(path), path).not.toBe('');
    for (const path of ['app/(tabs)/progress/index.tsx', 'app/(tabs)/progress/entries.tsx', 'app/(tabs)/progress/photo/[id].tsx']) expect(code(path), path).toBe('');
    const layout = code('app/_layout.tsx');
    const group = layout.slice(layout.indexOf('<Stack.Protected guard={isFullyOnboarded}>'), layout.indexOf('</Stack.Protected>'));
    for (const name of ['progress/index', 'progress/entries', 'progress/photo/[id]']) expect(group).toContain(`<Stack.Screen name="${name}" />`);
  });

  it('the Progress screen has a Back header like the other pushed screens, and its inner pushes keep their URLs', () => {
    const screen = code('app/progress/index.tsx');
    expect(screen).toContain("onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}");
    expect(screen).not.toContain('BottomTabInset');
    expect(code('app/progress/entries.tsx')).not.toContain('BottomTabInset');
    expect(screen).toContain("router.push('/progress/entries')");
    expect(code('app/progress/entries.tsx')).toContain('router.back()');
    expect(code('app/progress/photo/[id].tsx')).toContain('router.back()');
  });

  it('the Progress services and screens read nothing from the engagement area', () => {
    for (const path of ['app/progress/index.tsx', 'app/progress/entries.tsx', 'app/progress/photo/[id].tsx', 'services/progress.ts']) {
      expect(code(path), path).not.toMatch(/engagementGate|useEngagementGate|readEngagementCache|streak/i);
    }
  });
});
