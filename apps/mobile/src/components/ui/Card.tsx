import { Platform, View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type CardVariant = 'flat' | 'raised';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
}

/** DESIGN.md's Elevation & Depth spec: `flat` (default) is a passive
 * container -- border only, no shadow. `raised` is for actionable/tappable
 * cards meant to visually lift off the dark background -- shadow (iOS) /
 * elevation (Android) instead of a border. */
export function Card({ style, variant = 'flat', ...rest }: CardProps) {
  const theme = useTheme();
  const raised = variant === 'raised';

  return (
    <View
      style={[
        {
          backgroundColor: raised ? theme.surfaceElevated : theme.surface,
          borderRadius: 16,
          padding: 16,
        },
        raised
          ? Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOpacity: 0.24,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              },
              android: { elevation: 4 },
              web: { boxShadow: '0 4px 8px rgba(0, 0, 0, 0.24)' },
            })
          : { borderWidth: 1, borderColor: theme.border },
        style,
      ]}
      {...rest}
    />
  );
}
