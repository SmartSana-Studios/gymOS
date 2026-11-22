import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { getMyEngagement, openEngagement, parseEngagement } from './engagement';

const ROW = {
  enabled: true,
  gym_today: '2026-11-21',
  week_start: '2026-11-16',
  week_end: '2026-11-22',
  in_release_week: false,
  goal: 3,
  goal_is_default: true,
  pending_goal: 4,
  pending_effective_week: '2026-11-23',
  visits_this_week: 1,
  goal_met: false,
  visited_today: false,
  streak_weeks: 2,
  streak_if_met: null,
  best_streak_weeks: 5,
  has_settled_week: true,
  days_left_in_week: 2,
  visits_needed: 2,
  at_risk_weekly: true,
  at_risk_daily: false,
  daily_run: null,
  shields_held: 0,
  comeback_state: 'none',
  day_starts_at: '2026-11-20T23:00:00+00:00',
  day_ends_at: '2026-11-21T23:00:00+00:00',
  server_now: '2026-11-21T11:00:00+00:00',
  needs_settle: false,
  pending_milestone: null,
};

beforeEach(() => {
  rpc.mockReset();
});

describe('parseEngagement', () => {
  it('reads the first row of an array into camelCase', () => {
    expect(parseEngagement([ROW])).toEqual({
      enabled: true,
      gymToday: '2026-11-21',
      weekStart: '2026-11-16',
      weekEnd: '2026-11-22',
      inReleaseWeek: false,
      goal: 3,
      goalIsDefault: true,
      pendingGoal: 4,
      pendingEffectiveWeek: '2026-11-23',
      visitsThisWeek: 1,
      goalMet: false,
      visitedToday: false,
      streakWeeks: 2,
      streakIfMet: null,
      bestStreakWeeks: 5,
      hasSettledWeek: true,
      daysLeftInWeek: 2,
      visitsNeeded: 2,
      atRiskWeekly: true,
      atRiskDaily: false,
      dailyRun: null,
      shieldsHeld: 0,
      comebackState: 'none',
      dayStartsAt: '2026-11-20T23:00:00+00:00',
      dayEndsAt: '2026-11-21T23:00:00+00:00',
      serverNow: '2026-11-21T11:00:00+00:00',
      needsSettle: false,
      pendingMilestone: null,
    });
  });

  it('accepts a bare object, a null pending goal and a streak_if_met number', () => {
    const parsed = parseEngagement({ ...ROW, pending_goal: null, pending_effective_week: null, streak_if_met: 3, goal_met: true });
    expect(parsed?.pendingGoal).toBeNull();
    expect(parsed?.pendingEffectiveWeek).toBeNull();
    expect(parsed?.streakIfMet).toBe(3);
  });

  it.each([
    ['no rows', []],
    ['null', null],
    ['a string', 'x'],
    ['a string goal', [{ ...ROW, goal: '3' }]],
    ['a fractional count', [{ ...ROW, visits_this_week: 1.5 }]],
    ['a non-boolean flag', [{ ...ROW, at_risk_weekly: 'true' }]],
    ['a missing flag', [{ ...ROW, needs_settle: undefined }]],
    ['a malformed date', [{ ...ROW, week_start: '16/11/2026' }]],
    ['a malformed timestamp', [{ ...ROW, day_ends_at: 'tonight' }]],
    ['a non-number streak_if_met', [{ ...ROW, streak_if_met: 'two' }]],
    ['a pending goal without its date', [{ ...ROW, pending_effective_week: null }]],
    ['a missing comeback state', [{ ...ROW, comeback_state: undefined }]],
  ])('rejects %s', (_label, data) => {
    expect(parseEngagement(data)).toBeNull();
  });
});

describe('getMyEngagement', () => {
  it('success, calling the read function with no argument', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const result = await getMyEngagement();
    expect(rpc).toHaveBeenCalledWith('my_engagement');
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.engagement.atRiskWeekly).toBe(true);
  });

  it('unavailable when the server returns no row (not a live member)', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getMyEngagement()).toEqual({ status: 'unavailable' });
  });

  it('error on an RPC error, a malformed row and a thrown call', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await getMyEngagement()).toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, goal: 'x' }], error: null });
    expect(await getMyEngagement()).toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await getMyEngagement()).toEqual({ status: 'error' });
  });
});

describe('openEngagement', () => {
  it('success, calling the settle function with no argument', async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, needs_settle: false, streak_weeks: 3 }], error: null });
    const result = await openEngagement();
    expect(rpc).toHaveBeenCalledWith('open_engagement');
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.engagement.streakWeeks).toBe(3);
  });

  it('unavailable when the server refuses a caller who is not a live member', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });
    expect(await openEngagement()).toEqual({ status: 'unavailable' });
  });

  it('gym_suspended for a suspended gym', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied: gym abc is not active', code: '42501' } });
    expect(await openEngagement()).toEqual({ status: 'gym_suspended' });
  });

  it('error on any other failure, an empty or malformed result and a thrown call', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
    expect(await openEngagement()).toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await openEngagement()).toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, enabled: 1 }], error: null });
    expect(await openEngagement()).toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await openEngagement()).toEqual({ status: 'error' });
  });
});
