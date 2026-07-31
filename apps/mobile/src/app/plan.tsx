import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { isSubscriptionStatus, STATUS_COLORS, statusLabelKey, type SubscriptionStatus } from '@/constants/subscription-status';
import { supabase } from '@/lib/supabase';

type PlanType = 'pay_per_session' | 'monthly' | 'coach_inclusive' | 'class_only';
const PLAN_TYPES: readonly PlanType[] = ['pay_per_session', 'monthly', 'coach_inclusive', 'class_only'];
function isPlanType(value: string): value is PlanType {
  return (PLAN_TYPES as readonly string[]).includes(value);
}

// Mirrors apps/dashboard/app/(dashboard)/plans/planLabels.ts's
// PLAN_TYPE_LABEL_KEY/ACCESS_DESCRIPTION_KEY pattern -- new mobile-locale
// keys, not imported directly (mobile locales are a separate file per
// architecture.md). Keyed on `PlanType` (not `string`) so a new enum value
// is a compile error here instead of silently falling back to "Monthly".
const PLAN_TYPE_LABEL_KEY: Record<PlanType, string> = {
  pay_per_session: 'plan.type.payPerSession',
  monthly: 'plan.type.monthly',
  coach_inclusive: 'plan.type.coachInclusive',
  class_only: 'plan.type.classOnly',
};

const ACCESS_DESCRIPTION_KEY: Record<PlanType, string> = {
  pay_per_session: 'plan.access.payPerSession',
  monthly: 'plan.access.monthly',
  coach_inclusive: 'plan.access.coachInclusive',
  class_only: 'plan.access.classOnly',
};

interface PlanDetails {
  status: SubscriptionStatus;
  planName: string;
  planType: PlanType;
  price: number;
  currency: string;
  billingInterval: string;
  durationDays: number | null;
  startDate: string;
  expiryDate: string | null;
}

// Narrows the untyped embedded-select response, same discipline as
// onboarding/plan.tsx's `isSubscriptionRow` -- a shape mismatch falls
// through to the existing loadError handling instead of masking itself as
// a generic failure with no signal. Nested `plans` fields are validated
// individually (not just `typeof === 'object'`) so a malformed/renamed join
// column trips this guard instead of rendering `undefined` values.
interface SubscriptionRowFromDb {
  status: string;
  start_date: string;
  expiry_date: string | null;
  plans: {
    name: string;
    plan_type: PlanType;
    price: number;
    currency: string;
    billing_interval: string;
    duration_days: number | null;
  } | null;
}
function isSubscriptionRow(value: unknown): value is SubscriptionRowFromDb {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.status !== 'string' ||
    typeof row.start_date !== 'string' ||
    (row.expiry_date !== null && typeof row.expiry_date !== 'string')
  ) {
    return false;
  }
  if (row.plans === null) return true;
  if (typeof row.plans !== 'object' || Array.isArray(row.plans)) return false;
  const plans = row.plans as Record<string, unknown>;
  return (
    typeof plans.name === 'string' &&
    typeof plans.plan_type === 'string' &&
    isPlanType(plans.plan_type) &&
    typeof plans.price === 'number' &&
    typeof plans.currency === 'string' &&
    typeof plans.billing_interval === 'string' &&
    (plans.duration_days === null || typeof plans.duration_days === 'number')
  );
}

// Date-only string ("YYYY-MM-DD") -- same local-Y/M/D construction as
// onboarding/plan.tsx's/`(tabs)/index.tsx`'s `formatDateOnly`, duplicated
// rather than shared since no date-utils module exists in this app yet.
function formatDateOnly(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

/** MA-13, reached as a modal route from Home/History (Scope Note #2). On
 * mount, resolves the caller's own `members.id` (same duplicated block as
 * every other member-app screen), then their most-recent subscription +
 * joined plan -- deliberately **not** filtered to `status = 'active'`
 * (Story 3.7 Scope Note #4): an `expiring_soon`/`grace_period`/`expired`
 * member must still be able to view their plan. Both reads are already
 * authorized by `gym_staff_read_own_subscriptions` (0018) and
 * `gym_staff_read_own_plans` (0017) -- no new migration. */
export default function PlanScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  const [plan, setPlan] = useState<PlanDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noSubscription, setNoSubscription] = useState(false);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNoSubscription(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setLoadError(true);
        return;
      }

      const { data: memberRow, error: memberError } = await supabase
        .from('members')
        .select('id')
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

      const { data: subscriptionData, error: subscriptionError } = await supabase
        .from('subscriptions')
        .select('status, start_date, expiry_date, plans(name, plan_type, price, currency, billing_interval, duration_days)')
        .eq('member_id', memberRow.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // PGRST116 = PostgREST's "no rows" code for `.single()` -- a member
      // with literally zero subscription rows (shouldn't normally happen
      // post-onboarding, but defended anyway) is a distinct, non-retryable
      // state, not a load failure.
      if (subscriptionError?.code === 'PGRST116') {
        setNoSubscription(true);
        return;
      }

      if (
        subscriptionError ||
        !isSubscriptionRow(subscriptionData) ||
        !subscriptionData.plans ||
        !isSubscriptionStatus(subscriptionData.status)
      ) {
        setLoadError(true);
        return;
      }

      const planRow = subscriptionData.plans;

      setPlan({
        status: subscriptionData.status,
        planName: planRow.name,
        planType: planRow.plan_type,
        price: planRow.price,
        currency: planRow.currency,
        billingInterval: planRow.billing_interval,
        durationDays: planRow.duration_days,
        startDate: subscriptionData.start_date,
        expiryDate: subscriptionData.expiry_date,
      });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const statusColors = plan ? STATUS_COLORS[plan.status] : null;

  const durationLabel = plan
    ? plan.planType === 'pay_per_session' || plan.durationDays === null
      ? t('plan.noFixedDuration')
      : t('plan.durationDays', { count: plan.durationDays })
    : null;

  const expiryLabel = plan ? (plan.expiryDate ? formatDateOnly(plan.expiryDate, i18n.language) : t('plan.noExpiry')) : null;

  const billingLabel = plan ? (plan.billingInterval === 'annual' ? t('plan.billingAnnual') : t('plan.billingMonthly')) : null;

  const planTypeLabel = plan ? t(PLAN_TYPE_LABEL_KEY[plan.planType]) : null;
  const accessDescription = plan ? t(ACCESS_DESCRIPTION_KEY[plan.planType]) : null;

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

        <ThemedText type="subtitle">{t('plan.title')}</ThemedText>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <View style={styles.planCard}>
            <ThemedText type="small" style={styles.error}>
              {t('plan.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadPlan()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </View>
        )}

        {!loading && noSubscription && (
          <View style={styles.planCard}>
            <ThemedText type="small" style={styles.error}>
              {t('plan.errorNoSubscription')}
            </ThemedText>
          </View>
        )}

        {!loading && !loadError && !noSubscription && plan && statusColors && (
          <View style={styles.planCard}>
            <View style={styles.headerRow}>
              <ThemedText type="subtitle">{planTypeLabel}</ThemedText>
              <View
                style={[
                  styles.statusBadge,
                  styles.statusBadgeRow,
                  { backgroundColor: statusColors.bg, borderColor: statusColors.border },
                ]}>
                {plan.status === 'grace_period' && (
                  <MaterialIcons name="warning" size={16} color={statusColors.text} />
                )}
                <ThemedText type="smallBold" style={{ color: statusColors.text }}>
                  {t(statusLabelKey[plan.status])}
                </ThemedText>
              </View>
            </View>

            <ThemedText type="default">
              {t('plan.priceLabel')}: {plan.price} {plan.currency} ({billingLabel})
            </ThemedText>
            <ThemedText type="default">
              {t('plan.durationLabel')}: {durationLabel}
            </ThemedText>
            <ThemedText type="default">
              {t('plan.activeFromLabel')}: {formatDateOnly(plan.startDate, i18n.language)}
            </ThemedText>
            <ThemedText type="default">
              {t('plan.expiryLabel')}: {expiryLabel}
            </ThemedText>
            <ThemedText type="default">
              {t('plan.billingLabel')}: {billingLabel}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('plan.accessLabel')}: {accessDescription}
            </ThemedText>
          </View>
        )}
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
  loadingIndicator: {
    marginTop: Spacing.four,
  },
  planCard: {
    borderWidth: 1,
    borderColor: '#E0E1E6',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  error: {
    color: '#B3261E',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
});
