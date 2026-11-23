import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { getMyFirstVisitDay, getMyVisitDays, parseVisitDays } from './visitDays';

beforeEach(() => rpc.mockReset());

describe('parseVisitDays', () => {
  it('maps rows and a NULL milestone', () => {
    expect(parseVisitDays([{ visit_day: '2026-11-03', milestone: null }, { visit_day: '2026-11-10', milestone: 7 }])).toEqual([
      { visitDay: '2026-11-03', milestone: null },
      { visitDay: '2026-11-10', milestone: 7 },
    ]);
  });
  it('treats an absent milestone as null', () => {
    expect(parseVisitDays([{ visit_day: '2026-11-03' }])).toEqual([{ visitDay: '2026-11-03', milestone: null }]);
  });
  it('accepts an empty list', () => {
    expect(parseVisitDays([])).toEqual([]);
  });
  it('refuses a malformed row, a non-array and a bad date', () => {
    expect(parseVisitDays(null)).toBeNull();
    expect(parseVisitDays({ visit_day: '2026-11-03' })).toBeNull();
    expect(parseVisitDays([null])).toBeNull();
    expect(parseVisitDays([{ visit_day: '3 Nov', milestone: null }])).toBeNull();
    expect(parseVisitDays([{ visit_day: '2026-11-03', milestone: 'seven' }])).toBeNull();
    expect(parseVisitDays([{ visit_day: '2026-11-03', milestone: 1.5 }])).toBeNull();
  });
});

describe('getMyVisitDays', () => {
  it('calls the RPC with the month and returns the days', async () => {
    rpc.mockResolvedValue({ data: [{ visit_day: '2026-11-03', milestone: null }], error: null });
    await expect(getMyVisitDays('2026-11-01')).resolves.toEqual({ status: 'success', days: [{ visitDay: '2026-11-03', milestone: null }] });
    expect(rpc).toHaveBeenCalledWith('my_visit_days', { p_month: '2026-11-01' });
  });
  it('returns success with no days for a month without visits', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getMyVisitDays('2026-10-01')).resolves.toEqual({ status: 'success', days: [] });
  });
  it('maps invalid_month by code and by message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_month' } });
    await expect(getMyVisitDays('2026-11-15')).resolves.toEqual({ status: 'invalid_month' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_month' } });
    await expect(getMyVisitDays('2026-11-15')).resolves.toEqual({ status: 'invalid_month' });
  });
  it('maps any other error, a malformed row and a throw to error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(getMyVisitDays('2026-11-01')).resolves.toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: [{ visit_day: 'x' }], error: null });
    await expect(getMyVisitDays('2026-11-01')).resolves.toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(getMyVisitDays('2026-11-01')).resolves.toEqual({ status: 'error' });
  });
});

describe('getMyFirstVisitDay', () => {
  it('returns the date, or null when there is none', async () => {
    rpc.mockResolvedValueOnce({ data: '2026-02-28', error: null });
    await expect(getMyFirstVisitDay()).resolves.toEqual({ status: 'success', day: '2026-02-28' });
    expect(rpc).toHaveBeenCalledWith('my_first_visit_day');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getMyFirstVisitDay()).resolves.toEqual({ status: 'success', day: null });
  });
  it('maps an error, a malformed value and a throw to error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(getMyFirstVisitDay()).resolves.toEqual({ status: 'error' });
    rpc.mockResolvedValueOnce({ data: 'yesterday', error: null });
    await expect(getMyFirstVisitDay()).resolves.toEqual({ status: 'error' });
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(getMyFirstVisitDay()).resolves.toEqual({ status: 'error' });
  });
});
