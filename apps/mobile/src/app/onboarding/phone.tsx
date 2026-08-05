import { phoneEntrySchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useOnboardingProgress } from '@/lib/onboarding-context';

// Cameroon-only prefix (fixed, not a searchable country-code picker) --
// deliberate scope reduction from EXPERIENCE.md's mockup (a full
// bottom-sheet country list): the pilot and NFR-009 are Cameroon-only, and
// no FR requires multi-country support in V1. Recorded in
// docs/decisions.md, not silently done.
const COUNTRY_PREFIX = '+237';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const { phone: prefillPhone, setPhone } = useOnboardingProgress();
  const [digits, setDigits] = useState(() => (prefillPhone?.startsWith(COUNTRY_PREFIX) ? prefillPhone.slice(COUNTRY_PREFIX.length) : ''));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    const fullPhone = `${COUNTRY_PREFIX}${digits}`;
    const parsed = phoneEntrySchema.safeParse({ phone: fullPhone });
    if (!parsed.success) {
      setError(t('onboarding.phone.errorInvalidFormat'));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // Existence check BEFORE signInWithOtp -- an unregistered number
      // never reaches Twilio (Story 2.6 Scope Note #3's cost-abuse
      // mitigation), and satisfies EXPERIENCE.md's own documented error
      // state.
      const { data: hasMembership, error: rpcError } = await supabase.rpc('phone_has_membership', {
        p_phone: parsed.data.phone,
      });
      if (rpcError) {
        setError(t('onboarding.phone.errorNetwork'));
        return;
      }
      if (!hasMembership) {
        setError(t('onboarding.phone.errorNotRegistered'));
        return;
      }

      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
      if (otpError) {
        setError(t('onboarding.phone.errorNetwork'));
        return;
      }

      setPhone(parsed.data.phone);
      router.push('/onboarding/otp');
    } catch {
      setError(t('onboarding.phone.errorNetwork'));
    } finally {
      setSubmitting(false);
    }
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

        <ThemedText type="subtitle">{t('onboarding.phone.title')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {t('onboarding.phone.subtitle')}
        </ThemedText>

        <ThemedView style={[styles.inputRow, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.prefix}>
            {COUNTRY_PREFIX}
          </ThemedText>
          <TextInput
            value={digits}
            onChangeText={(value) => setDigits(value.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            autoFocus
            placeholder={t('onboarding.phone.helper')}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text }]}
          />
        </ThemedView>
        <ThemedText type="small" themeColor="textSecondary">
          {t('onboarding.phone.helper')}
        </ThemedText>

        {error && (
          <ThemedText type="small" themeColor="text" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={styles.continueButton}>
          <Button
            label={t('common.continue')}
            disabled={digits.length === 0}
            loading={submitting}
            onPress={handleContinue}
          />
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  prefix: {
    marginRight: Spacing.two,
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#F87171',
  },
  continueButton: {
    marginTop: Spacing.three,
  },
});
