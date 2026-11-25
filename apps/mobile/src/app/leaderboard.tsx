import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { LeaderboardGap, LeaderboardRow, LeaderboardSkeleton } from '@/components/LeaderboardRow';
import { LeaderboardNotice } from '@/components/LeaderboardNotice';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Spacing } from '@/constants/theme';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useSession } from '@/hooks/use-session';
import { useOfflineSync } from '@/lib/offline-sync-context';

/** Story 30.6 (MA-19, FR-226, FR-227): the gym leaderboard, pushed from the Home card and the Profile link. Layout only: the hook
 * (hooks/use-leaderboard.ts) loads and sequences, the view model (lib/leaderboardView.ts) decides every state and every word, and every label, rank,
 * tie and total on screen is the server's. While the first-open notice is unseen the list is NOT rendered and `gym_leaderboard` is not called. Rows
 * are not tappable. No tab bar, no tab badge. */
export default function LeaderboardScreen() {
  return (
    <GymAccentColorProvider>
      <LeaderboardScreenContent />
    </GymAccentColorProvider>
  );
}

function LeaderboardScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, gymId } = useSession();
  const { isConnected } = useOfflineSync();
  const { view, tab, refreshing, refresh, selectTab, toggleVisibility, chooseNotice } = useLeaderboard(isConnected, session?.user.id ?? null, gymId);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.backButton}>
            <ThemedText type="default">←</ThemedText>
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText type="subtitle" accessibilityRole="header">
              {view.title}
            </ThemedText>
            {view.subtitle && (
              <ThemedText type="small" themeColor="textSecondary">
                {view.subtitle}
              </ThemedText>
            )}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          showsVerticalScrollIndicator={false}>
          <SegmentedControl options={view.tabs} value={tab} onChange={selectTab} />

          {view.face === 'notice' && view.notice ? (
            <LeaderboardNotice view={view.notice} onChoose={(choice) => void chooseNotice(choice)} />
          ) : (
            <>
              {view.banner && (
                <View style={styles.banner}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {view.banner.text}
                  </ThemedText>
                  {view.banner.updated && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {view.banner.updated}
                    </ThemedText>
                  )}
                  <ThemedText type="small" themeColor="textSecondary">
                    {view.banner.applies}
                  </ThemedText>
                </View>
              )}

              {view.face === 'loading' && (
                <Card variant="flat" style={styles.listCard}>
                  <LeaderboardSkeleton />
                </Card>
              )}
              {view.face === 'list' && (
                <Card variant="flat" style={styles.listCard}>
                  {view.items.map((item) => (item.kind === 'gap' ? <LeaderboardGap key={item.key} gap={item} /> : <LeaderboardRow key={item.key} row={item} />))}
                  {view.unrankedLine && (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.unranked}>
                      {view.unrankedLine}
                    </ThemedText>
                  )}
                </Card>
              )}
              {view.face === 'notEnough' && view.notEnough && (
                <Card variant="flat" style={styles.message}>
                  <ThemedText type="smallBold">{view.notEnough.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {view.notEnough.body}
                  </ThemedText>
                  {view.notEnough.support && <ThemedText type="small">{view.notEnough.support}</ThemedText>}
                </Card>
              )}
              {view.face === 'error' && view.errorText && (
                <Card variant="flat" style={styles.message}>
                  <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
                    {view.errorText}
                  </ThemedText>
                </Card>
              )}

              {view.footnote && (
                <ThemedText type="small" themeColor="textSecondary">
                  {view.footnote}
                </ThemedText>
              )}

              {view.visibility && (
                <Card variant="flat" style={styles.visibility}>
                  <View style={styles.visibilityRow}>
                    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                      <IconChip icon="visibility-off" tint="primary" />
                    </View>
                    <ThemedText type="smallBold" style={styles.visibilityLabel}>
                      {view.visibility.label}
                    </ThemedText>
                    <Switch
                      accessibilityRole="switch"
                      accessibilityLabel={view.visibility.accessibilityLabel}
                      accessibilityState={{ checked: view.visibility.checked, disabled: view.visibility.disabled }}
                      disabled={view.visibility.disabled}
                      value={view.visibility.checked}
                      onValueChange={toggleVisibility}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {view.visibility.helper}
                  </ThemedText>
                </Card>
              )}
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
    paddingHorizontal: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  banner: {
    gap: Spacing.half,
  },
  listCard: {
    padding: Spacing.two,
  },
  unranked: {
    padding: Spacing.two,
  },
  message: {
    gap: Spacing.two,
  },
  visibility: {
    gap: Spacing.two,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  visibilityLabel: {
    flex: 1,
  },
});
