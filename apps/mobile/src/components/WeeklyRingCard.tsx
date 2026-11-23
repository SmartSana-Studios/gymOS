import { useFocusEffect } from 'expo-router';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { GoalRing, WARNING_COLOR } from '@/components/GoalRing';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RING_DIAMETER, shouldStack, type CardView, type HintView, type HomeEngagementView, type StreakView } from '@/lib/weeklyRing';

const PULSE_CYCLES = 3;
const PULSE_HALF_MS = 800;
const PULSE_LOW = 0.45;

export interface WeeklyRingSectionProps {
  view: HomeEngagementView;
  onGoalPress: () => void;
  /** Tapping the one-time default-goal hint dismisses it. */
  onGoalHintPress: () => void;
}

/** Story 30.4 / MA-09 N1: the Home "This week" section: heading row, goal button, then one flat Card with the Goal Ring, the streak area, the caption
 * and the footer. Layout only: `view` (lib/weeklyRing.ts) holds every decision and every word. The card is not tappable as a whole yet (the calendar
 * route arrives with Story 30.5, which adds its onPress). The Epic 31 slots (Shield chip, comeback card, daily chip, next-Shield line) render nothing. */
export function WeeklyRingSection({ view, onGoalPress, onGoalHintPress }: WeeklyRingSectionProps) {
  const theme = useTheme();
  if (view.kind === 'hidden') return null;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <ThemedText type="smallBold" accessibilityRole="header">
          {view.title}
        </ThemedText>
        {view.kind === 'card' && (
          <Pressable accessibilityRole="button" onPress={onGoalPress} hitSlop={Spacing.one} style={styles.goalButton}>
            <MaterialIcons name="edit" size={16} color={theme.textSecondary} />
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.goalButtonText}>
              {view.goalButton.label}
            </ThemedText>
          </Pressable>
        )}
      </View>

      {view.kind === 'card' && view.goalHint && (
        <Pressable accessibilityRole="button" onPress={onGoalHintPress}>
          <ThemedText type="small" themeColor="textSecondary">
            {view.goalHint}
          </ThemedText>
        </Pressable>
      )}

      <Card variant="flat" style={styles.card}>
        {view.kind === 'skeleton' && <CardSkeleton />}
        {view.kind === 'error' && (
          <ThemedText type="small" themeColor="textSecondary">
            {view.message}
          </ThemedText>
        )}
        {view.kind === 'card' && <CardBody view={view} />}
      </Card>
    </View>
  );
}

function CardBody({ view }: { view: CardView }) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = shouldStack(width, fontScale);

  return (
    <View style={styles.body}>
      <View style={[styles.main, stacked ? styles.mainStacked : styles.mainRow]}>
        <GoalRing ring={view.ring} />
        <View style={[styles.text, stacked && styles.textStacked]}>
          <StreakArea streak={view.streak} />
          <ThemedText type="small">{view.caption}</ThemedText>
          {view.pendingSyncNote && (
            <View style={styles.noteRow}>
              <MaterialIcons name="sync" size={16} color={WARNING_COLOR} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.noteText}>
                {view.pendingSyncNote}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
      {view.hint && <AtRiskHint hint={view.hint} />}
      {view.settleError && (
        <ThemedText type="small" themeColor="textSecondary">
          {view.settleError}
        </ThemedText>
      )}
    </View>
  );
}

function StreakArea({ streak }: { streak: StreakView }) {
  if (streak.kind === 'none') return null;
  if (streak.kind === 'chip') {
    return (
      <View accessible accessibilityLabel={streak.label} style={styles.chipRow}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <IconChip icon="local-fire-department" tint="accent" />
        </View>
        <ThemedText type="smallBold" style={styles.chipText}>
          {streak.label}
        </ThemedText>
      </View>
    );
  }
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {streak.label}
    </ThemedText>
  );
}

/** The footer hint: glyph `schedule`, the line, the hours left. It pulses three times on each focus, then stays still; with reduce-motion on it never
 * animates and a static 2pt warning outline carries the emphasis. It is announced once per focus through a polite live region (Android) or an
 * announcement (iOS), never as an alert, and the announced text is frozen at focus time so the minutes ticking do not announce again. */
function AtRiskHint({ hint }: { hint: HintView }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const labelRef = useRef(hint.label);
  useEffect(() => {
    labelRef.current = hint.label;
  });

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Announced once per focus: stable deps only, so the late answer of the reduce-motion query cannot announce it again.
  useFocusEffect(
    useCallback(() => {
      setAnnouncement(labelRef.current);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(labelRef.current);
      return () => setAnnouncement('');
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        opacity.setValue(1);
        return;
      }
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: PULSE_LOW, duration: PULSE_HALF_MS, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: PULSE_HALF_MS, useNativeDriver: true }),
        ]),
        { iterations: PULSE_CYCLES },
      );
      pulse.start();
      return () => {
        pulse.stop();
        opacity.setValue(1);
      };
    }, [reduceMotion, opacity]),
  );

  return (
    <View>
      <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
        <ThemedText type="small">{announcement}</ThemedText>
      </View>
      <Animated.View
        accessible
        accessibilityLabel={hint.label}
        style={[styles.hint, { opacity, borderColor: reduceMotion ? WARNING_COLOR : 'transparent' }]}>
        <MaterialIcons name="schedule" size={20} color={WARNING_COLOR} />
        <ThemedText type="small" style={[styles.hintText, { color: WARNING_COLOR }]}>
          {hint.text} {hint.timeLeft}
        </ThemedText>
      </Animated.View>
    </View>
  );
}

function CardSkeleton() {
  const theme = useTheme();
  const block = { backgroundColor: theme.border };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.skeleton}>
      <View style={[styles.skeletonCircle, block]} />
      <View style={styles.skeletonLines}>
        <View style={[styles.skeletonLine, block, { width: '70%' }]} />
        <View style={[styles.skeletonLine, block, { width: '45%' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  goalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    flexShrink: 1,
    paddingLeft: Spacing.two,
  },
  goalButtonText: {
    flexShrink: 1,
  },
  card: {
    minHeight: 168,
    justifyContent: 'center',
  },
  body: {
    gap: Spacing.three,
  },
  main: {
    gap: Spacing.three,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mainStacked: {
    alignItems: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.two,
  },
  textStacked: {
    flex: 0,
    alignSelf: 'stretch',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chipText: {
    flexShrink: 1,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  noteText: {
    flexShrink: 1,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  hintText: {
    flexShrink: 1,
  },
  liveRegion: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  skeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  skeletonCircle: {
    width: RING_DIAMETER,
    height: RING_DIAMETER,
    borderRadius: RING_DIAMETER / 2,
    opacity: 0.5,
  },
  skeletonLines: {
    flex: 1,
    gap: Spacing.two,
  },
  skeletonLine: {
    height: 14,
    borderRadius: Spacing.one,
    opacity: 0.5,
  },
});
