import { phoneEntrySchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useOnboardingProgress } from '@/lib/onboarding-context';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone: prefillPhone, setPhone } = useOnboardingProgress();
  // Story 16.2: PhoneInput itself parses `prefillPhone` (any country, not
  // just Cameroon) into country + national number on mount -- no prefix
  // check needed here anymore.
  const [phone, setPhoneValue] = useState<string | null>(prefillPhone ?? null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    const parsed = phoneEntrySchema.safeParse({ phone });
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

        <PhoneInput countries="global" value={phone} onChange={setPhoneValue} autoFocus />
        <ThemedText type="small" themeColor="textSecondary">
          {t('onboarding.phone.helper')}
        </ThemedText>

        {error && (
          <ThemedText type="small" themeColor="text" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={styles.continueButton}>
          <Button label={t('common.continue')} disabled={!phone} loading={submitting} onPress={handleContinue} />
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
  error: {
    color: '#F87171',
  },
  continueButton: {
    marginTop: Spacing.three,
  },
});
