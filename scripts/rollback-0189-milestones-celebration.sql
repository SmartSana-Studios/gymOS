-- Rollback for migration 0189: milestones and celebration (Epic 30, Story 30.7).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0189-milestones-celebration.sql
--
-- Drops acknowledge_milestone and award_milestones and restores the shapes of the functions 0189 replaced: settle_engagement without the
-- award call (0185), engagement_state_view_at with the constant NULL pending_milestone (0186), my_visit_days with the NULL milestone (0187),
-- and engagement_derived_state / rebuild_engagement without the `milestones` column (0185).
-- Milestone FACTS already written are LEFT in place: the append-only guard of engagement_facts forbids deleting them, and a re-applied 0189
-- finds them (award is idempotent). While they exist and 0189 is rolled back, pending_milestone is NULL, so no celebration shows.
-- Roll back the Story 30.7 mobile app first, because it calls acknowledge_milestone. This script does not depend on 0188's rollback and can run
-- before or after it.
set local lock_timeout = '5s';

drop function public.acknowledge_milestone(smallint);

-- settle_engagement as 0185 created it (no award call).
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

  return v_written;
end;
$$;

revoke execute on function private.settle_engagement(uuid, uuid, date) from public, anon, authenticated, service_role;

drop function private.award_milestones(uuid);

-- The state view with the constant NULL pending_milestone (0186).
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
    null::smallint
  from b
  cross join lateral private.gym_local_day_bounds(b.tz, p_now) bd;
$$;

revoke execute on function private.engagement_state_view_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- my_visit_days with the NULL milestone (0187).
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
    select d.visit_day, null::smallint
    from public.member_visit_days d
    where d.member_id = v_member_id
      and d.gym_id = v_gym_id
      and d.visit_day >= p_month
      and d.visit_day < (p_month + interval '1 month')::date
    order by d.visit_day;
end;
$function$;

revoke execute on function public.my_visit_days(date) from public, anon, service_role;
grant execute on function public.my_visit_days(date) to authenticated;

-- The two states without `milestones` (0185). The OUT columns change, so drop and create.
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);

create function private.engagement_derived_state(p_member_id uuid)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date, weeks jsonb)
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
      where e.kind = 'week')
  from private.engagement_fold(p_member_id) f;
end;
$$;

revoke execute on function private.engagement_derived_state(uuid) from public, anon, authenticated, service_role;

create function private.rebuild_engagement(p_member_id uuid, p_up_to date)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date, weeks jsonb)
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
begin
  select c.release_week_start into v_epoch from platform_engagement_config c limit 1;
  select m.gym_id into v_gym_id from members m where m.id = p_member_id;

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
    v_weeks
  from private.engagement_fold_weeks(
         (select coalesce(jsonb_agg(jsonb_build_object('week', w ->> 'week', 'outcome', w ->> 'outcome') order by w ->> 'week'), '[]'::jsonb)
            from jsonb_array_elements(v_weeks) w)
       ) h;
end;
$$;

revoke execute on function private.rebuild_engagement(uuid, date) from public, anon, authenticated, service_role;

do $verify$
begin
  if to_regprocedure('public.acknowledge_milestone(smallint)') is not null
     or to_regprocedure('private.award_milestones(uuid)') is not null then
    raise exception '0189 rollback: a milestone function still exists';
  end if;

  if (select count(*) from pg_proc p where p.oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure and p.prosrc like '%award_milestones%') <> 0 then
    raise exception '0189 rollback: settle_engagement still calls award_milestones';
  end if;

  if pg_get_function_result('private.engagement_derived_state(uuid)'::regprocedure) like '%milestones%'
     or pg_get_function_result('private.rebuild_engagement(uuid, date)'::regprocedure) like '%milestones%' then
    raise exception '0189 rollback: the derived or rebuild state still has a milestones column';
  end if;

  if (select p.prosrc from pg_proc p where p.oid = 'private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) like '%engagement_facts%' then
    raise exception '0189 rollback: the state view still reads milestone facts';
  end if;

  if (select p.prosrc from pg_proc p where p.oid = 'public.my_visit_days(date)'::regprocedure) like '%row_number%' then
    raise exception '0189 rollback: my_visit_days still derives the milestone';
  end if;

  if has_function_privilege('anon', 'public.my_visit_days(date)'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.my_visit_days(date)'::regprocedure, 'execute') then
    raise exception '0189 rollback: my_visit_days grants are wrong';
  end if;
end;
$verify$;
