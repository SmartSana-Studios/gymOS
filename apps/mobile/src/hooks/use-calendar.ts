import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { addMonths, canGoNext, canGoPrev, earliestMonth, monthStartOf } from '@/lib/calendarGrid';
import {
  buildCalendarView,
  cacheWithMonth,
  readyFromCache,
  readyFromServer,
  readCalendarCache,
  writeCalendarFirstVisitDay,
  writeCalendarMonth,
  type CalendarCache,
  type CalendarView,
  type MonthData,
} from '@/lib/calendarView';
import { getOfflineCheckIns } from '@/lib/sqlite';
import { readEngagementCache, TICK_MS, type EngagementSnapshot } from '@/lib/weeklyRing';
import { getMyEngagement } from '@/services/engagement';
import { getMyFirstVisitDay, getMyVisitDays } from '@/services/visitDays';

export interface Calendar {
  view: CalendarView;
  /** Pull to refresh is running. */
  refreshing: boolean;
  /** Reloads the engagement row, the first visit day and the month on screen. Never throws. */
  refresh: () => Promise<void>;
  /** Moves a month back (-1) or forward (+1); ignored past the chevron bounds. */
  shift: (delta: -1 | 1) => void;
  /** Taps a cell: moves the focus ring and the detail line. */
  selectDay: (date: string) => void;
}

const NO_SCANS: string[] = [];

/** Story 30.5 (MA-18): the calendar's data flow. Today comes from `my_engagement()` (`getMyEngagement()` only, never `openEngagement()`: opening the
 * calendar settles nothing), the visit days from `my_visit_days(month)`, the chevron bound from `my_first_visit_day()`. Every month loaded is kept on
 * the device per member and gym; a failed or offline load falls back to it. The month on screen starts at the gym's current month and is never
 * remembered. Best effort: nothing here throws. The hours left tick once a minute while the screen is focused. */
export function useCalendar(isConnected: boolean, pendingCheckInCount: number, userId: string | null, gymId: string | null): Calendar {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'fr' ? 'fr' : 'en';

  const [month, setMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EngagementSnapshot | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(true);
  const [monthData, setMonthData] = useState<MonthData>({ kind: 'loading' });
  const [firstVisitDay, setFirstVisitDay] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [queuedScanTimes, setQueuedScanTimes] = useState<string[]>([]);
  const [deviceNowMs, setDeviceNowMs] = useState(() => Date.now());

  const monthRef = useRef<string | null>(null);
  const monthDataRef = useRef<MonthData>({ kind: 'loading' });
  const snapshotRef = useRef<EngagementSnapshot | null>(null);
  const firstVisitRef = useRef<string | null>(null);
  // A failed first-visit read with no stored bound: the previous-month chevron cannot know where to stop, so the failure outlives a month load that
  // succeeds (the banner stays, and a pull to refresh retries) instead of silently looking like "no history".
  const firstVisitFailedRef = useRef(false);
  const cacheRef = useRef<CalendarCache | null>(null);
  const connectedRef = useRef(isConnected);
  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);
  // Each load takes a number; only the latest commits, so a slow answer for a month the member has already left cannot overwrite the one on screen.
  const allSeq = useRef(0);
  const monthSeq = useRef(0);

  const commitMonthData = useCallback((next: MonthData) => {
    monthDataRef.current = next;
    setMonthData(next);
  }, []);

  const loadMonth = useCallback(
    async (target: string, keepOnScreen = false) => {
      const seq = ++monthSeq.current;
      const current = () => seq === monthSeq.current && monthRef.current === target;
      // A pull to refresh keeps the month that is showing; a move to another month shows the skeleton until it arrives.
      if (!(keepOnScreen && monthDataRef.current.kind === 'ready')) commitMonthData({ kind: 'loading' });
      if (userId && gymId && !cacheRef.current) cacheRef.current = await readCalendarCache(userId, gymId);
      if (!current()) return;
      const cached = readyFromCache(cacheRef.current, target);
      const fallback = (): MonthData => cached ?? (connectedRef.current ? { kind: 'error' } : { kind: 'unavailable' });

      // Offline, the network call would only wait to fail: the device's copy is the answer.
      if (!connectedRef.current) {
        commitMonthData(fallback());
        return;
      }
      try {
        const result = await getMyVisitDays(target);
        if (!current()) return;
        if (result.status === 'success') {
          const ready = readyFromServer(result.days);
          setLoadFailed(firstVisitFailedRef.current);
          commitMonthData(ready);
          if (userId && gymId && ready.kind === 'ready') {
            if (cacheRef.current) cacheRef.current = cacheWithMonth(cacheRef.current, target, ready.days, ready.milestones ?? {});
            void writeCalendarMonth(userId, gymId, target, ready.days, ready.milestones ?? {});
          }
        } else {
          setLoadFailed(true);
          commitMonthData(fallback());
        }
      } catch {
        if (!current()) return;
        setLoadFailed(true);
        commitMonthData(fallback());
      }
    },
    [userId, gymId, commitMonthData],
  );

  const loadAll = useCallback(async () => {
    const seq = ++allSeq.current;
    const latest = () => seq === allSeq.current;
    try {
      if (userId && gymId && !cacheRef.current) cacheRef.current = await readCalendarCache(userId, gymId);
      if (!latest()) return;
      if (cacheRef.current && firstVisitRef.current === null) {
        firstVisitRef.current = cacheRef.current.firstVisitDay;
        setFirstVisitDay(cacheRef.current.firstVisitDay);
      }

      const [engagement, first] = connectedRef.current ? await Promise.all([getMyEngagement(), getMyFirstVisitDay()]) : [null, null];
      if (!latest()) return;
      const receivedAt = Date.now();
      setDeviceNowMs(receivedAt);

      let next: EngagementSnapshot | null = null;
      let failed = false;
      if (engagement && engagement.status === 'success') {
        next = { engagement: engagement.engagement, fetchedAtDeviceMs: receivedAt, fromCache: false };
      } else if (engagement && engagement.status === 'unavailable') {
        // Not a live member (or the epoch is dark for this gym): there is no calendar to draw, and no device copy is better than the server's word.
        next = null;
      } else {
        // Offline or a failed read: Home's last good row places today.
        failed = engagement !== null;
        const cached = userId && gymId ? await readEngagementCache(userId, gymId) : null;
        if (!latest()) return;
        if (cached && cached.engagement.enabled) next = { engagement: cached.engagement, fetchedAtDeviceMs: cached.fetchedAtDeviceMs, fromCache: true };
        // A failed refresh with no device copy keeps the live row already drawn (a first load with nothing still ends at null).
        else next = snapshotRef.current;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setEngagementLoading(false);

      if (first && first.status === 'success') {
        firstVisitRef.current = first.day;
        firstVisitFailedRef.current = false;
        setFirstVisitDay(first.day);
        if (userId && gymId) void writeCalendarFirstVisitDay(userId, gymId, first.day);
      } else if (first) {
        failed = true;
        firstVisitFailedRef.current = firstVisitRef.current === null;
      }
      setLoadFailed(failed);

      if (!next || !next.engagement.enabled) return;
      // The screen opens on the gym's current month, and a refresh keeps the month the member is looking at.
      const kept = monthRef.current;
      const target = kept ?? monthStartOf(next.engagement.gymToday);
      monthRef.current = target;
      setMonth(target);
      await loadMonth(target, kept === target);
    } catch {
      // Best-effort: whatever is on screen stays.
      if (latest()) setEngagementLoading(false);
    }
  }, [userId, gymId, loadMonth]);

  // One load per focus (and again when the phone comes back online); the hours left tick once a minute while focused.
  useFocusEffect(
    useCallback(() => {
      void loadAll();
      setDeviceNowMs(Date.now());
      const interval = setInterval(() => setDeviceNowMs(Date.now()), TICK_MS);
      return () => clearInterval(interval);
    }, [loadAll]),
  );
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) void loadAll();
    wasConnected.current = isConnected;
  }, [isConnected, loadAll]);
  // The reconnect load can finish before the queued scans have synced; once the queue drains while connected, read today again so the day lights and
  // the at-risk hint goes.
  const lastPendingCount = useRef(pendingCheckInCount);
  useEffect(() => {
    if (isConnected && pendingCheckInCount < lastPendingCount.current) void loadAll();
    lastPendingCount.current = pendingCheckInCount;
  }, [pendingCheckInCount, isConnected, loadAll]);

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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  const shift = useCallback(
    (delta: -1 | 1) => {
      const row = snapshotRef.current?.engagement;
      const from = monthRef.current;
      if (!row || !from) return;
      const currentMonth = monthStartOf(row.gymToday);
      const allowed = delta === 1 ? canGoNext(from, currentMonth) : canGoPrev(from, earliestMonth(firstVisitRef.current, currentMonth));
      if (!allowed) return;
      const target = addMonths(from, delta);
      monthRef.current = target;
      setMonth(target);
      setSelected(null);
      void loadMonth(target);
    },
    [loadMonth],
  );

  const selectDay = useCallback((date: string) => setSelected(date), []);

  const view = useMemo(
    () =>
      buildCalendarView({
        month,
        snapshot,
        engagementLoading,
        monthData,
        firstVisitDay,
        selected,
        offline,
        connected: isConnected,
        queuedScanTimes: offline ? queuedScanTimes : NO_SCANS,
        deviceNowMs,
        t,
        language,
      }),
    [month, snapshot, engagementLoading, monthData, firstVisitDay, selected, offline, isConnected, queuedScanTimes, deviceNowMs, t, language],
  );

  return { view, refreshing, refresh, shift, selectDay };
}
