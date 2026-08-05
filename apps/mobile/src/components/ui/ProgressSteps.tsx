import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';

export interface ProgressStepsProps {
  totalSteps: number;
  /** 1-indexed, matching each onboarding screen's existing CURRENT_STEP const. */
  currentStep: number;
}

/** Restyle of the 4-segment bar currently copy-pasted across
 * onboarding/{profile,goal,experience,plan}.tsx's `progressTrack`/
 * `progressSegment`/`progressSegmentFilled` styles -- same visual, one
 * implementation. Onboarding never mounts GymAccentColorProvider, so this
 * always resolves to Brand.accent via the context default (constants/brand.ts's
 * documented platform-shell-only constraint). */
export function ProgressSteps({ totalSteps, currentStep }: ProgressStepsProps) {
  const theme = useTheme();
  const accent = useGymAccentColor();

  return (
    <View style={styles.track}>
      {Array.from({ length: totalSteps }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.segment,
            { backgroundColor: i < currentStep ? accent : theme.border },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
});
