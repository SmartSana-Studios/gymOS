import { StyleSheet, View } from 'react-native';

import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { MINI_CELL_SIZE, type MiniCell } from '@/lib/celebrationView';

/** Story 30.7 (MA-20): the read-only mini month of the celebration card. Lit days only: 28pt cells, no numerals, no at-risk state, nothing to tap.
 * Decorative: a screen reader skips it (`accessibilityRole: 'none'`). Layout only: `rows` come from lib/celebrationView.ts (buildMiniMonth). */
export function CelebrationMiniMonth({ rows }: { rows: MiniCell[][] }) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  return (
    <View accessibilityRole="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.grid}>
      {rows.map((row, index) => (
        <View key={index} style={styles.row}>
          {row.map((cell, column) => (
            <View
              key={column}
              style={[
                styles.cell,
                cell.date === null ? styles.blank : cell.lit ? { backgroundColor: accent, borderColor: accent } : { borderColor: theme.border },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 4,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  cell: {
    width: MINI_CELL_SIZE,
    height: MINI_CELL_SIZE,
    borderRadius: 8,
    borderWidth: 1,
  },
  blank: {
    borderWidth: 0,
  },
});
