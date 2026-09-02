import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code' | 'statNumeral';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        type === 'statNumeral' && styles.statNumeral,
        style,
      ]}
      {...rest}
    />
  );
}

// Story 8.3: Barlow replaces the system font app-wide. title/subtitle use
// the heavier weights uppercased + letter-spaced (the reference design's
// bold condensed-header look); default/small/smallBold use the lighter
// weights for body copy. fontWeight is omitted on these -- the weight lives
// in which Barlow font-family is selected, setting a numeric fontWeight
// alongside a specific static font-family is ignored by RN and would be
// misleading here.
const styles = StyleSheet.create({
  small: {
    fontFamily: 'Barlow_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: 'Barlow_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  default: {
    fontFamily: 'Barlow_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    fontFamily: 'Barlow_800ExtraBold',
    fontSize: 40,
    lineHeight: 46,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: 'Barlow_700Bold',
    fontSize: 26,
    lineHeight: 32,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statNumeral: {
    fontFamily: 'Barlow_800ExtraBold',
    fontSize: 32,
    lineHeight: 36,
    fontVariant: ['tabular-nums'],
  },
  link: {
    fontFamily: 'Barlow_500Medium',
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    fontFamily: 'Barlow_600SemiBold',
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
