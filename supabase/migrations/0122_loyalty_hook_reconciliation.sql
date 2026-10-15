-- ============================================================================
-- 0122: Loyalty hook reconciliation (Epic 20 retro S-2, story 20.8).
--
-- 0120 wraps the three loyalty hooks so a failure rolls back only the hook and
-- records 'loyalty_hook_failed'; nothing ever retried it, and Epic 20 forbids
-- manual balance edits, so a missed stamp, reward or reversal was permanent.
-- Decision 2026-10-15 (docs/decisions.md): repair by reconciliation from source
-- facts. A daily job finds source rows whose loyalty event is missing and
-- re-invokes the same _impl function. Replays are exactly-once because every
-- event is unique on (origin_id, event_type), origin_id being the session or
-- payment id.
--
--   private.award_renewal_stamp_impl(uuid, timestamptz)  NEW. The 0119 body with
--       the clock passed in: 6 uses of now() read p_as_of, so the on-time test and the
--       idle window judge the renewal at its own time. The one-argument impl
--       (and the hook wrapper over it) now delegates with now(): same behavior.
--   public.run_loyalty_hook_repair_job()  NEW daily pg_cron job at 03:15 UTC
--       (own function, own transaction, job_runs name 'loyalty_hook_repair'),
--       clear of the 03:30 sweep and the other jobs.
--
-- Candidates (last 7 days, each only where the gym had loyalty ENABLED at the
-- source fact's time per the latest loyalty_program_changed audit row, and still
-- has it now: a program switched on later is never applied retroactively):
--   earn      consumed, paid, unvoided guest session with no 'stamp_earned' event
--             for the session id          -> on_session_consumed_impl
--   renewal   verified, unvoided subscription payment with a subscription (its
--             created_at is the verification time) and no 'stamp_earned' event
--             for the payment id          -> award_renewal_stamp_impl(id, as_of)
--   reversal  refund of a payment whose session was consumed, with a guest
--             'stamp_earned' for the session and no 'stamp_reversed'
--             -> on_session_refunded_after_consumption_impl (independent of the
--             switch, as in 0120)
-- The impls decide eligibility themselves (late or early renewal, free session,
-- charging off ...): an ineligible candidate writes nothing and is simply seen
-- again next night until it leaves the 7-day window.
--
-- Per member: canonical lock order (member FOR NO KEY UPDATE, then the impl's
-- loyalty_progress lock), each item in its own savepoint so one failure never
-- stops the run. A repaired item writes its normal event and audit rows plus one
-- 'loyalty_hook_repaired' audit row (system:loyalty_hook_repair). A failing item
-- goes through 0120's record_loyalty_hook_failure (job_runs 'loyalty_hook', so the
-- hourly alert fires) and the run's own job_runs row is a failure with counts.
--
-- Rollback: scripts/rollback-0122-loyalty-hook-reconciliation.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The renewal impl with an explicit clock.
-- ----------------------------------------------------------------------------
create function private.award_renewal_stamp_impl(p_payment_id uuid, p_as_of timestamptz)
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
  v_local_today := (p_as_of at time zone v_gym.timezone)::date;

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
     and v_progress.subscriber_last_event_at < p_as_of - make_interval(days => v_window) then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (v_pay.gym_id, v_pay.member_id, 'reset', 'subscriber', p_payment_id, p_as_of,
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
  values (v_pay.gym_id, v_pay.member_id, 'stamp_earned', 'subscriber', p_payment_id, p_as_of,
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
    values (v_pay.gym_id, v_pay.member_id, 'reward_granted', 'subscriber', p_payment_id, p_as_of,
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
      subscriber_last_event_at = p_as_of
  where gym_id = v_pay.gym_id and member_id = v_pay.member_id;
end;
$$;

revoke execute on function private.award_renewal_stamp_impl(uuid, timestamptz) from public, anon, authenticated;

-- The one-argument impl keeps its name and signature; the wrapper from 0120 calls it.
create or replace function private.award_renewal_stamp_impl(p_payment_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform private.award_renewal_stamp_impl(p_payment_id, now());
end;
$$;

revoke execute on function private.award_renewal_stamp_impl(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. The reconciliation job.
-- ----------------------------------------------------------------------------
create function run_loyalty_hook_repair_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_window interval := interval '7 days';
  v_item record;
  v_event_type text;
  v_ref_key text;
  v_repaired integer := 0;
  v_failed integer := 0;
  v_seen integer := 0;
  v_first_error text;
begin
  begin
    for v_item in
      with earn as (
        select 'earn'::text as kind, s.id as ref_id, s.member_id, s.gym_id, s.consumed_at as at_ts
        from guest_sessions s
        join gyms g on g.id = s.gym_id
        where s.consumed_at >= now() - v_window
          and s.payment_id is not null and s.voided_at is null
          and g.loyalty_enabled
          and not exists (
            select 1 from loyalty_events e
            where e.origin_id = s.id and e.event_type = 'stamp_earned')
      ), renewal as (
        select 'renewal'::text, p.id, p.member_id, p.gym_id, sub.created_at
        from payments p
        join subscriptions sub on sub.id = p.subscription_id
        join gyms g on g.id = p.gym_id
        where p.purpose = 'subscription' and p.status = 'verified' and p.voided_at is null
          and sub.created_at >= now() - v_window
          and g.loyalty_enabled
          and not exists (
            select 1 from loyalty_events e
            where e.origin_id = p.id and e.event_type = 'stamp_earned')
      ), reversal as (
        select 'reversal'::text, gs.id, gs.member_id, gs.gym_id, r.created_at
        from refunds r
        join payments p on p.id = r.payment_id
        join guest_sessions gs on gs.payment_id = p.id
        where gs.consumed_at is not null
          and r.created_at >= now() - v_window
          and exists (
            select 1 from loyalty_events e
            where e.origin_id = gs.id and e.event_type = 'stamp_earned' and e.counter = 'guest')
          and not exists (
            select 1 from loyalty_events e
            where e.origin_id = gs.id and e.event_type = 'stamp_reversed')
      ), candidates as (
        select * from earn
        union all select * from renewal
        union all select * from reversal
      )
      select c.* from candidates c
      where c.kind = 'reversal'
         or coalesce((
              select (a.metadata -> 'new' ->> 'enabled')::boolean
              from audit_log a
              where a.action_type = 'loyalty_program_changed'
                and a.gym_id = c.gym_id
                and a.created_at <= c.at_ts
              order by a.created_at desc
              limit 1), false)
      order by c.gym_id, c.member_id, c.at_ts, c.kind, c.ref_id
    loop
      begin
        -- Canonical order: member first; the impls take loyalty_progress after.
        perform 1 from members m
        where m.id = v_item.member_id and m.gym_id = v_item.gym_id
        for no key update;

        if not found then
          continue;
        end if;

        v_seen := v_seen + 1;

        if v_item.kind = 'earn' then
          v_event_type := 'stamp_earned';
          v_ref_key := 'guest_session_id';
          perform private.on_session_consumed_impl(v_item.ref_id, v_item.member_id, v_item.gym_id);
        elsif v_item.kind = 'renewal' then
          v_event_type := 'stamp_earned';
          v_ref_key := 'payment_id';
          perform private.award_renewal_stamp_impl(v_item.ref_id, v_item.at_ts);
        else
          v_event_type := 'stamp_reversed';
          v_ref_key := 'guest_session_id';
          perform private.on_session_refunded_after_consumption_impl(v_item.ref_id, v_item.member_id, v_item.gym_id);
        end if;

        -- The candidate query guaranteed no such event before the call.
        if exists (
          select 1 from loyalty_events e
          where e.origin_id = v_item.ref_id and e.event_type = v_event_type
        ) then
          v_repaired := v_repaired + 1;
          begin
            perform log_audit_event(
              p_action_type => 'loyalty_hook_repaired',
              p_gym_id => v_item.gym_id,
              p_target_entity_id => v_item.member_id::text,
              p_target_entity_type => 'member',
              p_metadata => jsonb_build_object(
                'kind', v_item.kind,
                v_ref_key, v_item.ref_id,
                'as_of', v_item.at_ts
              ),
              p_system_actor_label => 'system:loyalty_hook_repair'
            );
          exception when others then
            raise warning 'loyalty_hook_repair audit failed: %', sqlerrm;
          end;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_first_error := coalesce(v_first_error,
          v_item.kind || ' ' || v_item.ref_id::text || ': ' || sqlstate || ' ' || sqlerrm);
        perform private.record_loyalty_hook_failure(
          'repair:' || v_item.kind, v_item.gym_id, v_item.member_id,
          case when v_item.kind = 'renewal' then 'payment_id' else 'guest_session_id' end,
          v_item.ref_id, sqlstate, sqlerrm);
      end;
    end loop;

    begin
      if v_failed > 0 then
        insert into job_runs (job_name, started_at, finished_at, status, error)
        values ('loyalty_hook_repair', v_started_at, now(), 'failure',
                left(v_failed::text || ' failed, ' || v_repaired::text || ' repaired; first: ' || v_first_error, 1000));
      else
        insert into job_runs (job_name, started_at, finished_at, status)
        values ('loyalty_hook_repair', v_started_at, now(), 'success');
      end if;
    exception when others then
      raise warning 'loyalty_hook_repair job_runs record failed: %', sqlerrm;
    end;
  exception when others then
    -- Failure around the candidate query itself.
    begin
      insert into job_runs (job_name, started_at, finished_at, status, error)
      values ('loyalty_hook_repair', v_started_at, now(), 'failure', left(sqlerrm, 1000));
    exception when others then
      raise warning 'loyalty_hook_repair job_runs record failed: %', sqlerrm;
    end;
  end;
end;
$$;

-- Runs only via pg_cron (as postgres) or a manual postgres call.
revoke execute on function run_loyalty_hook_repair_job() from public, anon, authenticated, service_role;

-- 03:15 UTC daily, ahead of the 03:30 sweep. cron.schedule() upserts by name.
select cron.schedule(
  'loyalty_hook_repair',
  '15 3 * * *',
  $$ select run_loyalty_hook_repair_job(); $$
);

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0107's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if to_regprocedure('private.award_renewal_stamp_impl(uuid, timestamptz)') is null
     or to_regprocedure('private.award_renewal_stamp_impl(uuid)') is null
     or to_regprocedure('public.run_loyalty_hook_repair_job()') is null then
    raise exception '0122: reconciliation objects missing';
  end if;

  if has_function_privilege('anon', 'private.award_renewal_stamp_impl(uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.award_renewal_stamp_impl(uuid, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.run_loyalty_hook_repair_job()', 'execute')
     or has_function_privilege('authenticated', 'public.run_loyalty_hook_repair_job()', 'execute')
     or has_function_privilege('service_role', 'public.run_loyalty_hook_repair_job()', 'execute') then
    raise exception '0122: reconciliation functions must not be client-callable';
  end if;

  if not exists (select 1 from cron.job where jobname = 'loyalty_hook_repair') then
    raise exception '0122: loyalty_hook_repair is not scheduled';
  end if;

  if position('p_as_of' in pg_get_functiondef('private.award_renewal_stamp_impl(uuid, timestamptz)'::regprocedure)) = 0 then
    raise exception '0122: the renewal impl does not use its clock argument';
  end if;
end
$verify$;
