-- Rollback for migration 0146 (dashboard support request path).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0146-support-request-path.sql
-- Data effects: none (no table changes). Restores the 0135 claims hook (the fallback may pick a support gym again), the 0138 capability
-- roles (support no longer listed), the 0132 three-argument authorize_action and the 0065 gym read policy. Run only after the dashboard
-- and the edge function are rolled back first: they send p_session and call support_begin_session / list_own_support_gyms.
set local lock_timeout = '5s';

drop policy if exists support_read_own_gym on public.gyms;
delete from private.support_capabilities where kind = 'policy' and object_name = 'gyms.support_read_own_gym';

drop policy if exists "read gyms of own active memberships" on public.gyms;
create policy "read gyms of own active memberships" on public.gyms
  for select
  using (
    exists (
      select 1
      from members
      where members.gym_id = gyms.id
        and members.user_id = auth.uid()
        and members.deactivated_at is null
    )
  );

drop function if exists public.authorize_action(uuid, uuid, text, uuid);
drop function if exists private.authorize_action(uuid, uuid, text, uuid);

create or replace function private.capability_roles(p_capability text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_capability
    -- dashboard service paths
    when 'staff.create'                      then array['owner','supervisor']
    when 'member.provision'                  then array['owner','manager','supervisor','receptionist']
    when 'member.registration_fee_state'      then array['owner','manager','supervisor','receptionist']
    -- payment initiation at the edge, evaluated against the payment row's gym
    when 'payment.initiate_own'              then array['member']
    when 'payment.initiate_staff'            then array['owner','manager','supervisor','receptionist']
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


create or replace function private.authorize_action(p_actor uuid, p_gym_id uuid, p_capability text)
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
  -- billing.saas_pay is exempt for a SUSPENDED gym only: its Owner must still reach billing to pay the bill that lifts
  -- the suspension. A deactivated gym is refused (nothing a payment can do reactivates it: every SaaS payment function
  -- already raises for it, and only a Super Admin reinstates one). Every other gym capability is denied for any
  -- non-active gym. The coalesce makes a NULL status fail closed.
  if v_status is distinct from 'active'::gym_status
     and not (p_capability = 'billing.saas_pay' and coalesce(v_status = 'suspended'::gym_status, false)) then
    return query select false, 'gym_not_active'::text, v_role;
    return;
  end if;

  if v_role = any (v_roles) then
    return query select true, 'allowed'::text, v_role;
  else
    return query select false, 'role_not_permitted'::text, v_role;
  end if;
end;
$$;


revoke all on function private.authorize_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.authorize_action(uuid, uuid, text) to service_role;

create or replace function public.authorize_action(p_actor uuid, p_gym_id uuid, p_capability text)
returns table (allowed boolean, reason text, actor_role text)
language sql
stable
security definer
set search_path = public
as $$
  select * from private.authorize_action(p_actor, p_gym_id, p_capability);
$$;
revoke all on function public.authorize_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_action(uuid, uuid, text) to service_role;

drop function if exists private.support_live_for(uuid, uuid, uuid);
drop function if exists public.list_own_support_gyms();
drop function if exists public.support_begin_session();

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
      select m.gym_id, m.role
        into member_gym_id, member_role_value
        from public.members m
        where m.user_id = target_user_id
          and m.deactivated_at is null
          and (m.role <> 'support' or (session_aal = 'aal2' and exists (
                select 1 from public.support_assignments a
                 where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active')))
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
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
