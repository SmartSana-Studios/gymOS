import * as Crypto from 'expo-crypto';

import { isGymSuspendedError } from '@gymos/types';

import { supabase } from '@/lib/supabase';
import { deleteOfflineCheckIn, getOfflineCheckIns, insertOfflineCheckIn } from '@/lib/sqlite';

export interface ValidateGymTokenResult {
  matched: boolean;
  error: boolean;
}

/** Validates a scanned QR token against the caller's own gym. No app-level
 * gym_id filter is added -- the `"read own gym"` RLS policy
 * (0009_auth_hook_gym_claims.sql) already restricts the visible row to
 * `id = private.gym_id()`, so a token belonging to a different, real gym
 * and a token belonging to no gym at all are indistinguishable from this
 * session's point of view: both resolve to `matched: false`. Story 3.3
 * Scope Note #3. */
export async function validateGymToken(token: string): Promise<ValidateGymTokenResult> {
  try {
    const { data, error } = await supabase.from('gyms').select('id').eq('gym_token', token.trim()).maybeSingle();

    if (error) {
      return { matched: false, error: true };
    }
    return { matched: !!data, error: false };
  } catch {
    return { matched: false, error: true };
  }
}

export interface RecentCheckIn {
  id: string;
  checkedInAt: string;
  checkedOutAt: string | null;
}

/** Home screen's "recent activity" feed (Story 3.7 AC #3). Takes the
 * caller's own `members.id`, already resolved once by the caller (Home
 * screen's `loadHome`), rather than re-resolving it here -- avoids a second,
 * redundant round-trip to `members` for data the caller already has.
 * Selects the last `limit` `attendance_events` rows via the new
 * `member_read_own_attendance_events` RLS policy (0026 migration, Scope Note
 * #1) -- no SECURITY DEFINER RPC needed for a plain scoped read. Returns an
 * empty array on any failure: this is a best-effort, non-blocking feed, not
 * a load-blocking one. */
export async function getRecentCheckIns(memberId: string, limit: number): Promise<RecentCheckIn[]> {
  try {
    const { data, error } = await supabase
      .from('attendance_events')
      .select('id, checked_in_at, checked_out_at')
      .eq('member_id', memberId)
      .order('checked_in_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row) => ({ id: row.id, checkedInAt: row.checked_in_at, checkedOutAt: row.checked_out_at }));
  } catch {
    return [];
  }
}

export interface RecordCheckInResult {
  status: 'success' | 'already_checked_in' | 'expired' | 'gym_suspended' | 'error';
  checkedInAt?: string;
}

/** Records an attendance event for the caller's own member/gym via the
 * check_in() RPC (0023_member_check_in_one_open_session_enforcement.sql) --
 * a SECURITY DEFINER function, not a raw INSERT, since the "is there an open
 * session, is it stale, insert" sequence must be atomic. Story 3.4 Scope
 * Note #3. Story 3.8 adds the 'expired' outcome (0027's subscription-status
 * guard, AC #3). Story 4.6: check_in() no longer throws for the expired/
 * no-subscription case (a `raise exception` there would roll back the
 * front-desk alert row it needs to insert in the same transaction) -- it
 * returns a clean `{ data: null, error: null }` instead, so that outcome is
 * now detected via a null `data`, not a thrown error's message text. */
export async function recordCheckIn(): Promise<RecordCheckInResult> {
  try {
    const { data, error } = await supabase.rpc('check_in');
    if (error) {
      if (error.message?.includes('already has an open check-in')) return { status: 'already_checked_in' };
      // Story 11.8 AC #4: the suspension raise must reach the member as the
      // neutral copy, never as the generic 'check your connection' error --
      // it is not a connectivity failure and retrying immediately won't help.
      if (isGymSuspendedError(error)) return { status: 'gym_suspended' };
      // 23505 on idx_attendance_events_one_open_per_member: the race-window
      // backstop for the same outcome, not the primary path.
      if (error.code === '23505' && error.message?.includes('idx_attendance_events_one_open_per_member')) {
        return { status: 'already_checked_in' };
      }
      return { status: 'error' };
    }
    if (!data) return { status: 'expired' };
    return { status: 'success', checkedInAt: data.checked_in_at };
  } catch {
    return { status: 'error' };
  }
}

/** Story 3.9 AC #1: queues an offline check-in locally and returns
 * immediately -- no network call, no `await` on anything network-bound --
 * which is what makes the "success state is shown immediately" AC true.
 * `client_scan_id` doubles as the server-side idempotency key (Scope Note
 * #1/#3): a retried sync for the same queued record can never double-insert. */
export async function queueOfflineCheckIn(): Promise<{ id: string; scannedAt: string }> {
  const id = Crypto.randomUUID();
  const scannedAt = new Date().toISOString();
  await insertOfflineCheckIn(id, scannedAt);
  return { id, scannedAt };
}

/** Story 3.9 AC #2: replays every queued offline check-in, oldest-first,
 * against check_in(). Per-record outcome handling (Scope Note #4), each
 * independent -- one record's outcome must never stop processing the rest
 * of the batch:
 * - success -> delete from the local queue.
 * - 'already has an open check-in' -> leave queued; recoverable on a later
 *   sync pass once the pre-existing open session closes.
 * - the gym-suspended raise (Story 11.8's guard, 0090) -> leave queued. This
 *   scan happened while the gym was still active, and suspension is a
 *   billing state that is reversed the moment the Owner pays -- so retrying
 *   CAN fix it, which is exactly the test the branch below applies. Deleting
 *   here would silently destroy a legitimate attendance event with no
 *   user-visible error and no way to recover it after reinstatement.
 * - any other RPC error (expired, deactivated, permission denied, no member
 *   record) -> delete anyway, retrying can't fix these.
 * - a thrown/network exception -> leave queued, no deletion. */
export async function syncPendingCheckIns(): Promise<void> {
  let pending;
  try {
    pending = await getOfflineCheckIns();
  } catch (err) {
    console.error('[offline-sync] failed to read the local offline queue', err);
    return;
  }

  for (const record of pending) {
    try {
      const { error } = await supabase.rpc('check_in', {
        p_scanned_at: record.scannedAt,
        p_client_scan_id: record.id,
      });

      const recoverable =
        error?.message?.includes('already has an open check-in') || isGymSuspendedError(error);

      if (!error || !recoverable) {
        await deleteOfflineCheckIn(record.id);
      }
    } catch (err) {
      // Network/thrown exception: leave queued, retried on the next sync pass.
      console.error('[offline-sync] check_in RPC failed, record left queued for retry', err);
    }
  }
}
