export type PaymentStatus = 'pending' | 'processing' | 'verified' | 'flagged';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['pending', 'processing', 'verified', 'flagged'];
export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export type PaymentMethod = 'mtn_momo' | 'orange_money' | 'cash' | 'bank_transfer' | 'manual_momo';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'mtn_momo',
  'orange_money',
  'cash',
  'bank_transfer',
  'manual_momo',
];
export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

// Same UX-DR5 "color AND label, never color alone" floor as
// subscription-status.ts's STATUS_COLORS -- 4 entries, no `failed` (the
// mockup's "Verified / Pending / Failed" wording doesn't match this schema's
// real payment_status enum, which has `processing` instead of `failed`).
// Story 8.5: re-tuned from pastel-light-only values to dark-surface-friendly
// tints, same semantic hues as subscription-status.ts's STATUS_COLORS.
export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, { bg: string; border: string; text: string }> = {
  pending: { bg: '#3A2A12', border: '#5C4420', text: '#FBBF24' },
  processing: { bg: '#122A3A', border: '#1F4D6B', text: '#60A5FA' },
  verified: { bg: '#123321', border: '#1F5C3A', text: '#4ADE80' },
  flagged: { bg: '#3A1414', border: '#5C1F1F', text: '#F87171' },
};

export const paymentStatusLabelKey: Record<PaymentStatus, string> = {
  pending: 'payments.status.pending',
  processing: 'payments.status.processing',
  verified: 'payments.status.verified',
  flagged: 'payments.status.flagged',
};

// All 5 real `payment_method` enum values -- unlike the dashboard's
// PAYMENT_METHOD_LABEL_KEY (apps/dashboard/app/(dashboard)/payments/
// paymentLabels.ts), which only maps 3 because its manual-entry form never
// writes mtn_momo/orange_money. A member's own history can show either,
// written by initiatePayment() (Story 4.2)'s online-payment path.
export const PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethod, string> = {
  mtn_momo: 'payments.methods.mtnMomo',
  orange_money: 'payments.methods.orangeMoney',
  cash: 'payments.methods.cash',
  bank_transfer: 'payments.methods.bankTransfer',
  manual_momo: 'payments.methods.manualMomo',
};
