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
