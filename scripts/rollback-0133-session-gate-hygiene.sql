-- Rollback for migration 0133 (session-gate hygiene): restores 0127's session_gate_touch and removes the purge job and function.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0133-session-gate-hygiene.sql
set local lock_timeout = '5s';

select cron.unschedule('support_session_state_purge') where exists (select 1 from cron.job where jobname = 'support_session_state_purge');
drop function if exists private.support_session_state_purge();

create or replace function private.session_gate_touch(p_user uuid, p_session uuid)
returns table (ok boolean, reason text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_created timestamptz;
  v_started timestamptz;
  v_seen    timestamptz;
begin
  if not private.super_admin_aal2_required() then
    return query select true, 'ok'::text;
    return;
  end if;
  if p_user is null or p_session is null then
    return query select false, 'no_session'::text;
    return;
  end if;
  -- Only Super Admins carry these limits; anyone else is decided by authorize_action.
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select true, 'ok'::text;
    return;
  end if;

  if private.super_admin_locked(p_user) then
    perform private.end_user_sessions(p_user);
    return query select false, 'locked'::text;
    return;
  end if;

  select s.created_at into v_created from auth.sessions s where s.id = p_session and s.user_id = p_user;
  if not found then
    delete from private.support_session_state where session_id = p_session;
    return query select false, 'session_expired'::text;
    return;
  end if;

  insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
  values (p_session, p_user, coalesce(v_created, now()), now())
  on conflict (session_id) do nothing;

  select st.started_at, st.last_seen_at into v_started, v_seen
  from private.support_session_state st where st.session_id = p_session and st.user_id = p_user;
  if not found then
    return query select false, 'session_expired'::text;
    return;
  end if;

  if v_started < now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
     or v_seen < now() - make_interval(mins => private.session_limit('idle_minutes')) then
    delete from private.support_session_state where session_id = p_session;
    delete from auth.sessions where id = p_session and user_id = p_user;
    insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
    values (null, null, 'system:session_limits', 'super_admin_session_expired', 'user', p_user::text,
            jsonb_build_object('reason', case when v_started < now() - make_interval(mins => private.session_limit('absolute_session_minutes')) then 'absolute' else 'idle' end));
    return query select false, 'session_expired'::text;
    return;
  end if;

  update private.support_session_state set last_seen_at = now() where session_id = p_session;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function private.session_gate_touch(uuid, uuid) from public, anon, authenticated;
grant execute on function private.session_gate_touch(uuid, uuid) to service_role;
