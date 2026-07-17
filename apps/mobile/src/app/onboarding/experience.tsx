import type { ExperienceLevelInput } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
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
        <View style={styles.progressTrack}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View key={i} style={[styles.progressSegment, i < CURRENT_STEP && styles.progressSegmentFilled]} />
          ))}
        </View>

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
                style={[styles.optionCard, selected && styles.optionCardSelected]}>
                <ThemedText type="default">{t(option.labelKey)}</ThemedText>
                {selected && <ThemedText type="default">✓</ThemedText>}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={experienceLevel === null}
          onPress={handleContinue}
          style={[styles.continueButton, experienceLevel === null && styles.continueButtonDisabled]}>
          <ThemedText style={styles.continueLabel}>{t('common.continue')}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Brand.background,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  progressTrack: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E1E6',
  },
  progressSegmentFilled: {
    backgroundColor: Brand.accent,
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
    borderColor: '#E0E1E6',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  optionCardSelected: {
    borderWidth: 2,
    borderColor: Brand.accent,
  },
  continueButton: {
    marginTop: Spacing.three,
    backgroundColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
