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
// (Story 3.7 Scope Note #4). Story 8.5: re-tuned from pastel-light-only
// values to dark-surface-friendly tints (dark bg tint + bright text) as part
// of the mobile dark-theme redesign -- same semantic hues, different values.
export const STATUS_COLORS: Record<BadgeStatus, { bg: string; border: string; text: string }> = {
  active: { bg: '#123321', border: '#1F5C3A', text: '#4ADE80' },
  expiring_soon: { bg: '#3A2A12', border: '#5C4420', text: '#FBBF24' },
  grace_period: { bg: '#3A2A12', border: '#5C4420', text: '#FBBF24' },
  expired: { bg: '#3A1414', border: '#5C1F1F', text: '#F87171' },
  no_plan: { bg: '#1E2530', border: '#2E3846', text: '#B0B8C4' },
};

export const statusLabelKey: Record<BadgeStatus, string> = {
  active: 'home.status.active',
  expiring_soon: 'home.status.expiringSoon',
  grace_period: 'home.status.gracePeriod',
  expired: 'home.status.expired',
  no_plan: 'home.status.noPlan',
};
