import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { setEngagementGateFromOutcome } from '@/lib/engagementGate';
import { getOfflineCheckIns } from '@/lib/sqlite';
import {
  buildHomeEngagementView,
  loadEngagement,
  readEngagementCache,
  SKELETON_MAX_MS,
  TICK_MS,
  writeEngagementCache,
  type EngagementLoadOutcome,
  type EngagementSnapshot,
  type HomeEngagementView,
} from '@/lib/weeklyRing';
import { getMyEngagement, openEngagement, type Engagement } from '@/services/engagement';
import { readDismissed, recordDismissed } from '@/services/shieldNotices';
import { markGoalHintSeen, readGoalHintSeen } from '@/services/weeklyGoal';

const NO_SCANS: string[] = [];

export interface HomeEngagement {
  view: HomeEngagementView;
  /** Story 31.4: the row behind `view` (live or the device copy), for the Home streak line's numbers; null when there is none. */
  engagement: Engagement | null;
  /** Reads the row (and settles once when it says so) for this member; call it once per Home focus and per pull to refresh. Never throws. Resolves to the
   * outcome of that read (or null when this call was superseded), which the Home leaderboard card reuses instead of reading the row a second time. */
  loadForHome: (userId: string, gymId: string, isCurrent: () => boolean) => Promise<EngagementLoadOutcome | null>;
  /** The member tapped the one-time default-goal hint. */
  dismissGoalHint: () => void;
  /** Story 31.1: the member dismissed a Shield notice row; its id is recorded on this device (per user and gym) and the row goes at once. */
  dismissShieldNotice: (id: string) => void;
}

/** Story 30.4: the Home "This week" data flow. The numbers are the server's (services/engagement.ts); this hook sequences the calls, keeps the last good
 * row on the device, runs the two-second skeleton window, ticks the clock once a minute while Home is focused, and reads the scans queued on this
 * device when the phone is offline. It is best-effort and never trips Home's own load error. */
export function useHomeEngagement(isConnected: boolean, pendingCheckInCount: number): HomeEngagement {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'fr' ? 'fr' : 'en';

  const [snapshot, setSnapshot] = useState<EngagementSnapshot | null>(null);
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skeletonExpired, setSkeletonExpired] = useState(false);
  const [cachedEnabled, setCachedEnabled] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [settleFailed, setSettleFailed] = useState(false);
  const [goalHintSeen, setGoalHintSeen] = useState(true);
  // Story 31.1: dismissed Shield notices and restored cards already shown; null until read, and null when storage cannot be read (fail closed).
  const [shieldSeen, setShieldSeen] = useState<ReadonlySet<string> | null>(null);
  const [queuedScanTimes, setQueuedScanTimes] = useState<string[]>([]);
  const [deviceNowMs, setDeviceNowMs] = useState(() => Date.now());

  const snapshotRef = useRef<EngagementSnapshot | null>(null);
  const userIdRef = useRef<string | null>(null);
  const gymIdRef = useRef<string | null>(null);
  const restoredRecordedRef = useRef<string | null>(null);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each loadForHome call takes a number; only the latest owns `busy` and the skeleton timer, so an older call finishing late can neither leave them
  // set nor clear a newer call's.
  const seqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
    };
  }, []);

  function commitSnapshot(next: EngagementSnapshot | null) {
    snapshotRef.current = next;
    setSnapshot(next);
  }

  const loadForHome = useCallback(async (userId: string, gymId: string, isCurrent: () => boolean): Promise<EngagementLoadOutcome | null> => {
    // A different member or gym is a different record: the restored card of the old one says nothing about the new one.
    if (userIdRef.current !== userId || gymIdRef.current !== gymId) restoredRecordedRef.current = null;
    userIdRef.current = userId;
    gymIdRef.current = gymId;
    const seq = ++seqRef.current;
    const latest = () => seq === seqRef.current;
    const canCommit = () => latest() && isCurrent();
    try {
      setBusy(true);
      setSkeletonExpired(false);
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
      skeletonTimerRef.current = setTimeout(() => {
        if (latest()) setSkeletonExpired(true);
      }, SKELETON_MAX_MS);

      // First load this session: the device cache decides whether a skeleton holds the place, and is what an offline start falls back to.
      const cached = snapshotRef.current ? null : await readEngagementCache(userId, gymId);
      if (!canCommit()) return null;
      if (!snapshotRef.current) setCachedEnabled(cached ? cached.engagement.enabled : null);

      void readGoalHintSeen(userId).then((seen) => {
        if (canCommit()) setGoalHintSeen(seen);
      });
      // Read at every load: a restored card recorded on the previous load is gone now.
      void readDismissed(userId, gymId).then((seen) => {
        // Merged with what is on screen: a dismissal made while this read was in flight must not come back.
        if (canCommit()) setShieldSeen((prev) => (seen === null ? null : new Set([...seen, ...(prev ?? [])])));
      });

      const outcome = await loadEngagement({ getMyEngagement, openEngagement });
      if (!canCommit()) return null;
      const receivedAt = Date.now();
      // The hours left are measured against the clock at this moment (the offset is taken from `receivedAt`), so the tick catches up with it now
      // instead of lagging up to a minute behind after a pull to refresh.
      setDeviceNowMs(receivedAt);

      // Story 31.4: the answer also moves the engagement gate (tab bar, Home streak line, Profile row); a failed read leaves it as it was.
      setEngagementGateFromOutcome(userId, gymId, outcome.kind);
      if (outcome.kind === 'row') {
        setDark(false);
        setLoadFailed(false);
        setSettleFailed(outcome.settleFailed);
        commitSnapshot({ engagement: outcome.engagement, fetchedAtDeviceMs: receivedAt, fromCache: false });
        void writeEngagementCache(userId, gymId, outcome.engagement, receivedAt);
      } else if (outcome.kind === 'dark') {
        setDark(true);
        setLoadFailed(false);
        setSettleFailed(false);
        commitSnapshot(null);
        if (outcome.engagement) void writeEngagementCache(userId, gymId, outcome.engagement, receivedAt);
      } else {
        // Offline or a server error: keep what is on screen; with nothing on screen, the last good row from this device, or the error card.
        setLoadFailed(true);
        if (!snapshotRef.current && cached) commitSnapshot({ engagement: cached.engagement, fetchedAtDeviceMs: cached.fetchedAtDeviceMs, fromCache: true });
      }
      return outcome;
    } catch {
      // Best-effort: whatever is on screen stays.
      return null;
    } finally {
      if (latest()) {
        if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
        setBusy(false);
      }
    }
  }, []);

  // The hours left are recomputed every minute while Home is focused, and once when it takes focus.
  useFocusEffect(
    useCallback(() => {
      setDeviceNowMs(Date.now());
      const interval = setInterval(() => setDeviceNowMs(Date.now()), TICK_MS);
      return () => clearInterval(interval);
    }, []),
  );

  const offline = !isConnected || loadFailed;

  // Scans queued on this device, read only while offline (the web build has no queue).
  useEffect(() => {
    if (!offline || !snapshot || Platform.OS === 'web') return;
    let cancelled = false;
    void getOfflineCheckIns()
      .then((scans) => {
        if (!cancelled) setQueuedScanTimes(scans.map((scan) => scan.scannedAt));
      })
      .catch(() => {
        if (!cancelled) setQueuedScanTimes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [offline, snapshot, pendingCheckInCount]);

  const dismissGoalHint = useCallback(() => {
    setGoalHintSeen(true);
    const userId = userIdRef.current;
    if (userId) void markGoalHintSeen(userId);
  }, []);

  const dismissShieldNotice = useCallback((id: string) => {
    setShieldSeen((prev) => (prev === null ? prev : new Set([...prev, id])));
    const userId = userIdRef.current;
    const gymId = gymIdRef.current;
    if (userId && gymId) void recordDismissed(userId, gymId, id);
  }, []);

  const view = useMemo(
    () =>
      buildHomeEngagementView({
        snapshot,
        dark,
        busy,
        skeletonExpired,
        cachedEnabled,
        loadFailed,
        offline,
        settleFailed,
        queuedScanTimes: offline ? queuedScanTimes : NO_SCANS,
        goalHintSeen,
        shieldSeen,
        deviceNowMs,
        t,
        language,
      }),
    [snapshot, dark, busy, skeletonExpired, cachedEnabled, loadFailed, offline, settleFailed, queuedScanTimes, goalHintSeen, shieldSeen, deviceNowMs, t, language],
  );

  // The one-time "you're back" card is recorded as shown the moment it is on screen: it stays for this render and the next load reads it as gone.
  const restoredId = view.kind === 'card' ? (view.shield.comeback?.restored?.id ?? null) : null;
  useEffect(() => {
    const userId = userIdRef.current;
    const gymId = gymIdRef.current;
    if (!restoredId || !userId || !gymId || restoredRecordedRef.current === restoredId) return;
    restoredRecordedRef.current = restoredId;
    void recordDismissed(userId, gymId, restoredId).then((stored) => {
      // A write that did not land must be tried again, not remembered as done.
      if (!stored && restoredRecordedRef.current === restoredId) restoredRecordedRef.current = null;
    });
  }, [restoredId]);

  return { view, engagement: snapshot ? snapshot.engagement : null, loadForHome, dismissGoalHint, dismissShieldNotice };
}
