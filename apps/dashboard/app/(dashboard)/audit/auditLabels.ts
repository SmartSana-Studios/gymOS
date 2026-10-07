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
  // Story 1.15 (added by its code review, 2026-09-06). Written by
  // revoke_gym_data_access() with p_gym_id set (0085:256), so the row is
  // gym-scoped and reaches this page through
  // manager_or_owner_read_own_audit_log (0049) exactly as the escalation row
  // above does. Without the mapping it rendered as the raw action_type string
  // via this map's defensive fallback.
  gym_data_escalation_revoked: "audit.actionTypes.gymDataEscalationRevoked",
  subscription_lifecycle_job_failure: "audit.actionTypes.subscriptionLifecycleJobFailure",
  check_in_auto_timeout_job_failure: "audit.actionTypes.checkInAutoTimeoutJobFailure",
  payment_reconciliation_job_failure: "audit.actionTypes.paymentReconciliationJobFailure",
  // Story 18.1. Written by set_registration_fee() (0098), gym-scoped, metadata
  // { old_amount, new_amount }.
  registration_fee_changed: "audit.actionTypes.registrationFeeChanged",
  // Story 18.2. Written by record_registration_fee() / waive_registration_fee()
  // (0099), gym-scoped, target = the member. Metadata: recorded carries
  // { amount, currency, method, reason, payment_id }, waived { reason }.
  registration_fee_recorded: "audit.actionTypes.registrationFeeRecorded",
  registration_fee_waived: "audit.actionTypes.registrationFeeWaived",
  // Story 18.3. Written by complete_verified_payment() (0100) when a Tara Money
  // fee collection is confirmed -- actor "payment-webhook", target = the member,
  // metadata { payment_id, amount, currency, method, fee_amount } -- and by the
  // 10-minute expiry in initiate/record/waive_registration_fee, target = the
  // member, metadata { payment_id }.
  registration_fee_paid: "audit.actionTypes.registrationFeePaid",
  registration_fee_attempt_expired: "audit.actionTypes.registrationFeeAttemptExpired",
  // Late Tara success for an attempt expiry already flagged: the member was charged
  // but the payment was not applied -- staff should refund. metadata { payment_id,
  // amount, currency, fee_amount }.
  registration_fee_late_payment: "audit.actionTypes.registrationFeeLatePayment",
};
