import { supabase } from '@/lib/supabase';

export type NotificationType = 'N-01' | 'N-02' | 'N-03' | 'N-04' | 'N-05' | 'N-06' | 'N-07';

export interface NotificationHistoryItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

/** Story 6.7. Review finding: this is the *entire* content of a dedicated
 * screen (unlike checkin.ts's getRecentCheckIns/payments.ts's
 * getRecentPayments, which are secondary feeds alongside a screen whose
 * primary load can still fail elsewhere), so it needs
 * notificationPreferences.ts's never-throws-returns-null discipline
 * instead: `null` signals "load failed" to the caller, distinguishable
 * from a genuinely empty `[]` history. */
export async function getNotificationHistory(
  memberId: string,
  limit = 50,
): Promise<NotificationHistoryItem[] | null> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, created_at, read_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return null;

    return data.map((row) => ({
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at,
    }));
  } catch {
    return null;
  }
}

/** Home screen's bell badge (AC #3). Same never-throws discipline as
 * getRecentCheckIns -- a failed count reads as "nothing unread" rather
 * than blocking Home's own load. */
export async function getUnreadNotificationCount(memberId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .is('read_at', null);

    if (error || count === null) return 0;
    return count;
  } catch {
    return 0;
  }
}

/** AC #5. `.select()` + row-count guard -- same zero-row-update-is-not-
 * success discipline as handleSaveProfile/updateMemberPreferences (a
 * zero-row update returns `error: null` under PostgREST). Returns `false`
 * on any failure path, `true` only when exactly one row came back. */
export async function markNotificationRead(notificationId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .select('id');

    return !error && !!data && data.length === 1;
  } catch {
    return false;
  }
}
