import { supabase } from '@/lib/supabase';

/** Story 12.2: mobile service-layer wrapper over book_class_session()/
 * cancel_class_booking() (0058_class_booking_with_capacity_enforcement.sql).
 * Follows checkin.ts's exact typed-result-union, try/catch, never-throw
 * shape (AD-9's `{ data, error }` shape is the dashboard service-layer
 * convention, not this app's). This story ships zero UI (Story 12.4's
 * scope) -- these two action wrappers are the entire mobile deliverable. No
 * offline-queue plumbing here: AD-23 explicitly excludes class booking from
 * the mobile offline queue (its synchronous, row-locked capacity check has
 * no offline-queueable equivalent). */

export interface ClassBooking {
  id: string;
  classSessionId: string;
  memberId: string;
  createdAt: string;
}

interface ClassBookingRow {
  id: string;
  class_session_id: string;
  member_id: string;
  created_at: string;
}

function toClassBooking(row: ClassBookingRow): ClassBooking {
  return {
    id: row.id,
    classSessionId: row.class_session_id,
    memberId: row.member_id,
    createdAt: row.created_at,
  };
}

export type BookClassSessionResult =
  | { status: 'success'; booking: ClassBooking }
  | { status: 'full' }
  | { status: 'already_booked' }
  | { status: 'ineligible' }
  | { status: 'error' };

/** Books the caller's own member row into a class session via
 * book_class_session() -- a SECURITY DEFINER RPC, not a raw INSERT, since
 * the row-locked "count bookings, insert if under capacity" sequence must
 * be atomic (AD-21). */
export async function bookClassSession(classSessionId: string): Promise<BookClassSessionResult> {
  try {
    const { data, error } = await supabase.rpc('book_class_session', { p_class_session_id: classSessionId });
    if (error) {
      if (error.message?.includes('class is full')) return { status: 'full' };
      if (error.message?.includes('already booked this session')) return { status: 'already_booked' };
      // 23505 on idx_class_bookings_session_member: the race-window backstop
      // for the same outcome, not the primary path -- same dual-layer
      // pattern checkin.ts's own 23505 handling mirrors.
      if (error.code === '23505' && error.message?.includes('idx_class_bookings_session_member')) {
        return { status: 'already_booked' };
      }
      if (error.message?.includes('no active subscription')) return { status: 'ineligible' };
      return { status: 'error' };
    }
    if (!data) return { status: 'error' };
    return { status: 'success', booking: toClassBooking(data as ClassBookingRow) };
  } catch {
    return { status: 'error' };
  }
}

export type CancelClassBookingResult =
  | { status: 'success' }
  | { status: 'cutoff_passed' }
  | { status: 'not_found' }
  | { status: 'error' };

/** Cancels the caller's own booking via cancel_class_booking(). */
export async function cancelClassBooking(bookingId: string): Promise<CancelClassBookingResult> {
  try {
    const { error } = await supabase.rpc('cancel_class_booking', { p_booking_id: bookingId });
    if (error) {
      if (error.message?.includes('cancellation cutoff has passed')) return { status: 'cutoff_passed' };
      if (error.message?.includes('not found')) return { status: 'not_found' };
      return { status: 'error' };
    }
    return { status: 'success' };
  } catch {
    return { status: 'error' };
  }
}
