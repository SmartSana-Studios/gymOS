import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

// UX-DR5's "color AND label AND icon, never color alone" floor -- same
// Record<Status, {labelKey, icon, className}> shape as attendanceLabels.ts/
// memberLabels.ts, applied here to payments.status instead of a subscription
// badge.
export type PaymentStatus = "pending" | "verified" | "flagged";

export const PAYMENT_STATUS_BADGE_CONFIG: Record<
  PaymentStatus,
  { labelKey: string; icon: typeof CheckCircle2; className: string }
> = {
  pending: {
    labelKey: "payments.status.pending",
    icon: Clock,
    className: "border-orange-200 bg-orange-100 text-orange-800",
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
};

// Story 4.4: only the two discrepancy types the Discrepancies section ever
// renders -- `missing_internal_record` never reaches this component
// (gym-unattributable, RLS-invisible; see docs/decisions.md).
export const PAYMENT_DISCREPANCY_TYPE_LABEL_KEY: Record<string, string> = {
  stale_processing: "payments.discrepancies.types.staleProcessing",
  amount_mismatch: "payments.discrepancies.types.amountMismatch",
};
