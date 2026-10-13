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
  // Story 18.4. Written by void_registration_fee_payment() (0101), gym-scoped,
  // target = the member. Metadata { payment_id, amount, method, reason }.
  registration_fee_voided: "audit.actionTypes.registrationFeeVoided",
  // Story 18.5. Written by assignInitialPlan (members/actions.ts) through
  // logMemberChange, target = the member. Metadata { plan_id, start_date, expiry_date }.
  member_plan_assigned: "audit.actionTypes.memberPlanAssigned",
  // Story 19.3. guest_charging_changed is written by set_guest_charging() (0107),
  // gym-scoped, metadata { old_enabled, new_enabled }. plan_type_changed and
  // plan_price_changed are written by update_plan_pricing() (0107), gym-scoped,
  // target = the plan, metadata { old_plan_type, new_plan_type } / { old_price,
  // new_price }. platform_session_config_updated is platform-level (no gym_id).
  // Story 20.1. loyalty_program_changed is written by set_loyalty_program() (0117),
  // gym-scoped, target = the gym, metadata { old, new } each holding
  // { enabled, guest_threshold, renewal_threshold, reward_days }.
  loyalty_program_changed: "audit.actionTypes.loyaltyProgramChanged",
  // Story 20.2. Written by the private.on_session_consumed() hook (0118), gym-scoped,
  // target = the member. loyalty_stamp_earned metadata { counter, guest_session_id,
  // stamps, threshold }; loyalty_reward_granted adds { free_session_id, usable_until };
  // loyalty_progress_reset metadata { counter, guest_session_id, previous_count,
  // previous_last_event_at, idle_reset_days }.
  // Story 20.3. The same three action types are also written by
  // private.award_renewal_stamp() (0119) for subscriber renewals, with
  // counter 'subscriber' in metadata and payment_id / subscription_id in place of
  // the session ids; loyalty_reward_granted then adds { reward_days,
  // old_expiry_date, new_expiry_date }. No separate labels: the counter in
  // metadata tells the two apart.
  loyalty_stamp_earned: "audit.actionTypes.loyaltyStampEarned",
  loyalty_reward_granted: "audit.actionTypes.loyaltyRewardGranted",
  loyalty_progress_reset: "audit.actionTypes.loyaltyProgressReset",
  guest_charging_changed: "audit.actionTypes.guestChargingChanged",
  plan_type_changed: "audit.actionTypes.planTypeChanged",
  plan_price_changed: "audit.actionTypes.planPriceChanged",
  platform_session_config_updated: "audit.actionTypes.platformSessionConfigUpdated",
  // Story 19.4. session_payment_recorded is written by record_session_payment()
  // (0108), target = the member, metadata { amount, currency, method, reason,
  // payment_id, guest_session_id }. session_attempt_expired comes from the
  // purpose-generic expiry helper, target = the member, metadata { payment_id }.
  session_payment_recorded: "audit.actionTypes.sessionPaymentRecorded",
  session_attempt_expired: "audit.actionTypes.sessionAttemptExpired",
  // Story 19.5. Both are written by complete_verified_payment() (0109) with the
  // payment-webhook system label, target = the member, metadata { payment_id,
  // guest_session_id, amount, currency, method, fee_amount }.
  session_payment_paid: "audit.actionTypes.sessionPaymentPaid",
  session_late_payment: "audit.actionTypes.sessionLatePayment",
  // Story 19.8. Written by database triggers (0113), gym-scoped, target = the
  // member. session_refund_applied metadata { outcome: voided | kept_partial |
  // kept_consumed, refund_id, payment_id, guest_session_id, refund_amount,
  // payment_amount }. session_consumed metadata { guest_session_id, payment_id,
  // covered_day, consumed_at, source: paid | free }. session_attempt_blocked
  // metadata { attempt_id, scan_id, source, class_session_id, scanned_at }.
  session_refund_applied: "audit.actionTypes.sessionRefundApplied",
  session_consumed: "audit.actionTypes.sessionConsumed",
  session_attempt_blocked: "audit.actionTypes.sessionAttemptBlocked",
};
