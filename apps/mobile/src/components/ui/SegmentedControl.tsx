import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { getContrastTextColor } from '@/lib/color-contrast';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Restyle of History's Payments/Check-ins toggle -- pill-style active
 * indicator instead of the existing flat background swap, same
 * two-Pressables-in-a-row structure/behavior. */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const selectedTextColor = getContrastTextColor(accent);

  return (
    <View style={[styles.track, { backgroundColor: theme.surface, borderColor: theme.border }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: accent }]}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              themeColor={selected ? undefined : 'textSecondary'}
              style={selected ? { color: selectedTextColor } : undefined}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  option: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: 'center',
  },
});
