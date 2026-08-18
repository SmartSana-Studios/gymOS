import { initiatePaymentSchema } from '@gymos/types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { GymAccentColorProvider } from '@/hooks/use-gym-accent-color';
import { useTheme } from '@/hooks/use-theme';
import { subscribeToPaymentStatus, fetchPaymentStatus, type WatchedPaymentStatus } from '@/lib/realtime/paymentStatus';
import { supabase } from '@/lib/supabase';
import {
  getGymTaraMoneyConnectionStatus,
  getPendingMemberPayment,
  initiateMemberPayment,
} from '@/services/payments';
import { getOwnSubscriptionWithPlan, type OwnSubscriptionWithPlan } from '@/services/subscriptions';

// Story 4.12 (RenewalModal.tsx)'s own values -- reused verbatim, not
// re-derived, per this story's Dev Notes.
const STILL_WAITING_MS = 45_000;
const POLL_INTERVAL_MS = 5000;

// Matches RenewalModal.tsx's/MemberModal.tsx's own DEFAULT_PHONE_PREFIX
// convention (per-file-copy, not a cross-import) -- only reached if the
// member somehow has no phone on file.
const DEFAULT_PHONE_PREFIX = '+237';

type RenewPhase = 'idle' | 'sending' | 'pending' | 'stillWaiting' | 'verified' | 'flagged';

/**
 * Story 4.15: full-screen mirror of RenewalModal.tsx's `mobile_money` branch
 * (Story 4.12) at a level appropriate for a full-screen mobile flow rather
 * than a modal-within-a-modal. Reached via `router.push('/renew')` from
 * Home's Renew CTA (only shown when the gym is connected, AC #2/#3) -- a
 * flat top-level route matching `plan.tsx`'s existing pattern, registered in
 * `_layout.tsx`. The payer phone defaults to the
 * member's own registered `members.phone` but stays editable -- same "pay
 * from a different phone" precedent as the front-desk flow's payer-phone
 * override (see the `payerPhone` state declaration below for why this
 * diverged from the story's original locked-field default).
 */
export default function RenewScreen() {
  return (
    <GymAccentColorProvider>
      <RenewScreenContent />
    </GymAccentColorProvider>
  );
}

function RenewScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noActivePlan, setNoActivePlan] = useState(false);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [plan, setPlan] = useState<OwnSubscriptionWithPlan | null>(null);

  // Defaults to the member's own registered number, but stays editable --
  // same "pay from a different phone" precedent as the front-desk flow's
  // RenewalModal.tsx payerPhone override (commit 664f9a0). Locking was this
  // story's original recommended default; rejected in favor of edit access
  // during this story's live-evidence session.
  const [payerPhone, setPayerPhone] = useState(DEFAULT_PHONE_PREFIX);
  const [payerPhoneError, setPayerPhoneError] = useState<string | null>(null);

  const [phase, setPhase] = useState<RenewPhase>('idle');
  const [initiatedPaymentId, setInitiatedPaymentId] = useState<string | null>(null);
  const [initiateError, setInitiateError] = useState<string | null>(null);

  const loadRenew = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNoActivePlan(false);
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

      const subscriptionResult = await getOwnSubscriptionWithPlan(memberRow.id);
      if (subscriptionResult.kind === 'no_subscription') {
        setNoActivePlan(true);
        return;
      }
      if (subscriptionResult.kind === 'error') {
        setLoadError(true);
        return;
      }
      setPlan(subscriptionResult.data);

      // Review-class precedent (Story 4.12): resume an already-processing
      // payment instead of letting a re-opened screen offer a second
      // "Confirm" that would fire a duplicate real USSD prompt.
      const pending = await getPendingMemberPayment(memberRow.id);
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
    void loadRenew();
  }, [loadRenew]);

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
      } else if (row.status === 'flagged') {
        stopPolling();
        setPhase('flagged');
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
      if (status === 'SUBSCRIBED') {
        stopPolling();
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

    const result = await initiateMemberPayment(phoneCheck.data);
    if (result.code !== 'success' || !result.paymentId) {
      setPhase('idle');
      if (result.code === 'gym_credentials_unavailable') {
        setInitiateError(t('renew.errors.gymCredentialsUnavailable'));
      } else if (result.code === 'mobile_money_disabled') {
        setInitiateError(t('renew.errors.mobileMoneyDisabled'));
      } else if (result.code === 'no_active_plan') {
        setInitiateError(t('renew.errors.noActivePlan'));
      } else if (result.code === 'not_eligible_for_renewal') {
        setInitiateError(t('renew.errors.notEligible'));
      } else if (result.code === 'payment_already_pending') {
        setInitiateError(t('renew.errors.paymentAlreadyPending'));
      } else {
        setInitiateError(t('renew.errors.initiateFailed'));
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

  function handleDone() {
    // Home's own useFocusEffect (Story 4.15) re-runs its subscription-status
    // query whenever the tab regains focus -- navigating back is enough to
    // refresh the badge/expiry without a second refresh mechanism.
    router.back();
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

        <ThemedText type="subtitle">{t('renew.title')}</ThemedText>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('renew.errors.loadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadRenew()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </Card>
        )}

        {!loading && !loadError && noActivePlan && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('renew.errors.noActivePlan')}
            </ThemedText>
          </Card>
        )}

        {!loading && !loadError && !noActivePlan && plan && (
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
            </Card>

            {phase === 'idle' || phase === 'sending' ? (
              <Card style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.payerPhone')}
                </ThemedText>
                <TextInput
                  value={payerPhone}
                  onChangeText={setPayerPhone}
                  keyboardType="phone-pad"
                  editable={phase !== 'sending'}
                  style={[styles.phoneInput, { color: theme.text, borderColor: theme.border }]}
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

            {phase === 'verified' ? (
              <Card style={styles.card}>
                <ThemedText type="default">{t('renew.success.title')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.success.description')}
                </ThemedText>
                <Button label={t('renew.success.doneButton')} onPress={handleDone} />
              </Card>
            ) : phase === 'flagged' ? (
              <Card style={styles.card}>
                <ThemedText type="small" style={styles.error}>
                  {t('renew.pending.failed')}
                </ThemedText>
                <Button label={t('common.tryAgain')} onPress={handleTryAgain} />
              </Card>
            ) : isWatching ? (
              <Card style={styles.card}>
                <ThemedText type="default">{t('renew.pending.title')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('renew.pending.description')}
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
                  <ThemedText type="small" style={styles.error}>
                    {initiateError}
                  </ThemedText>
                )}
                <Button
                  label={phase === 'sending' ? t('renew.sendingPaymentRequest') : t('renew.confirmButton')}
                  loading={phase === 'sending'}
                  onPress={() => void handleConfirm()}
                />
              </>
            )}
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
  phoneInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: {
    color: '#F87171',
  },
});
