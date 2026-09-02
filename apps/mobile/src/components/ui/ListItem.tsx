import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { ThemedText } from '@/components/themed-text';
import { IconChip, type IconChipTint } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';

export interface ListItemProps {
  icon: MaterialIconsIconName;
  tint: IconChipTint;
  title: string;
  meta?: string;
  /** Custom trailing control (a Switch, a segmented toggle) -- takes
   * precedence over `meta` when given. Story 15.4's addition; Story 15.3's
   * existing meta-only call sites are unaffected. */
  trailing?: ReactNode;
  onPress?: () => void;
}

/** A single row only -- does not wrap itself in a Card and renders no
 * inter-row divider. Grouping multiple ListItems inside one shared `flat`
 * Card is the composing screen's job (Stories 15.3/15.4), not this
 * component's. */
export function ListItem({ icon, tint, title, meta, trailing, onPress }: ListItemProps) {
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={styles.row}>
      <IconChip icon={icon} tint={tint} />
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {trailing ??
        (meta && (
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
        ))}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  title: {
    flex: 1,
  },
});
