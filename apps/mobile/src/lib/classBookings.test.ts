import { describe, expect, it } from 'vitest';

import { bookingRowState, upcomingClassesForHome } from './classBookings';

const b = (id: string, classCancelled: boolean, canCancel = true) => ({ bookingId: id, classCancelled, canCancel });

describe('bookingRowState', () => {
  it('shows a cancelled class as cancelled, whatever can_cancel says', () => {
    expect(bookingRowState({ classCancelled: true, canCancel: true })).toBe('cancelled');
    expect(bookingRowState({ classCancelled: true, canCancel: false })).toBe('cancelled');
  });

  it('keeps the cancel control and the closed state for a live class', () => {
    expect(bookingRowState({ classCancelled: false, canCancel: true })).toBe('cancellable');
    expect(bookingRowState({ classCancelled: false, canCancel: false })).toBe('cancellation_closed');
  });
});

describe('upcomingClassesForHome', () => {
  it('drops cancelled bookings before the limit, so they never take a slot', () => {
    const rows = [b('1', true), b('2', true), b('3', false), b('4', false), b('5', false)];
    expect(upcomingClassesForHome(rows, 3).map((r) => r.bookingId)).toEqual(['3', '4', '5']);
  });

  it('keeps the order and returns fewer than the limit when fewer remain', () => {
    expect(upcomingClassesForHome([b('1', false), b('2', true)], 3).map((r) => r.bookingId)).toEqual(['1']);
    expect(upcomingClassesForHome([], 3)).toEqual([]);
  });
});
