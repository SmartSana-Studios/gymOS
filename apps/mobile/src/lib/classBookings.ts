import type { MyClassBooking } from '@/services/classes';

/** Story 29.2 (FR-246, MA-16): what a row of "My Bookings" offers. A booking on a cancelled class stays on record and shows the neutral
 * "Cancelled" badge with no cancel control; otherwise the server's `can_cancel` decides between [Cancel] and "Cancellation closed". */
export type BookingRowState = 'cancelled' | 'cancellable' | 'cancellation_closed';

export function bookingRowState(booking: Pick<MyClassBooking, 'classCancelled' | 'canCancel'>): BookingRowState {
  if (booking.classCancelled) return 'cancelled';
  return booking.canCancel ? 'cancellable' : 'cancellation_closed';
}

/** Home's "Upcoming classes": a cancelled class is dropped BEFORE the limit, so a cancelled booking never takes a slot from a class that
 * will run. */
export function upcomingClassesForHome<T extends Pick<MyClassBooking, 'classCancelled'>>(bookings: readonly T[], limit: number): T[] {
  return bookings.filter((booking) => !booking.classCancelled).slice(0, limit);
}
