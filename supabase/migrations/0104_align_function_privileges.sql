-- ============================================================================
-- 0104: align function EXECUTE privileges with what the migrations intend.
--
-- Found on 2026-10-08 while deploying 0100 to the hosted project: the hosted
-- project has ALTER DEFAULT PRIVILEGES granting EXECUTE on every new function in
-- public to anon, authenticated and service_role, while a local stack does not.
-- The migrations only ever REVOKE from PUBLIC (and sometimes authenticated), so
-- on the hosted project:
--   * 70 functions were executable by the unauthenticated anon role, among them
--     get_gym_payment_credentials_for_service / _by_business_id (SECURITY DEFINER,
--     no caller check: they return a gym's DECRYPTED payment API key and webhook
--     secret), complete_verified_payment / complete_flagged_payment (mark a
--     processing payment verified or flagged), and the run_*_job cron functions;
--   * 9 service-only functions were also executable by authenticated.
-- The local database, which every pgTAP test and the full manual QA ran against,
-- has anon = false everywhere and authenticated = true only for user-callable
-- functions, so this migration moves production to exactly that state. It only
-- REVOKEs and only on functions that exist in both; nothing is granted.
-- ============================================================================

-- anon: not callable without a session
revoke execute on function public.activate_payment_provider(text) from anon;
revoke execute on function public.active_payment_provider() from anon;
revoke execute on function public.add_session_note(uuid,text) from anon;
revoke execute on function public.apply_saas_billing_credit(uuid,integer) from anon;
revoke execute on function public.assign_coach(uuid,uuid) from anon;
revoke execute on function public.book_class_session(uuid) from anon;
revoke execute on function public.caller_has_membership() from anon;
revoke execute on function public.cancel_class_booking(uuid) from anon;
revoke execute on function public.check_in(timestamp with time zone,uuid) from anon;
revoke execute on function public.check_out_member(uuid) from anon;
revoke execute on function public.check_out() from anon;
revoke execute on function public.complete_flagged_payment(uuid) from anon;
revoke execute on function public.complete_flagged_saas_billing_payment(uuid) from anon;
revoke execute on function public.complete_verified_payment(uuid,integer) from anon;
revoke execute on function public.complete_verified_saas_billing_payment(uuid,integer) from anon;
revoke execute on function public.confirm_renewal(uuid,text,text,boolean) from anon;
revoke execute on function public.connect_gym_payment_credentials(text,text,text,text) from anon;
revoke execute on function public.create_class(text,text,uuid,integer,text,timestamp with time zone,smallint[],time without time zone,date) from anon;
revoke execute on function public.create_staff_member(uuid,text,text,member_role) from anon;
revoke execute on function public.create_workout_plan(uuid,text,jsonb) from anon;
revoke execute on function public.deactivate_staff_member(uuid,text) from anon;
revoke execute on function public.disconnect_gym_payment_credentials(text) from anon;
revoke execute on function public.edit_session_note(uuid,text) from anon;
revoke execute on function public.escalate_gym_data_access(uuid,text) from anon;
revoke execute on function public.get_active_escalation_expiry(uuid) from anon;
revoke execute on function public.get_gym_payment_connection_status(text) from anon;
revoke execute on function public.get_gym_payment_credentials_by_business_id(text,text) from anon;
revoke execute on function public.get_gym_payment_credentials_for_service(uuid,text) from anon;
revoke execute on function public.get_workout_plan_viewer_context(uuid) from anon;
revoke execute on function public.gym_local_period_bounds() from anon;
revoke execute on function public.gym_revenue_mtd() from anon;
revoke execute on function public.initiate_member_payment() from anon;
revoke execute on function public.initiate_saas_billing_payment(uuid,billing_interval) from anon;
revoke execute on function public.list_active_gym_data_escalations(uuid) from anon;
revoke execute on function public.list_bookable_class_sessions() from anon;
revoke execute on function public.list_my_class_bookings() from anon;
revoke execute on function public.list_my_class_session_roster(uuid) from anon;
revoke execute on function public.list_my_classes() from anon;
revoke execute on function public.list_own_active_gym_memberships() from anon;
revoke execute on function public.list_selectable_saas_billing_tiers() from anon;
revoke execute on function public.list_super_admins() from anon;
revoke execute on function public.log_audit_event(text,uuid,text,text,jsonb,text) from anon;
revoke execute on function public.mark_class_attendance(uuid) from anon;
revoke execute on function public.mark_gym_payment_credentials_needs_attention(uuid,text) from anon;
revoke execute on function public.materialize_class_sessions(uuid,boolean) from anon;
revoke execute on function public.member_occupancy_band() from anon;
revoke execute on function public.promote_to_super_admin(uuid,text) from anon;
revoke execute on function public.record_out_of_band_saas_billing_payment(uuid) from anon;
revoke execute on function public.record_registration_fee(uuid,text,text) from anon;
revoke execute on function public.renew_subscription(uuid,text) from anon;
revoke execute on function public.revert_super_admin_promotion(uuid,boolean) from anon;
revoke execute on function public.revoke_gym_data_access(uuid,uuid,text) from anon;
revoke execute on function public.run_check_in_auto_timeout_job() from anon;
revoke execute on function public.run_class_reminder_job() from anon;
revoke execute on function public.run_class_session_materializer_job() from anon;
revoke execute on function public.run_payment_reconciliation_job() from anon;
revoke execute on function public.run_quiet_gym_alert_job() from anon;
revoke execute on function public.run_saas_billing_lifecycle_job() from anon;
revoke execute on function public.run_subscription_lifecycle_job() from anon;
revoke execute on function public.set_registration_fee(integer) from anon;
revoke execute on function public.staff_account_for_reset(uuid) from anon;
revoke execute on function public.super_admin_job_failures() from anon;
revoke execute on function public.switch_active_gym(uuid) from anon;
revoke execute on function public.take_ownership_of_workout_plan(uuid) from anon;
revoke execute on function public.update_class(uuid,text,text,uuid,integer,text,timestamp with time zone,smallint[],time without time zone,date) from anon;
revoke execute on function public.update_messaging_instance(text) from anon;
revoke execute on function public.update_own_owner_notification_email(text) from anon;
revoke execute on function public.update_staff_role(uuid,text,member_role) from anon;
revoke execute on function public.update_workout_plan(uuid,text,jsonb) from anon;
revoke execute on function public.waive_registration_fee(uuid,text) from anon;

-- created by 0100/0101, which run before this migration on the hosted project
revoke execute on function public.initiate_registration_fee_payment(uuid) from anon;
revoke execute on function public.void_registration_fee_payment(uuid,text) from anon;
revoke execute on function public.gym_registration_fee_revenue_mtd() from anon;

-- authenticated: service-role / cron only
revoke execute on function public.complete_flagged_payment(uuid) from authenticated;
revoke execute on function public.complete_verified_payment(uuid,integer) from authenticated;
revoke execute on function public.run_check_in_auto_timeout_job() from authenticated;
revoke execute on function public.run_class_reminder_job() from authenticated;
revoke execute on function public.run_class_session_materializer_job() from authenticated;
revoke execute on function public.run_payment_reconciliation_job() from authenticated;
revoke execute on function public.run_quiet_gym_alert_job() from authenticated;
revoke execute on function public.run_saas_billing_lifecycle_job() from authenticated;
revoke execute on function public.run_subscription_lifecycle_job() from authenticated;

do $verify$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p
  where p.oid in (
    'public.get_gym_payment_credentials_for_service(uuid,text)'::regprocedure,
    'public.get_gym_payment_credentials_by_business_id(text,text)'::regprocedure,
    'public.complete_verified_payment(uuid,integer)'::regprocedure,
    'public.complete_flagged_payment(uuid)'::regprocedure,
    'public.run_payment_reconciliation_job()'::regprocedure
  )
  and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception '0104: still executable by anon or authenticated: %', v_bad;
  end if;
  if not has_function_privilege('service_role', 'public.complete_verified_payment(uuid,integer)'::regprocedure, 'EXECUTE') then
    raise exception '0104: service_role lost EXECUTE on complete_verified_payment';
  end if;
end
$verify$;
