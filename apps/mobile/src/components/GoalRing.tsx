import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { G, Path, Svg } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { STATUS_COLORS } from '@/constants/subscription-status';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { arcPaths, RING_DIAMETER, RING_STROKE, type RingView } from '@/lib/weeklyRing';

/** The semantic success green of the dark theme (subscription-status.ts has no key named `success`: `active` is that hue). */
export const SUCCESS_COLOR = STATUS_COLORS.active.text;
/** The semantic warning amber. */
export const WARNING_COLOR = STATUS_COLORS.expiring_soon.text;

const DASH = [6, 4];

/** Story 30.4 / `components.goalRing`: a 120pt ring of `goal` equal arc segments. Read-only, no logic: the view model decides every segment and every
 * word. The ring is ONE accessibility element (role progressbar, value min 0, max goal, now visits, a sentence for a label); the arcs, the numeral and
 * the check glyph are decorative to a screen reader. Colour is never alone: the met state carries a check glyph, a queued scan a dashed outline. */
export function GoalRing({ ring }: { ring: RingView }) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const paths = useMemo(() => arcPaths(ring.goal), [ring.goal]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={ring.accessibilityLabel}
      accessibilityValue={ring.accessibilityValue}
      style={styles.ring}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.fill}>
        <Svg width={RING_DIAMETER} height={RING_DIAMETER}>
          {paths.map((d, index) => {
            const kind = ring.segments[index];
            // An empty or dashed segment sits on a border-coloured track; a dashed one adds the accent dashes over it.
            return (
              <G key={index}>
                <Path d={d} stroke={kind === 'filled' ? accent : kind === 'success' ? SUCCESS_COLOR : theme.border} strokeWidth={RING_STROKE} fill="none" />
                {kind === 'dashed' && <Path d={d} stroke={accent} strokeWidth={RING_STROKE} strokeDasharray={DASH} fill="none" />}
              </G>
            );
          })}
        </Svg>
        <View style={styles.centre}>
          {ring.met && <MaterialIcons name="check" size={18} color={SUCCESS_COLOR} />}
          <ThemedText type="statNumeral">{ring.centre}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {ring.unit}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
  },
  fill: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
  },
  centre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
