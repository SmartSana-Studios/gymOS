import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

import { getMemberPreferences, getStreakReminderHour, updateMemberPreferences } from './notificationPreferences';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('updateMemberPreferences', () => {
  function mockUpdate(result: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ update });
    return { update, eq, select };
  }

  it('sends only streak_reminder_opted_out for the streak field alone, and returns true on one row', async () => {
    const m = mockUpdate({ data: [{ member_id: 'm1' }], error: null });
    await expect(updateMemberPreferences('m1', { streakReminderOptedOut: true })).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('member_preferences');
    expect(m.update).toHaveBeenCalledWith({ streak_reminder_opted_out: true });
    expect(m.eq).toHaveBeenCalledWith('member_id', 'm1');
  });

  it('returns false for a zero-row update, an error, and an empty patch', async () => {
    mockUpdate({ data: [], error: null });
    await expect(updateMemberPreferences('m1', { streakReminderOptedOut: true })).resolves.toBe(false);
    mockUpdate({ data: null, error: { message: 'boom' } });
    await expect(updateMemberPreferences('m1', { streakReminderOptedOut: false })).resolves.toBe(false);
    from.mockClear();
    await expect(updateMemberPreferences('m1', {})).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('getMemberPreferences', () => {
  function mockSelect(result: { data: unknown; error: unknown }) {
    const single = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    return select;
  }

  it('reads the three columns and maps the streak reminder one', async () => {
    const select = mockSelect({ data: { quiet_gym_alerts_opted_out: false, class_reminder_opted_out: true, streak_reminder_opted_out: true }, error: null });
    await expect(getMemberPreferences('m1')).resolves.toEqual({ quietGymAlertsOptedOut: false, classReminderOptedOut: true, streakReminderOptedOut: true });
    expect(select).toHaveBeenCalledWith('quiet_gym_alerts_opted_out, class_reminder_opted_out, streak_reminder_opted_out');
  });

  it('returns null on an error', async () => {
    mockSelect({ data: null, error: { code: 'PGRST116' } });
    await expect(getMemberPreferences('m1')).resolves.toBeNull();
  });
});

describe('getStreakReminderHour', () => {
  it('returns the hour for a whole hour from 0 to 23', async () => {
    rpc.mockResolvedValue({ data: 18, error: null });
    await expect(getStreakReminderHour()).resolves.toBe(18);
    expect(rpc).toHaveBeenCalledWith('my_streak_reminder_hour');
    rpc.mockResolvedValue({ data: 0, error: null });
    await expect(getStreakReminderHour()).resolves.toBe(0);
  });

  it('returns null for -1, 24, 18.5, a string, an error and a thrown call', async () => {
    for (const data of [-1, 24, 18.5, '18', null]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getStreakReminderHour()).resolves.toBeNull();
    }
    rpc.mockResolvedValue({ data: 18, error: { message: 'boom' } });
    await expect(getStreakReminderHour()).resolves.toBeNull();
    rpc.mockRejectedValue(new Error('network'));
    await expect(getStreakReminderHour()).resolves.toBeNull();
  });
});
