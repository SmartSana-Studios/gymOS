-- Epic 23 retrospective closure (items D1, D2, R4 of epic-23-retro-2026-10-22.md).
--   1. One live-gate predicate. private.support_live (JWT-based, 0145) and private.support_live_for (session-id based, 0146) each repeated
--      the same assignment/account/session legs; both now call private.support_live_core, so they cannot drift apart.
--   2. public.set_allow_gymos_support, switch ON: the restore branch skipped the recertification leg that private.support_restore_assignments
--      has, so a person whose recertification had lapsed came back as an ACTIVE assignment with the support membership on. support_live still
--      denied them, so no access was granted, but the assignment and membership state contradicted the model. The leg is added.
--   3. support_revocation_cutoff_seconds (0144) was read by nothing: revocation is enforced on every request through the live gate, so the
--      "60 s" setting had no effect and promised something the system does not do. Removed.
-- Rollback: scripts/rollback-0148-support-retro-closure.sql.
set local lock_timeout = '5s';

-- ===== 1. the shared predicate =====
create or replace function private.support_live_core(p_user uuid, p_gym uuid, p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
       -- Story 23.11: a lapsed recertification denies; no due date at all is treated as lapsed (fails closed)
       and sa.recertify_due_at > now()
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
$$;
revoke all on function private.support_live_core(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live_core(uuid, uuid, uuid) to service_role;

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

  return private.support_live_core(p_user, p_gym, v_sid);
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live(uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live(uuid, uuid) to service_role;

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

  return private.support_live_core(p_user, p_gym, p_session);
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live_for(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live_for(uuid, uuid, uuid) to service_role;

-- ===== 2. switch on: the restore branch also requires a current recertification =====
create or replace function public.set_allow_gymos_support(p_gym_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
         -- Epic 23 retro: a lapsed recertification is skipped too (the same legs as private.support_restore_assignments).
         and exists (select 1 from private.support_accounts sa where sa.user_id = support_assignments.support_user_id
                      and sa.activated_at is not null and sa.locked_at is null and sa.reset_pending_at is null and sa.deactivated_at is null
                      and sa.recertify_due_at > now())
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
$$;
revoke all on function public.set_allow_gymos_support(uuid, boolean) from public, anon;

-- ===== 3. the unused 60 s cutoff =====
delete from private.session_limits_config where key = 'support_revocation_cutoff_seconds';
