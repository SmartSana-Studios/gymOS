import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressSteps } from '@/components/ui/ProgressSteps';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOnboardingProgress } from '@/lib/onboarding-context';
import { supabase } from '@/lib/supabase';

const TOTAL_STEPS = 4;
const CURRENT_STEP = 4;

interface PlanDetails {
  memberId: string;
  planName: string;
  planType: string;
  price: number;
  currency: string;
  billingInterval: string;
  durationDays: number | null;
  startDate: string;
  expiryDate: string | null;
}

// No `Database` generic on this project's Supabase client (lib/supabase.ts's
// own comment), so the embedded-select response below is manually typed --
// `plans` comes back as a single object, not an array, matching
// apps/dashboard/services/members.ts's identical `plans(name, plan_type)`
// many-to-one embed (`subscriptions.plan_id -> plans.id`).
interface SubscriptionRowFromDb {
  start_date: string;
  expiry_date: string | null;
  plans: {
    name: string;
    plan_type: string;
    price: number;
    currency: string;
    billing_interval: string;
    duration_days: number | null;
  } | null;
}

// Narrows the untyped embedded-select response instead of a blind `as
// unknown as` cast (Review finding) -- a shape mismatch now falls through to
// the caller's existing loadError handling instead of masking itself as a
// generic load failure with no signal.
function isSubscriptionRow(value: unknown): value is SubscriptionRowFromDb {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.start_date === 'string' &&
    (row.expiry_date === null || typeof row.expiry_date === 'string') &&
    typeof row.plans === 'object'
  );
}

// Date-only string ("YYYY-MM-DD") -- `new Date(string)` interprets that as
// UTC midnight, which `.toLocaleDateString()` can then roll back a day for
// a negative-UTC-offset viewer. Building the Date from local Y/M/D
// components avoids the shift (same fix apps/dashboard's MembersPageClient
// already applies for the identical expiry-date display problem).
function formatDateOnly(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale);
}

/** MA-08. On mount: resolve the caller's own current `members.id` (same
 * most-recently-created, non-deactivated tie-break the JWT claims hook uses,
 * 0009_auth_hook_gym_claims.sql), then their subscription + joined plan
 * (Story 2.7 Scope Note #3 -- both already readable by a member session, no
 * new RLS needed). "Confirm and start" is the single point that writes
 * goal/experience_level/onboarding_completed_at (Task 3's local state) and
 * finalizes the onboarding-context language into users.preferred_language
 * (Scope Note #4). */
export default function PlanScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { goal, experienceLevel, language } = useOnboardingProgress();

  const [plan, setPlan] = useState<PlanDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noPlanAssigned, setNoPlanAssigned] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setNoPlanAssigned(false);
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

      // `status` filter: Scope Note #3 notes there's only ever one
      // subscription per member at onboarding time, but ordering/filtering
      // defensively costs nothing -- excludes an expired/superseded row from
      // ever being shown or confirmed as the member's current plan.
      const { data: subscriptionData, error: subscriptionError } = await supabase
        .from('subscriptions')
        .select('start_date, expiry_date, plans(name, plan_type, price, currency, billing_interval, duration_days)')
        .eq('member_id', memberRow.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // PGRST116 = PostgREST's "no rows" code for `.single()` -- a member
      // with no active subscription is a distinct, non-retryable state from
      // a real network/connectivity failure (Review finding); everything
      // else (including a malformed embedded-select shape) falls back to
      // the generic, retryable load error.
      if (subscriptionError?.code === 'PGRST116') {
        setNoPlanAssigned(true);
        return;
      }

      if (subscriptionError || !isSubscriptionRow(subscriptionData) || !subscriptionData.plans) {
        setLoadError(true);
        return;
      }

      const planRow = subscriptionData.plans;

      setPlan({
        memberId: memberRow.id,
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

  async function handleConfirm() {
    if (!plan || !goal || !experienceLevel) return;

    setSubmitting(true);
    setSubmitError(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setSubmitError(true);
        return;
      }

      // Sequenced, not `Promise.all` (Review finding): `users.preferred_language`
      // writes first, and `members.onboarding_completed_at` -- the column that
      // flips the root auth gate (Scope Note #1) -- writes last. If the
      // member abandons the app after a failure, the gate can never be left
      // flipped while Scope Note #4's language finalization is silently lost.
      const userResult = await supabase
        .from('users')
        .update({ preferred_language: language ?? i18n.language })
        .eq('id', userId)
        .select('id');

      if (userResult.error || userResult.data.length === 0) {
        setSubmitError(true);
        return;
      }

      const memberResult = await supabase
        .from('members')
        .update({ goal, experience_level: experienceLevel, onboarding_completed_at: new Date().toISOString() })
        .eq('id', plan.memberId)
        .select('id');

      // `.select()` + row-count check (Review finding): a zero-row update
      // (e.g. a stale JWT `gym_id` claim, or the member row was deactivated
      // mid-flow) returns `error: null` under PostgREST -- without this
      // check that would be silently treated as a full success.
      if (memberResult.error || memberResult.data.length === 0) {
        setSubmitError(true);
        return;
      }

      // Story 10.1 (Review finding): `refreshSession()` used to run here,
      // before navigating onward -- but the optional body-profile step below
      // still lives inside the guarded `onboarding` Stack.Protected group
      // (root layout's guard is keyed on `onboarding_completed_at`, which
      // this screen already wrote above), so it's reachable without a
      // refresh. Refreshing here instead raced `onAuthStateChange`'s async
      // `refreshOnboardedState` against this navigation: `isFullyOnboarded`
      // could flip true while the member was still on body-profile, and the
      // root guard would then exclude the `onboarding` group mid-step and
      // bounce them straight to `(tabs)`. The refresh is now deferred to
      // body-profile's own Skip/Save handlers, which need it immediately
      // before their own `router.replace('/(tabs)')`.
      router.push('/onboarding/body-profile');
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const billingSuffixKey =
    plan?.billingInterval === 'annual' ? 'onboarding.plan.perYear' : 'onboarding.plan.perMonth';

  const durationLabel =
    plan?.planType === 'pay_per_session' || plan?.durationDays === null
      ? t('onboarding.plan.noFixedDuration')
      : t('onboarding.plan.durationDays', { count: plan?.durationDays ?? 0 });

  const expiryLabel = plan?.expiryDate ? formatDateOnly(plan.expiryDate, i18n.language) : t('onboarding.plan.noExpiry');

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

        <ThemedText type="small">{t('onboarding.plan.stepIndicator', { step: CURRENT_STEP })}</ThemedText>
        <ProgressSteps totalSteps={TOTAL_STEPS} currentStep={CURRENT_STEP} />

        <ThemedText type="subtitle">{t('onboarding.plan.title')}</ThemedText>

        {loading && <ActivityIndicator style={styles.loadingIndicator} />}

        {!loading && loadError && (
          <Card style={styles.planCard}>
            <ThemedText type="small" style={styles.error}>
              {t('onboarding.plan.errorLoadFailed')}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => void loadPlan()}>
              <ThemedText type="link">{t('common.tryAgain')}</ThemedText>
            </Pressable>
          </Card>
        )}

        {/* Distinct from `loadError` (Review finding): a member with no
            active subscription can never succeed by retrying the same
            query, so it gets its own non-retryable message instead of the
            network-failure "try again" copy. */}
        {!loading && noPlanAssigned && (
          <Card style={styles.planCard}>
            <ThemedText type="small" style={styles.error}>
              {t('onboarding.plan.errorNoPlanAssigned')}
            </ThemedText>
          </Card>
        )}

        {!loading && !loadError && !noPlanAssigned && plan && (
          <Card style={styles.planCard}>
            <ThemedText type="subtitle">{plan.planName}</ThemedText>
            <ThemedText type="default">{durationLabel}</ThemedText>
            <ThemedText type="default">
              {plan.price} {plan.currency} {t(billingSuffixKey)}
            </ThemedText>
            <ThemedText type="default">
              {t('onboarding.plan.activeFrom', { date: formatDateOnly(plan.startDate, i18n.language) })}
            </ThemedText>
            <ThemedText type="default">{t('onboarding.plan.expires', { date: expiryLabel })}</ThemedText>
          </Card>
        )}

        <ThemedText type="small" themeColor="textSecondary">
          {t('onboarding.plan.note')}
        </ThemedText>

        <View style={styles.continueButton}>
          <Button
            label={t('onboarding.plan.confirmButton')}
            disabled={!plan || !goal || !experienceLevel || loading}
            loading={submitting}
            onPress={handleConfirm}
          />
        </View>

        {/* EXPERIENCE.md MA-08 error state: "Inline below button" -- tapping
            "Confirm and start" again is the retry action (AC #4), same
            no-separate-retry-button pattern profile.tsx's errorSaveFailed
            already uses. */}
        {submitError && (
          <ThemedText type="small" style={styles.error}>
            {t('onboarding.plan.errorSaveFailed')}
          </ThemedText>
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
  planCard: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  error: {
    color: '#F87171',
  },
  continueButton: {
    marginTop: Spacing.three,
  },
});
