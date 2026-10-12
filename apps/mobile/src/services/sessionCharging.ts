import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSubscriptionStatus } from '@/constants/subscription-status';
import { supabase } from '@/lib/supabase';
import {
  mergeDenials,
  type ChargingContext,
  type SessionSubscriptionStatus,
  type SyncDenial,
} from '@/lib/sessionState';
import { getOwnSubscriptionWithPlan } from '@/services/subscriptions';

// Story 19.11: the member app's view of "is this gym charging me per
// session". Cached so the offline scan path (no network) can still decide
// whether to show the "will be verified" state. The server rule governs at
// sync; the cache only shapes copy.
const CONTEXT_KEY = 'gymos.sessionChargingContext.v1';
const DENIALS_KEY_PREFIX = 'gymos.sessionSyncDenials.v2.';

interface CachedContext {
  userId: string;
  context: ChargingContext;
}

/** Online refresh: gym flag + timezone, latest plan, latest subscription
 * status. Returns null (and leaves any cache untouched) on any failure. */
export async function refreshChargingContext(): Promise<ChargingContext | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;

    const [gymResult, memberResult] = await Promise.all([
      supabase.from('gyms').select('charge_guests_per_session, timezone').single(),
      supabase
        .from('members')
        .select('id')
        .eq('user_id', userId)
        .is('deactivated_at', null)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .single(),
    ]);
    if (gymResult.error || !gymResult.data || memberResult.error || !memberResult.data) return null;

    const subscription = await getOwnSubscriptionWithPlan(memberResult.data.id);
    if (subscription.kind === 'error') return null;

    let context: ChargingContext;
    if (subscription.kind === 'no_subscription') {
      context = {
        chargingEnabled: gymResult.data.charge_guests_per_session,
        planType: null,
        planPrice: null,
        planCurrency: null,
        subscriptionStatus: 'none',
        timezone: gymResult.data.timezone,
      };
    } else {
      // Unknown status -> null, which resolves to 'expired' (never a
      // session_required claim from data we don't understand).
      const status: SessionSubscriptionStatus | null = isSubscriptionStatus(subscription.data.status)
        ? (subscription.data.status as SessionSubscriptionStatus)
        : null;
      context = {
        chargingEnabled: gymResult.data.charge_guests_per_session,
        planType: subscription.data.planType,
        planPrice: subscription.data.planPrice,
        planCurrency: subscription.data.planCurrency,
        subscriptionStatus: status,
        timezone: gymResult.data.timezone,
      };
    }

    const cached: CachedContext = { userId, context };
    try {
      await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(cached));
    } catch {
      // Best-effort cache.
    }
    return context;
  } catch {
    return null;
  }
}

/** Last known context for the signed-in user, or null. Never throws. */
export async function getCachedChargingContext(): Promise<ChargingContext | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return null;
    const raw = await AsyncStorage.getItem(CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedContext;
    return parsed.userId === userId ? parsed.context : null;
  } catch {
    return null;
  }
}

async function denialsKey(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    return userId ? DENIALS_KEY_PREFIX + userId : null;
  } catch {
    return null;
  }
}

/** Persisted post-sync denials for the signed-in user, surfaced on the next
 * Home render. */
export async function getSyncDenials(): Promise<SyncDenial[]> {
  try {
    const key = await denialsKey();
    if (!key) return [];
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is SyncDenial =>
        !!d && typeof (d as SyncDenial).scanId === 'string' && typeof (d as SyncDenial).scannedAt === 'string',
    );
  } catch {
    return [];
  }
}

/** Returns false when the denial could not be stored, so the caller keeps
 * the queued scan rather than losing it. */
export async function persistSyncDenials(incoming: SyncDenial[]): Promise<boolean> {
  if (incoming.length === 0) return true;
  try {
    const key = await denialsKey();
    if (!key) return false;
    const existing = await getSyncDenials();
    await AsyncStorage.setItem(key, JSON.stringify(mergeDenials(existing, incoming)));
    return true;
  } catch (err) {
    console.error('[offline-sync] failed to persist sync denials', err);
    return false;
  }
}

/** Removes only the given scan ids, so a denial persisted after Home
 * rendered is not erased by a dismiss. */
export async function clearSyncDenials(scanIds: string[]): Promise<void> {
  try {
    const key = await denialsKey();
    if (!key) return;
    const drop = new Set(scanIds);
    const remaining = (await getSyncDenials()).filter((d) => !drop.has(d.scanId));
    if (remaining.length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(remaining));
  } catch {
    // Best-effort.
  }
}
