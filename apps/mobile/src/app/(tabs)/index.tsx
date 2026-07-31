import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { BottomTabInset, Spacing } from '@/constants/theme';
import {
  isSubscriptionStatus,
  STATUS_COLORS,
  statusLabelKey,
  type BadgeStatus,
  type SubscriptionStatus,
} from '@/constants/subscription-status';
import { useOfflineSync } from '@/lib/offline-sync-context';
import { getRecentCheckIns, type RecentCheckIn } from '@/services/checkin';
import { getOccupancyBand, type OccupancyBand } from '@/services/occupancy';
import { supabase } from '@/lib/supabase';

const RECENT_CHECK_INS_LIMIT = 3;

// Narrows the untyped embedded-select response, same discipline as
// onboarding/plan.tsx's `isSubscriptionRow` / (tabs)/profile.tsx's
// `isPlanNameRow` (Review finding there) -- a shape mismatch falls through
// to the existing loadError handling instead of masking itself as a
// generic failure with no signal.
interface SubscriptionRowFromDb {
  status: string;
  expiry_date: string | null;
  plans: { name: string } | null;
}
function isSubscriptionRow(value: unknown): value is SubscriptionRowFromDb {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.status === 'string' &&
    (row.expiry_date === null || typeof row.expiry_date === 'string') &&
    typeof row.plans === 'object'
  );
}

// Date-only string ("YYYY-MM-DD") -- same local-Y/M/D construction as
// onboarding/plan.tsx's `formatDateOnly`, duplicated rather than imported
// since no shared date-utils module exists in this app yet.
function formatDateOnly(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

function formatCheckInTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

const OCCUPANCY_COLORS: Record<OccupancyBand, { bg: string; text: string }> = {
  low: { bg: '#DCFCE7', text: '#166534' },
  medium: { bg: '#FFEDD5', text: '#9A3412' },
  busy: { bg: '#FEE2E2', text: '#991B1B' },
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
  const { pendingCount } = useOfflineSync();

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

  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([]);
  const [occupancyBand, setOccupancyBand] = useState<OccupancyBand | null>(null);

  const loadHome = useCallback(async () => {
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
    setRecentCheckIns([]);
    setOccupancyBand(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
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

      const { data: subscriptionData, error: subscriptionError } = await supabase
        .from('subscriptions')
        .select('status, expiry_date, plans(name)')
        .eq('member_id', memberResult.data.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // PGRST116 = PostgREST's "no rows" code for `.single()` -- a member
      // with no subscription row at all is a distinct, non-retryable "no
      // active plan" state, not a load failure (same distinction
      // onboarding/plan.tsx's loadPlan already makes).
      if (subscriptionError?.code === 'PGRST116') {
        setNoActivePlan(true);
      } else if (
        subscriptionError ||
        !isSubscriptionRow(subscriptionData) ||
        !subscriptionData.plans ||
        !isSubscriptionStatus(subscriptionData.status)
      ) {
        setLoadError(true);
        return;
      } else {
        setSubscriptionStatus(subscriptionData.status);
        setExpiryDate(subscriptionData.expiry_date);
        setPlanName(subscriptionData.plans.name);
      }

      const recent = await getRecentCheckIns(memberResult.data.id, RECENT_CHECK_INS_LIMIT);
      setRecentCheckIns(recent);

      // Best-effort, non-blocking (Scope Note #2) -- `band === null` (no
      // capacity configured) and any RPC error are treated identically:
      // render nothing. Locally guarded (unlike `getRecentCheckIns`, which
      // already wraps itself) so an unexpected exception here can't
      // propagate to the outer catch and incorrectly trip `loadError`.
      try {
        const { band } = await getOccupancyBand();
        setOccupancyBand(band);
      } catch {
        setOccupancyBand(null);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  const firstName = displayName?.trim().split(/\s+/)[0] ?? null;

  const badgeStatus: BadgeStatus = noActivePlan ? 'no_plan' : (subscriptionStatus ?? 'no_plan');
  const statusColors = STATUS_COLORS[badgeStatus];
  const expiryLabel = expiryDate ? formatDateOnly(expiryDate, i18n.language) : null;

  let statusNote: string | null = null;
  if (badgeStatus === 'no_plan') {
    statusNote = t('home.noPlanNote');
  } else if (badgeStatus === 'expired') {
    statusNote = t('home.expiredNote');
  } else if (badgeStatus === 'grace_period') {
    statusNote = expiryLabel ? t('home.gracePeriodNote', { date: expiryLabel }) : null;
  } else if (expiryLabel) {
    statusNote = t('home.expiresOn', { date: expiryLabel });
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
              style={styles.avatar}>
              {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} /> : null}
            </Pressable>
          </View>

          {pendingCount > 0 && (
            <View style={styles.offlineBanner}>
              <ThemedText type="small" style={styles.offlineBannerText}>
                {t('home.offlineSyncPending')}
              </ThemedText>
            </View>
          )}

          {loading && <ActivityIndicator style={styles.loadingIndicator} />}

          {!loading && loadError && (
            <View style={styles.card}>
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

              <Pressable
                accessibilityRole="button"
                onPress={handleViewPlan}
                style={[styles.statusCard, { backgroundColor: statusColors.bg, borderColor: statusColors.border }]}>
                <View style={styles.statusLabelRow}>
                  {badgeStatus === 'grace_period' && (
                    <MaterialIcons name="warning" size={16} color={statusColors.text} />
                  )}
                  <ThemedText type="smallBold" style={{ color: statusColors.text }}>
                    {t(statusLabelKey[badgeStatus])}
                  </ThemedText>
                </View>
                {planName && <ThemedText type="default">{planName}</ThemedText>}
                {statusNote && (
                  <ThemedText type="small" style={{ color: statusColors.text }}>
                    {statusNote}
                  </ThemedText>
                )}
              </Pressable>

              {occupancyBand && (
                <View style={[styles.occupancyPill, { backgroundColor: OCCUPANCY_COLORS[occupancyBand].bg }]}>
                  <ThemedText type="small" style={{ color: OCCUPANCY_COLORS[occupancyBand].text }}>
                    {t(`home.occupancy.${occupancyBand}`)}
                  </ThemedText>
                </View>
              )}

              <View style={styles.quickActions}>
                {badgeStatus === 'expired' ? (
                  <Pressable accessibilityRole="button" onPress={handleSeeFrontDesk} style={styles.quickActionButton}>
                    <ThemedText style={styles.quickActionLabel}>{t('home.seeFrontDesk')}</ThemedText>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/checkin')}
                    style={styles.quickActionButton}>
                    <ThemedText style={styles.quickActionLabel}>{t('home.checkIn')}</ThemedText>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={handleViewPlan}
                  style={[styles.quickActionButton, styles.quickActionButtonSecondary]}>
                  <ThemedText style={styles.quickActionLabelSecondary}>{t('home.viewPlan')}</ThemedText>
                </Pressable>
              </View>

              <View style={styles.activitySection}>
                <ThemedText type="smallBold">{t('home.recentActivity')}</ThemedText>
                {recentCheckIns.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('home.recentActivityEmpty')}
                  </ThemedText>
                ) : (
                  recentCheckIns.map((event) => (
                    <Pressable
                      key={event.id}
                      accessibilityRole="button"
                      onPress={() => router.push('/history')}
                      style={styles.activityRow}>
                      <ThemedText type="small">{t('home.checkedIn')}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatCheckInTimestamp(event.checkedInAt, i18n.language)}
                      </ThemedText>
                    </Pressable>
                  ))
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
    backgroundColor: Brand.background,
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
    backgroundColor: '#E0E1E6',
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
    backgroundColor: '#FFEDD5',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  offlineBannerText: {
    color: '#9A3412',
  },
  card: {
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
  statusCard: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.half,
  },
  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  quickActionButtonSecondary: {
    backgroundColor: '#F0F0F3',
  },
  quickActionLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  quickActionLabelSecondary: {
    color: Brand.primary,
    fontWeight: '600',
  },
  activitySection: {
    gap: Spacing.two,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E0E1E6',
    paddingTop: Spacing.two,
  },
});
