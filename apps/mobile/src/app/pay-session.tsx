import { initiatePaymentSchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import * as Haptics from 'expo-haptics';

import { Spacing } from '@/constants/theme';
import { resolveRefusal, SESSION_LAPSE_DAYS } from '@/lib/sessionState';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { subscribeToPaymentStatus, fetchPaymentStatus, type WatchedPaymentStatus } from '@/lib/realtime/paymentStatus';
import { supabase } from '@/lib/supabase';
import { isSubscriptionStatus } from '@/constants/subscription-status';
import {
  getGymTaraMoneyConnectionStatus,
  getPendingMemberPayment,
  initiateSessionPayment,
} from '@/services/payments';
import { getOwnSubscriptionWithPlan, type OwnSubscriptionWithPlan } from '@/services/subscriptions';

// Story 19.11 (MA-17): same values as renew.tsx / RenewalModal.tsx, copied
// rather than imported so renew.tsx stays untouched.
const STILL_WAITING_MS = 45_000;
const POLL_INTERVAL_MS = 5000;

// Matches RenewalModal.tsx's/MemberModal.tsx's own DEFAULT_PHONE_PREFIX
// convention (per-file-copy, not a cross-import) -- only reached if the
// member somehow has no phone on file.
const DEFAULT_PHONE_PREFIX = '+237';

const SESSION_ERROR_KEY: Record<string, string> = {
  charging_disabled: 'paySession.errors.chargingDisabled',
  plan_not_per_session: 'paySession.errors.planNotPerSession',
  session_price_not_set: 'paySession.errors.priceNotSet',
  session_payment_already_in_progress: 'paySession.errors.alreadyInProgress',
  no_active_provider: 'paySession.errors.noProvider',
  gym_credentials_unavailable: 'paySession.errors.noProvider',
  mobile_money_disabled: 'paySession.errors.mobileMoneyDisabled',
};

type SessionPhase = 'idle' | 'sending' | 'pending' | 'stillWaiting' | 'verified' | 'flagged';

/**
 * Story 19.11 (MA-17): pay for a per-visit session in the app. Mirrors
 * renew.tsx's phase machine and realtime/polling pattern, but calls
 * `initiate_session_payment()` (amount derived server-side from the plan,
 * never sent) and filters pending-payment resume by purpose so this screen
 * and /renew never resume each other's payment. Offered only when charging
 * is on, the plan is pay-per-session with price > 0, and Tara is connected.
 */
export default function PaySessionScreen() {
  return (
    <GymAccentColorProvider>
      <PaySessionScreenContent />
    </GymAccentColorProvider>
  );
}

function PaySessionScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notAvailable, setNotAvailable] = useState(false);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [plan, setPlan] = useState<OwnSubscriptionWithPlan | null>(null);

  // Defaults to the member's own registered number, but stays editable --
  // same "pay from a different phone" precedent as the front-desk flow's
  // RenewalModal.tsx payerPhone override (commit 664f9a0). Locking was this
  // story's original recommended default; rejected in favor of edit access
  // during this story's live-evidence session.
  const [payerPhone, setPayerPhone] = useState(DEFAULT_PHONE_PREFIX);
  const [payerPhoneError, setPayerPhoneError] = useState<string | null>(null);

  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [initiatedPaymentId, setInitiatedPaymentId] = useState<string | null>(null);
  const [initiateError, setInitiateError] = useState<string | null>(null);

  const loadPaySession = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNotAvailable(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setLoadError(true);
        return;
      }

      const { data: memberRow, error: memberError } = await supabase
        .from('members')
        .select('id, phone')
        .eq('user_id', userId)
        .is('deactivated_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .single();

      if (memberError || !memberRow) {
        setLoadError(true);
        return;
      }

      setMemberId(memberRow.id);
      setPayerPhone(memberRow.phone || DEFAULT_PHONE_PREFIX);

      const [gymResult, subscriptionResult, taraConnected] = await Promise.all([
        supabase.from('gyms').select('charge_guests_per_session').single(),
        getOwnSubscriptionWithPlan(memberRow.id),
        getGymTaraMoneyConnectionStatus(),
      ]);
      if (gymResult.error || !gymResult.data || subscriptionResult.kind === 'error') {
        setLoadError(true);
        return;
      }
      if (subscriptionResult.kind === 'no_subscription') {
        setNotAvailable(true);
        return;
      }
      // Same rule as the refused-scan overlay: an expired/none member is
      // not offered a session (check_in would still refuse them).
      const status = subscriptionResult.data.status;
      const eligible =
        taraConnected &&
        resolveRefusal({
          chargingEnabled: gymResult.data.charge_guests_per_session,
          planType: subscriptionResult.data.planType,
          planPrice: subscriptionResult.data.planPrice,
          planCurrency: subscriptionResult.data.planCurrency,
          subscriptionStatus: isSubscriptionStatus(status) ? status : null,
          timezone: null,
        }) === 'session_required';
      if (!eligible) {
        setNotAvailable(true);
        return;
      }
      setPlan(subscriptionResult.data);

      // Review-class precedent (Story 4.12): resume an already-processing
      // payment instead of letting a re-opened screen offer a second
      // "Confirm" that would fire a duplicate real USSD prompt.
      const pending = await getPendingMemberPayment(memberRow.id, 'session');
      if (pending) {
        setInitiatedPaymentId(pending.paymentId);
        setPhase('pending');
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPaySession();
  }, [loadPaySession]);

  // Realtime-subscription-with-polling-degrade, mirroring RenewalModal.tsx's
  // established AD-20 pattern exactly.
  useEffect(() => {
    if (!initiatedPaymentId) return;
    const paymentId = initiatedPaymentId;

    let active = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function handleUpdate(row: { status: WatchedPaymentStatus }) {
      if (!active) return;
      if (row.status === 'verified') {
        stopPolling();
        setPhase('verified');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else if (row.status === 'flagged') {
        stopPolling();
        setPhase('flagged');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
      // "processing" is a no-op here -- still waiting, nothing to update.
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void fetchPaymentStatus(paymentId).then((row) => {
          if (row) handleUpdate(row);
        });
      }, POLL_INTERVAL_MS);
    }

    function handleStatusChange(status: string) {
      // removeChannel in the cleanup below reports CLOSED; polling must not
      // restart after teardown.
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        stopPolling();
        // The payment may have settled before the channel was live; no
        // event would ever arrive, so read the row once.
        void fetchPaymentStatus(paymentId).then((row) => {
          if (row) handleUpdate(row);
        });
        return;
      }
      startPolling();
    }

    const channel = subscribeToPaymentStatus(paymentId, handleUpdate, handleStatusChange);

    const stillWaitingTimer = setTimeout(() => {
      setPhase((current) => (current === 'pending' ? 'stillWaiting' : current));
    }, STILL_WAITING_MS);

    return () => {
      active = false;
      stopPolling();
      clearTimeout(stillWaitingTimer);
      void supabase.removeChannel(channel);
    };
  }, [initiatedPaymentId]);

  async function handleConfirm() {
    setInitiateError(null);
    setPayerPhoneError(null);

    const phoneCheck = initiatePaymentSchema.shape.phoneNumber.safeParse(payerPhone.trim());
    if (!phoneCheck.success) {
      setPayerPhoneError(t('renew.errors.payerPhoneInvalid'));
      return;
    }

    setPhase('sending');

    const result = await initiateSessionPayment(phoneCheck.data);
    if (result.code !== 'success' || !result.paymentId) {
      setPhase('idle');
      if (result.code === 'gym_suspended') {
        // Story 11.8 AC #4. FR-132: a member must never be told their gym
        // owes money.
        setInitiateError(t('common.gymSuspended'));
      } else {
        setInitiateError(t(SESSION_ERROR_KEY[result.code] ?? 'paySession.errors.initiateFailed'));
      }
      return;
    }

    setInitiatedPaymentId(result.paymentId);
    setPhase('pending');
  }

  function handleTryAgain() {
    setInitiatedPaymentId(null);
    setInitiateError(null);
    setPhase('idle');
  }

  function handleScanNow() {
    // Replace, not push: back from the scanner must not land on a paid
    // screen whose "pay" button is now meaningless.
    router.replace('/checkin');
  }

  const isWatching = phase === 'pending' || phase === 'stillWaiting';

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

        <ThemedText type="subtitle">{t('paySession.title')}</ThemedText>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('paySession.errors.loadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadPaySession()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
            <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
          </Card>
        )}

        {!loading && !loadError && notAvailable && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('paySession.errors.notAvailable')}
            </ThemedText>
            <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
          </Card>
        )}

        {!loading && !loadError && !notAvailable && plan && (
          <>
            <Card style={styles.card}>
              <View style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.plan')}
                </ThemedText>
                <ThemedText type="default">{plan.planName}</ThemedText>
              </View>
              <View style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.price')}
                </ThemedText>
                <ThemedText type="default">
                  {plan.planPrice} {plan.planCurrency}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('paySession.coversDay')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('home.sessions.lapseCaption', { days: SESSION_LAPSE_DAYS })}
              </ThemedText>
            </Card>

            {phase === 'idle' || phase === 'sending' ? (
              <Card style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.payerPhone')}
                </ThemedText>
                <PhoneInput
                  countries="tara-money"
                  value={payerPhone}
                  onChange={(v) => setPayerPhone(v ?? '')}
                  disabled={phase === 'sending'}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.payerPhoneHint')}
                </ThemedText>
                {payerPhoneError && (
                  <ThemedText type="small" style={styles.error}>
                    {payerPhoneError}
                  </ThemedText>
                )}
              </Card>
            ) : null}

            <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
            {phase === 'verified' ? (
              <Card style={styles.card}>
                <ThemedText type="default">{t('paySession.success.title')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('paySession.success.description')}
                </ThemedText>
                <Button label={t('paySession.success.scanButton')} onPress={handleScanNow} />
              </Card>
            ) : phase === 'flagged' ? (
              <Card style={styles.card}>
                <ThemedText type="small" style={styles.error}>
                  {t('renew.pending.failed')}
                </ThemedText>
                <Button label={t('common.tryAgain')} onPress={handleTryAgain} />
                <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
              </Card>
            ) : isWatching ? (
              <Card style={styles.card}>
                <ThemedText type="default">{t('renew.pending.title')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('paySession.pending.description')}
                </ThemedText>
                {phase === 'stillWaiting' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('renew.pending.stillWaiting')}
                  </ThemedText>
                )}
              </Card>
            ) : (
              <>
                {initiateError && (
                  <ThemedText type="small" style={styles.error} accessibilityRole="alert">
                    {initiateError}
                  </ThemedText>
                )}
                <Button
                  label={
                    phase === 'sending'
                      ? t('renew.sendingPaymentRequest')
                      : t('paySession.confirmButton', { amount: plan.planPrice, currency: plan.planCurrency })
                  }
                  loading={phase === 'sending'}
                  onPress={() => void handleConfirm()}
                />
                {initiateError && (
                  <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
                )}
              </>
            )}
            </View>
          </>
        )}
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
  liveRegion: {
    gap: Spacing.three,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  error: {
    color: '#F87171',
  },
});
