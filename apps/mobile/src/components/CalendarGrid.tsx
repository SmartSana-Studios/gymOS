import { StyleSheet, View } from 'react-native';

import { CalendarDayCell, CELL_SIZE } from '@/components/CalendarDayCell';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { SKELETON_CELLS, type WeekView } from '@/lib/calendarView';
import { DAYS_IN_WEEK } from '@/lib/calendarGrid';
import { Spacing } from '@/constants/theme';

/** Story 30.5 / MA-18: the Monday-first weekday header and the rows of day cells, inside the screen's flat Card. Layout only. Each row opens with its
 * group label ("Week of 10 November, 3 visit days"); the weekday header is decoration (every cell carries its full date in its label). */
export function CalendarGrid({ weekdays, weeks, onPressDay }: { weekdays: string[]; weeks: WeekView[]; onPressDay: (date: string) => void }) {
  return (
    <View style={styles.grid}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.row}>
        {weekdays.map((letter, index) => (
          <View key={index} style={styles.headerCell}>
            <ThemedText type="small" themeColor="textSecondary">
              {letter}
            </ThemedText>
          </View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week.key} style={styles.row}>
          {/* The row's group label: a screen reader meets it just before the row's cells. It takes no room on screen. */}
          <ThemedText type="small" style={styles.groupLabel}>
            {week.accessibilityLabel}
          </ThemedText>
          {week.cells.map((cell, index) =>
            cell.kind === 'blank' ? (
              <View key={index} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.blank} />
            ) : (
              <CalendarDayCell key={cell.date} cell={cell} onPress={onPressDay} />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** 35 rounded squares while a month loads. Hidden from a screen reader. */
export function CalendarSkeleton() {
  const theme = useTheme();
  const rows = SKELETON_CELLS / DAYS_IN_WEEK;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.grid}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: DAYS_IN_WEEK }, (_, col) => (
            <View key={col} style={[styles.skeletonCell, { backgroundColor: theme.border }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  groupLabel: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  blank: {
    flex: 1,
    height: CELL_SIZE,
    minWidth: 0,
  },
  skeletonCell: {
    flex: 1,
    height: CELL_SIZE,
    minWidth: 0,
    borderRadius: 10,
    opacity: 0.4,
  },
});
