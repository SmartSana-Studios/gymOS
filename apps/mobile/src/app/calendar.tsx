import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CalendarPanel } from '@/components/CalendarPanel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/hooks/use-calendar';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useSession } from '@/hooks/use-session';
import { useOfflineSync } from '@/lib/offline-sync-context';

/** Story 30.5 (MA-18, FR-224): the attendance calendar, pushed from the Home "This week" card and the Profile Training card. Layout only: the hook
 * (hooks/use-calendar.ts) loads and sequences, the view model (lib/calendarView.ts) decides every state and every word. It always opens on the gym's
 * current month and never remembers the month left. No tab bar, no tab badge. Story 31.4: the body is components/CalendarPanel.tsx (shared with the Streak
 * tab); this screen keeps the header, the back button and the pull to refresh. */
export default function CalendarScreen() {
  return (
    <GymAccentColorProvider>
      <CalendarScreenContent />
    </GymAccentColorProvider>
  );
}

function CalendarScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, gymId } = useSession();
  const { isConnected, pendingCheckInCount } = useOfflineSync();
  const { view, refreshing, refresh, shift, selectDay } = useCalendar(isConnected, pendingCheckInCount, session?.user.id ?? null, gymId);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.backButton}>
            <ThemedText type="default">←</ThemedText>
          </Pressable>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.headerTitle}>
            {view.title}
          </ThemedText>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          showsVerticalScrollIndicator={false}>
          <CalendarPanel view={view} refresh={refresh} shift={shift} selectDay={selectDay} />
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
  headerTitle: {
    flex: 1,
  },
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
});
