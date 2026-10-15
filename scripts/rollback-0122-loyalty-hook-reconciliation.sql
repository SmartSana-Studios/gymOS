-- Rollback for migration 0122 (loyalty hook reconciliation): unschedules and drops
-- the repair job and the clocked renewal impl, and puts the one-argument impl back
-- to the 0119 body. Non-destructive: events and audit rows written by repairs stay
-- (valid ledger data). Also remove the loyalty_hook_repair line from
-- scripts/job-runs-alert.sql, or the hourly alert reports it as not running.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0122-loyalty-hook-reconciliation.sql

select cron.unschedule('loyalty_hook_repair') where exists (select 1 from cron.job where jobname = 'loyalty_hook_repair');

drop function if exists public.run_loyalty_hook_repair_job();

create or replace function private.award_renewal_stamp_impl(p_payment_id uuid)
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

drop function if exists private.award_renewal_stamp_impl(uuid, timestamptz);

revoke execute on function private.award_renewal_stamp_impl(uuid) from public, anon, authenticated;

do $verify$
begin
  if to_regprocedure('private.award_renewal_stamp_impl(uuid, timestamptz)') is not null
     or to_regprocedure('public.run_loyalty_hook_repair_job()') is not null then
    raise exception 'rollback-0122: objects still present';
  end if;
  if position('p_as_of' in pg_get_functiondef('private.award_renewal_stamp_impl(uuid)'::regprocedure)) <> 0 then
    raise exception 'rollback-0122: impl still delegates';
  end if;
end;
$verify$;
