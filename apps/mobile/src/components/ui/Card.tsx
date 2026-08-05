import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export interface CardProps extends ViewProps {
  elevated?: boolean;
}

export function Card({ style, elevated, ...rest }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: elevated ? theme.surfaceElevated : theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 16,
          padding: 16,
        },
        style,
      ]}
      {...rest}
    />
  );
}
