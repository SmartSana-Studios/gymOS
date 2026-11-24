import { StyleSheet, View } from 'react-native';

import { StampSegments } from '@/components/StampSegments';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import type { ComebackView } from '@/lib/shieldView';

/** Story 31.1 / MA-09 N2: the comeback card under the "This week" card. Phases (from the view): empty stamp segments with no numeral, "1 / 3" with its
 * accessible label, the lapsed restart line (no warning, no red), and the one-time restored message. The figures are the server's; the best streak is
 * drawn as a `statNumeral`. One accessible element: the view's sentence. Layout only. */
export function ComebackCard({ view }: { view: ComebackView }) {
  const accent = useGymAccentColor();
  const restored = view.restored;
  return (
    <Card variant="flat" style={styles.card}>
      <View accessible accessibilityLabel={view.accessibilityLabel} style={styles.body}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.body}>
          <ThemedText type="smallBold">{restored ? restored.title : view.title}</ThemedText>
          {restored ? (
            <ThemedText type="small" themeColor="textSecondary">
              {restored.body}
            </ThemedText>
          ) : (
            <>
              {view.best && (
                <ThemedText type="small" themeColor="textSecondary">
                  {view.best.before}
                  {view.best.numeral ? <ThemedText type="statNumeral">{view.best.numeral}</ThemedText> : null}
                  {view.best.after}
                </ThemedText>
              )}
              {view.goalLine && <ThemedText type="small">{view.goalLine}</ThemedText>}
              {view.segments && (
                <View style={styles.segmentsRow}>
                  {view.numeral && <ThemedText type="smallBold">{view.numeral}</ThemedText>}
                  <View style={styles.segments}>
                    <StampSegments total={view.segments.total} done={view.segments.done} dashed={view.segments.dashed} color={accent} />
                  </View>
                </View>
              )}
              {view.restartLine && <ThemedText type="small">{view.restartLine}</ThemedText>}
            </>
          )}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  body: { gap: Spacing.one },
  segmentsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  segments: { flex: 1 },
});
