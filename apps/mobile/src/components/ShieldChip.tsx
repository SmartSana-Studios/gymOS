import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import type { ShieldChipView } from '@/lib/shieldView';

/** Story 31.1 / MA-09: the Shield chip (glyph `shield` and the count). A 44pt target that opens the explainer sheet. It sits BESIDE the "This week"
 * card's outer button, never inside it, so a tap on it cannot open the calendar. Layout only: `chip` (lib/shieldView.ts) holds the words. */
export function ShieldChip({ chip, onPress }: { chip: ShieldChipView; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={chip.accessibilityLabel} onPress={onPress} hitSlop={Spacing.one} style={styles.chip}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <IconChip icon="shield" tint="accent" />
      </View>
      <ThemedText type="smallBold" style={styles.text}>
        {chip.label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    minWidth: 44,
  },
  text: {
    flexShrink: 1,
  },
});
