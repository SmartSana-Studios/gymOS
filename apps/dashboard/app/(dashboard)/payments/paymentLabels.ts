import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";

// UX-DR5's "color AND label AND icon, never color alone" floor -- same
// Record<Status, {labelKey, icon, className}> shape as attendanceLabels.ts/
// memberLabels.ts, applied here to payments.status instead of a subscription
// badge.
export type PaymentStatus = "pending" | "processing" | "verified" | "flagged";

export const PAYMENT_STATUS_BADGE_CONFIG: Record<
  PaymentStatus,
  { labelKey: string; icon: typeof CheckCircle2; className: string }
> = {
  pending: {
    labelKey: "payments.status.pending",
    icon: Clock,
    className: "border-orange-200 bg-orange-100 text-orange-800",
  },
  // Story 19.9c: the ledger lists every status, including an in-flight Tara
  // Money prompt.
  processing: {
    labelKey: "payments.status.processing",
    icon: Loader2,
    className: "border-blue-200 bg-blue-100 text-blue-800",
  },
  verified: {
    labelKey: "payments.status.verified",
    icon: CheckCircle2,
    className: "border-green-200 bg-green-100 text-green-800",
  },
  flagged: {
    labelKey: "payments.status.flagged",
    icon: AlertTriangle,
    className: "border-red-200 bg-red-100 text-red-800",
  },
};

export const PAYMENT_METHOD_LABEL_KEY: Record<string, string> = {
  cash: "payments.methods.cash",
  bank_transfer: "payments.methods.bankTransfer",
  manual_momo: "payments.methods.manualMomo",
  // Story 4.12: the automated, initiatePayment()-backed method -- distinct
  // from manual_momo (a staff-attested, already-collected-in-cash mobile
  // money payment). Only ever offered by RenewalModal's `mobile_money`
  // option, never recordManualPaymentSchema's closed enum.
  mobile_money: "payments.methods.mobileMoney",
};

// Story 18.6: payments.purpose ('subscription' | 'registration_fee' | 'session'). The
// Payments page shows the label wherever it renders a payment's purpose.
export const PAYMENT_PURPOSE_LABEL_KEY: Record<string, string> = {
  subscription: "payments.purposes.subscription",
  registration_fee: "payments.purposes.registrationFee",
  // Story 19.4: a desk or Tara session payment (purpose 'session', migration 0107).
  session: "payments.purposes.session",
};

// Story 4.4/4.14: the three discrepancy types the Discrepancies section ever
// renders -- `missing_internal_record` never reaches this component
// (gym-unattributable, RLS-invisible; see docs/decisions.md).
export const PAYMENT_DISCREPANCY_TYPE_LABEL_KEY: Record<string, string> = {
  stale_processing: "payments.discrepancies.types.staleProcessing",
  amount_mismatch: "payments.discrepancies.types.amountMismatch",
  // Story 4.14/FR-137: a payment that settled to the wrong (or the
  // platform's) account -- caught by comparing the webhook's businessId
  // against the gym's own connected business_id_plain.
  wrong_account_settlement: "payments.discrepancies.types.wrongAccountSettlement",
};

// Story 19.2: payments.flagged_reason, the closed set migration 0106 pins. The
// tag renders beside the Flagged badge wherever a flagged payment row is
// listed. Two reasons reuse the discrepancy labels that already shipped.
export const PAYMENT_FLAGGED_REASON_LABEL_KEY: Record<string, string> = {
  late_confirmation: "payments.flaggedReasons.lateConfirmation",
  wrong_account: "payments.discrepancies.types.wrongAccountSettlement",
  expired_attempt: "payments.flaggedReasons.expiredAttempt",
  reconciliation_mismatch: "payments.discrepancies.types.amountMismatch",
  provider_declined: "payments.flaggedReasons.providerDeclined",
  staff_flagged: "payments.flaggedReasons.staffFlagged",
};
