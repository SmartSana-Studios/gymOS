import { StyleSheet, View } from 'react-native';
import { MaterialIcons, type MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';

export type IconChipTint = 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

export interface IconChipProps {
  icon: MaterialIconsIconName;
  tint: IconChipTint;
}

/** success/warning/danger/neutral intentionally match subscription-status.ts's
 * STATUS_COLORS.active/expiring_soon/expired/no_plan hex values verbatim --
 * these are the same dark-theme-tuned semantic hues, not a coincidence, so a
 * status glyph moved into a chip (Story 15.3) reads identically to today.
 * `primary` gets its own dedicated hex (not `Brand.primary`/`theme.surfaceElevated`)
 * -- those two are byte-identical in dark mode (theme.ts), so a `primary`-tint
 * chip inside a `Card variant="raised"` would otherwise render invisibly
 * against its own card background; documented as a deviation from this
 * story's original Dev Notes table in docs/decisions.md (code review,
 * 2026-09-02). */
const STATUS_TINTS: Record<'success' | 'warning' | 'danger' | 'neutral' | 'primary', { bg: string; border: string; icon: string }> = {
  success: { bg: '#123321', border: '#1F5C3A', icon: '#4ADE80' },
  warning: { bg: '#3A2A12', border: '#5C4420', icon: '#FBBF24' },
  danger: { bg: '#3A1414', border: '#5C1F1F', icon: '#F87171' },
  neutral: { bg: '#1E2530', border: '#2E3846', icon: '#B0B8C4' },
  primary: { bg: '#2E4568', border: '#3F587F', icon: '#FFFFFF' },
};

export function IconChip({ icon, tint }: IconChipProps) {
  const theme = useTheme();
  const gymAccent = useGymAccentColor();

  let backgroundColor: string;
  let borderColor: string;
  let iconColor: string;

  if (tint === 'accent') {
    backgroundColor = gymAccent;
    borderColor = theme.border;
    iconColor = getContrastTextColor(gymAccent);
  } else {
    // Falls back to `neutral` if `tint` ever reaches here outside the
    // declared union (a TS-bypassing cast, or a future data-driven tint) --
    // avoids a hard crash on an otherwise-decorative element.
    const statusTint = STATUS_TINTS[tint] ?? STATUS_TINTS.neutral;
    backgroundColor = statusTint.bg;
    borderColor = statusTint.border;
    iconColor = statusTint.icon;
  }

  return (
    <View style={[styles.chip, { backgroundColor, borderColor }]}>
      <MaterialIcons name={icon} size={20} color={iconColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
