-- ============================================================================
-- 0189: Milestones and celebration (Epic 30, Story 30.7; FR-225, FR-229, FR-232, NFR-028; AD-53, AD-56).
--
-- A member who reaches their 7th, 30th or 100th visit day gets recognition once, the calendar marks those days, and pending_milestone stops
-- being a constant NULL. Production is live and the engagement epoch (platform_engagement_config.release_week_start) is NULL, so while it is
-- NULL nothing here writes a row or changes what any member reads.
--   1. private.award_milestones(member): the only writer of `milestone` facts. Reads member_visit_days only. For each of 7, 30 and 100 that
--      the member's distinct visit-day count has reached and for which no fact exists, it inserts ONE fact (kind 'milestone', subject_key the
--      number, revision 1). The fact is `silent` (and already acknowledged) when the Nth distinct day falls before the epoch Monday: history at
--      release is recognised without a celebration. It is decided once and never recomputed; a void or a late visit moves only the calendar
--      marker (derived live in my_visit_days), never the fact.
--   2. private.settle_engagement is re-created from the 0185 body with ONE added line: the call of award_milestones before the final return.
--      It is the only caller. record_check_in, void_staff_check_in and check_in() are not touched: a check-in only marks dirty_from, and the
--      read that follows (open_engagement) settles and so awards.
--   3. private.engagement_state_view_at: pending_milestone is now the highest unacknowledged, non-silent milestone number (row type unchanged).
--   4. public.acknowledge_milestone(smallint): the only function that sets acknowledged_at (through the transaction-local flag the 0185
--      append-only guard requires). It acknowledges the number shown and every lower unacknowledged milestone of the caller.
--   5. public.my_visit_days(month): the `milestone` column is now derived from the ordered distinct days (7, 30 or 100), never stored.
--   6. private.engagement_derived_state and private.rebuild_engagement gain a `milestones` jsonb array (the OUT columns change, so both are
--      dropped and re-created; no other object depends on them).
--
-- Rollback: scripts/rollback-0189-milestones-celebration.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. private.award_milestones
-- ----------------------------------------------------------------------------
create function private.award_milestones(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
  v_epoch date;
  v_threshold integer;
  v_nth date;
  v_silent boolean;
begin
  select m.gym_id into v_gym_id from members m where m.id = p_member_id;
  if v_gym_id is null then
    return;
  end if;

  -- Dark: nothing is awarded.
  select c.release_week_start into v_epoch from platform_engagement_config c limit 1;
  if v_epoch is null then
    return;
  end if;

  foreach v_threshold in array array[7, 30, 100] loop
    -- The Nth distinct visit day, in order. NULL when the member has not reached N days.
    select d.visit_day into v_nth
    from member_visit_days d
    where d.member_id = p_member_id and d.gym_id = v_gym_id
    order by d.visit_day
    offset v_threshold - 1
    limit 1;

    exit when v_nth is null;

    v_silent := v_nth < v_epoch;

    insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, silent, acknowledged_at)
    values (p_member_id, v_gym_id, 'milestone', v_threshold::text, 1, v_silent, case when v_silent then now() end)
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function private.award_milestones(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. private.settle_engagement: the 0185 body plus one call before the final return
-- ----------------------------------------------------------------------------
create or replace function private.settle_engagement(p_member_id uuid, p_gym_id uuid, p_up_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_epoch date;
  v_last_closed date;
  v_first_day date;
  v_start date;
  v_state engagement_state;
  v_has_state boolean;
  v_from date;
  v_dirty_week date;
  v_keep_dirty date;
  v_evaluated boolean;
  v_written integer := 0;
  r record;
begin
  perform 1 from members m where m.id = p_member_id and m.gym_id = p_gym_id for no key update;
  if not found then
    raise exception 'settle_engagement: member % is not a member of gym %', p_member_id, p_gym_id;
  end if;

  if p_up_to is null then
    raise exception 'settle_engagement: p_up_to is required';
  end if;

  select c.release_week_start into v_epoch from platform_engagement_config c limit 1;
  if v_epoch is null then
    return 0;
  end if;

  select * into v_state from engagement_state s where s.member_id = p_member_id;
  v_has_state := found;

  select min(d.visit_day) into v_first_day
  from member_visit_days d
  where d.member_id = p_member_id and d.gym_id = p_gym_id;

  if v_first_day is null then
    -- Dormant: no counted visit day, nothing to settle. A mark left by a check-in that was voided since is cleared.
    if v_has_state and v_state.dirty_from is not null then
      update engagement_state s set dirty_from = null, updated_at = now() where s.member_id = p_member_id;
    end if;
    return 0;
  end if;

  v_last_closed := private.week_start_of(p_up_to) - 7;
  v_start := greatest(v_epoch, private.week_start_of(v_first_day));
  v_evaluated := v_last_closed >= v_start;

  v_dirty_week := private.week_start_of(v_state.dirty_from);
  if v_state.settled_through is null then
    v_from := v_start;
  else
    v_from := greatest(v_start, least(coalesce(v_dirty_week, v_state.settled_through + 7), v_state.settled_through + 7));
  end if;

  if v_evaluated then
    for r in
      select e.week, e.visits, e.goal, e.outcome, e.revision
      from private.engagement_evaluate_weeks(p_member_id, p_gym_id, v_from, v_last_closed) e
      where e.changed
      order by e.week
    loop
      insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
      values (p_member_id, p_gym_id, 'week', to_char(r.week, 'YYYY-MM-DD'), r.revision + 1, r.outcome, r.goal, r.visits);
      v_written := v_written + 1;
    end loop;
  end if;

  -- The mark is consumed unless this run could not reach it: a dirty week after the last closed week but inside the settled range can only
  -- be seen when the clock went backwards across a Monday (a gym timezone change), and it must survive to the next run.
  if v_dirty_week is not null and v_dirty_week > v_last_closed and v_dirty_week <= v_state.settled_through then
    v_keep_dirty := v_state.dirty_from;
  end if;

  if v_evaluated or v_has_state then
    insert into engagement_state (member_id, gym_id, settled_through, dirty_from, updated_at)
    values (p_member_id, p_gym_id, case when v_evaluated then v_last_closed end, v_keep_dirty, now())
    on conflict (member_id) do update
      set settled_through = greatest(engagement_state.settled_through, excluded.settled_through),
          dirty_from = excluded.dirty_from,
          updated_at = now()
      where engagement_state.settled_through is distinct from greatest(engagement_state.settled_through, excluded.settled_through)
         or engagement_state.dirty_from is distinct from excluded.dirty_from;
  end if;

  -- 30.7: the only call of award_milestones. Dark and dormant members returned above; the written count stays the week facts only.
  perform private.award_milestones(p_member_id);

  return v_written;
end;
$$;

revoke execute on function private.settle_engagement(uuid, uuid, date) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. private.engagement_state_view_at: a real pending_milestone. Same row type (create or replace refuses a different one). The highest
-- non-silent milestone of the member whose acknowledged_at is NULL, else NULL. Only `milestone` rows reach the cast.
-- ----------------------------------------------------------------------------
create or replace function private.engagement_state_view_at(p_member_id uuid, p_now timestamptz)
returns
table (
  enabled boolean,
  gym_today date,
  week_start date,
  week_end date,
  in_release_week boolean,
  goal smallint,
  goal_is_default boolean,
  pending_goal smallint,
  pending_effective_week date,
  visits_this_week integer,
  goal_met boolean,
  visited_today boolean,
  streak_weeks integer,
  streak_if_met integer,
  best_streak_weeks integer,
  has_settled_week boolean,
  days_left_in_week integer,
  visits_needed integer,
  at_risk_weekly boolean,
  at_risk_daily boolean,
  daily_run integer,
  shields_held integer,
  comeback_state text,
  day_starts_at timestamptz,
  day_ends_at timestamptz,
  server_now timestamptz,
  needs_settle boolean,
  pending_milestone smallint
)
language sql
stable
set search_path = public, pg_temp
as $$
  with t as (
    select m.id as member_id, m.gym_id,
           coalesce(nullif(btrim(g.timezone), ''), 'UTC') as tz,
           (p_now at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC'))::date as today
    from public.members m
    join public.gyms g on g.id = m.gym_id
    where m.id = p_member_id
  ),
  w as (
    select t.*, private.week_start_of(t.today) as ws from t
  ),
  cfg as (
    select c.release_week_start as epoch, c.goal_default from public.platform_engagement_config c limit 1
  ),
  a as (
    select
      w.member_id, w.gym_id, w.tz, w.today, w.ws,
      cfg.epoch,
      coalesce(
        (select g.goal from public.member_weekly_goals g where g.member_id = w.member_id and g.effective_week <= w.ws
          order by g.effective_week desc limit 1),
        cfg.goal_default::smallint
      ) as goal,
      not exists (select 1 from public.member_weekly_goals g where g.member_id = w.member_id) as goal_is_default,
      pg.goal as pending_goal,
      pg.effective_week as pending_week,
      (select count(*)::integer from public.member_visit_days d
        where d.member_id = w.member_id and d.gym_id = w.gym_id and d.visit_day between w.ws and w.ws + 6) as visits,
      exists (select 1 from public.member_visit_days d
        where d.member_id = w.member_id and d.gym_id = w.gym_id and d.visit_day = w.today) as visited_today,
      (select private.week_start_of(min(d.visit_day)) from public.member_visit_days d where d.member_id = w.member_id and d.gym_id = w.gym_id) as first_week,
      f.streak_weeks, f.best_streak_weeks, f.last_settled_week,
      (select s.status from public.subscriptions s where s.member_id = w.member_id order by s.created_at desc limit 1) as sub_status,
      st.settled_through, st.dirty_from
    from w
    cross join cfg
    left join lateral (
      select g.goal, g.effective_week from public.member_weekly_goals g
      where g.member_id = w.member_id and g.effective_week > w.ws
      order by g.effective_week limit 1
    ) pg on true
    cross join lateral private.engagement_fold(w.member_id) f
    left join public.engagement_state st on st.member_id = w.member_id
  ),
  b as (
    select
      a.*,
      a.epoch is not null as enabled,
      a.epoch is not null and a.ws < a.epoch as in_release,
      a.ws + 6 as we,
      (a.ws + 6 - a.today + 1) as days_left,
      a.visits >= a.goal as goal_met,
      greatest(a.goal - a.visits, 0) as needed
    from a
  )
  select
    b.enabled,
    b.today,
    b.ws,
    b.we,
    b.in_release,
    b.goal,
    b.goal_is_default,
    b.pending_goal,
    b.pending_week,
    b.visits,
    b.goal_met,
    b.visited_today,
    b.streak_weeks,
    case when b.enabled and not b.in_release and b.goal_met then b.streak_weeks + 1 end,
    b.best_streak_weeks,
    b.last_settled_week is not null,
    b.days_left,
    b.needed,
    b.enabled and not b.in_release and not b.visited_today and not b.goal_met
      and b.needed = b.days_left and b.sub_status is not null and b.sub_status <> 'expired',
    false,
    null::integer,
    0,
    'none'::text,
    bd.day_start,
    bd.next_day_start,
    p_now,
    case
      when not b.enabled then false
      when b.dirty_from is not null then true
      else coalesce(b.first_week <= b.ws - 7, false)
           and (b.settled_through is null or b.settled_through < b.ws - 7)
           and b.ws - 7 >= b.epoch
    end,
    (select max(f.subject_key::smallint) from public.engagement_facts f
      where f.member_id = b.member_id and f.kind = 'milestone' and not f.silent and f.acknowledged_at is null)
  from b
  cross join lateral private.gym_local_day_bounds(b.tz, p_now) bd;
$$;

revoke execute on function private.engagement_state_view_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. public.acknowledge_milestone(p_milestone): the only function that sets acknowledged_at. The caller is resolved live, in the order of
-- set_weekly_goal (member role, gym, own non-deactivated member row, active gym); there is no member id, so nothing can cross members or gyms.
--   * a number other than 7, 30 or 100 raises invalid_milestone (22023) before anything is written.
--   * the member row is locked (`for update`, the lock every member-owned write takes), then a milestone the member does not hold returns NULL
--     and writes nothing.
--   * a held milestone: acknowledged_at = now() on it and on every LOWER unacknowledged milestone (the app shows only the highest), by raising
--     the transaction-local flag the append-only guard requires and dropping it straight after. No other column is touched. Returns the number
--     (acknowledged now or earlier); a second call writes nothing and returns the same.
-- ----------------------------------------------------------------------------
create function public.acknowledge_milestone(p_milestone smallint)
returns smallint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_held boolean;
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

  if p_milestone is null or p_milestone not in (7, 30, 100) then
    raise exception 'invalid_milestone' using errcode = '22023';
  end if;

  perform 1 from members m where m.id = v_member_id for update;

  select exists (
    select 1 from engagement_facts f
    where f.member_id = v_member_id and f.kind = 'milestone' and f.subject_key = p_milestone::text
  ) into v_held;

  if not v_held then
    return null;
  end if;

  perform set_config('app.engagement_acknowledge', 'on', true);

  update engagement_facts f
  set acknowledged_at = now()
  where f.member_id = v_member_id
    and f.kind = 'milestone'
    and f.acknowledged_at is null
    and f.subject_key in (select t::text from unnest(array[7, 30, 100]) t where t <= p_milestone);

  perform set_config('app.engagement_acknowledge', 'off', true);

  return p_milestone;
end;
$function$;

revoke execute on function public.acknowledge_milestone(smallint) from public, anon, service_role;
grant execute on function public.acknowledge_milestone(smallint) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. public.my_visit_days: the milestone column. The ordinal of a day among ALL the member's distinct days (a CTE over the whole history), the
-- month filter applied afterwards, so the 7th day of a March month shows in March whenever it is read. Same signature and caller guards.
-- ----------------------------------------------------------------------------
create or replace function public.my_visit_days(p_month date)
returns table (visit_day date, milestone smallint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
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

  -- A read that returns no row (see my_engagement): written without the `is distinct from` guard text on purpose.
  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  -- Checked after the caller is known to be a live member, so a wrong caller learns nothing about months.
  if p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or p_month > date_trunc('month', private.gym_today(v_gym_id))::date then
    raise exception 'invalid_month' using errcode = '22023';
  end if;

  return query
    with ranked as (
      select d.visit_day, row_number() over (order by d.visit_day) as rn
      from public.member_visit_days d
      where d.member_id = v_member_id and d.gym_id = v_gym_id
    )
    select r.visit_day, case when r.rn in (7, 30, 100) then r.rn::smallint end
    from ranked r
    where r.visit_day >= p_month
      and r.visit_day < (p_month + interval '1 month')::date
    order by r.visit_day;
end;
$function$;

revoke execute on function public.my_visit_days(date) from public, anon, service_role;
grant execute on function public.my_visit_days(date) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. The two states the determinism tests compare, with `milestones`: the sorted jsonb array of the milestone numbers reached.
--   engagement_derived_state  the effective milestone facts, silent ones included.
--   rebuild_engagement        the thresholds reached by the member's distinct visit-day count; [] when the epoch is NULL.
-- A void that drops the count below a threshold is not comparable (the fact keeps the milestone, a rebuild would not award it): a void never
-- reverses a milestone.
-- ----------------------------------------------------------------------------
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);

create function private.engagement_derived_state(p_member_id uuid)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date, weeks jsonb, milestones jsonb)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  return query
  select
    f.streak_weeks,
    f.best_streak_weeks,
    f.last_settled_week,
    (select coalesce(
              jsonb_agg(jsonb_build_object('week', e.subject_key, 'visits', e.visits, 'goal', e.goal::integer, 'outcome', e.outcome)
                        order by e.subject_key),
              '[]'::jsonb)
       from private.effective_engagement_facts(p_member_id) e
      where e.kind = 'week'),
    (select coalesce(jsonb_agg(e.subject_key::integer order by e.subject_key::integer), '[]'::jsonb)
       from private.effective_engagement_facts(p_member_id) e
      where e.kind = 'milestone')
  from private.engagement_fold(p_member_id) f;
end;
$$;

revoke execute on function private.engagement_derived_state(uuid) from public, anon, authenticated, service_role;

create function private.rebuild_engagement(p_member_id uuid, p_up_to date)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date, weeks jsonb, milestones jsonb)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_epoch date;
  v_first_day date;
  v_start date;
  v_gym_id uuid;
  v_weeks jsonb := '[]'::jsonb;
  v_milestones jsonb := '[]'::jsonb;
begin
  select c.release_week_start into v_epoch from platform_engagement_config c limit 1;
  select m.gym_id into v_gym_id from members m where m.id = p_member_id;

  if v_epoch is not null and v_gym_id is not null then
    -- A threshold is reached when the member has a Nth distinct day (the same ordered read the award makes).
    select coalesce(jsonb_agg(t order by t), '[]'::jsonb) into v_milestones
    from unnest(array[7, 30, 100]) t
    where (select d.visit_day from member_visit_days d
            where d.member_id = p_member_id and d.gym_id = v_gym_id
            order by d.visit_day offset t - 1 limit 1) is not null;
  end if;

  if v_epoch is not null and v_gym_id is not null and p_up_to is not null then
    select min(d.visit_day) into v_first_day
    from member_visit_days d
    where d.member_id = p_member_id and d.gym_id = v_gym_id;

    if v_first_day is not null then
      v_start := greatest(v_epoch, private.week_start_of(v_first_day));
      select coalesce(jsonb_agg(jsonb_build_object('week', to_char(e.week, 'YYYY-MM-DD'), 'visits', e.visits, 'goal', e.goal, 'outcome', e.outcome)
                                order by e.week), '[]'::jsonb)
        into v_weeks
      from private.engagement_evaluate_weeks(p_member_id, v_gym_id, v_start, private.week_start_of(p_up_to) - 7) e;
    end if;
  end if;

  return query
  select
    h.streak_weeks,
    h.best_streak_weeks,
    h.last_settled_week,
    v_weeks,
    v_milestones
  from private.engagement_fold_weeks(
         (select coalesce(jsonb_agg(jsonb_build_object('week', w ->> 'week', 'outcome', w ->> 'outcome') order by w ->> 'week'), '[]'::jsonb)
            from jsonb_array_elements(v_weeks) w)
       ) h;
end;
$$;

revoke execute on function private.rebuild_engagement(uuid, date) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Verify: any failure raises and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
  v_result text;
begin
  foreach v_fn in array array[
    'private.award_milestones(uuid)',
    'private.settle_engagement(uuid, uuid, date)',
    'private.engagement_state_view_at(uuid, timestamptz)',
    'private.engagement_derived_state(uuid)',
    'private.rebuild_engagement(uuid, date)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0189: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute') then
      raise exception '0189: % is executable by a client role', v_fn;
    end if;
  end loop;

  foreach v_fn in array array['public.acknowledge_milestone(smallint)', 'public.my_visit_days(date)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0189: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute')
       or not has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute') then
      raise exception '0189: % has the wrong grants (authenticated only)', v_fn;
    end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(v_fn)) then
      raise exception '0189: % is not SECURITY DEFINER', v_fn;
    end if;
  end loop;

  if not (select prosecdef from pg_proc where oid = 'private.award_milestones(uuid)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure) then
    raise exception '0189: award_milestones and settle_engagement must be SECURITY DEFINER';
  end if;

  -- The view family still shares one row type.
  select pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) into v_result;
  if pg_get_function_result('private.engagement_state_view(uuid)'::regprocedure) is distinct from v_result
     or pg_get_function_result('private.open_engagement_at(uuid, timestamptz)'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.my_engagement()'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.open_engagement()'::regprocedure) is distinct from v_result then
    raise exception '0189: the state view family no longer shares one row type';
  end if;

  -- award_milestones is called from settle only, among the functions that exist today. (That no function but acknowledge_milestone raises the
  -- acknowledge flag is not checked here; the scan lives in engagement_milestones.test.sql.)
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc like '%award_milestones%'
      and p.oid not in ('private.settle_engagement(uuid, uuid, date)'::regprocedure, 'private.award_milestones(uuid)'::regprocedure)
  ) then
    raise exception '0189: a function other than settle_engagement calls award_milestones';
  end if;
end;
$verify$;
