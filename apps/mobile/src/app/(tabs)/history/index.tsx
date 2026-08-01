import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { BottomTabInset, Spacing } from '@/constants/theme';
import {
  isPaymentMethod,
  isPaymentStatus,
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_COLORS,
  paymentStatusLabelKey,
} from '@/constants/payment-status';
import { supabase } from '@/lib/supabase';
import { loadPaymentsPage, type PaymentListRow } from '@/services/payments';

const PAGE_SIZE = 20;

type HistoryTab = 'payments' | 'checkins';

interface CheckInRow {
  id: string;
  checkedInAt: string;
  checkedOutAt: string | null;
}

function formatCheckInTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

// Payments have no separate date-only column like subscriptions.expiry_date
// -- a fresh small helper, not a copy of onboarding/(tabs)'s
// `formatDateOnly` (which parses a "YYYY-MM-DD" date-only string, not a
// full timestamptz).
function formatPaymentDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
}

// Same arithmetic as apps/dashboard's AttendancePageClient.formatDuration --
// hours/minutes derived here, translated string composed by the caller via
// `history.checkins.durationFormat` (new mobile i18n key, not a shared
// key with the dashboard's `attendance.durationFormat`, architecture.md).
function durationParts(checkedInAt: string, checkedOutAt: string): { hours: number; minutes: number } {
  const ms = new Date(checkedOutAt).getTime() - new Date(checkedInAt).getTime();
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** MA-11. Segmented "Payments"/"Check-ins" control, defaulting to
 * Check-ins. Check-ins tab resolves the caller's own `members.id` + gym
 * `name` once on mount (same duplicated resolution block as
 * (tabs)/index.tsx, (tabs)/profile.tsx, onboarding/plan.tsx), then
 * paginates `attendance_events` via `member_read_own_attendance_events`
 * (0026 migration) -- first FlatList in this app, needed for
 * `onEndReached` infinite scroll + native pull-to-refresh. Story 4.9: the
 * Payments tab is now real too, with its own independent state slice and
 * lazy-loaded on first activation (not on mount, unlike Check-ins) --
 * loading both tabs' data unconditionally on every screen mount would
 * double every load for the common case of a member who never opens the
 * Payments tab this session. */
export default function HistoryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<HistoryTab>('checkins');

  const [memberId, setMemberId] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);

  const [checkIns, setCheckIns] = useState<CheckInRow[]>([]);
  const [cursor, setCursor] = useState<{ checkedInAt: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [payments, setPayments] = useState<PaymentListRow[]>([]);
  const [paymentsCursor, setPaymentsCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [paymentsHasMore, setPaymentsHasMore] = useState(true);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);

  const [paymentsInitialLoading, setPaymentsInitialLoading] = useState(false);
  const [paymentsLoadError, setPaymentsLoadError] = useState(false);
  const [paymentsLoadingMore, setPaymentsLoadingMore] = useState(false);
  const [paymentsPageError, setPaymentsPageError] = useState(false);
  const [paymentsRefreshing, setPaymentsRefreshing] = useState(false);
  const [paymentsBusy, setPaymentsBusy] = useState(false);

  // Keyset (cursor) pagination on the same (checked_in_at desc, id desc)
  // order the query already sorts by -- a numeric `.range()` offset would
  // drift/duplicate rows if a new check-in lands while a page is loaded
  // (Review finding). `after` is the last-seen row's cursor, or null for
  // page 0 / a replace (pull-to-refresh).
  const loadCheckInsPage = useCallback(
    async (id: string, after: { checkedInAt: string; id: string } | null, replace: boolean) => {
      let query = supabase
        .from('attendance_events')
        .select('id, checked_in_at, checked_out_at')
        .eq('member_id', id)
        .order('checked_in_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (after) {
        query = query.or(
          `checked_in_at.lt.${after.checkedInAt},and(checked_in_at.eq.${after.checkedInAt},id.lt.${after.id})`,
        );
      }

      const { data, error } = await query;

      if (error || !data) {
        if (replace) {
          setLoadError(true);
        } else {
          setPageError(true);
        }
        return;
      }

      const rows: CheckInRow[] = data.map((row) => ({
        id: row.id,
        checkedInAt: row.checked_in_at,
        checkedOutAt: row.checked_out_at,
      }));

      setCheckIns((prev) => {
        if (replace) return rows;
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...rows.filter((row) => !seen.has(row.id))];
      });
      const last = rows[rows.length - 1];
      setCursor(last ? { checkedInAt: last.checkedInAt, id: last.id } : after);
      setHasMore(rows.length === PAGE_SIZE);
      setPageError(false);
    },
    [],
  );

  // Story 4.9: own cursor-pagination loader for the Payments tab, mirroring
  // `loadCheckInsPage`'s exact shape but backed by the extracted
  // `loadPaymentsPage` service function (Task 3) rather than an inline
  // query -- unlike Check-ins, Payments needs the same query reused
  // elsewhere (none yet, but keeps the two tabs structurally parallel).
  const loadPaymentsPageInternal = useCallback(
    async (id: string, after: { createdAt: string; id: string } | null, replace: boolean) => {
      const rows = await loadPaymentsPage(id, after, PAGE_SIZE);

      if (rows === null) {
        if (replace) {
          setPaymentsLoadError(true);
        } else {
          setPaymentsPageError(true);
        }
        return;
      }

      setPayments((prev) => {
        if (replace) return rows;
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...rows.filter((row) => !seen.has(row.id))];
      });
      const last = rows[rows.length - 1];
      setPaymentsCursor(last ? { createdAt: last.createdAt, id: last.id } : after);
      setPaymentsHasMore(rows.length === PAGE_SIZE);
      setPaymentsPageError(false);
    },
    [],
  );

  const loadInitial = useCallback(async () => {
    setInitialLoading(true);
    setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setLoadError(true);
        return;
      }

      const [memberResult, gymResult] = await Promise.all([
        supabase
          .from('members')
          .select('id')
          .eq('user_id', userId)
          .is('deactivated_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .single(),
        supabase.from('gyms').select('name').single(),
      ]);

      if (memberResult.error || !memberResult.data || gymResult.error || !gymResult.data) {
        setLoadError(true);
        return;
      }

      setMemberId(memberResult.data.id);
      setGymName(gymResult.data.name);
      await loadCheckInsPage(memberResult.data.id, null, true);
    } catch {
      setLoadError(true);
    } finally {
      setInitialLoading(false);
    }
  }, [loadCheckInsPage]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Lazy-load on first tab activation, not on mount (Scope Notes/Task 4).
  useEffect(() => {
    if (activeTab === 'payments' && memberId && !paymentsLoaded) {
      setPaymentsLoaded(true);
      setPaymentsInitialLoading(true);
      setPaymentsLoadError(false);
      void loadPaymentsPageInternal(memberId, null, true).finally(() => setPaymentsInitialLoading(false));
    }
  }, [activeTab, memberId, paymentsLoaded, loadPaymentsPageInternal]);

  // `busy` covers all three load-triggering paths (initial, end-reached,
  // refresh, and the page-retry button) so at most one is ever in flight --
  // otherwise a load-more in flight during a pull-to-refresh (or vice versa)
  // can interleave an append and a replace against the same `checkIns`
  // state (Review finding).
  async function handleEndReached() {
    if (!memberId || busy || !hasMore || initialLoading) return;
    setBusy(true);
    setLoadingMore(true);
    try {
      await loadCheckInsPage(memberId, cursor, false);
    } finally {
      setLoadingMore(false);
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!memberId || busy) return;
    setBusy(true);
    setRefreshing(true);
    try {
      await loadCheckInsPage(memberId, null, true);
    } finally {
      setRefreshing(false);
      setBusy(false);
    }
  }

  async function handlePageRetry() {
    if (!memberId || busy) return;
    setBusy(true);
    setLoadingMore(true);
    try {
      await loadCheckInsPage(memberId, cursor, false);
    } finally {
      setLoadingMore(false);
      setBusy(false);
    }
  }

  // `paymentsBusy` mirrors `busy`'s own per-tab mutual-exclusion discipline
  // -- a load-more in flight during a payments pull-to-refresh (or vice
  // versa) must not interleave an append and a replace against `payments`.
  async function handlePaymentsEndReached() {
    if (!memberId || paymentsBusy || !paymentsHasMore || paymentsInitialLoading) return;
    setPaymentsBusy(true);
    setPaymentsLoadingMore(true);
    try {
      await loadPaymentsPageInternal(memberId, paymentsCursor, false);
    } finally {
      setPaymentsLoadingMore(false);
      setPaymentsBusy(false);
    }
  }

  async function handlePaymentsRefresh() {
    if (!memberId || paymentsBusy) return;
    setPaymentsBusy(true);
    setPaymentsRefreshing(true);
    try {
      await loadPaymentsPageInternal(memberId, null, true);
    } finally {
      setPaymentsRefreshing(false);
      setPaymentsBusy(false);
    }
  }

  async function handlePaymentsPageRetry() {
    if (!memberId || paymentsBusy) return;
    setPaymentsBusy(true);
    setPaymentsLoadingMore(true);
    try {
      await loadPaymentsPageInternal(memberId, paymentsCursor, false);
    } finally {
      setPaymentsLoadingMore(false);
      setPaymentsBusy(false);
    }
  }

  async function handlePaymentsInitialRetry() {
    if (!memberId || paymentsBusy) return;
    setPaymentsBusy(true);
    setPaymentsInitialLoading(true);
    setPaymentsLoadError(false);
    try {
      await loadPaymentsPageInternal(memberId, null, true);
    } finally {
      setPaymentsInitialLoading(false);
      setPaymentsBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">{t('history.title')}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.push('/plan')}>
            <ThemedText type="link">{t('history.viewPlan')}</ThemedText>
          </Pressable>
        </View>

        <View style={styles.segmentedControl} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'payments' }}
            onPress={() => setActiveTab('payments')}
            style={[styles.segmentOption, activeTab === 'payments' && styles.segmentOptionActive]}>
            <ThemedText type="smallBold">{t('history.tabPayments')}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'checkins' }}
            onPress={() => setActiveTab('checkins')}
            style={[styles.segmentOption, activeTab === 'checkins' && styles.segmentOptionActive]}>
            <ThemedText type="smallBold">{t('history.tabCheckins')}</ThemedText>
          </Pressable>
        </View>

        {activeTab === 'payments' && (
          <>
            {paymentsInitialLoading && <ActivityIndicator style={styles.loadingIndicator} />}

            {!paymentsInitialLoading && paymentsLoadError && payments.length === 0 && (
              <View style={styles.card}>
                <ThemedText type="small" style={styles.error}>
                  {t('history.payments.errorLoadFailed')}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => void handlePaymentsInitialRetry()}>
                  <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                </Pressable>
              </View>
            )}

            {/* A failed refresh (paymentsLoadError with existing rows) keeps the
                list visible instead of replacing it with the error card above --
                only a load with zero rows to show falls back to the full-page
                error state. */}
            {!paymentsInitialLoading && (!paymentsLoadError || payments.length > 0) && (
              <FlatList
                data={payments}
                keyExtractor={(item) => item.id}
                onEndReached={() => void handlePaymentsEndReached()}
                onEndReachedThreshold={0.5}
                refreshControl={
                  <RefreshControl refreshing={paymentsRefreshing} onRefresh={() => void handlePaymentsRefresh()} />
                }
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
                ]}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('history.payments.empty')}
                    </ThemedText>
                  </View>
                }
                renderItem={({ item }) => {
                  const itemStatus = item.status;
                  // An unrecognized status renders as raw text with a neutral
                  // badge (matching the receipt screen's own raw-text fallback)
                  // rather than defaulting to 'pending' styling, which would
                  // misrepresent a financial record's true state.
                  const statusColors = isPaymentStatus(itemStatus)
                    ? PAYMENT_STATUS_COLORS[itemStatus]
                    : { bg: '#F3F4F6', border: '#E5E7EB', text: '#374151' };
                  const statusLabel = isPaymentStatus(itemStatus) ? t(paymentStatusLabelKey[itemStatus]) : itemStatus;
                  const methodLabel = isPaymentMethod(item.method) ? t(PAYMENT_METHOD_LABEL_KEY[item.method]) : item.method;
                  const planLabel = item.planName ?? t('history.payments.planUnavailable');

                  return (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/history/payment/${item.id}`)}
                      style={styles.paymentRow}>
                      <View style={styles.paymentRowTop}>
                        <ThemedText type="small">{formatPaymentDate(item.createdAt, i18n.language)}</ThemedText>
                        <ThemedText type="smallBold">{`${item.amount} ${item.currency}`}</ThemedText>
                      </View>
                      <View style={styles.paymentRowBottom}>
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={1}
                          style={styles.paymentRowPlan}>
                          {planLabel} · {methodLabel}
                        </ThemedText>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: statusColors.bg, borderColor: statusColors.border },
                          ]}>
                          <ThemedText type="small" style={{ color: statusColors.text }}>
                            {statusLabel}
                          </ThemedText>
                        </View>
                      </View>
                    </Pressable>
                  );
                }}
                ListFooterComponent={
                  paymentsLoadingMore ? (
                    <ActivityIndicator style={styles.loadingIndicator} />
                  ) : paymentsPageError ? (
                    <View style={styles.pageErrorRow}>
                      <ThemedText type="small" style={styles.error}>
                        {t('history.payments.errorLoadFailed')}
                      </ThemedText>
                      <Pressable accessibilityRole="button" onPress={() => void handlePaymentsPageRetry()}>
                        <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                      </Pressable>
                    </View>
                  ) : null
                }
              />
            )}
          </>
        )}

        {activeTab === 'checkins' && (
          <>
            {initialLoading && <ActivityIndicator style={styles.loadingIndicator} />}

            {!initialLoading && loadError && (
              <View style={styles.card}>
                <ThemedText type="small" style={styles.error}>
                  {t('history.checkins.errorLoadFailed')}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => void loadInitial()}>
                  <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                </Pressable>
              </View>
            )}

            {!initialLoading && !loadError && (
              <FlatList
                data={checkIns}
                keyExtractor={(item) => item.id}
                onEndReached={() => void handleEndReached()}
                onEndReachedThreshold={0.5}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
                contentContainerStyle={[
                  styles.listContent,
                  { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
                ]}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('history.checkins.empty')}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push('/checkin')}
                      style={styles.checkInButton}>
                      <ThemedText style={styles.checkInButtonLabel}>{t('history.checkins.checkInButton')}</ThemedText>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <ThemedText type="small" style={styles.rowLeft}>
                      {formatCheckInTimestamp(item.checkedInAt, i18n.language)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.rowCenter} numberOfLines={1}>
                      {gymName}
                    </ThemedText>
                    <ThemedText type="small" style={styles.rowRight}>
                      {item.checkedOutAt
                        ? t('history.checkins.durationFormat', durationParts(item.checkedInAt, item.checkedOutAt))
                        : ''}
                    </ThemedText>
                  </View>
                )}
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator style={styles.loadingIndicator} />
                  ) : pageError ? (
                    <View style={styles.pageErrorRow}>
                      <ThemedText type="small" style={styles.error}>
                        {t('history.checkins.errorLoadFailed')}
                      </ThemedText>
                      <Pressable accessibilityRole="button" onPress={() => void handlePageRetry()}>
                        <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
                      </Pressable>
                    </View>
                  ) : null
                }
              />
            )}
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.background,
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
    flexDirection: 'row',
    gap: Spacing.one,
    marginTop: Spacing.three,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#F0F0F3',
    alignItems: 'center',
  },
  segmentOptionActive: {
    backgroundColor: '#E0E1E6',
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderColor: '#E0E1E6',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  error: {
    color: '#B3261E',
  },
  listContent: {
    marginTop: Spacing.three,
    gap: Spacing.two,
    flexGrow: 1,
  },
  emptyState: {
    marginTop: Spacing.six,
    alignItems: 'center',
    gap: Spacing.three,
  },
  checkInButton: {
    backgroundColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  checkInButtonLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E0E1E6',
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  pageErrorRow: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
  },
  rowLeft: {
    flex: 1.2,
  },
  rowCenter: {
    flex: 1,
    textAlign: 'center',
  },
  rowRight: {
    flex: 0.8,
    textAlign: 'right',
  },
  paymentRow: {
    borderTopWidth: 1,
    borderTopColor: '#E0E1E6',
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  paymentRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  paymentRowPlan: {
    flex: 1,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
