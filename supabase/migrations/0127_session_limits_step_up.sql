-- Story 22.7: Super Admin session limits, step-up and wrong-code lockout.
--
-- Everything here applies only while private.platform_flags('super_admin_aal2') is on. With the
-- flag off every function is a no-op that writes nothing, and the 0126 helpers behave as before.
--
--   support_session_state  one row per Super Admin session: started_at, last_seen_at
--   support_stepup         single-use, action- and subject-bound TOTP step-up grant (5 min)
--   session_limits_config  the ONLY place the limits and the lockout threshold live
--   super_admin_lockout    application counter of wrong step-up codes, and the lock itself
--
-- The names support_* are shared with Epic 23 (support reuses the same objects). Step-up is keyed to
-- the user, never reads amr, and is verified server-side by the app BEFORE private.stepup_issue.
-- Rollback: scripts/rollback-0127-session-limits-step-up.sql.

create table if not exists private.session_limits_config (
  key        text primary key,
  value      integer not null check (value > 0),
  note       text not null
);
alter table private.session_limits_config enable row level security;
revoke all on private.session_limits_config from public, anon, authenticated;

insert into private.session_limits_config (key, value, note) values
  ('absolute_session_minutes',  480, '[ASSUMPTION] Super Admin absolute session age: 8 hours'),
  ('idle_minutes',               30, '[ASSUMPTION] Super Admin idle limit: 30 minutes'),
  ('stepup_ttl_minutes',          5, '[ASSUMPTION] step-up grant lifetime: 5 minutes'),
  ('stepup_failure_threshold',    5, '[ASSUMPTION] wrong step-up codes before the account locks')
on conflict (key) do nothing;

create table if not exists private.support_session_state (
  session_id   uuid primary key,
  user_id      uuid not null,
  started_at   timestamptz not null,
  last_seen_at timestamptz not null
);
create index if not exists support_session_state_user_idx on private.support_session_state (user_id);
alter table private.support_session_state enable row level security;
revoke all on private.support_session_state from public, anon, authenticated;

-- subject_id is text: a factor uuid for factor removal, a normalized email for Super Admin creation.
create table if not exists private.support_stepup (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  action      text not null,
  subject_id  text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists support_stepup_lookup_idx on private.support_stepup (user_id, action, subject_id);
alter table private.support_stepup enable row level security;
revoke all on private.support_stepup from public, anon, authenticated;

create table if not exists private.super_admin_lockout (
  user_id      uuid primary key,
  failed_count integer not null default 0,
  locked_at    timestamptz
);
alter table private.super_admin_lockout enable row level security;
revoke all on private.super_admin_lockout from public, anon, authenticated;

-- The single reader of the limits table.
create or replace function private.session_limit(p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select c.value from private.session_limits_config c where c.key = p_key;
$$;
revoke all on function private.session_limit(text) from public, anon, authenticated;
grant execute on function private.session_limit(text) to service_role;

create or replace function private.super_admin_locked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select l.locked_at is not null from private.super_admin_lockout l where l.user_id = p_user), false);
$$;
revoke all on function private.super_admin_locked(uuid) from public, anon, authenticated;
grant execute on function private.super_admin_locked(uuid) to service_role;

-- True when the JWT's session_id is still a row in auth.sessions for the caller (22.1 finding:
-- PostgREST accepts an old access token after its session row is deleted). Fails closed.
create or replace function private.jwt_session_alive()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_sid is null or auth.uid() is null then
    return false;
  end if;
  return exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = auth.uid());
exception when others then
  return false;
end;
$$;
revoke all on function private.jwt_session_alive() from public, anon;
grant execute on function private.jwt_session_alive() to authenticated, service_role;

-- 0126 bodies plus: while the flag is on, the session row must still exist and the account must not
-- be locked.
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() #>> '{app_role}') = 'super_admin', false)
     and coalesce((select u.is_super_admin from users u where u.id = auth.uid()), false)
     and (
       not private.super_admin_aal2_required()
       or (
         coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
         and private.jwt_session_alive()
         and not private.super_admin_locked(auth.uid())
       )
     );
$$;

create or replace function private.is_super_admin_live()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_super_admin from users where id = auth.uid()), false)
     and (
       not private.super_admin_aal2_required()
       or (
         coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
         and private.jwt_session_alive()
         and not private.super_admin_locked(auth.uid())
       )
     );
$$;
revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated, service_role;
revoke all on function private.is_super_admin_live() from public, anon;
grant execute on function private.is_super_admin_live() to authenticated, service_role;

-- Ends every session of a user and clears its session state. Does not touch step-up grants.
create or replace function private.end_user_sessions(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from private.support_session_state where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
end;
$$;
revoke all on function private.end_user_sessions(uuid) from public, anon, authenticated;
grant execute on function private.end_user_sessions(uuid) to service_role;

-- Write side of the gate. VOLATILE. Limit breaches and locks come back as a result row (never
-- raised) so the session deletion commits. Flag off: ok, nothing written.
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

-- Issue a step-up grant. The caller (service role, after verifying a fresh TOTP server-side) names the
-- user, action and subject. Returns the expiry, or NULL when the flag is off / the account is locked.
create or replace function private.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_subject is null or p_action is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_action not in ('remove_super_admin_factor', 'create_super_admin') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not private.super_admin_aal2_required() or private.super_admin_locked(p_user) then
    return null;
  end if;

  delete from private.support_stepup
   where user_id = p_user and (consumed_at is not null or expires_at <= now());
  -- one live grant per (user, action, subject): a re-issue replaces, never doubles, the uses
  delete from private.support_stepup
   where user_id = p_user and action = p_action and subject_id = p_subject and consumed_at is null;
  v_expires := now() + make_interval(mins => private.session_limit('stepup_ttl_minutes'));
  insert into private.support_stepup (user_id, action, subject_id, expires_at)
  values (p_user, p_action, p_subject, v_expires);

  -- a successful code clears the wrong-code counter
  update private.super_admin_lockout set failed_count = 0 where user_id = p_user and locked_at is null;
  return v_expires;
end;
$$;

-- Atomic single use. Flag off: true with no write (step-up is not required).
create or replace function private.stepup_consume(p_user uuid, p_action text, p_subject text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not private.super_admin_aal2_required() then
    return true;
  end if;
  if p_user is null or p_action is null or p_subject is null then
    return false;
  end if;
  update private.support_stepup
     set consumed_at = now()
   where id = (
     select s.id from private.support_stepup s
      where s.user_id = p_user and s.action = p_action and s.subject_id = p_subject
        and s.consumed_at is null and s.expires_at > now()
      order by s.expires_at desc
      limit 1
      for update skip locked
   )
     and consumed_at is null and expires_at > now()
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- Count one wrong step-up code (counts only, never a code). At the threshold the account is locked,
-- its sessions removed and the fact audited; returned as a row so it commits.
create or replace function private.stepup_record_failure(p_user uuid)
returns table (locked boolean, attempts integer, threshold integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_threshold integer := private.session_limit('stepup_failure_threshold');
  v_count integer;
  v_locked boolean := false;
begin
  if p_user is null or not private.super_admin_aal2_required()
     or not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select false, 0, v_threshold;
    return;
  end if;

  insert into private.super_admin_lockout (user_id, failed_count) values (p_user, 1)
  on conflict (user_id) do update set failed_count = private.super_admin_lockout.failed_count + 1
  returning failed_count, (locked_at is not null) into v_count, v_locked;

  insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
  values (null, null, 'system:step_up', 'super_admin_stepup_failed', 'user', p_user::text,
          jsonb_build_object('attempts', v_count, 'threshold', v_threshold));

  if not v_locked and v_count >= v_threshold then
    update private.super_admin_lockout set locked_at = now() where user_id = p_user;
    perform private.end_user_sessions(p_user);
    insert into audit_log (gym_id, actor_id, actor_display_name, action_type, target_entity_type, target_entity_id, metadata)
    values (null, null, 'system:step_up', 'super_admin_locked', 'user', p_user::text,
            jsonb_build_object('attempts', v_count, 'threshold', v_threshold));
    v_locked := true;
  end if;
  return query select v_locked, v_count, v_threshold;
end;
$$;

revoke all on function private.session_gate_touch(uuid, uuid) from public, anon, authenticated;
revoke all on function private.stepup_issue(uuid, text, text) from public, anon, authenticated;
revoke all on function private.stepup_consume(uuid, text, text) from public, anon, authenticated;
revoke all on function private.stepup_record_failure(uuid) from public, anon, authenticated;
grant execute on function private.session_gate_touch(uuid, uuid) to service_role;
grant execute on function private.stepup_issue(uuid, text, text) to service_role;
grant execute on function private.stepup_consume(uuid, text, text) to service_role;
grant execute on function private.stepup_record_failure(uuid) to service_role;

-- PostgREST entry points (the private schema is not exposed): service_role only.
create or replace function public.session_gate_touch(p_user uuid, p_session uuid)
returns table (ok boolean, reason text)
language sql volatile security definer set search_path = public
as $$ select * from private.session_gate_touch(p_user, p_session); $$;

create or replace function public.stepup_issue(p_user uuid, p_action text, p_subject text)
returns timestamptz
language sql volatile security definer set search_path = public
as $$ select private.stepup_issue(p_user, p_action, p_subject); $$;

create or replace function public.stepup_consume(p_user uuid, p_action text, p_subject text)
returns boolean
language sql volatile security definer set search_path = public
as $$ select private.stepup_consume(p_user, p_action, p_subject); $$;

create or replace function public.stepup_record_failure(p_user uuid)
returns table (locked boolean, attempts integer, threshold integer)
language sql volatile security definer set search_path = public
as $$ select * from private.stepup_record_failure(p_user); $$;

revoke all on function public.session_gate_touch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.stepup_issue(uuid, text, text) from public, anon, authenticated;
revoke all on function public.stepup_consume(uuid, text, text) from public, anon, authenticated;
revoke all on function public.stepup_record_failure(uuid) from public, anon, authenticated;
grant execute on function public.session_gate_touch(uuid, uuid) to service_role;
grant execute on function public.stepup_issue(uuid, text, text) to service_role;
grant execute on function public.stepup_consume(uuid, text, text) to service_role;
grant execute on function public.stepup_record_failure(uuid) to service_role;
