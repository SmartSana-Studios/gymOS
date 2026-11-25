-- Rollback for migration 0190: Streak Shields and the comeback (Epic 31, Story 31.1).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0190-streak-shields-comeback.sql
--
-- Drops public.my_saved_weeks and every function 0190 added (the Shield and comeback walks, the comeback fold and live progress, the day-path
-- guard and reservation rule, the parameter reader) and restores the shapes 0190 replaced: engagement_evaluate_weeks (0185, with the "saved
-- stays saved" stand-in), engagement_fold (0185, shields 0 and comeback none), settle_engagement (0189, no comeback step), the state view family
-- (0186 with the 0189 pending_milestone: shields_held 0, comeback_state 'none', streak_weeks 0 again), engagement_derived_state and
-- rebuild_engagement (0189).
-- FACTS already written are LEFT in place: `week` facts with outcome `saved`, and every `comeback` fact. The append-only guard of
-- engagement_facts forbids deleting them, and a re-applied 0190 finds them (its settle only appends revisions for what changed). While they
-- exist and 0190 is rolled back, the restored fold still folds `saved` as "the run is unchanged" and ignores comeback facts, so no Shield and
-- no comeback shows. Roll back the Story 31.1 mobile app first: it reads the new view columns and calls my_saved_weeks.
set local lock_timeout = '5s';

drop function public.my_saved_weeks(date);

drop function public.open_engagement();
drop function public.my_engagement();
drop function private.open_engagement_at(uuid, timestamptz);
drop function private.engagement_state_view(uuid);
drop function private.engagement_state_view_at(uuid, timestamptz);
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);
drop function private.engagement_fold(uuid);

-- engagement_fold as 0185 created it (shields 0, comeback none).
create function private.engagement_fold(p_member_id uuid)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date, shields_held integer, comeback_state text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_weeks jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('week', f.subject_key, 'outcome', f.outcome) order by f.subject_key), '[]'::jsonb)
    into v_weeks
  from private.effective_engagement_facts(p_member_id) f
  where f.kind = 'week';

  return query
  select h.streak_weeks, h.best_streak_weeks, h.last_settled_week, 0, 'none'::text
  from private.engagement_fold_weeks(v_weeks) h;
end;
$$;

revoke execute on function private.engagement_fold(uuid) from public, anon, authenticated, service_role;

-- engagement_state_view_at as 0189 left it (constant shields 0 and comeback none, the real pending_milestone).
create function private.engagement_state_view_at(p_member_id uuid, p_now timestamptz)
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

-- The rest of the view family as 0186 created it.
create function private.engagement_state_view(p_member_id uuid)
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
  select * from private.engagement_state_view_at(p_member_id, now());
$$;

create function private.open_engagement_at(p_member_id uuid, p_now timestamptz)
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
language plpgsql
volatile
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_today date;
begin
  select m.gym_id, (p_now at time zone coalesce(nullif(btrim(g.timezone), ''), 'UTC'))::date
    into v_gym_id, v_today
  from public.members m
  join public.gyms g on g.id = m.gym_id
  where m.id = p_member_id;

  if v_gym_id is null then
    return;
  end if;

  perform private.settle_engagement(p_member_id, v_gym_id, v_today);

  return query select * from private.engagement_state_view_at(p_member_id, p_now);
end;
$$;

revoke execute on function private.engagement_state_view_at(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function private.engagement_state_view(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.open_engagement_at(uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.my_engagement()
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

  -- Written without the `is distinct from` guard text on purpose: that text marks a status-guarded WRITE function, which must raise the
  -- `is not active` phrase (suspension_rpc_coverage.test.sql). This is a read that returns no row.
  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  return query select * from private.engagement_state_view_at(v_member_id, now());
end;
$function$;

create function public.open_engagement()
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
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
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

  return query select * from private.open_engagement_at(v_member_id, now());
end;
$function$;

revoke execute on function public.my_engagement() from public, anon, authenticated, service_role;
revoke execute on function public.open_engagement() from public, anon, authenticated, service_role;
grant execute on function public.my_engagement() to authenticated;
grant execute on function public.open_engagement() to authenticated;

-- engagement_derived_state and rebuild_engagement as 0189 created them.
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

-- engagement_evaluate_weeks as 0185 created it (the stand-in saved rule).
create or replace function private.engagement_evaluate_weeks(p_member_id uuid, p_gym_id uuid, p_from date, p_to date)
returns table (week date, visits integer, goal integer, outcome text, revision integer, changed boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  with weeks as (
    select p_from + 7 * i as week
    from generate_series(0, (p_to - p_from) / 7) as i
    where p_from is not null and p_to >= p_from
  ),
  counts as (
    select w.week, count(d.visit_day)::integer as visits
    from weeks w
    left join public.member_visit_days d
      on d.member_id = p_member_id and d.gym_id = p_gym_id and d.visit_day between w.week and w.week + 6
    group by w.week
  ),
  eff as (
    select e.subject_key::date as week, e.revision, e.outcome, e.goal, e.visits
    from private.effective_engagement_facts(p_member_id) e
    where e.kind = 'week'
  ),
  base as (
    select
      c.week,
      c.visits,
      eff.revision as prev_revision,
      eff.outcome as prev_outcome,
      eff.goal::integer as prev_goal,
      eff.visits as prev_visits,
      coalesce(
        eff.goal::integer,
        (select g.goal::integer from public.member_weekly_goals g
          where g.member_id = p_member_id and g.effective_week <= c.week
          order by g.effective_week desc limit 1),
        (select cfg.goal_default from public.platform_engagement_config cfg limit 1)
      ) as goal
    from counts c
    left join eff on eff.week = c.week
  ),
  scored as (
    select
      b.*,
      case
        when b.visits >= b.goal then 'met'
        when b.prev_outcome = 'saved' then 'saved'
        else 'missed'
      end as outcome
    from base b
  )
  select
    s.week,
    s.visits,
    s.goal,
    s.outcome,
    coalesce(s.prev_revision, 0),
    s.prev_revision is null
      or (s.outcome, s.goal, s.visits) is distinct from (s.prev_outcome, s.prev_goal, s.prev_visits)
  from scored s
  order by s.week;
$$;

revoke execute on function private.engagement_evaluate_weeks(uuid, uuid, date, date) from public, anon, authenticated, service_role;

-- settle_engagement as 0189 created it (the award call, no comeback step).
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

-- The objects 0190 added.
drop function private.engagement_day_reservation(integer, integer, boolean);
drop function private.engagement_daily_streak_enabled();
drop function private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer);
drop function private.engagement_comeback_fold(jsonb, jsonb, integer);
drop function private.engagement_comeback_walk(jsonb, date[], date, integer, integer);
drop function private.engagement_shield_walk(jsonb, boolean, integer, integer);
drop function private.engagement_shield_params();

do $verify$
begin
  if to_regprocedure('public.my_saved_weeks(date)') is not null or to_regprocedure('private.engagement_shield_walk(jsonb, boolean, integer, integer)') is not null then
    raise exception 'rollback 0190: an object of 0190 is still there';
  end if;
  if pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) ~ 'shield_every_weeks' then
    raise exception 'rollback 0190: the view still has the 0190 columns';
  end if;
  if pg_get_function_result('public.my_engagement()'::regprocedure) is distinct from pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure)
     or pg_get_function_result('public.open_engagement()'::regprocedure) is distinct from pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) then
    raise exception 'rollback 0190: the state view family no longer shares one row type';
  end if;
end;
$verify$;
