import { supabase } from '@/lib/supabase';
import type {
  GrantFact,
  LatestSubscriptionFact,
  LoyaltySession,
  LoyaltySnapshot,
  RewardEventFact,
  RewardsData,
} from '@/lib/rewards';

// Story 20.6 (FR-169): the member app's read path for the Home Rewards card.
// `effective_loyalty()` supplies counters, windows and session rows; grant
// facts (creation time, reward event, latest subscription) come from the
// member's own rows. Read-only: no write to any loyalty table.

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function asPositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asSessions(value: unknown): LoyaltySession[] {
  if (!Array.isArray(value)) return [];
  const out: LoyaltySession[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, usable_until: usableUntil } = entry as Record<string, unknown>;
    if (typeof id === 'string' && typeof usableUntil === 'string') out.push({ id, usableUntil });
  }
  return out;
}

/** Parses `effective_loyalty()`'s JSON. JSON null (suspended gym) or any
 * non-object / malformed payload is `null`: the card is left out. */
export function parseEffectiveLoyalty(raw: unknown): LoyaltySnapshot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.enabled !== 'boolean') return null;
  return {
    enabled: row.enabled,
    guestStamps: asCount(row.guest_stamps),
    subscriberStamps: asCount(row.subscriber_stamps),
    guestThreshold: asPositive(row.guest_threshold),
    renewalThreshold: asPositive(row.renewal_threshold),
    rewardDays: asPositive(row.reward_days),
    guestWindowDays: asPositive(row.guest_window_days),
    subscriberWindowDays: asPositive(row.subscriber_window_days),
    freeSessions: asSessions(row.free_sessions),
    paidSessions: asSessions(row.paid_sessions),
  };
}

export function mapGrantRows(rows: unknown): GrantFact[] {
  if (!Array.isArray(rows)) return [];
  const out: GrantFact[] = [];
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const { id, created_at: createdAt, usable_until: usableUntil } = r as Record<string, unknown>;
    if (typeof id === 'string' && typeof createdAt === 'string' && typeof usableUntil === 'string') {
      out.push({ id, createdAt, usableUntil });
    }
  }
  return out;
}

export function mapRewardEvent(row: unknown): RewardEventFact | null {
  if (typeof row !== 'object' || row === null) return null;
  const details = (row as Record<string, unknown>).details;
  if (typeof details !== 'object' || details === null) return null;
  const { subscription_id: subscriptionId, reward_days: rewardDays } = details as Record<string, unknown>;
  if (typeof subscriptionId !== 'string' || typeof rewardDays !== 'number' || !Number.isFinite(rewardDays)) {
    return null;
  }
  return { subscriptionId, rewardDays };
}

export function mapLatestSubscription(row: unknown): LatestSubscriptionFact | null {
  if (typeof row !== 'object' || row === null) return null;
  const { id, expiry_date: expiryDate } = row as Record<string, unknown>;
  if (typeof id !== 'string' || typeof expiryDate !== 'string') return null;
  return { id, expiryDate };
}

/** Loads everything the Rewards card needs for the caller's own member row.
 * Returns null on a failed or JSON-null `effective_loyalty` read (card left
 * out). The own-row reads are supplementary: a failure there drops only the
 * headline / free-days line. Never throws. */
export async function getOwnLoyalty(memberId: string): Promise<RewardsData | null> {
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('effective_loyalty', { p_member_id: memberId });
    if (rpcError) return null;
    const loyalty = parseEffectiveLoyalty(rpcData);
    if (!loyalty) return null;

    const [session, grantResult, eventResult, subResult, memberResult] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('guest_sessions')
        .select('id, created_at, usable_until')
        .eq('member_id', memberId)
        .not('loyalty_grant_id', 'is', null)
        .is('consumed_at', null)
        .is('voided_at', null)
        .gt('usable_until', new Date().toISOString()),
      supabase
        .from('loyalty_events')
        .select('details')
        .eq('member_id', memberId)
        .eq('event_type', 'reward_granted')
        .eq('counter', 'subscriber')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('subscriptions')
        .select('id, expiry_date')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('members').select('gym_id').eq('id', memberId).maybeSingle(),
    ]);

    const userId = session.data.session?.user.id ?? null;
    const gymId = memberResult.error ? null : (memberResult.data?.gym_id ?? null);

    return {
      loyalty,
      grants: grantResult.error ? [] : mapGrantRows(grantResult.data),
      rewardEvent: eventResult.error ? null : mapRewardEvent(eventResult.data),
      latestSubscription: subResult.error ? null : mapLatestSubscription(subResult.data),
      scope: userId && gymId ? `${userId}.${gymId}` : null,
    };
  } catch {
    return null;
  }
}
