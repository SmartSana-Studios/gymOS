import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/Card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isPaymentMethod, isPaymentStatus, PAYMENT_METHOD_LABEL_KEY, paymentStatusLabelKey } from '@/constants/payment-status';
import { supabase } from '@/lib/supabase';
import { getPaymentReceipt, type PaymentReceipt } from '@/services/payments';

function formatReceiptDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { dateStyle: 'medium' });
}

/** MA-14. Nested child route of `(tabs)/history/` (Scope Notes) -- reached
 * via `router.push('/history/payment/${id}')` from the Payments tab (Task
 * 4), needs no `Stack.Screen` registration in `_layout.tsx` (unlike `/plan`,
 * a root-level sibling of `(tabs)`). Read-only, no actions (AC #2: "no
 * refund action available to the member"). On mount, resolves the caller's
 * own `members.id` + `gym_id` + `name` (extended past every prior screen's
 * duplicated resolution block, which only ever selects `id` -- this screen
 * also needs `gym_id`/`name` for `getPaymentReceipt`) and the gym's `name`,
 * then fetches the receipt. A `null` result (query error, RLS-denied, or a
 * stale/deleted id) is a single non-distinguished error state -- same
 * discipline as every other screen in this app, no separate "not found"
 * branch. */
export default function PaymentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadReceipt = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId || !id) {
        setLoadError(true);
        return;
      }

      const [memberResult, gymResult] = await Promise.all([
        supabase
          .from('members')
          .select('id, gym_id, name')
          .eq('user_id', userId)
          .is('deactivated_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .single(),
        supabase.from('gyms').select('name').single(),
      ]);

      if (memberResult.error || !memberResult.data || gymResult.error || !gymResult.data) {
        setLoadError(true);
        return;
      }

      const result = await getPaymentReceipt(
        id,
        memberResult.data.id,
        memberResult.data.gym_id,
        memberResult.data.name,
        gymResult.data.name,
      );

      if (!result) {
        setLoadError(true);
        return;
      }

      setReceipt(result);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadReceipt();
  }, [loadReceipt]);

  const methodLabel = receipt
    ? isPaymentMethod(receipt.method)
      ? t(PAYMENT_METHOD_LABEL_KEY[receipt.method])
      : receipt.method
    : null;
  const statusLabel = receipt
    ? isPaymentStatus(receipt.status)
      ? t(paymentStatusLabelKey[receipt.status])
      : receipt.status
    : null;

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

        <ThemedText type="subtitle">{t('paymentDetail.title')}</ThemedText>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.card}>
            <ThemedText type="small" style={styles.error}>
              {t('paymentDetail.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadReceipt()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </Card>
        )}

        {!loading && !loadError && receipt && (
          <Card style={styles.card}>
            <ThemedText type="default">
              {t('paymentDetail.memberLabel')}: {receipt.memberName}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.gymLabel')}: {receipt.gymName}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.planLabel')}: {receipt.planName ?? t('paymentDetail.planUnavailable')}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.amountLabel')}: {receipt.amount} {receipt.currency}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.methodLabel')}: {methodLabel}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.dateLabel')}: {formatReceiptDate(receipt.createdAt, i18n.language)}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.referenceLabel')}: {receipt.transactionRef ?? t('paymentDetail.noReference')}
            </ThemedText>
            <ThemedText type="default">
              {t('paymentDetail.actorLabel')}: {receipt.actorName ?? t('paymentDetail.unknownActor')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('paymentDetail.statusLabel')}: {statusLabel}
            </ThemedText>
          </Card>
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
    gap: Spacing.two,
  },
  backButton: {
    paddingVertical: Spacing.two,
  },
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  card: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  error: {
    color: '#F87171',
  },
});
