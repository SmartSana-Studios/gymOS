import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

import {
  getGymLeaderboard,
  getMyGymName,
  getMyLeaderboardSettings,
  markLeaderboardNoticeSeen,
  parseLeaderboardRows,
  parseLeaderboardSettings,
  setLeaderboardVisibility,
} from './leaderboard';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

const ROW = { position: 1, rank: 1, label: 'CHANTAL N.', is_anonymous: false, visits: 11, is_self: false, is_tied: false, visits_behind: null, ranked_total: 43, self_ranked: true };
const NONE = { position: null, rank: null, label: null, is_anonymous: false, visits: null, is_self: false, is_tied: false, visits_behind: null, ranked_total: 2, self_ranked: false };

describe('parseLeaderboardRows', () => {
  it('maps a detail row', () => {
    expect(parseLeaderboardRows([ROW])).toEqual([
      { position: 1, rank: 1, label: 'CHANTAL N.', isAnonymous: false, visits: 11, isSelf: false, isTied: false, visitsBehind: null, rankedTotal: 43, selfRanked: true },
    ]);
  });
  it('maps the fewer-than-3 row with every detail NULL', () => {
    expect(parseLeaderboardRows([NONE])).toEqual([
      { position: null, rank: null, label: null, isAnonymous: false, visits: null, isSelf: false, isTied: false, visitsBehind: null, rankedTotal: 2, selfRanked: false },
    ]);
  });
  it('accepts an empty list (the server answers a non-member with no row)', () => {
    expect(parseLeaderboardRows([])).toEqual([]);
  });
  it('refuses a malformed list, a half-filled row and a wrong type', () => {
    expect(parseLeaderboardRows(null)).toBeNull();
    expect(parseLeaderboardRows([null])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, label: null }])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, position: null }])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, visits: '11' }])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, is_self: 'yes' }])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, ranked_total: -1 }])).toBeNull();
    expect(parseLeaderboardRows([{ ...ROW, rank: 1.5 }])).toBeNull();
  });
});

describe('parseLeaderboardSettings', () => {
  it('maps the row, or a bare object', () => {
    const settings = { hidden: true, noticeSeen: false, ownLabel: 'MIREILLE K.' };
    expect(parseLeaderboardSettings([{ hidden: true, notice_seen: false, own_label: 'MIREILLE K.' }])).toEqual(settings);
    expect(parseLeaderboardSettings({ hidden: true, notice_seen: false, own_label: 'MIREILLE K.' })).toEqual(settings);
  });
  it('refuses a malformed row', () => {
    expect(parseLeaderboardSettings(null)).toBeNull();
    expect(parseLeaderboardSettings([{ hidden: 'no', notice_seen: false, own_label: 'X' }])).toBeNull();
    expect(parseLeaderboardSettings([{ hidden: true, notice_seen: false }])).toBeNull();
  });
});

describe('getGymLeaderboard', () => {
  it('calls the RPC with the month and returns the rows', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const result = await getGymLeaderboard('2026-11-01');
    expect(result.status).toBe('success');
    expect(rpc).toHaveBeenCalledWith('gym_leaderboard', { p_month: '2026-11-01' });
  });
  it('maps an empty answer to unavailable', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getGymLeaderboard('2026-11-01')).resolves.toEqual({ status: 'unavailable' });
  });
  it('maps invalid_month by code and by message, any other error and a throw to error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_month' } });
    await expect(getGymLeaderboard('2026-09-01')).resolves.toEqual({ status: 'invalid_month' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_month' } });
    await expect(getGymLeaderboard('2026-09-01')).resolves.toEqual({ status: 'invalid_month' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(getGymLeaderboard('2026-11-01')).resolves.toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, label: 3 }], error: null });
    await expect(getGymLeaderboard('2026-11-01')).resolves.toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(getGymLeaderboard('2026-11-01')).resolves.toEqual({ status: 'error' });
  });
});

describe('getMyLeaderboardSettings', () => {
  it('returns the settings, unavailable on no row, error otherwise', async () => {
    rpc.mockResolvedValueOnce({ data: [{ hidden: false, notice_seen: true, own_label: 'A B.' }], error: null });
    await expect(getMyLeaderboardSettings()).resolves.toEqual({ status: 'success', settings: { hidden: false, noticeSeen: true, ownLabel: 'A B.' } });
    expect(rpc).toHaveBeenCalledWith('my_leaderboard_settings');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getMyLeaderboardSettings()).resolves.toEqual({ status: 'unavailable' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(getMyLeaderboardSettings()).resolves.toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(getMyLeaderboardSettings()).resolves.toEqual({ status: 'error' });
  });
});

describe('the two writers', () => {
  it('setLeaderboardVisibility sends only p_hidden', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(setLeaderboardVisibility(true)).resolves.toEqual({ status: 'success' });
    expect(rpc).toHaveBeenCalledWith('set_leaderboard_visibility', { p_hidden: true });
  });
  it('markLeaderboardNoticeSeen sends no argument', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(markLeaderboardNoticeSeen()).resolves.toEqual({ status: 'success' });
    expect(rpc).toHaveBeenCalledWith('mark_leaderboard_notice_seen');
  });
  it('both map a suspended gym, any other error and a throw', async () => {
    const suspended = { code: '42501', message: 'permission denied: gym 00000000-0000-0000-0000-000000000001 is not active' };
    rpc.mockResolvedValueOnce({ data: null, error: suspended });
    await expect(setLeaderboardVisibility(false)).resolves.toEqual({ status: 'gym_suspended' });
    rpc.mockResolvedValueOnce({ data: null, error: suspended });
    await expect(markLeaderboardNoticeSeen()).resolves.toEqual({ status: 'gym_suspended' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(setLeaderboardVisibility(false)).resolves.toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(markLeaderboardNoticeSeen()).resolves.toEqual({ status: 'error' });
  });
});

describe('getMyGymName', () => {
  const chain = (result: unknown, eq = vi.fn()) => ({ select: () => ({ eq: (...a: unknown[]) => (eq(...a), { maybeSingle: async () => result }) }) });

  it('reads the named gym by id (a member of two gyms can read both rows)', async () => {
    const eq = vi.fn();
    from.mockReturnValue(chain({ data: { name: 'IRON TEMPLE' }, error: null }, eq));
    await expect(getMyGymName('gym-1')).resolves.toBe('IRON TEMPLE');
    expect(from).toHaveBeenCalledWith('gyms');
    expect(eq).toHaveBeenCalledWith('id', 'gym-1');
  });
  it('is null on an error, a missing row or a throw', async () => {
    from.mockReturnValueOnce(chain({ data: null, error: { message: 'x' } }));
    await expect(getMyGymName('gym-1')).resolves.toBeNull();
    from.mockReturnValueOnce(chain({ data: null, error: null }));
    await expect(getMyGymName('gym-1')).resolves.toBeNull();
    from.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    await expect(getMyGymName('gym-1')).resolves.toBeNull();
  });
});
