import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { BADGE_CODES, getMyBadges, parseBadges } from './badges';

beforeEach(() => {
  rpc.mockReset();
});

function rows(over: Record<string, Record<string, unknown>> = {}) {
  const base: Record<string, Record<string, unknown>> = {
    first_visit: { earned: true, earned_on: '2026-10-14', silent: false, visits_remaining: null, weeks_progress: null },
    visits_7: { earned: false, earned_on: null, silent: null, visits_remaining: 5, weeks_progress: null },
    visits_30: { earned: false, earned_on: null, silent: null, visits_remaining: 28, weeks_progress: null },
    visits_100: { earned: false, earned_on: null, silent: null, visits_remaining: 98, weeks_progress: null },
    four_weeks: { earned: false, earned_on: null, silent: null, visits_remaining: null, weeks_progress: 2 },
  };
  return BADGE_CODES.map((code) => ({ code, ...base[code], ...(over[code] ?? {}) }));
}

describe('parseBadges', () => {
  it('reads five rows in shelf order into the camel-case shape', () => {
    const parsed = parseBadges(rows());
    expect(parsed).toHaveLength(5);
    expect(parsed?.[0]).toEqual({ code: 'first_visit', earned: true, earnedOn: '2026-10-14', silent: false, visitsRemaining: null, weeksProgress: null });
    expect(parsed?.[1]).toMatchObject({ code: 'visits_7', earned: false, earnedOn: null, silent: false, visitsRemaining: 5 });
    expect(parsed?.[4]).toMatchObject({ code: 'four_weeks', weeksProgress: 2 });
  });

  it('a silent (release back-fill) badge is read exactly like any earned badge', () => {
    expect(parseBadges(rows({ first_visit: { silent: true } }))?.[0]).toMatchObject({ earned: true, earnedOn: '2026-10-14', silent: true });
  });

  it.each([
    ['not an array', {}],
    ['four rows', rows().slice(0, 4)],
    ['six rows', [...rows(), rows()[0]]],
    ['rows out of shelf order', [...rows().slice(1), rows()[0]]],
    ['an unknown code', rows().map((r, i) => (i === 2 ? { ...r, code: 'visits_31' } : r))],
    ['a non-boolean earned', rows({ visits_7: { earned: 'yes' } })],
    ['a malformed date', rows({ first_visit: { earned_on: '14 Oct' } })],
    ['a negative remaining', rows({ visits_7: { visits_remaining: -1 } })],
    ['a fractional progress', rows({ four_weeks: { weeks_progress: 1.5 } })],
    ['a non-object row', [...rows().slice(0, 4), null]],
  ])('refuses %s', (_name, data) => {
    expect(parseBadges(data)).toBeNull();
  });
});

describe('getMyBadges', () => {
  it('calls the read with no argument (no member id to forge) and returns the rows', async () => {
    rpc.mockResolvedValue({ data: rows(), error: null });
    const result = await getMyBadges();
    expect(rpc).toHaveBeenCalledWith('get_my_badges');
    expect(result.status).toBe('success');
  });

  it('no row at all (not a live member of an active gym) is unavailable', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getMyBadges()).toEqual({ status: 'unavailable' });
  });

  it('a server error, a malformed answer and a throw are errors, never exceptions', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'x' } });
    expect(await getMyBadges()).toEqual({ status: 'error' });
    rpc.mockResolvedValue({ data: [{ code: 'first_visit' }], error: null });
    expect(await getMyBadges()).toEqual({ status: 'error' });
    rpc.mockRejectedValue(new Error('offline'));
    expect(await getMyBadges()).toEqual({ status: 'error' });
  });
});
