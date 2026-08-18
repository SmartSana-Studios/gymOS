import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export interface PaymentListRow {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  planName: string | null;
}

interface PaymentListRowFromDb {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
  subscription_id: string | null;
  subscriptions: { plans: { name: string } | null } | null;
}

/** History screen's Payments tab (AC #1). Cursor (keyset) pagination on
 * `(created_at desc, id desc)`, same `.or('created_at.lt.X,and(created_at.eq.X,id.lt.Y)')`
 * shape as `(tabs)/history/index.tsx`'s `loadCheckInsPage` -- offset-based
 * `.range()` pagination drifts/duplicates rows under concurrent inserts
 * (Story 3.10 Review Finding, now-fixed precedent this story must not
 * regress). `subscriptions(plans(name))` is a two-hop nested embed
 * (payments.subscription_id -> subscriptions.id -> subscriptions.plan_id ->
 * plans.id) -- when `subscription_id` is null (the common case for manual/
 * unrenewed payments, Scope Notes), the embedded `subscriptions` field is
 * null and maps to `planName: null`, not an error. Returns `null` (not
 * throw, not an empty array) on any query error -- unlike
 * `getRecentCheckIns`'/`getRecentPayments`' best-effort contract, the
 * Payments tab has a real, AC-required error state to surface, so the
 * caller needs to distinguish "zero rows" from "load failed". */
export async function loadPaymentsPage(
  memberId: string,
  after: { createdAt: string; id: string } | null,
  limit: number,
): Promise<PaymentListRow[] | null> {
  let query = supabase
    .from('payments')
    .select('id, amount, currency, method, status, created_at, subscription_id, subscriptions(plans(name))')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (after) {
    query = query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  }

  const { data, error } = await query;
  if (error || !data) return null;

  const rows = data as unknown as PaymentListRowFromDb[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    status: row.status,
    planName: row.subscriptions?.plans?.name ?? null,
  }));
}

export interface PaymentReceipt {
  id: string;
  memberName: string;
  gymName: string;
  planName: string | null;
  amount: number;
  currency: string;
  method: string;
  createdAt: string;
  transactionRef: string | null;
  actorName: string | null;
  status: string;
}

interface PaymentReceiptRowFromDb {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
  provider_transaction_ref: string | null;
  actor_id: string | null;
  subscription_id: string | null;
  subscriptions: { plans: { name: string } | null } | null;
}

/** MA-14 receipt screen (AC #2). Takes the caller-resolved member/gym
 * context as parameters (this app's established "resolve once, pass down"
 * convention -- e.g. `history/index.tsx` resolving `gymName` once) rather
 * than re-querying `members`/`gyms` a second time. The `.eq('member_id',
 * memberId)` filter is defense-in-depth -- RLS (`member_read_own_payments`,
 * 0038 migration) already scopes this to the caller's own payment, same
 * "still add an explicit filter" precedent as `subscriptions_current`
 * (Story 4.8). Actor-name resolution is a second, separate query (not a
 * join -- `payments.actor_id` is a `users.id`, not FK-joinable to
 * `members`, same shape `listPendingPayments()` in
 * apps/dashboard/services/payments.ts already works around) via the new
 * `member_read_gym_staff_members` policy (0038); `actor_id` can legitimately
 * be null (`initiatePayment()` never sets it), and a null/RLS-denied lookup
 * both resolve to `actorName: null`, never an error. Returns `null` (not
 * throw) on any query error -- the calling screen owns the load-error UI. */
export async function getPaymentReceipt(
  paymentId: string,
  memberId: string,
  memberGymId: string,
  memberName: string,
  gymName: string,
): Promise<PaymentReceipt | null> {
  const { data, error } = await supabase
    .from('payments')
    .select(
      'id, amount, currency, method, status, created_at, provider_transaction_ref, actor_id, subscription_id, subscriptions(plans(name))',
    )
    .eq('id', paymentId)
    .eq('member_id', memberId)
    .single();

  if (error || !data) return null;

  const row = data as unknown as PaymentReceiptRowFromDb;

  let actorName: string | null = null;
  if (row.actor_id) {
    const { data: actorRow } = await supabase
      .from('members')
      .select('name')
      .eq('user_id', row.actor_id)
      .eq('gym_id', memberGymId)
      .maybeSingle();
    actorName = actorRow?.name ?? null;
  }

  return {
    id: row.id,
    memberName,
    gymName,
    planName: row.subscriptions?.plans?.name ?? null,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    createdAt: row.created_at,
    transactionRef: row.provider_transaction_ref,
    actorName,
    status: row.status,
  };
}

export interface RecentPayment {
  id: string;
  createdAt: string;
  amount: number;
  currency: string;
}

/** Home screen's combined Recent Activity feed (AC #3). Deliberately smaller
 * than `PaymentListRow` -- Home's activity row doesn't show plan/method/
 * status per EXPERIENCE.md's MA-09 mockup, just enough to identify the
 * event. Same best-effort, non-blocking, empty-array-on-any-failure
 * contract as `getRecentCheckIns` (`services/checkin.ts`). */
export async function getRecentPayments(memberId: string, limit: number): Promise<RecentPayment[]> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id, amount, currency, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row) => ({ id: row.id, createdAt: row.created_at, amount: row.amount, currency: row.currency }));
  } catch {
    return [];
  }
}

// ============================================================================
// Story 4.15: Member Self-Service Renewal. `initiate_member_payment()`
// (0055_member_self_service_renewal.sql) is the member-session counterpart
// to apps/dashboard/services/payments.ts's initiatePayment() -- a
// SECURITY DEFINER RPC that derives amount/currency from the caller's own
// plan and inserts the processing row itself, rather than a direct table
// insert (no member-scoped payments INSERT policy exists, deliberately --
// see the story file's Context section). Once it returns a payment_id, the
// same shared payment-webhook/initiate/<providerKey> route the dashboard
// calls is invoked -- no Edge Function change needed for that route itself.
// ============================================================================

/** Any authenticated gym-scoped session can call this (0052_gym_payment_credentials.sql
 * -- not owner-gated); resolves the caller's own gym via private.gym_id()
 * internally, no gym-id parameter needed. Best-effort boolean, matching
 * `getRecentPayments`' contract -- a real RPC failure and "not connected"
 * both resolve to `false` (no charge risk either way; the caller falls back
 * to the front-desk-cash message per AC #3). */
export async function getGymTaraMoneyConnectionStatus(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('get_gym_payment_connection_status', { p_provider_key: 'taramoney' });
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Mirrors `getPendingMobileMoneyPayment` (apps/dashboard/services/payments.ts)
 * but as a direct table query, not a new RPC -- `member_read_own_payments`
 * RLS (0038) already lets a member's own session select their own `payments`
 * rows. Called before allowing a fresh `initiateMemberPayment()` call, so a
 * second tap resumes the existing row instead of firing a duplicate real
 * USSD prompt (same bug class Story 4.12's review caught for the front-desk
 * path). */
export async function getPendingMemberPayment(memberId: string): Promise<{ paymentId: string } | null> {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('id')
      .eq('member_id', memberId)
      .eq('method', 'mobile_money')
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return { paymentId: data.id };
  } catch {
    return null;
  }
}

export interface InitiateMemberPaymentResult {
  paymentId: string | null;
  /** 'gym_credentials_unavailable'/'mobile_money_disabled' mirror the Edge
   * Function's own structured failure codes (Story 4.14/4.15 Task 3) -- a
   * bare boolean/null can't distinguish these from a generic failure, and
   * the Renew screen needs a distinct message for each. 'no_active_plan'/
   * 'not_eligible_for_renewal'/'payment_already_pending' mirror
   * initiate_member_payment()'s own distinguishable exceptions
   * (0055_member_self_service_renewal.sql, review finding -- these were
   * previously collapsed into the generic 'error' code). */
  code:
    | 'success'
    | 'gym_credentials_unavailable'
    | 'mobile_money_disabled'
    | 'no_active_plan'
    | 'not_eligible_for_renewal'
    | 'payment_already_pending'
    | 'error';
}

/** Maps initiate_member_payment()'s raw Postgres exception text to a
 * caller-friendly code by the same distinguishable substring the RPC itself
 * raises with -- 'permission denied'/'member is deactivated' fall through
 * to the generic code since both are defensive-only (unreachable via this
 * app's normal session flow: a deactivated member never gets a 'member'
 * JWT claim in the first place, per the auth hook, 0009_*.sql). */
function mapInitiateErrorCode(message: string | undefined): InitiateMemberPaymentResult['code'] {
  if (!message) return 'error';
  if (message.includes('no_active_plan')) return 'no_active_plan';
  if (message.includes('not_eligible_for_renewal')) return 'not_eligible_for_renewal';
  if (message.includes('payment_already_pending')) return 'payment_already_pending';
  return 'error';
}

/**
 * Calls `initiate_member_payment()` then invokes the same shared
 * payment-webhook/initiate/<providerKey> route
 * apps/dashboard/services/payments.ts's initiatePayment() calls -- mirrors
 * that function's shape (bare-digit phone stripping, FunctionsHttpError
 * code-mapping), extended to also catch the new `mobile_money_disabled`
 * code (Task 3), which initiatePayment() never needs to since the
 * dashboard's own `isMobileMoneyInitiationEnabled()` pre-check means it
 * never reaches the Edge Function in the disabled case -- mobile has no
 * equivalent pre-check, so it can hit this code for real. Never throws
 * (mirrors this app's `RecordCheckInResult`-shaped convention,
 * services/checkin.ts) -- a distinguishable code, not just null, since the
 * caller needs to tell "gym disconnected mid-flow" and "kill switch
 * disabled" apart from a generic error.
 */
export async function initiateMemberPayment(phoneNumber: string): Promise<InitiateMemberPaymentResult> {
  try {
    const { data: paymentId, error: rpcError } = await supabase.rpc('initiate_member_payment');
    if (rpcError || !paymentId) {
      return { paymentId: null, code: mapInitiateErrorCode(rpcError?.message) };
    }

    // Reads the provider `initiate_member_payment()` already resolved and
    // stored on the row itself, rather than a second independent
    // `active_payment_provider()` call (review finding -- the previous
    // two-call shape was a TOCTOU: the active provider could change between
    // the RPC's own resolution and this second call, diverging from what's
    // actually stored on the row). This also mirrors
    // apps/dashboard/services/payments.ts's initiatePayment() risk model:
    // once the row exists, no further fallible step should sit between it
    // and the invoke() call below, since a member session has no `payments`
    // DELETE RLS policy and can never clean up an orphaned row itself --
    // only the Edge Function (service_role) can.
    const { data: paymentRow, error: providerError } = await supabase
      .from('payments')
      .select('provider')
      .eq('id', paymentId)
      .single();
    if (providerError || !paymentRow?.provider) {
      return { paymentId: null, code: 'error' };
    }
    const providerKey = paymentRow.provider;

    // TaraMoney's real API takes bare-digit Cameroon numbers with no leading
    // '+' -- same stripping as initiatePayment()'s one call site that
    // actually talks to the provider.
    const bareDigitPhone = phoneNumber.replace(/^\+/, '');

    const { error: invokeError } = await supabase.functions.invoke(`payment-webhook/initiate/${providerKey}`, {
      body: { paymentId, phoneNumber: bareDigitPhone },
    });

    if (invokeError) {
      if (invokeError instanceof FunctionsHttpError) {
        let code: string | undefined;
        try {
          code = (await invokeError.context.json())?.code;
        } catch {
          // Non-JSON or unreadable body -- falls through to the generic 'error' below.
        }
        if (code === 'gym_credentials_unavailable' || code === 'mobile_money_disabled') {
          return { paymentId: null, code };
        }
      }
      return { paymentId: null, code: 'error' };
    }

    return { paymentId, code: 'success' };
  } catch {
    return { paymentId: null, code: 'error' };
  }
}
