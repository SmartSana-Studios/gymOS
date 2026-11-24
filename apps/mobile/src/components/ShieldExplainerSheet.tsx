import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ShieldExplainerView } from '@/lib/shieldView';

/** Story 31.1 / MA-09: the Shield explainer. A slide-up sheet (RN `Modal`, the LogEntrySheet precedent) with the title, the body and [Got it]. A tap
 * on the dimmed area, [Got it] and the Android back button all close it. Layout only: `view` (lib/shieldView.ts) holds every word. */
export function ShieldExplainerSheet({ visible, view, onClose }: { visible: boolean; view: ShieldExplainerView; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessible={false} style={styles.backdrop} onPress={onClose} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.content}>
            <ThemedText type="subtitle" accessibilityRole="header">
              {view.title}
            </ThemedText>
            <ThemedText type="default">{view.body}</ThemedText>
            <Button label={view.gotIt} onPress={onClose} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
