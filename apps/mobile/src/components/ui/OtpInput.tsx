import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';

export interface OtpInputProps {
  value: string;
  onChangeText: (value: string) => void;
  length: number;
  editable?: boolean;
  autoFocus?: boolean;
  /** Animated.Value driving a horizontal shake on error -- owned/triggered
   * by the screen (onboarding/otp.tsx, Story 8.6), same as today. */
  shakeValue?: Animated.Value;
}

/** Presentational restyle only of the existing 6-box OTP entry
 * (onboarding/otp.tsx) -- same underlying "one hidden TextInput drives N
 * visual boxes" pattern for auto-advance + paste-fill, unchanged. The
 * screen keeps owning `value`/verification/shake logic, including the
 * numeric-filter/truncation on `onChangeText`; this component only renders
 * it and passes the raw text straight through. */
export function OtpInput({ value, onChangeText, length, editable = true, autoFocus, shakeValue }: OtpInputProps) {
  const theme = useTheme();
  const accent = useGymAccentColor();
  const inputRef = useRef<TextInput>(null);

  const boxRow = (
    <Animated.View
      style={[styles.boxRow, shakeValue ? { transform: [{ translateX: shakeValue }] } : undefined]}>
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length;
        return (
          <Pressable key={i} onPress={() => inputRef.current?.focus()} style={styles.pressable}>
            <ThemedView
              style={[
                styles.box,
                { borderColor: filled ? accent : theme.border, backgroundColor: theme.surface },
              ]}>
              <ThemedText type="subtitle">{value[i] ?? ''}</ThemedText>
            </ThemedView>
          </Pressable>
        );
      })}
    </Animated.View>
  );

  return (
    <>
      {boxRow}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        autoFocus={autoFocus}
        editable={editable}
        maxLength={length}
        style={styles.hiddenInput}
      />
    </>
  );
}

const styles = StyleSheet.create({
  boxRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  pressable: {},
  box: {
    width: 44,
    height: 56,
    borderWidth: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
});
