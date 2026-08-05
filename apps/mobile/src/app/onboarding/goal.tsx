import type { MemberGoalInput } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ProgressSteps } from '@/components/ui/ProgressSteps';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useGymAccentColor } from '@/hooks/use-gym-accent-color';
import { useOnboardingProgress } from '@/lib/onboarding-context';

const TOTAL_STEPS = 4;
const CURRENT_STEP = 2;

// EXPERIENCE.md MA-06: four fixed goal options, in this exact order.
const GOAL_OPTIONS: { value: MemberGoalInput; labelKey: string }[] = [
  { value: 'lose_weight', labelKey: 'onboarding.goal.optionLoseWeight' },
  { value: 'build_muscle', labelKey: 'onboarding.goal.optionBuildMuscle' },
  { value: 'improve_fitness', labelKey: 'onboarding.goal.optionImproveFitness' },
  { value: 'general_wellness', labelKey: 'onboarding.goal.optionGeneralWellness' },
];

/** MA-06. Local state only (Story 2.7 Task 3/4) -- nothing is written to
 * `members` until MA-08's "Confirm and start". Reuses profile.tsx's inline
 * step-indicator/progress-bar markup (no shared component exists yet for
 * this pattern, Story 2.6 precedent). */
export default function GoalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { goal, setGoal } = useOnboardingProgress();

  function handleContinue() {
    // `push`, not `replace` (Review finding): this screen shows a back
    // button wired to `router.back()`, which needs the prior stack entry
    // preserved to land on the immediately-prior step instead of skipping
    // past it.
    router.push('/onboarding/experience');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          style={styles.backButton}>
          <ThemedText type="default">←</ThemedText>
        </Pressable>

        <ThemedText type="small">{t('onboarding.goal.stepIndicator', { step: CURRENT_STEP })}</ThemedText>
        <ProgressSteps totalSteps={TOTAL_STEPS} currentStep={CURRENT_STEP} />

        <ThemedText type="subtitle">{t('onboarding.goal.title')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {t('onboarding.goal.subtitle')}
        </ThemedText>

        <View style={styles.optionList}>
          {GOAL_OPTIONS.map((option) => {
            const selected = goal === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setGoal(option.value)}
                style={[
                  styles.optionCard,
                  { borderColor: theme.border },
                  selected && { borderColor: accent, borderWidth: 2 },
                ]}>
                <ThemedText type="default">{t(option.labelKey)}</ThemedText>
                {selected && <ThemedText type="default">✓</ThemedText>}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.continueButton}>
          <Button label={t('common.continue')} disabled={goal === null} onPress={handleContinue} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  optionList: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  continueButton: {
    marginTop: Spacing.three,
  },
});
