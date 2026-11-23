import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  celebrationDue,
  chooseMilestone,
  markShownAcked,
  pendingFromOutcome,
  readShown,
  retryAcknowledge,
  writeShown,
  type CloseDeps,
} from '@/lib/celebrationView';
import type { EngagementLoadOutcome } from '@/lib/weeklyRing';
import { acknowledgeMilestone } from '@/services/milestones';

/** Home pushes the celebration about this long after it has painted. */
export const PUSH_DELAY_MS = 600;

const DEPS: CloseDeps = { writeShown, markShownAcked, acknowledge: acknowledgeMilestone };

interface Candidate {
  milestone: number;
  today: string;
}

export interface HomeCelebration {
  /** Called once per Home focus and per pull to refresh, with the promise of the engagement read the ring card is making (this hook never reads the
   * engagement row itself). Never throws. */
  loadForHome: (userId: string, gymId: string, isCurrent: () => boolean, engagementRead: Promise<EngagementLoadOutcome | null>) => Promise<void>;
}

/** Story 30.7 (MA-20): the Home side of the milestone celebration. From a LIVE engagement row only (never the device copy, never a dark or failed
 * read) it picks the highest pending milestone the device has not shown (lib/celebrationView.ts), and once Home has painted and is focused it pushes
 * `/celebration/<n>` about 600 ms later. The timer is cancelled on blur and on unmount. The same load silently re-acknowledges a milestone that was
 * shown but whose server call did not land, while connected (and again on reconnect). Best effort: it never trips Home's own load error.
 * `ready` is Home's own state: painted, no load error, and the plan is not expired. */
export function useHomeCelebration(isConnected: boolean, ready: boolean): HomeCelebration {
  const router = useRouter();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [focused, setFocused] = useState(false);
  const seqRef = useRef(0);
  const connectedRef = useRef(isConnected);
  const lastRef = useRef<{ userId: string; gymId: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const retry = useCallback(async (userId: string, gymId: string) => {
    if (!connectedRef.current) return;
    await retryAcknowledge(DEPS, userId, gymId, await readShown(userId, gymId));
  }, []);

  const loadForHome = useCallback(
    async (userId: string, gymId: string, isCurrent: () => boolean, engagementRead: Promise<EngagementLoadOutcome | null>) => {
      lastRef.current = { userId, gymId };
      const seq = ++seqRef.current;
      const canCommit = () => seq === seqRef.current && isCurrent();
      try {
        const outcome = await engagementRead;
        if (!canCommit()) return;
        const pending = pendingFromOutcome(outcome);
        const shown = await readShown(userId, gymId);
        if (!canCommit()) return;
        const chosen = chooseMilestone(pending, shown);
        setCandidate(chosen !== null && outcome && outcome.kind === 'row' ? { milestone: chosen, today: outcome.engagement.gymToday } : null);
        void retry(userId, gymId);
      } catch {
        if (canCommit()) setCandidate(null);
      }
    },
    [retry],
  );

  // A phone that comes back online retries a shown milestone whose call did not land.
  useEffect(() => {
    const wasConnected = connectedRef.current;
    connectedRef.current = isConnected;
    const last = lastRef.current;
    if (isConnected && !wasConnected && last) void retry(last.userId, last.gymId);
  }, [isConnected, retry]);

  const milestone = candidate?.milestone ?? null;
  const today = candidate?.today ?? null;
  useEffect(() => {
    if (!celebrationDue({ milestone, today, ready, focused }) || milestone === null) return;
    const timer = setTimeout(() => {
      setCandidate(null);
      // The generated typed-routes file only knows a route after the dev server has run once; the cast keeps tsc green before and after.
      router.push({ pathname: '/celebration/[milestoneId]', params: { milestoneId: String(milestone), today } } as unknown as Href);
    }, PUSH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [milestone, today, ready, focused, router]);

  useEffect(() => {
    return () => {
      seqRef.current += 1;
    };
  }, []);

  return { loadForHome };
}
