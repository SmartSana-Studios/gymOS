import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';
import { clearCachedProgressPayload } from '@/services/progress';
import { clearCachedWorkoutPlan } from '@/services/workoutPlan';

/**
 * Story 18.7: neutral blocked state for a member whose registration fee has
 * not been settled by staff. No payment option and no billing language
 * (FR-148, FR-155) -- members never pay the fee from the app. Copy is
 * [ASSUMPTION] pending the UX pass noted in FR-155.
 */
export default function AwaitingRegistrationScreen() {
  const { t } = useTranslation();
  const { refresh } = useSession();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<'stillAwaiting' | 'refreshFailed' | null>(null);

  async function handleCheckAgain() {
    setChecking(true);
    setNote(null);
    try {
      const stillAwaiting = await refresh();
      // Settled: the root guard moves the member on and unmounts this screen.
      if (stillAwaiting === null) setNote('refreshFailed');
      else if (stillAwaiting) setNote('stillAwaiting');
    } finally {
      setChecking(false);
    }
  }

  // Same confirm-then-signOut shape as suspended.tsx (kept duplicated so that
  // screen's behaviour stays untouched).
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
        <ThemedText type="subtitle" style={styles.centered}>
          {t('awaitingRegistration.title')}
        </ThemedText>
        <ThemedText type="default" style={styles.centered}>
          {t('awaitingRegistration.message')}
        </ThemedText>
        {note && (
          <ThemedText type="small" style={styles.centered} accessibilityRole="alert">
            {t(`awaitingRegistration.${note}`)}
          </ThemedText>
        )}
        <Pressable accessibilityRole="button" disabled={checking} onPress={() => void handleCheckAgain()}>
          {checking ? (
            <ActivityIndicator accessibilityLabel={t('awaitingRegistration.checking')} />
          ) : (
            <ThemedText type="link">{t('awaitingRegistration.checkAgain')}</ThemedText>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={handleLogOut}>
          <ThemedText type="default">{t('profile.logOut')}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  centered: { textAlign: 'center' },
});
