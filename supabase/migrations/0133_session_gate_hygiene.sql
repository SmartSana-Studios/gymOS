-- Session-gate hygiene (Epic 22 retro items 81 and 83, found while writing the item 65 tests).
--
--   1. private.session_gate_touch: when the presented session does not belong to the caller, 0127 deleted the gate state row
--      by session_id ALONE, so a caller presenting someone else's session id would wipe that user's idle/age state (and
--      restart their timers). It is not reachable from the app, where the session id comes from the verified token, but the
--      database function should not rely on that. The delete is now scoped to the caller (and user_id = p_user).
--   2. private.support_session_state_purge + a nightly pg_cron job: rows for sessions that ended by sign-out (or any path other
--      than expiry) were never removed; there is no foreign key to auth.sessions. The job deletes the rows whose session
--      no longer exists. A handful of rows per Super Admin sign-in, so this is housekeeping, not an emergency.
--
-- Only the one delete changes in session_gate_touch; the rest is 0127's. Rollback: scripts/rollback-0133-session-gate-hygiene.sql.

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
    -- 0133: scoped to the caller. A session id that is not this user's must not touch another user's gate state
    -- (0127 deleted by session_id alone; not reachable from the app, where the id comes from the verified token).
    delete from private.support_session_state where session_id = p_session and user_id = p_user;
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

create or replace function private.support_session_state_purge()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from private.support_session_state s
   where not exists (select 1 from auth.sessions a where a.id = s.session_id);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function private.support_session_state_purge() from public, anon, authenticated;
grant execute on function private.support_session_state_purge() to service_role;

-- 03:15 UTC daily, as postgres; cron.schedule() upserts by name
select cron.schedule('support_session_state_purge', '15 3 * * *', $$ select private.support_session_state_purge(); $$);

do $verify$
begin
  if pg_get_functiondef('private.session_gate_touch(uuid, uuid)'::regprocedure) not like '%session_id = p_session and user_id = p_user%' then
    raise exception '0133: session_gate_touch is not scoped to the caller';
  end if;
  if to_regprocedure('private.support_session_state_purge()') is null then
    raise exception '0133: purge function missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'support_session_state_purge') then
    raise exception '0133: support_session_state_purge is not scheduled';
  end if;
  if has_function_privilege('anon', 'private.support_session_state_purge()', 'execute')
     or has_function_privilege('authenticated', 'private.support_session_state_purge()', 'execute')
     or has_function_privilege('anon', 'private.session_gate_touch(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.session_gate_touch(uuid, uuid)', 'execute') then
    raise exception '0133: the session-gate functions must stay service_role only';
  end if;
end
$verify$;
