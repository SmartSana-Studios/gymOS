import { supabase } from '@/lib/supabase';
import { isSubscriptionStatus, type SubscriptionStatus } from '@/constants/subscription-status';

export interface OwnSubscriptionWithPlan {
  status: SubscriptionStatus;
  expiryDate: string | null;
  planName: string;
  planPrice: number;
  planCurrency: string;
}

export type SubscriptionWithPlanResult =
  | { kind: 'ok'; data: OwnSubscriptionWithPlan }
  | { kind: 'no_subscription' }
  | { kind: 'error' };

// Narrows the untyped embedded-select response, same discipline as
// (tabs)/index.tsx's/plan.tsx's own isSubscriptionRow guards.
interface SubscriptionRowFromDb {
  status: string;
  expiry_date: string | null;
  plans: { name: string; price: number; currency: string } | null;
}
function isSubscriptionRow(value: unknown): value is SubscriptionRowFromDb {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.status !== 'string' || (row.expiry_date !== null && typeof row.expiry_date !== 'string')) {
    return false;
  }
  if (row.plans === null) return true;
  if (typeof row.plans !== 'object' || Array.isArray(row.plans)) return false;
  const plans = row.plans as Record<string, unknown>;
  return typeof plans.name === 'string' && typeof plans.price === 'number' && typeof plans.currency === 'string';
}

/**
 * Story 4.15: shared by Home (the Renew-CTA decision) and the new Renew
 * screen (plan-price display) -- both need the same subscription+plan-price
 * shape. A shared helper here, rather than each screen's own inline
 * duplicate (this app's usual per-screen convention, e.g. plan.tsx), avoids
 * the divergence the story flags: Home's existing subscription query never
 * selected plan price before this story. Most-recent-by-created_at, not
 * filtered to status = 'active' -- an expiring_soon/grace_period/expired
 * member must still resolve their own plan.
 */
export async function getOwnSubscriptionWithPlan(memberId: string): Promise<SubscriptionWithPlanResult> {
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('status, expiry_date, plans(name, price, currency)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // PGRST116 = PostgREST's "no rows" code for `.single()` -- a member with
    // zero subscription rows, distinct from a real load failure (same
    // distinction (tabs)/index.tsx/plan.tsx already make).
    if (error?.code === 'PGRST116') {
      return { kind: 'no_subscription' };
    }
    if (error || !isSubscriptionRow(data) || !data.plans || !isSubscriptionStatus(data.status)) {
      return { kind: 'error' };
    }

    return {
      kind: 'ok',
      data: {
        status: data.status,
        expiryDate: data.expiry_date,
        planName: data.plans.name,
        planPrice: data.plans.price,
        planCurrency: data.plans.currency,
      },
    };
  } catch {
    return { kind: 'error' };
  }
}
