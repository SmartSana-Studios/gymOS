/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

import { Brand } from '@/constants/brand';

// Story 8.3: `surface`/`surfaceElevated`/`border` are additive. `dark.text`/
// `background`/`textSecondary` and `light.background` are intentionally
// retuned (navy-tinted near-black/off-white rather than pure black/white) as
// part of this story's "polished dark theme" goal -- only `backgroundElement`/
// `backgroundSelected` (dark) and `text`/`backgroundElement`/
// `backgroundSelected`/`textSecondary` (light) are left byte-for-byte
// unchanged. `light` gets the same new keys (placeholder values) purely to
// keep this shape light-mode-extensible for a future real light mode --
// `light` is not actually served today, see hooks/use-theme.ts. Per-gym
// accent lives exclusively in `useGymAccentColor()` (hooks/use-gym-accent-color.tsx),
// not here -- there is no `accent` token in this palette.
export const Colors = {
  light: {
    text: '#000000',
    background: Brand.background,
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    surface: '#FFFFFF',
    surfaceElevated: '#F0F0F3',
    border: '#E0E1E6',
  },
  dark: {
    text: '#F5F6F7',
    background: '#0A0F17',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#9AA5B1',
    surface: '#141F30',
    surfaceElevated: Brand.primary,
    border: '#26374F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
