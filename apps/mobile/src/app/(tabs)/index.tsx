import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialIconsIconName } from '@react-native-vector-icons/material-icons';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconChip, type IconChipTint } from '@/components/ui/IconChip';
import { ListItem } from '@/components/ui/ListItem';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { STATUS_COLORS, statusLabelKey, type BadgeStatus, type SubscriptionStatus } from '@/constants/subscription-status';
import { useTheme } from '@/hooks/use-theme';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { getRecentCheckIns, type RecentCheckIn } from '@/services/checkin';
import { listMyClassBookings, type MyClassBooking } from '@/services/classes';
import { getOccupancyBand, type OccupancyBand } from '@/services/occupancy';
import { getGymTaraMoneyConnectionStatus, getRecentPayments, type RecentPayment } from '@/services/payments';
import { getOwnSubscriptionWithPlan } from '@/services/subscriptions';
import { supabase } from '@/lib/supabase';

// Bounds the merged check-in + payment feed (Story 4.9 AC #3) -- renamed
// from RECENT_CHECK_INS_LIMIT now that it no longer bounds check-ins alone.
const RECENT_ACTIVITY_LIMIT = 3;
// AC #1: "up to 2 nearest sessions," a smaller bound than the general
// activity feed above -- this is a schedule preview, not a feed.
const UPCOMING_CLASSES_LIMIT = 2;

// Tagged union so the render below can distinguish a check-in row (existing
// appearance/behavior, unchanged) from a payment row (new, Story 4.9 AC #3)
// after the two feeds are merged and sorted together.
type ActivityItem =
  | ({ kind: 'checkin' } & RecentCheckIn)
  | ({ kind: 'payment' } & RecentPayment);

// Date-only string ("YYYY-MM-DD") -- same local-Y/M/D construction as
// onboarding/plan.tsx's `formatDateOnly`, duplicated rather than imported
// since no shared date-utils module exists in this app yet.
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateOnly(value: string, locale: string): string {
  return parseDateOnly(value).toLocaleDateString(locale);
}

function formatCheckInTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

// Epic 15 (Story 15.3): same local-midnight date construction as
// formatDateOnly above -- both operands are day-aligned, so the diff is
// already a whole number of days, no fractional edge case to round away.
function daysUntil(value: string): number {
  const target = parseDateOnly(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Epic 15 (Story 15.3): only grace_period's `warning` icon is inherited from
// the pre-existing inline glyph -- the other four are new choices (see the
// story's own Dev Notes table for rationale). IconChip has no "neutral"
// tint (Story 15.2 built exactly 5), so no_plan uses `primary`.
const STATUS_ICON_CHIP: Record<BadgeStatus, { icon: MaterialIconsIconName; tint: IconChipTint }> = {
  active: { icon: 'check-circle', tint: 'success' },
  expiring_soon: { icon: 'schedule', tint: 'warning' },
  grace_period: { icon: 'warning', tint: 'warning' },
  expired: { icon: 'error', tint: 'danger' },
  no_plan: { icon: 'info', tint: 'primary' },
};

// Story 8.5: re-tuned for the dark theme, same semantic hues as
// constants/subscription-status.ts's STATUS_COLORS.
const OCCUPANCY_COLORS: Record<OccupancyBand, { bg: string; text: string }> = {
  low: { bg: '#123321', text: '#4ADE80' },
  medium: { bg: '#3A2A12', text: '#FBBF24' },
  busy: { bg: '#3A1414', text: '#F87171' },
};

/** MA-09. On mount: resolves the caller's own `users` row, gym branding
 * (`name` + `logo_url`, live-fetched every mount -- Scope Note #6, no cache
 * layer exists), current `members` row, and that member's most-recent
 * `subscriptions` row (Scope Note #4 -- unlike onboarding/plan.tsx and
 * (tabs)/profile.tsx, this query does **not** filter `.eq('status',
 * 'active')`, since Home must show whichever status the row actually
 * holds). Recent check-ins (AC #3) and the occupancy band (AC #4) are
 * fetched independently and never block the primary load or surface their
 * own error state -- both are best-effort, non-blocking elements. */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pendingCheckInCount } = useOfflineSync();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymLogoUrl, setGymLogoUrl] = useState<string | null>(null);

  const [noActivePlan, setNoActivePlan] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);

  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [occupancyBand, setOccupancyBand] = useState<OccupancyBand | null>(null);
  // Story 4.15 (AC #2/#3): whether the gym has Tara Money connected --
  // decides Renew vs. "See front desk" for the CTA below. Best-effort, same
  // non-blocking contract as occupancyBand -- a real RPC failure and "not
  // connected" both resolve to false (no charge risk either way).
  const [taraMoneyConnected, setTaraMoneyConnected] = useState(false);
  // Story 12.4 (AC #1): best-effort, non-blocking -- same treatment as
  // occupancyBand/taraMoneyConnected above.
  const [upcomingClasses, setUpcomingClasses] = useState<MyClassBooking[]>([]);
  const [workoutPlanName, setWorkoutPlanName] = useState<string | null>(null);

  // Review finding: rapid tab switching can fire loadHome() again before an
  // earlier call resolves; without this, an older/slower response could
  // resolve after a newer one and overwrite fresher state with stale data.
  // Every setState call below that follows an `await` is guarded by
  // `isCurrent()`, which stays true only for the most recently started call.
  const requestIdRef = useRef(0);

  const loadHome = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestIdRef.current === requestId;

    setLoading(true);
    setLoadError(false);
    setNoActivePlan(false);
    setDisplayName(null);
    setAvatarUrl(null);
    setGymName(null);
    setGymLogoUrl(null);
    setSubscriptionStatus(null);
    setExpiryDate(null);
    setPlanName(null);
    setRecentActivity([]);
    setOccupancyBand(null);
    setTaraMoneyConnected(false);
    setUpcomingClasses([]);
    setWorkoutPlanName(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!isCurrent()) return;
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setLoadError(true);
        return;
      }

      const [userResult, gymResult, memberResult] = await Promise.all([
        supabase.from('users').select('display_name, photo_url').eq('id', userId).single(),
        supabase.from('gyms').select('name, logo_url').single(),
        supabase
          .from('members')
          .select('id')
          .eq('user_id', userId)
          .is('deactivated_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .single(),
      ]);
      if (!isCurrent()) return;

      if (
        userResult.error ||
        !userResult.data ||
        gymResult.error ||
        !gymResult.data ||
        memberResult.error ||
        !memberResult.data
      ) {
        setLoadError(true);
        return;
      }

      setDisplayName(userResult.data.display_name);
      setAvatarUrl(userResult.data.photo_url);
      setGymName(gymResult.data.name);
      setGymLogoUrl(gymResult.data.logo_url);

      // Story 4.15: shared with the Renew screen (services/subscriptions.ts)
      // -- same distinction onboarding/plan.tsx's loadPlan already makes
      // between "no subscription row at all" (a non-retryable state, not a
      // load failure) and a real load error.
      const subscriptionResult = await getOwnSubscriptionWithPlan(memberResult.data.id);
      if (!isCurrent()) return;
      if (subscriptionResult.kind === 'no_subscription') {
        setNoActivePlan(true);
      } else if (subscriptionResult.kind === 'error') {
        setLoadError(true);
        return;
      } else {
        setSubscriptionStatus(subscriptionResult.data.status);
        setExpiryDate(subscriptionResult.data.expiryDate);
        setPlanName(subscriptionResult.data.planName);
      }

      // Story 4.9 AC #3: check-ins and payments fetched in parallel, merged
      // into one tagged-union array, sorted by timestamp descending, capped
      // to the top RECENT_ACTIVITY_LIMIT -- still best-effort/non-blocking
      // (neither feed's own failure trips the outer loadError; both service
      // functions already return `[]` on any error, same contract as before).
      const [recentCheckIns, recentPayments] = await Promise.all([
        getRecentCheckIns(memberResult.data.id, RECENT_ACTIVITY_LIMIT),
        getRecentPayments(memberResult.data.id, RECENT_ACTIVITY_LIMIT),
      ]);
      if (!isCurrent()) return;
      const merged: ActivityItem[] = [
        ...recentCheckIns.map((event) => ({ kind: 'checkin' as const, ...event })),
        ...recentPayments.map((payment) => ({ kind: 'payment' as const, ...payment })),
      ].sort((a, b) => {
        const aTime = a.kind === 'checkin' ? a.checkedInAt : a.createdAt;
        const bTime = b.kind === 'checkin' ? b.checkedInAt : b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
      setRecentActivity(merged.slice(0, RECENT_ACTIVITY_LIMIT));

      // Best-effort, non-blocking (Scope Note #2) -- `band === null` (no
      // capacity configured) and any RPC error are treated identically:
      // render nothing. Locally guarded (unlike `getRecentCheckIns`, which
      // already wraps itself) so an unexpected exception here can't
      // propagate to the outer catch and incorrectly trip `loadError`.
      try {
        const { band } = await getOccupancyBand();
        if (isCurrent()) setOccupancyBand(band);
      } catch {
        if (isCurrent()) setOccupancyBand(null);
      }

      // Story 4.15 (AC #2/#3): also best-effort/non-blocking -- never throws
      // (services/payments.ts's own contract), so no local try/catch needed.
      const connected = await getGymTaraMoneyConnectionStatus();
      if (isCurrent()) setTaraMoneyConnected(connected);

      // Story 12.4 (AC #1): best-effort, non-blocking -- locally guarded
      // (unlike getRecentCheckIns, which already wraps itself) so a failure
      // here can't propagate to the outer catch and incorrectly trip
      // loadError. Unlike listMyClassBookings()'s own Classes-tab contract
      // (null on error), Home treats any failure identically to "no
      // upcoming classes": render nothing.
      try {
        const bookings = await listMyClassBookings();
        if (isCurrent()) setUpcomingClasses((bookings ?? []).slice(0, UPCOMING_CLASSES_LIMIT));
      } catch {
        if (isCurrent()) setUpcomingClasses([]);
      }

      // Story 13.3: best-effort, non-blocking, same discipline as the
      // upcomingClasses fetch above -- a lightweight existence check (just
      // the plan name), not the full exercise list workout-plan.tsx itself
      // fetches on its own mount.
      try {
        const { data: plan } = await supabase
          .from('workout_plans')
          .select('name')
          .eq('member_id', memberResult.data.id)
          .maybeSingle();
        if (isCurrent()) setWorkoutPlanName(plan?.name ?? null);
      } catch {
        if (isCurrent()) setWorkoutPlanName(null);
      }
    } catch {
      if (isCurrent()) setLoadError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  // Story 4.15: refetches whenever this tab regains focus (not just on
  // mount) -- returning from the Renew screen after a successful renewal
  // needs the badge/expiry/CTA to update without a manual pull-to-refresh,
  // and expo-router keeps tab screens mounted across navigation, so a plain
  // mount-only effect would never re-run on its own.
  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome]),
  );

  const firstName = displayName?.trim().split(/\s+/)[0] ?? null;

  const badgeStatus: BadgeStatus = noActivePlan ? 'no_plan' : (subscriptionStatus ?? 'no_plan');
  const statusColors = STATUS_COLORS[badgeStatus];
  const expiryLabel = expiryDate ? formatDateOnly(expiryDate, i18n.language) : null;
  // Story 4.15 (AC #1): extends the previous expired-only CTA branch to all
  // three renewal-eligible statuses.
  const showRenewCta =
    badgeStatus === 'expiring_soon' || badgeStatus === 'grace_period' || badgeStatus === 'expired';
  // Review finding: only `expired` actually blocks gym access -- an
  // `expiring_soon`/`grace_period` member still has access and should keep
  // the Check In shortcut alongside Renew, not lose it.
  const showCheckInAction = badgeStatus !== 'expired';

  // Epic 15 (Story 15.3): expiring_soon/grace_period get a "days until
  // expiry" framing (day count in statNumeral emphasis) instead of a plain
  // date, per EXPERIENCE.md's MA-09 spec -- active is unaffected. A <= 0 day
  // count (expiry lands today, or a data race before status flips to
  // expired) falls back to the existing plain-date phrasing.
  const dayCount = expiryDate ? daysUntil(expiryDate) : null;
  const isDayCountEligible =
    (badgeStatus === 'expiring_soon' || badgeStatus === 'grace_period') && dayCount !== null && dayCount > 0;

  let statusNoteContent: ReactNode = null;
  if (badgeStatus === 'no_plan') {
    statusNoteContent = t('home.noPlanNote');
  } else if (badgeStatus === 'expired') {
    statusNoteContent = t('home.expiredNote');
  } else if (isDayCountEligible) {
    statusNoteContent = (
      <>
        {t('home.expiresInDaysPrefix')}
        <ThemedText type="statNumeral" style={{ color: statusColors.text }}>
          {dayCount}
        </ThemedText>
        {t(badgeStatus === 'grace_period' ? 'home.gracePeriodDaysSuffix' : 'home.expiresInDaysSuffix', {
          count: dayCount as number,
        })}
      </>
    );
  } else if (badgeStatus === 'grace_period') {
    statusNoteContent = expiryLabel ? t('home.gracePeriodNote', { date: expiryLabel }) : null;
  } else if (expiryLabel) {
    statusNoteContent = t('home.expiresOn', { date: expiryLabel });
  }

  function handleViewPlan() {
    router.push('/plan');
  }

  function handleSeeFrontDesk() {
    Alert.alert(t('home.seeFrontDeskTitle'), t('home.seeFrontDeskBody'), [{ text: t('common.ok') }]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          <View style={styles.header}>
            <View style={styles.headerBranding}>
              {gymLogoUrl && <Image source={{ uri: gymLogoUrl }} style={styles.gymLogo} />}
              {gymName && (
                <ThemedText type="smallBold" numberOfLines={1} style={styles.gymName}>
                  {gymName}
                </ThemedText>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.title')}
              onPress={() => router.push('/profile')}
              style={[styles.avatar, { backgroundColor: theme.surfaceElevated }]}>
              {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} /> : null}
            </Pressable>
          </View>

          {pendingCheckInCount > 0 && (
            <View style={styles.offlineBanner}>
              <ThemedText type="small" style={styles.offlineBannerText}>
                {t('home.offlineSyncPending')}
              </ThemedText>
            </View>
          )}


          {loading && <ActivityIndicator style={styles.loadingIndicator} />}

          {!loading && loadError && (
            <View style={[styles.card, { borderColor: theme.border }]}>
              <ThemedText type="small" style={styles.error}>
                {t('home.errorLoadFailed')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => void loadHome()}>
                <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
              </Pressable>
            </View>
          )}

          {!loading && !loadError && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {firstName ? t('home.welcomeBack', { name: firstName }) : t('home.welcomeBackNoName')}
              </ThemedText>

              <Pressable accessibilityRole="button" onPress={handleViewPlan}>
                <Card variant="raised" style={styles.statusCard}>
                  <IconChip icon={STATUS_ICON_CHIP[badgeStatus].icon} tint={STATUS_ICON_CHIP[badgeStatus].tint} />
                  <View style={styles.statusTextGroup}>
                    <ThemedText type="smallBold" style={{ color: statusColors.text }}>
                      {t(statusLabelKey[badgeStatus])}
                    </ThemedText>
                    {planName && <ThemedText type="default">{planName}</ThemedText>}
                    {statusNoteContent && (
                      <ThemedText type="small" style={{ color: statusColors.text }}>
                        {statusNoteContent}
                      </ThemedText>
                    )}
                  </View>
                </Card>
              </Pressable>

              {occupancyBand && (
                <View style={[styles.occupancyPill, { backgroundColor: OCCUPANCY_COLORS[occupancyBand].bg }]}>
                  <ThemedText type="small" style={{ color: OCCUPANCY_COLORS[occupancyBand].text }}>
                    {t(`home.occupancy.${occupancyBand}`)}
                  </ThemedText>
                </View>
              )}

              <View style={styles.quickActions}>
                {showRenewCta && (
                  <View style={styles.quickActionButton}>
                    {taraMoneyConnected ? (
                      <Button label={t('home.renew')} onPress={() => router.push('/renew')} />
                    ) : (
                      <Button label={t('home.seeFrontDesk')} onPress={handleSeeFrontDesk} />
                    )}
                  </View>
                )}
                {showCheckInAction && (
                  <View style={styles.quickActionButton}>
                    <Button label={t('home.checkIn')} onPress={() => router.push('/checkin')} />
                  </View>
                )}
                <View style={styles.quickActionButton}>
                  <Button label={t('home.viewPlan')} variant="secondary" onPress={handleViewPlan} />
                </View>
              </View>

              {/* Story 13.3: no mockup covers a workout-plan entry point on
                  the member app (see the story's own Dev Notes) -- mirrors
                  upcomingClasses' own conditional-section precedent
                  (shown only when applicable, not an always-visible empty
                  state) rather than a third quickActions button. */}
              {workoutPlanName !== null && (
                <View style={styles.activitySection}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/workout-plan')}
                    style={styles.sectionHeader}>
                    <ThemedText type="smallBold">{t('home.myWorkoutPlan')}</ThemedText>
                    <ThemedText type="default">→</ThemedText>
                  </Pressable>
                  <Card variant="flat">
                    <ListItem icon="fitness-center" tint="primary" title={workoutPlanName} />
                  </Card>
                </View>
              )}

              {upcomingClasses.length > 0 && (
                <View style={styles.activitySection}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/classes', params: { tab: 'bookings' } })}
                    style={styles.sectionHeader}>
                    <ThemedText type="smallBold">{t('home.upcomingClasses')}</ThemedText>
                    <ThemedText type="default">→</ThemedText>
                  </Pressable>
                  <Card variant="flat">
                    {upcomingClasses.map((booking, index) => (
                      <View
                        key={booking.bookingId}
                        style={index > 0 ? [styles.rowDivider, { borderTopColor: theme.border }] : undefined}>
                        <ListItem
                          icon="event"
                          tint="primary"
                          title={booking.className}
                          meta={formatCheckInTimestamp(booking.scheduledAt, i18n.language)}
                        />
                      </View>
                    ))}
                  </Card>
                </View>
              )}

              <View style={styles.activitySection}>
                <ThemedText type="smallBold">{t('home.recentActivity')}</ThemedText>
                {recentActivity.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('home.recentActivityEmpty')}
                  </ThemedText>
                ) : (
                  <Card variant="flat">
                    {recentActivity.map((item, index) => (
                      <View
                        key={item.kind === 'checkin' ? `checkin-${item.id}` : `payment-${item.id}`}
                        style={index > 0 ? [styles.rowDivider, { borderTopColor: theme.border }] : undefined}>
                        {item.kind === 'checkin' ? (
                          <ListItem
                            icon="check-circle"
                            tint="accent"
                            title={t('home.checkedIn')}
                            meta={formatCheckInTimestamp(item.checkedInAt, i18n.language)}
                            onPress={() => router.push('/history')}
                          />
                        ) : (
                          <ListItem
                            icon="payments"
                            tint="success"
                            title={t('home.paymentRecorded', { amount: item.amount, currency: item.currency })}
                            meta={formatCheckInTimestamp(item.createdAt, i18n.language)}
                            onPress={() => router.push(`/history/payment/${item.id}`)}
                          />
                        )}
                      </View>
                    ))}
                  </Card>
                )}
              </View>
            </>
          )}
        </ScrollView>
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
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
  },
  headerBranding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  gymLogo: {
    width: 40,
    height: 40,
    borderRadius: Spacing.one,
  },
  gymName: {
    flexShrink: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  offlineBanner: {
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
  card: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  error: {
    color: '#F87171',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  statusTextGroup: {
    flex: 1,
    gap: Spacing.half,
  },
  occupancyPill: {
    alignSelf: 'flex-start',
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  quickActionButton: {
    flex: 1,
  },
  activitySection: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowDivider: {
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
});
