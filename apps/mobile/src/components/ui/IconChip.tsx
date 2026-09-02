import { StyleSheet, View } from 'react-native';
import { MaterialIcons, type MaterialIconsIconName } from '@react-native-vector-icons/material-icons';

import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { getContrastTextColor } from '@/lib/color-contrast';

export type IconChipTint = 'accent' | 'success' | 'warning' | 'danger' | 'primary';

export interface IconChipProps {
  icon: MaterialIconsIconName;
  tint: IconChipTint;
}

/** success/warning/danger intentionally match subscription-status.ts's
 * STATUS_COLORS.active/expiring_soon/expired hex values verbatim -- these
 * are the same dark-theme-tuned semantic hues, not a coincidence, so a
 * status glyph moved into a chip (Story 15.3) reads identically to today.
 * `primary` gets its own dedicated hex (not `Brand.primary`/`theme.surfaceElevated`)
 * -- those two are byte-identical in dark mode (theme.ts), so a `primary`-tint
 * chip inside a `Card variant="raised"` would otherwise render invisibly
 * against its own card background. */
const STATUS_TINTS: Record<'success' | 'warning' | 'danger' | 'primary', { bg: string; border: string; icon: string }> = {
  success: { bg: '#123321', border: '#1F5C3A', icon: '#4ADE80' },
  warning: { bg: '#3A2A12', border: '#5C4420', icon: '#FBBF24' },
  danger: { bg: '#3A1414', border: '#5C1F1F', icon: '#F87171' },
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
    const statusTint = STATUS_TINTS[tint];
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
