import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  boardSource,
  buildLeaderboardView,
  decideToggle,
  gateFromResult,
  mayCallLeaderboard,
  mayKeepSettingsCopy,
  monthsFromToday,
  readLeaderboardCache,
  settingsAfterNotice,
  settingsAfterToggle,
  settingsFromDeviceCopy,
  writeLeaderboardBoard,
  writeLeaderboardSettings,
  type BoardData,
  type EngagementGate,
  type LeaderboardCache,
  type LeaderboardView,
  type NoticeChoice,
  type NoticeOutcome,
  type Tab,
} from '@/lib/leaderboardView';
import { readEngagementCache } from '@/lib/weeklyRing';
import { getMyEngagement } from '@/services/engagement';
import { getGymLeaderboard, getMyGymName, getMyLeaderboardSettings, setLeaderboardVisibility, type LeaderboardSettings } from '@/services/leaderboard';
import { useLeaderboardNotice } from '@/hooks/use-leaderboard-notice';

export interface Leaderboard {
  view: LeaderboardView;
  tab: Tab;
  refreshing: boolean;
  /** Reloads the settings and the board on screen. Never throws. */
  refresh: () => Promise<void>;
  selectTab: (tab: Tab) => void;
  /** The toggle of the visibility row (the stored choice flips; saved at once, optimistic, reverted on failure). */
  toggleVisibility: () => void;
  chooseNotice: (choice: NoticeChoice) => Promise<void>;
}

const LOADING: BoardData = { kind: 'loading' };

/** Story 30.6 (MA-19): the leaderboard screen's data flow. The two months come from the gym-local today of `my_engagement()` (or Home's device copy of
 * it), never from the phone. `gym_leaderboard` is NOT called until the settings say the notice has been chosen on: before that the screen shows the
 * notice alone, and a device copy of a board is never read before the choice (the copy is only ever written after it). Every label, rank, tie and total
 * is the server's; this hook sequences calls, keeps the last good board on the device, and updates the member's own settings after a choice. Best
 * effort: nothing here throws. */
export function useLeaderboard(isConnected: boolean, userId: string | null, gymId: string | null): Leaderboard {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'fr' ? 'fr' : 'en';

  const [tab, setTab] = useState<Tab>('current');
  const [gymName, setGymName] = useState<string | null>(null);
  const [settings, setSettings] = useState<LeaderboardSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [boards, setBoards] = useState<Record<Tab, BoardData>>({ current: LOADING, previous: LOADING });
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const tabRef = useRef<Tab>('current');
  const settingsRef = useRef<LeaderboardSettings | null>(null);
  const boardsRef = useRef<Record<Tab, BoardData>>({ current: LOADING, previous: LOADING });
  const monthsRef = useRef<{ current: string; previous: string } | null>(null);
  const cacheRef = useRef<LeaderboardCache | null>(null);
  const connectedRef = useRef(isConnected);
  const pendingRef = useRef(false);
  // The gate of the last engagement read; 'unknown' until one has been made, so nothing calls the board before the gate is known.
  const gateRef = useRef<EngagementGate>('unknown');
  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);
  const allSeq = useRef(0);
  const boardSeq = useRef<Record<Tab, number>>({ current: 0, previous: 0 });

  const commitSettings = useCallback((next: LeaderboardSettings | null) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const commitBoard = useCallback((which: Tab, next: BoardData) => {
    boardsRef.current = { ...boardsRef.current, [which]: next };
    setBoards(boardsRef.current);
  }, []);

  const loadBoard = useCallback(
    async (which: Tab, keepOnScreen = false) => {
      const seq = ++boardSeq.current[which];
      const latest = () => seq === boardSeq.current[which];
      const months = monthsRef.current;
      if (!months) {
        commitBoard(which, { kind: 'error' });
        return;
      }
      const month = months[which];
      if (!(keepOnScreen && boardsRef.current[which].kind === 'ready')) commitBoard(which, LOADING);
      const cached = cacheRef.current?.months[month];
      const fallback = (): BoardData =>
        cached ? { kind: 'ready', rows: cached.rows, fromCache: true, updatedAtMs: cached.updatedAtMs } : { kind: 'error' };
      // Offline, or with the area not known to be on (a dark or unknown gate), no leaderboard function is called: the device's copy is the answer.
      if (boardSource(gateRef.current, connectedRef.current) === 'copy') {
        commitBoard(which, fallback());
        return;
      }
      try {
        const result = await getGymLeaderboard(month);
        if (!latest()) return;
        if (result.status === 'success') {
          const now = Date.now();
          commitBoard(which, { kind: 'ready', rows: result.rows, fromCache: false, updatedAtMs: now });
          // Written only here, and loadBoard runs only once the notice is chosen on: a copy never exists before the choice.
          if (userId && gymId) {
            if (cacheRef.current) cacheRef.current = { ...cacheRef.current, months: { ...cacheRef.current.months, [month]: { rows: result.rows, updatedAtMs: now } } };
            void writeLeaderboardBoard(userId, gymId, month, result.rows, now);
          }
        } else {
          commitBoard(which, fallback());
        }
      } catch {
        if (latest()) commitBoard(which, fallback());
      }
    },
    [userId, gymId, commitBoard],
  );

  const loadAll = useCallback(async () => {
    const seq = ++allSeq.current;
    const latest = () => seq === allSeq.current;
    try {
      if (userId && gymId && !cacheRef.current) cacheRef.current = await readLeaderboardCache(userId, gymId);
      if (!latest()) return;
      const cachedSettings = cacheRef.current?.settings ?? null;
      const connected = connectedRef.current;

      let months: { current: string; previous: string } | null = null;
      let next: LeaderboardSettings | null = null;
      let dark = false;

      // The engagement row comes first and decides whether any leaderboard function may be called (mayCallLeaderboard): a dark area calls none.
      const engagement = connected ? await getMyEngagement() : null;
      if (!latest()) return;
      const gate = gateFromResult(engagement);
      gateRef.current = gate;
      if (connected && gymId) void getMyGymName(gymId).then((name) => name && latest() && setGymName(name));
      if (gate === 'open' && engagement && engagement.status === 'success') months = monthsFromToday(engagement.engagement.gymToday);
      else if (gate === 'dark') dark = true;
      else {
        // Offline, or the read failed: Home's device copy of the row places the months, and the device copy of the settings (written only once the notice
        // was chosen on) stands for them. No leaderboard function is called.
        const copy = userId && gymId ? await readEngagementCache(userId, gymId) : null;
        if (!latest()) return;
        months = copy && copy.engagement.enabled ? monthsFromToday(copy.engagement.gymToday) : null;
        next = months ? settingsFromDeviceCopy({ settings: cachedSettings, months: {} }) : null;
      }
      if (mayCallLeaderboard(gate)) {
        const live = await getMyLeaderboardSettings();
        if (!latest()) return;
        if (live.status === 'success') next = live.settings;
        else if (live.status === 'unavailable') dark = true;
        else next = settingsFromDeviceCopy({ settings: cachedSettings, months: {} });
      }

      if (dark) {
        months = null;
        next = null;
      }
      monthsRef.current = months;
      // A settings read that returns while a toggle save is pending must not undo the optimistic flip: the save's own result decides.
      if (pendingRef.current) next = settingsRef.current;
      // The copy of the settings is written only once the notice is chosen on (a copy implies it), and never from the unconfirmed optimistic value of a
      // pending save (its own result writes the copy).
      if (next && !pendingRef.current && mayKeepSettingsCopy(next) && userId && gymId) {
        void writeLeaderboardSettings(userId, gymId, { hidden: next.hidden, ownLabel: next.ownLabel });
        if (cacheRef.current) cacheRef.current = { ...cacheRef.current, settings: { hidden: next.hidden, ownLabel: next.ownLabel } };
      }
      commitSettings(next);
      setSettingsLoaded(true);

      if (next && next.noticeSeen) await loadBoard(tabRef.current, boardsRef.current[tabRef.current].kind === 'ready');
    } catch {
      if (latest()) setSettingsLoaded(true);
    }
  }, [userId, gymId, commitSettings, loadBoard]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll]),
  );
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) void loadAll();
    wasConnected.current = isConnected;
  }, [isConnected, loadAll]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  const selectTab = useCallback(
    (next: Tab) => {
      tabRef.current = next;
      setTab(next);
      if (settingsRef.current?.noticeSeen) void loadBoard(next, boardsRef.current[next].kind === 'ready');
    },
    [loadBoard],
  );

  const toggleVisibility = useCallback(() => {
    const current = settingsRef.current;
    if (!current || pendingRef.current || !connectedRef.current) return;
    const nextHidden = !current.hidden;
    // The notice is shown in place while it is unseen, so this toggle only exists after it was chosen on; the rule is still the shared one.
    if (decideToggle(nextHidden, current.noticeSeen) === 'openNotice') return;
    pendingRef.current = true;
    setVisibilityPending(true);
    commitSettings(settingsAfterToggle(current, nextHidden, true));
    void (async () => {
      try {
        const result = await setLeaderboardVisibility(nextHidden);
        const ok = result.status === 'success';
        // The save's own result decides: the new choice on success, the previous one (the optimistic flip reverted) on failure.
        const after = settingsAfterToggle(current, nextHidden, ok);
        commitSettings(after);
        if (ok) {
          if (userId && gymId && mayKeepSettingsCopy(after)) void writeLeaderboardSettings(userId, gymId, { hidden: after.hidden, ownLabel: after.ownLabel });
          // The member's own row carries the label as others see it: read the board again.
          await loadBoard(tabRef.current, true);
        }
      } finally {
        pendingRef.current = false;
        setVisibilityPending(false);
      }
    })();
  }, [userId, gymId, commitSettings, loadBoard]);

  const onNoticeResult = useCallback(
    async (choice: NoticeChoice, outcome: NoticeOutcome) => {
      const current = settingsRef.current;
      if (!current) return;
      // A written hide stands even when the mark failed (hidden and un-noticed, never named); the notice is chosen on only when the whole choice succeeded.
      const after = settingsAfterNotice(current, outcome);
      commitSettings(after);
      if (outcome.ok) {
        if (userId && gymId && mayKeepSettingsCopy(after)) void writeLeaderboardSettings(userId, gymId, { hidden: after.hidden, ownLabel: after.ownLabel });
        await loadBoard(tabRef.current);
      }
    },
    [userId, gymId, commitSettings, loadBoard],
  );
  const notice = useLeaderboardNotice(onNoticeResult);

  const view = useMemo(
    () =>
      buildLeaderboardView({
        tab,
        gymName,
        settings,
        settingsLoaded,
        board: boards[tab],
        connected: isConnected,
        visibilityPending,
        noticeBusy: notice.busy,
        noticeFailed: notice.failed,
        t,
        language,
      }),
    [tab, gymName, settings, settingsLoaded, boards, isConnected, visibilityPending, notice.busy, notice.failed, t, language],
  );

  return { view, tab, refreshing, refresh, selectTab, toggleVisibility, chooseNotice: notice.choose };
}
