-- ============================================================================
-- 0119: Loyalty subscriber rule (Epic 20, Story 20.3).
--
-- Adds private.award_renewal_stamp(p_payment_id), the single subscriber entry
-- point, and calls it inside the verifying transaction from the two paths that
-- verify a renewal payment and create the renewed subscription. An on-time
-- renewal earns one stamp; at K the renewed subscription's expiry_date moves out
-- by R days and the counter returns to 0 (FR-167).
--
-- Renewal-verification paths found by grep (every writer of subscriptions /
-- payments.status = 'verified'), and what each does here:
--   public.confirm_renewal(uuid,text,text,boolean)  CALLS the hook, except when
--       p_backdate is true (a back-dated staff renewal never earns). Re-created
--       from 0093 with the call added and the member row locked
--       (FOR NO KEY UPDATE) before its first write, to honor AD-27.
--   public.complete_verified_payment(uuid,integer)  subscription branch CALLS
--       the hook after the subscription_id backfill. Re-created from 0109 with
--       only the call added; its locking (payment, then member) is unchanged.
--       registration_fee and session branches never call it.
--   public.renew_subscription(uuid,text)            payment-less override;
--       never calls, not touched.
--   0031 staff queue (UPDATE pending -> verified)   writes a ledger entry only:
--       creates and extends no subscription, so there is no period to judge;
--       never calls, not touched.
--   registration_fee / session purposes             never call (the hook is a
--       no-op unless payments.purpose = 'subscription').
--
-- Earns only when (all read from the payment row and its subscriptions):
--   * payment purpose 'subscription', status 'verified', not voided, with a
--     subscription_id;
--   * the gym has loyalty_enabled and a K (and an R);
--   * the renewed subscription's plan is not pay_per_session and is the same
--     plan as the previous subscription (latest subscription of the member
--     created before the renewed one) and the previous one has an expiry_date;
--   * on time: gym-local date (gyms.timezone) at verification is on or after the
--     previous expiry_date and at most that date + 1 day, judged against the
--     CURRENT (possibly already extended) expiry_date. A renewal verified while
--     the previous period still runs earns nothing (decision 2026-10-12: at most
--     one stamp per subscription period).
--
-- Replay key: unique (origin_id, event_type) with origin_id = the payment id. An
-- existing stamp_earned row for the payment means a replay: return and change
-- nothing, so the extension also happens once (reward_granted is
-- on conflict do nothing and the extension only follows an inserted row).
--
-- Idle reset first (as 20.2): counter > 0 and subscriber_last_event_at older than
-- greatest(loyalty_idle_reset_days, plan duration_days + grace_period_days) ->
-- one 'reset' event (previous count in details), counter 0, then the stamp. This
-- is the same window effective_loyalty() applies at read. The 20.4 sweep must
-- use its own origin ids for sweep resets, never payment ids.
--
-- At subscriber_stamps >= K (also above a lowered K): one reward_granted event
-- (counter subscriber), expiry_date of the renewed subscription + R days,
-- counter 0. No payment, amount or plan change is created; status is left to
-- the lifecycle job. No "original expiry" is stored.
--
-- Refunding a renewal reverses nothing here (FR-162; reversal is 20.4's and
-- covers sessions only).
--
-- Lock order (AD-27): payment -> member (FOR NO KEY UPDATE) -> subscriptions
-- -> loyalty_progress (FOR UPDATE, last). Both callers hold the member lock
-- before the hook runs.
--
-- Audit: log_audit_event with the existing labels loyalty_stamp_earned,
-- loyalty_reward_granted, loyalty_progress_reset and counter 'subscriber' in
-- metadata. The system label 'payment-webhook' only applies when there is no
-- authenticated actor (the webhook path); staff paths keep the staff actor.
--
-- confirm_renewal's caller check moves from 0093's JWT app_role claim read to
-- private.current_member_role() (the 19.1 guardrail forbids a new JWT role read
-- and the grandfather list is capped). Same allowlist (owner, manager,
-- supervisor, receptionist); the role now comes from the caller's active
-- members row in the current gym instead of the token.
--
-- Rollback: scripts/rollback-0119-loyalty-subscriber-rule.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- private.award_renewal_stamp(p_payment_id)
-- SECURITY INVOKER like 0118's hook: it runs inside the definer chain of the
-- two verifying functions, which own the ledger tables.
-- ----------------------------------------------------------------------------
create or replace function private.award_renewal_stamp(p_payment_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_pay payments%rowtype;
  v_new subscriptions%rowtype;
  v_prev subscriptions%rowtype;
  v_gym gyms%rowtype;
  v_plan plans%rowtype;
  v_cfg platform_session_config%rowtype;
  v_progress loyalty_progress%rowtype;
  v_local_today date;
  v_window integer;
  v_stamps integer;
  v_event_id uuid;
  v_old_expiry date;
  v_new_expiry date;
begin
  select * into v_pay from payments p where p.id = p_payment_id;

  if not found
     or v_pay.purpose is distinct from 'subscription'
     or v_pay.status is distinct from 'verified'
     or v_pay.voided_at is not null
     or v_pay.subscription_id is null then
    return;
  end if;

  select * into v_new from subscriptions s where s.id = v_pay.subscription_id;

  if not found
     or v_new.member_id is distinct from v_pay.member_id
     or v_new.gym_id is distinct from v_pay.gym_id then
    return;
  end if;

  select * into v_gym from gyms g where g.id = v_pay.gym_id;

  if not coalesce(v_gym.loyalty_enabled, false)
     or v_gym.loyalty_renewal_threshold is null
     or v_gym.loyalty_reward_days is null then
    return;
  end if;

  select * into v_plan from plans pl where pl.id = v_new.plan_id;

  if not found or v_plan.plan_type = 'pay_per_session' then
    return;
  end if;

  -- The period being renewed: the member's latest subscription created before
  -- the renewed one.
  select * into v_prev
  from subscriptions s
  where s.member_id = v_new.member_id
    and s.id <> v_new.id
    and (s.created_at, s.id) < (v_new.created_at, v_new.id)
  order by s.created_at desc, s.id desc
  limit 1;

  if not found
     or v_prev.plan_id is distinct from v_new.plan_id
     or v_prev.expiry_date is null then
    return;
  end if;

  -- On time: expiry day or the day after, gym-local, against the current
  -- (possibly extended) expiry_date. Earlier is an early renewal, later is late.
  v_local_today := (now() at time zone v_gym.timezone)::date;

  if v_local_today < v_prev.expiry_date
     or v_local_today > v_prev.expiry_date + 1 then
    return;
  end if;

  select * into v_cfg from platform_session_config c limit 1;

  v_window := greatest(
    v_cfg.loyalty_idle_reset_days,
    coalesce(v_plan.duration_days, 0) + v_gym.grace_period_days
  );

  -- Progress row on first use; locked last in the canonical order.
  insert into loyalty_progress (gym_id, member_id)
  values (v_pay.gym_id, v_pay.member_id)
  on conflict (gym_id, member_id) do nothing;

  select * into v_progress
  from loyalty_progress lp
  where lp.gym_id = v_pay.gym_id and lp.member_id = v_pay.member_id
  for update;

  -- Replay: this payment already earned its stamp.
  if exists (
    select 1 from loyalty_events e
    where e.origin_id = p_payment_id and e.event_type = 'stamp_earned'
  ) then
    return;
  end if;

  v_stamps := v_progress.subscriber_stamps;

  -- Idle reset first.
  if v_stamps > 0
     and v_progress.subscriber_last_event_at is not null
     and v_progress.subscriber_last_event_at < now() - make_interval(days => v_window) then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (v_pay.gym_id, v_pay.member_id, 'reset', 'subscriber', p_payment_id, now(),
            jsonb_build_object(
              'previous_count', v_stamps,
              'previous_last_event_at', v_progress.subscriber_last_event_at,
              'idle_reset_days', v_window))
    on conflict (origin_id, event_type) do nothing;

    perform log_audit_event(
      p_action_type => 'loyalty_progress_reset',
      p_gym_id => v_pay.gym_id,
      p_target_entity_id => v_pay.member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'counter', 'subscriber',
        'payment_id', p_payment_id,
        'previous_count', v_stamps,
        'previous_last_event_at', v_progress.subscriber_last_event_at,
        'idle_reset_days', v_window
      ),
      p_system_actor_label => 'payment-webhook'
    );

    v_stamps := 0;
  end if;

  -- Stamp.
  v_stamps := v_stamps + 1;

  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
  values (v_pay.gym_id, v_pay.member_id, 'stamp_earned', 'subscriber', p_payment_id, now(),
          jsonb_build_object('payment_id', p_payment_id, 'subscription_id', v_new.id,
                             'stamps_after', v_stamps));

  perform log_audit_event(
    p_action_type => 'loyalty_stamp_earned',
    p_gym_id => v_pay.gym_id,
    p_target_entity_id => v_pay.member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'counter', 'subscriber',
      'payment_id', p_payment_id,
      'subscription_id', v_new.id,
      'stamps', v_stamps,
      'threshold', v_gym.loyalty_renewal_threshold
    ),
    p_system_actor_label => 'payment-webhook'
  );

  -- Reward at K (also above a lowered K); the counter returns to 0.
  if v_stamps >= v_gym.loyalty_renewal_threshold then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (v_pay.gym_id, v_pay.member_id, 'reward_granted', 'subscriber', p_payment_id, now(),
            jsonb_build_object('payment_id', p_payment_id, 'subscription_id', v_new.id,
                               'stamps', v_stamps,
                               'threshold', v_gym.loyalty_renewal_threshold,
                               'reward_days', v_gym.loyalty_reward_days))
    on conflict (origin_id, event_type) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      v_old_expiry := v_new.expiry_date;
      v_new_expiry := v_old_expiry + v_gym.loyalty_reward_days;

      update subscriptions
      set expiry_date = v_new_expiry
      where id = v_new.id;

      perform log_audit_event(
        p_action_type => 'loyalty_reward_granted',
        p_gym_id => v_pay.gym_id,
        p_target_entity_id => v_pay.member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'counter', 'subscriber',
          'payment_id', p_payment_id,
          'subscription_id', v_new.id,
          'stamps', v_stamps,
          'threshold', v_gym.loyalty_renewal_threshold,
          'reward_days', v_gym.loyalty_reward_days,
          'old_expiry_date', v_old_expiry,
          'new_expiry_date', v_new_expiry
        ),
        p_system_actor_label => 'payment-webhook'
      );
    end if;

    v_stamps := 0;
  end if;

  update loyalty_progress
  set subscriber_stamps = v_stamps,
      subscriber_last_event_at = now()
  where gym_id = v_pay.gym_id and member_id = v_pay.member_id;
end;
$$;

revoke execute on function private.award_renewal_stamp(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- confirm_renewal(): 0093's body with the member row locked before the first
-- write and the hook called after the renewal is recorded (not when
-- p_backdate). new_expiry_date is re-read so the caller sees an extension.
-- ----------------------------------------------------------------------------
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
  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'confirm_renewal: gym % is not active', v_caller_gym_id;
  end if;

  -- AD-3 / 19.1 lint: the role comes from private.current_member_role(), not the
  -- JWT claim 0093 read. Same allowlist; a caller with no active membership in
  -- the gym is refused as before. It sits after the suspension gate so a claim
  -- naming an unresolvable gym still fails closed with the 'is not active' error.
  if not coalesce(private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist'), false) then
    raise exception 'permission denied';
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

-- ----------------------------------------------------------------------------
-- complete_verified_payment(): 0109's body with only the hook call added to the
-- subscription branch. Locking is unchanged (payment, then member).
-- ----------------------------------------------------------------------------
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
  if to_regprocedure('private.award_renewal_stamp(uuid)') is null then
    raise exception '0119: award_renewal_stamp missing';
  end if;

  if has_function_privilege('anon', 'private.award_renewal_stamp(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.award_renewal_stamp(uuid)', 'execute') then
    raise exception '0119: award_renewal_stamp must not be client-callable';
  end if;

  if position('award_renewal_stamp' in pg_get_functiondef('public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)) = 0 then
    raise exception '0119: confirm_renewal does not call the hook';
  end if;

  if position('award_renewal_stamp' in pg_get_functiondef('public.complete_verified_payment(uuid, integer)'::regprocedure)) = 0 then
    raise exception '0119: complete_verified_payment does not call the hook';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = 'public.confirm_renewal(uuid, text, text, boolean)'::regprocedure)
     or not (select p.prosecdef from pg_proc p where p.oid = 'public.complete_verified_payment(uuid, integer)'::regprocedure) then
    raise exception '0119: the verifying functions must stay SECURITY DEFINER';
  end if;

  if not has_function_privilege('authenticated', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.confirm_renewal(uuid, text, text, boolean)', 'execute') then
    raise exception '0119: confirm_renewal privileges drifted';
  end if;

  if has_function_privilege('anon', 'public.complete_verified_payment(uuid, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_verified_payment(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.complete_verified_payment(uuid, integer)', 'execute') then
    raise exception '0119: complete_verified_payment privileges drifted';
  end if;
end;
$verify$;
