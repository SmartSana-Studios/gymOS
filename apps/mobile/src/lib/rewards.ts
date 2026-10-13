// Story 20.6 (FR-169): pure view model for the Home Rewards card. No
// react-native imports so vitest can run it under plain node.

export interface LoyaltySession {
  id: string;
  usableUntil: string;
}

/** `effective_loyalty()` parsed (0117). Counters are already read-time
 * (idle reset applied server-side). */
export interface LoyaltySnapshot {
  enabled: boolean;
  guestStamps: number;
  subscriberStamps: number;
  guestThreshold: number | null;
  renewalThreshold: number | null;
  rewardDays: number | null;
  guestWindowDays: number | null;
  subscriberWindowDays: number | null;
  freeSessions: LoyaltySession[];
  paidSessions: LoyaltySession[];
}

/** An own unconsumed loyalty-granted `guest_sessions` row. */
export interface GrantFact {
  id: string;
  createdAt: string;
  usableUntil: string;
}

/** Latest subscriber `reward_granted` event's details. */
export interface RewardEventFact {
  subscriptionId: string;
  rewardDays: number;
}

export interface LatestSubscriptionFact {
  id: string;
  expiryDate: string;
}

/** Everything the card needs, as fetched. `scope` keys the on-device
 * seen-grants record (`userId.gymId`); null means storage is unusable. */
export interface RewardsData {
  loyalty: LoyaltySnapshot;
  grants: GrantFact[];
  rewardEvent: RewardEventFact | null;
  latestSubscription: LatestSubscriptionFact | null;
  scope: string | null;
}

export const MAX_STAMP_SEGMENTS = 12;
const DAY_MS = 86_400_000;

export type RewardsCounter = 'guest' | 'subscriber';

export interface RewardsProgress {
  counter: RewardsCounter;
  current: number;
  total: number;
  /** Stamp segments up to 12, a continuous bar above. */
  display: 'segments' | 'bar';
  /** Reward days (subscriber caption); null for guest. */
  rewardDays: number | null;
}

export interface RewardsRow {
  id: string;
  kind: 'free' | 'paid';
  usableUntil: string;
  /** Free session while the current plan is not Pay-per-session. */
  dormant: boolean;
}

export interface RewardsFootnote {
  kind: 'guest' | 'subscriber';
  windowDays: number | null;
}

export interface RewardsHeadline {
  /** Grant ids to record as seen once the headline renders. */
  grantIds: string[];
  validityDays: number;
}

export interface RewardsFreeDays {
  days: number;
  /** Date-only `YYYY-MM-DD` of the subscription's expiry. */
  expiryDate: string;
}

export interface RewardsView {
  progress: RewardsProgress | null;
  rows: RewardsRow[];
  footnote: RewardsFootnote | null;
  headline: RewardsHeadline | null;
  freeDays: RewardsFreeDays | null;
}

/** Guest counter for Pay-per-session or no plan; subscriber counter for any
 * other plan. The other counter is never shown. */
export function chooseCounter(planType: string | null): RewardsCounter {
  return planType === null || planType === 'pay_per_session' ? 'guest' : 'subscriber';
}

/** Dormant = the current plan is not Pay-per-session. A member with no plan
 * is a guest and is not dormant. */
export function isDormant(planType: string | null): boolean {
  return planType !== null && planType !== 'pay_per_session';
}

/** Whole days between the grant's creation and its `usable_until`. */
export function validityDays(createdAt: string, usableUntil: string): number {
  const ms = new Date(usableUntil).getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / DAY_MS));
}

function byUsableUntil(a: LoyaltySession, b: LoyaltySession): number {
  return new Date(a.usableUntil).getTime() - new Date(b.usableUntil).getTime();
}

export function buildProgress(loyalty: LoyaltySnapshot, planType: string | null): RewardsProgress | null {
  if (!loyalty.enabled) return null;
  const counter = chooseCounter(planType);
  if (counter === 'guest') {
    if (loyalty.guestThreshold === null) return null;
    const total = loyalty.guestThreshold;
    return {
      counter,
      current: Math.min(loyalty.guestStamps, total),
      total,
      display: total <= MAX_STAMP_SEGMENTS ? 'segments' : 'bar',
      rewardDays: null,
    };
  }
  if (loyalty.renewalThreshold === null || loyalty.rewardDays === null) return null;
  const total = loyalty.renewalThreshold;
  return {
    counter,
    current: Math.min(loyalty.subscriberStamps, total),
    total,
    display: total <= MAX_STAMP_SEGMENTS ? 'segments' : 'bar',
    rewardDays: loyalty.rewardDays,
  };
}

/** The card is absent (not empty) unless the program is on or an unexpired
 * free session is held. `seenGrantIds` null (storage unreadable or not yet
 * loaded) suppresses the headline. */
export function buildRewardsView(
  data: RewardsData | null,
  planType: string | null,
  seenGrantIds: ReadonlySet<string> | null,
): RewardsView | null {
  if (!data) return null;
  const { loyalty } = data;
  if (!loyalty.enabled && loyalty.freeSessions.length === 0) return null;

  const dormant = isDormant(planType);
  const rows: RewardsRow[] = [
    ...[...loyalty.freeSessions].sort(byUsableUntil).map((s): RewardsRow => ({
      id: s.id,
      kind: 'free',
      usableUntil: s.usableUntil,
      dormant,
    })),
    ...[...loyalty.paidSessions].sort(byUsableUntil).map((s): RewardsRow => ({
      id: s.id,
      kind: 'paid',
      usableUntil: s.usableUntil,
      dormant: false,
    })),
  ];

  const progress = buildProgress(loyalty, planType);
  const footnote: RewardsFootnote | null = progress
    ? progress.counter === 'guest'
      ? { kind: 'guest', windowDays: loyalty.guestWindowDays }
      : { kind: 'subscriber', windowDays: null }
    : null;

  let headline: RewardsHeadline | null = null;
  if (seenGrantIds !== null) {
    const freeIds = new Set(loyalty.freeSessions.map((s) => s.id));
    const unseen = data.grants
      .filter((g) => freeIds.has(g.id) && !seenGrantIds.has(g.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (unseen.length > 0) {
      headline = {
        grantIds: unseen.map((g) => g.id),
        validityDays: validityDays(unseen[0].createdAt, unseen[0].usableUntil),
      };
    }
  }

  let freeDays: RewardsFreeDays | null = null;
  const { rewardEvent, latestSubscription } = data;
  if (
    rewardEvent &&
    latestSubscription &&
    rewardEvent.subscriptionId === latestSubscription.id &&
    rewardEvent.rewardDays > 0 &&
    latestSubscription.expiryDate
  ) {
    freeDays = { days: rewardEvent.rewardDays, expiryDate: latestSubscription.expiryDate };
  }

  return { progress, rows, footnote, headline, freeDays };
}
