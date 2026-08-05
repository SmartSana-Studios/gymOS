// Story 7.2: Audit Log Dashboard Page. `Record<string, string>` label-map
// convention, same shape as PAYMENT_METHOD_LABEL_KEY
// (apps/dashboard/app/(dashboard)/payments/paymentLabels.ts:30-34). Maps
// every known `action_type` value (audit_log.action_type is free text, not
// an enum -- 0007_audit_log.sql's own comment explains why) to an
// `audit.actionTypes.*` i18n key. The 12 values below are the complete set
// that exist in this codebase today, per Story 7.1's coverage matrix
// (docs/decisions.md, 2026-08-04 "Audit Record Coverage Verification"
// entry) -- an `action_type` not in this map falls back to rendering the
// raw string (defensive, since new action types can be added by future
// stories without a migration to this file being required first).
export const AUDIT_ACTION_TYPE_LABEL_KEY: Record<string, string> = {
  manual_payment_recorded: "audit.actionTypes.manualPaymentRecorded",
  payment_verified: "audit.actionTypes.paymentVerified",
  payment_flagged: "audit.actionTypes.paymentFlagged",
  payment_verification_failed: "audit.actionTypes.paymentVerificationFailed",
  refund_recorded: "audit.actionTypes.refundRecorded",
  member_deactivated: "audit.actionTypes.memberDeactivated",
  coach_assigned: "audit.actionTypes.coachAssigned",
  coach_reassigned: "audit.actionTypes.coachReassigned",
  gym_data_escalation: "audit.actionTypes.gymDataEscalation",
  subscription_lifecycle_job_failure: "audit.actionTypes.subscriptionLifecycleJobFailure",
  check_in_auto_timeout_job_failure: "audit.actionTypes.checkInAutoTimeoutJobFailure",
  payment_reconciliation_job_failure: "audit.actionTypes.paymentReconciliationJobFailure",
};
