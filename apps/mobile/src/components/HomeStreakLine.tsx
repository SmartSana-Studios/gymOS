import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HomeStreakLineView } from '@/lib/homeStreakLine';

/** Story 31.4: the one small streak row on Home. It replaces the This week section and the Leaderboard card (both now on the Streak tab) and opens that tab.
 * One row, 44 pt target (the chip is 36, the row a minimum of 44). Layout only: `line` (lib/homeStreakLine.ts) holds the words. */
export function HomeStreakLine({ line, onPress }: { line: HomeStreakLineView; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={line.accessibilityLabel} onPress={onPress} style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <IconChip icon="local-fire-department" tint="accent" />
      </View>
      <ThemedText type="smallBold" style={styles.text}>
        {line.text}
      </ThemedText>
      <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  text: {
    flex: 1,
  },
});
