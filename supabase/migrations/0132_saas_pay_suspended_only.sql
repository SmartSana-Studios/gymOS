-- billing.saas_pay is exempt from the gym-status check for a SUSPENDED gym only (Epic 22 retro item 62, finding F9).
--
-- 0125 exempted billing.saas_pay for every non-active status, so the Owner of a DEACTIVATED gym passed authorize_action and was
-- only stopped later by the payment functions. Nothing a payment does reactivates a deactivated gym (checked 2026-10-20: the
-- initiate / out-of-band / credit functions raise for it, and every update that sets status 'active' carries
-- "and status <> 'deactivated'"; only a Super Admin reinstates one), so refusing it here reverses no working flow: it moves
-- the refusal to the decision, with reason gym_not_active, ahead of the payment function.
--
-- Only the status condition changes; the rest of the function is 0125's. Rollback: scripts/rollback-0132-saas-pay-suspended-only.sql.

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

do $verify$
begin
  if pg_get_functiondef('private.authorize_action(uuid, uuid, text)'::regprocedure) not like '%suspended%gym_status%' then
    raise exception '0132: authorize_action does not carry the suspended-only exemption';
  end if;
  if has_function_privilege('anon', 'private.authorize_action(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'private.authorize_action(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.authorize_action(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.authorize_action(uuid, uuid, text)', 'execute') then
    raise exception '0132: authorize_action must stay service_role only';
  end if;
end
$verify$;
