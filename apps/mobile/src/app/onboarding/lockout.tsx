import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useOnboardingProgress } from '@/lib/onboarding-context';

// Persists across an app kill -- OnboardingProgressProvider's `phone` and
// the route's `lockedUntil` param are both in-memory/navigation-state only
// and reset on a cold relaunch, which could otherwise strand a relaunched
// member on a permanently-disabled "Try Again" with no phone to resync
// against (Review finding, 2026-07-17). The server's `locked_until` (via
// check_otp_resend_allowed below) remains the actual source of truth --
// this is only a local hint to resync with, so a lockout can't outlive its
// own record.
const LOCKOUT_STORAGE_KEY = 'gymos.onboarding.lockout';

async function persistLockoutHint(phone: string, lockedUntil: string | null) {
  try {
    if (lockedUntil) {
      await AsyncStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify({ phone, lockedUntil }));
    } else {
      await AsyncStorage.removeItem(LOCKOUT_STORAGE_KEY);
    }
  } catch {
    // Best-effort only -- a failed local persist just means a relaunch mid-lockout
    // falls back to the unrecoverable state this fix is meant to reduce, not a
    // functional regression versus before this fix existed.
  }
}

async function readLockoutHint(): Promise<{ phone: string; lockedUntil: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(LOCKOUT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60).toString().padStart(2, '0');
  const s = (clamped % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/** MA-04. No back button rendered, and the Android hardware-back gesture
 * is intercepted here (the Stack.Screen's `gestureEnabled: false`,
 * onboarding/_layout.tsx, only blocks the iOS swipe gesture). The
 * countdown is derived from the server's `locked_until` on every tick, not
 * a plain local `setInterval` counter -- EXPERIENCE.md: "Countdown
 * continues even if app is backgrounded; uses elapsed time on foreground
 * return." A resync call on mount protects against a stale `locked_until`
 * route param (e.g. the app was killed and relaunched mid-lockout). */
export default function LockoutScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone: contextPhone } = useOnboardingProgress();
  const params = useLocalSearchParams<{ lockedUntil?: string }>();
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(contextPhone);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(
    params.lockedUntil ? new Date(params.lockedUntil) : null,
  );
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  // Falls back to the persisted hint when context/params are both empty --
  // the app-kill-during-lockout case (see LOCKOUT_STORAGE_KEY above).
  useEffect(() => {
    if (contextPhone) {
      setResolvedPhone(contextPhone);
      return;
    }
    readLockoutHint().then((hint) => {
      if (hint) {
        setResolvedPhone(hint.phone);
        setLockedUntil((current) => current ?? new Date(hint.lockedUntil));
      }
    });
  }, [contextPhone]);

  useEffect(() => {
    if (!resolvedPhone) return;
    supabase.rpc('check_otp_resend_allowed', { p_phone: resolvedPhone }).then(({ data }) => {
      const result = Array.isArray(data) ? data[0] : data;
      if (result?.locked_until) {
        setLockedUntil(new Date(result.locked_until));
        void persistLockoutHint(resolvedPhone, result.locked_until);
      } else {
        // Server says this phone isn't actually locked (e.g. it expired
        // while the app was killed) -- clear the local hint too.
        setLockedUntil(null);
        void persistLockoutHint(resolvedPhone, null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedPhone]);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const seconds = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
      setRemainingSeconds(Math.max(0, seconds));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const expired = remainingSeconds <= 0 && lockedUntil !== null;

  useEffect(() => {
    if (expired && resolvedPhone) {
      void persistLockoutHint(resolvedPhone, null);
    }
  }, [expired, resolvedPhone]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.icon}>
          🔒
        </ThemedText>
        <ThemedText type="subtitle" style={styles.centered}>
          {t('onboarding.lockout.title')}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.centered}>
          {t('onboarding.lockout.explanation')}
        </ThemedText>

        {!expired && (
          <ThemedText type="default" style={styles.centered}>
            {t('onboarding.lockout.countdown', { countdown: formatCountdown(remainingSeconds) })}
          </ThemedText>
        )}

        <View style={styles.button}>
          <Button label={t('onboarding.lockout.tryAgain')} disabled={!expired} onPress={() => router.replace('/onboarding/phone')} />
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
  button: {
    marginTop: Spacing.three,
    width: '100%',
  },
});
