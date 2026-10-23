-- Rollback for migration 0135 (support role, assignment record, live gate).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0135-support-assignments-live-gate.sql
-- Removes every support row and object, restoring the 0124 / 0061 / 0129 / 0065 / 0074 / 0133 function bodies.
-- The enum value from 0134 stays (see scripts/rollback-0134-member-role-support.sql).
set local lock_timeout = '5s';

-- Restore the previous function bodies first so nothing references the support objects.

create or replace function private.gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.gym_id
  from members m
  where m.user_id = auth.uid()
    and m.deactivated_at is null
    and m.gym_id = (
      case
        when (auth.jwt() ->> 'gym_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (auth.jwt() ->> 'gym_id')::uuid
      end)
  limit 1;
$$;

create or replace function private.current_member_role()
returns member_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role member_role;
begin
  select role into v_role
  from members
  where user_id = auth.uid()
    and gym_id = private.gym_id()
    and deactivated_at is null
  order by created_at desc, id desc
  limit 1;

  return v_role;
end;
$$;

create or replace function switch_active_gym(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from members
    where user_id = auth.uid()
      and gym_id = p_gym_id
      and deactivated_at is null
  ) then
    raise exception 'switch_active_gym: caller has no active membership at target gym';
  end if;

  update users set active_gym_id = p_gym_id where id = auth.uid();
end;
$$;

create or replace function list_own_active_gym_memberships()
returns table(gym_id uuid, gym_name text, role member_role)
language sql
stable
security definer
set search_path = public
as $$
  select m.gym_id, g.name, m.role
  from members m
  join gyms g on g.id = m.gym_id
  where m.user_id = auth.uid()
    and m.deactivated_at is null;
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  target_user_id uuid;
  is_super boolean;
  member_gym_id uuid;
  member_role_value member_role;
  preferred_gym_id uuid;
  session_aal text;
begin
  if event is null then
    return jsonb_build_object('claims', '{}'::jsonb);
  end if;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := (claims - 'gym_id') - 'app_role';
  target_user_id := (event->>'user_id')::uuid;
  session_aal := coalesce(event->'claims'->>'aal', 'aal1');

  select u.is_super_admin, u.active_gym_id into is_super, preferred_gym_id
  from public.users u
  where u.id = target_user_id;

  is_super := coalesce(is_super, false);

  if is_super then
    if (not private.super_admin_aal2_required()) or session_aal = 'aal2' then
      claims := jsonb_set(claims, '{app_role}', to_jsonb('super_admin'::text));
    end if;
    -- else: flag on and below aal2: no super_admin claim, no gym claims (fail closed).
  else
    if preferred_gym_id is not null then
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.gym_id = preferred_gym_id
          and m.deactivated_at is null
        limit 1;
    end if;

    if member_gym_id is null then
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.deactivated_at is null
        order by m.created_at desc, m.id desc
        limit 1;
    end if;

    if member_gym_id is not null then
      claims := jsonb_set(claims, '{gym_id}', to_jsonb(member_gym_id));
      claims := jsonb_set(claims, '{app_role}', to_jsonb(member_role_value::text));
    end if;
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
exception
  when others then
    raise warning 'custom_access_token_hook failed for user %: %', target_user_id, sqlerrm;
    -- Fail closed: never hand back an event that still carries a role or gym claim (Story 22 retro item 55).
    return jsonb_set(event, '{claims}', (coalesce(event->'claims', '{}'::jsonb) - 'gym_id') - 'app_role');
end;
$$;

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

-- Remove the support objects.
delete from members where role = 'support';
drop trigger if exists guard_support_membership on public.members;
drop function if exists private.guard_support_membership();
drop function if exists private.support_set_membership(uuid, boolean);
drop function if exists private.support_gym_id();
drop function if exists private.support_live(uuid, uuid);
drop trigger if exists guard_allow_gymos_support on public.gyms;
drop function if exists private.guard_allow_gymos_support();
alter table public.gyms drop column if exists allow_gymos_support;
drop table if exists private.support_accounts;
drop table if exists public.support_assignments;
