-- ============================================================================
-- 0117: Loyalty program setting & ledger foundation (Epic 20, Story 20.1).
--
-- Foundation only: nothing awards anything and no gym changes behavior. Every
-- existing gym is off, no hook body is touched, and no existing function reads
-- the new objects; effective_loyalty() is the only reader. It also touches
-- guest_sessions (generated column + FK) and gyms (columns + pin trigger).
--
--   gyms.loyalty_enabled / loyalty_guest_threshold (N) /
--   gyms.loyalty_renewal_threshold (K) / loyalty_reward_days (R)
--                                  pinned against every direct UPDATE; one
--                                  audited write path: set_loyalty_program().
--                                  Gym INSERT is deliberately not pinned, as in
--                                  0107 (clients are never granted INSERT).
--   loyalty_events                 append-only ledger, unique (origin_id,
--                                  event_type) is the exactly-once key.
--   loyalty_progress               derived counters, one row per (gym, member).
--   guest_sessions FK              loyalty_grant_id -> the reward_granted event.
--   effective_loyalty()            the one read function; never writes.
--
-- Design choices worth knowing before editing this file:
--
--  * The pin is its OWN trigger function with its OWN GUC
--    (app.loyalty_program_update_bypass), no super-admin or service_role
--    exemption. It is not a branch of protect_super_admin_only_gym_columns()
--    and not 0107's charging pin.
--
--  * "Unchanged" for the setter means: same enabled flag and, when enabling,
--    the same N/K/R. Disabling ignores N/K/R and keeps the stored values, so a
--    disable call on an already-off gym is a no-op whatever it passes.
--
--  * The guest_sessions FK is composite: the generated column
--    loyalty_grant_event_type is 'reward_granted' exactly when a grant id is
--    set, and the FK targets unique (id, event_type) on the ledger, so the
--    grant can only point at a reward_granted row. MATCH SIMPLE skips paid
--    sessions (both columns null).
--
--  * Both tables carry tenant_active_gate (the 11.8 coverage test counts it);
--    they are tenant data. Clients get SELECT only; TRUNCATE (bypasses RLS) is
--    stripped with the rest. Writers are SECURITY DEFINER functions in 20.2+.
--
--  * effective_loyalty() is SECURITY DEFINER because platform_session_config is
--    Super Admin read only. It authorizes explicitly (own member row, or staff
--    of the member's own gym) and applies idle windows at read time.
-- ============================================================================

-- Fail fast rather than queue gyms / guest_sessions writes behind this DDL
-- (the generated column below rewrites guest_sessions).
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The setting. Nullable N/K/R, required together once enabled.
-- ----------------------------------------------------------------------------
alter table gyms
  add column loyalty_enabled boolean not null default false,
  add column loyalty_guest_threshold integer,
  add column loyalty_renewal_threshold integer,
  add column loyalty_reward_days integer,
  add constraint gyms_loyalty_guest_threshold_range
    check (loyalty_guest_threshold between 2 and 50),
  add constraint gyms_loyalty_renewal_threshold_range
    check (loyalty_renewal_threshold between 3 and 24),
  add constraint gyms_loyalty_reward_days_range
    check (loyalty_reward_days between 1 and 30),
  add constraint gyms_loyalty_enabled_requires_values
    check (
      not loyalty_enabled
      or (loyalty_guest_threshold is not null
          and loyalty_renewal_threshold is not null
          and loyalty_reward_days is not null)
    );

-- ----------------------------------------------------------------------------
-- Pin trigger: reverts every write to the four columns unless
-- set_loyalty_program() holds the GUC. SECURITY INVOKER; fires for super admin
-- and service_role too. UPDATE only, like 0107.
-- ----------------------------------------------------------------------------
create function private.protect_loyalty_program_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.loyalty_program_update_bypass', true), 'false') <> 'true' then
    new.loyalty_enabled := old.loyalty_enabled;
    new.loyalty_guest_threshold := old.loyalty_guest_threshold;
    new.loyalty_renewal_threshold := old.loyalty_renewal_threshold;
    new.loyalty_reward_days := old.loyalty_reward_days;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_loyalty_program_columns() from public, anon;

create trigger protect_loyalty_program_columns
  before update of loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days
  on gyms
  for each row execute function private.protect_loyalty_program_columns();

-- ----------------------------------------------------------------------------
-- set_loyalty_program(): the only write path. Owner or Supervisor of the
-- caller's own gym (gym from private.gym_id(), never an argument). Order:
-- role, gym, suspension, validation, lock, no-op check, write, audit.
-- ----------------------------------------------------------------------------
create function set_loyalty_program(
  p_enabled boolean,
  p_n integer,
  p_k integer,
  p_r integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_old gyms%rowtype;
  v_new_enabled boolean;
  v_new_n integer;
  v_new_k integer;
  v_new_r integer;
begin
  if not coalesce(private.current_member_role() in ('owner', 'supervisor'), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'set_loyalty_program: gym % is not active', v_gym_id;
  end if;

  if p_enabled is null then
    raise exception 'set_loyalty_program: invalid_value';
  end if;

  if p_enabled and (
       p_n is null or p_n not between 2 and 50
       or p_k is null or p_k not between 3 and 24
       or p_r is null or p_r not between 1 and 30
     ) then
    raise exception 'set_loyalty_program: invalid_value';
  end if;

  select * into v_old from gyms g where g.id = v_gym_id for update;

  if p_enabled then
    v_new_enabled := true;
    v_new_n := p_n;
    v_new_k := p_k;
    v_new_r := p_r;
  else
    -- Disabling keeps the stored thresholds.
    v_new_enabled := false;
    v_new_n := v_old.loyalty_guest_threshold;
    v_new_k := v_old.loyalty_renewal_threshold;
    v_new_r := v_old.loyalty_reward_days;
  end if;

  if v_old.loyalty_enabled is not distinct from v_new_enabled
     and v_old.loyalty_guest_threshold is not distinct from v_new_n
     and v_old.loyalty_renewal_threshold is not distinct from v_new_k
     and v_old.loyalty_reward_days is not distinct from v_new_r then
    return;
  end if;

  perform set_config('app.loyalty_program_update_bypass', 'true', true);

  update gyms
  set loyalty_enabled = v_new_enabled,
      loyalty_guest_threshold = v_new_n,
      loyalty_renewal_threshold = v_new_k,
      loyalty_reward_days = v_new_r
  where id = v_gym_id;

  perform set_config('app.loyalty_program_update_bypass', 'false', true);

  perform log_audit_event(
    p_action_type => 'loyalty_program_changed',
    p_gym_id => v_gym_id,
    p_target_entity_id => v_gym_id::text,
    p_target_entity_type => 'gym',
    p_metadata => jsonb_build_object(
      'old', jsonb_build_object(
        'enabled', v_old.loyalty_enabled,
        'guest_threshold', v_old.loyalty_guest_threshold,
        'renewal_threshold', v_old.loyalty_renewal_threshold,
        'reward_days', v_old.loyalty_reward_days
      ),
      'new', jsonb_build_object(
        'enabled', v_new_enabled,
        'guest_threshold', v_new_n,
        'renewal_threshold', v_new_k,
        'reward_days', v_new_r
      )
    )
  );
end;
$$;

revoke execute on function set_loyalty_program(boolean, integer, integer, integer) from public, anon;
grant execute on function set_loyalty_program(boolean, integer, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- loyalty_events: the append-only ledger. No write policy and no write grant
-- for any client role. unique (origin_id, event_type) is the exactly-once key;
-- unique (id, event_type) exists only to be the target of the composite FK.
-- ----------------------------------------------------------------------------
create table loyalty_events (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  event_type text not null
    check (event_type in (
      'stamp_earned', 'reward_granted', 'reward_consumed',
      'reset', 'lapse', 'stamp_reversed'
    )),
  counter text not null check (counter in ('guest', 'subscriber')),
  origin_id uuid not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  constraint loyalty_events_origin_event_unique unique (origin_id, event_type),
  constraint loyalty_events_id_event_type_unique unique (id, event_type)
);

create index idx_loyalty_events_gym_id on loyalty_events (gym_id);
create index idx_loyalty_events_member_id on loyalty_events (member_id, occurred_at);

-- ----------------------------------------------------------------------------
-- loyalty_progress: derived counters, one row per member per gym.
-- ----------------------------------------------------------------------------
create table loyalty_progress (
  gym_id uuid not null references gyms(id),
  member_id uuid not null references members(id),
  guest_stamps integer not null default 0 check (guest_stamps >= 0),
  subscriber_stamps integer not null default 0 check (subscriber_stamps >= 0),
  guest_last_event_at timestamptz,
  subscriber_last_event_at timestamptz,
  primary key (gym_id, member_id)
);

create index idx_loyalty_progress_member_id on loyalty_progress (member_id);

-- ----------------------------------------------------------------------------
-- RLS, grants and the tenant gate, same shape as guest_sessions (0107).
-- ----------------------------------------------------------------------------
alter table loyalty_events enable row level security;
alter table loyalty_progress enable row level security;

revoke all on loyalty_events from anon, authenticated, service_role;
revoke all on loyalty_progress from anon, authenticated, service_role;
grant select on loyalty_events to authenticated, service_role;
grant select on loyalty_progress to authenticated, service_role;

create policy "gym_staff_read_own_loyalty_events" on loyalty_events
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist')
  );

create policy "member_read_own_loyalty_events" on loyalty_events
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'member'
    and exists (
      select 1 from members m
      where m.id = loyalty_events.member_id and m.user_id = auth.uid()
    )
  );

create policy "tenant_active_gate" on loyalty_events
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

create policy "gym_staff_read_own_loyalty_progress" on loyalty_progress
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() in ('owner', 'manager', 'supervisor', 'receptionist')
  );

create policy "member_read_own_loyalty_progress" on loyalty_progress
  for select
  using (
    gym_id = private.gym_id()
    and private.current_member_role() = 'member'
    and exists (
      select 1 from members m
      where m.id = loyalty_progress.member_id and m.user_id = auth.uid()
    )
  );

create policy "tenant_active_gate" on loyalty_progress
  as restrictive
  for all
  using (private.current_gym_status() = 'active' or private.is_super_admin())
  with check (private.current_gym_status() = 'active' or private.is_super_admin());

-- ----------------------------------------------------------------------------
-- guest_sessions.loyalty_grant_id -> the reward_granted ledger row.
-- Nothing writes loyalty_grant_id before Epic 20, so no row may hold one; fail
-- here with a clear message rather than on the FK validation.
-- ----------------------------------------------------------------------------
do $precheck$
begin
  if exists (select 1 from guest_sessions where loyalty_grant_id is not null) then
    raise exception '0117: guest_sessions rows carry a loyalty_grant_id but no ledger exists yet';
  end if;
end;
$precheck$;

alter table guest_sessions
  add column loyalty_grant_event_type text
    generated always as (
      case when loyalty_grant_id is not null then 'reward_granted' end
    ) stored;

alter table guest_sessions
  add constraint guest_sessions_loyalty_grant_fkey
    foreign key (loyalty_grant_id, loyalty_grant_event_type)
    references loyalty_events (id, event_type);

-- ----------------------------------------------------------------------------
-- effective_loyalty(): the one read function. Returns a JSON object (never a
-- SQL NULL composite) or JSON null for a suspended gym. Never writes.
--
-- Idle windows come from platform_session_config and apply at read time: a
-- counter reads 0 when its last event is older than its window. Guest window
-- is loyalty_idle_reset_days; subscriber window is the greater of that and the
-- current plan's duration_days + the gym's grace_period_days. "Current plan" =
-- latest subscription by created_at, as in guest_charging_impact().
-- ----------------------------------------------------------------------------
create function effective_loyalty(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_gym_id uuid;
  v_member_user_id uuid;
  v_role member_role;
  v_idle integer;
  v_gym gyms%rowtype;
  v_progress loyalty_progress%rowtype;
  v_plan_duration integer;
  v_guest_window integer;
  v_sub_window integer;
  v_guest_stamps integer;
  v_sub_stamps integer;
  v_free jsonb;
  v_paid jsonb;
begin
  select m.gym_id, m.user_id into v_member_gym_id, v_member_user_id
  from members m
  where m.id = p_member_id;

  if not found or v_member_gym_id is distinct from private.gym_id() then
    raise exception 'permission denied';
  end if;

  v_role := private.current_member_role();

  if not (
    coalesce(v_role in ('owner', 'manager', 'supervisor', 'receptionist'), false)
    or (v_role = 'member' and v_member_user_id is not distinct from auth.uid())
  ) then
    raise exception 'permission denied';
  end if;

  -- A read, so a suspended gym returns JSON null instead of raising. Fail-closed
  -- on a NULL status; written without the raising-guard shape on purpose (the
  -- 11.8 coverage test requires that shape to raise 'is not active').
  if not coalesce(private.current_gym_status() = 'active', false) then
    return 'null'::jsonb;
  end if;

  select c.loyalty_idle_reset_days into v_idle from platform_session_config c;

  select * into v_gym from gyms g where g.id = v_member_gym_id;

  select p.duration_days into v_plan_duration
  from subscriptions s
  join plans p on p.id = s.plan_id
  where s.member_id = p_member_id
  order by s.created_at desc, s.id desc
  limit 1;

  v_guest_window := v_idle;
  v_sub_window := case
    when v_plan_duration is null then v_idle
    else greatest(v_idle, v_plan_duration + v_gym.grace_period_days)
  end;

  select * into v_progress
  from loyalty_progress lp
  where lp.gym_id = v_member_gym_id and lp.member_id = p_member_id;

  v_guest_stamps := case
    when v_progress.guest_last_event_at is not null
         and v_progress.guest_last_event_at >= now() - make_interval(days => v_guest_window)
      then v_progress.guest_stamps
    else 0
  end;

  v_sub_stamps := case
    when v_progress.subscriber_last_event_at is not null
         and v_progress.subscriber_last_event_at >= now() - make_interval(days => v_sub_window)
      then v_progress.subscriber_stamps
    else 0
  end;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'usable_until', s.usable_until)
                            order by s.usable_until, s.id), '[]'::jsonb)
  into v_free
  from guest_sessions s
  where s.member_id = p_member_id and s.gym_id = v_member_gym_id
    and s.loyalty_grant_id is not null
    and s.consumed_at is null and s.voided_at is null
    and s.usable_until > now();

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'usable_until', s.usable_until)
                            order by s.usable_until, s.id), '[]'::jsonb)
  into v_paid
  from guest_sessions s
  where s.member_id = p_member_id and s.gym_id = v_member_gym_id
    and s.payment_id is not null
    and s.consumed_at is null and s.voided_at is null
    and s.usable_until > now();

  return jsonb_build_object(
    'enabled', v_gym.loyalty_enabled,
    'guest_stamps', v_guest_stamps,
    'subscriber_stamps', v_sub_stamps,
    'guest_threshold', v_gym.loyalty_guest_threshold,
    'renewal_threshold', v_gym.loyalty_renewal_threshold,
    'reward_days', v_gym.loyalty_reward_days,
    'guest_window_days', v_guest_window,
    'subscriber_window_days', v_sub_window,
    'free_sessions', v_free,
    'paid_sessions', v_paid
  );
end;
$$;

revoke execute on function effective_loyalty(uuid) from public, anon;
grant execute on function effective_loyalty(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Post-condition assertions -- 0107's discipline.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if exists (select 1 from gyms where loyalty_enabled is distinct from false) then
    raise exception '0117: a gym is not off after adding the loyalty columns';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'gyms'
        and column_name in ('loyalty_enabled', 'loyalty_guest_threshold',
                            'loyalty_renewal_threshold', 'loyalty_reward_days')) <> 4 then
    raise exception '0117: gyms loyalty columns missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.loyalty_events'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.loyalty_progress'::regclass) then
    raise exception '0117: loyalty tables must have RLS enabled';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('loyalty_events', 'loyalty_progress')
      and grantee in ('authenticated', 'service_role', 'anon')
      and privilege_type <> 'SELECT'
  ) then
    raise exception '0117: loyalty tables must be SELECT-only for client roles';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'protect_loyalty_program_columns' and not tgisinternal
  ) then
    raise exception '0117: loyalty pin trigger missing';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'guest_sessions_loyalty_grant_fkey'
  ) then
    raise exception '0117: guest_sessions loyalty grant FK missing';
  end if;
end;
$verify$;
