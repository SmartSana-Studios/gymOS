import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import type { GapView, RowView } from '@/lib/leaderboardView';

/** Story 30.6 (MA-19): one row of the board, and the separator where positions are not consecutive. Layout only: `row` (lib/leaderboardView.ts) holds
 * every word and every number, all of them the server's. Rows are not tappable (no profile exists to open, no id reaches the device), and rank 1 to 3
 * get no crown, medal or colour (FR-228). The member's own row carries a 2pt accent border and the word "You", so it never rests on colour alone. */
export function LeaderboardRow({ row }: { row: RowView }) {
  const accent = useGymAccentColor();
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={row.accessibilityLabel}
      style={[styles.row, { borderColor: row.isSelf ? accent : 'transparent', borderWidth: row.isSelf ? 2 : 0 }]}>
      <View style={styles.main}>
        <ThemedText type="smallBold" style={styles.rank}>
          {row.rankText}
        </ThemedText>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <IconChip icon={row.icon} tint="neutral" />
        </View>
        <View style={styles.text}>
          <View style={styles.labelLine}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.label}>
              {row.label}
            </ThemedText>
            {row.selfTag && (
              <View style={[styles.tag, { borderColor: accent }]}>
                <ThemedText type="small">{row.selfTag}</ThemedText>
              </View>
            )}
            {row.tied && (
              <ThemedText type="small" themeColor="textSecondary">
                {row.tied}
              </ThemedText>
            )}
          </View>
          {row.hiddenSelf && (
            <ThemedText type="small" themeColor="textSecondary">
              {row.hiddenSelf}
            </ThemedText>
          )}
        </View>
        <ThemedText type="small" style={styles.visits}>
          {row.visitsText}
        </ThemedText>
      </View>
      {row.below && (
        <ThemedText type="small" themeColor="textSecondary" style={[styles.below, { color: theme.textSecondary }]}>
          {row.below}
        </ThemedText>
      )}
    </View>
  );
}

export function LeaderboardGap({ gap }: { gap: GapView }) {
  const theme = useTheme();
  return (
    <View accessible accessibilityLabel={gap.accessibilityLabel} style={styles.gap}>
      <MaterialIcons name="more-horiz" size={20} color={theme.textSecondary} />
    </View>
  );
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/** Six rows of 56pt while the board loads. */
export function LeaderboardSkeleton() {
  const theme = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SKELETON_ROWS.map((i) => (
        <View key={i} style={[styles.row, styles.skeletonRow]}>
          <View style={[styles.skeletonBar, { backgroundColor: theme.surfaceElevated }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rank: {
    width: 32,
    fontVariant: ['tabular-nums'],
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  labelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  label: {
    flexShrink: 1,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.one,
  },
  visits: {
    textAlign: 'right',
  },
  below: {
    paddingLeft: 32 + Spacing.two,
    paddingTop: Spacing.one,
  },
  gap: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonRow: {
    justifyContent: 'center',
  },
  skeletonBar: {
    height: 36,
    borderRadius: 8,
  },
});
