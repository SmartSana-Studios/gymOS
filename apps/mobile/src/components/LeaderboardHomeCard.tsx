import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HomeCardView } from '@/lib/leaderboardView';

/** Story 30.6 (MA-09 N3): the Home Leaderboard card. The member's OWN standing only: no names on Home. The card opens /leaderboard; the error face is a
 * retry, not a link. Layout only: `view` holds every word, and the rank and total in it are the server's. */
export function LeaderboardHomeCard({ view, onPress, onRetry }: { view: HomeCardView; onPress: () => void; onRetry: () => void }) {
  const theme = useTheme();
  if (view.kind === 'hidden') return null;

  return (
    <View style={styles.section}>
      {view.kind === 'skeleton' ? (
        <Card variant="flat" style={styles.skeleton} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View />
        </Card>
      ) : view.kind === 'error' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${view.title}. ${view.text}`} onPress={onRetry}>
          <Header title={view.title} chevron={false} />
          <Card variant="flat">
            <ThemedText type="small" themeColor="textSecondary">
              {view.text}
            </ThemedText>
          </Card>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={view.accessibilityLabel} onPress={onPress}>
          <Header title={view.title} chevron />
          <Card variant="flat" style={styles.card}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <IconChip icon="leaderboard" tint="accent" />
            </View>
            <View style={styles.text}>
              <ThemedText type={view.isRank ? 'statNumeral' : 'smallBold'}>{view.headline}</ThemedText>
              {view.line && (
                <ThemedText type="small" themeColor="textSecondary">
                  {view.line}
                </ThemedText>
              )}
              {view.updated && (
                <ThemedText type="small" themeColor="textSecondary">
                  {view.updated}
                </ThemedText>
              )}
            </View>
            <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
          </Card>
        </Pressable>
      )}
    </View>
  );

}

function Header({ title, chevron }: { title: string; chevron: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <ThemedText type="smallBold" accessibilityRole="header">
        {title}
      </ThemedText>
      {chevron && <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  skeleton: {
    height: 72,
  },
});
