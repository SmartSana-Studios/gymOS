-- ============================================================================
-- 0157: Subscription start dates use the GYM-LOCAL day, not the database's UTC day.
--
-- confirm_renewal, renew_subscription and complete_verified_payment set a new subscription's start_date, the carry of
-- the remaining days of an early renewal, and the back-date check from the database's current_date (UTC). The loyalty
-- rule judges "on time" in the gym-local date (award_renewal_stamp: now() at time zone gyms.timezone), and the screens
-- show gym-local dates. For a Douala gym (UTC+1) the two days differ from 23:00 to 24:00 UTC, so a renewal paid between
-- midnight and 01:00 Douala time started a day early and could be judged one day off. Found by the loyalty subscriber
-- test, which fails in that hour.
--
-- private.gym_today(gym) is the gym-local day: (now() at time zone gyms.timezone)::date. An unknown gym, an empty or an
-- unresolvable zone falls back to the UTC day, so a bad timezone value can never block a paid renewal (a deferred
-- finding: gyms.timezone is not validated in the database).
--
-- The three function bodies below are the live definitions with current_date replaced by private.gym_today(<gym>). The
-- subscription_lifecycle job (expiry at 01:00 UTC) is unchanged. Rollback: scripts/rollback-0157-renewal-start-date-gym-local.sql
-- ============================================================================
set local lock_timeout = '5s';

create or replace function private.gym_today(p_gym_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select g.timezone into v_tz from gyms g where g.id = p_gym_id;
  return (now() at time zone coalesce(nullif(btrim(v_tz), ''), 'UTC'))::date;
exception when others then
  return current_date;
end;
$$;

revoke execute on function private.gym_today(uuid) from public, anon, authenticated;

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
  v_caller_gym_id := private.support_rpc_gym_id('confirm_renewal');
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- AD-3 / 19.1 lint: the role comes from private.support_rpc_role('confirm_renewal'), not the
  -- JWT claim 0093 read. Same allowlist; a caller with no active membership in
  -- the gym is refused as before. Role resolution comes BEFORE the suspension
  -- gate (code review 2026-09-09 rule, see tenant_suspension_enforcement.test.sql):
  -- an unauthorized caller at a suspended gym must not learn the gym status.
  if not coalesce(private.support_rpc_role('confirm_renewal') in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;
  v_actor_id := private.actor_id();

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
    v_start_date := private.gym_today(v_member_gym_id);
  end if;

  select duration_days, price, plans.currency into v_duration_days, amount, currency
  from plans where id = v_plan_id;

  -- Review finding: back-dating a member expired longer than one plan cycle
  -- (e.g. expired 100 days ago on a 30-day plan) would otherwise insert a
  -- new subscription already marked 'active' with an expiry_date already in
  -- the past. Reject rather than silently produce an already-expired
  -- "active" row -- consistent with this block's other eligibility guards.
  if p_backdate and v_duration_days is not null and (v_start_date + v_duration_days) < private.gym_today(v_member_gym_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_verified_payment(p_payment_id uuid, p_fee_amount integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                       else greatest(private.gym_today(v_gym_id), coalesce(v_prev_expiry, private.gym_today(v_gym_id))) + v_duration_days end;

  insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
  values (v_gym_id, v_member_id, v_plan_id, 'active', private.gym_today(v_gym_id), v_new_expiry)
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
      'carried_days', (greatest(private.gym_today(v_gym_id), coalesce(v_prev_expiry, private.gym_today(v_gym_id))) - private.gym_today(v_gym_id)),
      'fee_amount', p_fee_amount
    ),
    p_system_actor_label => 'payment-webhook'
  );

  -- Story 20.3: an on-time renewal earns a subscriber stamp (and R free days at K).
  perform private.award_renewal_stamp(p_payment_id);

  return v_new_subscription_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.renew_subscription(p_member_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- Grants restated for the migration guardrail (unchanged from 0121 / 0037).
revoke execute on function public.confirm_renewal(uuid, text, text, boolean) from public, anon;
grant execute on function public.confirm_renewal(uuid, text, text, boolean) to authenticated;
revoke execute on function public.renew_subscription(uuid, text) from public, anon;
grant execute on function public.renew_subscription(uuid, text) to authenticated;
revoke execute on function public.complete_verified_payment(uuid, integer) from public, anon, authenticated;
grant execute on function public.complete_verified_payment(uuid, integer) to service_role;
