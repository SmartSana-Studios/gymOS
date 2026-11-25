import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconChip } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ShieldNoticeView } from '@/lib/shieldView';

/** Story 31.1 / MA-09: one dismissible notice row ("Shield saved", "Shield earned") under the "This week" card. The sentence is the view's; the close
 * target is 44pt and labelled with the shared `common.close`. No red tint: calm, with the Shield glyph. */
export function ShieldNoticeRow({ notice, onDismiss }: { notice: ShieldNoticeView; onDismiss: (id: string) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={[styles.row, { borderColor: theme.border }]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <IconChip icon="shield" tint="accent" />
      </View>
      <ThemedText type="small" style={styles.text}>
        {notice.text}
      </ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => onDismiss(notice.id)} hitSlop={Spacing.one} style={styles.close}>
        <MaterialIcons name="close" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: Spacing.two,
    minHeight: 52,
  },
  text: {
    flex: 1,
    paddingVertical: Spacing.two,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
