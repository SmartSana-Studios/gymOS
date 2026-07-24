import { supabase } from '@/lib/supabase';

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

export interface RecordCheckInResult {
  status: 'success' | 'already_checked_in' | 'error';
  checkedInAt?: string;
}

/** Records an attendance event for the caller's own member/gym via the
 * check_in() RPC (0023_member_check_in_one_open_session_enforcement.sql) --
 * a SECURITY DEFINER function, not a raw INSERT, since the "is there an open
 * session, is it stale, insert" sequence must be atomic. Story 3.4 Scope
 * Note #3. */
export async function recordCheckIn(): Promise<RecordCheckInResult> {
  try {
    const { data, error } = await supabase.rpc('check_in');
    if (error) {
      if (error.message?.includes('already has an open check-in')) return { status: 'already_checked_in' };
      // 23505 on idx_attendance_events_one_open_per_member: the race-window
      // backstop for the same outcome, not the primary path.
      if (error.code === '23505' && error.message?.includes('idx_attendance_events_one_open_per_member')) {
        return { status: 'already_checked_in' };
      }
      return { status: 'error' };
    }
    return { status: 'success', checkedInAt: data.checked_in_at };
  } catch {
    return { status: 'error' };
  }
}
