import { isGymSuspendedError } from '@gymos/types';

import { supabase } from '@/lib/supabase';

/** Story 30.7 (FR-229; AD-53): mobile service-layer wrapper over acknowledge_milestone(p_milestone) (0189_milestones_celebration.sql), plus the one read
 * the celebration screen makes for the gym's own name and logo. Follows engagement.ts's typed-result-union, never-throw shape. The RPC resolves the
 * caller on the server and takes only the milestone number: no member id. It acknowledges that milestone and every lower one the member has not
 * acknowledged yet, so the screen calls it once, for the highest number it showed. */

export type AcknowledgeMilestoneResult =
  /** The server accepted the call: the milestone is acknowledged (now or earlier), or the member does not hold it (nothing to acknowledge). */
  | { status: 'success' }
  /** The gym is not active (42501 with the `is not active` phrase): retry once the gym is back. */
  | { status: 'gym_suspended' }
  /** `retryable: false` is a refusal that no retry can change (a caller that is not a live member, 42501; a number that is not a milestone, 22023). */
  | { status: 'error'; retryable: boolean };

/** Acknowledges the milestone the member was shown. Never throws. */
export async function acknowledgeMilestone(milestone: number): Promise<AcknowledgeMilestoneResult> {
  try {
    const { error } = await supabase.rpc('acknowledge_milestone', { p_milestone: milestone });
    if (!error) return { status: 'success' };
    if (isGymSuspendedError(error)) return { status: 'gym_suspended' };
    if (error.code === '42501' || error.code === '22023') return { status: 'error', retryable: false };
    return { status: 'error', retryable: true };
  } catch {
    return { status: 'error', retryable: true };
  }
}

export interface GymBranding {
  /** Null when the name cannot be read and none is on hand from an earlier read in this session. */
  name: string | null;
  /** Null when there is no logo or it cannot be read: the screen omits it. */
  logoUrl: string | null;
}

// The last good name per gym in this app session only (the app has no branding cache): a failed read falls back to it, so the card can still name the
// gym after a flaky second read. Never persisted.
const lastGoodName = new Map<string, string>();

/** The member's own gym's name and logo, read by gym id: a member of two gyms can read both rows, and an unfiltered single-row read would then fail and
 * leave the card blank (the 30.6 lesson). Never throws; a failure omits the logo and falls back to the last good name, or null. */
export async function getGymBranding(gymId: string): Promise<GymBranding> {
  try {
    const { data, error } = await supabase.from('gyms').select('name, logo_url').eq('id', gymId).maybeSingle();
    if (error || !data) return { name: lastGoodName.get(gymId) ?? null, logoUrl: null };
    const name = typeof data.name === 'string' && data.name.trim() !== '' ? data.name : null;
    if (name) lastGoodName.set(gymId, name);
    const logoUrl = typeof data.logo_url === 'string' && data.logo_url.trim() !== '' ? data.logo_url : null;
    return { name: name ?? lastGoodName.get(gymId) ?? null, logoUrl };
  } catch {
    return { name: lastGoodName.get(gymId) ?? null, logoUrl: null };
  }
}
