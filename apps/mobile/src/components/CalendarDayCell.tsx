import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { WARNING_COLOR } from '@/components/GoalRing';
import { ThemedText } from '@/components/themed-text';
import { useAtRiskPulse } from '@/hooks/use-at-risk-pulse';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';
import type { DayCellView } from '@/lib/calendarView';

export const CELL_SIZE = 44;
const OUTLINE = 2;
const RADIUS = 10;
/** Story 30.7: the milestone star badge, 14pt, in the top-left corner (the check or schedule glyph holds the top-right one). */
const STAR_SIZE = 14;
/** Story 31.1: the Shield glyph of a Shield-saved week, 12pt, in the bottom-right corner (the top corners hold the star and the check, the bottom centre the hours). */
const SHIELD_SIZE = 12;

/** Story 30.5 / `components.calendarDayCell`: one day of the month grid. Layout only: `cell` (lib/calendarView.ts) holds every state and every word.
 * Shape or glyph always accompanies colour: a lit day is filled with a check, today carries a 2pt outline (accent, dashed while a visit waits to sync,
 * warning with a `schedule` glyph and the hours left when at risk), a future day is faded and cannot be tapped. A milestone day (Story 30.7) adds a star badge: a shape, with the words in the cell's label. */
export function CalendarDayCell({ cell, onPress }: { cell: DayCellView; onPress: (date: string) => void }) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const onAccent = getContrastTextColor(accent);

  const body = (
    <>
      {cell.atRisk ? <PulsingOutline /> : cell.outline !== 'none' && <Outline style={cell.outline === 'dashed' ? 'dashed' : 'solid'} color={accent} />}
      {cell.selected && <View pointerEvents="none" style={[styles.focusRing, { borderColor: theme.text }]} />}
      <ThemedText
        type={cell.bold ? 'smallBold' : 'small'}
        themeColor={cell.bold ? 'text' : 'textSecondary'}
        style={cell.lit ? { color: onAccent } : undefined}>
        {cell.numeral}
      </ThemedText>
      {cell.glyph && (
        <View style={styles.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialIcons name={cell.glyph} size={12} color={cell.glyph === 'schedule' ? WARNING_COLOR : onAccent} />
        </View>
      )}
      {cell.milestone !== null && (
        <View style={styles.star} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialIcons name="star" size={STAR_SIZE} color={onAccent} />
        </View>
      )}
      {cell.shield && (
        <View style={styles.shield} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MaterialIcons name="shield" size={SHIELD_SIZE} color={cell.lit ? onAccent : accent} />
        </View>
      )}
      {cell.hoursText && (
        <ThemedText style={[styles.hours, { color: WARNING_COLOR }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {cell.hoursText}
        </ThemedText>
      )}
    </>
  );

  const frame = [
    styles.cell,
    cell.lit ? { backgroundColor: accent, borderColor: accent } : { backgroundColor: 'transparent', borderColor: theme.border },
    cell.faded && styles.faded,
  ];

  if (!cell.tappable) {
    return (
      <View accessible accessibilityLabel={cell.accessibilityLabel} accessibilityState={{ disabled: true }} style={frame}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel}
      accessibilityState={{ selected: cell.selected }}
      onPress={() => onPress(cell.date)}
      style={frame}>
      {body}
    </Pressable>
  );
}

/** Today's outline in the gym colour: solid, or dashed while a visit is queued on this phone. */
function Outline({ style, color }: { style: 'solid' | 'dashed'; color: string }) {
  return <View pointerEvents="none" style={[styles.outline, { borderColor: color, borderStyle: style }]} />;
}

/** The at-risk cell's 2pt warning outline: it pulses three times on focus (the shared `atRiskPulse`), then stays; with reduce-motion on it never moves. */
function PulsingOutline() {
  const { opacity } = useAtRiskPulse();
  return <Animated.View pointerEvents="none" style={[styles.outline, { borderColor: WARNING_COLOR, opacity }]} />;
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    height: CELL_SIZE,
    minWidth: 0,
    borderRadius: RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: {
    opacity: 0.4,
  },
  outline: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderWidth: OUTLINE,
    borderRadius: RADIUS,
  },
  focusRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: OUTLINE,
    borderRadius: RADIUS + 3,
  },
  glyph: {
    position: 'absolute',
    top: 2,
    right: 2,
  },
  star: {
    position: 'absolute',
    top: 1,
    left: 1,
  },
  shield: {
    position: 'absolute',
    bottom: 1,
    right: 1,
  },
  hours: {
    position: 'absolute',
    bottom: 1,
    fontFamily: 'Barlow_600SemiBold',
    fontSize: 10,
    lineHeight: 12,
  },
});
