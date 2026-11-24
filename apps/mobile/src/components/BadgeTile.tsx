import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import type { BadgeTileView } from '@/lib/badgesView';

const TILE_MIN_HEIGHT = 132;

/** Story 31.3 (MA-21): one badge tile. Earned: the 48 pt accent chip with the badge glyph and a check at the corner, the name and "Earned 14 Oct".
 * Locked: a border outline, the glyph in neutral, no check, no lock, the name and the progress line (the progress line is the message). The shape
 * (a check, an outline) always accompanies the colour. Layout only: `tile` (lib/badgesView.ts) holds every word. */
export function BadgeTile({ tile, onPress }: { tile: BadgeTileView; onPress: () => void }) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  return (
    <View style={styles.cell}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tile.accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: tile.earned ? theme.surface : 'transparent', borderColor: tile.earned ? accent : theme.border },
          pressed && styles.pressed,
        ]}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chipRow}>
          <IconChip icon={tile.glyph} tint={tile.earned ? 'accent' : 'neutral'} size="tile" />
          {tile.earned && (
            <View style={[styles.check, { backgroundColor: accent, borderColor: theme.background }]}>
              <MaterialIcons name="check" size={12} color={theme.background} />
            </View>
          )}
        </View>
        <ThemedText type="smallBold">{tile.name}</ThemedText>
        {tile.line !== '' && (
          <ThemedText type="small" themeColor="textSecondary">
            {tile.line}
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

/** Five placeholders of the tile's size while the first load runs. */
export function BadgeTileSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.cell}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.tile, styles.skeleton, { backgroundColor: theme.surface, borderColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Two equal columns whatever the number of tiles: a cell is half the row (never grows, so the lone fifth tile keeps its column) and carries half
  // the gap as padding on each side; the grid pulls its edges back by the same amount.
  cell: {
    width: '50%',
    padding: Spacing.three / 2,
  },
  tile: {
    flex: 1,
    minHeight: TILE_MIN_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.85,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.one,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -12,
    marginTop: -6,
  },
  skeleton: {
    opacity: 0.6,
  },
});
