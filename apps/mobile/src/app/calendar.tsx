import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AtRiskHint } from '@/components/AtRiskHint';
import { CalendarGrid, CalendarSkeleton } from '@/components/CalendarGrid';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';
import { useCalendar } from '@/hooks/use-calendar';
import { GymAccentColorProvider, useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';
import { useOfflineSync } from '@/lib/offline-sync-context';
import type { LegendItem } from '@/lib/calendarView';

const SWIPE_DISTANCE = 50;

/** Story 30.5 (MA-18, FR-224): the attendance calendar, pushed from the Home "This week" card and the Profile Training card. Layout only: the hook
 * (hooks/use-calendar.ts) loads and sequences, the view model (lib/calendarView.ts) decides every state and every word. It always opens on the gym's
 * current month and never remembers the month left. No tab bar, no tab badge. */
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

  // Swiping the grid moves a month; it is a convenience, so it is switched off while a screen reader is running (the chevrons are the control).
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (!cancelled) setScreenReader(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => !screenReader && Math.abs(gesture.dx) > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -SWIPE_DISTANCE) shift(1);
          else if (gesture.dx >= SWIPE_DISTANCE) shift(-1);
        },
      }),
    [screenReader, shift],
  );

  const { monthBar, heading, summary } = view;

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
          <View style={styles.monthBar}>
            <ChevronButton name="chevron-left" label={monthBar.prevLabel} enabled={monthBar.canPrev} onPress={() => shift(-1)} />
            <ThemedText type="smallBold" accessibilityRole="header" accessibilityLabel={heading.accessibilityLabel} style={styles.monthLabel}>
              {monthBar.label}
            </ThemedText>
            <ChevronButton name="chevron-right" label={monthBar.nextLabel} enabled={monthBar.canNext} onPress={() => shift(1)} />
          </View>

          {summary && (
            <ThemedText type="small" themeColor={summary.numeral ? 'text' : 'textSecondary'} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {summary.before}
              {summary.numeral ? <ThemedText type="statNumeral">{summary.numeral}</ThemedText> : null}
              {summary.after}
            </ThemedText>
          )}

          <View {...(view.face === 'grid' ? swipe.panHandlers : {})}>
            <Card variant="flat" style={styles.gridCard}>
              {view.banner && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.banner}>
                  {view.banner}
                </ThemedText>
              )}
              {view.face === 'loading' && <CalendarSkeleton />}
              {view.face === 'grid' && <CalendarGrid weekdays={view.weekdays} weeks={view.weeks} onPressDay={selectDay} />}
              {(view.face === 'error' || view.face === 'offlineNone') && (
                <View style={styles.message}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {view.message}
                  </ThemedText>
                  {view.retryLabel && <Button label={view.retryLabel} variant="secondary" onPress={() => void refresh()} />}
                </View>
              )}
            </Card>
          </View>

          {view.atRiskLine && <AtRiskHint hint={view.atRiskLine} />}

          <View style={styles.legend}>
            {view.legend.map((item) => (
              <LegendEntry key={item.kind} item={item} />
            ))}
          </View>

          {view.detail && (
            <ThemedText type="small">{view.detail}</ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ChevronButton({ name, label, enabled, onPress }: { name: 'chevron-left' | 'chevron-right'; label: string; enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      hitSlop={Spacing.one}
      style={[styles.chevron, !enabled && styles.disabled]}>
      <MaterialIcons name={name} size={28} color={theme.text} />
    </Pressable>
  );
}

/** A legend sample: the shape beside its word. The samples repeat the cell shapes (filled with a check, outlined), never colour alone. */
function LegendEntry({ item }: { item: LegendItem }) {
  const accent = useGymAccentColor();
  const lit = item.kind === 'visit';
  return (
    <View accessible accessibilityLabel={item.label} style={styles.legendEntry}>
      <View
        style={[
          styles.legendSwatch,
          lit ? { backgroundColor: accent, borderColor: accent } : { borderColor: accent, borderWidth: 2 },
        ]}>
        {lit && <MaterialIcons name="check" size={12} color={getContrastTextColor(accent)} />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {item.label}
      </ThemedText>
    </View>
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
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthLabel: {
    flex: 1,
    textAlign: 'center',
  },
  chevron: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  gridCard: {
    padding: Spacing.two,
    gap: Spacing.two,
  },
  banner: {
    paddingHorizontal: Spacing.one,
  },
  message: {
    gap: Spacing.three,
    padding: Spacing.two,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  legendSwatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
