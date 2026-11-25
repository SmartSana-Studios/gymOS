-- ============================================================================
-- 0183: Coach picker reads (Epic 29, Story 29.4; FR-247, FR-053 (amended), FR-145, FR-122; NFR-001, NFR-011, NFR-016; spine AD-58, AD-34, AD-35, AD-1).
--
-- An Owner, Supervisor or Manager opens the Coach Portal, chooses one coach of their gym and reads that coach's classes, class lists, assigned
-- members, the coach's own session notes and the workout plans, read-only. This migration adds the only staff read path onto that data: seven
-- STABLE SECURITY DEFINER functions, each taking the coach as a parameter. No table policy is added or changed (a Manager still reads no
-- progress data by any direct read), no function is registered in private.support_capabilities (FR-251), and nothing is written.
--
--   * list_picker_coaches(): the gym's Coach-role members for the select (coach_id, coach_name, is_active). The page lists the active ones in the
--     select; a deactivated coach is returned so that a stale link can say "no longer a coach" (UX AD-32) without a table read of its own.
--   * list_coach_classes(p_coach_id) and list_coach_class_session_roster(p_coach_id, p_class_session_id): list_my_classes() and
--     list_my_class_session_roster() of 0182 with the coach as a parameter (sessions from 00:00 today in the gym's time zone up to four weeks ahead, the
--     materializer's horizon of 0180/0181, so a coach with many weekly times stays under the API row cap; a one-off class dated beyond that keeps its
--     class row and shows no session until it is within four weeks).
--   * list_coach_assigned_members(p_coach_id), get_coach_assigned_member(p_coach_id, p_member_id): the chosen coach's currently assigned members
--     (coach_assignments.ended_at is null) with the allow-listed profile columns, plan name and subscription status, plus (list only) the latest
--     snippet of that coach's own note.
--   * list_coach_member_session_notes(p_coach_id, p_member_id): the chosen coach's own notes on a currently assigned member, newest first.
--   * get_coach_member_workout_plan(p_coach_id, p_member_id): the ordered plan and the author, with no completion data.
--
-- Every function: guards in list_my_classes()'s order (no gym -> empty; live role is Owner, Supervisor or Manager, else empty; suspended gym ->
-- the "is not active" raise), then asserts that p_coach_id is an active Coach-role member of the caller's gym (null, another gym's coach, a
-- non-coach, a deactivated coach and a random uuid all give an empty result) and, for the member-scoped ones, that the member is currently assigned
-- to that coach. The definer bypasses RLS, so every table it touches is filtered on gym_id = private.gym_id() (subscriptions_current is
-- security_invoker and needs the filter too). RETURNS TABLE with a named column list: no select *, no row type, no to_jsonb of a row. Nothing here
-- reads workout_plan_completions, progress_entries, progress_photos, the progress-photos bucket or the body and contact columns of members; the
-- CI check scripts/check-coach-picker-isolation.mjs and supabase/tests/coach_picker_*.test.sql keep it so.
--
-- Bodies carry no comments (suspension_rpc_coverage.test.sql and the catalog tests match on the source).
--
-- Also two indexes the picker needs: classes (gym_id, coach_id) and a partial coach_assignments (coach_id) where ended_at is null.
--
-- Rollback: scripts/rollback-0183-coach-picker-reads.sql.
-- ============================================================================
set local lock_timeout = '10s';

-- 1. Indexes -----------------------------------------------------------------------------------------------------------

create index idx_classes_gym_coach on classes (gym_id, coach_id);

create index idx_coach_assignments_active_coach on coach_assignments (coach_id) where ended_at is null;

-- 2. list_picker_coaches ---------------------------------------------------------------------------------------------------

create function public.list_picker_coaches()
returns table (coach_id uuid, coach_name text, is_active boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_picker_coaches: gym % is not active', v_gym_id;
  end if;

  return query
  select m.id, m.name, (m.deactivated_at is null)
  from members m
  where m.gym_id = v_gym_id
    and m.role = 'coach'
  order by m.name, m.id;
end;
$$;

-- 3. list_coach_classes ------------------------------------------------------------------------------------------------------

create function public.list_coach_classes(p_coach_id uuid)
returns table (
  class_id uuid,
  class_name text,
  capacity integer,
  schedule_type text,
  one_off_session_at timestamptz,
  slots jsonb,
  gym_timezone text,
  cancelled_at timestamptz,
  class_session_id uuid,
  scheduled_at timestamptz,
  booked_count bigint,
  matches_slots boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
  v_timezone text;
  v_day_start timestamptz;
  v_horizon timestamptz;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_coach_classes: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  select g.timezone, date_trunc('day', now() at time zone g.timezone) at time zone g.timezone
  into v_timezone, v_day_start
  from gyms g
  where g.id = v_gym_id;

  v_horizon := ((v_day_start at time zone v_timezone) + interval '4 weeks') at time zone v_timezone;

  return query
  select c.id, c.name, c.capacity, c.schedule_type, c.one_off_session_at,
         (select coalesce(jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', to_char(s.start_time, 'HH24:MI')) order by s.weekday, s.start_time), '[]'::jsonb)
            from class_schedule_slots s where s.class_id = c.id and s.gym_id = v_gym_id),
         v_timezone, c.cancelled_at,
         cs.id, cs.scheduled_at,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id and cb.gym_id = v_gym_id),
         v.matches_slots
  from classes c
  left join class_sessions cs
    on cs.class_id = c.id
   and cs.gym_id = v_gym_id
   and cs.scheduled_at >= v_day_start
   and cs.scheduled_at < v_horizon
   and cs.cancelled_at is null
  left join class_sessions_with_match v on v.class_session_id = cs.id
  where c.gym_id = v_gym_id
    and c.coach_id = p_coach_id
  order by c.name, c.id, cs.scheduled_at nulls last;
end;
$$;

-- 4. list_coach_class_session_roster ---------------------------------------------------------------------------------------------

create function public.list_coach_class_session_roster(p_coach_id uuid, p_class_session_id uuid)
returns table (member_id uuid, member_name text, attended_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
  v_day_start timestamptz;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_coach_class_session_roster: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  select date_trunc('day', now() at time zone g.timezone) at time zone g.timezone
  into v_day_start
  from gyms g
  where g.id = v_gym_id;

  return query
  select b.id, b.name, cb.attended_at
  from class_sessions cs
  join classes c on c.id = cs.class_id and c.gym_id = v_gym_id
  join class_bookings cb on cb.class_session_id = cs.id and cb.gym_id = v_gym_id
  join members b on b.id = cb.member_id and b.gym_id = v_gym_id
  where cs.id = p_class_session_id
    and cs.gym_id = v_gym_id
    and cs.scheduled_at >= v_day_start
    and cs.cancelled_at is null
    and c.coach_id = p_coach_id
  order by b.name, b.id;
end;
$$;

-- 5. list_coach_assigned_members -------------------------------------------------------------------------------------------------

create function public.list_coach_assigned_members(p_coach_id uuid)
returns table (
  member_id uuid,
  member_name text,
  phone text,
  photo_url text,
  goal text,
  experience_level text,
  status subscription_status,
  plan_name text,
  expiry_date date,
  join_date date,
  last_note_snippet text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_coach_assigned_members: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  return query
  select m.id, m.name, m.phone, m.photo_url, m.goal, m.experience_level,
         sc.status, sc.plan_name, sc.expiry_date, m.join_date,
         (select left(regexp_replace(sn.note_text, '\s+', ' ', 'g'), 80)
            from session_notes sn
            where sn.gym_id = v_gym_id and sn.member_id = m.id and sn.coach_id = p_coach_id
            order by sn.created_at desc, sn.id desc
            limit 1)
  from coach_assignments ca
  join members m on m.id = ca.member_id and m.gym_id = v_gym_id and m.deactivated_at is null
  left join subscriptions_current sc on sc.member_id = m.id and sc.gym_id = v_gym_id
  where ca.coach_id = p_coach_id
    and ca.gym_id = v_gym_id
    and ca.ended_at is null
  order by m.name, m.id;
end;
$$;

-- 6. get_coach_assigned_member ---------------------------------------------------------------------------------------------------

create function public.get_coach_assigned_member(p_coach_id uuid, p_member_id uuid)
returns table (
  member_id uuid,
  member_name text,
  phone text,
  photo_url text,
  goal text,
  experience_level text,
  status subscription_status,
  plan_name text,
  expiry_date date,
  join_date date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'get_coach_assigned_member: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or p_member_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  return query
  select m.id, m.name, m.phone, m.photo_url, m.goal, m.experience_level,
         sc.status, sc.plan_name, sc.expiry_date, m.join_date
  from coach_assignments ca
  join members m on m.id = ca.member_id and m.gym_id = v_gym_id and m.deactivated_at is null
  left join subscriptions_current sc on sc.member_id = m.id and sc.gym_id = v_gym_id
  where ca.coach_id = p_coach_id
    and ca.member_id = p_member_id
    and ca.gym_id = v_gym_id
    and ca.ended_at is null;
end;
$$;

-- 7. list_coach_member_session_notes -------------------------------------------------------------------------------------------

create function public.list_coach_member_session_notes(p_coach_id uuid, p_member_id uuid)
returns table (
  note_id uuid,
  coach_id uuid,
  coach_name text,
  note_text text,
  created_at timestamptz,
  edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_coach_member_session_notes: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or p_member_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  if not exists (
    select 1 from coach_assignments ca
    join members am on am.id = ca.member_id and am.gym_id = v_gym_id and am.deactivated_at is null
    where ca.coach_id = p_coach_id and ca.member_id = p_member_id and ca.gym_id = v_gym_id and ca.ended_at is null
  ) then
    return;
  end if;

  return query
  select sn.id, sn.coach_id, a.name, sn.note_text, sn.created_at, sn.edited_at
  from session_notes sn
  join members a on a.id = sn.coach_id and a.gym_id = v_gym_id
  where sn.gym_id = v_gym_id
    and sn.member_id = p_member_id
    and sn.coach_id = p_coach_id
  order by sn.created_at desc, sn.id desc;
end;
$$;

-- 8. get_coach_member_workout_plan ---------------------------------------------------------------------------------------------

create function public.get_coach_member_workout_plan(p_coach_id uuid, p_member_id uuid)
returns table (
  plan_id uuid,
  plan_name text,
  author_id uuid,
  author_name text,
  plan_exercise_id uuid,
  order_index smallint,
  exercise_name text,
  sets smallint,
  reps smallint,
  note text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  if coalesce(private.current_member_role()::text = any (array['owner', 'supervisor', 'manager']), false) is not true then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'get_coach_member_workout_plan: gym % is not active', v_gym_id;
  end if;

  if p_coach_id is null or p_member_id is null or not exists (
    select 1 from members m
    where m.id = p_coach_id and m.gym_id = v_gym_id and m.role = 'coach' and m.deactivated_at is null
  ) then
    return;
  end if;

  if not exists (
    select 1 from coach_assignments ca
    join members am on am.id = ca.member_id and am.gym_id = v_gym_id and am.deactivated_at is null
    where ca.coach_id = p_coach_id and ca.member_id = p_member_id and ca.gym_id = v_gym_id and ca.ended_at is null
  ) then
    return;
  end if;

  return query
  select wp.id, wp.name, wp.coach_id, a.name,
         e.id, e.order_index, el.name, e.sets, e.reps, e.note
  from workout_plans wp
  left join members a on a.id = wp.coach_id and a.gym_id = v_gym_id
  left join workout_plan_exercises e on e.plan_id = wp.id and e.gym_id = v_gym_id
  left join exercise_library el on el.id = e.exercise_id and (el.gym_id = v_gym_id or el.gym_id is null)
  where wp.gym_id = v_gym_id
    and wp.member_id = p_member_id
  order by e.order_index nulls last, e.id;
end;
$$;

-- 9. Privileges ------------------------------------------------------------------------------------------------------

revoke execute on function public.list_picker_coaches() from public, anon;
revoke execute on function public.list_coach_classes(uuid) from public, anon;
revoke execute on function public.list_coach_class_session_roster(uuid, uuid) from public, anon;
revoke execute on function public.list_coach_assigned_members(uuid) from public, anon;
revoke execute on function public.get_coach_assigned_member(uuid, uuid) from public, anon;
revoke execute on function public.list_coach_member_session_notes(uuid, uuid) from public, anon;
revoke execute on function public.get_coach_member_workout_plan(uuid, uuid) from public, anon;

grant execute on function public.list_picker_coaches() to authenticated;
grant execute on function public.list_coach_classes(uuid) to authenticated;
grant execute on function public.list_coach_class_session_roster(uuid, uuid) to authenticated;
grant execute on function public.list_coach_assigned_members(uuid) to authenticated;
grant execute on function public.get_coach_assigned_member(uuid, uuid) to authenticated;
grant execute on function public.list_coach_member_session_notes(uuid, uuid) to authenticated;
grant execute on function public.get_coach_member_workout_plan(uuid, uuid) to authenticated;

-- 10. Self-check: any failure raises and rolls the whole migration back ---------------------------------------------------

do $verify$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.list_picker_coaches()'::regprocedure,
    'public.list_coach_classes(uuid)'::regprocedure,
    'public.list_coach_class_session_roster(uuid, uuid)'::regprocedure,
    'public.list_coach_assigned_members(uuid)'::regprocedure,
    'public.get_coach_assigned_member(uuid, uuid)'::regprocedure,
    'public.list_coach_member_session_notes(uuid, uuid)'::regprocedure,
    'public.get_coach_member_workout_plan(uuid, uuid)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_fn
        and p.prosecdef
        and p.provolatile = 's'
        and p.proconfig = array['search_path=public, pg_temp']
        and p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
        and p.prosrc like '%is not active%'
        and p.prosrc ~ 'private\.current_member_role\(\)'
        and p.prosrc ~ 'private\.gym_id\(\)'
        and p.prosrc !~ '(^|\n)\s*--'
        and p.prosrc !~* 'select\s+\*'
        and p.prosrc !~ '\w\.\*'
        and p.prosrc !~* '\mexecute\M\s+(format|''|\$)'
        and p.prosrc !~* '(to_jsonb?|row_to_json)\s*\('
        and p.prosrc !~* 'workout_plan_completions|progress_entries|progress_photos|progress-photos'
        and p.prosrc !~* 'starting_weight_kg|height_cm|birth_year|\mdob\M|emergency_contact|\memail\M|neighborhood|profession'
    ) then
      raise exception '0183: % is missing its gate, its suspension guard, or carries a comment, a select * or alias star, a JSON of a row, a progress table or a body column', v_fn;
    end if;

    if exists (
      select 1 from pg_proc p
      where p.oid = v_fn
        and (
          p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = (select oid from pg_roles where rolname = 'anon') and a.privilege_type = 'EXECUTE')
          or not exists (select 1 from aclexplode(p.proacl) a where a.grantee = (select oid from pg_roles where rolname = 'authenticated') and a.privilege_type = 'EXECUTE')
        )
    ) then
      raise exception '0183: % is executable by public or anon, or not by authenticated', v_fn;
    end if;
  end loop;

  if exists (
    select 1 from private.support_capabilities c
    where c.object_name in ('list_picker_coaches', 'list_coach_classes', 'list_coach_class_session_roster', 'list_coach_assigned_members',
                            'get_coach_assigned_member', 'list_coach_member_session_notes', 'get_coach_member_workout_plan')
  ) then
    raise exception '0183: a picker function must not be a support capability';
  end if;

  if to_regclass('public.idx_classes_gym_coach') is null or to_regclass('public.idx_coach_assignments_active_coach') is null then
    raise exception '0183: an index is missing';
  end if;
end;
$verify$;
