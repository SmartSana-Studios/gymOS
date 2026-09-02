import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/Card';
import { Spacing } from '@/constants/theme';

export interface StatTileProps {
  /** Caller pre-formats this (e.g. "12") -- no formatting logic here. */
  value: string;
  caption: string;
}

export function StatTile({ value, caption }: StatTileProps) {
  return (
    <Card variant="raised" style={styles.card}>
      <ThemedText type="statNumeral">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {caption}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.half,
  },
});
