import type { ExperienceLevelInput } from '@gymos/types';
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
const CURRENT_STEP = 3;

// EXPERIENCE.md MA-07: three fixed experience-level options, in this exact
// order -- "Identical pattern to MA-06".
const EXPERIENCE_OPTIONS: { value: ExperienceLevelInput; labelKey: string }[] = [
  { value: 'beginner', labelKey: 'onboarding.experience.optionBeginner' },
  { value: 'intermediate', labelKey: 'onboarding.experience.optionIntermediate' },
  { value: 'advanced', labelKey: 'onboarding.experience.optionAdvanced' },
];

/** MA-07. Local state only (Story 2.7 Task 3/5) -- nothing is written to
 * `members` until MA-08's "Confirm and start". Identical layout pattern to
 * MA-06 (goal.tsx). */
export default function ExperienceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const accent = useGymAccentColor();
  const { experienceLevel, setExperienceLevel } = useOnboardingProgress();

  function handleContinue() {
    // `push`, not `replace` (Review finding): this screen shows a back
    // button wired to `router.back()`, which needs the prior stack entry
    // (goal) preserved to land on it instead of skipping past it.
    router.push('/onboarding/plan');
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

        <ThemedText type="small">{t('onboarding.experience.stepIndicator', { step: CURRENT_STEP })}</ThemedText>
        <ProgressSteps totalSteps={TOTAL_STEPS} currentStep={CURRENT_STEP} />

        <ThemedText type="subtitle">{t('onboarding.experience.title')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {t('onboarding.experience.subtitle')}
        </ThemedText>

        <View style={styles.optionList}>
          {EXPERIENCE_OPTIONS.map((option) => {
            const selected = experienceLevel === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setExperienceLevel(option.value)}
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
          <Button label={t('common.continue')} disabled={experienceLevel === null} onPress={handleContinue} />
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
