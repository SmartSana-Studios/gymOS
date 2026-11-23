import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import type { NoticeChoice, NoticeView } from '@/lib/leaderboardView';

/** Story 30.6 (MA-19, FR-227): the first-open notice, ONE component for both places it appears (in place on /leaderboard, and in a full-screen modal
 * from Profile). Opaque and full height, with no swipe or tap-outside dismissal of its own (the callers own the way out: the header back arrow and
 * Android back, which leave without marking anything). Two buttons of equal weight stacked, neither pre-selected; while a call runs both are
 * disabled and the pressed one shows a spinner. Layout only: `view` holds every word. */
export function LeaderboardNotice({ view, onChoose }: { view: NoticeView; onChoose: (choice: NoticeChoice) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chip}>
        <IconChip icon="groups" tint="primary" />
      </View>
      <ThemedText type="subtitle" accessibilityRole="header">
        {view.title}
      </ThemedText>
      <ThemedText type="default">{view.body}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {view.until}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {view.change}
      </ThemedText>

      {view.error && (
        <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {view.error}
        </ThemedText>
      )}
      {view.offlineNote && (
        <ThemedText type="small" themeColor="textSecondary">
          {view.offlineNote}
        </ThemedText>
      )}

      <View style={styles.buttons}>
        <Button label={view.showLabel} variant="primary" loading={view.busy === 'show'} disabled={view.disabled} onPress={() => onChoose('show')} />
        <Button label={view.hideLabel} variant="secondary" loading={view.busy === 'hide'} disabled={view.disabled} onPress={() => onChoose('hide')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  chip: {
    alignSelf: 'flex-start',
  },
  buttons: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
});
