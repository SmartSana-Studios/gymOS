import { describe, expect, it } from 'vitest';

import {
  buildRewardsView,
  chooseCounter,
  isDormant,
  validityDays,
  type LoyaltySnapshot,
  type RewardsData,
} from './rewards';

function snapshot(over: Partial<LoyaltySnapshot> = {}): LoyaltySnapshot {
  return {
    enabled: true,
    guestStamps: 3,
    subscriberStamps: 1,
    guestThreshold: 5,
    renewalThreshold: 3,
    rewardDays: 30,
    guestWindowDays: 90,
    subscriberWindowDays: 120,
    freeSessions: [],
    paidSessions: [],
    ...over,
  };
}

function data(over: Partial<RewardsData> = {}, loyalty: Partial<LoyaltySnapshot> = {}): RewardsData {
  return {
    loyalty: snapshot(loyalty),
    grants: [],
    rewardEvent: null,
    latestSubscription: null,
    scope: 'u.g',
    ...over,
  };
}

const seen = new Set<string>();
const TODAY = '2026-10-13';

describe('counter choice', () => {
  it('guest counter for pay-per-session or no plan, subscriber otherwise', () => {
    expect(chooseCounter(null)).toBe('guest');
    expect(chooseCounter('pay_per_session')).toBe('guest');
    expect(chooseCounter('monthly')).toBe('subscriber');
    expect(isDormant(null)).toBe(false);
    expect(isDormant('pay_per_session')).toBe(false);
    expect(isDormant('monthly')).toBe(true);
  });
});

describe('buildRewardsView', () => {
  it('guest mid-program: counter, footnote with the RPC window, no rows', () => {
    const v = buildRewardsView(data(), 'pay_per_session', seen)!;
    expect(v.progress).toMatchObject({ counter: 'guest', current: 3, total: 5, display: 'segments' });
    expect(v.footnote).toEqual({ kind: 'guest', windowDays: 90 });
    expect(v.rows).toEqual([]);
    expect(v.headline).toBeNull();
  });

  it('subscriber: renewal counter with reward days, guest counter hidden', () => {
    const v = buildRewardsView(data(), 'monthly', seen)!;
    expect(v.progress).toMatchObject({ counter: 'subscriber', current: 1, total: 3, rewardDays: 30 });
    expect(v.footnote).toEqual({ kind: 'subscriber', windowDays: null });
  });

  it('chart above 12 is a continuous bar', () => {
    const v = buildRewardsView(data({}, { guestThreshold: 20, guestStamps: 4 }), null, seen)!;
    expect(v.progress).toMatchObject({ display: 'bar', total: 20, current: 4 });
    const at12 = buildRewardsView(data({}, { guestThreshold: 12 }), null, seen)!;
    expect(at12.progress?.display).toBe('segments');
  });

  it('free session earned: headline once per unseen id, validity from the grant row', () => {
    const d = data(
      { grants: [{ id: 'f1', createdAt: '2026-10-01T00:00:00Z', usableUntil: '2026-11-30T00:00:00Z' }] },
      { freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] },
    );
    const first = buildRewardsView(d, 'pay_per_session', seen)!;
    expect(first.headline).toEqual({ grantIds: ['f1'], validityDays: 60 });
    expect(first.rows[0]).toMatchObject({ kind: 'free', dormant: false });
    expect(buildRewardsView(d, 'pay_per_session', new Set(['f1']))!.headline).toBeNull();
  });

  it('storage failure (null seen set) shows no headline', () => {
    const d = data(
      { grants: [{ id: 'f1', createdAt: '2026-10-01T00:00:00Z', usableUntil: '2026-11-30T00:00:00Z' }] },
      { freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] },
    );
    expect(buildRewardsView(d, 'pay_per_session', null)!.headline).toBeNull();
  });

  it('free session on a monthly plan is dormant', () => {
    const v = buildRewardsView(data({}, { freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] }), 'monthly', seen)!;
    expect(v.rows[0]).toMatchObject({ kind: 'free', dormant: true });
  });

  it('program off with a free session: rows only, no progress or footnote', () => {
    const v = buildRewardsView(
      data({}, { enabled: false, freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] }),
      'pay_per_session',
      seen,
    )!;
    expect(v.progress).toBeNull();
    expect(v.footnote).toBeNull();
    expect(v.rows).toHaveLength(1);
  });

  it('program off, nothing held (or only paid rows): no card', () => {
    expect(buildRewardsView(data({}, { enabled: false }), null, seen)).toBeNull();
    expect(
      buildRewardsView(data({}, { enabled: false, paidSessions: [{ id: 'p1', usableUntil: '2026-11-30T00:00:00Z' }] }), null, seen),
    ).toBeNull();
  });

  it('null data (suspended gym / RPC error): no card', () => {
    expect(buildRewardsView(null, null, seen)).toBeNull();
  });

  it('paid rows come soonest first, after free rows', () => {
    const v = buildRewardsView(
      data({}, {
        paidSessions: [
          { id: 'p2', usableUntil: '2026-11-20T00:00:00Z' },
          { id: 'p1', usableUntil: '2026-11-10T00:00:00Z' },
        ],
        freeSessions: [{ id: 'f1', usableUntil: '2026-12-01T00:00:00Z' }],
      }),
      null,
      seen,
    )!;
    expect(v.rows.map((r) => r.id)).toEqual(['f1', 'p1', 'p2']);
  });

  it('free-days line only while the event matches the latest subscription', () => {
    const base = {
      rewardEvent: { subscriptionId: 's2', rewardDays: 30 },
      latestSubscription: { id: 's2', expiryDate: '2026-12-31' },
    };
    expect(buildRewardsView(data(base), 'monthly', seen, TODAY)!.freeDays).toEqual({
      days: 30,
      expiryDate: '2026-12-31',
    });
    const renewed = { ...base, latestSubscription: { id: 's3', expiryDate: '2027-01-31' } };
    expect(buildRewardsView(data(renewed), 'monthly', seen, TODAY)!.freeDays).toBeNull();
  });

  it('free-days line goes once the subscription has lapsed, stays on its expiry day', () => {
    const base = {
      rewardEvent: { subscriptionId: 's2', rewardDays: 30 },
      latestSubscription: { id: 's2', expiryDate: '2026-12-31' },
    };
    expect(buildRewardsView(data(base), 'monthly', seen, '2026-12-31')!.freeDays).not.toBeNull();
    expect(buildRewardsView(data(base), 'monthly', seen, '2027-01-01')!.freeDays).toBeNull();
  });

  it('program off with a free session held: no free-days line', () => {
    const v = buildRewardsView(
      data(
        {
          rewardEvent: { subscriptionId: 's2', rewardDays: 30 },
          latestSubscription: { id: 's2', expiryDate: '2026-12-31' },
        },
        { enabled: false, freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] },
      ),
      'pay_per_session',
      seen,
      TODAY,
    )!;
    expect(v.freeDays).toBeNull();
    expect(v.rows).toHaveLength(1);
  });

  it('enabled with null thresholds: no progress or footnote, held rows still shown', () => {
    const rows = { freeSessions: [{ id: 'f1', usableUntil: '2026-11-30T00:00:00Z' }] };
    const guest = buildRewardsView(data({}, { guestThreshold: null, ...rows }), null, seen)!;
    expect(guest.progress).toBeNull();
    expect(guest.footnote).toBeNull();
    expect(guest.rows).toHaveLength(1);
    const noRenewal = buildRewardsView(data({}, { renewalThreshold: null, ...rows }), 'monthly', seen)!;
    expect(noRenewal.progress).toBeNull();
    const noDays = buildRewardsView(data({}, { rewardDays: null, ...rows }), 'monthly', seen)!;
    expect(noDays.progress).toBeNull();
    expect(noDays.rows).toHaveLength(1);
  });

  it('enabled with null thresholds and nothing held: view has nothing to render', () => {
    const v = buildRewardsView(data({}, { guestThreshold: null }), null, seen)!;
    expect(v.progress).toBeNull();
    expect(v.rows).toEqual([]);
    expect(v.freeDays).toBeNull();
    expect(v.headline).toBeNull();
  });

  it('clamps a counter above its threshold; zero reward days is not a line', () => {
    const v = buildRewardsView(data({}, { guestStamps: 9, guestThreshold: 5 }), null, seen)!;
    expect(v.progress).toMatchObject({ current: 5, total: 5 });
    const zero = buildRewardsView(
      data({
        rewardEvent: { subscriptionId: 's2', rewardDays: 0 },
        latestSubscription: { id: 's2', expiryDate: '2026-12-31' },
      }),
      'monthly',
      seen,
      TODAY,
    )!;
    expect(zero.freeDays).toBeNull();
  });

  it('a grant whose id is not a held free session never earns a headline', () => {
    const d = data({ grants: [{ id: 'gone', createdAt: '2026-10-01T00:00:00Z', usableUntil: '2026-11-30T00:00:00Z' }] });
    expect(buildRewardsView(d, 'pay_per_session', seen)!.headline).toBeNull();
  });

  it('shows the read-time (already reset) counter as given', () => {
    const v = buildRewardsView(data({}, { guestStamps: 0 }), null, seen)!;
    expect(v.progress?.current).toBe(0);
  });
});

describe('validityDays', () => {
  it('rounds to whole days', () => {
    expect(validityDays('2026-10-01T00:00:00Z', '2026-11-30T00:00:05Z')).toBe(60);
    expect(validityDays('bad', 'x')).toBe(0);
  });
});
