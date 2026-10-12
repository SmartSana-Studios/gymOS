-- Rollback for migration 0119 (loyalty subscriber rule): restores
-- public.confirm_renewal(uuid,text,text,boolean) from 0093 and
-- public.complete_verified_payment(uuid,integer) from 0109, then drops
-- private.award_renewal_stamp(uuid). Non-destructive: events, progress and
-- subscription expiry extensions already written stay (valid ledger data; 0117's
-- tables are untouched). Audit rows loyalty_stamp_earned / loyalty_reward_granted /
-- loyalty_progress_reset with counter 'subscriber' stay.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0119-loyalty-subscriber-rule.sql

CREATE OR REPLACE FUNCTION public.confirm_renewal(p_member_id uuid, p_method text, p_reason text, p_backdate boolean DEFAULT false, OUT payment_id uuid, OUT subscription_id uuid, OUT amount integer, OUT currency text, OUT new_expiry_date date)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_actor_id uuid;
  v_member_gym_id uuid;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_current_status subscription_status;
  v_current_expiry_date date;
  v_start_date date;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'supervisor', 'receptionist'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := auth.uid();

  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id;

  if v_member_gym_id is null then
    raise exception 'confirm_renewal: member % not found', p_member_id;
  end if;

  if v_deactivated_at is not null then
    raise exception 'confirm_renewal: member % is deactivated and cannot be renewed', p_member_id;
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'confirm_renewal: reason is required';
  end if;

  select s.plan_id, s.status, s.expiry_date
    into v_plan_id, v_current_status, v_current_expiry_date
  from subscriptions s
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  if v_plan_id is null then
    raise exception 'confirm_renewal: member % has no existing subscription to renew', p_member_id;
  end if;

  if p_backdate then
    if v_current_status not in ('grace_period', 'expired') then
      raise exception 'confirm_renewal: back-dating is only available for grace_period or expired subscriptions';
    end if;
    if v_current_expiry_date is null then
      raise exception 'confirm_renewal: cannot back-date a subscription with no expiry date';
    end if;
    v_start_date := v_current_expiry_date;
  else
    v_start_date := current_date;
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < current_date then
    raise exception 'confirm_renewal: back-dated renewal would still be expired';
  end if;

  new_expiry_date := case when v_duration_days is null then null else v_start_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_member_gym_id, p_member_id, v_plan_id, 'active', v_start_date, new_expiry_date)
  returning id into subscription_id;

  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, actor_id, reason)
  values (v_member_gym_id, p_member_id, subscription_id, amount, currency, p_method, 'verified', v_actor_id, p_reason)
  returning id into payment_id;

  perform log_audit_event(
    p_action_type => 'renewal_confirmed',
    p_gym_id => v_member_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'reason', p_reason, 'method', p_method, 'amount', amount, 'currency', currency,
      'payment_id', payment_id, 'subscription_id', subscription_id, 'plan_id', v_plan_id,
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate
    )
  );
end;
$function$
;

revoke execute on function public.confirm_renewal(uuid, text, text, boolean) from public, anon;
grant execute on function public.confirm_renewal(uuid, text, text, boolean) to authenticated;

create or replace function complete_verified_payment(p_payment_id uuid, p_fee_amount integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_purpose text;
  v_amount integer;
  v_currency text;
  v_status payment_status;
  v_flagged_reason text;
  v_deactivated_at timestamptz;
  v_plan_id uuid;
  v_duration_days integer;
  v_new_expiry date;
  v_new_subscription_id uuid;
  v_session guest_sessions;
begin
  -- Lock order: payment row, then member row, before any other write.
  select p.gym_id, p.member_id, p.purpose, p.amount, p.currency, p.status, p.flagged_reason
    into v_gym_id, v_member_id, v_purpose, v_amount, v_currency, v_status, v_flagged_reason
  from payments p
  where p.id = p_payment_id
  for update;

  if not found then
    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
    return null;
  end if;

  perform 1 from members m where m.id = v_member_id for no key update;

  if v_status is distinct from 'processing' then
    -- A late success for an attempt that expiry already flagged: the member
    -- was charged but the row was not applied.
    if v_status = 'flagged' and v_purpose = 'registration_fee' then
      -- Leave a trace so staff can find and refund it. Once per payment, so a
      -- redelivered webhook does not repeat it.
      if not exists (
        select 1 from audit_log a
        where a.action_type = 'registration_fee_late_payment'
          and a.metadata ->> 'payment_id' = p_payment_id::text
      ) then
        update payments
        set flagged_reason = 'late_confirmation'
        where id = p_payment_id and status = 'flagged'
          and flagged_reason in ('expired_attempt', 'provider_declined');

        perform log_audit_event(
          p_action_type => 'registration_fee_late_payment',
          p_gym_id => v_gym_id,
          p_target_entity_id => v_member_id::text,
          p_target_entity_type => 'member',
          p_metadata => jsonb_build_object(
            'payment_id', p_payment_id,
            'amount', v_amount,
            'currency', 'XAF',
            'fee_amount', p_fee_amount
          ),
          p_system_actor_label => 'payment-webhook'
        );
      end if;
    elsif v_status = 'flagged' and v_purpose = 'session' and v_flagged_reason = 'expired_attempt' then
      -- The late session case: the money is real, so the payment is verified
      -- and the session is created. Only an expired attempt qualifies;
      -- wrong_account, reconciliation_mismatch, staff_flagged and
      -- provider_declined never yield a session.
      update payments
      set status = 'verified', flagged_reason = 'late_confirmation', provider_fee_amount = p_fee_amount
      where id = p_payment_id and status = 'flagged' and flagged_reason = 'expired_attempt';

      v_session := private.create_guest_session_for_payment(p_payment_id, v_member_id, v_gym_id);

      perform log_audit_event(
        p_action_type => 'session_late_payment',
        p_gym_id => v_gym_id,
        p_target_entity_id => v_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'payment_id', p_payment_id,
          'guest_session_id', v_session.id,
          'amount', v_amount,
          'currency', v_currency,
          'method', 'mobile_money',
          'fee_amount', p_fee_amount
        ),
        p_system_actor_label => 'payment-webhook'
      );
    end if;

    raise notice 'complete_verified_payment: payment % already verified or not found -- no-op', p_payment_id;
    return null;
  end if;

  update payments
  set status = 'verified', provider_fee_amount = p_fee_amount
  where id = p_payment_id and status = 'processing';

  if v_purpose = 'registration_fee' then
    -- The money is real whatever the member's state, so the payment stays
    -- verified. coalesce keeps an earlier settlement time if there is one.
    update members
    set registration_fee_settled_at = coalesce(registration_fee_settled_at, now())
    where id = v_member_id;

    perform log_audit_event(
      p_action_type => 'registration_fee_paid',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'payment_id', p_payment_id,
        'amount', v_amount,
        'currency', 'XAF',
        'method', 'mobile_money',
        'fee_amount', p_fee_amount
      ),
      p_system_actor_label => 'payment-webhook'
    );

    return null;
  end if;

  if v_purpose = 'session' then
    -- Verified whatever the member's state; one session per payment (the
    -- unique index on guest_sessions.payment_id backs this).
    v_session := private.create_guest_session_for_payment(p_payment_id, v_member_id, v_gym_id);

    perform log_audit_event(
      p_action_type => 'session_payment_paid',
      p_gym_id => v_gym_id,
      p_target_entity_id => v_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'payment_id', p_payment_id,
        'guest_session_id', v_session.id,
        'amount', v_amount,
        'currency', v_currency,
        'method', 'mobile_money',
        'fee_amount', p_fee_amount
      ),
      p_system_actor_label => 'payment-webhook'
    );

    return null;
  end if;

  select deactivated_at into v_deactivated_at from members where id = v_member_id;

  if v_deactivated_at is not null then
    raise notice 'complete_verified_payment: member % is deactivated -- payment % stays verified, renewal skipped', v_member_id, p_payment_id;
    return null;
  end if;

  select s.plan_id into v_plan_id
  from subscriptions s
  where s.member_id = v_member_id
  order by s.created_at desc
  limit 1;

  if v_plan_id is null then
    -- Defensive only -- payment stays verified, renewal skipped.
    raise notice 'complete_verified_payment: member % has no subscription to renew -- payment % stays verified, renewal skipped', v_member_id, p_payment_id;
    return null;
  end if;

  select duration_days into v_duration_days from plans where id = v_plan_id;
  v_new_expiry := case when v_duration_days is null then null else current_date + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_gym_id, v_member_id, v_plan_id, 'active', current_date, v_new_expiry)
  returning id into v_new_subscription_id;

  update payments set subscription_id = v_new_subscription_id where id = p_payment_id;

  perform log_audit_event(
    p_action_type => 'subscription_payment_renewal',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'payment_id', p_payment_id,
      'subscription_id', v_new_subscription_id,
      'plan_id', v_plan_id,
      'new_expiry_date', v_new_expiry,
      'fee_amount', p_fee_amount
    ),
    p_system_actor_label => 'payment-webhook'
  );

  return v_new_subscription_id;
end;
$$;

revoke execute on function complete_verified_payment(uuid, integer) from public, anon, authenticated;
grant execute on function complete_verified_payment(uuid, integer) to service_role;

drop function private.award_renewal_stamp(uuid);

do $verify$
begin
  if to_regprocedure('private.award_renewal_stamp(uuid)') is not null then
    raise exception 'rollback-0119: award_renewal_stamp still exists';
  end if;
  if position('award_renewal_stamp' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) > 0
     or position('award_renewal_stamp' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) > 0 then
    raise exception 'rollback-0119: a verifying function still calls the hook';
  end if;
  if has_function_privilege('anon', 'public.complete_verified_payment(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_verified_payment(uuid, integer)', 'execute') then
    raise exception 'rollback-0119: complete_verified_payment must not be client-callable';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute') then
    raise exception 'rollback-0119: confirm_renewal privileges drifted';
  end if;
end;
$verify$;
