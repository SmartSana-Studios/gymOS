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
