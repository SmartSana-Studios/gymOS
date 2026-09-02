import { bodyProfileSchema } from '@gymos/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { LogEntrySheet } from '@/components/LogEntrySheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { getCurrentMember } from '@/services/progress';

// Review finding: how long goHome() waits for the shared `isOnboarded`
// state (see below) to flip before showing a retry option instead of a
// silent, indefinite spinner.
const REDIRECT_TIMEOUT_MS = 8000;

/** Story 10.1 Task 6. No MA screen ID assigned in EXPERIENCE.md -- a genuine
 * UX gap (see the story's Dev Notes "Open UX Gap"), resolved here with a
 * minimal two-field form + a prominent Skip action (FR-093: "none of it is
 * required"). Inserted between Plan Confirmation and Home
 * (onboarding/plan.tsx:224); this screen's own Skip/Save handlers do the
 * `router.replace('/(tabs)')` that plan.tsx used to do directly.
 *
 * Also gives AC #3's "log an entry" a reachable entry point before the
 * Progress tab exists (Story 10.3): a "Log your first entry" action opens
 * the same route-agnostic LogEntrySheet used later. */
export default function BodyProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  // Set by (tabs)/profile.tsx's "Body profile" row when it pushes this
  // route as a later, non-onboarding entry point (Review finding) -- lets
  // goHome() return the member to Profile instead of forcing them to Home.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { isOnboarded } = useSession();

  const [heightCm, setHeightCm] = useState('');
  const [startingWeightKg, setStartingWeightKg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  // Review finding: replaces an unconditional `router.replace('/(tabs)')`
  // immediately after `refreshSession()` -- that resolving only means the
  // token refresh network call finished, not that `useSession()`'s own
  // `onAuthStateChange`-triggered re-fetch of `isOnboarded` (a separate
  // async chain: getClaims() + a gym-status query + a members query) has
  // completed and re-rendered yet. Racing that (especially over a slow
  // connection) let `router.replace` fire while the root `Stack.Protected`
  // guard was still pointed at `onboarding`, crashing `(tabs)` screens that
  // assume their providers (e.g. `OfflineSyncProvider`) are already mounted.
  // Waiting for the *same* shared `isOnboarded` state to flip, then letting
  // `Stack.Protected` swap groups on its own, is the fix -- no imperative
  // navigation across that boundary at all.
  const [redirecting, setRedirecting] = useState(false);
  const [redirectTimedOut, setRedirectTimedOut] = useState(false);
  // Review finding: bumped on every goHome() attempt so the timeout effect
  // below re-runs (and reschedules a fresh timer) even when `redirecting`
  // was already `true` from a prior attempt -- otherwise a second stall
  // after a "Try Again" tap had no timer left to ever flip
  // `redirectTimedOut` again, spinning forever with no way back.
  const [redirectAttempt, setRedirectAttempt] = useState(0);

  useEffect(() => {
    if (!redirecting || isOnboarded) return;
    const timeout = setTimeout(() => setRedirectTimedOut(true), REDIRECT_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [redirecting, isOnboarded, redirectAttempt]);

  async function goHome() {
    if (from === 'profile') {
      // Already fully onboarded to get here -- no auth-gate refresh needed,
      // just return to where the member came from.
      router.back();
      return;
    }
    // Forces a `TOKEN_REFRESHED` auth event so `useSession()` re-runs its
    // onboarded-state fetch -- `redirecting` below is what actually waits
    // for that fetch's *result*, not this call's own resolution.
    setRedirectTimedOut(false);
    setRedirecting(true);
    setRedirectAttempt((attempt) => attempt + 1);
    try {
      await supabase.auth.refreshSession();
    } catch {
      // Review finding: refreshSession() can reject (e.g. offline). Without
      // this catch, the exception either surfaced as a handleSave()-caught
      // error the user could never see (redirecting was already true, so
      // only the redirecting branch below renders) or an unhandled
      // rejection from the Skip button's un-awaited call site. Falling back
      // to the normal form with a visible error gives the user an
      // immediate, specific path forward instead of an 8s wait for a
      // generic timeout message.
      setRedirecting(false);
      setError(t('progress.bodyProfile.errorSaveFailed'));
    }
    // Once `isOnboarded` flips true (picked up by the effect above via the
    // shared session context), the root `Stack.Protected` guard swaps from
    // `onboarding` to `(tabs)` on its own -- this screen unmounts as part of
    // that swap, so there is nothing further to do here.
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setError(t('progress.bodyProfile.errorSaveFailed'));
        return;
      }

      // Resolves the caller's specific current member row (Review finding)
      // -- the previous `.eq('user_id', userId)` update had no gym/member-id
      // scope at all, so a multi-gym member (Story 9.6) would have every
      // non-deactivated membership's height/weight overwritten at once.
      const current = await getCurrentMember(userId);
      if (!current) {
        setError(t('progress.bodyProfile.errorSaveFailed'));
        return;
      }

      const parsed = bodyProfileSchema.safeParse({
        heightCm: heightCm.trim() === '' ? null : heightCm,
        startingWeightKg: startingWeightKg.trim() === '' ? null : startingWeightKg,
      });
      if (!parsed.success) {
        setError(t('progress.bodyProfile.errorInvalidInput'));
        return;
      }

      const { data, error: updateError } = await supabase
        .from('members')
        .update({
          height_cm: parsed.data.heightCm ?? null,
          starting_weight_kg: parsed.data.startingWeightKg ?? null,
        })
        .eq('id', current.memberId)
        .select('id');

      // Zero-row-update guard (same discipline as onboarding/plan.tsx's
      // memberResult check) -- a stale claim or race must not be silently
      // treated as success.
      if (updateError || !data || data.length === 0) {
        setError(t('progress.bodyProfile.errorSaveFailed'));
        return;
      }

      await goHome();
    } catch {
      setError(t('progress.bodyProfile.errorSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (redirecting) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={[styles.safeArea, styles.redirectingContainer]}>
          {redirectTimedOut ? (
            <>
              <ThemedText type="small" style={styles.error}>
                {t('progress.bodyProfile.errorRedirectTimedOut')}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => void goHome()}>
                <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">{t('progress.bodyProfile.title')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('progress.bodyProfile.subtitle')}
        </ThemedText>

        <View style={styles.field}>
          <ThemedText type="small">{t('progress.bodyProfile.heightLabel')}</ThemedText>
          <TextInput
            value={heightCm}
            onChangeText={setHeightCm}
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
        </View>

        <View style={styles.field}>
          <ThemedText type="small">{t('progress.bodyProfile.weightLabel')}</ThemedText>
          <TextInput
            value={startingWeightKg}
            onChangeText={setStartingWeightKg}
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { borderColor: theme.border, color: theme.text }]}
          />
        </View>

        <Pressable accessibilityRole="button" onPress={() => setSheetVisible(true)} style={styles.logEntryLink}>
          <ThemedText type="link">{t('progress.bodyProfile.logFirstEntry')}</ThemedText>
        </Pressable>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={styles.buttonRow}>
          <View style={styles.saveButton}>
            <Button label={t('progress.bodyProfile.save')} loading={saving} onPress={handleSave} />
          </View>
          <Pressable accessibilityRole="button" onPress={() => void goHome()} disabled={saving}>
            <ThemedText type="link">{t('progress.bodyProfile.skip')}</ThemedText>
          </Pressable>
        </View>

        <LogEntrySheet visible={sheetVisible} onClose={() => setSheetVisible(false)} onSaved={() => setSheetVisible(false)} />
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
    gap: Spacing.three,
  },
  redirectingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  logEntryLink: {
    marginTop: Spacing.one,
  },
  error: {
    color: '#F87171',
  },
  buttonRow: {
    marginTop: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  saveButton: {
    alignSelf: 'stretch',
  },
});
