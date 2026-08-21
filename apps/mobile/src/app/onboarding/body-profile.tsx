import { bodyProfileSchema } from '@gymos/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { LogEntrySheet } from '@/components/LogEntrySheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { getCurrentMember } from '@/services/progress';

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

  const [heightCm, setHeightCm] = useState('');
  const [startingWeightKg, setStartingWeightKg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  async function goHome() {
    if (from === 'profile') {
      // Already fully onboarded to get here -- no auth-gate refresh needed,
      // just return to where the member came from.
      router.back();
      return;
    }
    // Story 10.1 (Review finding): the auth-gate refresh moved here from
    // plan.tsx's handleConfirm -- forces a `TOKEN_REFRESHED` auth event so
    // the root layout's `useSession()` re-runs `refreshOnboardedState` and
    // picks up `onboarding_completed_at` immediately before this screen's
    // own `router.replace('/(tabs)')`, instead of racing that flip against
    // the member's time on this still-optional step.
    await supabase.auth.refreshSession();
    router.replace('/(tabs)');
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
          <Pressable accessibilityRole="button" onPress={goHome} disabled={saving}>
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
