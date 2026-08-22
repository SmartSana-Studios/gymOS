import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { supabase } from '@/lib/supabase';
import {
  deleteProgressEntry,
  getCachedProgressPayload,
  getCurrentMember,
  loadProgressScreenData,
  type ProgressEntryRow,
} from '@/services/progress';

function formatEntryDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
}

function summarizeEntry(entry: ProgressEntryRow, t: (key: string) => string): string {
  const parts: string[] = [];
  if (entry.weightKg != null) parts.push(t('progress.entries.fieldWeight'));
  if (entry.waistCm != null) parts.push(t('progress.entries.fieldWaist'));
  if (entry.chestCm != null) parts.push(t('progress.entries.fieldChest'));
  if (entry.hipsCm != null) parts.push(t('progress.entries.fieldHips'));
  if (entry.armsCm != null) parts.push(t('progress.entries.fieldArms'));
  if (entry.thighsCm != null) parts.push(t('progress.entries.fieldThighs'));
  if (entry.note != null) parts.push(t('progress.entries.fieldNote'));
  return parts.length > 0 ? parts.join(', ') : t('progress.entries.fieldNone');
}

/** Story 10.3 Task 7: resolves Story 10.1's deferred entry-delete
 * affordance -- the first list view of raw entries in this codebase.
 * Prefers the in-memory `cachedProgressPayload` the Progress screen's own
 * `loadProgressScreenData` call already populated (Task 3) over a second
 * network round-trip, falling back to a fresh fetch only if this route is
 * ever reached without that data already in hand (e.g. Expo Router
 * restoring this route directly after an app restart, bypassing
 * `progress/index.tsx`). No pagination -- pilot-scale entry counts. */
export default function ProgressEntriesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { isConnected } = useOfflineSync();

  const [entries, setEntries] = useState<ProgressEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Review finding: same requestIdRef/isCurrent() convention as
  // progress/index.tsx and (tabs)/index.tsx -- guards a stale in-flight
  // response (or this screen unmounting) from overwriting fresher state.
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadEntries = useCallback(
    async (isRefresh = false) => {
      const requestId = ++requestIdRef.current;
      const isCurrent = () => requestIdRef.current === requestId;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setLoadError(false);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user.id;
        if (!userId) {
          if (isCurrent()) setLoadError(true);
          return;
        }
        const member = await getCurrentMember(userId);
        if (!isCurrent()) return;
        if (!member) {
          setLoadError(true);
          return;
        }

        // Review finding: only falls back to the cache when offline or the
        // fetch itself fails, mirroring progress/index.tsx's own pattern --
        // an un-gated cache-first read here previously showed stale data
        // even while online.
        if (!isConnected) {
          const cached = getCachedProgressPayload(member.memberId);
          if (cached) {
            setEntries(cached.entries);
          } else {
            setLoadError(true);
          }
          return;
        }

        const { data } = await loadProgressScreenData(member.memberId);
        if (!isCurrent()) return;
        if (data) {
          setEntries(data.entries);
          return;
        }

        const cached = getCachedProgressPayload(member.memberId);
        if (cached) {
          setEntries(cached.entries);
        } else {
          setLoadError(true);
        }
      } catch {
        if (!isCurrent()) return;
        setLoadError(true);
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [isConnected],
  );

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  function handleDeletePress(entry: ProgressEntryRow) {
    if (!isConnected || deletingId) return;
    Alert.alert(t('progress.entries.deleteConfirmTitle'), t('progress.entries.deleteConfirmBody'), [
      {
        text: t('progress.entries.deleteConfirmAction'),
        style: 'destructive',
        onPress: () => void handleDeleteConfirmed(entry.id),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function handleDeleteConfirmed(entryId: string) {
    setDeletingId(entryId);
    try {
      const { error } = await deleteProgressEntry(entryId);
      if (error) {
        if (isMountedRef.current) Alert.alert(t('progress.entries.deleteErrorTitle'), t('progress.entries.deleteErrorBody'));
        return;
      }
      if (isMountedRef.current) setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    } finally {
      if (isMountedRef.current) setDeletingId(null);
    }
  }

  // Reverse-chronological -- `entries` (from loadProgressScreenData/cache)
  // is sorted ascending by loggedAt for the chart's sake, so this list
  // reverses it for its own most-recent-first display.
  const sortedEntries = [...entries].reverse();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()}>
            <ThemedText type="default">←</ThemedText>
          </Pressable>
          <ThemedText type="subtitle">{t('progress.entries.title')}</ThemedText>
        </View>

        {!isConnected && (
          <View style={[styles.connectivityBanner, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('progress.entries.requiresConnectivity')}
            </ThemedText>
          </View>
        )}

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <View style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="small" style={styles.error}>
              {t('progress.entries.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadEntries()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </View>
        )}

        {!loading && !loadError && (
          <FlatList
            data={sortedEntries}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadEntries(true)} />}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
            ]}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('progress.entries.empty')}
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, { borderTopColor: theme.border }]}>
                <View style={styles.rowLeft}>
                  <ThemedText type="small">{formatEntryDate(item.loggedAt, i18n.language)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {summarizeEntry(item, t)}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('progress.entries.deleteConfirmAction')} — ${formatEntryDate(item.loggedAt, i18n.language)}`}
                  disabled={!isConnected || deletingId === item.id}
                  onPress={() => handleDeletePress(item)}
                  style={styles.deleteButton}>
                  <ThemedText type="small" style={[styles.error, (!isConnected || deletingId === item.id) && styles.disabledText]}>
                    {t('progress.entries.deleteConfirmAction')}
                  </ThemedText>
                </Pressable>
              </View>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  connectivityBanner: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  error: {
    color: '#F87171',
  },
  disabledText: {
    opacity: 0.4,
  },
  listContent: {
    marginTop: Spacing.three,
    gap: Spacing.two,
    flexGrow: 1,
  },
  emptyState: {
    marginTop: Spacing.six,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  rowLeft: {
    flex: 1,
    gap: Spacing.half,
  },
  deleteButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
});
