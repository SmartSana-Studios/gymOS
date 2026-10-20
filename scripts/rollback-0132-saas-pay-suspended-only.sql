-- Rollback for migration 0132 (billing.saas_pay suspended-only): restores the 0125 authorize_action, which exempts
-- billing.saas_pay from the gym-status check for every non-active status.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0132-saas-pay-suspended-only.sql
set local lock_timeout = '5s';

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

revoke all on function private.authorize_action(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.authorize_action(uuid, uuid, text) to service_role;
