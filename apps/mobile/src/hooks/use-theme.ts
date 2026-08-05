/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

// Story 8.3: the redesign's dark canvas is the app's only shipped theme for
// now (device color scheme intentionally ignored) -- the reference design
// this app is modeled on depends on a dark background to read correctly
// (bold headers + gold accent both assume it). `Colors.light` is kept filled
// in and ready (constants/theme.ts) for whenever a real light-mode toggle is
// built, rather than being deleted.
export function useTheme() {
  return Colors.dark;
}
