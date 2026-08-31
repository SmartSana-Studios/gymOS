import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import {
  bookClassSession,
  cancelClassBooking,
  listBookableClassSessions,
  listMyClassBookings,
  type BookableClassSession,
  type MyClassBooking,
} from '@/services/classes';

type ClassesTab = 'available' | 'bookings';

/** `myBookingId` always holds either `null` or a real `class_bookings.id` --
 * `optimisticBooked` is a local-only UI flag for the `already_booked` result
 * (no real booking id is returned there), kept separate so nothing ever
 * mistakes a session id for a real booking id. */
type AvailableRow = BookableClassSession & { optimisticBooked?: boolean };

function formatSessionTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function bookRowState(session: AvailableRow): 'booked' | 'full' | 'book' {
  if (session.myBookingId !== null || session.optimisticBooked) return 'booked';
  if (session.bookedCount >= session.capacity) return 'full';
  return 'book';
}

/** MA-16. Segmented "Available"/"My Bookings" control, initial value read
 * from the `tab` route param (AC #1's Home deep-link lands on "My
 * Bookings"; direct tab-bar taps default to "Available"). Each sub-tab owns
 * an independent load/error/busy state slice and its own requestIdRef
 * stale-response guard (mirrors (tabs)/index.tsx's loadHome) -- switching
 * sub-tabs mid-fetch must never let an older response clobber newer state.
 * Lazy-loads the inactive sub-tab only on first activation (mirrors
 * history/index.tsx's Payments tab). */
export default function ClassesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { isConnected } = useOfflineSync();
  const params = useLocalSearchParams<{ tab?: string }>();

  const [activeTab, setActiveTab] = useState<ClassesTab>(params.tab === 'bookings' ? 'bookings' : 'available');

  // The screen stays mounted across native-tab switches, so a second visit
  // to Home's Upcoming Classes deep link (AC #1) must also re-sync activeTab
  // -- the useState initializer above only fires on first mount.
  useEffect(() => {
    if (params.tab === 'bookings') setActiveTab('bookings');
  }, [params.tab]);

  const [available, setAvailable] = useState<AvailableRow[]>([]);
  const [availableLoaded, setAvailableLoaded] = useState(false);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [availableLoadError, setAvailableLoadError] = useState(false);
  const [availableRefreshing, setAvailableRefreshing] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [bookingBusyId, setBookingBusyId] = useState<string | null>(null);

  const [bookings, setBookings] = useState<MyClassBooking[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsLoadError, setBookingsLoadError] = useState(false);
  const [bookingsRefreshing, setBookingsRefreshing] = useState(false);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const availableRequestIdRef = useRef(0);
  const bookingsRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const loadAvailable = useCallback(async () => {
    const requestId = ++availableRequestIdRef.current;
    const isCurrent = () => availableRequestIdRef.current === requestId;
    const rows = await listBookableClassSessions();
    if (!isCurrent()) return true;
    if (rows === null) {
      setAvailableLoadError(true);
      return false;
    }
    setAvailable(rows);
    setAvailableLoadError(false);
    return true;
  }, []);

  const loadBookings = useCallback(async () => {
    const requestId = ++bookingsRequestIdRef.current;
    const isCurrent = () => bookingsRequestIdRef.current === requestId;
    const rows = await listMyClassBookings();
    if (!isCurrent()) return true;
    if (rows === null) {
      setBookingsLoadError(true);
      return false;
    }
    setBookings(rows);
    setBookingsLoadError(false);
    return true;
  }, []);

  useEffect(() => {
    if (activeTab !== 'available' || availableLoaded) return;
    setAvailableLoaded(true);
    setAvailableLoading(true);
    void loadAvailable().finally(() => setAvailableLoading(false));
  }, [activeTab, availableLoaded, loadAvailable]);

  useEffect(() => {
    if (activeTab !== 'bookings' || bookingsLoaded) return;
    setBookingsLoaded(true);
    setBookingsLoading(true);
    void loadBookings().finally(() => setBookingsLoading(false));
  }, [activeTab, bookingsLoaded, loadBookings]);

  async function handleAvailableRefresh() {
    const hadRows = available.length > 0;
    setAvailableRefreshing(true);
    const ok = await loadAvailable();
    setAvailableRefreshing(false);
    if (!ok && hadRows) showToast(t('classes.available.refreshError'));
  }

  async function handleAvailableRetry() {
    setAvailableLoading(true);
    await loadAvailable();
    setAvailableLoading(false);
  }

  async function handleBookingsRefresh() {
    const hadRows = bookings.length > 0;
    setBookingsRefreshing(true);
    const ok = await loadBookings();
    setBookingsRefreshing(false);
    if (!ok && hadRows) showToast(t('classes.bookings.refreshError'));
  }

  async function handleBookingsRetry() {
    setBookingsLoading(true);
    await loadBookings();
    setBookingsLoading(false);
  }

  function toggleExpanded(sessionId: string) {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  }

  async function handleBook(session: AvailableRow) {
    if (!isConnected || bookingBusyId) return;
    setBookingBusyId(session.classSessionId);
    const result = await bookClassSession(session.classSessionId);
    setBookingBusyId(null);

    if (result.status === 'success') {
      setAvailable((prev) =>
        prev.map((row) =>
          row.classSessionId === session.classSessionId
            ? { ...row, bookedCount: row.bookedCount + 1, myBookingId: result.booking.id }
            : row,
        ),
      );
      return;
    }
    if (result.status === 'already_booked') {
      // Idempotent: the server considers this session already booked even
      // though local state hadn't caught up. No real booking id is
      // returned here, but Available's row action never needs one -- only
      // My Bookings' Cancel action does, and that list is refreshed
      // independently. `optimisticBooked` (not myBookingId) carries this,
      // so myBookingId always stays either null or a real booking id.
      setAvailable((prev) =>
        prev.map((row) => (row.classSessionId === session.classSessionId ? { ...row, optimisticBooked: true } : row)),
      );
      return;
    }
    if (result.status === 'full') {
      setAvailable((prev) =>
        prev.map((row) =>
          row.classSessionId === session.classSessionId ? { ...row, bookedCount: Math.max(row.bookedCount, row.capacity) } : row,
        ),
      );
      showToast(t('classes.available.raceLost'));
      return;
    }
    if (result.status === 'ineligible') {
      showToast(t('classes.available.ineligible'));
      return;
    }
    showToast(t('classes.available.bookError'));
  }

  function handleCancelPress(booking: MyClassBooking) {
    if (!isConnected || cancelBusyId) return;
    Alert.alert(t('classes.bookings.cancelConfirmTitle'), undefined, [
      {
        text: t('classes.bookings.cancelConfirmAction'),
        style: 'destructive',
        onPress: () => void handleCancelConfirmed(booking.bookingId),
      },
      { text: t('classes.bookings.cancelConfirmKeep'), style: 'cancel' },
    ]);
  }

  async function handleCancelConfirmed(bookingId: string) {
    setCancelBusyId(bookingId);
    const result = await cancelClassBooking(bookingId);
    setCancelBusyId(null);

    if (result.status === 'success') {
      setBookings((prev) => prev.filter((row) => row.bookingId !== bookingId));
      return;
    }
    if (result.status === 'cutoff_passed') {
      void loadBookings();
      return;
    }
    showToast(t('classes.bookings.cancelError'));
  }

  function renderBookAction(session: AvailableRow) {
    if (bookingBusyId === session.classSessionId) {
      return <ActivityIndicator size="small" color={theme.textSecondary} />;
    }
    const state = bookRowState(session);
    if (state === 'booked') {
      return (
        <ThemedText type="small" themeColor="textSecondary">
          {t('classes.available.booked')}
        </ThemedText>
      );
    }
    if (state === 'full') {
      return (
        <ThemedText type="small" themeColor="textSecondary">
          {t('classes.available.full')}
        </ThemedText>
      );
    }
    return (
      <Pressable accessibilityRole="button" disabled={!isConnected} onPress={() => void handleBook(session)}>
        <ThemedText type="link" style={!isConnected && styles.disabledText}>
          {t('classes.available.book')}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">{t('classes.title')}</ThemedText>
        </View>

        <View style={styles.segmentedControl}>
          <SegmentedControl
            options={[
              { value: 'available' as const, label: t('classes.tabAvailable') },
              { value: 'bookings' as const, label: t('classes.tabMyBookings') },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />
        </View>

        {!isConnected && (
          <View style={styles.offlineBanner}>
            <ThemedText type="small" style={styles.offlineBannerText}>
              {t('classes.offlineBanner')}
            </ThemedText>
          </View>
        )}

        {activeTab === 'available' && (
          <>
            {availableLoading && <ActivityIndicator style={styles.loadingIndicator} />}

            {!availableLoading && availableLoadError && available.length === 0 && (
              <View style={[styles.card, { borderColor: theme.border }]}>
                <ThemedText type="small" style={styles.error}>
                  {t('classes.available.errorLoadFailed')}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => void handleAvailableRetry()}>
                  <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                </Pressable>
              </View>
            )}

            {!availableLoading && (!availableLoadError || available.length > 0) && (
              <FlatList
                data={available}
                keyExtractor={(item) => item.classSessionId}
                refreshControl={
                  <RefreshControl refreshing={availableRefreshing} onRefresh={() => void handleAvailableRefresh()} />
                }
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
                ]}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('classes.available.empty')}
                    </ThemedText>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.row, { borderTopColor: theme.border }]}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => toggleExpanded(item.classSessionId)}
                      style={styles.rowInfo}>
                      <ThemedText type="smallBold">{item.className}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatSessionTimestamp(item.scheduledAt, i18n.language)} · {item.coachName}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('classes.available.capacityFormat', { booked: item.bookedCount, capacity: item.capacity })}
                      </ThemedText>
                      {expandedSessionId === item.classSessionId && item.description && (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
                          {item.description}
                        </ThemedText>
                      )}
                    </Pressable>
                    <View style={styles.rowAction}>{renderBookAction(item)}</View>
                  </View>
                )}
              />
            )}
          </>
        )}

        {activeTab === 'bookings' && (
          <>
            {bookingsLoading && <ActivityIndicator style={styles.loadingIndicator} />}

            {!bookingsLoading && bookingsLoadError && bookings.length === 0 && (
              <View style={[styles.card, { borderColor: theme.border }]}>
                <ThemedText type="small" style={styles.error}>
                  {t('classes.bookings.errorLoadFailed')}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => void handleBookingsRetry()}>
                  <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                </Pressable>
              </View>
            )}

            {!bookingsLoading && (!bookingsLoadError || bookings.length > 0) && (
              <FlatList
                data={bookings}
                keyExtractor={(item) => item.bookingId}
                refreshControl={
                  <RefreshControl refreshing={bookingsRefreshing} onRefresh={() => void handleBookingsRefresh()} />
                }
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
                ]}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('classes.bookings.empty')}
                    </ThemedText>
                    <Pressable accessibilityRole="button" onPress={() => setActiveTab('available')}>
                      <ThemedText type="link">{t('classes.bookings.browseAvailable')}</ThemedText>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.row, { borderTopColor: theme.border }]}>
                    <View style={styles.rowInfo}>
                      <ThemedText type="smallBold">{item.className}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatSessionTimestamp(item.scheduledAt, i18n.language)}
                      </ThemedText>
                    </View>
                    <View style={styles.rowAction}>
                      {cancelBusyId === item.bookingId ? (
                        <ActivityIndicator size="small" color={theme.textSecondary} />
                      ) : item.canCancel ? (
                        <Pressable accessibilityRole="button" disabled={!isConnected} onPress={() => handleCancelPress(item)}>
                          <ThemedText type="link" style={!isConnected && styles.disabledText}>
                            {t('classes.bookings.cancel')}
                          </ThemedText>
                        </Pressable>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t('classes.bookings.cancellationClosed')}
                        </ThemedText>
                      )}
                    </View>
                  </View>
                )}
              />
            )}
          </>
        )}

        {toast && (
          <View style={[styles.toast, { bottom: insets.bottom + BottomTabInset + Spacing.three }]}>
            <ThemedText type="small" style={styles.toastText}>
              {toast}
            </ThemedText>
          </View>
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
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  segmentedControl: {
    marginTop: Spacing.three,
  },
  offlineBanner: {
    marginTop: Spacing.three,
    backgroundColor: '#3A2A12',
    borderWidth: 1,
    borderColor: '#5C4420',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  offlineBannerText: {
    color: '#FBBF24',
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
  listContent: {
    marginTop: Spacing.three,
    gap: Spacing.two,
    flexGrow: 1,
  },
  emptyState: {
    marginTop: Spacing.six,
    alignItems: 'center',
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  rowInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  rowAction: {
    marginLeft: Spacing.two,
  },
  description: {
    marginTop: Spacing.half,
  },
  disabledText: {
    opacity: 0.5,
  },
  toast: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    backgroundColor: '#1F2937',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  toastText: {
    color: '#F9FAFB',
  },
});
