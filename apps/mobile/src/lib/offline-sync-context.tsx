import { useNetworkState } from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { ChargingContext, SyncDenial } from '@/lib/sessionState';
import {
  clearSyncDenials,
  getCachedChargingContext,
  getSyncDenials,
  refreshChargingContext as fetchChargingContext,
} from '@/services/sessionCharging';
import { countOfflineCheckIns, countOfflineProgressEntries, countOfflineWorkoutCompletions } from '@/lib/sqlite';
import { queueOfflineCheckIn as queueOfflineCheckInService, syncPendingCheckIns } from '@/services/checkin';
import {
  queueOfflineProgressEntry as queueOfflineProgressEntryService,
  syncPendingProgressEntries,
  type ProgressEntryFields,
} from '@/services/progress';
import {
  queueOfflineWorkoutCompletion as queueOfflineWorkoutCompletionService,
  syncPendingWorkoutCompletions,
} from '@/services/workoutPlan';

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
  pendingCheckInCount: number;
  pendingProgressEntryCount: number;
  pendingWorkoutCompletionCount: number;
  /** Story 19.11: last known per-session charging state (cached, so it is
   * available offline), refreshed online on launch, foreground and by
   * `refreshChargingContext()` (check-in focus). */
  chargingContext: ChargingContext | null;
  refreshChargingContext: () => Promise<ChargingContext | null>;
  /** Persisted sync denials awaiting the Home notice. */
  sessionDenials: SyncDenial[];
  dismissSessionDenials: () => Promise<void>;
  queueOfflineCheckIn: () => Promise<{ id: string; scannedAt: string }>;
  queueOfflineProgressEntry: (
    fields: ProgressEntryFields,
    clientEntryId: string,
  ) => Promise<{ success: true; id: string } | { success: false }>;
  queueOfflineWorkoutCompletion: (
    planId: string,
    exerciseId: string,
    clientCompletionId: string,
  ) => Promise<{ success: true; id: string } | { success: false }>;
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

  const [pendingCheckInCount, setPendingCheckInCount] = useState(0);
  const [pendingProgressEntryCount, setPendingProgressEntryCount] = useState(0);
  const [pendingWorkoutCompletionCount, setPendingWorkoutCompletionCount] = useState(0);
  const syncInFlightRef = useRef(false);
  const [chargingContext, setChargingContext] = useState<ChargingContext | null>(null);
  const [sessionDenials, setSessionDenials] = useState<SyncDenial[]>([]);

  const refreshDenials = useCallback(async () => {
    if (isWeb) return;
    setSessionDenials(await getSyncDenials());
  }, []);

  // Online refresh of the charging flag; on failure keeps whatever is cached.
  const refreshChargingContext = useCallback(async () => {
    const fresh = await fetchChargingContext();
    if (fresh) setChargingContext(fresh);
    return fresh;
  }, []);

  const dismissSessionDenials = useCallback(async () => {
    const shown = sessionDenials.map((d) => d.scanId);
    setSessionDenials((current) => current.filter((d) => !shown.includes(d.scanId)));
    await clearSyncDenials(shown);
  }, [sessionDenials]);

  const refreshPendingCount = useCallback(async () => {
    if (isWeb) return;
    try {
      setPendingCheckInCount(await countOfflineCheckIns());
    } catch (err) {
      console.error('[offline-sync] failed to read pending check-in count', err);
    }
    try {
      setPendingProgressEntryCount(await countOfflineProgressEntries());
    } catch (err) {
      console.error('[offline-sync] failed to read pending progress-entry count', err);
    }
    try {
      setPendingWorkoutCompletionCount(await countOfflineWorkoutCompletions());
    } catch (err) {
      console.error('[offline-sync] failed to read pending workout-completion count', err);
    }
  }, []);

  // Guards against the reconnect effect below and queueOfflineCheckIn's/
  // queueOfflineProgressEntry's/queueOfflineWorkoutCompletion's
  // opportunistic re-sync firing close together and both processing the
  // same queued rows concurrently. Three independent domains now
  // (Promise.allSettled) -- one domain's failure must not block the
  // others' sync.
  const runSync = useCallback(async () => {
    if (isWeb || syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    try {
      await Promise.allSettled([syncPendingCheckIns(), syncPendingProgressEntries(), syncPendingWorkoutCompletions()]);
    } finally {
      syncInFlightRef.current = false;
    }
    await refreshPendingCount();
    await refreshDenials();
  }, [refreshPendingCount, refreshDenials]);

  useEffect(() => {
    void refreshPendingCount();
  }, [refreshPendingCount]);

  // Story 19.11: restore the cached charging state and any persisted denials,
  // then refresh the flag on launch and every foreground.
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await getCachedChargingContext();
      if (active && cached) setChargingContext((current) => current ?? cached);
      await refreshDenials();
      if (isConnected) {
        const fresh = await fetchChargingContext();
        if (active && fresh) setChargingContext(fresh);
      }
    })();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshChargingContext();
        void refreshDenials();
      }
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [isConnected, refreshChargingContext, refreshDenials]);

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

  const queueOfflineProgressEntry = useCallback(
    async (fields: ProgressEntryFields, clientEntryId: string) => {
      if (isWeb) {
        throw new Error('Offline progress-entry queueing is not supported on web.');
      }
      const result = await queueOfflineProgressEntryService(fields, clientEntryId);
      if (result.success) {
        await refreshPendingCount();
        void runSync();
      }
      return result;
    },
    [refreshPendingCount, runSync],
  );

  const queueOfflineWorkoutCompletion = useCallback(
    async (planId: string, exerciseId: string, clientCompletionId: string) => {
      if (isWeb) {
        throw new Error('Offline workout-completion queueing is not supported on web.');
      }
      const result = await queueOfflineWorkoutCompletionService(planId, exerciseId, clientCompletionId);
      if (result.success) {
        await refreshPendingCount();
        void runSync();
      }
      return result;
    },
    [refreshPendingCount, runSync],
  );

  const value = useMemo(
    () => ({
      isConnected,
      chargingContext,
      refreshChargingContext,
      sessionDenials,
      dismissSessionDenials,
      pendingCheckInCount,
      pendingProgressEntryCount,
      pendingWorkoutCompletionCount,
      queueOfflineCheckIn,
      queueOfflineProgressEntry,
      queueOfflineWorkoutCompletion,
    }),
    [
      isConnected,
      chargingContext,
      refreshChargingContext,
      sessionDenials,
      dismissSessionDenials,
      pendingCheckInCount,
      pendingProgressEntryCount,
      pendingWorkoutCompletionCount,
      queueOfflineCheckIn,
      queueOfflineProgressEntry,
      queueOfflineWorkoutCompletion,
    ],
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
