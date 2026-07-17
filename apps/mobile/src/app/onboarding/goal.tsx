import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** MA-06 placeholder only -- Story 2.7 (Goal, Experience & Plan
 * Confirmation) builds the real goal-selection screen here. This story's
 * own scope ends at profile setup (MA-05); this route exists solely so
 * navigation after MA-05 (or the existing-account skip branch) lands
 * somewhere real instead of a 404. */
export default function GoalPlaceholderScreen() {
  const { t } = useTranslation();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">{t('onboarding.goal.title')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
          {t('onboarding.goal.subtitle')}
        </ThemedText>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  subtitle: {
    textAlign: 'center',
  },
});
