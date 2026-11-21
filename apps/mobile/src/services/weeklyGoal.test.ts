import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, storage, rpc } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
  return { store, storage, rpc: vi.fn() };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  getMyWeeklyGoal,
  markGoalHintSeen,
  parseSetWeeklyGoalOutcome,
  parseWeeklyGoal,
  readGoalHintSeen,
  setWeeklyGoal,
} from './weeklyGoal';

const ROW = {
  current_goal: 3,
  current_goal_is_default: true,
  pending_goal: 5,
  pending_effective_week: '2026-11-23',
  next_effective_week: '2026-11-23',
  goal_min: 1,
  goal_max: 7,
};

beforeEach(() => {
  store.clear();
  storage.getItem.mockClear();
  storage.setItem.mockClear();
  rpc.mockReset();
});

describe('parseWeeklyGoal', () => {
  it('reads the first row of an array', () => {
    expect(parseWeeklyGoal([ROW])).toEqual({
      currentGoal: 3,
      currentGoalIsDefault: true,
      pendingGoal: 5,
      pendingEffectiveWeek: '2026-11-23',
      nextEffectiveWeek: '2026-11-23',
      goalMin: 1,
      goalMax: 7,
    });
  });

  it('accepts a bare object and a null pending goal', () => {
    const parsed = parseWeeklyGoal({ ...ROW, pending_goal: null, pending_effective_week: null });
    expect(parsed?.pendingGoal).toBeNull();
    expect(parsed?.pendingEffectiveWeek).toBeNull();
  });

  it.each([
    ['no rows', []],
    ['null', null],
    ['a string', 'x'],
    ['a string goal', [{ ...ROW, current_goal: '3' }]],
    ['a fractional goal', [{ ...ROW, current_goal: 3.5 }]],
    ['a non-boolean default flag', [{ ...ROW, current_goal_is_default: 'true' }]],
    ['a malformed next Monday', [{ ...ROW, next_effective_week: '23/11/2026' }]],
    ['a missing range', [{ ...ROW, goal_max: undefined }]],
    ['a pending goal without its date', [{ ...ROW, pending_effective_week: null }]],
    ['a pending goal that is not a number', [{ ...ROW, pending_goal: 'five' }]],
  ])('rejects %s', (_label, data) => {
    expect(parseWeeklyGoal(data)).toBeNull();
  });
});

describe('parseSetWeeklyGoalOutcome', () => {
  it('reads a pending result and a cancelled one', () => {
    expect(parseSetWeeklyGoalOutcome([{ goal: 5, effective_week: '2026-11-23', current_goal: 3, current_goal_is_default: true }])).toEqual({
      goal: 5,
      effectiveWeek: '2026-11-23',
      currentGoal: 3,
      currentGoalIsDefault: true,
    });
    expect(parseSetWeeklyGoalOutcome([{ goal: 3, effective_week: null, current_goal: 3, current_goal_is_default: false }])?.effectiveWeek).toBeNull();
  });

  it('rejects a malformed row', () => {
    expect(parseSetWeeklyGoalOutcome([])).toBeNull();
    expect(parseSetWeeklyGoalOutcome([{ goal: '5', effective_week: null, current_goal: 3, current_goal_is_default: true }])).toBeNull();
    expect(parseSetWeeklyGoalOutcome([{ goal: 5, effective_week: 'soon', current_goal: 3, current_goal_is_default: true }])).toBeNull();
  });
});

describe('getMyWeeklyGoal', () => {
  it('success', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const result = await getMyWeeklyGoal();
    expect(rpc).toHaveBeenCalledWith('my_weekly_goal');
    expect(result.status).toBe('success');
  });

  it('unavailable when the server returns no row', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getMyWeeklyGoal()).toEqual({ status: 'unavailable' });
  });

  it('error on an RPC error, a malformed row and a thrown call', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await getMyWeeklyGoal()).toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, goal_min: 'x' }], error: null });
    expect(await getMyWeeklyGoal()).toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await getMyWeeklyGoal()).toEqual({ status: 'error' });
  });
});

describe('setWeeklyGoal', () => {
  it('sends only the goal and returns the outcome', async () => {
    rpc.mockResolvedValue({ data: [{ goal: 5, effective_week: '2026-11-23', current_goal: 3, current_goal_is_default: true }], error: null });
    const result = await setWeeklyGoal(5);
    expect(rpc).toHaveBeenCalledWith('set_weekly_goal', { p_goal: 5 });
    expect(result).toEqual({ status: 'success', outcome: { goal: 5, effectiveWeek: '2026-11-23', currentGoal: 3, currentGoalIsDefault: true } });
  });

  it('maps invalid_goal, a suspended gym and any other failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_goal', code: '22023' } });
    expect(await setWeeklyGoal(9)).toEqual({ status: 'invalid_goal' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied: gym abc is not active', code: '42501' } });
    expect(await setWeeklyGoal(4)).toEqual({ status: 'gym_suspended' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied', code: '42501' } });
    expect(await setWeeklyGoal(4)).toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await setWeeklyGoal(4)).toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await setWeeklyGoal(4)).toEqual({ status: 'error' });
  });
});

describe('goal hint storage', () => {
  it('is unseen until written, then seen, per user', async () => {
    expect(await readGoalHintSeen('u1')).toBe(false);
    expect(await markGoalHintSeen('u1')).toBe(true);
    expect(await readGoalHintSeen('u1')).toBe(true);
    expect(await readGoalHintSeen('u2')).toBe(false);
  });

  it('reads as unseen and reports false when storage fails', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await readGoalHintSeen('u1')).toBe(false);
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    expect(await markGoalHintSeen('u1')).toBe(false);
  });
});
