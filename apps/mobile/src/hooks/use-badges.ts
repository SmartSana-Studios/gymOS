import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildShelfView, readBadgesCache, resolveBadgeRows, resolveShelfLoad, rowsForMember, shouldResetShelf, writeBadgesCache, type ShelfLoad, type ShelfView } from '@/lib/badgesView';
import { getMyBadges, type BadgeRow } from '@/services/badges';

export interface Badges {
  view: ShelfView;
  /** The rows on screen (live or the device's copy), or null before any. The detail sheet and the share flow read them through the view's tiles. */
  rows: BadgeRow[] | null;
  /** Pull to refresh is running. */
  refreshing: boolean;
  /** Reloads the shelf. Never throws. */
  refresh: () => Promise<void>;
}

/** Story 31.3 (MA-21): the Badge Shelf's data flow. `get_my_badges()` is a plain read: it never awards, and opening the shelf settles nothing. Every
 * good load is kept on the device per member and gym; offline, or when the read fails, that copy is the answer; with no copy a failure is the error
 * card. useState and a sequence ref, like the calendar's hook (the app has no query library): only the latest load commits. Nothing here throws. */
export function useBadges(isConnected: boolean, userId: string | null, gymId: string | null): Badges {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'fr' ? 'fr' : 'en';

  const [load, setLoad] = useState<ShelfLoad>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef<ShelfLoad>({ kind: 'loading' });
  const connectedRef = useRef(isConnected);
  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);
  const seq = useRef(0);

  const commit = useCallback((next: ShelfLoad) => {
    loadRef.current = next;
    setLoad(next);
  }, []);

  const memberKeyRef = useRef<string | null>(null);
  const loadAll = useCallback(async () => {
    const mine = ++seq.current;
    const latest = () => mine === seq.current;
    try {
      // Rows on screen belong to the member and gym they were read for: another member or gym starts from the loading face, never from these.
      const memberKey = userId && gymId ? `${userId}.${gymId}` : null;
      if (shouldResetShelf(memberKeyRef.current, memberKey)) {
        memberKeyRef.current = memberKey;
        commit({ kind: 'loading' });
      }
      const cached = userId && gymId ? await readBadgesCache(userId, gymId) : null;
      if (!latest()) return;
      // The device copy paints while the live read runs; a screen that already shows tiles keeps them.
      if (loadRef.current.kind !== 'ready' && cached) commit({ kind: 'ready', rows: cached, fromCache: true });
      const result = connectedRef.current ? await getMyBadges() : null;
      if (!latest()) return;
      commit(resolveShelfLoad({ cached, connected: connectedRef.current, result, current: loadRef.current }));
      if (result && result.status === 'success' && userId && gymId) void writeBadgesCache(userId, gymId, result.badges);
    } catch {
      if (latest()) commit(resolveShelfLoad({ cached: null, connected: false, result: null, current: loadRef.current }));
    }
  }, [userId, gymId, commit]);

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

  const view = useMemo(() => buildShelfView({ load, t, language }), [load, t, language]);
  return { view, rows: load.kind === 'ready' ? load.rows : null, refreshing, refresh };
}

/** The Profile "Badges" row's rows ("2 of 5"): the device copy first, then one read per focus while connected. Silent: a failure leaves what is on
 * screen, and `enabled` false (the engagement area is dark) reads nothing. */
export function useBadgeRows(enabled: boolean, isConnected: boolean, userId: string | null, gymId: string | null, reloadToken = 0): BadgeRow[] | null {
  // The rows are kept with the member and gym they were read for, so another member never sees them: a change of either starts from null, then from
  // that member's device copy, then from the live read.
  const memberKey = userId && gymId ? `${userId}.${gymId}` : null;
  const [entry, setEntry] = useState<{ key: string; rows: BadgeRow[] } | null>(null);
  const entryRef = useRef(entry);
  const seq = useRef(0);
  const connectedRef = useRef(isConnected);
  useEffect(() => {
    connectedRef.current = isConnected;
  }, [isConnected]);

  useFocusEffect(
    useCallback(() => {
      // `reloadToken` (Story 31.4, the Streak tab's pull to refresh) changes this callback's identity, so the focus effect reads again.
      void reloadToken;
      if (!enabled || !userId || !gymId || !memberKey) return;
      const mine = ++seq.current;
      void (async () => {
        try {
          const cached = await readBadgesCache(userId, gymId);
          if (mine !== seq.current) return;
          const own = rowsForMember(entryRef.current, memberKey);
          const first = resolveBadgeRows({ cached, connected: false, result: null, current: own });
          if (first) {
            entryRef.current = { key: memberKey, rows: first };
            setEntry(entryRef.current);
          }
          if (!connectedRef.current) return;
          const result = await getMyBadges();
          if (mine !== seq.current) return;
          const next = resolveBadgeRows({ cached, connected: true, result, current: rowsForMember(entryRef.current, memberKey) });
          if (next) {
            entryRef.current = { key: memberKey, rows: next };
            setEntry(entryRef.current);
          }
          if (result.status === 'success') void writeBadgesCache(userId, gymId, result.badges);
        } catch {
          // Best effort: the row keeps its last value.
        }
      })();
    }, [enabled, userId, gymId, memberKey, reloadToken]),
  );
  return enabled ? rowsForMember(entry, memberKey) : null;
}
