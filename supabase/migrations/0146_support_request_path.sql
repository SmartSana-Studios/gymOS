-- Story 23-6b: the dashboard request path for GymOS support (FR-178, FR-179, AD-33).
--
-- 23.1 and 23.6 built the live gate and the allow-list but no support session could use them: the dashboard never asked for the
-- authenticator code, never called session_gate_touch, picked a gym by itself and did not admit the role. This migration is the
-- database half of the fix (the dashboard half ships with it).
--
--   * custom_access_token_hook   the fallback query (no preferred gym) never resolves a support row: a support person has no default
--                                gym. Only an explicit active_gym_id (set by the picker's switch_active_gym) puts a support gym in the JWT.
--   * support_begin_session()    called by the dashboard right after the authenticator code is verified: clears users.active_gym_id for a
--                                person with a support assignment, so the next token carries no gym until the picker sets one.
--   * list_own_support_gyms()    the picker's list: the caller's ACTIVE assignments on gyms with the switch on and status active. aal2 only.
--   * private.support_live_for(user, gym, session)  the same checks as support_live, for a service-role caller that has no JWT of the
--                                person: the session is named explicitly and its level (aal) is read from auth.sessions.
--   * authorize_action(..., p_session default null)  a support actor is allowed only when the capability lists support AND support_live_for
--                                holds for the session; the Node apps and the edge function pass the session id from the verified token.
--   * capability_roles           staff.create, member.provision, member.registration_fee_state and payment.initiate_staff list support.
--   * gyms policies              "read gyms of own active memberships" no longer admits a support membership (a stale row would read the gym
--                                with no live check); support_read_own_gym reads the gym through private.support_gym_id() (live gate) only.
--
-- Does NOT change the gate (support_live, session_gate_touch), enable support for any gym, or add step-up UI (23-6c).
-- Rollback: scripts/rollback-0146-support-request-path.sql.
set local lock_timeout = '5s';

-- ===== 1. claims hook: no default gym for support =====
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
          and (m.role <> 'support' or (session_aal = 'aal2' and exists (
                select 1 from public.support_assignments a
                 where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active')))
        limit 1;
    end if;

    if member_gym_id is null then
      -- Story 23-6b: the fallback never picks a support gym. A support request acts on exactly one EXPLICIT gym.
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.deactivated_at is null
          and m.role <> 'support'
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

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- ===== 2. begin a support session: forget the previous gym =====
create or replace function public.support_begin_session()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'support_begin_session: a verified second factor is required' using errcode = 'P0001';
  end if;
  -- Only a person with a support assignment is touched; nobody else holds a factor on the dashboard.
  if exists (select 1 from public.support_assignments a where a.support_user_id = auth.uid() and a.state <> 'ended') then
    update public.users set active_gym_id = null where id = auth.uid() and active_gym_id is not null;
  end if;
end;
$$;
revoke all on function public.support_begin_session() from public, anon;
grant execute on function public.support_begin_session() to authenticated;

-- ===== 3. the picker's list =====
create or replace function public.list_own_support_gyms()
returns table (gym_id uuid, gym_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.gym_id, g.name
    from public.support_assignments a
    join public.gyms g on g.id = a.gym_id
   where auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and a.support_user_id = auth.uid()
     and a.state = 'active'
     and g.allow_gymos_support
     and g.status = 'active'
   order by g.name, a.gym_id;
$$;
revoke all on function public.list_own_support_gyms() from public, anon;
grant execute on function public.list_own_support_gyms() to authenticated;

-- ===== 4. the live gate for a caller that has no JWT of the person =====
-- Same legs as private.support_live (0145), except that the session is passed in and its level is read from auth.sessions: a service-role
-- authorize_action call carries no user JWT. The session must belong to the person, exist, be unexpired and be aal2.
create or replace function private.support_live_for(p_user uuid, p_gym uuid, p_session uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user is null or p_gym is null or p_session is null then
    return false;
  end if;
  if not exists (
    select 1 from auth.sessions s
     where s.id = p_session and s.user_id = p_user and s.aal = 'aal2'
       and (s.not_after is null or s.not_after > now())
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.support_assignments a
      join public.gyms g on g.id = a.gym_id
      join private.support_accounts sa on sa.user_id = a.support_user_id
      join private.support_session_state st on st.session_id = p_session and st.user_id = a.support_user_id
     where a.support_user_id = p_user
       and a.gym_id = p_gym
       and a.state = 'active'
       and g.allow_gymos_support
       and g.status = 'active'
       and sa.activated_at is not null
       and sa.locked_at is null
       and sa.reset_pending_at is null
       and sa.recertify_due_at > now()
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live_for(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live_for(uuid, uuid, uuid) to service_role;

-- ===== 5. capability roles: support for the four service-path capabilities =====
create or replace function private.capability_roles(p_capability text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_capability
    -- dashboard service paths
    when 'staff.create'                      then array['owner','supervisor','support']
    when 'member.provision'                  then array['owner','manager','supervisor','receptionist','support']
    when 'member.registration_fee_state'      then array['owner','manager','supervisor','receptionist','support']
    -- payment initiation at the edge, evaluated against the payment row's gym
    when 'payment.initiate_own'              then array['member']
    when 'payment.initiate_staff'            then array['owner','manager','supervisor','receptionist','support']
    when 'billing.saas_pay'                  then array['owner']
    -- platform (Super Admin app)
    when 'platform.admin_access'             then array['super_admin']
    when 'platform.gym_create'               then array['super_admin']
    when 'platform.billing_retry'            then array['super_admin']
    when 'platform.super_admin_manage'       then array['super_admin']
    when 'platform.support_manage'           then array['super_admin']
    else null
  end;
$$;
revoke all on function private.capability_roles(text) from public, anon, authenticated;
grant execute on function private.capability_roles(text) to service_role;

-- ===== 6. authorize_action with an optional session =====
drop function if exists public.authorize_action(uuid, uuid, text);
drop function if exists private.authorize_action(uuid, uuid, text);

create or replace function private.authorize_action(p_actor uuid, p_gym_id uuid, p_capability text, p_session uuid default null)
returns table (allowed boolean, reason text, actor_role text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles text[];
  v_role text;
  v_status gym_status;
begin
  -- fail closed on every NULL: no actor, unknown capability.
  if p_actor is null then
    return query select false, 'no_actor'::text, null::text;
    return;
  end if;

  v_roles := private.capability_roles(p_capability);
  if v_roles is null then
    return query select false, 'unknown_capability'::text, null::text;
    return;
  end if;

  -- platform capabilities: live users.is_super_admin only.
  if v_roles = array['super_admin'] then
    if coalesce((select u.is_super_admin from users u where u.id = p_actor), false) then
      return query select true, 'allowed'::text, 'super_admin'::text;
    else
      return query select false, 'not_super_admin'::text, null::text;
    end if;
    return;
  end if;

  if p_gym_id is null then
    return query select false, 'no_gym'::text, null::text;
    return;
  end if;

  select m.role::text into v_role
  from members m
  where m.user_id = p_actor
    and m.gym_id = p_gym_id
    and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_role is null then
    if exists (select 1 from members m where m.user_id = p_actor and m.gym_id = p_gym_id) then
      return query select false, 'deactivated'::text, null::text;
    else
      return query select false, 'not_member'::text, null::text;
    end if;
    return;
  end if;

  select g.status into v_status from gyms g where g.id = p_gym_id;
  -- billing.saas_pay is exempt for a SUSPENDED gym only (0132). Every other gym capability is denied for any non-active gym.
  if v_status is distinct from 'active'::gym_status
     and not (p_capability = 'billing.saas_pay' and coalesce(v_status = 'suspended'::gym_status, false)) then
    return query select false, 'gym_not_active'::text, v_role;
    return;
  end if;

  -- Story 23-6b: a support actor needs the capability to list support AND a live gate for the session it presents.
  if v_role = 'support' then
    if not ('support' = any (v_roles)) then
      return query select false, 'role_not_permitted'::text, v_role;
    elsif p_session is null or not private.support_live_for(p_actor, p_gym_id, p_session) then
      return query select false, 'support_not_live'::text, v_role;
    else
      return query select true, 'allowed'::text, v_role;
    end if;
    return;
  end if;

  if v_role = any (v_roles) then
    return query select true, 'allowed'::text, v_role;
  else
    return query select false, 'role_not_permitted'::text, v_role;
  end if;
end;
$$;
revoke all on function private.authorize_action(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function private.authorize_action(uuid, uuid, text, uuid) to service_role;

create or replace function public.authorize_action(p_actor uuid, p_gym_id uuid, p_capability text, p_session uuid default null)
returns table (allowed boolean, reason text, actor_role text)
language sql
stable
security definer
set search_path = public
as $$
  select * from private.authorize_action(p_actor, p_gym_id, p_capability, p_session);
$$;
revoke all on function public.authorize_action(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.authorize_action(uuid, uuid, text, uuid) to service_role;

-- ===== 7. gyms read policies =====
-- A support membership no longer reads the gym through the old "own active memberships" policy (a stale row would read it with no live
-- check); support reads the gym through the live gate only.
drop policy if exists "read gyms of own active memberships" on public.gyms;
create policy "read gyms of own active memberships" on public.gyms
  for select
  using (
    exists (
      select 1
      from public.members
      where members.gym_id = gyms.id
        and members.user_id = auth.uid()
        and members.deactivated_at is null
        and members.role <> 'support'
    )
  );

create policy support_read_own_gym on public.gyms for select
  using (id = (select private.support_gym_id()));

insert into private.support_capabilities (capability, kind, object_name) values
  ('gym_profile', 'policy', 'gyms.support_read_own_gym');

do $verify$
begin
  if has_function_privilege('anon', 'public.support_begin_session()', 'execute')
     or has_function_privilege('anon', 'public.list_own_support_gyms()', 'execute')
     or has_function_privilege('anon', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.authorize_action(uuid, uuid, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.support_live_for(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'private.support_live_for(uuid, uuid, uuid)', 'execute') then
    raise exception '0146: a request-path function is reachable by the wrong role';
  end if;
  if not has_function_privilege('authenticated', 'public.support_begin_session()', 'execute')
     or not has_function_privilege('authenticated', 'public.list_own_support_gyms()', 'execute')
     or not has_function_privilege('service_role', 'public.authorize_action(uuid, uuid, text, uuid)', 'execute') then
    raise exception '0146: a request-path function is not callable by its role';
  end if;
  if not ('support' = any (private.capability_roles('staff.create')))
     or not ('support' = any (private.capability_roles('member.provision')))
     or not ('support' = any (private.capability_roles('member.registration_fee_state')))
     or not ('support' = any (private.capability_roles('payment.initiate_staff')))
     or 'support' = any (private.capability_roles('billing.saas_pay'))
     or 'support' = any (private.capability_roles('payment.initiate_own')) then
    raise exception '0146: capability_roles does not list support exactly for the four capabilities';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
              and p.proname = 'authorize_action' and pronargs = 3) then
    raise exception '0146: the 3-argument authorize_action still exists';
  end if;
end
$verify$;
