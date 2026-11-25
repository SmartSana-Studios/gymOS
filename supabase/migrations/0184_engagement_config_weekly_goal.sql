-- ============================================================================
-- 0184: Engagement configuration, gym-local week helpers and the weekly goal (Epic 30, Story 30.1; FR-219, FR-232; AD-53, AD-61, AD-34).
--
-- Adds only new objects; no existing table, function, policy or grant is touched.
--   1. platform_engagement_config: the singleton of operator-tunable engagement parameters, Super Admin only, every update audited on the
--      WHOLE row (to_jsonb(old) / to_jsonb(new)), so a column added later is audited without editing a trigger (0107's audit trigger
--      hard-coded its keys, so a column added after it was silently unaudited).
--      release_week_start NULL means the engagement area is DARK: nothing is settled and nothing becomes member-visible. The operator turns
--      it on by setting a Monday; the statement is recorded in docs/decisions.md.
--   2. private.gym_local_week_bounds(tz, at) and private.week_start_of(date): the Monday week, DST-safe (the interval is added to the LOCAL
--      timestamp and converted back, the 0095 rule).
--   3. member_weekly_goals: the goal in force per week, history that is never rewritten. RLS on, no policy, no grant; the only writer
--      is set_weekly_goal. A trigger refuses any insert, update or delete of a row whose effective_week is on or before the gym-local current week, whoever the writer is, so a goal in force or in the past can never be lowered.
--   4. set_weekly_goal(smallint) and my_weekly_goal(): the member RPCs. They take no member id and no date or clock: the caller is
--      resolved live (member role, own non-deactivated member row, active gym), and the effective week is always the next gym-local Monday.
--
-- Rollback: scripts/rollback-0184-engagement-config-weekly-goal.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. platform_engagement_config (the platform_session_config pattern of 0107, policies in the wrapped form of 0124)
-- ----------------------------------------------------------------------------
create table public.platform_engagement_config (
  id uuid primary key default gen_random_uuid(),
  goal_min integer not null,
  goal_max integer not null,
  goal_default integer not null,
  shield_every_weeks integer not null,
  shield_cap integer not null,
  comeback_visits integer not null,
  comeback_window_days integer not null,
  daily_streak_min integer not null,
  release_week_start date,
  constraint platform_engagement_config_goal_min check (goal_min >= 1),
  constraint platform_engagement_config_goal_order check (goal_min <= goal_default and goal_default <= goal_max),
  -- member_weekly_goals.goal and the ring cap at 7 days; a larger goal_max could never be stored.
  constraint platform_engagement_config_goal_max_seven check (goal_max <= 7),
  constraint platform_engagement_config_shield_every check (shield_every_weeks > 0),
  constraint platform_engagement_config_shield_cap check (shield_cap >= 0),
  constraint platform_engagement_config_comeback_visits check (comeback_visits > 0),
  constraint platform_engagement_config_comeback_window check (comeback_window_days > 0),
  constraint platform_engagement_config_daily_min check (daily_streak_min > 0),
  constraint platform_engagement_config_release_monday check (release_week_start is null or extract(isodow from release_week_start) = 1)
);

create unique index platform_engagement_config_singleton on public.platform_engagement_config ((true));

insert into public.platform_engagement_config
  (goal_min, goal_max, goal_default, shield_every_weeks, shield_cap, comeback_visits, comeback_window_days, daily_streak_min, release_week_start)
values (1, 7, 3, 4, 2, 3, 10, 3, null);

alter table public.platform_engagement_config enable row level security;

revoke all on public.platform_engagement_config from anon, authenticated, service_role;
grant select, update on public.platform_engagement_config to authenticated, service_role;

create policy "super_admin_read_platform_engagement_config" on public.platform_engagement_config
  for select
  using ((select private.is_super_admin()));

create policy "super_admin_update_platform_engagement_config" on public.platform_engagement_config
  for update
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

comment on table public.platform_engagement_config is
  'Singleton of engagement parameters (Epic 30). release_week_start NULL = the engagement area is dark (nothing settled, nothing member-visible); the operator sets a Monday to turn it on (docs/decisions.md). Updates are audited on the whole row.';

-- Audited writes: gym_id null (platform level), the whole row old and new.
create function private.audit_platform_engagement_config_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform log_audit_event(
    p_action_type => 'platform_engagement_config_updated',
    p_gym_id => null,
    p_target_entity_id => new.id::text,
    p_target_entity_type => 'platform_engagement_config',
    p_metadata => jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return null;
end;
$$;

revoke execute on function private.audit_platform_engagement_config_update() from public, anon;

create trigger audit_platform_engagement_config_update
  after update on public.platform_engagement_config
  for each row execute function private.audit_platform_engagement_config_update();

-- ----------------------------------------------------------------------------
-- 2. Week helpers, beside private.gym_local_month_bounds (0095)
-- ----------------------------------------------------------------------------

-- The gym-local week (Monday 00:00 to the next Monday 00:00) containing `p_at`, as a half-open UTC range. IMMUTABLE: it reads no table, and
-- every function it calls is immutable. The interval is added to the LOCAL timestamp and only then converted back, so a week with a DST
-- change is 167 or 169 hours long, not 168 (0095 rule).
create function private.gym_local_week_bounds(p_timezone text, p_at timestamptz)
returns table (week_start timestamptz, next_week_start timestamptz)
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    date_trunc('week', p_at at time zone p_timezone) at time zone p_timezone,
    (date_trunc('week', p_at at time zone p_timezone) + interval '1 week') at time zone p_timezone;
$$;

-- The Monday on or before a date. The only way a visit_day becomes its week.
create function private.week_start_of(p_day date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select date_trunc('week', p_day::timestamp)::date;
$$;

revoke execute on function private.gym_local_week_bounds(text, timestamptz) from public, anon;
grant execute on function private.gym_local_week_bounds(text, timestamptz) to authenticated;
revoke execute on function private.week_start_of(date) from public, anon;
grant execute on function private.week_start_of(date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. member_weekly_goals: history of the goal in force, never rewritten
-- ----------------------------------------------------------------------------
create table public.member_weekly_goals (
  member_id uuid not null references public.members(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  effective_week date not null,
  goal smallint not null,
  created_at timestamptz not null default now(),
  primary key (member_id, effective_week),
  constraint member_weekly_goals_monday check (extract(isodow from effective_week) = 1),
  constraint member_weekly_goals_goal_range check (goal between 1 and 7)
);

create index member_weekly_goals_gym_idx on public.member_weekly_goals (gym_id);

alter table public.member_weekly_goals enable row level security;
-- Deliberately no policy: client roles see nothing. Every read and write goes through set_weekly_goal and my_weekly_goal.
-- (A restrictive tenant_active_gate would be a structural no-op without a permissive policy; suspension_rpc_coverage.test.sql lists this table
-- among the gym_id tables deliberately without it, as it does page_names.)
revoke all on table public.member_weekly_goals from public, anon, authenticated, service_role;

comment on table public.member_weekly_goals is
  'Weekly goal history (Epic 30, AD-61). One row per member and effective Monday; the row at the latest effective_week on or before the current gym-local week is the goal in force. Written only by set_weekly_goal; the history trigger refuses any change to a row at or before the current week.';

-- The history rule: nothing, not even a definer function or the table owner, may insert, update or delete a row whose effective_week is
-- on or before the current gym-local week start. A DELETE caused by the owning member being deleted is allowed (detected by the member row
-- no longer existing), so deleting a member is not blocked by their history. A gym cannot be deleted while it has members
-- (members_gym_id_fkey is NO ACTION), so a gym delete reaches a goal row only after, or in the same statement as, its members' deletion.
create function private.member_weekly_goals_history_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from members m where m.id = old.member_id) then
      return old;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_week := private.week_start_of(private.gym_today(old.gym_id));
    if old.effective_week <= v_week then
      raise exception 'member_weekly_goals: a goal in force or in the past cannot change'
        using errcode = '23514';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_week := private.week_start_of(private.gym_today(new.gym_id));
    if new.effective_week <= v_week then
      raise exception 'member_weekly_goals: a goal in force or in the past cannot change'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function private.member_weekly_goals_history_guard() from public, anon, authenticated, service_role;

create trigger member_weekly_goals_history_guard
  before insert or update or delete on public.member_weekly_goals
  for each row execute function private.member_weekly_goals_history_guard();

-- ----------------------------------------------------------------------------
-- 4. Member RPCs
-- ----------------------------------------------------------------------------

-- Sets the caller's weekly goal from the next gym-local Monday. The caller is resolved live, as check_in does; there is no member id, no
-- date and no clock parameter. Returns (goal, effective_week, current_goal, current_goal_is_default): the goal now pending and its
-- Monday (NULL when nothing is pending afterwards), and the goal in force, which this call never changes.
create function public.set_weekly_goal(p_goal smallint)
returns table (goal smallint, effective_week date, current_goal smallint, current_goal_is_default boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_cfg platform_engagement_config;
  v_this_week date;
  v_next_week date;
  v_cur smallint;
  v_pending smallint;
  v_has_pending boolean;
  v_has_rows boolean;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- `is distinct from`, never `<>`: the helper returns NULL for a session with no resolvable gym, and a NULL must refuse.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'permission denied: gym % is not active', v_gym_id using errcode = '42501';
  end if;

  select * into v_cfg from platform_engagement_config limit 1;
  if p_goal is null or p_goal < v_cfg.goal_min or p_goal > v_cfg.goal_max then
    raise exception 'invalid_goal' using errcode = '22023';
  end if;

  -- Two calls by one member would otherwise both read the same pending row; the member row is the lock every member-owned write takes.
  perform 1 from members m where m.id = v_member_id for update;

  v_this_week := private.week_start_of(private.gym_today(v_gym_id));
  v_next_week := v_this_week + 7;

  select g.goal into v_cur
  from member_weekly_goals g
  where g.member_id = v_member_id and g.effective_week <= v_this_week
  order by g.effective_week desc
  limit 1;
  current_goal_is_default := v_cur is null;
  current_goal := coalesce(v_cur, v_cfg.goal_default::smallint);

  select g.goal, true into v_pending, v_has_pending
  from member_weekly_goals g
  where g.member_id = v_member_id and g.effective_week = v_next_week;
  v_has_pending := coalesce(v_has_pending, false);

  select exists (select 1 from member_weekly_goals g where g.member_id = v_member_id) into v_has_rows;

  if v_has_pending and p_goal = v_pending then
    -- Already the pending choice: nothing to write.
    null;
  elsif v_has_pending and p_goal = current_goal then
    -- Back to the goal in force: the pending change is cancelled.
    delete from member_weekly_goals g where g.member_id = v_member_id and g.effective_week = v_next_week;
    v_has_pending := false;
  elsif v_has_pending then
    update member_weekly_goals g set goal = p_goal where g.member_id = v_member_id and g.effective_week = v_next_week;
    v_pending := p_goal;
  elsif p_goal = current_goal and v_has_rows then
    -- The goal in force, nothing pending, history already explicit: nothing to write.
    null;
  else
    -- First goal (even one equal to the default) or a change: one explicit row at the next Monday.
    insert into member_weekly_goals (member_id, gym_id, effective_week, goal)
    values (v_member_id, v_gym_id, v_next_week, p_goal);
    v_has_pending := true;
    v_pending := p_goal;
  end if;

  if v_has_pending then
    goal := v_pending;
    effective_week := v_next_week;
  else
    goal := current_goal;
    effective_week := null;
  end if;
  return next;
end;
$function$;

-- The caller's goal in force, the pending change if any, the next Monday and the allowed range. No row for a caller who is not a live
-- member of an active gym. Writes nothing.
create function public.my_weekly_goal()
returns table (
  current_goal smallint,
  current_goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  next_effective_week date,
  goal_min integer,
  goal_max integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_cfg platform_engagement_config;
  v_this_week date;
  v_next_week date;
  v_cur smallint;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    return;
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  select m.id into v_member_id
  from members m
  where m.user_id = auth.uid() and m.gym_id = v_gym_id and m.deactivated_at is null
  order by m.created_at desc, m.id desc
  limit 1;

  if v_member_id is null then
    return;
  end if;

  -- Written without the `is distinct from` guard text on purpose: that text marks a status-guarded WRITE function, which must raise the
  -- `is not active` phrase (suspension_rpc_coverage.test.sql). This is a read that returns no row.
  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  select * into v_cfg from platform_engagement_config limit 1;

  v_this_week := private.week_start_of(private.gym_today(v_gym_id));
  v_next_week := v_this_week + 7;

  select g.goal into v_cur
  from member_weekly_goals g
  where g.member_id = v_member_id and g.effective_week <= v_this_week
  order by g.effective_week desc
  limit 1;

  current_goal_is_default := v_cur is null;
  current_goal := coalesce(v_cur, v_cfg.goal_default::smallint);

  select g.goal, g.effective_week into pending_goal, pending_effective_week
  from member_weekly_goals g
  where g.member_id = v_member_id and g.effective_week > v_this_week
  order by g.effective_week
  limit 1;

  next_effective_week := v_next_week;
  goal_min := v_cfg.goal_min;
  goal_max := v_cfg.goal_max;
  return next;
end;
$function$;

revoke execute on function public.set_weekly_goal(smallint) from public, anon, service_role;
revoke execute on function public.my_weekly_goal() from public, anon, service_role;
grant execute on function public.set_weekly_goal(smallint) to authenticated;
grant execute on function public.my_weekly_goal() to authenticated;

-- ----------------------------------------------------------------------------
-- Verify: any failure raises and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_cfg platform_engagement_config;
begin
  select * into v_cfg from public.platform_engagement_config;
  if (select count(*) from public.platform_engagement_config) <> 1
     or v_cfg.goal_min <> 1 or v_cfg.goal_max <> 7 or v_cfg.goal_default <> 3
     or v_cfg.shield_every_weeks <> 4 or v_cfg.shield_cap <> 2 or v_cfg.comeback_visits <> 3
     or v_cfg.comeback_window_days <> 10 or v_cfg.daily_streak_min <> 3 or v_cfg.release_week_start is not null then
    raise exception '0184: platform_engagement_config is not the seeded singleton';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.platform_engagement_config'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.member_weekly_goals'::regclass) then
    raise exception '0184: row level security is off on a new table';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'member_weekly_goals') then
    raise exception '0184: member_weekly_goals must have no policy';
  end if;

  if exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, 'public.member_weekly_goals', p)
  ) then
    raise exception '0184: a client role holds a privilege on member_weekly_goals';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'platform_engagement_config') <> 2 then
    raise exception '0184: platform_engagement_config must have exactly two policies';
  end if;

  if has_table_privilege('anon', 'public.platform_engagement_config', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_engagement_config', 'INSERT')
     or has_table_privilege('authenticated', 'public.platform_engagement_config', 'DELETE') then
    raise exception '0184: platform_engagement_config grants are wrong';
  end if;

  if has_function_privilege('anon', 'public.set_weekly_goal(smallint)', 'execute')
     or has_function_privilege('anon', 'public.my_weekly_goal()', 'execute')
     or not has_function_privilege('authenticated', 'public.set_weekly_goal(smallint)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_weekly_goal()', 'execute') then
    raise exception '0184: the weekly goal functions are not authenticated-only';
  end if;

  if to_regprocedure('private.gym_local_week_bounds(text, timestamptz)') is null
     or to_regprocedure('private.week_start_of(date)') is null
     or to_regprocedure('private.member_weekly_goals_history_guard()') is null
     or to_regprocedure('private.audit_platform_engagement_config_update()') is null then
    raise exception '0184: a private function is missing';
  end if;
end;
$verify$;
