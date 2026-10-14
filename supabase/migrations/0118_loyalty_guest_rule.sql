-- ============================================================================
-- 0118: Loyalty guest rule (Epic 20, Story 20.2).
--
-- Replaces the body of private.on_session_consumed(uuid, uuid, uuid), the no-op
-- hook 0111 left for this story. Nothing else changes: same signature, still
-- revoked from public/anon/authenticated, consume_guest_session(), check_in()
-- and mark_class_attendance() are untouched (class attendance earns through the
-- same hook).
--
-- Rule, all inside the consuming transaction:
--   * a consumed PAID session (payment_id) earns one guest stamp, only while
--     the gym has loyalty_enabled and charge_guests_per_session at consumption;
--   * idle reset first: counter > 0 and last stamp older than
--     platform_session_config.loyalty_idle_reset_days before consumed_at ->
--     one 'reset' event, counter zeroed, then the stamp;
--   * at counter >= N (also above a lowered N): one 'reward_granted' event, one
--     free guest_sessions row (loyalty_grant_id set, usable
--     free_session_validity_days from consumed_at), counter back to 0. Excess
--     above a lowered N is not carried over;
--   * a consumed FREE session (loyalty_grant_id) records one 'reward_consumed'
--     event whatever the switches say; it changes no counter and does not
--     extend the idle window. It writes no audit row of its own: the
--     session_consumed audit (0113, source free) already records the use;
--
-- Replay key: unique (origin_id, event_type) with origin_id = the session id.
-- An existing stamp_earned (paid) or reward_consumed (free) row for the session
-- means a replay: return and change nothing. reward_granted and reset share the
-- same origin_id under their own event_type, so each is also once per session.
--
-- Lock order (AD-27): the member row (FOR NO KEY UPDATE) and the consumed
-- guest_sessions row are already held by consume_guest_session(); the
-- loyalty_progress row is locked last (FOR UPDATE). Nothing earlier in the
-- canonical order is taken here.
--
-- For 20.4's sweep: a 'reset' event written here has origin_id = the session id
-- and details.previous_count / details.previous_last_event_at. The sweep must
-- use its own origin ids (not session ids) for sweep resets, and may treat a
-- reset event dated at or after a counter's last_event_at as already persisted.
-- This hook never reads the idle window at read time; effective_loyalty() does.
--
-- Event/progress timestamps (occurred_at, guest_last_event_at, usable_until)
-- come from the session's consumed_at, not now(), so replays and tests are
-- deterministic; on live paths the two are equal.
--
-- SECURITY INVOKER like 0111: it runs inside the definer check_in() /
-- mark_class_attendance() chain, which owns the ledger tables.
--
-- Rollback: scripts/rollback-0118-loyalty-guest-rule.sql
-- ============================================================================

create or replace function private.on_session_consumed(p_session_id uuid, p_member_id uuid, p_gym_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_s guest_sessions%rowtype;
  v_gym gyms%rowtype;
  v_cfg platform_session_config%rowtype;
  v_progress loyalty_progress%rowtype;
  v_event_id uuid;
  v_stamps integer;
  v_grant_id uuid;
begin
  select * into v_s from guest_sessions s where s.id = p_session_id;

  -- Defensive: only a consumed session of this member and gym earns anything.
  if not found
     or v_s.consumed_at is null
     or v_s.member_id is distinct from p_member_id
     or v_s.gym_id is distinct from p_gym_id then
    return;
  end if;

  -- Free session consumed: ledger record only.
  if v_s.loyalty_grant_id is not null then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (p_gym_id, p_member_id, 'reward_consumed', 'guest', p_session_id, v_s.consumed_at,
            jsonb_build_object('guest_session_id', p_session_id, 'loyalty_grant_id', v_s.loyalty_grant_id))
    on conflict (origin_id, event_type) do nothing;
    return;
  end if;

  if v_s.payment_id is null then
    return;
  end if;

  select * into v_gym from gyms g where g.id = p_gym_id;

  if not coalesce(v_gym.loyalty_enabled, false)
     or not coalesce(v_gym.charge_guests_per_session, false)
     or v_gym.loyalty_guest_threshold is null then
    return;
  end if;

  select * into v_cfg from platform_session_config c limit 1;

  -- Progress row on first use; locked last in the canonical order.
  insert into loyalty_progress (gym_id, member_id)
  values (p_gym_id, p_member_id)
  on conflict (gym_id, member_id) do nothing;

  select * into v_progress
  from loyalty_progress lp
  where lp.gym_id = p_gym_id and lp.member_id = p_member_id
  for update;

  -- Replay: this session already earned its stamp. Checked after the progress
  -- lock so a concurrent duplicate cannot pass before the first one commits.
  if exists (
    select 1 from loyalty_events e
    where e.origin_id = p_session_id and e.event_type = 'stamp_earned'
  ) then
    return;
  end if;

  v_stamps := v_progress.guest_stamps;

  -- Idle reset first.
  if v_stamps > 0
     and v_progress.guest_last_event_at is not null
     and v_progress.guest_last_event_at < v_s.consumed_at - make_interval(days => v_cfg.loyalty_idle_reset_days) then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (p_gym_id, p_member_id, 'reset', 'guest', p_session_id, v_s.consumed_at,
            jsonb_build_object(
              'previous_count', v_stamps,
              'previous_last_event_at', v_progress.guest_last_event_at,
              'idle_reset_days', v_cfg.loyalty_idle_reset_days))
    on conflict (origin_id, event_type) do nothing;

    perform log_audit_event(
      p_action_type => 'loyalty_progress_reset',
      p_gym_id => p_gym_id,
      p_target_entity_id => p_member_id::text,
      p_target_entity_type => 'member',
      p_metadata => jsonb_build_object(
        'counter', 'guest',
        'guest_session_id', p_session_id,
        'previous_count', v_stamps,
        'previous_last_event_at', v_progress.guest_last_event_at,
        'idle_reset_days', v_cfg.loyalty_idle_reset_days
      )
    );

    v_stamps := 0;
  end if;

  -- Stamp.
  v_stamps := v_stamps + 1;

  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
  values (p_gym_id, p_member_id, 'stamp_earned', 'guest', p_session_id, v_s.consumed_at,
          jsonb_build_object('guest_session_id', p_session_id, 'stamps_after', v_stamps));

  perform log_audit_event(
    p_action_type => 'loyalty_stamp_earned',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_member_id::text,
    p_target_entity_type => 'member',
    p_metadata => jsonb_build_object(
      'counter', 'guest',
      'guest_session_id', p_session_id,
      'stamps', v_stamps,
      'threshold', v_gym.loyalty_guest_threshold
    )
  );

  -- Reward at N (also above a lowered N); the counter returns to 0.
  if v_stamps >= v_gym.loyalty_guest_threshold then
    insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id, occurred_at, details)
    values (p_gym_id, p_member_id, 'reward_granted', 'guest', p_session_id, v_s.consumed_at,
            jsonb_build_object('guest_session_id', p_session_id, 'stamps', v_stamps,
                               'threshold', v_gym.loyalty_guest_threshold))
    on conflict (origin_id, event_type) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
      values (p_gym_id, p_member_id, v_event_id,
              v_s.consumed_at + make_interval(days => v_cfg.free_session_validity_days))
      returning id into v_grant_id;

      perform log_audit_event(
        p_action_type => 'loyalty_reward_granted',
        p_gym_id => p_gym_id,
        p_target_entity_id => p_member_id::text,
        p_target_entity_type => 'member',
        p_metadata => jsonb_build_object(
          'counter', 'guest',
          'guest_session_id', p_session_id,
          'free_session_id', v_grant_id,
          'stamps', v_stamps,
          'threshold', v_gym.loyalty_guest_threshold,
          'usable_until', v_s.consumed_at + make_interval(days => v_cfg.free_session_validity_days)
        )
      );
    end if;

    v_stamps := 0;
  end if;

  update loyalty_progress
  set guest_stamps = v_stamps,
      guest_last_event_at = v_s.consumed_at
  where gym_id = p_gym_id and member_id = p_member_id;
end;
$$;

revoke execute on function private.on_session_consumed(uuid, uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0107's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if to_regprocedure('private.on_session_consumed(uuid, uuid, uuid)') is null then
    raise exception '0118: on_session_consumed missing';
  end if;

  if has_function_privilege('anon', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.on_session_consumed(uuid, uuid, uuid)', 'execute') then
    raise exception '0118: on_session_consumed must not be client-callable';
  end if;

  if (select prosecdef from pg_proc where oid = 'private.on_session_consumed(uuid, uuid, uuid)'::regprocedure) then
    raise exception '0118: on_session_consumed must stay SECURITY INVOKER';
  end if;

  if position('loyalty_events' in pg_get_functiondef('private.on_session_consumed(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception '0118: on_session_consumed body not replaced';
  end if;
end;
$verify$;
