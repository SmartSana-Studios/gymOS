import { supabase } from '@/lib/supabase';

export type OccupancyBand = 'low' | 'medium' | 'busy';

/** Story 3.6 Scope Note #2: calls `member_occupancy_band()` (0025 migration),
 * a SECURITY DEFINER RPC that computes the band entirely server-side -- the
 * raw checked-in count and gym capacity never reach this client, in any
 * form. `null` is an expected, non-error state (the gym hasn't configured a
 * capacity yet), distinct from `error` being set. No screen calls this
 * function in this story -- Story 3.7 (Member App Home Screen) is its first
 * consumer, matching `check_out()`'s own "ship now, unused until a later
 * story" precedent. */
export async function getOccupancyBand(): Promise<{ band: OccupancyBand | null; error: string | null }> {
  const { data, error } = await supabase.rpc('member_occupancy_band');
  if (error) {
    return { band: null, error: error.message };
  }
  return { band: (data as OccupancyBand | null) ?? null, error: null };
}
