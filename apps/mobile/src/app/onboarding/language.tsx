import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { detectDeviceLocale, i18n, type MobileLocale } from '@/lib/i18n';
import { useOnboardingProgress } from '@/lib/onboarding-context';

/** MA-01. First screen of onboarding -- no back button, no Continue button
 * (card tap is the action, EXPERIENCE.md). Both language names are shown
 * simultaneously regardless of which is pre-highlighted, so a member can
 * find their option without already reading the other language. */
export default function LanguageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { setLanguage } = useOnboardingProgress();
  const [preHighlighted] = useState<MobileLocale>(() => detectDeviceLocale());

  function selectLanguage(language: MobileLocale) {
    setLanguage(language);
    void i18n.changeLanguage(language);
    router.push('/onboarding/phone');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.heading}>
          {t('onboarding.language.headingEn')}
        </ThemedText>
        <ThemedText type="title" style={styles.heading}>
          {t('onboarding.language.headingFr')}
        </ThemedText>

        <Pressable
          accessibilityRole="button"
          onPress={() => selectLanguage('en')}
          style={[styles.card, preHighlighted === 'en' && styles.cardHighlighted]}>
          <ThemedText type="default">🇬🇧 {t('onboarding.language.english')}</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => selectLanguage('fr')}
          style={[styles.card, preHighlighted === 'fr' && styles.cardHighlighted]}>
          <ThemedText type="default">🇫🇷 {t('onboarding.language.french')}</ThemedText>
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
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  heading: {
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
  },
  card: {
    borderWidth: 1,
    borderColor: Brand.primary,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  cardHighlighted: {
    borderColor: Brand.accent,
    borderWidth: 2,
  },
});
