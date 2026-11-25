-- Rollback for migration 0192: Badges (Epic 31, Story 31.3).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0192-badges.sql
--
-- Drops public.get_my_badges, private.backfill_badges and private.engagement_first_shield_week, restores private.award_milestones to the 0189 body (the 7, 30 and 100
-- milestone facts only, no badge) and private.engagement_derived_state and private.rebuild_engagement to the 0190 shape (no `badges` column).
-- BADGE FACTS ALREADY WRITTEN STAY in engagement_facts (the release back-fill and every award): the append-only guard forbids deleting them, and
-- a re-applied 0192 finds them (every writer is `revision 1 ... on conflict do nothing`, so nothing is duplicated and every stored earned_on wins).
-- While they exist and 0192 is rolled back nothing reads them. Roll back the Story 31.3 mobile app first: it calls get_my_badges.
set local lock_timeout = '5s';

drop function public.get_my_badges();
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);
drop function private.engagement_first_shield_week(uuid);
drop function private.backfill_badges();

-- private.award_milestones as 0189 created it.
create or replace function private.award_milestones(p_member_id uuid)
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

-- engagement_derived_state and rebuild_engagement as 0190 created them.
create function private.engagement_derived_state(p_member_id uuid)
returns table (
  streak_weeks integer,
  best_streak_weeks integer,
  last_settled_week date,
  weeks jsonb,
  milestones jsonb,
  shields_held integer,
  comeback jsonb
)
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
      where e.kind = 'milestone'),
    f.shields_held,
    (select jsonb_build_object('state', cb.state, 'visits_done', cb.visits_done, 'window_start', cb.window_start)
       from public.members m
       cross join private.engagement_shield_params() p
       cross join lateral private.engagement_comeback_live(m.id, m.gym_id, f.comeback_state, f.comeback_anchor, null, p.comeback_visits, p.comeback_window_days) cb
      where m.id = p_member_id)
  from private.engagement_fold(p_member_id) f;
end;
$$;

revoke execute on function private.engagement_derived_state(uuid) from public, anon, authenticated, service_role;

create function private.rebuild_engagement(p_member_id uuid, p_up_to date)
returns table (
  streak_weeks integer,
  best_streak_weeks integer,
  last_settled_week date,
  weeks jsonb,
  milestones jsonb,
  shields_held integer,
  comeback jsonb
)
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
  v_decided jsonb := '[]'::jsonb;
  v_days date[] := '{}'::date[];
  v_every integer;
  v_cap integer;
  v_visits integer;
  v_window integer;
  v_facts jsonb;
  v_cb record;
  v_live record;
begin
  select c.release_week_start into v_epoch from platform_engagement_config c limit 1;
  select m.gym_id into v_gym_id from members m where m.id = p_member_id;
  select p.shield_every_weeks, p.shield_cap, p.comeback_visits, p.comeback_window_days
    into v_every, v_cap, v_visits, v_window
  from private.engagement_shield_params() p;

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

      select coalesce(array_agg(d.visit_day order by d.visit_day), '{}'::date[]) into v_days
      from member_visit_days d
      where d.member_id = p_member_id and d.gym_id = v_gym_id and d.visit_day >= v_start;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('week', w ->> 'week', 'outcome', w ->> 'outcome') order by w ->> 'week'), '[]'::jsonb)
    into v_decided
  from jsonb_array_elements(v_weeks) w;

  select coalesce(jsonb_agg(jsonb_build_object('key', k.subject_key, 'outcome', k.outcome, 'completed_by', k.completed_by) order by k.subject_key), '[]'::jsonb)
    into v_facts
  from private.engagement_comeback_walk(v_decided, v_days, p_up_to, v_visits, v_window) k;

  select * into v_cb from private.engagement_comeback_fold(v_facts, v_decided, v_window);
  select * into v_live
  from private.engagement_comeback_live(p_member_id, v_gym_id, v_cb.state, v_cb.anchor, null, v_visits, v_window);

  return query
  select
    coalesce(l.streak_weeks, 0),
    coalesce(l.best_streak_weeks, 0),
    l.week,
    v_weeks,
    v_milestones,
    coalesce(l.shields_held, 0),
    jsonb_build_object('state', v_live.state, 'visits_done', v_live.visits_done, 'window_start', v_live.window_start)
  from (select 1) one
  left join lateral (
    select * from private.engagement_shield_walk(v_decided, false, v_every, v_cap) x order by x.week desc limit 1
  ) l on true;
end;
$$;

revoke execute on function private.rebuild_engagement(uuid, date) from public, anon, authenticated, service_role;

do $verify$
begin
  if to_regprocedure('public.get_my_badges()') is not null or to_regprocedure('private.engagement_first_shield_week(uuid)') is not null or to_regprocedure('private.backfill_badges()') is not null then
    raise exception 'rollback 0192: a function survived';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('private.engagement_derived_state(uuid)'::regprocedure, 'private.rebuild_engagement(uuid, date)'::regprocedure)
             and pg_get_function_result(p.oid) ~ 'badges') then
    raise exception 'rollback 0192: a state function still returns badges';
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'private.award_milestones(uuid)'::regprocedure) ~ 'badge' then
    raise exception 'rollback 0192: award_milestones still names a badge';
  end if;
end;
$verify$;
