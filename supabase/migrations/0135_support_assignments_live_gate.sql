-- Story 23.1: GymOS Support role, assignment record and live gate (FR-178, FR-194, FR-177 data half; AD-33/34).
-- Runs after 0134 (which added member_role 'support' in its own transaction).
--
-- What this adds
--   * public.support_assignments   who is assigned to which gym, and in which state. RLS on, no client policy.
--   * gyms.allow_gymos_support     the Owner switch. Existing gyms are backfilled FALSE, new gyms default TRUE. A trigger
--                                  refuses every change unless the transaction sets gymos.allow_support_setter = 'on'
--                                  (the audited setter in 23.3 will).
--   * private.support_accounts     the "activated / unlocked / no reset pending" facts. Nothing writes it until 23.4/23.10/23.11.
--   * private.support_set_membership  the ONLY writer of a members row with role 'support' (sets
--                                  gymos.support_membership_writer); a constraint trigger on members refuses an active support
--                                  row unless the assignment is active AND the gym's switch is on.
--   * private.support_live(user, gym)  the live gate. Every leg must hold; any doubt returns false.
--   * private.gym_id() / private.current_member_role()  return NULL for support rows (no existing policy may resolve support);
--     private.support_gym_id() returns the live gym for a support caller, only while support_live holds. Other roles unchanged.
--   * custom_access_token_hook, switch_active_gym, list_own_active_gym_memberships  accept a support row only for an active
--     assignment (the hook also needs aal2).
--   * private.session_gate_touch   applies its idle/absolute limits to users with a non-ended support assignment as well as
--     Super Admins, independent of the super_admin_aal2 flag.
--
-- No existing policy, function or CHECK lists 'support', so a live support user still reads zero tenant rows until 23.6.
-- Rollback: scripts/rollback-0135-support-assignments-live-gate.sql.

-- ===== assignment record =====

create table public.support_assignments (
  id               uuid primary key default gen_random_uuid(),
  support_user_id  uuid not null references public.users(id),
  gym_id           uuid not null references public.gyms(id),
  state            text not null default 'pending' check (state in ('pending', 'active', 'suspended', 'ended')),
  reason           text,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  activated_at     timestamptz,
  ended_at         timestamptz,
  updated_at       timestamptz not null default now()
);
-- one non-ended assignment per person and gym
create unique index support_assignments_one_open_idx
  on public.support_assignments (support_user_id, gym_id) where state <> 'ended';
create index support_assignments_gym_idx on public.support_assignments (gym_id);
alter table public.support_assignments enable row level security;
revoke all on public.support_assignments from public, anon, authenticated;

-- ===== account facts (written by 23.4 / 23.10 / 23.11) =====

create table private.support_accounts (
  user_id          uuid primary key references public.users(id),
  activated_at     timestamptz,
  locked_at        timestamptz,
  reset_pending_at timestamptz
);
alter table private.support_accounts enable row level security;
revoke all on private.support_accounts from public, anon, authenticated;

-- ===== the Owner switch =====

alter table public.gyms add column allow_gymos_support boolean not null default false;  -- existing rows: false
alter table public.gyms alter column allow_gymos_support set default true;               -- new gyms: true

create or replace function private.guard_allow_gymos_support()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.allow_gymos_support is distinct from old.allow_gymos_support
     and coalesce(current_setting('gymos.allow_support_setter', true), '') <> 'on' then
    raise exception 'allow_gymos_support: only the audited setter may change this column'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_allow_gymos_support() from public, anon, authenticated;

create trigger guard_allow_gymos_support
  before update of allow_gymos_support on public.gyms
  for each row execute function private.guard_allow_gymos_support();

-- ===== the live gate =====

-- True only while EVERY leg holds for the caller (p_user must be the JWT user): assignment active, Owner switch on, gym
-- active, account activated / unlocked / no reset pending, JWT aal = aal2 (always, independent of the super_admin_aal2
-- flag), session present in auth.sessions, and a support_session_state row inside the idle and absolute limits. Does NOT
-- call private.gym_id() / current_gym_status() (they call this). Fails closed: any error is false.
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
       and st.started_at > now() - make_interval(mins => private.session_limit('absolute_session_minutes'))
       and st.last_seen_at > now() - make_interval(mins => private.session_limit('idle_minutes'))
  );
exception when others then
  return false;
end;
$$;
revoke all on function private.support_live(uuid, uuid) from public, anon, authenticated;
grant execute on function private.support_live(uuid, uuid) to service_role;

-- ===== live helpers: support rows are NOT resolved (owner decision 2026-10-20) =====
-- 41 earlier migrations have policies of the form `gym_id = private.gym_id()` with no role check, so resolving a live support
-- user here would open plans, classes and more before 23.6 opts capabilities in. gym_id() and current_member_role() therefore
-- return NULL for support rows; private.support_gym_id() (below) is the only helper that resolves a live support gym, and
-- 23.6 opts each capability in by name.

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
    and m.role <> 'support'
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
    and role <> 'support'
  order by created_at desc, id desc
  limit 1;

  return v_role;
end;
$$;

-- The live gym of a support caller: the explicit gym in the JWT, only while support_live holds for it. NULL otherwise.
-- A request acts on exactly one gym. Nothing calls this until 23.6; it is the one place a support user resolves.
create or replace function private.support_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.gym_id
  from members m
  where m.user_id = auth.uid()
    and m.role = 'support'
    and m.deactivated_at is null
    and m.gym_id = (
      case
        when (auth.jwt() ->> 'gym_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (auth.jwt() ->> 'gym_id')::uuid
      end)
    and private.support_live(m.user_id, m.gym_id)
  limit 1;
$$;
revoke all on function private.support_gym_id() from public, anon;
grant execute on function private.support_gym_id() to authenticated, service_role;

revoke execute on function private.gym_id() from public, anon;
grant execute on function private.gym_id() to authenticated, service_role;
revoke execute on function private.current_member_role() from public, anon;
grant execute on function private.current_member_role() to authenticated, service_role;

-- ===== the only writer of a support membership =====

create or replace function private.support_set_membership(p_assignment_id uuid, p_active boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_a   public.support_assignments;
  v_id  uuid;
begin
  select * into v_a from public.support_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'support_set_membership: unknown assignment' using errcode = 'P0001';
  end if;
  if p_active and exists (
       select 1 from members m
        where m.user_id = v_a.support_user_id and m.gym_id = v_a.gym_id and m.role <> 'support' and m.deactivated_at is null) then
    raise exception 'support_set_membership: the user already has a non-support membership in this gym' using errcode = 'P0001';
  end if;

  perform set_config('gymos.support_membership_writer', 'on', true);
  if p_active then
    select m.id into v_id from members m
     where m.user_id = v_a.support_user_id and m.gym_id = v_a.gym_id and m.role = 'support' and m.deactivated_at is null;
    if v_id is null then
      insert into members (gym_id, user_id, role, name)
      values (v_a.gym_id, v_a.support_user_id, 'support', 'GymOS Support')
      returning id into v_id;
    end if;
  else
    update members set deactivated_at = now()
     where user_id = v_a.support_user_id and gym_id = v_a.gym_id and role = 'support' and deactivated_at is null
    returning id into v_id;
  end if;
  perform set_config('gymos.support_membership_writer', 'off', true);
  return v_id;
end;
$$;
revoke all on function private.support_set_membership(uuid, boolean) from public, anon, authenticated;
grant execute on function private.support_set_membership(uuid, boolean) to service_role;

create or replace function private.guard_support_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An active support row may not be turned into something else (or moved) outside the writer.
  if tg_op = 'UPDATE' and old.role = 'support' and old.deactivated_at is null and new.deactivated_at is null
     and (new.role <> 'support' or new.user_id <> old.user_id or new.gym_id <> old.gym_id)
     and coalesce(current_setting('gymos.support_membership_writer', true), '') <> 'on' then
    raise exception 'support_membership: an active support membership may only be changed through private.support_set_membership'
      using errcode = 'P0001';
  end if;
  if new.role <> 'support' or new.deactivated_at is not null then
    return null;
  end if;
  if coalesce(current_setting('gymos.support_membership_writer', true), '') <> 'on' then
    raise exception 'support_membership: only private.support_set_membership may write a support membership'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.support_assignments a join public.gyms g on g.id = a.gym_id
     where a.support_user_id = new.user_id and a.gym_id = new.gym_id and a.state = 'active' and g.allow_gymos_support
  ) then
    raise exception 'support_membership: an active support membership needs an active assignment and the gym''s switch on'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;
revoke all on function private.guard_support_membership() from public, anon, authenticated;

create constraint trigger guard_support_membership
  after insert or update of role, user_id, gym_id, deactivated_at on public.members
  deferrable initially immediate
  for each row execute function private.guard_support_membership();

-- ===== claims hook: support only for an active assignment at aal2 =====

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

-- ===== switcher and list: a support row counts only with an active assignment =====

create or replace function switch_active_gym(p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from members m
    where m.user_id = auth.uid()
      and m.gym_id = p_gym_id
      and m.deactivated_at is null
      and (m.role <> 'support' or exists (
            select 1 from support_assignments a
             where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active'))
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
    and m.deactivated_at is null
    and (m.role <> 'support' or exists (
          select 1 from support_assignments a
           where a.support_user_id = m.user_id and a.gym_id = m.gym_id and a.state = 'active'));
$$;

revoke all on function switch_active_gym(uuid) from public, anon;
grant execute on function switch_active_gym(uuid) to authenticated;
revoke all on function list_own_active_gym_memberships() from public, anon;
grant execute on function list_own_active_gym_memberships() to authenticated;

-- ===== session gate: support users carry the idle / absolute limits too =====

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
  v_support boolean;
begin
  v_support := p_user is not null and exists (
    select 1 from public.support_assignments a where a.support_user_id = p_user and a.state <> 'ended');

  -- Support is gated whatever the super_admin_aal2 flag says; everyone else follows the flag as before.
  if not v_support and not private.super_admin_aal2_required() then
    return query select true, 'ok'::text;
    return;
  end if;
  if p_user is null or p_session is null then
    return query select false, 'no_session'::text;
    return;
  end if;
  -- Only Super Admins and support carry these limits; anyone else is decided by authorize_action.
  if not v_support and not coalesce((select u.is_super_admin from users u where u.id = p_user), false) then
    return query select true, 'ok'::text;
    return;
  end if;

  -- A dual-role user (Super Admin and support) is locked by either lock.
  if (coalesce((select u.is_super_admin from users u where u.id = p_user), false) and private.super_admin_locked(p_user))
     or (v_support and exists (select 1 from private.support_accounts sa where sa.user_id = p_user and sa.locked_at is not null)) then
    perform private.end_user_sessions(p_user);
    return query select false, 'locked'::text;
    return;
  end if;

  select s.created_at into v_created from auth.sessions s where s.id = p_session and s.user_id = p_user;
  if not found then
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
    values (null, null, 'system:session_limits',
            case when v_support then 'support_session_expired' else 'super_admin_session_expired' end,
            'user', p_user::text,
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

do $verify$
begin
  if exists (select 1 from public.gyms where allow_gymos_support) then
    raise exception '0135: a pre-existing gym has the Owner switch on';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.gyms'::regclass and tgname = 'guard_allow_gymos_support')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.members'::regclass and tgname = 'guard_support_membership') then
    raise exception '0135: guard triggers missing';
  end if;
  if has_table_privilege('authenticated', 'public.support_assignments', 'select')
     or has_table_privilege('anon', 'public.support_assignments', 'select')
     or has_function_privilege('authenticated', 'private.support_live(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'private.support_set_membership(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'private.support_gym_id()', 'execute')
     or has_function_privilege('anon', 'public.switch_active_gym(uuid)', 'execute') then
    raise exception '0135: a support object is client-reachable';
  end if;
end
$verify$;
