import { describe, expect, it } from 'vitest';

import {
  collapseDenials,
  gymLocalDay,
  homeSessionsOrFilter,
  isHomeActivityPayment,
  resolveReceiptSessionDates,
  isChargedMember,
  isSessionDenial,
  mergeDenials,
  resolveRefusal,
  resolveSessionsLine,
  shouldShowOfflineVerify,
  type ChargingContext,
} from './sessionState';

const charged: ChargingContext = {
  chargingEnabled: true,
  planType: 'pay_per_session',
  planPrice: 1000,
  planCurrency: 'XAF',
  subscriptionStatus: 'active',
  timezone: 'Africa/Douala',
};

describe('resolveRefusal', () => {
  it('returns session_required for a charged, non-expired member', () => {
    expect(resolveRefusal(charged)).toBe('session_required');
    expect(resolveRefusal({ ...charged, subscriptionStatus: 'grace_period' })).toBe('session_required');
  });
  it('stays expired when the subscription is expired or none', () => {
    expect(resolveRefusal({ ...charged, subscriptionStatus: 'expired' })).toBe('expired');
    expect(resolveRefusal({ ...charged, subscriptionStatus: 'none' })).toBe('expired');
    expect(resolveRefusal({ ...charged, subscriptionStatus: null })).toBe('expired');
  });
  it('stays expired for exempt members', () => {
    expect(resolveRefusal(null)).toBe('expired');
    expect(resolveRefusal({ ...charged, chargingEnabled: false })).toBe('expired');
    expect(resolveRefusal({ ...charged, planType: 'monthly' })).toBe('expired');
    expect(resolveRefusal({ ...charged, planPrice: 0 })).toBe('expired');
    expect(isChargedMember({ ...charged, planPrice: null })).toBe(false);
  });
  it('records a sync denial only for a charged, non-expired member', () => {
    expect(isSessionDenial(charged)).toBe(true);
    expect(isSessionDenial({ ...charged, subscriptionStatus: 'expired' })).toBe(false);
    expect(isSessionDenial({ ...charged, chargingEnabled: false })).toBe(false);
    expect(isSessionDenial(null)).toBe(false);
  });
  it('shows offline verification only for charged non-expired members', () => {
    expect(shouldShowOfflineVerify(charged)).toBe(true);
    expect(shouldShowOfflineVerify({ ...charged, chargingEnabled: false })).toBe(false);
  });
});

describe('resolveSessionsLine', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  it('counts usable sessions and finds the soonest lapse', () => {
    const line = resolveSessionsLine(
      [
        { usableUntil: '2026-10-18T00:00:00Z', consumedAt: null, coveredDay: null, voidedAt: null },
        { usableUntil: '2026-10-15T00:00:00Z', consumedAt: null, coveredDay: null, voidedAt: null },
        { usableUntil: '2026-10-01T00:00:00Z', consumedAt: null, coveredDay: null, voidedAt: null },
        { usableUntil: '2026-10-20T00:00:00Z', consumedAt: null, coveredDay: null, voidedAt: '2026-10-11T00:00:00Z' },
      ],
      'Africa/Douala',
      now,
    );
    expect(line.usableCount).toBe(2);
    expect(line.soonestUsableUntil).toBe('2026-10-15T00:00:00Z');
    expect(line.tone).toBe('neutral');
  });
  it('is info when there is no usable session', () => {
    const line = resolveSessionsLine([], null, now);
    expect(line.tone).toBe('info');
    expect(line.usableCount).toBe(0);
  });
  it('is success when a session covers the gym-local day', () => {
    const line = resolveSessionsLine(
      [{ usableUntil: '2026-10-15T00:00:00Z', consumedAt: '2026-10-12T08:00:00Z', coveredDay: '2026-10-12', voidedAt: null }],
      'Africa/Douala',
      now,
    );
    expect(line.coveredToday).toBe(true);
    expect(line.tone).toBe('success');
    expect(line.usableCount).toBe(0);
  });
  it('buckets the gym-local day by timezone', () => {
    const at = new Date('2026-10-12T23:30:00Z');
    expect(gymLocalDay(at, 'Africa/Douala')).toBe('2026-10-13');
    expect(gymLocalDay(at, 'UTC')).toBe('2026-10-12');
    expect(gymLocalDay(at, 'Not/AZone')).toBe('2026-10-12');
  });
});

describe('denials', () => {
  it('collapses to the latest with a +N more count', () => {
    expect(collapseDenials([])).toBeNull();
    const c = collapseDenials([
      { scanId: 'a', scannedAt: '2026-10-10T10:00:00Z' },
      { scanId: 'b', scannedAt: '2026-10-11T10:00:00Z' },
      { scanId: 'c', scannedAt: '2026-10-09T10:00:00Z' },
    ]);
    expect(c?.latest.scanId).toBe('b');
    expect(c?.more).toBe(2);
  });
  it('merges without duplicating scan ids', () => {
    const merged = mergeDenials(
      [{ scanId: 'a', scannedAt: 'x' }],
      [
        { scanId: 'a', scannedAt: 'x' },
        { scanId: 'b', scannedAt: 'y' },
      ],
    );
    expect(merged.map((d) => d.scanId)).toEqual(['a', 'b']);
  });
});

describe('homeSessionsOrFilter', () => {
  it('keeps usable-now rows and the gym-local covered day', () => {
    const now = new Date('2026-10-12T23:30:00Z');
    expect(homeSessionsOrFilter(now, 'Africa/Douala')).toBe(
      'and(consumed_at.is.null,usable_until.gt.2026-10-12T23:30:00.000Z),covered_day.eq.2026-10-13',
    );
  });
});

describe('isHomeActivityPayment', () => {
  it('drops unconfirmed and flagged session payments only', () => {
    expect(isHomeActivityPayment({ purpose: 'session', status: 'verified' })).toBe(true);
    expect(isHomeActivityPayment({ purpose: 'session', status: 'processing' })).toBe(false);
    expect(isHomeActivityPayment({ purpose: 'session', status: 'flagged' })).toBe(false);
    expect(isHomeActivityPayment({ purpose: 'subscription', status: 'flagged' })).toBe(true);
  });
});

describe('resolveReceiptSessionDates', () => {
  const row = { usable_until: '2026-10-19T00:00:00Z', consumed_at: null, covered_day: null, voided_at: null };

  it('shows use-by for an unused session', () => {
    expect(resolveReceiptSessionDates(row)).toEqual({ usableUntil: row.usable_until, coveredDay: null });
  });

  it('shows the covered day once consumed', () => {
    expect(resolveReceiptSessionDates({ ...row, consumed_at: '2026-10-13T08:00:00Z', covered_day: '2026-10-13' })).toEqual({
      usableUntil: row.usable_until,
      coveredDay: '2026-10-13',
    });
  });

  it('shows neither date for a voided session, consumed or not', () => {
    const voided = { ...row, voided_at: '2026-10-14T00:00:00Z' };
    expect(resolveReceiptSessionDates(voided)).toEqual({ usableUntil: null, coveredDay: null });
    expect(
      resolveReceiptSessionDates({ ...voided, consumed_at: '2026-10-13T08:00:00Z', covered_day: '2026-10-13' }),
    ).toEqual({ usableUntil: null, coveredDay: null });
    expect(resolveReceiptSessionDates(null)).toEqual({ usableUntil: null, coveredDay: null });
  });
});
