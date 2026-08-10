import { useNetworkState } from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { countOfflineCheckIns } from '@/lib/sqlite';
import { queueOfflineCheckIn as queueOfflineCheckInService, syncPendingCheckIns } from '@/services/checkin';

/** expo-sqlite's web VFS (OPFS SyncAccessHandles) has no meaningful use on
 * web anyway -- there's no persistent native storage to queue offline
 * check-ins into, and repeated mounts fight over the same OPFS file handle,
 * hanging the tab ("Invalid VFS state"). Skip SQLite entirely on web rather
 * than let every remount corrupt the previous instance's handle. */
const isWeb = Platform.OS === 'web';

/** Story 3.9: mirrors `lib/onboarding-context.tsx`'s exact shape --
 * `createContext` + `XProvider` + `useX()` that throws if called outside
 * the provider -- this app's established context pattern. Scoped to
 * `(tabs)` (Task 6), not the root layout: the sync engine has no reason to
 * run before a member is signed in and onboarded. */
interface OfflineSyncValue {
  isConnected: boolean;
  pendingCount: number;
  queueOfflineCheckIn: () => Promise<{ id: string; scannedAt: string }>;
}

const OfflineSyncContext = createContext<OfflineSyncValue | null>(null);

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  // Scope Note #5: `isConnected === false` is the only confirmed-offline
  // signal. `useNetworkState()` can report an undetermined state before its
  // first real read completes -- treating that as "online" (attempt the
  // normal path, let checkin.tsx's own error-branch fallback catch a genuine
  // false-negative) is safer than treating "unknown" as "offline" and
  // needlessly queueing scans that could have gone through the network path.
  const networkState = useNetworkState();
  const isConnected = networkState.isConnected !== false;

  const [pendingCount, setPendingCount] = useState(0);
  const syncInFlightRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    if (isWeb) return;
    try {
      setPendingCount(await countOfflineCheckIns());
    } catch (err) {
      console.error('[offline-sync] failed to read pending check-in count', err);
    }
  }, []);

  // Guards against the reconnect effect below and queueOfflineCheckIn's
  // opportunistic re-sync firing close together and both processing the
  // same queued rows concurrently.
  const runSync = useCallback(async () => {
    if (isWeb || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    try {
      await syncPendingCheckIns();
    } finally {
      syncInFlightRef.current = false;
    }
    await refreshPendingCount();
  }, [refreshPendingCount]);

  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  // One effect keyed on [isConnected]: covers both "sync on reconnect" and
  // "sync once on mount if already online," since React only re-fires this
  // when the boolean's value actually changes or on initial mount.
  useEffect(() => {
    if (isConnected) {
      void runSync();
    }
  }, [isConnected, runSync]);

  const queueOfflineCheckIn = useCallback(async () => {
    if (isWeb) {
      throw new Error('Offline check-in queueing is not supported on web.');
    }
    const result = await queueOfflineCheckInService();
    await refreshPendingCount();
    // Opportunistic re-sync in case the connectivity flag was a stale false
    // negative -- cheap, and closes the gap where a brief signal blip is
    // misread as "fully offline."
    void runSync();
    return result;
  }, [refreshPendingCount, runSync]);

  const value = useMemo(
    () => ({ isConnected, pendingCount, queueOfflineCheckIn }),
    [isConnected, pendingCount, queueOfflineCheckIn],
  );

  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync(): OfflineSyncValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) {
    throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  }
  return ctx;
}
