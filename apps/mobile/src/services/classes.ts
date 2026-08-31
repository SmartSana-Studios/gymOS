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

// ============================================================================
// Story 12.4: member-facing list reads backing the Classes tab
// (list_bookable_class_sessions()/list_my_class_bookings(), 0078 migration).
// Follows payments.ts's loadPaymentsPage() exact `T[] | null` contract
// (`null` = real load error for the caller to show a retry state; `[]` =
// legitimately empty) -- not checkin.ts's best-effort-swallow-to-`[]`
// contract above -- the Classes tab itself needs a real error/retry state
// (mirrors history/index.tsx), unlike Home's best-effort widgets.
// ============================================================================

export interface BookableClassSession {
  classSessionId: string;
  className: string;
  description: string | null;
  coachName: string;
  scheduledAt: string;
  capacity: number;
  bookedCount: number;
  myBookingId: string | null;
}

interface BookableClassSessionRow {
  class_session_id: string;
  class_name: string;
  description: string | null;
  coach_name: string;
  scheduled_at: string;
  capacity: number;
  booked_count: number;
  my_booking_id: string | null;
}

/** Lists upcoming, bookable class sessions for the caller's own gym via
 * list_bookable_class_sessions() -- a SECURITY DEFINER RPC, since a plain
 * scoped read can't aggregate every member's bookings on a session (RLS
 * only ever returns the caller's own rows) or read a coach's name
 * (member_read_gym_staff_members deliberately excludes coach-role rows). */
export async function listBookableClassSessions(): Promise<BookableClassSession[] | null> {
  try {
    const { data, error } = await supabase.rpc('list_bookable_class_sessions');
    if (error || !data) return null;

    const rows = data as unknown as BookableClassSessionRow[];
    return rows.map((row) => ({
      classSessionId: row.class_session_id,
      className: row.class_name,
      description: row.description,
      coachName: row.coach_name,
      scheduledAt: row.scheduled_at,
      capacity: row.capacity,
      bookedCount: row.booked_count,
      myBookingId: row.my_booking_id,
    }));
  } catch {
    return null;
  }
}

export interface MyClassBooking {
  bookingId: string;
  className: string;
  scheduledAt: string;
  canCancel: boolean;
}

interface MyClassBookingRow {
  booking_id: string;
  class_name: string;
  scheduled_at: string;
  can_cancel: boolean;
}

/** Lists the caller's own upcoming class bookings via
 * list_my_class_bookings() -- `can_cancel` is computed server-side against
 * the same cutoff formula cancel_class_booking() itself enforces, so the
 * client never needs its own read access to
 * gyms.class_booking_cancellation_cutoff_minutes or duplicated cutoff
 * math. */
export async function listMyClassBookings(): Promise<MyClassBooking[] | null> {
  try {
    const { data, error } = await supabase.rpc('list_my_class_bookings');
    if (error || !data) return null;

    const rows = data as unknown as MyClassBookingRow[];
    return rows.map((row) => ({
      bookingId: row.booking_id,
      className: row.class_name,
      scheduledAt: row.scheduled_at,
      canCancel: row.can_cancel,
    }));
  } catch {
    return null;
  }
}
