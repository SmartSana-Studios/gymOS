-- ============================================================================
-- 0190: Streak Shields and the comeback (Epic 31, Story 31.1; FR-222, FR-223, FR-232, NFR-028; AD-53, AD-19, AD-61).
--
-- Epic 30's fold treats every missed week as a broken streak: shields_held and comeback_state are constants (0, 'none') and
-- engagement_evaluate_weeks holds a stand-in "saved stays saved" rule. Production is live and the engagement epoch
-- (platform_engagement_config.release_week_start) is NULL, so while it is NULL nothing here writes a row or changes what any member reads.
--
--   1. private.engagement_shield_walk: the ONE pure walk over weeks in order, carrying (met-week count of the run, Shields held, best).
--      A met week raises the run; every shield_every_weeks-th met week of a run earns one Shield, never stored above shield_cap. In decide
--      mode (settle, rebuild) a week below its goal inside a run with a Shield held is `saved` (held - 1, run and best unchanged, a saved
--      week adds nothing and does not count toward the next Shield), otherwise `missed` (the run ends, held is 0). In fact mode (the fold)
--      the stored outcomes are applied as they are. No Shield or counter is stored anywhere: the number held is a fold of effective week facts.
--   2. private.engagement_evaluate_weeks keeps counting visits and freezing the goal per week, and now decides each outcome by that walk from
--      the member's first week, so a corrected week cascades into every later Shield. The stand-in saved rule is gone.
--   3. The comeback: private.engagement_comeback_walk (pure) lists the `comeback` facts the data implies (started / lapsed / completed);
--      settle_engagement is the only writer of them and appends the next revision only for a fact whose effective value changed, with outcome
--      `withdrawn` for one that no longer holds. private.engagement_comeback_fold (pure) reads the effective facts back into a state;
--      private.engagement_comeback_live adds the progress of the open window from member_visit_days.
--   4. private.engagement_fold gains the Shield columns; the state view family gains the new columns before pending_milestone
--      (streak_weeks is NULL, not 0, when no run is active); engagement_derived_state and rebuild_engagement gain shields_held and comeback.
--   5. private.engagement_daily_streak_enabled() (false) guards ONE day-path step of settle; the reservation rule lives in the pure
--      private.engagement_day_reservation. No day_shield fact is written while the guard is false.
--   6. public.my_saved_weeks(month): the Mondays of saved weeks that touch a gym-local month (the calendar glyph).
--
-- check_in(), record_check_in and void_staff_check_in are not touched. Nothing here reads or writes the loyalty ledger, guest_sessions or
-- stamps, and no function but settle_engagement writes a `week` or `comeback` fact.
--
-- Rollback: scripts/rollback-0190-streak-shields-comeback.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. Drop what changes its row type: the view family (in dependency order), then the states, then the fold.
-- ----------------------------------------------------------------------------
drop function public.open_engagement();
drop function public.my_engagement();
drop function private.open_engagement_at(uuid, timestamptz);
drop function private.engagement_state_view(uuid);
drop function private.engagement_state_view_at(uuid, timestamptz);
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);
drop function private.engagement_fold(uuid);

-- ----------------------------------------------------------------------------
-- 1. Parameters (read here so the fold itself stays a facts-only function) and the pure walks
-- ----------------------------------------------------------------------------
create function private.engagement_shield_params()
returns table (shield_every_weeks integer, shield_cap integer, comeback_visits integer, comeback_window_days integer, daily_streak_min integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select c.shield_every_weeks, c.shield_cap, c.comeback_visits, c.comeback_window_days, c.daily_streak_min
  from public.platform_engagement_config c
  limit 1;
$$;

revoke execute on function private.engagement_shield_params() from public, anon, authenticated, service_role;

-- The Shield walk. Input: [{"week": "YYYY-MM-DD", "outcome": "met|missed|saved"}] in week order. One row per week:
--   outcome  met, saved or missed as DECIDED (decide mode) or as stored (fact mode)
--   streak_weeks / best_streak_weeks / shields_held  the state AFTER the week
--   earned   a Shield was stored by this week (false when the cap was already held)
-- A week that is not the Monday after the previous one (a gap) ends the run (held 0) before the week is applied.
create function private.engagement_shield_walk(p_weeks jsonb, p_decide boolean, p_every integer, p_cap integer)
returns table (week date, outcome text, streak_weeks integer, best_streak_weeks integer, shields_held integer, earned boolean)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_run integer := 0;
  v_best integer := 0;
  v_held integer := 0;
  v_prev date;
  v_item jsonb;
  v_in text;
begin
  for v_item in
    select e.value from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb)) with ordinality as e(value, ord) order by e.ord
  loop
    week := (v_item ->> 'week')::date;
    v_in := v_item ->> 'outcome';
    earned := false;

    if v_prev is not null and week <> v_prev + 7 then
      v_run := 0;
      v_held := 0;
    end if;

    if v_in = 'met' then
      outcome := 'met';
      v_run := v_run + 1;
      if p_every > 0 and v_run % p_every = 0 and v_held < coalesce(p_cap, 0) then
        v_held := v_held + 1;
        earned := true;
      end if;
    elsif v_in = 'saved' and not p_decide then
      -- A stored saved week: the run is unchanged and adds nothing; the Shield it used is gone.
      outcome := 'saved';
      v_held := greatest(v_held - 1, 0);
    elsif p_decide and v_run > 0 and v_held > 0 then
      outcome := 'saved';
      v_held := v_held - 1;
    else
      outcome := 'missed';
      v_run := 0;
      v_held := 0;
    end if;

    v_best := greatest(v_best, v_run);
    streak_weeks := v_run;
    best_streak_weeks := v_best;
    shields_held := v_held;
    v_prev := week;
    return next;
  end loop;
end;
$$;

revoke execute on function private.engagement_shield_walk(jsonb, boolean, integer, integer) from public, anon, authenticated, service_role;

-- The comeback facts the data implies. Pure: weeks (decided outcomes in order), the member's distinct visit days (ascending) and the gym
-- day. One episode per run that ends with a missed week; it starts at that week's Monday (`started`) and is counted from the day the missed
-- week closed (Monday + 7). Windows are p_window gym-local days starting with a visit day, inclusive. p_visits distinct days inside one
-- completes it (`completed` by 'visits', subject the window start); a window that closes with fewer is `lapsed` (subject its start) and the
-- next visit day starts a new window. The first met week after the miss starts a new run and closes an open episode `completed` by 'week'
-- (it acts at the start of the Monday after that week, so a visit-completing third day inside the week wins, and one on or after wins never).
create function private.engagement_comeback_walk(p_weeks jsonb, p_visit_days date[], p_today date, p_visits integer, p_window integer)
returns table (subject_key text, outcome text, completed_by text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_run integer := 0;
  v_prev date;
  v_item jsonb;
  v_week date;
  v_out text;
  v_open boolean := false;
  v_ms date[] := '{}';
  v_cs date[] := '{}';
  i integer;
  v_m date;
  v_end date;
  v_d date;
  v_cur date;
  v_cnt integer;
  v_done boolean;
begin
  for v_item in
    select e.value from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb)) with ordinality as e(value, ord) order by e.ord
  loop
    v_week := (v_item ->> 'week')::date;
    v_out := v_item ->> 'outcome';
    if v_prev is not null and v_week <> v_prev + 7 then
      v_run := 0;
    end if;
    if v_out = 'met' then
      v_run := v_run + 1;
      if v_open then
        v_cs[array_length(v_ms, 1)] := v_week;
        v_open := false;
      end if;
    elsif v_out = 'missed' and v_run > 0 and not v_open then
      v_ms := v_ms || v_week;
      v_cs := v_cs || null::date;
      v_open := true;
      v_run := 0;
    elsif v_out = 'missed' then
      v_run := 0;
    end if;
    v_prev := v_week;
  end loop;

  for i in 1 .. coalesce(array_length(v_ms, 1), 0) loop
    v_m := v_ms[i];
    v_end := case when v_cs[i] is null then null else v_cs[i] + 7 end;
    v_cur := null;
    v_cnt := 0;
    v_done := false;

    subject_key := to_char(v_m, 'YYYY-MM-DD');
    outcome := 'started';
    completed_by := null;
    return next;

    foreach v_d in array coalesce(p_visit_days, '{}'::date[]) loop
      continue when v_d < v_m + 7;
      exit when p_today is not null and v_d > p_today;
      exit when v_end is not null and v_d >= v_end;

      if v_cur is null or v_d > v_cur + p_window - 1 then
        if v_cur is not null then
          subject_key := to_char(v_cur, 'YYYY-MM-DD');
          outcome := 'lapsed';
          completed_by := null;
          return next;
        end if;
        v_cur := v_d;
        v_cnt := 0;
      end if;

      v_cnt := v_cnt + 1;
      if v_cnt >= p_visits then
        subject_key := to_char(v_cur, 'YYYY-MM-DD');
        outcome := 'completed';
        completed_by := 'visits';
        return next;
        v_done := true;
        exit;
      end if;
    end loop;

    if not v_done then
      if v_end is not null then
        subject_key := to_char(coalesce(v_cur, v_end - 7), 'YYYY-MM-DD');
        outcome := 'completed';
        completed_by := 'week';
        return next;
      elsif v_cur is not null and p_today is not null and p_today > v_cur + p_window - 1 then
        subject_key := to_char(v_cur, 'YYYY-MM-DD');
        outcome := 'lapsed';
        completed_by := null;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function private.engagement_comeback_walk(jsonb, date[], date, integer, integer) from public, anon, authenticated, service_role;

-- The comeback state of a set of comeback facts. Pure. p_facts: [{"key", "outcome", "completed_by"}] (effective facts, or the facts the walk
-- implies); p_weeks: the decided weeks. The latest fact by subject_key that is not withdrawn decides:
--   started -> active (counted from key + 7); lapsed -> lapsed (restart counted from key + window days);
--   completed by 'visits' -> restored while no met week has started a new run since the episode's missed Monday + 7, else none;
--   completed by 'week' -> none.
-- `anchor` is the date the live progress is counted from (see engagement_comeback_live).
create function private.engagement_comeback_fold(p_facts jsonb, p_weeks jsonb, p_window_days integer)
returns table (state text, anchor date)
language sql
stable
set search_path = public, pg_temp
as $$
  with f as (
    select e.key, e.outcome, e.completed_by
    from jsonb_to_recordset(coalesce(p_facts, '[]'::jsonb)) as e(key text, outcome text, completed_by text)
    where e.outcome in ('started', 'lapsed', 'completed') and e.key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  l as (select * from f order by key desc limit 1),
  st as (select max(f.key)::date as m from f join l on f.outcome = 'started' and f.key < l.key),
  restored as (
    select (select outcome from l) = 'completed'
           and (select completed_by from l) = 'visits'
           and not exists (
             select 1 from jsonb_to_recordset(coalesce(p_weeks, '[]'::jsonb)) as w(week text, outcome text)
             where w.outcome = 'met' and w.week::date >= coalesce((select m + 7 from st), (select key::date from l))
           ) as yes
  )
  select
    case
      when not exists (select 1 from l) then 'none'
      when (select outcome from l) = 'started' then 'active'
      when (select outcome from l) = 'lapsed' then 'lapsed'
      when (select yes from restored) then 'restored'
      else 'none'
    end,
    case
      when not exists (select 1 from l) then null::date
      when (select outcome from l) = 'started' then (select key::date + 7 from l)
      when (select outcome from l) = 'lapsed' then (select key::date + p_window_days from l)
      when (select yes from restored) then (select key::date from l)
    end;
$$;

revoke execute on function private.engagement_comeback_fold(jsonb, jsonb, integer) from public, anon, authenticated, service_role;

-- The live progress of a comeback: the window is the first visit day on or after the anchor and the p_window days from it, inclusive.
-- p_today NULL means "no clock": a window is never judged lapsed by time (the derived and rebuilt states compare without one). With a day,
-- an unsettled window that has closed with fewer visits reads `lapsed` before settle has written the fact.
--   active  -> active with the window (NULL until a visit day), lapsed once it has closed short
--   lapsed  -> lapsed with no window until a visit day after the lapse starts one
--   restored-> restored with the completed window and the goal as visits_done
create function private.engagement_comeback_live(p_member_id uuid, p_gym_id uuid, p_state text, p_anchor date, p_today date, p_visits integer, p_window integer)
returns table (state text, visits_done integer, window_start date, window_ends_on date)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_ws date;
  v_cnt integer;
begin
  if p_state is null or p_state = 'none' or p_anchor is null then
    state := 'none'; visits_done := 0; window_start := null; window_ends_on := null;
    return next;
    return;
  end if;

  if p_state = 'restored' then
    state := 'restored'; visits_done := p_visits; window_start := p_anchor; window_ends_on := p_anchor + p_window - 1;
    return next;
    return;
  end if;

  select min(d.visit_day) into v_ws
  from public.member_visit_days d
  where d.member_id = p_member_id and d.gym_id = p_gym_id
    and d.visit_day >= p_anchor
    and (p_today is null or d.visit_day <= p_today);

  if v_ws is null then
    state := p_state; visits_done := 0; window_start := null; window_ends_on := null;
    return next;
    return;
  end if;

  select count(*)::integer into v_cnt
  from public.member_visit_days d
  where d.member_id = p_member_id and d.gym_id = p_gym_id
    and d.visit_day between v_ws and v_ws + p_window - 1
    and (p_today is null or d.visit_day <= p_today);

  if p_today is not null and p_today > v_ws + p_window - 1 and v_cnt < p_visits then
    state := 'lapsed'; visits_done := 0; window_start := null; window_ends_on := null;
    return next;
    return;
  end if;

  state := 'active';
  visits_done := least(v_cnt, p_visits);
  window_start := v_ws;
  window_ends_on := v_ws + p_window - 1;
  return next;
end;
$$;

revoke execute on function private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The day path: the guard (false in V1.8) and the pure reservation rule. A missed day spends a Shield only when two are held, so the
-- last one is always kept for the weekly streak; a whole missed week spends one on the weekly streak and ends the daily run.
-- ----------------------------------------------------------------------------
create function private.engagement_daily_streak_enabled()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select false;
$$;

revoke execute on function private.engagement_daily_streak_enabled() from public, anon, authenticated, service_role;

create function private.engagement_day_reservation(p_held integer, p_missed_days integer, p_week_missed boolean)
returns table (day_shields integer, week_shield boolean, daily_run_ends boolean)
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    case when p_week_missed then 0 else least(greatest(coalesce(p_missed_days, 0), 0), greatest(coalesce(p_held, 0) - 1, 0)) end,
    coalesce(p_week_missed, false) and coalesce(p_held, 0) >= 1,
    coalesce(p_week_missed, false) or (coalesce(p_missed_days, 0) > greatest(coalesce(p_held, 0) - 1, 0));
$$;

revoke execute on function private.engagement_day_reservation(integer, integer, boolean) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. private.engagement_fold: the effective facts of a member folded. Reads facts only (the parameters come through
-- engagement_shield_params; no attendance, no clock). One row always, zeros for a member with no fact.
-- ----------------------------------------------------------------------------
create function private.engagement_fold(p_member_id uuid)
returns table (
  streak_weeks integer,
  best_streak_weeks integer,
  last_settled_week date,
  shields_held integer,
  comeback_state text,
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_anchor date
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_weeks jsonb;
  v_comeback jsonb;
  v_every integer;
  v_cap integer;
  v_window integer;
begin
  select coalesce(p.shield_every_weeks, 4), coalesce(p.shield_cap, 2), coalesce(p.comeback_window_days, 10)
    into v_every, v_cap, v_window
  from (select 1) x left join private.engagement_shield_params() p on true;

  select coalesce(jsonb_agg(jsonb_build_object('week', f.subject_key, 'outcome', f.outcome) order by f.subject_key) filter (where f.kind = 'week'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('key', f.subject_key, 'outcome', f.outcome, 'completed_by', f.detail ->> 'completed_by')
                            order by f.subject_key) filter (where f.kind = 'comeback'), '[]'::jsonb)
    into v_weeks, v_comeback
  from private.effective_engagement_facts(p_member_id) f
  where f.kind in ('week', 'comeback');

  return query
  with walk as (
    select * from private.engagement_shield_walk(v_weeks, false, v_every, v_cap)
  ),
  last_row as (
    select * from walk order by walk.week desc limit 1
  ),
  sv as (
    select w.week, w.streak_weeks from walk w where w.outcome = 'saved' order by w.week desc limit 1
  ),
  cb as (
    select * from private.engagement_comeback_fold(v_comeback, v_weeks, v_window)
  )
  select
    coalesce(l.streak_weeks, 0),
    coalesce(l.best_streak_weeks, 0),
    l.week,
    coalesce(l.shields_held, 0),
    (select cb.state from cb),
    v_every,
    v_cap,
    case
      when coalesce(l.streak_weeks, 0) > 0 and coalesce(l.shields_held, 0) < v_cap and v_every > 0
        then v_every - (l.streak_weeks % v_every)
    end,
    (select sv.week from sv),
    (select sv.streak_weeks from sv),
    (select max(w.week) from walk w where w.earned),
    (select cb.anchor from cb)
  from (select 1) one
  left join last_row l on true;
end;
$$;

revoke execute on function private.engagement_fold(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. private.engagement_evaluate_weeks: every Monday from p_from to p_to with its count, goal, DECIDED outcome and whether that differs from
-- the effective fact. The only place a week is counted and a goal chosen. The Shield decision needs every earlier week, so the weeks are
-- walked from the member's first week (never later than p_from); only the rows from p_from on are returned.
--   visits   distinct visit days in member_visit_days from the Monday to the Sunday (date comparison, no timezone arithmetic).
--   goal     the goal of the effective fact when the week already has one (frozen), otherwise the member_weekly_goals row with the greatest
--            effective_week at or before the Monday, otherwise goal_default.
--   outcome  the Shield walk over (visits >= goal): met; a week below its goal is saved (a Shield held inside a run) or missed.
--   revision the effective revision (0 when the week has no fact), so the next revision is revision + 1.
-- ----------------------------------------------------------------------------
create or replace function private.engagement_evaluate_weeks(p_member_id uuid, p_gym_id uuid, p_from date, p_to date)
returns table (week date, visits integer, goal integer, outcome text, revision integer, changed boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  with origin as (
    select least(
             p_from,
             coalesce(
               greatest(
                 (select c.release_week_start from public.platform_engagement_config c limit 1),
                 (select private.week_start_of(min(d.visit_day)) from public.member_visit_days d
                   where d.member_id = p_member_id and d.gym_id = p_gym_id)
               ),
               p_from
             )
           ) as o
  ),
  weeks as (
    select o.o + 7 * i as week
    from origin o, generate_series(0, (p_to - o.o) / 7) as i
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
  walk as (
    select *
    from private.engagement_shield_walk(
      (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(b.week, 'YYYY-MM-DD'),
                                                     'outcome', case when b.visits >= b.goal then 'met' else 'missed' end)
                                 order by b.week), '[]'::jsonb)
         from base b),
      true,
      coalesce((select p.shield_every_weeks from private.engagement_shield_params() p), 4),
      coalesce((select p.shield_cap from private.engagement_shield_params() p), 2)
    )
  )
  select
    b.week,
    b.visits,
    b.goal,
    w.outcome,
    coalesce(b.prev_revision, 0),
    b.prev_revision is null
      or (w.outcome, b.goal, b.visits) is distinct from (b.prev_outcome, b.prev_goal, b.prev_visits)
  from base b
  join walk w on w.week = b.week
  where b.week >= p_from
  order by b.week;
$$;

revoke execute on function private.engagement_evaluate_weeks(uuid, uuid, date, date) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. private.settle_engagement: the 0189 body, plus (after the week facts) the comeback facts and the guarded day-path step. Still the only
-- writer of `week` and `comeback` facts, still locking the member first. The returned count stays the week facts only.
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
  v_every integer;
  v_cap integer;
  v_visits integer;
  v_window integer;
  v_daily_min integer;
  v_weeks jsonb;
  v_days date[];
  v_breaks integer;
  v_run integer;
  v_day date;
  v_break_days date[];
  v_resv record;
  r record;
  c record;
  i integer;
begin
  perform 1 from members m where m.id = p_member_id and m.gym_id = p_gym_id for no key update;
  if not found then
    raise exception 'settle_engagement: member % is not a member of gym %', p_member_id, p_gym_id;
  end if;

  if p_up_to is null then
    raise exception 'settle_engagement: p_up_to is required';
  end if;

  select c0.release_week_start into v_epoch from platform_engagement_config c0 limit 1;
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

  -- 31.1: the comeback facts. The weeks are the effective week facts as they stand now (the loop above has written every change), the visit
  -- days come from member_visit_days only. A fact is appended only where its effective value differs from what the data implies; a fact
  -- the data no longer implies gets the next revision with outcome `withdrawn`.
  select p.shield_every_weeks, p.shield_cap, p.comeback_visits, p.comeback_window_days, p.daily_streak_min
    into v_every, v_cap, v_visits, v_window, v_daily_min
  from private.engagement_shield_params() p;

  select coalesce(jsonb_agg(jsonb_build_object('week', f.subject_key, 'outcome', f.outcome) order by f.subject_key), '[]'::jsonb)
    into v_weeks
  from private.effective_engagement_facts(p_member_id) f
  where f.kind = 'week';

  select coalesce(array_agg(d.visit_day order by d.visit_day), '{}'::date[]) into v_days
  from member_visit_days d
  where d.member_id = p_member_id and d.gym_id = p_gym_id and d.visit_day >= v_start;

  for c in
    select coalesce(w.subject_key, e.subject_key) as subject_key,
           w.outcome as want_outcome,
           w.completed_by as want_by,
           e.revision as have_revision,
           e.outcome as have_outcome,
           e.detail ->> 'completed_by' as have_by
    from private.engagement_comeback_walk(v_weeks, v_days, p_up_to, v_visits, v_window) w
    full join (
      select ef.subject_key, ef.revision, ef.outcome, ef.detail
      from private.effective_engagement_facts(p_member_id) ef
      where ef.kind = 'comeback'
    ) e on e.subject_key = w.subject_key
    order by 1
  loop
    if c.want_outcome is not null then
      if c.have_revision is null
         or (c.want_outcome, coalesce(c.want_by, '')) is distinct from (coalesce(c.have_outcome, ''), coalesce(c.have_by, '')) then
        insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, detail)
        values (p_member_id, p_gym_id, 'comeback', c.subject_key, coalesce(c.have_revision, 0) + 1, c.want_outcome,
                case when c.want_by is not null then jsonb_build_object('completed_by', c.want_by) else '{}'::jsonb end);
      end if;
    elsif c.have_outcome is distinct from 'withdrawn' then
      insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, detail)
      values (p_member_id, p_gym_id, 'comeback', c.subject_key, c.have_revision + 1, 'withdrawn',
              jsonb_build_object('was', c.have_outcome));
    end if;
  end loop;

  -- 31.1: the day path, one step behind a guard that is false in V1.8 (the daily streak is deferred). A visit run of daily_streak_min days
  -- broken by a missed day spends a day Shield only with two held (private.engagement_day_reservation); `held` is the weekly fold's state at the
  -- start of that week. Never reached while the guard is false, so no day_shield fact exists.
  if private.engagement_daily_streak_enabled() then
    for r in
      select w.week, w.outcome, lag(w.shields_held, 1, 0) over (order by w.week) as held_before
      from private.engagement_shield_walk(v_weeks, false, v_every, v_cap) w
    loop
      continue when r.outcome = 'missed' or r.week < v_from;
      v_run := 0;
      v_breaks := 0;
      v_break_days := '{}'::date[];
      for i in 0 .. 6 loop
        v_day := r.week + i;
        if v_day = any (v_days) then
          v_run := v_run + 1;
        else
          if v_run >= v_daily_min then
            v_breaks := v_breaks + 1;
            v_break_days := v_break_days || v_day;
          end if;
          v_run := 0;
        end if;
      end loop;

      select * into v_resv from private.engagement_day_reservation(r.held_before, v_breaks, false);
      for i in 1 .. v_resv.day_shields loop
        insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, detail)
        values (p_member_id, p_gym_id, 'day_shield', to_char(v_break_days[i], 'YYYY-MM-DD'), 1, 'spent',
                jsonb_build_object('week', to_char(r.week, 'YYYY-MM-DD')))
        on conflict do nothing;
      end loop;
    end loop;
  end if;

  -- 30.7: the only call of award_milestones. Dark and dormant members returned above; the written count stays the week facts only.
  perform private.award_milestones(p_member_id);

  return v_written;
end;
$$;

revoke execute on function private.settle_engagement(uuid, uuid, date) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. The state view family: dropped above, re-created together with ONE row type, new columns before pending_milestone.
--   streak_weeks          NULL (not 0) when no run is active; streak_if_met still counts from 0.
--   shield_every_weeks, shield_cap   the config values, always present.
--   weeks_to_next_shield  1 to shield_every_weeks; NULL at the cap or when not in a run.
--   saved_week_start / saved_week_streak   the newest effective saved week and the streak after it, else NULL.
--   shield_earned_week    the Monday of the newest week that stored a Shield, else NULL.
--   comeback_*            see engagement_comeback_live; the goal and window length come from the config, never from the screen.
--   shields_held, comeback_state   real (none, active, lapsed, restored).
-- Reads only; never settles. The window progress reads member_visit_days between two dates, never the base attendance table.
-- ----------------------------------------------------------------------------
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
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_visits_done integer,
  comeback_visits_goal integer,
  comeback_window_days integer,
  comeback_window_start date,
  comeback_window_ends_on date,
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
    select c.release_week_start as epoch, c.goal_default, c.comeback_visits, c.comeback_window_days from public.platform_engagement_config c limit 1
  ),
  a as (
    select
      w.member_id, w.gym_id, w.tz, w.today, w.ws,
      cfg.epoch,
      cfg.comeback_visits, cfg.comeback_window_days,
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
      f.streak_weeks, f.best_streak_weeks, f.last_settled_week, f.shields_held,
      f.shield_every_weeks, f.shield_cap, f.weeks_to_next_shield, f.saved_week_start, f.saved_week_streak, f.shield_earned_week,
      cb.state as cb_state, cb.visits_done as cb_visits_done, cb.window_start as cb_window_start, cb.window_ends_on as cb_window_ends_on,
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
    cross join lateral private.engagement_comeback_live(
      w.member_id, w.gym_id, f.comeback_state, f.comeback_anchor, w.today, cfg.comeback_visits, cfg.comeback_window_days) cb
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
    nullif(b.streak_weeks, 0),
    case when b.enabled and not b.in_release and b.goal_met then b.streak_weeks + 1 end,
    b.best_streak_weeks,
    b.last_settled_week is not null,
    b.days_left,
    b.needed,
    b.enabled and not b.in_release and not b.visited_today and not b.goal_met
      and b.needed = b.days_left and b.sub_status is not null and b.sub_status <> 'expired',
    false,
    null::integer,
    b.shields_held,
    b.cb_state,
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
    b.shield_every_weeks,
    b.shield_cap,
    b.weeks_to_next_shield,
    b.saved_week_start,
    b.saved_week_streak,
    b.shield_earned_week,
    b.cb_visits_done,
    b.comeback_visits,
    b.comeback_window_days,
    b.cb_window_start,
    b.cb_window_ends_on,
    (select max(f.subject_key::smallint) from public.engagement_facts f
      where f.member_id = b.member_id and f.kind = 'milestone' and not f.silent and f.acknowledged_at is null)
  from b
  cross join lateral private.gym_local_day_bounds(b.tz, p_now) bd;
$$;

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
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_visits_done integer,
  comeback_visits_goal integer,
  comeback_window_days integer,
  comeback_window_start date,
  comeback_window_ends_on date,
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
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_visits_done integer,
  comeback_visits_goal integer,
  comeback_window_days integer,
  comeback_window_start date,
  comeback_window_ends_on date,
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
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_visits_done integer,
  comeback_visits_goal integer,
  comeback_window_days integer,
  comeback_window_start date,
  comeback_window_ends_on date,
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
  shield_every_weeks integer,
  shield_cap integer,
  weeks_to_next_shield integer,
  saved_week_start date,
  saved_week_streak integer,
  shield_earned_week date,
  comeback_visits_done integer,
  comeback_visits_goal integer,
  comeback_window_days integer,
  comeback_window_start date,
  comeback_window_ends_on date,
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

-- ----------------------------------------------------------------------------
-- 7. The two states the determinism tests compare, now with shields_held and comeback ({state, visits_done, window_start}). Both are
-- compared as jsonb, never as row counts.
--   engagement_derived_state  the effective facts, folded.
--   rebuild_engagement        diagnostic, never writes: weeks re-derived from member_visit_days through the same evaluate (the Shield
--                             decisions included), the comeback facts the walk implies, folded the same way.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 8. public.my_saved_weeks(month): the Mondays of the caller's saved weeks that touch a gym-local month, for the calendar glyph. The caller
-- guards of my_visit_days (empty at every failed step; invalid_month for a month that is not the first of a month or is in the future). It
-- reads effective facts only: no attendance table, no timezone arithmetic.
-- ----------------------------------------------------------------------------
create function public.my_saved_weeks(p_month date)
returns table (week_start date)
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

  if coalesce(private.current_gym_status()::text, '') <> 'active' then
    return;
  end if;

  if p_month is null
     or p_month <> date_trunc('month', p_month)::date
     or p_month > date_trunc('month', private.gym_today(v_gym_id))::date then
    raise exception 'invalid_month' using errcode = '22023';
  end if;

  return query
    select f.subject_key::date
    from private.effective_engagement_facts(v_member_id) f
    where f.kind = 'week'
      and f.outcome = 'saved'
      and f.subject_key::date <= (p_month + interval '1 month')::date - 1
      and f.subject_key::date + 6 >= p_month
    order by 1;
end;
$function$;

revoke execute on function public.my_saved_weeks(date) from public, anon, service_role;
grant execute on function public.my_saved_weeks(date) to authenticated;

-- ----------------------------------------------------------------------------
-- Verify: any failure raises and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
  v_result text;
begin
  foreach v_fn in array array[
    'private.engagement_shield_params()',
    'private.engagement_shield_walk(jsonb, boolean, integer, integer)',
    'private.engagement_comeback_walk(jsonb, date[], date, integer, integer)',
    'private.engagement_comeback_fold(jsonb, jsonb, integer)',
    'private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer)',
    'private.engagement_daily_streak_enabled()',
    'private.engagement_day_reservation(integer, integer, boolean)',
    'private.engagement_fold(uuid)',
    'private.engagement_evaluate_weeks(uuid, uuid, date, date)',
    'private.settle_engagement(uuid, uuid, date)',
    'private.engagement_state_view_at(uuid, timestamptz)',
    'private.engagement_state_view(uuid)',
    'private.open_engagement_at(uuid, timestamptz)',
    'private.engagement_derived_state(uuid)',
    'private.rebuild_engagement(uuid, date)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0190: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute') then
      raise exception '0190: % is executable by a client role', v_fn;
    end if;
  end loop;

  foreach v_fn in array array['public.my_engagement()', 'public.open_engagement()', 'public.my_saved_weeks(date)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0190: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute')
       or not has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute') then
      raise exception '0190: % has the wrong grants (authenticated only)', v_fn;
    end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(v_fn)) then
      raise exception '0190: % is not SECURITY DEFINER', v_fn;
    end if;
  end loop;

  if not (select prosecdef from pg_proc where oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'private.engagement_fold(uuid)'::regprocedure)
     or (select provolatile from pg_proc where oid = 'private.engagement_fold(uuid)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.rebuild_engagement(uuid, date)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.engagement_derived_state(uuid)'::regprocedure) <> 's' then
    raise exception '0190: a function has the wrong security or volatility';
  end if;

  -- The state view family shares one row type.
  select pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) into v_result;
  if pg_get_function_result('private.engagement_state_view(uuid)'::regprocedure) is distinct from v_result
     or pg_get_function_result('private.open_engagement_at(uuid, timestamptz)'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.my_engagement()'::regprocedure) is distinct from v_result
     or pg_get_function_result('public.open_engagement()'::regprocedure) is distinct from v_result then
    raise exception '0190: the state view family no longer shares one row type';
  end if;

  -- The guard is false in V1.8.
  if private.engagement_daily_streak_enabled() is distinct from false then
    raise exception '0190: the daily streak guard must return false';
  end if;

  -- No function but settle_engagement writes a week or comeback fact.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* 'insert\s+into\s+(public\.)?engagement_facts'
      and (p.prosrc ~ '''week''' or p.prosrc ~ '''comeback''')
      and p.oid <> 'private.settle_engagement(uuid, uuid, date)'::regprocedure
  ) then
    raise exception '0190: a function other than settle_engagement writes a week or comeback fact';
  end if;
end;
$verify$;
