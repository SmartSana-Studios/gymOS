import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export interface BadgeColors {
  bg: string;
  border: string;
  text: string;
}

export interface BadgeProps {
  label: string;
  colors: BadgeColors;
}

/** Presentational pill chip only -- callers own their own semantic color
 * maps (STATUS_COLORS / PAYMENT_STATUS_COLORS / OCCUPANCY_COLORS etc.),
 * re-tuned for the dark theme where each is actually used (Story 8.5). */
export function Badge({ label, colors }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <ThemedText type="small" numberOfLines={1} style={[styles.label, { color: colors.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  label: {
    lineHeight: 16,
  },
});
