-- ============================================================================
-- 0192: Badges (Epic 31, Story 31.3; FR-230, FR-225, FR-232, NFR-028; AD-53).
--
-- Five badge codes, first_visit, visits_7, visits_30, visits_100 and four_weeks, are stored as `badge` facts in engagement_facts (the kind is
-- already allowed by the 0185 CHECK; there is no new table). Production is live and the engagement epoch
-- (platform_engagement_config.release_week_start) is NULL, so while it is NULL private.award_milestones writes nothing and nothing changes for any
-- member. The one thing this migration writes while dark is the release back-fill below, which only creates silent history rows that no
-- member surface reads until the area is lit (the shelf is reachable only behind the engagement gate).
--
--   1. A badge fact: kind 'badge', subject_key one of the five codes, revision 1 only (a badge is never revised, reversed or deleted; the
--      append-only guard already forbids the update and the delete), outcome NULL, `silent` the existing column, and `earned_on` (YYYY-MM-DD)
--      in `detail`. The epic's "payload" is `detail`. No CHECK on subject_key: the existing fixtures insert a badge `first-week`, and idempotency
--      is `revision 1 ... on conflict do nothing` in the only writers.
--   2. private.award_milestones(member) is extended (same signature, same single caller, settle_engagement, under the member lock). It still
--      awards the 7, 30 and 100 `milestone` facts exactly as 0189 did, and now also writes the visit badges first_visit (n = 1), visits_7,
--      visits_30 and visits_100 with `earned_on` the stored visit_day of the nth visit day (never recomputed from checked_in_at) and `silent`
--      by the milestone's own rule (the nth visit day is before the epoch), and four_weeks, the first week the Shield walk reports a Shield
--      earned, with `earned_on` that week's Sunday and silent false. A badge is never lost: a later void or rebuild leaves the row, and once a row
--      exists its earned_on wins. pending_milestone still reads only `milestone` facts, so first_visit and four_weeks celebrate nothing and
--      awarding 7, 30 and 100 never adds a second celebration.
--   3. private.engagement_first_shield_week(member): the pure helper behind four_weeks (effective week facts through the Shield walk in fact
--      mode). It writes nothing.
--   4. Release back-fill (private.backfill_badges(), called once at the end of this section): every member with at least 1 visit day gets the visit badges they
--      have already passed, silent = true, earned_on the stored visit_day of the nth visit day, `on conflict do nothing`, never four_weeks
--      (weeks before the epoch are never settled). A per-member keyset loop in batches of 200 members, no member lock, read-only on the visit
--      days. A DO block cannot commit, so "short per-member transactions" is ONE migration transaction under the 5 s lock_timeout (the per-member
--      statements are small and the loop never waits on a lock it did not take); see docs/decisions.md. It writes regardless of the epoch.
--   5. public.get_my_badges(): the member's own read, exactly five rows in shelf order with the progress the tile needs. It never writes and
--      never awards (a plain read cannot award, AD-53).
--   6. private.engagement_derived_state and private.rebuild_engagement gain a `badges` jsonb array (the OUT columns change, so both are dropped
--      and re-created, as 0189 and 0190 did; nothing else depends on them). derived reads the stored badge facts; rebuild re-derives the badge set
--      from the visit days and the decided weeks and then lets any stored badge win (a rebuild never un-earns one, and a stored earned_on wins over a
--      recomputed one after a void).
--
-- check_in(), record_check_in and void_staff_check_in are not touched. Nothing here reads or writes the loyalty ledger, guest_sessions, stamps,
-- Shields or any plan or discount value: a badge grants nothing.
--
-- Rollback: scripts/rollback-0192-badges.sql (the badge facts stay: the append-only guard forbids deleting them)
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. Drop what changes its row type.
-- ----------------------------------------------------------------------------
drop function private.engagement_derived_state(uuid);
drop function private.rebuild_engagement(uuid, date);

-- ----------------------------------------------------------------------------
-- 1. private.engagement_first_shield_week: the Monday of the first week the fold stored a Shield for, else NULL. Effective week facts only.
-- ----------------------------------------------------------------------------
create function private.engagement_first_shield_week(p_member_id uuid)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_weeks jsonb;
  v_every integer;
  v_cap integer;
  v_first date;
begin
  select coalesce(p.shield_every_weeks, 4), coalesce(p.shield_cap, 2)
    into v_every, v_cap
  from (select 1) x left join private.engagement_shield_params() p on true;

  select coalesce(jsonb_agg(jsonb_build_object('week', f.subject_key, 'outcome', f.outcome) order by f.subject_key), '[]'::jsonb)
    into v_weeks
  from private.effective_engagement_facts(p_member_id) f
  where f.kind = 'week';

  select min(w.week) into v_first
  from private.engagement_shield_walk(v_weeks, false, v_every, v_cap) w
  where w.earned;

  return v_first;
end;
$$;

revoke execute on function private.engagement_first_shield_week(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. private.award_milestones: the 0189 body plus the five badges. The only writer of `milestone` and `badge` facts (the back-fill below is
-- the only other writer of a badge, run once at release).
-- ----------------------------------------------------------------------------
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
  v_shield_week date;
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

  foreach v_threshold in array array[1, 7, 30, 100] loop
    -- The Nth distinct visit day, in order. NULL when the member has not reached N days.
    select d.visit_day into v_nth
    from member_visit_days d
    where d.member_id = p_member_id and d.gym_id = v_gym_id
    order by d.visit_day
    offset v_threshold - 1
    limit 1;

    exit when v_nth is null;

    v_silent := v_nth < v_epoch;

    if v_threshold > 1 then
      insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, silent, acknowledged_at)
      values (p_member_id, v_gym_id, 'milestone', v_threshold::text, 1, v_silent, case when v_silent then now() end)
      on conflict do nothing;
    end if;

    -- The badge for the same day: stored once, revision 1, never revised. earned_on is the stored visit_day, as text.
    insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, silent, detail)
    values (p_member_id, v_gym_id, 'badge',
            case when v_threshold = 1 then 'first_visit' else 'visits_' || v_threshold end,
            1, v_silent, jsonb_build_object('earned_on', to_char(v_nth, 'YYYY-MM-DD')))
    on conflict do nothing;
  end loop;

  -- four_weeks: the first week the fold stored a Shield for; earned on that week's Sunday. A later void or rebuild leaves the row.
  v_shield_week := private.engagement_first_shield_week(p_member_id);
  if v_shield_week is not null then
    insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, silent, detail)
    values (p_member_id, v_gym_id, 'badge', 'four_weeks', 1, false, jsonb_build_object('earned_on', to_char(v_shield_week + 6, 'YYYY-MM-DD')))
    on conflict do nothing;
  end if;
end;
$$;

revoke execute on function private.award_milestones(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The release back-fill. Silent history with real dates, once. Never four_weeks. Returns the number of rows it inserted.
-- ----------------------------------------------------------------------------
create function private.backfill_badges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_after uuid;
  v_batch uuid[];
  v_id uuid;
  v_rows integer;
  v_total integer := 0;
begin
  loop
    select array_agg(b.id order by b.id) into v_batch
    from (
      select m.id
      from members m
      where (v_after is null or m.id > v_after)
        and exists (select 1 from member_visit_days d where d.member_id = m.id and d.gym_id = m.gym_id)
      order by m.id
      limit 200
    ) b;

    exit when v_batch is null;

    foreach v_id in array v_batch loop
      insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, silent, detail)
      select m.id, m.gym_id, 'badge', t.code, 1, true, jsonb_build_object('earned_on', to_char(n.visit_day, 'YYYY-MM-DD'))
      from members m
      cross join (values (1, 'first_visit'), (7, 'visits_7'), (30, 'visits_30'), (100, 'visits_100')) as t(n, code)
      cross join lateral (
        select d.visit_day
        from member_visit_days d
        where d.member_id = m.id and d.gym_id = m.gym_id
        order by d.visit_day
        offset t.n - 1
        limit 1
      ) n
      where m.id = v_id
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end loop;

    v_after := v_batch[array_length(v_batch, 1)];
  end loop;

  return v_total;
end;
$$;

revoke execute on function private.backfill_badges() from public, anon, authenticated, service_role;

-- Run once, now. The function stays so pgTAP can run it again (a second run inserts nothing).
select private.backfill_badges();

-- ----------------------------------------------------------------------------
-- 4. public.get_my_badges(): the caller's own five badge rows, shelf order. The caller guards of my_saved_weeks (no rows at every failed step).
--   code              first_visit, visits_7, visits_30, visits_100, four_weeks
--   earned, earned_on, silent   the stored fact (earned_on and silent NULL while unearned)
--   visits_remaining  threshold minus the member's visit days, floor 0; NULL for first_visit and for an earned row
--   weeks_progress    0 to shield_every_weeks - 1, the weeks of the current run toward the first Shield (0 when no run or dark); NULL unless
--                     four_weeks is unearned
-- Reads facts, member_visit_days and the state view only. Never writes.
-- ----------------------------------------------------------------------------
create function public.get_my_badges()
returns table (code text, earned boolean, earned_on date, silent boolean, visits_remaining integer, weeks_progress integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_days integer;
  v_enabled boolean;
  v_every integer;
  v_to_next integer;
  v_progress integer := 0;
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

  select count(*)::integer into v_days
  from member_visit_days d
  where d.member_id = v_member_id and d.gym_id = v_gym_id;

  select s.enabled, s.shield_every_weeks, s.weeks_to_next_shield
    into v_enabled, v_every, v_to_next
  from private.engagement_state_view(v_member_id) s;

  if coalesce(v_enabled, false) and v_to_next is not null and coalesce(v_every, 0) > 0 then
    v_progress := least(greatest(v_every - v_to_next, 0), v_every - 1);
  end if;

  return query
  select
    c.code,
    b.subject_key is not null,
    case when b.subject_key is not null then (b.detail ->> 'earned_on')::date end,
    case when b.subject_key is not null then b.silent end,
    case when b.subject_key is null and c.threshold is not null and c.threshold > 1 then greatest(c.threshold - v_days, 0) end,
    case when b.subject_key is null and c.code = 'four_weeks' then v_progress end
  from (values (1, 'first_visit', 1), (2, 'visits_7', 7), (3, 'visits_30', 30), (4, 'visits_100', 100), (5, 'four_weeks', null::integer))
         as c(ord, code, threshold)
  left join private.effective_engagement_facts(v_member_id) b on b.kind = 'badge' and b.subject_key = c.code
  order by c.ord;
end;
$function$;

revoke execute on function public.get_my_badges() from public, anon, service_role;
grant execute on function public.get_my_badges() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The two states the determinism tests compare, now with the badge set ([{code, earned_on, silent}] in shelf order, earned_on as YYYY-MM-DD).
--   engagement_derived_state  the stored badge facts (the five codes).
--   rebuild_engagement        diagnostic, never writes: the badges the visit days and decided weeks imply (the epoch set), then any stored badge
--                             wins (code by code), so a void never removes a badge and a stored earned_on wins over a recomputed one.
-- ----------------------------------------------------------------------------
create function private.engagement_derived_state(p_member_id uuid)
returns table (
  streak_weeks integer,
  best_streak_weeks integer,
  last_settled_week date,
  weeks jsonb,
  milestones jsonb,
  shields_held integer,
  comeback jsonb,
  badges jsonb
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
      where m.id = p_member_id),
    (select coalesce(
              jsonb_agg(jsonb_build_object('code', e.subject_key, 'earned_on', e.detail ->> 'earned_on', 'silent', e.silent)
                        order by array_position(array['first_visit', 'visits_7', 'visits_30', 'visits_100', 'four_weeks'], e.subject_key)),
              '[]'::jsonb)
       from private.effective_engagement_facts(p_member_id) e
      where e.kind = 'badge'
        and e.subject_key in ('first_visit', 'visits_7', 'visits_30', 'visits_100', 'four_weeks'))
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
  comeback jsonb,
  badges jsonb
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
  v_implied jsonb := '[]'::jsonb;
  v_shield_week date;
  v_badges jsonb;
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

    -- The visit badges the data implies, with the true date of the nth visit day and the milestone's own silent rule.
    select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'earned_on', to_char(n.visit_day, 'YYYY-MM-DD'), 'silent', n.visit_day < v_epoch) order by t.ord), '[]'::jsonb)
      into v_implied
    from (values (1, 'first_visit', 1), (2, 'visits_7', 7), (3, 'visits_30', 30), (4, 'visits_100', 100)) as t(ord, code, n)
    cross join lateral (
      select d.visit_day from member_visit_days d
      where d.member_id = p_member_id and d.gym_id = v_gym_id
      order by d.visit_day offset t.n - 1 limit 1
    ) n;
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

  -- four_weeks: the first week the decided weeks earn a Shield, on that week's Sunday.
  select min(x.week) into v_shield_week from private.engagement_shield_walk(v_decided, false, v_every, v_cap) x where x.earned;
  if v_shield_week is not null then
    v_implied := v_implied || jsonb_build_array(jsonb_build_object('code', 'four_weeks', 'earned_on', to_char(v_shield_week + 6, 'YYYY-MM-DD'), 'silent', false));
  end if;

  -- The stored badge wins, code by code (a badge is never lost and its stored earned_on is never recomputed).
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'earned_on', coalesce(s.detail ->> 'earned_on', i.earned_on), 'silent', coalesce(s.silent, i.silent))
                            order by c.ord), '[]'::jsonb)
    into v_badges
  from (values (1, 'first_visit'), (2, 'visits_7'), (3, 'visits_30'), (4, 'visits_100'), (5, 'four_weeks')) as c(ord, code)
  left join (select e.subject_key, e.detail, e.silent from private.effective_engagement_facts(p_member_id) e where e.kind = 'badge') s on s.subject_key = c.code
  left join jsonb_to_recordset(v_implied) as i(code text, earned_on text, silent boolean) on i.code = c.code
  where s.subject_key is not null or i.code is not null;

  return query
  select
    coalesce(l.streak_weeks, 0),
    coalesce(l.best_streak_weeks, 0),
    l.week,
    v_weeks,
    v_milestones,
    coalesce(l.shields_held, 0),
    jsonb_build_object('state', v_live.state, 'visits_done', v_live.visits_done, 'window_start', v_live.window_start),
    v_badges
  from (select 1) one
  left join lateral (
    select * from private.engagement_shield_walk(v_decided, false, v_every, v_cap) x order by x.week desc limit 1
  ) l on true;
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
  foreach v_fn in array array[
    'private.engagement_first_shield_week(uuid)',
    'private.backfill_badges()',
    'private.award_milestones(uuid)',
    'private.engagement_derived_state(uuid)',
    'private.rebuild_engagement(uuid, date)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0192: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('authenticated', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('service_role', to_regprocedure(v_fn), 'execute')
       or has_function_privilege('public', to_regprocedure(v_fn), 'execute') then
      raise exception '0192: % is executable by a client role', v_fn;
    end if;
  end loop;

  if to_regprocedure('public.get_my_badges()') is null then
    raise exception '0192: public.get_my_badges() is missing';
  end if;
  if has_function_privilege('anon', 'public.get_my_badges()'::regprocedure, 'execute')
     or has_function_privilege('service_role', 'public.get_my_badges()'::regprocedure, 'execute')
     or has_function_privilege('public', 'public.get_my_badges()'::regprocedure, 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_badges()'::regprocedure, 'execute') then
    raise exception '0192: public.get_my_badges() has the wrong grants (authenticated only)';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.get_my_badges()'::regprocedure)
     or (select provolatile from pg_proc where oid = 'public.get_my_badges()'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'private.award_milestones(uuid)'::regprocedure) then
    raise exception '0192: a function has the wrong security or volatility';
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'public.get_my_badges()'::regprocedure) ~* 'attendance_events' then
    raise exception '0192: get_my_badges names the raw attendance table';
  end if;

  -- No function but award_milestones and the back-fill writes a badge.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind in ('f', 'p')
      and p.prosrc ~* 'insert\s+into\s+(public\.)?engagement_facts'
      and p.prosrc ~ '''badge'''
      and p.oid not in ('private.award_milestones(uuid)'::regprocedure, 'private.backfill_badges()'::regprocedure)
  ) then
    raise exception '0192: a function other than award_milestones and the back-fill writes a badge fact';
  end if;

  -- The release back-fill ran (the call above): every member with a visit day holds a first_visit badge. Deleting that call fails the migration here.
  if exists (
    select 1
    from members m
    where exists (select 1 from member_visit_days d where d.member_id = m.id and d.gym_id = m.gym_id)
      and not exists (select 1 from engagement_facts f where f.member_id = m.id and f.kind = 'badge' and f.subject_key = 'first_visit')
  ) then
    raise exception '0192: a member with visit days has no first_visit badge (the release back-fill did not run)';
  end if;

  -- No badge row has a revision above 1 after the back-fill.
  if exists (select 1 from engagement_facts f where f.kind = 'badge' and f.revision <> 1) then
    raise exception '0192: a badge fact has a revision other than 1';
  end if;
end;
$verify$;
