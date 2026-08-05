import { memberPreferencesUpdateSchema, type MemberPreferencesUpdateInput } from '@gymos/types';

import { supabase } from '@/lib/supabase';

export interface MemberPreferences {
  quietGymAlertsOptedOut: boolean;
  classReminderOptedOut: boolean;
}

/** Story 6.4 AC #2/#3. Never-throws service-function discipline, same as
 * checkin.ts/pushTokens.ts -- `null` signals "load failed" to the caller,
 * which must treat a missing row the same as any other load failure
 * (profile.tsx's existing `loadError` handling), not silently render both
 * toggles as unset. A missing row should not normally happen post-Task-1's
 * backfill+trigger, but PGRST116 (no row) is still folded into the same
 * null-return path as any other error. */
export async function getMemberPreferences(memberId: string): Promise<MemberPreferences | null> {
  try {
    const { data, error } = await supabase
      .from('member_preferences')
      .select('quiet_gym_alerts_opted_out, class_reminder_opted_out')
      .eq('member_id', memberId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[notifications] getMemberPreferences failed', error);
    }
    if (error || !data) return null;

    return {
      quietGymAlertsOptedOut: data.quiet_gym_alerts_opted_out,
      classReminderOptedOut: data.class_reminder_opted_out,
    };
  } catch (err) {
    console.error('[notifications] getMemberPreferences failed', err);
    return null;
  }
}

/** Story 6.4 AC #3. `.select()` + row-count check (Story 2.7's review-fixed
 * discipline, reused verbatim in profile.tsx's `handleSaveProfile`) -- a
 * zero-row update returns `error: null` under PostgREST and must not be
 * treated as success. Returns `false` on any failure path (including a
 * failed schema parse), `true` only when exactly one row came back. */
export async function updateMemberPreferences(
  memberId: string,
  patch: MemberPreferencesUpdateInput,
): Promise<boolean> {
  const parsed = memberPreferencesUpdateSchema.safeParse(patch);
  if (!parsed.success) return false;

  try {
    const update: Record<string, boolean> = {};
    if (parsed.data.quietGymAlertsOptedOut !== undefined) {
      update.quiet_gym_alerts_opted_out = parsed.data.quietGymAlertsOptedOut;
    }
    if (parsed.data.classReminderOptedOut !== undefined) {
      update.class_reminder_opted_out = parsed.data.classReminderOptedOut;
    }

    const { data, error } = await supabase
      .from('member_preferences')
      .update(update)
      .eq('member_id', memberId)
      .select('member_id');

    if (error) {
      console.error('[notifications] updateMemberPreferences failed', error);
    }
    return !error && !!data && data.length === 1;
  } catch (err) {
    console.error('[notifications] updateMemberPreferences failed', err);
    return false;
  }
}
