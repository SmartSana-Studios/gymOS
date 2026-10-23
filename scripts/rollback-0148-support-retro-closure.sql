-- Rollback for migration 0148 (Epic 23 retro closure). Restores, exactly as earlier migrations defined them:
--   private.support_live (0145), private.support_live_for (0146), public.set_allow_gymos_support (0145), and the 0144 limit row
--   support_revocation_cutoff_seconds. Drops private.support_live_core.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0148-support-retro-closure.sql
-- Data effects: none (the limit row is re-inserted with its 0144 value).
set local lock_timeout = '5s';

create or replace function private.support_live(p_user uuid, p_gym uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sid uuid;
begin
  if p_user is null or p_gym is null or auth.uid() is null or p_user <> auth.uid() then
    return false;
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return false;
  end if;
  if not private.jwt_session_alive() then
    return false;
  end if;
  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  return exists (
    select 1
      from public.support_assignments a
      join public.gyms g on g.id = a.gym_id
      join private.support_accounts sa on sa.user_id = a.support_user_id
      join private.support_session_state st on st.session_id = v_sid and st.user_id = a.support_user_id
     where a.support_user_id = p_user
       and a.gym_id = p_gym
       and a.state = 'active'
       and g.allow_gymos_support
       and g.status = 'active'
       and sa.activated_at is not null
       and sa.locked_at is null
       and sa.reset_pending_at is null
       -- Story 23.11: a lapsed recertification denies; no due date at all is treated as lapsed (fails closed)
       and sa.recertify_due_at > now()
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
exception when others then
  return false;
end;
$$;

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

CREATE OR REPLACE FUNCTION public.set_allow_gymos_support(p_gym_id uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old    boolean;
  v_status gym_status;
  v_a      record;
  v_suspended integer := 0;
begin
  if p_gym_id is null
     or p_on is null
     or p_gym_id is distinct from private.gym_id()
     or private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  perform private.support_gym_lock(p_gym_id);

  select g.allow_gymos_support, g.status into v_old, v_status
    from gyms g where g.id = p_gym_id for update;
  if not found then
    raise exception 'set_allow_gymos_support: gym not found';
  end if;
  if v_status is distinct from 'active' then
    raise exception 'set_allow_gymos_support: gym % is not active', p_gym_id;
  end if;
  if v_old is not distinct from p_on then
    return;
  end if;

  perform set_config('gymos.allow_support_setter', 'on', true);
  update gyms set allow_gymos_support = p_on where id = p_gym_id;
  perform set_config('gymos.allow_support_setter', 'off', true);

  if not p_on then
    for v_a in
      select id from support_assignments where gym_id = p_gym_id and state = 'active' order by id for update
    loop
      update support_assignments set state = 'suspended', suspended_by_switch = true where id = v_a.id;
      perform private.support_set_membership(v_a.id, false);
      v_suspended := v_suspended + 1;
    end loop;
    if v_suspended > 0 then
      perform private.support_revoke_access(p_gym_id, null, 'switch_off');
    end if;
  else
    for v_a in
      select id from support_assignments
       where gym_id = p_gym_id and state = 'suspended' and suspended_by_switch
         -- Story 23.10: a person whose account is not activated, is locked, has a reset pending or was deactivated, or who gained another
         -- membership here while the switch was off, is skipped (stays suspended) instead of being restored or aborting the toggle.
         and exists (select 1 from private.support_accounts sa where sa.user_id = support_assignments.support_user_id
                      and sa.activated_at is not null and sa.locked_at is null and sa.reset_pending_at is null and sa.deactivated_at is null)
         and not exists (select 1 from members m where m.user_id = support_assignments.support_user_id and m.gym_id = p_gym_id
                          and m.role <> 'support' and m.deactivated_at is null)
       order by id for update
    loop
      update support_assignments set state = 'active', suspended_by_switch = false where id = v_a.id;
      perform private.support_set_membership(v_a.id, true);
      -- Story 23.11: restored access restarts the idle clock
      perform private.support_touch_activity((select a.support_user_id from support_assignments a where a.id = v_a.id));
    end loop;
  end if;

  perform log_audit_event(
    p_action_type => 'allow_gymos_support_changed',
    p_gym_id => p_gym_id,
    p_target_entity_id => p_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object('old', v_old, 'new', p_on)
  );
end;
$function$
;
revoke all on function public.set_allow_gymos_support(uuid, boolean) from public, anon;

drop function if exists private.support_live_core(uuid, uuid, uuid);

insert into private.session_limits_config (key, value, note) values
  ('support_revocation_cutoff_seconds', 60, '[ASSUMPTION] seconds within which a revoked support session, subscription or signed link stops (the live gate is evaluated on every request, so this is an upper bound)')
on conflict (key) do nothing;
