import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BadgeSheetView } from '@/lib/badgesView';

export interface BadgeDetailSheetProps {
  visible: boolean;
  view: BadgeSheetView | null;
  /** The inline share message above the buttons (`engage.share.error` or `.unavailable`), or null. */
  message: string | null;
  retryLabel: string | null;
  sharing: boolean;
  onShare: () => void;
  onClose: () => void;
  /** The Share button's ref, so the iPad share sheet anchors to it. */
  shareButtonRef: React.RefObject<import('react-native').View | null>;
}

/** Story 31.3 (MA-21): the badge detail bottom sheet, modelled on ShieldExplainerSheet (RN `Modal`, slide up, the dimmed area, [Close] and the Android
 * back button close it). An earned badge shows the large chip, the name, the date and [Share]; a locked one shows the same without Share and with the
 * progress line. Layout only: `view` (lib/badgesView.ts) holds every word. */
export function BadgeDetailSheet({ visible, view, message, retryLabel, sharing, onShare, onClose, shareButtonRef }: BadgeDetailSheetProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible && view !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessible={false} style={styles.backdrop} onPress={onClose} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {view && (
            <View style={styles.content}>
              <View style={styles.hero}>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <IconChip icon={view.glyph} tint={view.earned ? 'accent' : 'neutral'} size="large" />
                </View>
                <ThemedText type="subtitle" accessibilityRole="header" style={styles.centered}>
                  {view.name}
                </ThemedText>
                {view.line !== '' && (
                  <ThemedText type="default" themeColor="textSecondary" style={styles.centered}>
                    {view.line}
                  </ThemedText>
                )}
              </View>
              {message && (
                <View style={styles.message}>
                  <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert" style={styles.centered}>
                    {message}
                  </ThemedText>
                  {retryLabel && <Button label={retryLabel} variant="secondary" onPress={onShare} disabled={sharing} />}
                </View>
              )}
              {view.showShare && (
                <View ref={shareButtonRef} collapsable={false}>
                  <Button label={view.shareLabel} onPress={onShare} loading={sharing} />
                </View>
              )}
              <Button label={view.closeLabel} variant="secondary" onPress={onClose} />
            </View>
          )}
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
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  message: {
    gap: Spacing.two,
  },
});
