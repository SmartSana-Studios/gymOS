// Story 28.1: the readers carry the four cover fields; a consumed row with no covered day (a Single-use row) reads as used and never throws.
import { describe, expect, it } from 'vitest';

import { homeSessionsOrFilter, resolveReceiptSessionDates, resolveSessionsLine, type GuestSessionRow } from './sessionState';

const now = new Date('2026-11-19T10:00:00Z');
const later = '2026-11-25T10:00:00Z';

const wholeDay: GuestSessionRow = {
  usableUntil: later,
  consumedAt: '2026-11-19T08:00:00Z',
  coveredDay: '2026-11-19',
  voidedAt: null,
  validityMode: 'whole_day',
  coveredKind: 'day',
  coveredAttendanceId: null,
  coveredBookingId: null,
};

const visit: GuestSessionRow = {
  usableUntil: later,
  consumedAt: '2026-11-19T08:00:00Z',
  coveredDay: null,
  voidedAt: null,
  validityMode: 'single_use',
  coveredKind: 'visit',
  coveredAttendanceId: 'a1',
  coveredBookingId: null,
};

describe('resolveSessionsLine with the cover fields', () => {
  it('a whole_day row covered today reads as covered today', () => {
    expect(resolveSessionsLine([wholeDay], 'Africa/Douala', now)).toMatchObject({ tone: 'success', coveredToday: true, usableCount: 0 });
  });

  it('a consumed Single-use visit row (null coveredDay) is used: not covered today, not usable, and never throws', () => {
    const line = resolveSessionsLine([visit], 'Africa/Douala', now);
    expect(line).toEqual({ tone: 'info', usableCount: 0, soonestUsableUntil: null, coveredToday: false });
  });

  it('a consumed class row with no coveredDay is used too', () => {
    const cls: GuestSessionRow = { ...visit, coveredKind: 'class', coveredAttendanceId: null, coveredBookingId: 'b1' };
    expect(resolveSessionsLine([cls], 'Africa/Douala', now).coveredToday).toBe(false);
  });

  it('a Single-use row does not hide an unused session next to it', () => {
    const unused: GuestSessionRow = { usableUntil: later, consumedAt: null, coveredDay: null, voidedAt: null, validityMode: null, coveredKind: null };
    const line = resolveSessionsLine([visit, unused], 'Africa/Douala', now);
    expect(line).toMatchObject({ tone: 'neutral', usableCount: 1, soonestUsableUntil: later, coveredToday: false });
  });

  it('rows without the new fields (an older caller) still resolve', () => {
    const legacy: GuestSessionRow = { usableUntil: later, consumedAt: null, coveredDay: null, voidedAt: null };
    expect(resolveSessionsLine([legacy], 'Africa/Douala', now).usableCount).toBe(1);
  });
});

describe('homeSessionsOrFilter with Single-use rows', () => {
  it('is unchanged: usable rows plus the row covering the local day (a Single-use row has no covered_day to match)', () => {
    expect(homeSessionsOrFilter(now, 'Africa/Douala')).toBe(
      'and(consumed_at.is.null,usable_until.gt.2026-11-19T10:00:00.000Z),covered_day.eq.2026-11-19',
    );
  });
});

describe('resolveReceiptSessionDates with a Single-use row', () => {
  it('shows the consumed instant as the used-on date when there is no covered day', () => {
    const dates = resolveReceiptSessionDates({
      usable_until: later,
      consumed_at: '2026-11-19T08:00:00Z',
      covered_day: null,
      voided_at: null,
      validity_mode: 'single_use',
      covered_kind: 'visit',
      covered_attendance_id: 'a1',
      covered_booking_id: null,
    });
    expect(dates).toEqual({ usableUntil: later, coveredDay: '2026-11-19T08:00:00Z' });
  });

  it('a whole_day row still shows its covered day', () => {
    expect(
      resolveReceiptSessionDates({ usable_until: later, consumed_at: '2026-11-19T08:00:00Z', covered_day: '2026-11-19', voided_at: null }),
    ).toEqual({ usableUntil: later, coveredDay: '2026-11-19' });
  });
});
