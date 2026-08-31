import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { clearCachedProgressPayload } from '@/services/progress';
import { clearCachedWorkoutPlan } from '@/services/workoutPlan';

/**
 * Story 11.4 (AC #1, #3): the mobile-only neutral suspension state.
 * Members never see billing/dunning language -- that relationship is
 * between GymOS and the Owner only, dashboard-only (FR-132; mobile has no
 * Owner-role user at all). Copy is verbatim from EXPERIENCE.md's "V1.5 --
 * New State Patterns" section, identical to the dashboard's non-Owner
 * neutral screen -- do not paraphrase.
 */
export default function SuspendedScreen() {
  const { t } = useTranslation();

  // Review finding: this screen replaces the entire tab navigator with no
  // way back to `(tabs)/profile.tsx`, where sign-out normally lives -- a
  // member on the wrong account had no in-app way out. Same confirm-then-
  // signOut shape as profile.tsx's handleLogOut.
  function handleLogOut() {
    Alert.alert(t('profile.logOutConfirmTitle'), undefined, [
      {
        text: t('profile.logOut'),
        style: 'destructive',
        onPress: () => {
          clearCachedProgressPayload();
          clearCachedWorkoutPlan();
          void supabase.auth.signOut().catch(() => Alert.alert(t('profile.errorSaveFailed')));
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.icon}>
          ⏸️
        </ThemedText>
        <ThemedText type="subtitle" style={styles.centered}>
          {t('suspended.message')}
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={handleLogOut}>
          <ThemedText type="default">{t('profile.logOut')}</ThemedText>
        </Pressable>
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
  icon: {
    fontSize: 48,
  },
  centered: {
    textAlign: 'center',
  },
});
