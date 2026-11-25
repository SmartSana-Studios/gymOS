import { useEffect, useState } from 'react';

import { celebrationMonth } from '@/lib/celebrationView';
import { getMyEngagement } from '@/services/engagement';
import { getGymBranding, type GymBranding } from '@/services/milestones';
import { getMyVisitDays } from '@/services/visitDays';

export interface ShareContext {
  /** The gym's name and logo, or null until read (or when it cannot be): the image is then made without them. */
  branding: GymBranding | null;
  /** The member's own current month (the first of the gym-local month) and its lit days, or null: where the card has no room, offline, or a failed read. */
  calendar: { month: string; litDays: string[] } | null;
}

/** Story 31.3 (FR-231): the local data a badge's share image is composed from, read once while `enabled` (a badge sheet is open). Three plain reads of
 * the member's own data (the gym row, `my_engagement` for the gym-local day, `my_visit_days` for the month); a failure leaves that part out and never
 * blocks the share, which works offline. Nothing here is sent anywhere by sharing. */
export function useShareContext(enabled: boolean, gymId: string | null, wantCalendar: boolean): ShareContext {
  const [branding, setBranding] = useState<GymBranding | null>(null);
  const [calendar, setCalendar] = useState<ShareContext['calendar']>(null);

  // Everything held belongs to one open sheet of one gym: it is cleared (in the cleanup) when the sheet closes or the gym changes, before any new read, so a later sheet
  // never shows (or shares) the previous one's gym or month. A rejected read is the same as no read.
  useEffect(() => {
    if (!enabled || !gymId) return;
    let cancelled = false;
    void getGymBranding(gymId)
      .then((read) => {
        if (!cancelled) setBranding(read);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setBranding(null);
    };
  }, [enabled, gymId]);

  useEffect(() => {
    if (!enabled || !wantCalendar) return;
    let cancelled = false;
    void (async () => {
      const engagement = await getMyEngagement();
      const month = engagement.status === 'success' ? celebrationMonth(engagement.engagement.gymToday) : null;
      if (!month) return;
      const days = await getMyVisitDays(month);
      if (!cancelled && days.status === 'success') setCalendar({ month, litDays: days.days.map((d) => d.visitDay) });
    })().catch(() => {});
    return () => {
      cancelled = true;
      setCalendar(null);
    };
  }, [enabled, gymId, wantCalendar]);

  return { branding, calendar: wantCalendar ? calendar : null };
}
