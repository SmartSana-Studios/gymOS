export type SubscriptionStatus = 'active' | 'expiring_soon' | 'grace_period' | 'expired';
export type BadgeStatus = SubscriptionStatus | 'no_plan';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'active',
  'expiring_soon',
  'grace_period',
  'expired',
];
export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

// Meaning matches the dashboard's existing green/orange/red/gray badge
// families (attendanceLabels.ts's STATUS_BADGE_CONFIG) -- not identical hex
// values, since no cross-app design-token doc mandates parity for mobile
// (Story 3.7 Scope Note #4).
export const STATUS_COLORS: Record<BadgeStatus, { bg: string; border: string; text: string }> = {
  active: { bg: '#DCFCE7', border: '#BBF7D0', text: '#166534' },
  expiring_soon: { bg: '#FFEDD5', border: '#FED7AA', text: '#9A3412' },
  grace_period: { bg: '#FFEDD5', border: '#FED7AA', text: '#9A3412' },
  expired: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B' },
  no_plan: { bg: '#F3F4F6', border: '#E5E7EB', text: '#374151' },
};

export const statusLabelKey: Record<BadgeStatus, string> = {
  active: 'home.status.active',
  expiring_soon: 'home.status.expiringSoon',
  grace_period: 'home.status.gracePeriod',
  expired: 'home.status.expired',
  no_plan: 'home.status.noPlan',
};
