import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { getContrastTextColor } from '@/lib/color-contrast';

type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  /** Overrides useGymAccentColor()'s resolved color -- e.g. onboarding
   * screens (Story 8.6) never mount GymAccentColorProvider, so they get the
   * context default (Brand.accent) automatically and never need this. */
  accentColor?: string;
}

export function Button({ label, variant = 'primary', loading, disabled, accentColor, ...rest }: ButtonProps) {
  const theme = useTheme();
  const gymAccent = useGymAccentColor();
  const accent = accentColor ?? gymAccent;
  const isDisabled = disabled || loading;
  const primaryTextColor = getContrastTextColor(accent);

  return (
    <Pressable
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary'
          ? { backgroundColor: accent }
          : { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? primaryTextColor : theme.text} />
      ) : (
        <ThemedText
          type="smallBold"
          themeColor={variant === 'primary' ? undefined : 'text'}
          style={variant === 'primary' ? { color: primaryTextColor } : undefined}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});
