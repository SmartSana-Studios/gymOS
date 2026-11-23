import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildHomeCardView,
  gateFromOutcome,
  monthOfEngagement,
  monthsFromToday,
  planHomeLoad,
  readHomeStanding,
  standingFromRows,
  writeHomeStanding,
  type HomeCardView,
  type HomeLoad,
} from '@/lib/leaderboardView';
import { readEngagementCache, type EngagementLoadOutcome } from '@/lib/weeklyRing';
import { getGymLeaderboard } from '@/services/leaderboard';

export interface HomeLeaderboard {
  view: HomeCardView;
  /** Reads the member's own standing for Home; call it once per Home focus and per pull to refresh, with the promise of the engagement read the ring
   * card is making (this card never reads the engagement row itself). Never throws. */
  loadForHome: (userId: string, gymId: string, isCurrent: () => boolean, engagementRead: Promise<EngagementLoadOutcome | null>) => Promise<void>;
  /** The error card was tapped: read again. */
  retry: () => void;
}

/** Story 30.6 (MA-09 N3): the Home Leaderboard card's data flow. It shows the member's OWN standing and nothing else: the one `gym_leaderboard`
 * call is made for the gym's current month (built from the server's gym-local today, never the phone, taken from the engagement read Home already makes
 * for the ring card: `my_engagement()` is the heaviest read of the epic, so it is not read twice) and only the member's own row and the server's
 * `ranked_total` are kept. Every decision (may the board be called, what to draw otherwise) is `planHomeLoad` in lib/leaderboardView.ts: a dark area
 * calls no leaderboard function and draws nothing, and a device copy is shown only for the month of the row on hand. A member who has not chosen on the
 * notice still sees their own rank here (the server sends their label as 'Anonymous' and this card never shows a label). Best effort: it never trips
 * Home's own load error. */
export function useHomeLeaderboard(): HomeLeaderboard {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'fr' ? 'fr' : 'en';
  const [load, setLoad] = useState<HomeLoad>({ kind: 'hidden' });
  const loadRef = useRef<HomeLoad>({ kind: 'hidden' });
  const lastRef = useRef<{ userId: string; gymId: string; engagementRead: Promise<EngagementLoadOutcome | null> } | null>(null);
  const seqRef = useRef(0);

  const commit = useCallback((next: HomeLoad) => {
    loadRef.current = next;
    setLoad(next);
  }, []);

  const loadForHome = useCallback(
    async (userId: string, gymId: string, isCurrent: () => boolean, engagementRead: Promise<EngagementLoadOutcome | null>) => {
      lastRef.current = { userId, gymId, engagementRead };
      const seq = ++seqRef.current;
      const canCommit = () => seq === seqRef.current && isCurrent();
      try {
        const cached = await readHomeStanding(userId, gymId);
        if (!canCommit()) return;
        // Nothing is drawn (no skeleton either) until the engagement read says the area is on: a dark area stays exactly as it was.
        const outcome = await engagementRead;
        if (!canCommit()) return;
        const gate = gateFromOutcome(outcome);
        // The month of the row on hand: the live row's, or, when the read failed, the device copy's.
        let month: string | null = null;
        if (outcome && outcome.kind === 'row') month = monthOfEngagement(outcome.engagement);
        else if (gate === 'unknown') {
          const copy = await readEngagementCache(userId, gymId);
          if (!canCommit()) return;
          month = monthOfEngagement(copy ? copy.engagement : null);
        }
        const plan = planHomeLoad({ gate, cached, month });
        if (!plan.call) {
          commit(plan.show ?? { kind: 'hidden' });
          return;
        }
        if (loadRef.current.kind === 'hidden' || loadRef.current.kind === 'error') commit({ kind: 'loading' });
        const board = outcome && outcome.kind === 'row' ? monthsFromToday(outcome.engagement.gymToday).current : null;
        const result = board ? await getGymLeaderboard(board) : null;
        if (!canCommit()) return;
        const standing = result && result.status === 'success' ? standingFromRows(result.rows) : null;
        if (standing && board) {
          const now = Date.now();
          commit({ kind: 'ready', standing, fromCache: false, updatedAtMs: now });
          void writeHomeStanding(userId, gymId, standing, now, board);
        } else if (result && result.status === 'unavailable') {
          commit({ kind: 'hidden' });
        } else {
          commit(plan.fallback);
        }
      } catch {
        if (canCommit()) commit({ kind: 'hidden' });
      }
    },
    [commit],
  );

  const retry = useCallback(() => {
    const last = lastRef.current;
    // A retry asks the board again with the engagement read of the load that failed (the error card only exists after the area was known to be on).
    if (last) void loadForHome(last.userId, last.gymId, () => true, last.engagementRead);
  }, [loadForHome]);

  useEffect(() => {
    return () => {
      seqRef.current += 1;
    };
  }, []);

  const view = useMemo(() => buildHomeCardView({ load, t, language }), [load, t, language]);
  return { view, loadForHome, retry };
}
