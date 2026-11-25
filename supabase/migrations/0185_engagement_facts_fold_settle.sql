-- ============================================================================
-- 0185: Engagement facts, the fold and settle (Epic 30, Story 30.2; FR-220, FR-225, NFR-028; AD-53, AD-56, AD-29, AD-1).
--
-- Adds only new objects, plus one trigger on platform_engagement_config (0184). No existing function, policy, grant or cron job changes.
-- Nothing here is callable by a client, nothing is scheduled, and while platform_engagement_config.release_week_start is NULL (dark) no
-- function of this file writes a row.
--   1. engagement_facts: the append-only ledger. One row per (member, kind, subject, revision); the effective fact of a subject is the
--      HIGHEST revision, so a replay inserts nothing and a correction is never dropped by a unique key. The five kinds of AD-53 are
--      CHECKed now so Epic 31 alters no table; this story writes `week` facts only. A trigger refuses every UPDATE and DELETE except the
--      cascade of the owning member and the flagged acknowledgement of a milestone (30.7).
--   2. engagement_state: the settle watermark (settled_through, dirty_from) per member.
--   3. private.effective_engagement_facts, private.engagement_fold (the streak arithmetic over effective week facts only),
--      private.engagement_evaluate_weeks (the one place a week is counted and a goal is chosen), private.settle_engagement (the only
--      writer of facts), private.engagement_derived_state and private.rebuild_engagement (the two states the determinism tests compare).
--   4. A trigger on platform_engagement_config that refuses any change of release_week_start once a week fact exists, in either direction
--      and to NULL (moving the epoch would invalidate settled history; 30.1 deferral).
--
-- Every count reads member_visit_days (AD-56), never attendance_events. Week arithmetic is on `date` through private.week_start_of.
--
-- Rollback: scripts/rollback-0185-engagement-facts-fold-settle.sql
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. engagement_facts
-- ----------------------------------------------------------------------------
create table public.engagement_facts (
  member_id uuid not null references public.members(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  kind text not null,
  subject_key text not null,
  revision integer not null default 1,
  outcome text,
  goal smallint,
  visits integer,
  silent boolean not null default false,
  acknowledged_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (member_id, kind, subject_key, revision),
  constraint engagement_facts_kind check (kind in ('week', 'day_shield', 'milestone', 'badge', 'comeback')),
  constraint engagement_facts_revision check (revision >= 1),
  -- A week fact: the week's Monday as YYYY-MM-DD (the pattern is tested first, so the date cast never sees a malformed key), an outcome,
  -- a goal of 1 to 7 and a visit count. Every term is written `is not null and ...` so a NULL cannot pass the CHECK.
  constraint engagement_facts_week_shape check (
    kind <> 'week'
    or (
      outcome is not null and outcome in ('met', 'missed', 'saved')
      and goal is not null and goal between 1 and 7
      and visits is not null and visits >= 0
      and subject_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and extract(isodow from subject_key::date) = 1
    )
  ),
  -- A milestone fact: the visit-day count it marks, and no outcome.
  constraint engagement_facts_milestone_shape check (
    kind <> 'milestone'
    or (subject_key in ('7', '30', '100') and outcome is null)
  )
);

create index engagement_facts_gym_idx on public.engagement_facts (gym_id);

alter table public.engagement_facts enable row level security;
-- Deliberately no policy and no grant: client roles see nothing. Definer functions only (the member_weekly_goals precedent of 0184).
revoke all on table public.engagement_facts from public, anon, authenticated, service_role;

comment on table public.engagement_facts is
  'Append-only ledger of engagement facts (Epic 30, AD-53). The effective fact of (member_id, kind, subject_key) is the highest revision; read it through private.effective_engagement_facts. Written only by private.settle_engagement (week) and, from 30.7, the milestone functions. A trigger refuses every UPDATE and DELETE except the cascade of the owning member and the flagged acknowledgement of a milestone.';

-- ----------------------------------------------------------------------------
-- 2. engagement_state
-- ----------------------------------------------------------------------------
create table public.engagement_state (
  member_id uuid primary key references public.members(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  settled_through date,
  dirty_from date,
  updated_at timestamptz not null default now()
);

create index engagement_state_gym_idx on public.engagement_state (gym_id);

alter table public.engagement_state enable row level security;
revoke all on table public.engagement_state from public, anon, authenticated, service_role;

comment on table public.engagement_state is
  'Settle watermark per member (Epic 30, AD-53): settled_through is the Monday of the last settled closed week, dirty_from the earliest Monday whose count may have changed since (a late offline visit, a void). Written by private.settle_engagement and, from 30.3, the check-in and void paths. Never read by a client.';

-- ----------------------------------------------------------------------------
-- The append-only guard. Two exceptions, nothing else passes, whoever the writer is (the table owner and definer functions included):
--   * a DELETE caused by the owning member being deleted (detected by the member row no longer existing, the 0184 history-guard rule);
--   * an UPDATE that sets acknowledged_at from NULL to a timestamp on a `milestone` fact while the transaction-local flag
--     `app.engagement_acknowledge` is 'on' (set only by the acknowledge function of 30.7), with no other column changed.
-- ----------------------------------------------------------------------------
create function private.engagement_facts_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from members m where m.id = old.member_id) then
      return old;
    end if;
    raise exception 'engagement_facts is append-only: a fact cannot be deleted'
      using errcode = '23514';
  end if;

  if old.kind = 'milestone'
     and old.acknowledged_at is null
     and new.acknowledged_at is not null
     and coalesce(current_setting('app.engagement_acknowledge', true), '') = 'on'
     and (to_jsonb(new) - 'acknowledged_at') = (to_jsonb(old) - 'acknowledged_at') then
    return new;
  end if;

  raise exception 'engagement_facts is append-only: a fact cannot be updated'
    using errcode = '23514';
end;
$$;

revoke execute on function private.engagement_facts_append_only_guard() from public, anon, authenticated, service_role;

create trigger engagement_facts_append_only_guard
  before update or delete on public.engagement_facts
  for each row execute function private.engagement_facts_append_only_guard();

-- ----------------------------------------------------------------------------
-- The epoch guard (the 30.1 deferral): release_week_start is frozen once any week fact exists, to another Monday and to NULL alike.
-- Setting it while no fact exists stays allowed (NFR-028). SECURITY DEFINER because the Super Admin updating the config has no
-- privilege on engagement_facts.
-- ----------------------------------------------------------------------------
create function private.engagement_epoch_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.release_week_start is distinct from old.release_week_start
     and exists (select 1 from engagement_facts f where f.kind = 'week') then
    raise exception 'platform_engagement_config: release_week_start cannot change once a week fact exists'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.engagement_epoch_guard() from public, anon, authenticated, service_role;

create trigger engagement_epoch_guard
  before update on public.platform_engagement_config
  for each row execute function private.engagement_epoch_guard();

-- ----------------------------------------------------------------------------
-- 3a. The effective facts of a member: the highest revision of every (kind, subject_key)
-- ----------------------------------------------------------------------------
create function private.effective_engagement_facts(p_member_id uuid)
returns setof public.engagement_facts
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (f.kind, f.subject_key) f.*
  from public.engagement_facts f
  where f.member_id = p_member_id
  order by f.kind, f.subject_key, f.revision desc;
$$;

revoke execute on function private.effective_engagement_facts(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3b. The streak arithmetic. Input: a jsonb array of {"week": "YYYY-MM-DD", "outcome": "met|missed|saved"} in week order. It reads no
-- table and no clock, so the fold (facts) and the rebuild (visits) cannot disagree about what a run is.
--   met     adds 1 to the run.
--   missed  sets the run to 0.
--   saved   keeps the run unchanged and adds nothing (a Shield-saved week, Epic 31).
--   a week that is not the Monday after the previous week's (a gap) restarts the run before the week is applied.
-- best_streak_weeks is the highest run ever reached, so it never decreases as weeks are added.
-- ----------------------------------------------------------------------------
create function private.engagement_fold_weeks(p_weeks jsonb)
returns table (streak_weeks integer, best_streak_weeks integer, last_settled_week date)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_run integer := 0;
  v_best integer := 0;
  v_prev date;
  v_week date;
  v_outcome text;
  v_item jsonb;
begin
  for v_item in
    select e.value from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb)) with ordinality as e(value, ord) order by e.ord
  loop
    v_week := (v_item ->> 'week')::date;
    v_outcome := v_item ->> 'outcome';

    if v_prev is not null and v_week <> v_prev + 7 then
      v_run := 0;
    end if;

    if v_outcome = 'met' then
      v_run := v_run + 1;
    elsif v_outcome = 'missed' then
      v_run := 0;
    end if;
    -- 'saved' (and nothing else the CHECK allows): the run is unchanged.

    v_best := greatest(v_best, v_run);
    v_prev := v_week;
  end loop;

  streak_weeks := v_run;
  best_streak_weeks := v_best;
  last_settled_week := v_prev;
  return next;
end;
$$;

revoke execute on function private.engagement_fold_weeks(jsonb) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3c. private.engagement_fold: the effective `week` facts of a member in week order, folded. Kinds day_shield, milestone, badge and comeback
-- are accepted and ignored in this epic: shields_held is 0 and comeback_state is 'none'. Epic 31 plugs its Shield earn/spend and comeback
-- steps into this one function without changing its callers or the tables. Reads facts only: no attendance, no config, no clock.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3d. private.engagement_evaluate_weeks: every Monday from p_from to p_to (inclusive, both Mondays) with its count, its goal and its
-- outcome, and whether that differs from the member's effective fact. The only place a week is counted and a goal is chosen; settle writes
-- the rows that changed and rebuild returns all of them, so the two cannot drift apart.
--   visits   distinct visit days in member_visit_days from the Monday to the Sunday (date comparison, no timezone arithmetic).
--   goal     the goal of the effective fact when the week already has one (frozen: a later change of goal_default or of the goal history
--            never rewrites a settled week), otherwise the member_weekly_goals row with the greatest effective_week at or before the
--            Monday, otherwise goal_default.
--   outcome  met when visits >= goal; a week the effective fact holds as `saved` stays saved while it is still below goal (a Shield is
--            never taken back by a recount); otherwise missed.
--   revision the effective revision (0 when the week has no fact), so the next revision is revision + 1.
-- ----------------------------------------------------------------------------
create function private.engagement_evaluate_weeks(p_member_id uuid, p_gym_id uuid, p_from date, p_to date)
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

-- ----------------------------------------------------------------------------
-- 3e. private.settle_engagement(member, gym, up_to): the only writer of week facts. Called with private.gym_today(gym) by the cron job
-- and by open_engagement() (30.3) and with a fixed date by tests. Returns the number of facts written (zero on a replay).
--   * The member lock (`for no key update`, AD-29 and AD-53) is the FIRST statement, before the config, the state or member_visit_days is
--     read, so a check-in that commits first is counted and one that commits later marks dirty_from after this run cleared it.
--   * release_week_start NULL: dark. Nothing is written and dirty_from is left as it is.
--   * The start week is greatest(release_week_start, week of the first visit day). A member with no visit day writes nothing (a gym's
--     dormant members cost no rows). Weeks before the epoch are never settled.
--   * A week is closed only when p_up_to >= Monday + 7; the open week never gets a fact.
--   * Weeks from least(dirty_from, settled_through + 7) to the last closed week are re-evaluated; a new revision is inserted only for a
--     week whose (outcome, goal, visits) differs from its effective fact. Empty weeks get `missed` facts.
--   * settled_through never moves backwards; dirty_from is cleared by every successful run (kept only in the case where the clock went
--     backwards across a Monday and the dirty week was not evaluated).
-- SECURITY DEFINER: the engagement tables have no client grant.
-- ----------------------------------------------------------------------------
create function private.settle_engagement(p_member_id uuid, p_gym_id uuid, p_up_to date)
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

-- ----------------------------------------------------------------------------
-- 3f. The two states the determinism tests compare, both (streak_weeks, best_streak_weeks, last_settled_week, weeks) with `weeks` the
-- ordered jsonb array of {week, visits, goal, outcome}. Compared as jsonb, never as row counts, because revisions legitimately add rows.
--   engagement_derived_state  the effective week facts, folded.
--   rebuild_engagement        diagnostic, never writes: every week from the start week to the last closed week re-derived from
--                             member_visit_days with the goal in force taken as settle takes it, folded with the same arithmetic.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Verify: any failure raises and rolls the whole migration back
-- ----------------------------------------------------------------------------
do $verify$
declare
  v_fn text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.engagement_facts'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.engagement_state'::regclass) then
    raise exception '0185: row level security is off on a new table';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('engagement_facts', 'engagement_state')) then
    raise exception '0185: the engagement tables must have no policy';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) r,
         unnest(array['public.engagement_facts', 'public.engagement_state']) t,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
    where has_table_privilege(r, t, p)
  ) then
    raise exception '0185: a client role holds a privilege on an engagement table';
  end if;

  if (select count(*) from pg_trigger where tgrelid = 'public.engagement_facts'::regclass and tgname = 'engagement_facts_append_only_guard' and not tgisinternal) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.platform_engagement_config'::regclass and tgname = 'engagement_epoch_guard' and not tgisinternal) <> 1 then
    raise exception '0185: a guard trigger is missing';
  end if;

  foreach v_fn in array array[
    'private.engagement_facts_append_only_guard()',
    'private.engagement_epoch_guard()',
    'private.effective_engagement_facts(uuid)',
    'private.engagement_fold_weeks(jsonb)',
    'private.engagement_fold(uuid)',
    'private.engagement_evaluate_weeks(uuid, uuid, date, date)',
    'private.settle_engagement(uuid, uuid, date)',
    'private.engagement_derived_state(uuid)',
    'private.rebuild_engagement(uuid, date)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0185: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute') then
      raise exception '0185: % is executable by a client role', v_fn;
    end if;
  end loop;

  if not (select prosecdef from pg_proc where oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'private.engagement_fold(uuid)'::regprocedure)
     or (select provolatile from pg_proc where oid = 'private.engagement_fold(uuid)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.rebuild_engagement(uuid, date)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'private.engagement_derived_state(uuid)'::regprocedure) <> 's' then
    raise exception '0185: a function has the wrong security or volatility';
  end if;

  if exists (select 1 from public.engagement_facts) or exists (select 1 from public.engagement_state) then
    raise exception '0185: an engagement table is not empty after the migration';
  end if;
end;
$verify$;
