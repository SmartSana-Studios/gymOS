import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { mapGrantRows, mapLatestSubscription, mapRewardEvent, parseEffectiveLoyalty } from './loyalty';

describe('parseEffectiveLoyalty', () => {
  it('maps the RPC object', () => {
    const parsed = parseEffectiveLoyalty({
      enabled: true,
      guest_stamps: 3,
      subscriber_stamps: 1,
      guest_threshold: 5,
      renewal_threshold: 3,
      reward_days: 30,
      guest_window_days: 90,
      subscriber_window_days: 120,
      free_sessions: [{ id: 'a', usable_until: '2026-11-01T00:00:00Z' }, { id: 5 }],
      paid_sessions: [{ id: 'b', usable_until: '2026-11-02T00:00:00Z' }],
    });
    expect(parsed).toMatchObject({
      enabled: true,
      guestStamps: 3,
      guestThreshold: 5,
      rewardDays: 30,
      guestWindowDays: 90,
      freeSessions: [{ id: 'a', usableUntil: '2026-11-01T00:00:00Z' }],
      paidSessions: [{ id: 'b', usableUntil: '2026-11-02T00:00:00Z' }],
    });
  });

  it('returns null for JSON null and malformed payloads', () => {
    expect(parseEffectiveLoyalty(null)).toBeNull();
    expect(parseEffectiveLoyalty('null')).toBeNull();
    expect(parseEffectiveLoyalty([])).toBeNull();
    expect(parseEffectiveLoyalty({ guest_stamps: 1 })).toBeNull();
  });

  it('defaults missing counters and thresholds safely', () => {
    expect(parseEffectiveLoyalty({ enabled: false })).toMatchObject({
      guestStamps: 0,
      guestThreshold: null,
      freeSessions: [],
      paidSessions: [],
    });
  });
});

describe('row mapping', () => {
  it('maps grant rows and drops malformed ones', () => {
    expect(
      mapGrantRows([
        { id: 'g1', created_at: 'c', usable_until: 'u' },
        { id: 'g2', created_at: null, usable_until: 'u' },
      ]),
    ).toEqual([{ id: 'g1', createdAt: 'c', usableUntil: 'u' }]);
    expect(mapGrantRows(null)).toEqual([]);
  });

  it('maps the reward event details', () => {
    expect(mapRewardEvent({ details: { subscription_id: 's1', reward_days: 30 } })).toEqual({
      subscriptionId: 's1',
      rewardDays: 30,
    });
    expect(mapRewardEvent({ details: {} })).toBeNull();
    expect(mapRewardEvent(null)).toBeNull();
  });

  it('maps the latest subscription', () => {
    expect(mapLatestSubscription({ id: 's1', expiry_date: '2026-12-31' })).toEqual({ id: 's1', expiryDate: '2026-12-31' });
    expect(mapLatestSubscription({ id: 's1' })).toBeNull();
  });
});

describe('getOwnLoyalty', () => {
  type Result = { data: unknown; error: unknown };
  function chain(result: Result, log: string[], table: string) {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'is', 'gt', 'order', 'limit']) {
      c[m] = (...args: unknown[]) => {
        log.push(`${table}.${m}(${args.map(String).join(',')})`);
        return c;
      };
    }
    c.maybeSingle = async () => result;
    c.then = (resolve: (r: Result) => unknown) => resolve(result);
    return c;
  }

  async function run(opts: {
    rpc?: Result;
    grants?: Result;
    event?: Result;
    sub?: Result;
    member?: Result;
    userId?: string | null;
  }) {
    const log: string[] = [];
    const ok = (data: unknown): Result => ({ data, error: null });
    const tables: Record<string, Result> = {
      guest_sessions: opts.grants ?? ok([]),
      loyalty_events: opts.event ?? ok(null),
      subscriptions: opts.sub ?? ok(null),
      members: opts.member ?? ok({ gym_id: 'g1' }),
    };
    const supa = {
      rpc: async () => opts.rpc ?? ok({ enabled: true }),
      auth: {
        getSession: async () => ({
          data: { session: opts.userId === null ? null : { user: { id: opts.userId ?? 'u1' } } },
        }),
      },
      from: (t: string) => chain(tables[t], log, t),
    };
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({ supabase: supa }));
    const mod = await import('./loyalty');
    return { result: await mod.getOwnLoyalty('m1'), log };
  }

  it('null on RPC error or JSON null', async () => {
    expect((await run({ rpc: { data: null, error: { message: 'x' } } })).result).toBeNull();
    expect((await run({ rpc: { data: null, error: null } })).result).toBeNull();
  });

  it('filters grants to unconsumed, unvoided, loyalty-granted rows', async () => {
    const { log } = await run({});
    const g = log.filter((l) => l.startsWith('guest_sessions.')).join(' ');
    expect(g).toContain('not(loyalty_grant_id,is,null)');
    expect(g).toContain('is(consumed_at,null)');
    expect(g).toContain('is(voided_at,null)');
    expect(g).toContain('gt(usable_until,');
  });

  it('scope is userId.gymId, null when either is missing', async () => {
    expect((await run({})).result?.scope).toBe('u1.g1');
    expect((await run({ userId: null })).result?.scope).toBeNull();
    expect((await run({ member: { data: null, error: { message: 'x' } } })).result?.scope).toBeNull();
  });

  it('a supplementary read failure drops only its own fact', async () => {
    const { result } = await run({
      grants: { data: null, error: { message: 'x' } },
      sub: { data: { id: 's1', expiry_date: '2026-12-31' }, error: null },
    });
    expect(result?.grants).toEqual([]);
    expect(result?.latestSubscription).toEqual({ id: 's1', expiryDate: '2026-12-31' });
  });
});
