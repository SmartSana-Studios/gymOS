import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarPanel } from '@/components/CalendarPanel';
import { LeaderboardHomeCard } from '@/components/LeaderboardHomeCard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { WeeklyRingSection } from '@/components/WeeklyRingCard';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useBadgeRows } from '@/hooks/use-badges';
import { useCalendar } from '@/hooks/use-calendar';
import { useFocusToast } from '@/hooks/use-focus-toast';
import { useHomeEngagement } from '@/hooks/use-home-engagement';
import { useHomeLeaderboard } from '@/hooks/use-home-leaderboard';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { profileBadgesValue } from '@/lib/badgesView';
import { useEngagementGate } from '@/lib/engagementGate';
import { useOfflineSync } from '@/lib/offline-sync-context';

/** Story 31.4 (FR-219 to FR-224, FR-226, FR-230): the Streak tab, the hub of the engagement area. Top to bottom: the This week ring section (the card still
 * opens /calendar; goal, goal hint, Shield chip, notices and the comeback card are the section's own), the Leaderboard card (opens /leaderboard), the
 * attendance calendar panel and a Badges row (opens /badges). Layout only: every number is the server's and every word the locale's (the hooks and view
 * models are the ones Home used before this story, unchanged). One pull to refresh reloads all four. The tab is in the bar for every member in every state
 * ("it is for member engagement, not for gyms"); while the engagement gate (lib/engagementGate.ts) is off or unknown the screen draws the heading and one
 * calm line (`engage.streak.off`) and none of the four sections, but its loaders still run so the first read can turn the gate on. */
export default function StreakScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, gymId } = useSession();
  const userId = session?.user.id ?? null;
  const { isConnected, pendingCheckInCount } = useOfflineSync();
  const gate = useEngagementGate();
  const toast = useFocusToast();

  const { view: engagementView, loadForHome: loadEngagement, dismissGoalHint, dismissShieldNotice } = useHomeEngagement(isConnected, pendingCheckInCount);
  const { view: leaderboardView, loadForHome: loadLeaderboard, retry: retryLeaderboard } = useHomeLeaderboard();
  const calendar = useCalendar(isConnected, pendingCheckInCount, userId, gymId);
  // The badge count reloads on focus; a pull to refresh bumps the token to read it again.
  const [badgesReload, setBadgesReload] = useState(0);
  const badgeRows = useBadgeRows(gate === 'on', isConnected, userId, gymId, badgesReload);
  const badgesValue = profileBadgesValue(badgeRows, t);
  const badgesLabel = badgesValue ? `${t('engage.profile.badges.row')}, ${badgesValue}` : t('engage.profile.badges.row');

  // The panel leaves out its own at-risk hint only while the ring card above is showing the same one; in the ring's error, offline or skeleton face the
  // panel keeps it, so the hint never vanishes from the whole screen.
  const ringShowsHint = engagementView.kind === 'card' && engagementView.hint !== null;

  const [refreshing, setRefreshing] = useState(false);
  // Each load takes a number; only the latest may commit (a pull to refresh during a focus load supersedes it).
  const loadSeq = useRef(0);
  const loadRing = useCallback(async () => {
    if (!userId || !gymId) return;
    const seq = ++loadSeq.current;
    const isCurrent = () => seq === loadSeq.current;
    const read = loadEngagement(userId, gymId, isCurrent);
    // The Leaderboard card reuses that one read (it never reads the engagement row a second time).
    await Promise.all([read, loadLeaderboard(userId, gymId, isCurrent, read)]);
  }, [userId, gymId, loadEngagement, loadLeaderboard]);

  useFocusEffect(
    useCallback(() => {
      void loadRing();
    }, [loadRing]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setBadgesReload((n) => n + 1);
    try {
      await Promise.all([loadRing(), calendar.refresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadRing, calendar]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BottomTabInset + Spacing.three }]}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
            {t('engage.streak.title')}
          </ThemedText>

          {/* The off face (the gate is off or still unknown): one calm line, and none of the sections below, so nothing says it twice. */}
          {gate !== 'on' && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('engage.streak.off')}
            </ThemedText>
          )}

          {gate === 'on' && (
            <WeeklyRingSection
              view={engagementView}
              onGoalPress={() => router.push('/goal')}
              onGoalHintPress={dismissGoalHint}
              onDismissNotice={dismissShieldNotice}
              onPressCard={() => router.push('/calendar')}
            />
          )}

          {gate === 'on' && <LeaderboardHomeCard view={leaderboardView} onPress={() => router.push('/leaderboard')} onRetry={retryLeaderboard} />}

          {gate === 'on' && <CalendarPanel view={calendar.view} refresh={calendar.refresh} shift={calendar.shift} selectDay={calendar.selectDay} hideAtRiskHint={ringShowsHint} />}

          {gate === 'on' && (
            <Card variant="flat">
              <Pressable accessibilityRole="button" accessibilityLabel={badgesLabel} onPress={() => router.push('/badges')} style={styles.badgesRow}>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <IconChip icon="military-tech" tint="primary" />
                </View>
                <View style={styles.badgesText}>
                  <ThemedText type="smallBold">{t('engage.profile.badges.row')}</ThemedText>
                  {badgesValue && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {badgesValue}
                    </ThemedText>
                  )}
                </View>
                <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
              </Pressable>
            </Card>
          )}
        </ScrollView>

        {toast && (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.toast, { bottom: insets.bottom + BottomTabInset + Spacing.three }]}>
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
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    paddingTop: Spacing.two,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
  },
  badgesText: {
    flex: 1,
    gap: Spacing.half,
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
