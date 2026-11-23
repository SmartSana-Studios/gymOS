import { createInstance } from 'i18next';
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
import type { Engagement } from '@/services/engagement';
import type { AcknowledgeMilestoneResult } from '@/services/milestones';

import {
  ackSettled,
  buildCelebrationView,
  buildMiniMonth,
  celebrationDue,
  celebrationKeys,
  celebrationMonth,
  celebrationStoreKey,
  chooseMilestone,
  clearShown,
  celebrationVisible,
  closeRecord,
  finishCelebration,
  homeCelebrationPlan,
  homeReadyForCelebration,
  isMilestone,
  markShownAcked,
  reduceMotionFrom,
  motionPlan,
  numeralAt,
  parseMilestoneParam,
  pendingFromOutcome,
  readShown,
  retryAcknowledge,
  retryTarget,
  shouldOpenHome,
  showMiniCalendar,
  writeShown,
  type CloseDeps,
  type ShownRead,
} from './celebrationView';
import type { TFn } from './weeklyGoalSheet';
import type { EngagementLoadOutcome } from './weeklyRing';

function makeT(lng: 'en' | 'fr' = 'en', resources: { en: object; fr: object } = { en, fr }): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: resources.en }, fr: { translation: resources.fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

const ROW = { enabled: true, gymToday: '2026-11-25', pendingMilestone: 30 } as Engagement;
const NONE: ShownRead = { kind: 'none' };
const entry = (milestone: number, acked = false): ShownRead => ({ kind: 'entry', entry: { milestone, acked } });

beforeEach(() => {
  store.clear();
  for (const fn of Object.values(storage)) fn.mockClear();
});

describe('which milestone to celebrate', () => {
  it('the route number is exactly 7, 30 or 100', () => {
    expect(parseMilestoneParam('7')).toBe(7);
    expect(parseMilestoneParam('30')).toBe(30);
    expect(parseMilestoneParam('100')).toBe(100);
    for (const bad of ['8', '07', '30 ', '', 'abc', undefined, null, 30, ['30']]) expect(parseMilestoneParam(bad)).toBeNull();
    expect(isMilestone(30)).toBe(true);
    expect(isMilestone(31)).toBe(false);
  });

  it('only a LIVE row celebrates: never the device copy, a dark read, a failed read or no read', () => {
    const live: EngagementLoadOutcome = { kind: 'row', engagement: ROW, settleFailed: false };
    expect(pendingFromOutcome(live)).toBe(30);
    expect(pendingFromOutcome({ kind: 'row', engagement: ROW, settleFailed: true })).toBe(30);
    expect(pendingFromOutcome({ kind: 'dark', engagement: ROW })).toBeNull();
    expect(pendingFromOutcome({ kind: 'dark', engagement: null })).toBeNull();
    expect(pendingFromOutcome({ kind: 'failed' })).toBeNull();
    expect(pendingFromOutcome(null)).toBeNull();
    expect(pendingFromOutcome({ kind: 'row', engagement: { ...ROW, pendingMilestone: null }, settleFailed: false })).toBeNull();
    expect(pendingFromOutcome({ kind: 'row', engagement: { ...ROW, pendingMilestone: 12 }, settleFailed: false })).toBeNull();
  });

  it('a pending number not yet shown on this device is chosen', () => {
    expect(chooseMilestone(7, NONE)).toBe(7);
    expect(chooseMilestone(100, entry(30))).toBe(100);
  });

  it('a number the device has shown (or a higher one) is not shown again, acknowledged or not', () => {
    expect(chooseMilestone(30, entry(30, false))).toBeNull();
    expect(chooseMilestone(30, entry(30, true))).toBeNull();
    expect(chooseMilestone(7, entry(30, true))).toBeNull();
  });

  it('an unreadable store celebrates nothing (fail closed); a number that is not a milestone is never chosen', () => {
    expect(chooseMilestone(30, { kind: 'unreadable' })).toBeNull();
    expect(chooseMilestone(null, NONE)).toBeNull();
    expect(chooseMilestone(12, NONE)).toBeNull();
  });

  it('the route opens Home for an unknown number, a shown number, or an unreadable store', () => {
    expect(shouldOpenHome(null, NONE)).toBe(true);
    expect(shouldOpenHome(30, entry(30))).toBe(true);
    expect(shouldOpenHome(30, { kind: 'unreadable' })).toBe(true);
    expect(shouldOpenHome(30, NONE)).toBe(false);
    expect(shouldOpenHome(100, entry(30, true))).toBe(false);
  });

  it('only a shown milestone whose acknowledgement has not landed is retried', () => {
    expect(retryTarget(entry(30, false))).toBe(30);
    expect(retryTarget(entry(30, true))).toBeNull();
    expect(retryTarget(NONE)).toBeNull();
    expect(retryTarget({ kind: 'unreadable' })).toBeNull();
  });
});

describe('the shown-store', () => {
  it('is keyed by user and gym', () => {
    expect(celebrationStoreKey('u1', 'g1')).toBe('gymos.celebration.v1.u1.g1');
    expect(celebrationStoreKey('u1', 'g1')).not.toBe(celebrationStoreKey('u1', 'g2'));
    expect(celebrationStoreKey('u1', 'g1')).not.toBe(celebrationStoreKey('u2', 'g1'));
  });

  it('round-trips an entry and reads none for another member', async () => {
    expect(await writeShown('u1', 'g1', { milestone: 30, acked: false })).toBe(true);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, false));
    expect(await readShown('u2', 'g1')).toEqual(NONE);
    expect(await readShown('u1', 'g2')).toEqual(NONE);
  });

  it('a storage failure on read is unreadable; a corrupt or foreign value is none', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await readShown('u1', 'g1')).toEqual({ kind: 'unreadable' });
    store.set(celebrationStoreKey('u1', 'g1'), '{not json');
    expect(await readShown('u1', 'g1')).toEqual(NONE);
    store.set(celebrationStoreKey('u1', 'g1'), JSON.stringify({ milestone: 8, acked: true }));
    expect(await readShown('u1', 'g1')).toEqual(NONE);
  });

  it('a failed write returns false', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('disk'));
    expect(await writeShown('u1', 'g1', { milestone: 7, acked: false })).toBe(false);
  });

  it('marks acknowledged only the milestone still on the device', async () => {
    await writeShown('u1', 'g1', { milestone: 30, acked: false });
    expect(await markShownAcked('u1', 'g1', 7)).toBe(false);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, false));
    expect(await markShownAcked('u1', 'g1', 30)).toBe(true);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, true));
    expect(await markShownAcked('u9', 'g1', 30)).toBe(false);
  });

  it('is cleared at sign-out for every member, and only this store', async () => {
    await writeShown('u1', 'g1', { milestone: 30, acked: true });
    await writeShown('u2', 'g2', { milestone: 7, acked: false });
    store.set('gymos.engageHome.v1.u1.g1', 'keep');
    await clearShown();
    expect([...store.keys()]).toEqual(['gymos.engageHome.v1.u1.g1']);
  });

  it('clearing never throws', async () => {
    storage.getAllKeys.mockRejectedValueOnce(new Error('disk'));
    await expect(clearShown()).resolves.toBeUndefined();
  });
});

describe('closing: the record first, then the server', () => {
  function deps(result: AcknowledgeMilestoneResult | Error) {
    const calls: string[] = [];
    const d: CloseDeps = {
      writeShown: vi.fn(async (u, g, e) => {
        calls.push(`write:${e.milestone}:${e.acked}`);
        return writeShown(u, g, e);
      }),
      markShownAcked: vi.fn(async (u, g, m) => {
        calls.push(`mark:${m}`);
        return markShownAcked(u, g, m);
      }),
      acknowledge: vi.fn(async (m) => {
        calls.push(`ack:${m}`);
        if (result instanceof Error) throw result;
        return result;
      }),
    };
    return { d, calls };
  }

  it('writes the shown record BEFORE the acknowledge call, then clears the flag on success', async () => {
    const { d, calls } = deps({ status: 'success' });
    await finishCelebration(d, 'u1', 'g1', 30);
    expect(calls).toEqual(['write:30:false', 'ack:30', 'mark:30']);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, true));
  });

  it('a failed call (offline) leaves acked false, so a later load retries and the celebration is not shown twice', async () => {
    const { d } = deps({ status: 'error', retryable: true });
    await finishCelebration(d, 'u1', 'g1', 30);
    const shown = await readShown('u1', 'g1');
    expect(shown).toEqual(entry(30, false));
    expect(chooseMilestone(30, shown)).toBeNull();
    expect(retryTarget(shown)).toBe(30);
  });

  it('a suspended gym is retried later; a refusal no retry can change is settled', async () => {
    await finishCelebration(deps({ status: 'gym_suspended' }).d, 'u1', 'g1', 7);
    expect(await readShown('u1', 'g1')).toEqual(entry(7, false));
    await finishCelebration(deps({ status: 'error', retryable: false }).d, 'u1', 'g2', 7);
    expect(await readShown('u1', 'g2')).toEqual(entry(7, true));
    expect(ackSettled({ status: 'gym_suspended' })).toBe(false);
  });

  it('never throws', async () => {
    await expect(finishCelebration(deps(new Error('boom')).d, 'u1', 'g1', 30)).resolves.toBeUndefined();
    expect(await readShown('u1', 'g1')).toEqual(entry(30, false));
  });

  it('a retry on the next Home load clears the flag on success and does nothing when there is nothing to retry', async () => {
    await writeShown('u1', 'g1', { milestone: 30, acked: false });
    const { d, calls } = deps({ status: 'success' });
    expect(await retryAcknowledge(d, 'u1', 'g1', await readShown('u1', 'g1'))).toBe(true);
    expect(calls).toEqual(['ack:30', 'mark:30']);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, true));
    calls.length = 0;
    expect(await retryAcknowledge(d, 'u1', 'g1', await readShown('u1', 'g1'))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a retry that fails keeps the flag', async () => {
    await writeShown('u1', 'g1', { milestone: 30, acked: false });
    expect(await retryAcknowledge(deps({ status: 'error', retryable: true }).d, 'u1', 'g1', await readShown('u1', 'g1'))).toBe(false);
    expect(await readShown('u1', 'g1')).toEqual(entry(30, false));
    expect(await retryAcknowledge(deps(new Error('boom')).d, 'u1', 'g1', await readShown('u1', 'g1'))).toBe(false);
  });
});

describe('the motion plan', () => {
  it('full motion: the count-up over 700 ms, the card scale 96% to 100% and a fade over 400 ms, and the haptic', () => {
    expect(motionPlan(false)).toEqual({ haptic: true, countUp: true, countUpMs: 700, scaleFrom: 0.96, fadeMs: 400 });
  });
  it('reduced motion: no count-up and no scale, a 150 ms cross-fade, and the haptic still fires', () => {
    expect(motionPlan(true)).toEqual({ haptic: true, countUp: false, countUpMs: 0, scaleFrom: 1, fadeMs: 150 });
  });
  it('counts from 0 to the milestone', () => {
    expect(numeralAt(0, 30)).toBe(0);
    expect(numeralAt(0.5, 30)).toBe(15);
    expect(numeralAt(1, 100)).toBe(100);
    expect(numeralAt(2, 7)).toBe(7);
    expect(numeralAt(-1, 7)).toBe(0);
    expect(numeralAt(Number.NaN, 7)).toBe(0);
  });
});

describe('the words', () => {
  const LANGS = ['en', 'fr'] as const;

  it.each(LANGS)('the card for each milestone in %s: numeral, unit, headline, sentence, one announcement', (lang) => {
    const t = makeT(lang);
    for (const n of [7, 30, 100]) {
      const view = buildCelebrationView({ milestone: n, gymName: 'Iron Gym', t });
      expect(view.numeral).toBe(String(n));
      expect(view.unit).toBe(lang === 'en' ? 'visits' : 'visites');
      expect(view.headline).toBe(lang === 'en' ? `${n} visits` : `${n} visites`);
      expect(view.sub).toContain('Iron Gym');
      expect(view.continueLabel).toBe(lang === 'en' ? 'Keep going' : 'Continuer');
      expect(view.a11y).toBe(lang === 'en' ? `Milestone: ${n} visits at Iron Gym.` : `Étape franchie : ${n} visites chez Iron Gym.`);
      expect(view.headline + view.sub + view.a11y).not.toMatch(/!/);
    }
  });

  it('an unreadable gym name is an empty line, never the word null', () => {
    const view = buildCelebrationView({ milestone: 7, gymName: null, t: makeT('en') });
    expect(view.gymName).toBe('');
    expect(view.sub).not.toMatch(/null|undefined/);
  });

  it('the mascot slot is empty while its keys are empty, and shows the key text when one is set (no other change)', () => {
    expect(buildCelebrationView({ milestone: 30, gymName: 'G', t: makeT('en') }).mascot).toBe('');
    const set = JSON.parse(JSON.stringify(en)) as { engage: { celebration: { mascot: Record<string, string> } } };
    set.engage.celebration.mascot['30'] = 'SENTINEL-mascot';
    const withMascot = buildCelebrationView({ milestone: 30, gymName: 'G', t: makeT('en', { en: set, fr }) });
    expect(withMascot.mascot).toBe('SENTINEL-mascot');
    expect({ ...withMascot, mascot: '' }).toEqual(buildCelebrationView({ milestone: 30, gymName: 'G', t: makeT('en') }));
  });

  it('every word comes from the catalog (sentinel)', () => {
    const KEYS: [string[], (v: ReturnType<typeof buildCelebrationView>) => string][] = [
      [['engage', 'celebration', 'unit'], (v) => v.unit],
      [['engage', 'celebration', '30', 'headline'], (v) => v.headline],
      [['engage', 'celebration', '30', 'sub'], (v) => v.sub],
      [['engage', 'celebration', 'cta', 'continue'], (v) => v.continueLabel],
      [['engage', 'celebration', 'a11y'], (v) => v.a11y],
      [['engage', 'celebration', 'mascot', '30'], (v) => v.mascot],
    ];
    for (const [path, pick] of KEYS) {
      const clone = JSON.parse(JSON.stringify(en)) as Record<string, unknown>;
      let node = clone;
      for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
      node[path[path.length - 1]] = `SENTINEL-${path.join('.')}`;
      expect(pick(buildCelebrationView({ milestone: 30, gymName: 'G', t: makeT('en', { en: clone, fr }) }))).toContain(`SENTINEL-${path.join('.')}`);
    }
  });

  it('the label keys of a milestone', () => {
    expect(celebrationKeys(100)).toEqual({
      headline: 'engage.celebration.100.headline',
      sub: 'engage.celebration.100.sub',
      mascot: 'engage.celebration.mascot.100',
      unit: 'engage.celebration.unit',
      continueLabel: 'engage.celebration.cta.continue',
      a11y: 'engage.celebration.a11y',
    });
  });

  it('there is no Share or badges wording in the view (Epic 31)', () => {
    const view = buildCelebrationView({ milestone: 30, gymName: 'G', t: makeT('en') });
    expect(Object.keys(view).join(' ')).not.toMatch(/share|badge/i);
    expect(JSON.stringify(celebrationKeys(30))).not.toMatch(/cta\.share|cta\.badges/);
  });
});

describe('the mini month', () => {
  it('shows at 640pt and above, never at the +2 text size', () => {
    expect(showMiniCalendar(640, 1)).toBe(true);
    expect(showMiniCalendar(639, 1)).toBe(false);
    expect(showMiniCalendar(900, 1.29)).toBe(true);
    expect(showMiniCalendar(900, 1.3)).toBe(false);
    expect(showMiniCalendar(900, 2)).toBe(false);
  });

  it('the month comes from the gym-local day the server returned', () => {
    expect(celebrationMonth('2026-11-25')).toBe('2026-11-01');
    expect(celebrationMonth('nonsense')).toBeNull();
    expect(celebrationMonth(undefined)).toBeNull();
  });

  it('lights the visit days only, with blank cells outside the month and no numerals', () => {
    const rows = buildMiniMonth('2026-11-01', ['2026-11-03', '2026-11-10']);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.length === 7)).toBe(true);
    const cells = rows.flat();
    expect(cells.filter((c) => c.lit).map((c) => c.date)).toEqual(['2026-11-03', '2026-11-10']);
    expect(cells.filter((c) => c.date !== null)).toHaveLength(30);
    expect(rows[0][0]).toEqual({ date: null, lit: false });
    expect(rows[0][6]).toEqual({ date: '2026-11-01', lit: false });
    expect(Object.keys(cells[0]).sort()).toEqual(['date', 'lit']);
    expect(buildMiniMonth('2026-11-01', ['2026-10-31']).flat().some((c) => c.lit)).toBe(false);
  });
});

describe('when the push is due', () => {
  const READY = { loading: false, loadError: false, subscriptionStatus: 'active' };

  it('Home is ready only when painted, without a load error and not on an expired plan', () => {
    expect(homeReadyForCelebration(READY)).toBe(true);
    expect(homeReadyForCelebration({ ...READY, subscriptionStatus: null })).toBe(true);
    expect(homeReadyForCelebration({ ...READY, subscriptionStatus: 'grace_period' })).toBe(true);
    expect(homeReadyForCelebration({ ...READY, subscriptionStatus: 'expired' })).toBe(false);
    expect(homeReadyForCelebration({ ...READY, loadError: true })).toBe(false);
    expect(homeReadyForCelebration({ ...READY, loading: true })).toBe(false);
  });

  it('is due only with a milestone, its day, a ready Home and a focused Home', () => {
    const due = { milestone: 30, today: '2026-11-25', ready: true, focused: true };
    expect(celebrationDue(due)).toBe(true);
    expect(celebrationDue({ ...due, milestone: null })).toBe(false);
    expect(celebrationDue({ ...due, today: null })).toBe(false);
    expect(celebrationDue({ ...due, ready: false })).toBe(false);
    expect(celebrationDue({ ...due, focused: false })).toBe(false);
  });

  it('the full matrix: expired, load error, still loading, blurred, nothing pending, due', () => {
    const rows: [string, { loading: boolean; loadError: boolean; subscriptionStatus: string | null }, boolean, number | null, boolean][] = [
      ['expired plan', { ...READY, subscriptionStatus: 'expired' }, true, 30, false],
      ['load error', { ...READY, loadError: true }, true, 30, false],
      ['still loading', { ...READY, loading: true }, true, 30, false],
      ['blurred', READY, false, 30, false],
      ['no milestone', READY, true, null, false],
      ['due', READY, true, 30, true],
    ];
    for (const [name, home, focused, milestone, expected] of rows) {
      expect(celebrationDue({ milestone, today: '2026-11-25', ready: homeReadyForCelebration(home), focused }), name).toBe(expected);
    }
  });
});

describe('what the Home hook decides (homeCelebrationPlan)', () => {
  const live: EngagementLoadOutcome = { kind: 'row', engagement: ROW, settleFailed: false };

  it('celebrates a live pending number the device has not shown, with the gym-local day', () => {
    expect(homeCelebrationPlan({ outcome: live, shown: NONE, connected: true })).toEqual({ candidate: { milestone: 30, today: '2026-11-25' }, retry: false });
    expect(homeCelebrationPlan({ outcome: live, shown: entry(7, true), connected: true }).candidate).toEqual({ milestone: 30, today: '2026-11-25' });
  });

  it('never celebrates a number the device has shown, whether or not the server has it acknowledged', () => {
    expect(homeCelebrationPlan({ outcome: live, shown: entry(30, true), connected: true }).candidate).toBeNull();
    expect(homeCelebrationPlan({ outcome: live, shown: entry(30, false), connected: true }).candidate).toBeNull();
    expect(homeCelebrationPlan({ outcome: live, shown: entry(100, false), connected: true }).candidate).toBeNull();
  });

  it('never celebrates from a dark, failed or missing read, or an unreadable store', () => {
    expect(homeCelebrationPlan({ outcome: { kind: 'dark', engagement: ROW }, shown: NONE, connected: true }).candidate).toBeNull();
    expect(homeCelebrationPlan({ outcome: { kind: 'failed' }, shown: NONE, connected: true }).candidate).toBeNull();
    expect(homeCelebrationPlan({ outcome: null, shown: NONE, connected: true }).candidate).toBeNull();
    expect(homeCelebrationPlan({ outcome: live, shown: { kind: 'unreadable' }, connected: true }).candidate).toBeNull();
  });

  it('retries a shown milestone whose acknowledgement has not landed, only while connected', () => {
    expect(homeCelebrationPlan({ outcome: live, shown: entry(30, false), connected: true }).retry).toBe(true);
    expect(homeCelebrationPlan({ outcome: live, shown: entry(30, false), connected: false }).retry).toBe(false);
    expect(homeCelebrationPlan({ outcome: live, shown: entry(30, true), connected: true }).retry).toBe(false);
    expect(homeCelebrationPlan({ outcome: live, shown: NONE, connected: true }).retry).toBe(false);
    expect(homeCelebrationPlan({ outcome: { kind: 'failed' }, shown: entry(7, false), connected: true }).retry).toBe(true);
  });
});

describe('what the route decides (reduceMotionFrom, celebrationVisible, closeRecord)', () => {
  it('either the screen\'s own reduce-motion read or the hook\'s live value reduces the motion', () => {
    expect(reduceMotionFrom(null, false)).toBe(false);
    expect(reduceMotionFrom(null, true)).toBe(true);
    expect(reduceMotionFrom(false, false)).toBe(false);
    expect(reduceMotionFrom(true, false)).toBe(true);
    expect(reduceMotionFrom(false, true)).toBe(true);
  });

  it('the card is visible only with the store read, the motion read, no Home redirect and a view', () => {
    const on = { dataReady: true, motionKnown: true, openHome: false, hasView: true };
    expect(celebrationVisible(on)).toBe(true);
    expect(celebrationVisible({ ...on, dataReady: false })).toBe(false);
    expect(celebrationVisible({ ...on, motionKnown: false })).toBe(false);
    expect(celebrationVisible({ ...on, openHome: true })).toBe(false);
    expect(celebrationVisible({ ...on, hasView: false })).toBe(false);
  });

  it('back before the card is on screen records and acknowledges nothing', () => {
    const on = { visible: true, milestone: 30, userId: 'u1', gymId: 'g1' };
    expect(closeRecord(on)).toEqual({ userId: 'u1', gymId: 'g1', milestone: 30 });
    expect(closeRecord({ ...on, visible: false })).toBeNull();
    expect(closeRecord({ ...on, milestone: null })).toBeNull();
    expect(closeRecord({ ...on, userId: null })).toBeNull();
    expect(closeRecord({ ...on, gymId: null })).toBeNull();
  });
});
