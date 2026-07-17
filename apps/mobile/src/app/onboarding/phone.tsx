import { phoneEntrySchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
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

        <ThemedView style={styles.inputRow}>
          <ThemedText type="default" style={styles.prefix}>
            {COUNTRY_PREFIX}
          </ThemedText>
          <TextInput
            value={digits}
            onChangeText={(value) => setDigits(value.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            autoFocus
            placeholder={t('onboarding.phone.helper')}
            style={styles.input}
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

        <Pressable
          accessibilityRole="button"
          disabled={digits.length === 0 || submitting}
          onPress={handleContinue}
          style={[styles.continueButton, (digits.length === 0 || submitting) && styles.continueButtonDisabled]}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.continueLabel}>{t('common.continue')}</ThemedText>}
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Brand.primary,
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
    color: '#B3261E',
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
