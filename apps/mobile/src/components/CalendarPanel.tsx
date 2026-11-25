import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { AtRiskHint } from '@/components/AtRiskHint';
import { CalendarGrid, CalendarSkeleton } from '@/components/CalendarGrid';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';
import type { CalendarView, LegendItem } from '@/lib/calendarView';

const SWIPE_DISTANCE = 50;

export interface CalendarPanelProps {
  view: CalendarView;
  refresh: () => Promise<void>;
  shift: (delta: -1 | 1) => void;
  selectDay: (date: string) => void;
  /** Story 31.4: the Streak tab already shows the at-risk hint in its ring section, so it asks the panel to leave its own copy out (one announcement per
   * screen). The full screen leaves it on. */
  hideAtRiskHint?: boolean;
}

/** Story 31.4: the attendance calendar body (month bar, summary, grid, at-risk hint, legend, selected-day line), extracted unchanged from app/calendar.tsx so
 * the full screen (`/calendar`, still reachable from Profile) and the Streak tab render the same thing. Layout only: the hook (hooks/use-calendar.ts) loads
 * and sequences and the view model (lib/calendarView.ts) decides every state and every word; the caller owns the hook, the header and the pull to refresh. */
export function CalendarPanel({ view, refresh, shift, selectDay, hideAtRiskHint = false }: CalendarPanelProps) {
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
    <View style={styles.panel}>
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

      {/* Mounted whenever today is at risk, hidden off the current month: its announcement and pulse run once per screen focus, not on every
          return from another month. */}
      {!hideAtRiskHint && view.atRiskHint && (
        <View style={view.atRiskLine ? undefined : styles.hidden}>
          <AtRiskHint hint={view.atRiskHint} />
        </View>
      )}

      <View style={styles.legend}>
        {view.legend.map((item) => (
          <LegendEntry key={item.kind} item={item} />
        ))}
      </View>

      {view.detail && <ThemedText type="small">{view.detail}</ThemedText>}
    </View>
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
  const theme = useTheme();
  const lit = item.kind === 'visit' || item.kind === 'milestone';
  const shield = item.kind === 'shield';
  return (
    <View accessible accessibilityLabel={item.label} style={styles.legendEntry}>
      <View
        style={[
          styles.legendSwatch,
          lit ? { backgroundColor: accent, borderColor: accent } : shield ? { borderColor: theme.border } : { borderColor: accent, borderWidth: 2 },
        ]}>
        {lit && <MaterialIcons name={item.kind === 'milestone' ? 'star' : 'check'} size={12} color={getContrastTextColor(accent)} />}
        {shield && <MaterialIcons name="shield" size={12} color={accent} />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {item.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.three,
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
  hidden: {
    display: 'none',
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
