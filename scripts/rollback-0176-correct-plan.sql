-- Rollback for migration 0176: correct plan (Epic 27, Story 27.4).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0176-correct-plan.sql
--
-- A SUBSCRIPTION THAT WAS CORRECTED STAYS CORRECTED. The rollback removes the functions that could correct a plan; it does not move any
-- subscription back to the plan it had, and it does not delete the subscription_plan_corrected audit rows already written (audit_log is
-- append-only). Unlike 0175 there is no data precondition: nothing in the schema depends on these functions.
--
-- Drops: public.correct_subscription_plan, public.correct_plan_eligibility, private.subscription_standing_payments,
-- private.subscription_status_for, the two registry rows and the one audit action row 0176 added.
-- Restores: private.stepup_issue as 0175 left it (without support_correct_plan), public.renew_subscription as 0157 left it (without the member lock).
-- Not touched: run_subscription_lifecycle_job() (0176 never modified it).
set local lock_timeout = '5s';

drop function public.correct_subscription_plan(uuid, uuid, text, uuid);
drop function public.correct_plan_eligibility(uuid);
drop function private.subscription_standing_payments(uuid);
drop function private.subscription_status_for(date, integer, date);

-- renew_subscription: the 0157 body (without the member lock 0176 added).
create or replace function public.renew_subscription(p_member_id uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller_gym_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_id uuid;
begin
  if not coalesce((select private.support_rpc_role('renew_subscription'))::text = any(array['owner', 'manager', 'supervisor', 'receptionist']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.support_rpc_gym_id('renew_subscription');
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'renew_subscription: gym % is not active', v_caller_gym_id;
  end if;

  -- Gym-scoped in the query itself (not a separate post-check) so a member
  -- belonging to another gym produces the exact same "not found" outcome as
  -- a truly nonexistent id -- avoids letting a caller enumerate whether a
  -- given member id exists in some other gym, matching this codebase's own
  -- established "uniform 0-rows failure mode" tenant-isolation philosophy
  -- (see 0002/0007/0008's table-grant comments on the same principle).
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'renew_subscription: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'renew_subscription: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'renew_subscription: reason is required';
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    raise exception 'renew_subscription: member % has no existing subscription to renew', p_member_id;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else private.gym_today(v_member_gym_id) + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', private.gym_today(v_member_gym_id), v_new_expiry)
  returning id into v_new_id;

  perform log_audit_event(
    p_action_type => 'subscription_manual_renewal',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason,
      'subscription_id', v_new_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry
    )
  );

  return v_new_id;
end;
$function$;
revoke execute on function public.renew_subscription(uuid, text) from public, anon;
grant execute on function public.renew_subscription(uuid, text) to authenticated;

delete from private.support_capabilities
 where kind = 'rpc' and object_name in ('correct_plan_eligibility', 'correct_subscription_plan');
delete from private.support_audit_actions where action_type = 'subscription_plan_corrected';

-- Step-up: 0175's list.
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin', 'change_recovery_email', 'remove_recovery_email', 'support_refund', 'support_waive_registration_fee', 'support_create_staff', 'support_payment_connection', 'start_support_factor_reset', 'take_down_gym_page', 'lift_gym_page_takedown', 'support_staff_check_in', 'support_void_staff_check_in') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action like 'support\_%' then
    -- Story 23.6: a support grant goes to an activated, unlocked, non-deactivated support account, whatever the Super Admin flag says.
    if not exists (select 1 from private.support_accounts sa
                    where sa.user_id = p_user and sa.activated_at is not null and sa.locked_at is null
                      and sa.reset_pending_at is null and sa.deactivated_at is null) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  else
    if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
      return null;
    end if;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;
