import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export interface StampSegmentsProps {
  total: number;
  /** Filled segments, from the server. */
  done: number;
  /** Segments after the filled ones drawn dashed (a visit queued on this phone). Optional. */
  dashed?: number;
  /** The fill colour (the gym accent). */
  color: string;
}

/** The row of equal segments shared by the Rewards card (Story 20.6) and the comeback card (Story 31.1): the first `done` filled, the next `dashed`
 * outlined with a dashed border, the rest empty. Decorative: the caller's label carries the figures. */
export function StampSegments({ total, done, dashed = 0, color }: StampSegmentsProps) {
  const theme = useTheme();
  return (
    <View style={styles.segments}>
      {Array.from({ length: total }, (_, i) => {
        const filled = i < done;
        const queued = !filled && i < done + dashed;
        return (
          <View
            key={i}
            style={[
              styles.segment,
              queued
                ? { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: color }
                : { backgroundColor: filled ? color : theme.backgroundSelected },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 10, borderRadius: 5 },
});
