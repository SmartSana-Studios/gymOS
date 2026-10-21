-- Story 23.3: "Allow GymOS Support" switch and "GymOS Support" row (FR-182, FR-183).
--
--   * support_assignments.suspended_by_switch   marks assignments the Owner switch suspended, so only those return on re-enable
--   * support_assignments.updated_at trigger    (23-1 deferral)
--   * private.support_gym_lock(gym)             per-gym transaction advisory lock; 23.5 reuses the same key
--   * set_allow_gymos_support(gym, on)          Owner-only audited setter; the only opener of gymos.allow_support_setter
--   * get_gymos_support_status(gym)             Owner-only readout: one state, never an individual or a count
-- Rollback: scripts/rollback-0137-allow-gymos-support-switch.sql.

alter table public.support_assignments add column suspended_by_switch boolean not null default false;

create or replace function private.touch_support_assignment_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_support_assignment_updated_at() from public, anon, authenticated;

create trigger touch_support_assignment_updated_at
  before update on public.support_assignments
  for each row execute function private.touch_support_assignment_updated_at();

create or replace function private.support_gym_lock(p_gym uuid)
returns void
language sql
volatile
set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('gymos_support_gym:' || p_gym::text, 0));
$$;
revoke all on function private.support_gym_lock(uuid) from public, anon, authenticated;
grant execute on function private.support_gym_lock(uuid) to service_role;

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
    end loop;
  else
    for v_a in
      select id from support_assignments
       where gym_id = p_gym_id and state = 'suspended' and suspended_by_switch order by id for update
    loop
      update support_assignments set state = 'active', suspended_by_switch = false where id = v_a.id;
      perform private.support_set_membership(v_a.id, true);
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
grant execute on function public.set_allow_gymos_support(uuid, boolean) to authenticated, service_role;

-- state: off | none | assigned | waiting. last_acted_at: newest session activity of the gym's non-ended assignments.
create or replace function public.get_gymos_support_status(p_gym_id uuid)
returns table (allowed boolean, state text, last_acted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if p_gym_id is null
     or p_gym_id is distinct from private.gym_id()
     or private.current_member_role() is distinct from 'owner' then
    raise exception 'permission denied';
  end if;

  select g.allow_gymos_support into v_allowed from gyms g where g.id = p_gym_id;
  if not found then
    raise exception 'get_gymos_support_status: gym not found';
  end if;

  return query
  select v_allowed,
         case
           when not v_allowed then 'off'
           when exists (select 1 from support_assignments a where a.gym_id = p_gym_id and a.state = 'active') then 'assigned'
           when exists (select 1 from support_assignments a where a.gym_id = p_gym_id and a.state = 'pending') then 'waiting'
           else 'none'
         end,
         (select max(st.last_seen_at)
            from support_assignments a
            join private.support_session_state st on st.user_id = a.support_user_id
           where a.gym_id = p_gym_id and a.state <> 'ended');
end;
$$;
revoke all on function public.get_gymos_support_status(uuid) from public, anon;
grant execute on function public.get_gymos_support_status(uuid) to authenticated, service_role;

do $verify$
begin
  if has_function_privilege('anon', 'public.set_allow_gymos_support(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.get_gymos_support_status(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.support_gym_lock(uuid)', 'execute') then
    raise exception '0137: ACL wrong';
  end if;
end
$verify$;
