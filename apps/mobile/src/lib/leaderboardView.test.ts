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
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import en from '@/locales/en.json';
import fr from '@/locales/fr.json';
import type { Engagement } from '@/services/engagement';
import type { LeaderboardRow, LeaderboardSettings } from '@/services/leaderboard';

import {
  buildAnonymousRowView,
  buildHomeCardView,
  buildLeaderboardView,
  buildNoticeView,
  decideToggle,
  gateFromOutcome,
  gateFromResult,
  boardSource,
  mayCallLeaderboard,
  mayKeepSettingsCopy,
  monthOfEngagement,
  planHomeLoad,
  profileSettingsPlan,
  settingsAfterNotice,
  settingsAfterToggle,
  settingsFromDeviceCopy,
  standingCopyFor,
  leaderboardCacheKey,
  MIN_RANKED,
  monthsFromToday,
  readHomeStanding,
  readLeaderboardCache,
  runNoticeChoice,
  standingFromRows,
  standingLine,
  writeHomeStanding,
  writeLeaderboardBoard,
  writeLeaderboardSettings,
  type BoardData,
  type LeaderboardInput,
} from './leaderboardView';
import type { TFn } from './weeklyGoalSheet';

function makeT(lng: 'en' | 'fr' = 'en', resources: { en: object; fr: object } = { en, fr }): TFn {
  const i18n = createInstance();
  void i18n.init({ lng, fallbackLng: 'en', resources: { en: { translation: resources.en }, fr: { translation: resources.fr } }, interpolation: { escapeValue: false }, initAsync: false });
  return (key, options) => i18n.t(key, options) as string;
}

const LANGS = ['en', 'fr'] as const;

function row(position: number, over: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    position,
    rank: position,
    label: `PERSON ${position}.`,
    isAnonymous: false,
    visits: 20 - position,
    isSelf: false,
    isTied: false,
    visitsBehind: null,
    rankedTotal: 43,
    selfRanked: true,
    ...over,
  };
}

const NONE = (rankedTotal: number, selfRanked: boolean): LeaderboardRow => ({
  position: null, rank: null, label: null, isAnonymous: false, visits: null, isSelf: false, isTied: false, visitsBehind: null, rankedTotal, selfRanked,
});

const SETTINGS: LeaderboardSettings = { hidden: false, noticeSeen: true, ownLabel: 'MIREILLE K.' };

function input(over: Partial<LeaderboardInput> = {}): LeaderboardInput {
  return {
    tab: 'current',
    gymName: 'IRON TEMPLE',
    settings: SETTINGS,
    settingsLoaded: true,
    board: { kind: 'ready', rows: [row(1), row(2), row(3)], fromCache: false, updatedAtMs: null },
    connected: true,
    visibilityPending: false,
    noticeBusy: null,
    noticeFailed: false,
    t: makeT('en'),
    language: 'en',
    ...over,
  };
}

const ready = (rows: LeaderboardRow[], fromCache = false, updatedAtMs: number | null = null): BoardData => ({ kind: 'ready', rows, fromCache, updatedAtMs });

beforeEach(() => store.clear());

describe('months come from the server\'s gym-local today', () => {
  it('the current month and the one before it, across a year edge', () => {
    expect(monthsFromToday('2026-11-25')).toEqual({ current: '2026-11-01', previous: '2026-10-01' });
    expect(monthsFromToday('2026-01-01')).toEqual({ current: '2026-01-01', previous: '2025-12-01' });
  });
});

describe.each(LANGS)('the board (%s)', (lang) => {
  const t = makeT(lang);
  const d = (over: Partial<LeaderboardInput> = {}) => input({ t, language: lang, ...over });

  it('a member in the top 10: server rows in the server\'s order, own row labelled You with the behind line', () => {
    const rows = [row(1), row(2, { isSelf: true, visitsBehind: 2, visits: 9 }), row(3, { isTied: true }), row(4, { isTied: true })];
    const view = buildLeaderboardView(d({ board: ready(rows) }));
    expect(view.face).toBe('list');
    expect(view.items.map((i) => i.kind)).toEqual(['row', 'row', 'row', 'row']);
    const own = view.items[1];
    expect(own.kind === 'row' && own.isSelf).toBe(true);
    if (own.kind === 'row') {
      expect(own.label).toBe(t('engage.leaderboard.row.you'));
      expect(own.selfTag).toBe(t('engage.leaderboard.row.you'));
      expect(own.below).toBe(t('engage.leaderboard.behind', { count: 2 }));
      expect(own.visitsText).toBe(t('engage.leaderboard.row.visits', { count: 9 }));
      expect(own.rankText).toBe('2');
    }
    const tied = view.items[2];
    if (tied.kind === 'row') expect(tied.tied).toBe(t('engage.leaderboard.row.tied'));
    const named = view.items[0];
    if (named.kind === 'row') {
      expect(named.label).toBe('PERSON 1.');
      expect(named.icon).toBe('person');
      expect(named.selfTag).toBeNull();
      expect(named.below).toBeNull();
    }
    expect(view.unrankedLine).toBeNull();
  });

  it('a member outside the top 10 gets a separator where the server positions are not consecutive', () => {
    const rows = [row(9), row(10), row(16), row(17, { isSelf: true, visitsBehind: 0 }), row(18)];
    const view = buildLeaderboardView(d({ board: ready(rows) }));
    expect(view.items.map((i) => i.kind)).toEqual(['row', 'row', 'gap', 'row', 'row', 'row']);
    const gap = view.items[2];
    expect(gap.kind === 'gap' && gap.accessibilityLabel).toBe(t('engage.leaderboard.row.gap'));
    const own = view.items[4];
    if (own.kind === 'row') expect(own.below).toBe(t('engage.leaderboard.level'));
  });

  it('first place reads leading; level and behind come from the server\'s number only', () => {
    expect(standingLine(null, t)).toBe(t('engage.leaderboard.leading'));
    expect(standingLine(0, t)).toBe(t('engage.leaderboard.level'));
    expect(standingLine(1, t)).toBe(t('engage.leaderboard.behind', { count: 1 }));
    expect(standingLine(7, t)).toBe(t('engage.leaderboard.behind', { count: 7 }));
  });

  it('an anonymous row shows the localised word and the hidden icon, never a name', () => {
    const view = buildLeaderboardView(d({ board: ready([row(1, { label: 'Anonymous', isAnonymous: true }), row(2), row(3)]) }));
    const first = view.items[0];
    if (first.kind === 'row') {
      expect(first.label).toBe(t('engage.leaderboard.row.anonymous'));
      expect(first.icon).toBe('visibility-off');
    }
  });

  it('a hidden member sees their own row as You, with the hidden line, and rank and count unchanged', () => {
    const view = buildLeaderboardView(d({ settings: { ...SETTINGS, hidden: true }, board: ready([row(1), row(2, { isSelf: true, isAnonymous: true, label: 'Anonymous', visitsBehind: 1, visits: 7 }), row(3)]) }));
    const own = view.items[1];
    if (own.kind === 'row') {
      expect(own.label).toBe(t('engage.leaderboard.row.you'));
      expect(own.hiddenSelf).toBe(t('engage.leaderboard.hidden.self'));
      expect(own.icon).toBe('visibility-off');
      expect(own.rankText).toBe('2');
      expect(own.visitsText).toBe(t('engage.leaderboard.row.visits', { count: 7 }));
    }
    expect(view.visibility?.checked).toBe(true);
    expect(view.visibility?.helper).toBe(t('engage.leaderboard.hidden.self'));
  });

  it('the previous month has no behind line', () => {
    const view = buildLeaderboardView(d({ tab: 'previous', board: ready([row(1), row(2, { isSelf: true, visitsBehind: 2 }), row(3)]) }));
    const own = view.items[1];
    if (own.kind === 'row') expect(own.below).toBeNull();
  });

  it('an unranked member (3 or more ranked) gets the unranked line in place of an own row', () => {
    const view = buildLeaderboardView(d({ board: ready([row(1, { selfRanked: false }), row(2, { selfRanked: false }), row(3, { selfRanked: false })]) }));
    expect(view.face).toBe('list');
    expect(view.unrankedLine).toBe(t('engage.leaderboard.unranked'));
    expect(view.items.some((i) => i.kind === 'row' && i.isSelf)).toBe(false);
  });

  it.each([
    [0, false, 'engage.leaderboard.empty.month', { gym: 'IRON TEMPLE' }],
    [1, true, 'engage.leaderboard.onlyYou', undefined],
    [1, false, 'engage.leaderboard.unranked', undefined],
    [2, false, 'engage.leaderboard.unranked', undefined],
  ] as const)('fewer than 3 ranked (%i ranked, own ranked %s): no list, the block and the supporting line', (total, self, key, args) => {
    const view = buildLeaderboardView(d({ board: ready([NONE(total, self)]) }));
    expect(view.face).toBe('notEnough');
    expect(view.items).toEqual([]);
    expect(view.notEnough?.title).toBe(t('engage.leaderboard.notEnough.title'));
    expect(view.notEnough?.body).toBe(t('engage.leaderboard.notEnough.body', { min: MIN_RANKED }));
    expect(view.notEnough?.support).toBe(t(key, args));
    expect(view.visibility).not.toBeNull();
  });

  it('two ranked with the member one of them: no supporting line', () => {
    const view = buildLeaderboardView(d({ board: ready([NONE(2, true)]) }));
    expect(view.notEnough?.support).toBeNull();
  });

  it('the state comes from the server\'s ranked_total, not from the number of rows', () => {
    // Three rows but ranked_total 2 (a malformed answer): the not-enough face still wins, and no row is drawn.
    const view = buildLeaderboardView(d({ board: ready([row(1, { rankedTotal: 2 }), row(2, { rankedTotal: 2 }), row(3, { rankedTotal: 2 })]) }));
    expect(view.face).toBe('notEnough');
    expect(view.items).toEqual([]);
  });

  it('the notice face: no list, no footnote, no visibility row, only the notice', () => {
    const view = buildLeaderboardView(d({ settings: { ...SETTINGS, noticeSeen: false }, board: ready([row(1), row(2), row(3)]) }));
    expect(view.face).toBe('notice');
    expect(view.items).toEqual([]);
    expect(view.notice?.body).toBe(t('engage.leaderboard.notice.body', { gym: 'IRON TEMPLE', label: 'MIREILLE K.' }));
    expect(view.footnote).toBeNull();
    expect(view.visibility).toBeNull();
    expect(view.banner).toBeNull();
  });

  it('a cached board is never drawn while the notice is unseen', () => {
    const view = buildLeaderboardView(d({ settings: { ...SETTINGS, noticeSeen: false }, board: ready([row(1), row(2), row(3)], true, 1) }));
    expect(view.face).toBe('notice');
    expect(view.items).toEqual([]);
    expect(view.banner).toBeNull();
  });

  it('loading shows the skeleton face and no visibility row, before and after the settings are known', () => {
    expect(buildLeaderboardView(d({ settings: null, settingsLoaded: false, board: { kind: 'loading' } })).face).toBe('loading');
    const view = buildLeaderboardView(d({ board: { kind: 'loading' } }));
    expect(view.face).toBe('loading');
    expect(view.visibility).toBeNull();
    expect(view.footnote).toBeNull();
  });

  it('an error in the list slot keeps the visibility row', () => {
    const view = buildLeaderboardView(d({ board: { kind: 'error' } }));
    expect(view.face).toBe('error');
    expect(view.errorText).toBe(t('engage.leaderboard.error.full'));
    expect(view.visibility).not.toBeNull();
  });

  it('unknown settings (the read failed, no device copy) is the error face with no visibility row', () => {
    const view = buildLeaderboardView(d({ settings: null, settingsLoaded: true }));
    expect(view.face).toBe('error');
    expect(view.visibility).toBeNull();
  });

  it('offline with a cached board: the banner, the updated time and the applies-later line, the toggle disabled', () => {
    const view = buildLeaderboardView(d({ connected: false, board: ready([row(1), row(2), row(3)], true, Date.UTC(2026, 10, 25, 14, 30)) }));
    expect(view.face).toBe('list');
    expect(view.banner?.text).toBe(t('engage.leaderboard.offline.banner'));
    expect(view.banner?.updated).toMatch(/\d/);
    expect(view.banner?.applies).toBe(t('engage.leaderboard.offline.applies'));
    expect(view.visibility?.disabled).toBe(true);
  });

  it('online with live rows: no banner, the toggle on', () => {
    const view = buildLeaderboardView(d());
    expect(view.banner).toBeNull();
    expect(view.visibility?.disabled).toBe(false);
    expect(view.visibility?.helper).toBe(t('engage.leaderboard.visible.self', { label: 'MIREILLE K.' }));
    expect(view.footnote).toBe(t('engage.leaderboard.footnote'));
  });

  it('the toggle is disabled while a save is pending, and its label states its state', () => {
    const pending = buildLeaderboardView(d({ visibilityPending: true }));
    expect(pending.visibility?.disabled).toBe(true);
    const on = buildLeaderboardView(d({ settings: { ...SETTINGS, hidden: true } }));
    expect(on.visibility?.accessibilityLabel).toBe(t('engage.profile.anonymous.a11yOn'));
    expect(buildLeaderboardView(d()).visibility?.accessibilityLabel).toBe(t('engage.profile.anonymous.a11yOff'));
  });

  it('the tabs and the header', () => {
    const view = buildLeaderboardView(d());
    expect(view.tabs.map((x) => x.value)).toEqual(['current', 'previous']);
    expect(view.tabs[0].label).toBe(t('engage.leaderboard.tab.thisMonth'));
    expect(view.tabs[1].label).toBe(t('engage.leaderboard.tab.lastMonth'));
    expect(view.title).toBe(t('engage.leaderboard.title'));
    expect(view.subtitle).toBe('IRON TEMPLE');
  });

  it('a row\'s accessibility label reads rank, tie, label, visits and the lines under it', () => {
    const view = buildLeaderboardView(d({ board: ready([row(1), row(2, { isSelf: true, isTied: true, visitsBehind: 0, visits: 5 }), row(3)]) }));
    const own = view.items[1];
    if (own.kind === 'row') {
      expect(own.accessibilityLabel).toBe(
        ['2', t('engage.leaderboard.row.tied'), t('engage.leaderboard.row.you'), t('engage.leaderboard.row.visits', { count: 5 }), t('engage.leaderboard.level')].join('. '),
      );
    }
  });
});

describe('the wording is data: a sentinel in the catalog reaches the view', () => {
  it('swaps a value and finds it in the notice, a row, and the Home card', () => {
    const swapped = JSON.parse(JSON.stringify(en)) as typeof en;
    (swapped.engage.leaderboard.notice as { title: string }).title = 'SENTINEL-NOTICE';
    (swapped.engage.leaderboard.row as { gap: string }).gap = 'SENTINEL-GAP';
    (swapped.engage.home as { rank: string }).rank = 'SENTINEL {{n}}/{{total}}';
    const t = makeT('en', { en: swapped, fr });
    expect(buildNoticeView({ ownLabel: 'A B.', gymName: 'G', busy: null, failed: false, connected: true, t }).title).toBe('SENTINEL-NOTICE');
    const view = buildLeaderboardView(input({ t, board: ready([row(1), row(9), row(10, { isSelf: true }), row(11)]) }));
    expect(view.items.some((i) => i.kind === 'gap' && i.accessibilityLabel === 'SENTINEL-GAP')).toBe(true);
    const card = buildHomeCardView({ load: { kind: 'ready', standing: { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 }, fromCache: false, updatedAtMs: null }, t, language: 'en' });
    expect(card.kind === 'card' && card.headline).toBe('SENTINEL 9/43');
  });
});

describe.each(LANGS)('the Home card (%s)', (lang) => {
  const t = makeT(lang);
  const card = (load: Parameters<typeof buildHomeCardView>[0]['load']) => buildHomeCardView({ load, t, language: lang });
  const standing = (over: Partial<{ rankedTotal: number; selfRanked: boolean; rank: number | null; visitsBehind: number | null }> = {}) => ({
    rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2, ...over,
  });

  it('shows the server\'s rank and total and the behind line', () => {
    const view = card({ kind: 'ready', standing: standing(), fromCache: false, updatedAtMs: null });
    expect(view).toMatchObject({ kind: 'card', isRank: true, headline: t('engage.home.rank', { n: 9, total: 43 }), line: t('engage.leaderboard.behind', { count: 2 }), updated: null });
  });

  it('level and leading', () => {
    expect(card({ kind: 'ready', standing: standing({ visitsBehind: 0 }), fromCache: false, updatedAtMs: null })).toMatchObject({ line: t('engage.leaderboard.level') });
    expect(card({ kind: 'ready', standing: standing({ rank: 1, visitsBehind: null }), fromCache: false, updatedAtMs: null })).toMatchObject({ line: t('engage.leaderboard.leading') });
  });

  it('no visit this month: the unranked line and no rank', () => {
    const view = card({ kind: 'ready', standing: standing({ selfRanked: false, rank: null, visitsBehind: null }), fromCache: false, updatedAtMs: null });
    expect(view).toMatchObject({ kind: 'card', isRank: false, headline: t('engage.leaderboard.unranked'), line: null });
  });

  it('fewer than 3 ranked: not enough members in place of a rank, even for a ranked member', () => {
    const view = card({ kind: 'ready', standing: standing({ rankedTotal: 2, rank: null, visitsBehind: null }), fromCache: false, updatedAtMs: null });
    expect(view).toMatchObject({ kind: 'card', isRank: false, headline: t('engage.leaderboard.notEnough.title'), line: null });
  });

  it('offline: the last cached rank with the updated time', () => {
    const view = card({ kind: 'ready', standing: standing(), fromCache: true, updatedAtMs: Date.UTC(2026, 10, 25, 9, 5) });
    expect(view.kind === 'card' && view.updated).toMatch(/\d/);
    expect(view.kind === 'card' && view.headline).toBe(t('engage.home.rank', { n: 9, total: 43 }));
  });

  it('hidden, skeleton and error', () => {
    expect(card({ kind: 'hidden' })).toEqual({ kind: 'hidden' });
    expect(card({ kind: 'loading' })).toEqual({ kind: 'skeleton' });
    expect(card({ kind: 'error' })).toMatchObject({ kind: 'error', text: t('engage.leaderboard.error.short') });
  });

  it('the card never carries a name', () => {
    const view = card({ kind: 'ready', standing: standing(), fromCache: false, updatedAtMs: null });
    expect(JSON.stringify(view)).not.toMatch(/PERSON|Anonymous|Anonyme/);
  });
});

describe('standingFromRows keeps only the member\'s own standing', () => {
  it('takes the own row and the server\'s total', () => {
    expect(standingFromRows([row(1), row(17, { isSelf: true, rank: 15, visitsBehind: 1 }), row(18)])).toEqual({ rankedTotal: 43, selfRanked: true, rank: 15, visitsBehind: 1 });
  });
  it('an unranked member has no rank', () => {
    expect(standingFromRows([row(1, { selfRanked: false })])).toEqual({ rankedTotal: 43, selfRanked: false, rank: null, visitsBehind: null });
  });
  it('the fewer-than-3 row', () => {
    expect(standingFromRows([NONE(2, true)])).toEqual({ rankedTotal: 2, selfRanked: true, rank: null, visitsBehind: null });
  });
  it('no rows is no standing', () => {
    expect(standingFromRows([])).toBeNull();
  });
});

describe.each(LANGS)('the notice (%s)', (lang) => {
  const t = makeT(lang);
  it('carries the preview of the member\'s own label and the gym', () => {
    const view = buildNoticeView({ ownLabel: 'MIREILLE K.', gymName: 'IRON TEMPLE', busy: null, failed: false, connected: true, t });
    expect(view.body).toContain('MIREILLE K.');
    expect(view.body).toContain('IRON TEMPLE');
    expect(view).toMatchObject({ until: t('engage.leaderboard.notice.until'), change: t('engage.leaderboard.notice.change'), showLabel: t('engage.leaderboard.notice.cta.show'), hideLabel: t('engage.leaderboard.notice.cta.hide'), error: null, offlineNote: null, disabled: false, busy: null });
  });
  it('a running call disables both buttons and names the one that spins', () => {
    const view = buildNoticeView({ ownLabel: 'A B.', gymName: 'G', busy: 'hide', failed: false, connected: true, t });
    expect(view).toMatchObject({ disabled: true, busy: 'hide' });
  });
  it('a failure shows the error line and re-enables the buttons', () => {
    const view = buildNoticeView({ ownLabel: 'A B.', gymName: 'G', busy: null, failed: true, connected: true, t });
    expect(view).toMatchObject({ error: t('engage.leaderboard.notice.error'), disabled: false });
  });
  it('offline disables both and says why', () => {
    const view = buildNoticeView({ ownLabel: 'A B.', gymName: 'G', busy: null, failed: false, connected: false, t });
    expect(view).toMatchObject({ disabled: true, offlineNote: t('engage.leaderboard.offline.notice') });
  });
});

describe('runNoticeChoice', () => {
  const ok = { status: 'success' } as const;
  const bad = { status: 'error' } as const;

  it('[Show my name] calls only mark_leaderboard_notice_seen', async () => {
    const setVisibility = vi.fn(async () => ok);
    const markSeen = vi.fn(async () => ok);
    await expect(runNoticeChoice('show', { setVisibility, markSeen })).resolves.toEqual({ ok: true, hiddenWritten: false });
    expect(setVisibility).not.toHaveBeenCalled();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it('[Appear as Anonymous] hides FIRST and only then marks the notice', async () => {
    const calls: string[] = [];
    const setVisibility = vi.fn(async (hidden: boolean) => {
      calls.push(`hide:${hidden}`);
      return ok;
    });
    const markSeen = vi.fn(async () => {
      calls.push('seen');
      return ok;
    });
    await expect(runNoticeChoice('hide', { setVisibility, markSeen })).resolves.toEqual({ ok: true, hiddenWritten: true });
    expect(calls).toEqual(['hide:true', 'seen']);
  });

  it('a failed hide marks nothing', async () => {
    const markSeen = vi.fn(async () => ok);
    await expect(runNoticeChoice('hide', { setVisibility: async () => bad, markSeen })).resolves.toEqual({ ok: false, hiddenWritten: false });
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('a failure between the two leaves the member hidden and un-noticed, never named', async () => {
    await expect(runNoticeChoice('hide', { setVisibility: async () => ok, markSeen: async () => bad })).resolves.toEqual({ ok: false, hiddenWritten: true });
  });

  it('a failed mark after [Show my name] is a failure and writes nothing else', async () => {
    const setVisibility = vi.fn(async () => ok);
    await expect(runNoticeChoice('show', { setVisibility, markSeen: async () => ({ status: 'gym_suspended' }) })).resolves.toEqual({ ok: false, hiddenWritten: false });
    expect(setVisibility).not.toHaveBeenCalled();
  });

  it('a throwing service is a failure, never an exception', async () => {
    await expect(runNoticeChoice('show', { setVisibility: async () => ok, markSeen: async () => { throw new Error('boom'); } })).resolves.toEqual({ ok: false, hiddenWritten: false });
  });
});

describe('decideToggle', () => {
  it('turning on (hide) always saves', () => {
    expect(decideToggle(true, false)).toBe('save');
    expect(decideToggle(true, true)).toBe('save');
  });
  it('turning off saves once the notice is seen and opens the notice before that', () => {
    expect(decideToggle(false, true)).toBe('save');
    expect(decideToggle(false, false)).toBe('openNotice');
  });
});

describe.each(LANGS)('the Profile row (%s)', (lang) => {
  const t = makeT(lang);
  const view = (settings: LeaderboardSettings, over: { pending?: boolean; connected?: boolean } = {}) => buildAnonymousRowView({ settings, pending: over.pending ?? false, connected: over.connected ?? true, t });

  it('the helper states the current effect', () => {
    expect(view({ hidden: true, noticeSeen: true, ownLabel: 'A B.' }).helper).toBe(t('engage.profile.anonymous.helperOn'));
    expect(view({ hidden: false, noticeSeen: true, ownLabel: 'A B.' }).helper).toBe(t('engage.profile.anonymous.helperOff', { label: 'A B.' }));
    expect(view({ hidden: false, noticeSeen: false, ownLabel: 'A B.' }).helper).toBe(t('engage.profile.anonymous.helperUnseen'));
    expect(view({ hidden: true, noticeSeen: false, ownLabel: 'A B.' }).helper).toBe(t('engage.profile.anonymous.helperUnseen'));
  });
  it('the toggle shows the stored choice and the label states it', () => {
    expect(view({ hidden: true, noticeSeen: true, ownLabel: 'A' })).toMatchObject({ checked: true, accessibilityLabel: t('engage.profile.anonymous.a11yOn') });
    expect(view({ hidden: false, noticeSeen: true, ownLabel: 'A' })).toMatchObject({ checked: false, accessibilityLabel: t('engage.profile.anonymous.a11yOff') });
  });
  it('is disabled while pending and offline', () => {
    const s = { hidden: false, noticeSeen: true, ownLabel: 'A' };
    expect(view(s).disabled).toBe(false);
    expect(view(s, { pending: true }).disabled).toBe(true);
    expect(view(s, { connected: false }).disabled).toBe(true);
  });
  it('the helper never says the change is instant for others', () => {
    const helperOn = t('engage.profile.anonymous.helperOn');
    expect(helperOn.toLowerCase()).not.toMatch(/instant|immediate|tout de suite|immédiat/);
  });
});

describe('the device copy', () => {
  const rows = [row(1), row(2), row(3)];

  it('reads as nothing when nothing was stored, and survives damaged data', async () => {
    expect(await readLeaderboardCache('u', 'g')).toEqual({ settings: null, months: {} });
    store.set(leaderboardCacheKey('u', 'g'), '{not json');
    expect(await readLeaderboardCache('u', 'g')).toEqual({ settings: null, months: {} });
    store.set(leaderboardCacheKey('u', 'g'), JSON.stringify({ settings: { hidden: 'x' }, months: { '2026-11-01': { rows: [{ nope: 1 }], updatedAtMs: 1 }, 'bad': { rows, updatedAtMs: 1 } } }));
    expect(await readLeaderboardCache('u', 'g')).toEqual({ settings: null, months: {} });
  });

  it('keeps one entry per user and gym, and only the two latest months', async () => {
    await writeLeaderboardBoard('u', 'g', '2026-09-01', rows, 1);
    await writeLeaderboardBoard('u', 'g', '2026-10-01', rows, 2);
    await writeLeaderboardBoard('u', 'g', '2026-11-01', rows, 3);
    await writeLeaderboardSettings('u', 'g', { hidden: true, ownLabel: 'A B.' });
    const cache = await readLeaderboardCache('u', 'g');
    expect(Object.keys(cache.months)).toEqual(['2026-10-01', '2026-11-01']);
    expect(cache.months['2026-11-01']).toEqual({ rows, updatedAtMs: 3 });
    expect(cache.settings).toEqual({ hidden: true, ownLabel: 'A B.' });
    expect(await readLeaderboardCache('u', 'other-gym')).toEqual({ settings: null, months: {} });
    expect(await readLeaderboardCache('other-user', 'g')).toEqual({ settings: null, months: {} });
  });

  it('concurrent writes do not drop each other', async () => {
    await Promise.all([writeLeaderboardBoard('u', 'g', '2026-11-01', rows, 3), writeLeaderboardSettings('u', 'g', { hidden: false, ownLabel: 'A' })]);
    const cache = await readLeaderboardCache('u', 'g');
    expect(cache.settings).not.toBeNull();
    expect(Object.keys(cache.months)).toEqual(['2026-11-01']);
  });

  it('Home keeps only the own standing', async () => {
    expect(await readHomeStanding('u', 'g')).toBeNull();
    await writeHomeStanding('u', 'g', { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 }, 5, '2026-11-01');
    expect(await readHomeStanding('u', 'g')).toEqual({ standing: { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 }, updatedAtMs: 5, month: '2026-11-01' });
    expect([...store.values()].join()).not.toMatch(/label|PERSON/);
    store.set('gymos.engageLeaderboardHome.v1.u.g', '{"standing":{"rankedTotal":"x"},"updatedAtMs":1}');
    expect(await readHomeStanding('u', 'g')).toBeNull();
    // A copy written before the month was stored (or with a bad month) is no copy: it could be last month's.
    store.set('gymos.engageLeaderboardHome.v1.u.g', JSON.stringify({ standing: { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 }, updatedAtMs: 5 }));
    expect(await readHomeStanding('u', 'g')).toBeNull();
    store.set('gymos.engageLeaderboardHome.v1.u.g', JSON.stringify({ standing: { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 }, updatedAtMs: 5, month: '2026-11-15' }));
    expect(await readHomeStanding('u', 'g')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The pure decisions every consumer follows (the dark-area gate, the Home copy, the toggle and notice results)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const ENGAGEMENT_ROW = (enabled: boolean, gymToday = '2026-11-25') => ({ enabled, gymToday }) as unknown as Engagement;

describe('the dark-area gate: only an open area may call a leaderboard function', () => {
  it('a getMyEngagement result: enabled is open, a disabled row and "not a live member" are dark, an error or nothing is unknown', () => {
    expect(gateFromResult({ status: 'success', engagement: ENGAGEMENT_ROW(true) })).toBe('open');
    expect(gateFromResult({ status: 'success', engagement: ENGAGEMENT_ROW(false) })).toBe('dark');
    expect(gateFromResult({ status: 'unavailable' })).toBe('dark');
    expect(gateFromResult({ status: 'error' })).toBe('unknown');
    expect(gateFromResult(null)).toBe('unknown');
    expect(gateFromResult(undefined)).toBe('unknown');
  });

  it('a Home engagement outcome: row is open, dark is dark, failed and null are unknown', () => {
    expect(gateFromOutcome({ kind: 'row', engagement: ENGAGEMENT_ROW(true), settleFailed: false })).toBe('open');
    expect(gateFromOutcome({ kind: 'dark', engagement: null })).toBe('dark');
    expect(gateFromOutcome({ kind: 'dark', engagement: ENGAGEMENT_ROW(false) })).toBe('dark');
    expect(gateFromOutcome({ kind: 'failed' })).toBe('unknown');
    expect(gateFromOutcome(null)).toBe('unknown');
  });

  it('no leaderboard function may be called unless the gate is open', () => {
    expect(mayCallLeaderboard('open')).toBe(true);
    expect(mayCallLeaderboard('dark')).toBe(false);
    expect(mayCallLeaderboard('unknown')).toBe(false);
  });

  it('the screen board is read live only when the gate is open and the device is online; every other state uses the device copy', () => {
    expect(boardSource('open', true)).toBe('live');
    expect(boardSource('open', false)).toBe('copy');
    expect(boardSource('unknown', true)).toBe('copy');
    expect(boardSource('unknown', false)).toBe('copy');
    expect(boardSource('dark', true)).toBe('copy');
    expect(boardSource('dark', false)).toBe('copy');
  });

  it('Profile: read when open, clear when dark, the device copy only when the read failed and the device says on, else keep', () => {
    expect(profileSettingsPlan('open', false)).toBe('read');
    expect(profileSettingsPlan('open', true)).toBe('read');
    expect(profileSettingsPlan('dark', true)).toBe('clear');
    expect(profileSettingsPlan('unknown', true)).toBe('device');
    expect(profileSettingsPlan('unknown', false)).toBe('keep');
  });

  it('the settings a device copy stands for are noticeSeen true, and none without a copy', () => {
    expect(settingsFromDeviceCopy({ settings: { hidden: true, ownLabel: 'A B.' }, months: {} })).toEqual({ hidden: true, noticeSeen: true, ownLabel: 'A B.' });
    expect(settingsFromDeviceCopy({ settings: null, months: {} })).toBeNull();
  });

  it('a device copy of the settings is kept only once the notice was chosen on', () => {
    expect(mayKeepSettingsCopy({ hidden: false, noticeSeen: true, ownLabel: 'A' })).toBe(true);
    expect(mayKeepSettingsCopy({ hidden: true, noticeSeen: false, ownLabel: 'A' })).toBe(false);
  });
});

describe('the Home card: a copy of the standing counts only for the month it was read for', () => {
  const STANDING = { rankedTotal: 43, selfRanked: true, rank: 9, visitsBehind: 2 };
  const cached = (month: string) => ({ standing: STANDING, updatedAtMs: 5, month });

  it('the month of a row on hand is the gym month, and nothing for a disabled or missing row', () => {
    expect(monthOfEngagement(ENGAGEMENT_ROW(true, '2026-12-01'))).toBe('2026-12-01');
    expect(monthOfEngagement(ENGAGEMENT_ROW(false))).toBeNull();
    expect(monthOfEngagement(null)).toBeNull();
  });

  it('standingCopyFor returns the copy only when the months are equal', () => {
    expect(standingCopyFor(cached('2026-11-01'), '2026-11-01')).toEqual(cached('2026-11-01'));
    expect(standingCopyFor(cached('2026-11-01'), '2026-12-01')).toBeNull();
    expect(standingCopyFor(cached('2026-11-01'), null)).toBeNull();
    expect(standingCopyFor(null, '2026-11-01')).toBeNull();
  });

  it('dark: no call and nothing drawn, whatever copy is held', () => {
    expect(planHomeLoad({ gate: 'dark', cached: cached('2026-11-01'), month: '2026-11-01' })).toMatchObject({ call: false, show: { kind: 'hidden' } });
  });

  it('open: the call is made, and a failed call falls back to this month\'s copy or the error card, never last month\'s copy', () => {
    const same = planHomeLoad({ gate: 'open', cached: cached('2026-11-01'), month: '2026-11-01' });
    expect(same).toMatchObject({ call: true, show: null, fallback: { kind: 'ready', fromCache: true, updatedAtMs: 5 } });
    expect(planHomeLoad({ gate: 'open', cached: cached('2026-10-01'), month: '2026-11-01' }).fallback).toEqual({ kind: 'error' });
    expect(planHomeLoad({ gate: 'open', cached: null, month: '2026-11-01' }).fallback).toEqual({ kind: 'error' });
  });

  it('unknown: no call; this month\'s copy by the month of the device copy of the row, else nothing (never an error card)', () => {
    expect(planHomeLoad({ gate: 'unknown', cached: cached('2026-11-01'), month: '2026-11-01' })).toMatchObject({ call: false, show: { kind: 'ready', fromCache: true } });
    expect(planHomeLoad({ gate: 'unknown', cached: cached('2026-11-01'), month: '2026-12-01' })).toMatchObject({ call: false, show: { kind: 'hidden' } });
    expect(planHomeLoad({ gate: 'unknown', cached: cached('2026-11-01'), month: null })).toMatchObject({ call: false, show: { kind: 'hidden' } });
    expect(planHomeLoad({ gate: 'unknown', cached: null, month: '2026-11-01' })).toMatchObject({ call: false, show: { kind: 'hidden' } });
  });
});

describe('the toggle and the notice result', () => {
  const S: LeaderboardSettings = { hidden: false, noticeSeen: true, ownLabel: 'A B.' };

  it('a successful toggle keeps the new choice; a failed one returns the previous choice', () => {
    expect(settingsAfterToggle(S, true, true)).toEqual({ ...S, hidden: true });
    expect(settingsAfterToggle(S, true, false)).toEqual(S);
    const hidden = { ...S, hidden: true };
    expect(settingsAfterToggle(hidden, false, false)).toEqual(hidden);
    expect(settingsAfterToggle(hidden, false, true)).toEqual({ ...hidden, hidden: false });
  });

  it('the notice: [Show my name] succeeded marks it seen and leaves the choice; a failure changes nothing', () => {
    const unseen = { ...S, noticeSeen: false };
    expect(settingsAfterNotice(unseen, { ok: true, hiddenWritten: false })).toEqual({ ...S, noticeSeen: true, hidden: false });
    expect(settingsAfterNotice(unseen, { ok: false, hiddenWritten: false })).toEqual(unseen);
  });

  it('the notice: [Appear as Anonymous] succeeded is hidden and seen; hide written but the mark failed is hidden and still un-noticed', () => {
    const unseen = { ...S, noticeSeen: false };
    expect(settingsAfterNotice(unseen, { ok: true, hiddenWritten: true })).toEqual({ ...S, hidden: true, noticeSeen: true });
    expect(settingsAfterNotice(unseen, { ok: false, hiddenWritten: true })).toEqual({ ...S, hidden: true, noticeSeen: false });
  });
});
