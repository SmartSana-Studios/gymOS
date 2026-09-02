import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons, type MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { ThemedText } from '@/components/themed-text';
import { IconChip, type IconChipTint } from '@/components/ui/IconChip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ListItemProps {
  icon: MaterialIconsIconName;
  tint: IconChipTint;
  title: string;
  meta?: string;
  /** Custom trailing control (a Switch, a segmented toggle) -- takes
   * precedence over `meta` when explicitly given, including `null` (pass
   * `undefined`/omit the prop, not `null`, to fall through to `meta`).
   * Story 15.4's addition; Story 15.3's existing meta-only call sites are
   * unaffected. Not in Story 15.2's original spec -- added in the same
   * commit ahead of Story 15.4 actually needing it; documented here during
   * code review (2026-09-02). */
  trailing?: ReactNode;
  onPress?: () => void;
}

/** A single row only -- does not wrap itself in a Card and renders no
 * inter-row divider. Grouping multiple ListItems inside one shared `flat`
 * Card is the composing screen's job (Stories 15.3/15.4), not this
 * component's. */
// Review finding: every current call site only ever passes `meta` a
// timestamp-shaped label, a literal '→' (navigate), or a literal '×'
// (cancel) -- the latter two rendered as plain glyph characters read as an
// unpolished, font-dependent afterthought next to IconChip's actual
// MaterialIcons glyphs elsewhere in the same row. Rendering those two exact
// values as real icons (same set, same subdued `textSecondary` tone, no
// background/border -- deliberately quiet, not another chip) instead is a
// drop-in visual upgrade with no call-site changes: `meta` stays a plain
// string prop, this is purely how those two specific values render.
const META_ICONS: Record<string, MaterialIconsIconName> = {
  '→': 'chevron-right',
  '×': 'close',
};

export function ListItem({ icon, tint, title, meta, trailing, onPress }: ListItemProps) {
  const theme = useTheme();
  const Wrapper = onPress ? Pressable : View;
  const metaIcon = meta ? META_ICONS[meta] : undefined;

  return (
    <Wrapper accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <IconChip icon={icon} tint={tint} />
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {trailing !== undefined ? (
        trailing
      ) : metaIcon ? (
        <MaterialIcons name={metaIcon} size={20} color={theme.textSecondary} />
      ) : (
        meta && (
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
        )
      )}
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
