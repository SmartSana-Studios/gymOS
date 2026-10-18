-- Story 22.4: one shared live authorization decision for service-role code paths.
--
-- Edge functions (Deno) and the Next.js server (Node) hold the service-role key and cannot
-- evaluate RLS. They used to authorize their caller from a token claim, from the request body,
-- or not at all. private.authorize_action(actor, gym, capability) takes the actor EXPLICITLY
-- (a verified session's user id, never a claim) and loads membership, role, deactivation and gym
-- state from the database, returning allow or a typed deny. One SQL definition serves both
-- runtimes so decisions cannot diverge. public.authorize_action is the PostgREST entry point
-- (the private schema is not exposed); it is granted to service_role only.
--
-- Additive: no change to RLS or the 0124 helpers. Rollback:
-- scripts/rollback-0125-authorize-action.sql.

-- capability -> allowed roles. The single place the allow-list lives. NULL = unknown capability.
-- 'platform.*' capabilities are Super Admin only (no gym membership involved).
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
    else null
  end;
$$;

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
  -- billing.saas_pay is exempt: a suspended gym's Owner must still reach billing to pay the bill
  -- that lifts the suspension. Every other gym capability is denied for a suspended gym.
  if p_capability <> 'billing.saas_pay' and v_status is distinct from 'active'::gym_status then
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

revoke all on function private.capability_roles(text) from public, anon, authenticated;
revoke all on function private.authorize_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.capability_roles(text) to service_role;
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
