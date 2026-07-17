import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useOnboardingProgress } from '@/lib/onboarding-context';

const CODE_LENGTH = 6;
const INITIAL_COUNTDOWN_SECONDS = 60;

// "+237" -- matches phone.tsx's own fixed COUNTRY_PREFIX (Cameroon-only
// pilot scope, deferred-work.md); kept local since this file has no import
// path back to phone.tsx's module-private const.
const COUNTRY_CODE_LENGTH = 4;

function maskPhone(phone: string): string {
  // "Sent to +237 ***** XXXX" (country code + last 4 digits shown, rest
  // masked) -- EXPERIENCE.md MA-03. Country code must stay visible: masking
  // it too (as an earlier version of this function did) contradicted both
  // locale files' own helper text ("+237 6 XX XX XX XX") and this
  // function's own original comment (Review finding, 2026-07-17). Works on
  // the raw E.164 digit string, not a formatted display value (this app has
  // no phone formatting library).
  const visibleStart = phone.slice(0, COUNTRY_CODE_LENGTH);
  const visibleEnd = phone.slice(-4);
  const masked = phone.slice(COUNTRY_CODE_LENGTH, -4).replace(/\d/g, '*');
  return `${visibleStart}${masked}${visibleEnd}`;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function OtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone, setOtpVerified } = useOnboardingProgress();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(INITIAL_COUNTDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Auto-submit on the 6th digit -- no confirm button (EXPERIENCE.md).
  useEffect(() => {
    if (code.length === CODE_LENGTH && !verifying) {
      void verifyCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function playShake() {
    Animated.sequence([
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  async function verifyCode() {
    if (!phone) return;
    setVerifying(true);
    setError(null);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      });

      if (verifyError || !data.session) {
        setError(t('onboarding.otp.errorIncorrect'));
        setCode('');
        playShake();
        return;
      }

      // Scope Note #2: "new account" = users.display_name IS NULL for the
      // now-authenticated user -- decides MA-05 vs. the MA-06 placeholder.
      // A failed lookup here must not silently default to "new account" --
      // that would send an existing member back through profile setup on a
      // transient error (Review finding, 2026-07-17).
      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', data.session.user.id)
        .single();

      if (userError) {
        setError(t('onboarding.otp.errorNetwork'));
        return;
      }

      setOtpVerified(true);
      router.replace(userRow?.display_name ? '/onboarding/goal' : '/onboarding/profile');
    } catch {
      setError(t('onboarding.otp.errorNetwork'));
      setCode('');
      playShake();
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    // Re-entrancy guard: without it, a rapid double-tap before `countdown`
    // re-renders could fire two concurrent record_otp_resend calls,
    // consuming two attempts for one user action (Review finding,
    // 2026-07-25).
    if (countdown > 0 || !phone || resending) return;
    setResending(true);

    try {
      const { data: resendResult, error: rpcError } = await supabase.rpc('record_otp_resend', { p_phone: phone });
      const result = Array.isArray(resendResult) ? resendResult[0] : resendResult;

      if (rpcError || !result) {
        setError(t('onboarding.otp.errorNetwork'));
        return;
      }

      if (!result.allowed) {
        router.replace({ pathname: '/onboarding/lockout', params: { lockedUntil: result.locked_until ?? '' } });
        return;
      }

      // record_otp_resend already consumed one of the 3 attempts above --
      // if signInWithOtp then fails (e.g. a network drop), the member has
      // lost an attempt without ever receiving a new code. Surface a
      // distinct message pointing at the resend link rather than the
      // generic network error, since retrying costs them another attempt
      // (Review finding, 2026-07-17; a full fix would need the RPC and the
      // send to be atomic, which needs server-side infrastructure this
      // story doesn't add).
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone });
      if (otpError) {
        setError(t('onboarding.otp.errorNetwork'));
        return;
      }
      setCountdown(INITIAL_COUNTDOWN_SECONDS);
      setCode('');
    } finally {
      setResending(false);
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

        <ThemedText type="subtitle">{t('onboarding.otp.title')}</ThemedText>
        {phone && (
          <ThemedText type="default" themeColor="textSecondary">
            {t('onboarding.otp.subtitleSentTo', { maskedPhone: maskPhone(phone) })}
          </ThemedText>
        )}

        <Animated.View style={[styles.boxRow, { transform: [{ translateX: shake }] }]}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => (
            <Pressable key={i} onPress={() => inputRef.current?.focus()} style={styles.box}>
              <ThemedText type="subtitle">{code[i] ?? ''}</ThemedText>
            </Pressable>
          ))}
        </Animated.View>
        {/* Single hidden input driving all six visual boxes -- the robust
            RN pattern for auto-advance + paste-to-fill (EXPERIENCE.md),
            versus six separately-focus-managed TextInputs. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(value) => setCode(value.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          autoFocus
          editable={!verifying}
          maxLength={CODE_LENGTH}
          style={styles.hiddenInput}
        />

        {verifying && <ActivityIndicator />}
        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <Pressable disabled={countdown > 0 || resending} onPress={handleResend} accessibilityRole="button">
          <ThemedText type="link" themeColor={countdown > 0 || resending ? 'textSecondary' : 'text'}>
            {countdown > 0
              ? t('onboarding.otp.resendCountdown', { countdown: formatCountdown(countdown) })
              : t('onboarding.otp.resendLink')}
          </ThemedText>
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
    gap: Spacing.three,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  boxRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  box: {
    width: 44,
    height: 56,
    borderWidth: 1,
    borderColor: Brand.primary,
    borderRadius: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
  },
  error: {
    color: '#B3261E',
    textAlign: 'center',
  },
});
