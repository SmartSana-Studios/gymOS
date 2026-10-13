-- ============================================================================
-- 0120: Loyalty refund reversal, lapses & 90-day reset sweep (Epic 20, Story 20.4).
--
--   private.on_session_refunded_after_consumption()  0113's no-op hook, now a
--       thin wrapper over private.on_session_refunded_after_consumption_impl()
--       (the stamp reversal, FR-162)
--   private.on_session_consumed()      0118 body renamed in place to
--       private.on_session_consumed_impl(); same name/signature re-exposed as a
--       thin wrapper
--   private.award_renewal_stamp()      0119 body renamed in place to
--       private.award_renewal_stamp_impl(); same name/signature re-exposed as a
--       thin wrapper
--   run_loyalty_sweep_job()            daily pg_cron job (job_runs name
--       'loyalty_sweep'), persists lapses and idle resets (FR-166, FR-168)
--
-- Hook failure posture (decided 2026-10-13, option A). Each wrapper runs its
-- impl inside a savepoint (BEGIN ... EXCEPTION). On any error the impl's writes
-- are rolled back, a 'loyalty_hook_failed' audit row (hook name, SQLSTATE,
-- message, ids; actor is the caller when there is one, else the system label
-- 'system:loyalty_hook') and a job_runs
-- failure row (job_name 'loyalty_hook') are written, a WARNING is raised, and
-- the caller (payment verification, check-in, refund) proceeds with no ledger
-- write. Callers, signatures, grants and earn rules are unchanged. The two
-- bookkeeping writes are guarded separately: if one fails only a warning remains.
--
-- Reversal (FR-162), for any refund (full or partial) of a consumed paid
-- session. Acts only when a guest 'stamp_earned' event exists with origin_id =
-- the session id AND that stamp is still in the current count: no guest 'reset'
-- (other than one with the stamp's own origin) and no guest 'reward_granted'
-- dated after the stamp or sharing its origin. Then: one 'stamp_reversed'
-- (origin_id = session id), guest_stamps = greatest(guest_stamps - 1, 0), one
-- 'loyalty_stamp_reversed' audit row. Otherwise nothing is written. A second
-- refund of the same session is a replay (unique (origin_id, event_type)) and
-- changes nothing. Independent of the gym's loyalty switch now. A granted free
-- session is never taken back; guest_last_event_at is untouched. Subscriber
-- stamps are never reversed.
--
-- Sweep: one pass per member, canonical lock order (member FOR NO KEY UPDATE,
-- then loyalty_progress FOR UPDATE), conditions re-read under the lock, each
-- member in its own savepoint so one bad row does not stop the run.
--   * lapse: unconsumed, unvoided guest_sessions row with usable_until <= now()
--     and no 'lapse' event -> one 'lapse' event (counter guest, origin_id =
--     session id, occurred_at = usable_until, details.kind 'free' | 'paid') and
--     one audit row ('loyalty_free_session_lapsed' / 'loyalty_paid_session_lapsed').
--     The session row is not changed.
--   * reset: counter > 0 whose last event is older than its window (guest:
--     loyalty_idle_reset_days; subscriber: greatest of that and latest plan
--     duration_days + gym grace_period_days, effective_loyalty()'s rule) -> one
--     'reset' event with origin_id = md5('loyalty_sweep_reset:member:counter:
--     epoch(last_event_at)')::uuid (never a session or payment id), counter 0,
--     last_event_at left as is, one 'loyalty_progress_reset' audit row with
--     source 'sweep', previous_count and window.
-- Covers every gym (loyalty off and suspended included): lapses and resets are
-- time facts, not program actions. Audit actor label 'system:loyalty_sweep_job'.
-- Idempotent: running twice, or after missed days, writes each fact once. Racing
-- an earn gives the same counter either way (the earn hook resets first itself).
--
-- Replay: folding a member's events (stamp +1; reward_granted/reset -> 0;
-- stamp_reversed -1 floored at 0) equals loyalty_progress; unused free sessions
-- equal reward_granted minus reward_consumed minus lapse (guest counter).
--
-- Rollback: scripts/rollback-0120-loyalty-refund-reversal-lapse-sweep.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rename the two earn bodies in place; grants travel with the objects.
-- ----------------------------------------------------------------------------
alter function private.on_session_consumed(uuid, uuid, uuid) rename to on_session_consumed_impl;
alter function private.award_renewal_stamp(uuid) rename to award_renewal_stamp_impl;
alter function private.on_session_refunded_after_consumption(uuid, uuid, uuid)
  rename to on_session_refunded_after_consumption_impl;

-- ----------------------------------------------------------------------------
-- 2. Reversal body (replaces 0113's no-op under its new name).
-- ----------------------------------------------------------------------------
create or replace function private.on_session_refunded_after_consumption_impl(
  p_session_id uuid, p_member_id uuid, p_gym_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_s guest_sessions%rowtype;
  v_stamp loyalty_events%rowtype;
  v_progress loyalty_progress%rowtype;
  v_after integer;
begin
  select * into v_s from guest_sessions s where s.id = p_session_id;

  if not found
     or v_s.consumed_at is null
     or v_s.member_id is distinct from p_member_id
     or v_s.gym_id is distinct from p_gym_id then
    return;
  end if;

  select * into v_stamp
  from loyalty_events e
  where e.origin_id = p_session_id and e.event_type = 'stamp_earned'
    and e.counter = 'guest' and e.member_id = p_member_id and e.gym_id = p_gym_id;

  if not found then
    return;
  end if;

  -- Progress row locked last in the canonical order; a concurrent duplicate
  -- refund waits here and then sees the first one's stamp_reversed.
  select * into v_progress
  from loyalty_progress lp
  where lp.gym_id = p_gym_id and lp.member_id = p_member_id
  for update;

  if not found then
    return;
  end if;

  -- Replay: this session's stamp was already taken back.
  if exists (
    select 1 from loyalty_events e
    where e.origin_id = p_session_id and e.event_type = 'stamp_reversed'
  ) then
    return;
  end if;

  -- The stamp must still be in the current count.
  if exists (
    select 1 from loyalty_events e
    where e.member_id = p_member_id and e.gym_id = p_gym_id and e.counter = 'guest'
      and (
        (e.event_type = 'reset' and e.origin_id <> p_session_id
           and e.occurred_at >= v_stamp.occurred_at
           -- A reset only zeroes stamps up to the last event it saw.
           and coalesce((e.details ->> 'previous_last_event_at')::timestamptz, e.occurred_at)
               >= v_stamp.occurred_at)
        or (e.event_type = 'reward_granted'
           and (e.origin_id = p_session_id or e.occurred_at > v_stamp.occurred_at))
      )
  ) then
    return;
  end if;

  if v_progress.guest_stamps <= 0 then
    return;
  end if;

  v_after := greatest(v_progress.guest_stamps - 1, 0);

  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
  values (p_gym_id, p_member_id, 'stamp_reversed', 'guest', p_session_id, now(),
          jsonb_build_object('guest_session_id', p_session_id,
                             'stamp_event_id', v_stamp.id,
                             'stamps_before', v_progress.guest_stamps,
                             'stamps_after', v_after))
  on conflict (origin_id, event_type) do nothing;

  if not found then
    return;
  end if;

  update loyalty_progress
  set guest_stamps = v_after
  where gym_id = p_gym_id and member_id = p_member_id;

  perform log_audit_event(
    p_action_type => 'loyalty_stamp_reversed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'counter', 'guest',
      'guest_session_id', p_session_id,
      'stamps_before', v_progress.guest_stamps,
      'stamps_after', v_after
    )
  );
end;
$$;

revoke execute on function private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.on_session_consumed_impl(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.award_renewal_stamp_impl(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Failure bookkeeping shared by the three wrappers.
-- ----------------------------------------------------------------------------
create function private.record_loyalty_hook_failure(
  p_hook text, p_gym_id uuid, p_member_id uuid, p_ref_key text, p_ref_id uuid,
  p_sqlstate text, p_message text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  raise warning 'loyalty hook % failed (% %): %', p_hook, p_sqlstate, p_ref_id, p_message;

  -- Two independent blocks: the job_runs row feeds the hourly alert and must
  -- survive a failing audit write.
  begin
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('loyalty_hook', now(), now(), 'failure',
            left(p_hook || ' ' || p_sqlstate || ': ' || p_message, 1000));
  exception when others then
    raise warning 'loyalty hook % job_runs record failed: %', p_hook, sqlerrm;
  end;

  begin
    perform log_audit_event(
      p_action_type => 'loyalty_hook_failed',
      p_gym_id => p_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => case when p_member_id is null then null else 'member' end,
      p_metadata => jsonb_build_object(
        'hook', p_hook,
        'sqlstate', p_sqlstate,
        'message', p_message,
        p_ref_key, p_ref_id,
        'member_id', p_member_id,
        'gym_id', p_gym_id
      ),
      p_system_actor_label => 'system:loyalty_hook'
    );
  exception when others then
    raise warning 'loyalty hook % audit record failed: %', p_hook, sqlerrm;
  end;
end;
$$;

revoke execute on function private.record_loyalty_hook_failure(text, uuid, uuid, text, uuid, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. The three wrappers: same names, signatures and grants as before.
-- ----------------------------------------------------------------------------
create function private.on_session_consumed(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  begin
    perform private.on_session_consumed_impl(p_session_id, p_member_id, p_gym_id);
  exception when others then
    perform private.record_loyalty_hook_failure(
      'on_session_consumed', p_gym_id, p_member_id, 'guest_session_id', p_session_id,
      sqlstate, sqlerrm);
  end;
end;
$$;

create function private.on_session_refunded_after_consumption(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  begin
    perform private.on_session_refunded_after_consumption_impl(p_session_id, p_member_id, p_gym_id);
  exception when others then
    perform private.record_loyalty_hook_failure(
      'on_session_refunded_after_consumption', p_gym_id, p_member_id, 'guest_session_id', p_session_id,
      sqlstate, sqlerrm);
  end;
end;
$$;

create function private.award_renewal_stamp(p_payment_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
begin
  begin
    perform private.award_renewal_stamp_impl(p_payment_id);
  exception when others then
    begin
      select p.gym_id, p.member_id into v_gym_id, v_member_id from payments p where p.id = p_payment_id;
    exception when others then
      null;
    end;
    perform private.record_loyalty_hook_failure(
      'award_renewal_stamp', v_gym_id, v_member_id, 'payment_id', p_payment_id,
      sqlstate, sqlerrm);
  end;
end;
$$;

revoke execute on function private.on_session_consumed(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.on_session_refunded_after_consumption(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.award_renewal_stamp(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. The sweep.
-- ----------------------------------------------------------------------------
create function run_loyalty_sweep_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_idle integer;
  v_cand record;
  v_gym gyms%rowtype;
  v_progress loyalty_progress%rowtype;
  v_sess record;
  v_plan_duration integer;
  v_window integer;
  v_origin uuid;
  v_inserted boolean;
  v_counter text;
  v_previous integer;
  v_last timestamptz;
  v_failed integer := 0;
  v_processed integer := 0;
  v_first_error text;
begin
  begin
    select c.loyalty_idle_reset_days into v_idle from platform_session_config c limit 1;

    if v_idle is null then
      raise exception 'loyalty_sweep: platform_session_config has no loyalty_idle_reset_days';
    end if;

    for v_cand in
      select member_id, gym_id from (
        select s.member_id, s.gym_id
        from guest_sessions s
        where s.consumed_at is null and s.voided_at is null
          and s.usable_until <= now()
          and not exists (
            select 1 from loyalty_events e
            where e.origin_id = s.id and e.event_type = 'lapse')
        union
        select lp.member_id, lp.gym_id
        from loyalty_progress lp
        where (lp.guest_stamps > 0 and lp.guest_last_event_at < now() - make_interval(days => v_idle))
           or (lp.subscriber_stamps > 0 and lp.subscriber_last_event_at < now() - make_interval(days => v_idle))
      ) c
      order by gym_id, member_id
    loop
      begin
        -- Canonical order: member, then loyalty_progress.
        perform 1 from members m
        where m.id = v_cand.member_id and m.gym_id = v_cand.gym_id
        for no key update;

        if not found then
          continue;
        end if;

        select * into v_progress
        from loyalty_progress lp
        where lp.gym_id = v_cand.gym_id and lp.member_id = v_cand.member_id
        for update;

        -- Lapses, re-read under the lock.
        for v_sess in
          select s.id, s.usable_until, s.loyalty_grant_id, s.payment_id
          from guest_sessions s
          where s.member_id = v_cand.member_id and s.gym_id = v_cand.gym_id
            and s.consumed_at is null and s.voided_at is null
            and s.usable_until <= now()
            and not exists (
              select 1 from loyalty_events e
              where e.origin_id = s.id and e.event_type = 'lapse')
          order by s.usable_until, s.id
        loop
          insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
          values (v_cand.gym_id, v_cand.member_id, 'lapse', 'guest', v_sess.id, v_sess.usable_until,
                  jsonb_build_object(
                    'guest_session_id', v_sess.id,
                    'kind', case when v_sess.loyalty_grant_id is not null then 'free' else 'paid' end,
                    'usable_until', v_sess.usable_until,
                    'swept_at', now()))
          on conflict (origin_id, event_type) do nothing;

          if found then
            perform log_audit_event(
              p_action_type => case when v_sess.loyalty_grant_id is not null
                                    then 'loyalty_free_session_lapsed'
                                    else 'loyalty_paid_session_lapsed' end,
              p_gym_id => v_cand.gym_id,
              p_target_entity_id => v_cand.member_id::text,
              p_target_entity_type => 'member',
              p_metadata => jsonb_build_object(
                'guest_session_id', v_sess.id,
                'usable_until', v_sess.usable_until,
                'loyalty_grant_id', v_sess.loyalty_grant_id,
                'payment_id', v_sess.payment_id
              ),
              p_system_actor_label => 'system:loyalty_sweep_job'
            );
            v_processed := v_processed + 1;
          end if;
        end loop;

        -- Idle resets, re-read under the lock.
        select * into v_progress
        from loyalty_progress lp
        where lp.gym_id = v_cand.gym_id and lp.member_id = v_cand.member_id;

        if found then
          select * into v_gym from gyms g where g.id = v_cand.gym_id;

          select p.duration_days into v_plan_duration
          from subscriptions s
          join plans p on p.id = s.plan_id
          where s.member_id = v_cand.member_id
          order by s.created_at desc, s.id desc
          limit 1;

          foreach v_counter in array array['guest', 'subscriber']
          loop
            if v_counter = 'guest' then
              v_previous := v_progress.guest_stamps;
              v_last := v_progress.guest_last_event_at;
              v_window := v_idle;
            else
              v_previous := v_progress.subscriber_stamps;
              v_last := v_progress.subscriber_last_event_at;
              v_window := case
                when v_plan_duration is null then v_idle
                else greatest(v_idle, v_plan_duration + v_gym.grace_period_days)
              end;
            end if;

            if v_previous > 0 and v_last is not null
               and v_last < now() - make_interval(days => v_window) then
              v_origin := md5(
                'loyalty_sweep_reset:' || v_cand.member_id::text || ':' || v_counter || ':'
                || extract(epoch from v_last)::text
              )::uuid;

              insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
              values (v_cand.gym_id, v_cand.member_id, 'reset', v_counter, v_origin, now(),
                      jsonb_build_object(
                        'source', 'sweep',
                        'previous_count', v_previous,
                        'previous_last_event_at', v_last,
                        'idle_reset_days', v_window))
              on conflict (origin_id, event_type) do nothing;

              v_inserted := found;

              if v_inserted then
                if v_counter = 'guest' then
                  update loyalty_progress set guest_stamps = 0
                  where gym_id = v_cand.gym_id and member_id = v_cand.member_id;
                else
                  update loyalty_progress set subscriber_stamps = 0
                  where gym_id = v_cand.gym_id and member_id = v_cand.member_id;
                end if;

                perform log_audit_event(
                  p_action_type => 'loyalty_progress_reset',
                  p_gym_id => v_cand.gym_id,
                  p_target_entity_id => v_cand.member_id::text,
                  p_target_entity_type => 'member',
                  p_metadata => jsonb_build_object(
                    'counter', v_counter,
                    'source', 'sweep',
                    'previous_count', v_previous,
                    'previous_last_event_at', v_last,
                    'idle_reset_days', v_window
                  ),
                  p_system_actor_label => 'system:loyalty_sweep_job'
                );
                v_processed := v_processed + 1;
              end if;
            end if;
          end loop;
        end if;
      exception when others then
        v_failed := v_failed + 1;
        v_first_error := coalesce(v_first_error,
          'member ' || v_cand.member_id::text || ': ' || sqlstate || ' ' || sqlerrm);
      end;
    end loop;

    -- Run bookkeeping is guarded write by write: a failing audit insert must not
    -- roll back the members already swept or take the job_runs row (which feeds
    -- the hourly alert) down with it.
    if v_failed > 0 then
      begin
        insert into job_runs (job_name, started_at, finished_at, status, error)
        values ('loyalty_sweep', v_started_at, now(), 'failure',
                left(v_failed::text || ' member(s) failed; first: ' || v_first_error, 1000));
      exception when others then
        raise warning 'loyalty_sweep job_runs record failed: %', sqlerrm;
      end;

      begin
        perform log_audit_event(
          p_action_type => 'loyalty_sweep_job_failure',
          p_system_actor_label => 'system:loyalty_sweep_job',
          p_metadata => jsonb_build_object('failed_members', v_failed, 'first_error', v_first_error,
                                           'processed', v_processed)
        );
      exception when others then
        raise warning 'loyalty_sweep failure audit failed: %', sqlerrm;
      end;
    else
      begin
        insert into job_runs (job_name, started_at, finished_at, status)
        values ('loyalty_sweep', v_started_at, now(), 'success');
      exception when others then
        raise warning 'loyalty_sweep job_runs record failed: %', sqlerrm;
      end;
    end if;
  exception when others then
    -- Only a failure before or around the member loop lands here (config row,
    -- candidate query); the two writes are guarded separately for the same reason.
    begin
      insert into job_runs (job_name, started_at, finished_at, status, error)
      values ('loyalty_sweep', v_started_at, now(), 'failure', left(sqlerrm, 1000));
    exception when others then
      raise warning 'loyalty_sweep job_runs record failed: %', sqlerrm;
    end;

    begin
      perform log_audit_event(
        p_action_type => 'loyalty_sweep_job_failure',
        p_system_actor_label => 'system:loyalty_sweep_job',
        p_metadata => jsonb_build_object('error', sqlerrm)
      );
    exception when others then
      raise warning 'loyalty_sweep failure audit failed: %', sqlerrm;
    end;
  end;
end;
$$;

-- Runs only via pg_cron (as postgres) or a manual postgres call.
revoke execute on function run_loyalty_sweep_job() from public, anon, authenticated, service_role;

-- 03:30 UTC daily: clear of 01:00 / 01:15 / 02:00 and the 5/15-minute jobs'
-- boundaries. cron.schedule() upserts by name, safe across db resets.
select cron.schedule(
  'loyalty_sweep',
  '30 3 * * *',
  $$ select run_loyalty_sweep_job(); $$
);

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0107's discipline.
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.on_session_consumed(uuid, uuid, uuid)',
    'private.on_session_consumed_impl(uuid, uuid, uuid)',
    'private.award_renewal_stamp(uuid)',
    'private.award_renewal_stamp_impl(uuid)',
    'private.on_session_refunded_after_consumption(uuid, uuid, uuid)',
    'private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid)',
    'private.record_loyalty_hook_failure(text, uuid, uuid, text, uuid, text, text)',
    'public.run_loyalty_sweep_job()'
  ]
  loop
    if to_regprocedure(v_fn) is null then
      raise exception '0120: % missing', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0120: % must not be client-callable', v_fn;
    end if;
  end loop;

  if position('loyalty_events' in pg_get_functiondef(
       'private.on_session_refunded_after_consumption_impl(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception '0120: reversal body not installed';
  end if;

  if position('_impl' in pg_get_functiondef('private.on_session_consumed(uuid, uuid, uuid)'::regprocedure)) = 0
     or position('_impl' in pg_get_functiondef('private.award_renewal_stamp(uuid)'::regprocedure)) = 0 then
    raise exception '0120: earn hooks are not wrapped';
  end if;

  if not exists (select 1 from cron.job where jobname = 'loyalty_sweep') then
    raise exception '0120: loyalty_sweep is not scheduled';
  end if;
end;
$verify$;
