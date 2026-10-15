-- ============================================================================
-- 0121: Early renewal carries the remaining days (Epic 20 retro S-3, story 20.7).
--
-- Decision 2026-10-15 (docs/decisions.md): a renewal verified before the current
-- expiry no longer forfeits the remaining paid days, rewarded free days included.
-- The renewed subscription's expiry_date runs from the later of today and the
-- latest subscription's expiry_date, plus the plan duration.
--
-- Changes (bodies re-created from 0119, which 0120 did not touch):
--   public.confirm_renewal(uuid,text,text,boolean)  staff renewal at the desk
--   public.complete_verified_payment(uuid,integer)  Tara webhook / in-app renewal
-- Each adds the carry and a carried_days audit field; every other line, the
-- locking (AD-27) and the loyalty hook call are unchanged.
--
-- Deliberately not changed:
--   public.renew_subscription(uuid,text)  the payment-less "manual renewal reset"
--       (0022). It is an explicit reset with a required reason and takes no money,
--       so nothing paid is forfeited; it keeps starting from today.
--   start_date stays current_date (the plan screen shows "active from" the renewal
--       date); only expiry_date carries. expiry_date > start_date still holds.
--   Back-dated renewals (start = old expiry) and lapsed subscriptions (expiry in
--       the past) come out exactly as before. Pay-per-session (null expiry) too.
--   Loyalty: an early renewal still earns no stamp; the on-time test compares
--       the gym-local date with the PREVIOUS expiry, which is unchanged. A carried
--       period means the next on-time renewal is judged against the extended
--       expiry (an early one for the original date).
--
-- Rollback: scripts/rollback-0121-early-renewal-carries-days.sql (0119 bodies).
-- ============================================================================

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
  v_carried_from date;
begin
  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- AD-3 / 19.1 lint: the role comes from private.current_member_role(), not the
  -- JWT claim 0093 read. Same allowlist; a caller with no active membership in
  -- the gym is refused as before. Role resolution comes BEFORE the suspension
  -- gate (code review 2026-09-09 rule, see tenant_suspension_enforcement.test.sql):
  -- an unauthorized caller at a suspended gym must not learn the gym status.
  if not coalesce(private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := auth.uid();

  -- AD-27: the member row lock comes before the first write.
  select gym_id, deactivated_at into v_member_gym_id, v_deactivated_at
  from members where id = p_member_id and gym_id = v_caller_gym_id
  for no key update;

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

  -- Epic 20 retro S-3 (decisions.md 2026-10-15): a renewal verified before the current
  -- expiry carries the remaining days, rewarded free days included. The new period
  -- runs from the later of today and the latest subscription's expiry; start_date
  -- stays today so the plan screen keeps reading "active from" the renewal date.
  -- A lapsed subscription (expiry in the past) and a back-dated renewal (start =
  -- the old expiry) come out as before.
  v_carried_from := greatest(v_start_date, coalesce(v_current_expiry_date, v_start_date));
  new_expiry_date := case when v_duration_days is null then null else v_carried_from + v_duration_days end;

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
      'new_expiry_date', new_expiry_date, 'start_date', v_start_date, 'backdated', p_backdate,
      'carried_days', (v_carried_from - v_start_date)
    )
  );

  -- Story 20.3: an on-time renewal earns a subscriber stamp; a back-dated staff
  -- renewal never does. The hook may move expiry_date out by R days, so the
  -- returned date is re-read.
  if not p_backdate then
    perform private.award_renewal_stamp(payment_id);

    select s.expiry_date into new_expiry_date
    from subscriptions s
    where s.id = subscription_id;
  end if;
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
  v_prev_expiry date;
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

  select s.plan_id, s.expiry_date into v_plan_id, v_prev_expiry
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
  -- Epic 20 retro S-3: carry the remaining days of the period being renewed (see
  -- confirm_renewal); a lapsed or pay-per-session subscription starts from today.
  v_new_expiry := case when v_duration_days is null then null
                       else greatest(current_date, coalesce(v_prev_expiry, current_date)) + v_duration_days end;

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
      'carried_days', (greatest(current_date, coalesce(v_prev_expiry, current_date)) - current_date),
      'fee_amount', p_fee_amount
    ),
    p_system_actor_label => 'payment-webhook'
  );

  -- Story 20.3: an on-time renewal earns a subscriber stamp (and R free days at K).
  perform private.award_renewal_stamp(p_payment_id);

  return v_new_subscription_id;
end;
$$;

revoke execute on function complete_verified_payment(uuid, integer) from public, anon, authenticated;
grant execute on function complete_verified_payment(uuid, integer) to service_role;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0107's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if position('v_carried_from' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) = 0 then
    raise exception '0121: confirm_renewal does not carry remaining days';
  end if;
  if position('v_prev_expiry' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) = 0 then
    raise exception '0121: complete_verified_payment does not carry remaining days';
  end if;
  if position('award_renewal_stamp' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) = 0
     or position('award_renewal_stamp' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) = 0 then
    raise exception '0121: a renewal path lost the loyalty hook';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure) then
    raise exception '0121: the renewal functions must stay SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute') then
    raise exception '0121: confirm_renewal privileges drifted';
  end if;
  if has_function_privilege('anon', 'public.complete_verified_payment(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_verified_payment(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.complete_verified_payment(uuid, integer)', 'execute') then
    raise exception '0121: complete_verified_payment privileges drifted';
  end if;
end
$verify$;
