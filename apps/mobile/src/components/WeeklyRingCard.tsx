import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AtRiskHint } from '@/components/AtRiskHint';
import { ComebackCard } from '@/components/ComebackCard';
import { GoalRing, WARNING_COLOR } from '@/components/GoalRing';
import { ShieldChip } from '@/components/ShieldChip';
import { ShieldExplainerSheet } from '@/components/ShieldExplainerSheet';
import { ShieldNoticeRow } from '@/components/ShieldNoticeRow';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { RING_DIAMETER, shouldStack, type CardView, type HomeEngagementView, type StreakView } from '@/lib/weeklyRing';

export interface WeeklyRingSectionProps {
  view: HomeEngagementView;
  onGoalPress: () => void;
  /** Tapping the one-time default-goal hint dismisses it. */
  onGoalHintPress: () => void;
  /** The whole card opens the calendar (Story 30.5). The goal button and the goal hint above it stay separate targets. */
  onPressCard: () => void;
  /** Story 31.1: the member dismissed the Shield notice row with this id. */
  onDismissNotice: (id: string) => void;
}

/** Story 30.4 / MA-09 N1: the Home "This week" section: heading row, goal button, then one flat Card with the Goal Ring, the streak area, the caption
 * and the footer. Layout only: `view` (lib/weeklyRing.ts) holds every decision and every word. The card is one button that opens the calendar (Story
 * 30.5, `onPressCard`); the skeleton and the error face are not. Story 31.1 adds, BESIDE that button (siblings, so their taps never open the calendar), the Shield
 * chip with its next-Shield line, one notice row and the comeback card; the daily chip stays unrendered. */
export function WeeklyRingSection({ view, onGoalPress, onGoalHintPress, onPressCard, onDismissNotice }: WeeklyRingSectionProps) {
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

      {view.kind === 'card' ? (
        // The whole card is one button: its label carries the ring sentence and the at-risk sentence, so nothing a screen reader read before is lost.
        <Pressable accessibilityRole="button" accessibilityLabel={view.cardLabel} accessibilityHint={view.cardHint} onPress={onPressCard}>
          <Card variant="flat" style={styles.card}>
            <CardBody view={view} />
          </Card>
        </Pressable>
      ) : (
        <Card variant="flat" style={styles.card}>
          {view.kind === 'skeleton' && <CardSkeleton />}
          {view.kind === 'error' && (
            <ThemedText type="small" themeColor="textSecondary">
              {view.message}
            </ThemedText>
          )}
        </Card>
      )}

      {view.kind === 'card' && <ShieldArea view={view} onDismissNotice={onDismissNotice} />}
    </View>
  );
}

/** Story 31.1: everything Shield and comeback under the card. The chip and the line sit in one row; the explainer sheet opens from the chip. */
function ShieldArea({ view, onDismissNotice }: { view: CardView; onDismissNotice: (id: string) => void }) {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const { chip, nextLine, notice, explainer, comeback } = view.shield;
  return (
    <>
      {(chip || nextLine) && (
        <View style={styles.shieldRow}>
          {chip && <ShieldChip chip={chip} onPress={() => setExplainerOpen(true)} />}
          {nextLine && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.shieldLine}>
              {nextLine}
            </ThemedText>
          )}
        </View>
      )}
      {notice && <ShieldNoticeRow notice={notice} onDismiss={onDismissNotice} />}
      {comeback && <ComebackCard view={comeback} />}
      {chip && <ShieldExplainerSheet visible={explainerOpen} view={explainer} onClose={() => setExplainerOpen(false)} />}
    </>
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
  shieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
  },
  shieldLine: {
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
