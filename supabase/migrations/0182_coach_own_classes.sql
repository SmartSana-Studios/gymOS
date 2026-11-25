-- ============================================================================
-- 0182: Coaches create, edit and cancel their own classes (Epic 29, Story 29.3; FR-246, FR-145 (amended), FR-122, FR-121; spine AD-57, AD-34, AD-35, AD-21, AD-1).
--
-- 0181 refuses the Coach role in create_class(p_slots), update_class(p_slots) and cancel_class. This migration widens exactly those three
-- functions to a Coach for their OWN classes, and adds no table policy: a Coach still cannot write classes, class_sessions,
-- class_schedule_slots or class_bookings directly.
--
--   * private.is_live_own_coach(uuid): the one predicate. True only when the id is a member row that belongs to the caller (user_id =
--     auth.uid()), in the caller's gym (private.gym_id()), with role 'coach', not deactivated, and private.is_own_coach_id(id) agrees.
--     is_own_coach_id alone checks neither gym, role nor deactivation. A null id is false.
--   * create_class(..., p_slots): role read live (private.current_member_role(), never the token claim). A Coach passes p_coach_id null
--     (stored as the caller) or their own member id; anything else is refused.
--   * update_class(..., p_slots) and cancel_class: the class row is locked for update first, then the Coach check runs on the class's
--     current coach and on any new p_coach_id (null from a Coach means "keep me"). Another coach's class, another gym's class and a missing
--     class raise the same message, so nothing about a class a Coach does not own leaks. Manager, Supervisor and Owner behave exactly as in 0181.
--     The refusal text is "<function>: coaches can only manage their own classes" (the dashboard maps it to classes.coach.ownOnly).
--   * the old 9-argument create_class and the old 10-argument update_class are not touched: they stay Manager and above.
--   * list_my_classes(): dropped and re-created with the same body plus description and recurrence_start_date (the Edit modal needs them).
--   * list_my_class_session_roster(uuid): returns nothing for a cancelled session.
-- Bodies of the new public functions carry no comments (suspension_rpc_coverage.test.sql matches on the source).
--
-- Rollback: scripts/rollback-0182-coach-own-classes.sql (restores the 0181 and 0096 bodies and drops the predicate).
-- ============================================================================
set local lock_timeout = '10s';

-- 1. The Coach predicate -------------------------------------------------------------------------

create function private.is_live_own_coach(p_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_coach_id is not null
    and exists (
      select 1 from members m
      where m.id = p_coach_id
        and m.user_id = auth.uid()
        and m.gym_id = private.gym_id()
        and m.role = 'coach'
        and m.deactivated_at is null
    )
    and private.is_own_coach_id(p_coach_id);
$$;

revoke execute on function private.is_live_own_coach(uuid) from public, anon, authenticated;

-- 2. create_class (p_slots) ----------------------------------------------------------------------

create or replace function public.create_class(p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date, p_slots jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_class_id uuid;
  v_slots jsonb;
  v_role text;
  v_coach_id uuid := p_coach_id;
begin
  v_role := (select private.current_member_role())::text;
  if not coalesce(v_role = any(array['manager', 'supervisor', 'owner', 'coach']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
  end if;

  if v_role = 'coach' then
    if p_coach_id is null then
      select m.id into v_coach_id
      from members m
      where m.user_id = auth.uid()
        and m.gym_id = v_gym_id
        and m.role = 'coach'
        and m.deactivated_at is null
      order by m.created_at desc, m.id desc
      limit 1;
    end if;

    if not private.is_live_own_coach(v_coach_id) then
      raise exception 'create_class: coaches can only manage their own classes';
    end if;
  end if;

  if p_schedule_type = 'recurring' then
    v_slots := private.validate_class_slots('create_class', p_slots);
  elsif p_slots is not null and jsonb_typeof(p_slots) <> 'null' then
    raise exception 'create_class: a one-off class cannot have weekly times'
      using errcode = '23514';
  end if;

  insert into classes (
    gym_id, name, description, coach_id, capacity, schedule_type,
    one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  ) values (
    v_gym_id, p_name, p_description, v_coach_id, p_capacity, p_schedule_type,
    p_one_off_session_at,
    case when p_schedule_type = 'recurring' then null else p_recurrence_days end,
    case when p_schedule_type = 'recurring' then null else p_recurrence_time end,
    p_recurrence_start_date
  )
  returning id into v_class_id;

  if p_schedule_type = 'recurring' then
    perform 1 from private.apply_class_slots(v_class_id, v_slots);
  else
    perform private.materialize_sessions_for_class(v_class_id);
  end if;

  return v_class_id;
end;
$function$;

-- 3. update_class (p_slots) ----------------------------------------------------------------------

create or replace function public.update_class(p_class_id uuid, p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date, p_slots jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_old record;
  v_old_slots jsonb;
  v_new_slots jsonb := '[]'::jsonb;
  v_left jsonb := '[]'::jsonb;
  v_times_changed boolean;
  v_row record;
  v_session record;
  v_booked integer;
  v_role text;
  v_coach_id uuid := p_coach_id;
begin
  v_role := (select private.current_member_role())::text;
  if not coalesce(v_role = any(array['manager', 'supervisor', 'owner', 'coach']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  select c.name, c.schedule_type, c.one_off_session_at, c.recurrence_start_date, c.cancelled_at, c.coach_id
  into v_old
  from classes c
  where c.id = p_class_id and c.gym_id = v_gym_id
  for update;

  if v_role = 'coach' then
    if not found or not private.is_live_own_coach(v_old.coach_id) then
      raise exception 'update_class: coaches can only manage their own classes';
    end if;

    if p_coach_id is null then
      v_coach_id := v_old.coach_id;
    elsif not private.is_live_own_coach(p_coach_id) then
      raise exception 'update_class: coaches can only manage their own classes';
    end if;
  elsif not found then
    raise exception 'update_class: class % not found', p_class_id;
  end if;

  if v_old.cancelled_at is not null then
    raise exception 'update_class: class % is already cancelled', p_class_id;
  end if;

  if p_schedule_type = 'recurring' then
    v_new_slots := private.validate_class_slots('update_class', p_slots);
  elsif p_slots is not null and jsonb_typeof(p_slots) <> 'null' then
    raise exception 'update_class: a one-off class cannot have weekly times'
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', to_char(s.start_time, 'HH24:MI')) order by s.weekday, s.start_time), '[]'::jsonb)
  into v_old_slots
  from class_schedule_slots s
  where s.class_id = p_class_id;

  if v_old.schedule_type = 'one_off'
    and p_schedule_type = 'one_off'
    and v_old.one_off_session_at is distinct from p_one_off_session_at
    and exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    )
  then
    raise exception 'update_class: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
  end if;

  v_times_changed :=
    (v_old.schedule_type = 'recurring' or p_schedule_type = 'recurring')
    and (
      v_old.schedule_type is distinct from p_schedule_type
      or v_old_slots is distinct from v_new_slots
      or v_old.recurrence_start_date is distinct from p_recurrence_start_date
    );

  update classes set
    name = p_name,
    description = p_description,
    coach_id = v_coach_id,
    capacity = p_capacity,
    schedule_type = p_schedule_type,
    one_off_session_at = case when p_schedule_type = 'recurring' then null else p_one_off_session_at end,
    recurrence_days = null,
    recurrence_time = null,
    recurrence_start_date = p_recurrence_start_date
  where id = p_class_id and gym_id = v_gym_id;

  if p_schedule_type = 'recurring' then
    for v_row in select * from private.apply_class_slots(p_class_id, v_new_slots) loop
      v_left := v_left || jsonb_build_array(jsonb_build_object(
        'class_session_id', v_row.class_session_id,
        'scheduled_at', v_row.scheduled_at,
        'booked_count', v_row.booked_count,
        'capacity', p_capacity
      ));
    end loop;
  elsif v_old.schedule_type = 'recurring' then
    delete from class_schedule_slots where class_id = p_class_id;

    for v_session in
      select cs.id, cs.scheduled_at
      from class_sessions cs
      where cs.class_id = p_class_id
        and cs.scheduled_at > now()
        and cs.scheduled_at is distinct from p_one_off_session_at
      order by cs.scheduled_at
      for update of cs
    loop
      select count(*) into v_booked from class_bookings cb where cb.class_session_id = v_session.id;

      if v_booked = 0 then
        delete from class_sessions where id = v_session.id;
      else
        v_left := v_left || jsonb_build_array(jsonb_build_object(
          'class_session_id', v_session.id,
          'scheduled_at', v_session.scheduled_at,
          'booked_count', v_booked,
          'capacity', p_capacity
        ));
      end if;
    end loop;

    perform private.materialize_sessions_for_class(p_class_id);
  elsif v_old.one_off_session_at is distinct from p_one_off_session_at then
    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
    perform private.materialize_sessions_for_class(p_class_id);
  end if;

  if v_times_changed then
    perform log_audit_event(
      p_action_type => 'class_times_changed',
      p_gym_id => v_gym_id,
      p_target_entity_id => p_class_id::text,
      p_target_entity_type => 'class',
      p_metadata => jsonb_build_object(
        'class_name', p_name,
        'old_schedule_type', v_old.schedule_type,
        'new_schedule_type', p_schedule_type,
        'old_slots', v_old_slots,
        'new_slots', v_new_slots,
        'left_unchanged_count', jsonb_array_length(v_left)
      )
    );
  end if;

  return jsonb_build_object('left_unchanged', v_left);
end;
$function$;

-- 4. cancel_class --------------------------------------------------------------------------------

create or replace function public.cancel_class(p_class_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_caller_member_id uuid;
  v_class record;
  v_bookings integer;
  v_role text;
begin
  v_role := (select private.current_member_role())::text;
  if not coalesce(v_role = any(array['manager', 'supervisor', 'owner', 'coach']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'cancel_class: gym % is not active', v_gym_id;
  end if;

  select c.name, c.cancelled_at, c.schedule_type, c.one_off_session_at, c.coach_id
  into v_class
  from classes c
  where c.id = p_class_id and c.gym_id = v_gym_id
  for update;

  if v_role = 'coach' then
    if not found or not private.is_live_own_coach(v_class.coach_id) then
      raise exception 'cancel_class: coaches can only manage their own classes';
    end if;
  elsif not found then
    raise exception 'cancel_class: class % not found', p_class_id;
  end if;

  if v_class.cancelled_at is not null then
    raise exception 'cancel_class: class % is already cancelled', p_class_id;
  end if;

  if v_class.schedule_type = 'one_off' and v_class.one_off_session_at <= now() then
    raise exception 'cancel_class: class % has nothing left to cancel', p_class_id;
  end if;

  select m.id into v_caller_member_id
  from members m
  where m.user_id = auth.uid()
    and m.gym_id = v_gym_id
    and m.deactivated_at is null
  order by m.created_at, m.id
  limit 1;

  perform 1
  from class_sessions cs
  where cs.class_id = p_class_id and cs.scheduled_at > now()
  order by cs.scheduled_at
  for update of cs;

  select count(*)::integer into v_bookings
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  where cs.class_id = p_class_id and cs.scheduled_at > now();

  update classes
  set cancelled_at = now(), cancelled_by = v_caller_member_id
  where id = p_class_id and gym_id = v_gym_id;

  update class_sessions
  set cancelled_at = now()
  where class_id = p_class_id and scheduled_at > now();

  perform log_audit_event(
    p_action_type => 'class_cancelled',
    p_gym_id => v_gym_id,
    p_target_entity_id => p_class_id::text,
    p_target_entity_type => 'class',
    p_metadata => jsonb_build_object('class_name', v_class.name, 'bookings_cancelled', v_bookings)
  );

  return jsonb_build_object('bookings_cancelled', v_bookings);
end;
$function$;

-- 5. list_my_classes: description and recurrence_start_date for the Edit modal ------------------------------------

drop function public.list_my_classes();

create function public.list_my_classes()
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
  matches_slots boolean,
  description text,
  recurrence_start_date date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
  v_coach_id uuid;
  v_timezone text;
  v_day_start timestamptz;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  select m.id into v_coach_id
  from members m
  where m.user_id = auth.uid()
    and m.gym_id = v_gym_id
    and m.role = 'coach'
    and m.deactivated_at is null;

  if v_coach_id is null then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_my_classes: gym % is not active', v_gym_id;
  end if;

  select g.timezone, date_trunc('day', now() at time zone g.timezone) at time zone g.timezone
  into v_timezone, v_day_start
  from gyms g
  where g.id = v_gym_id;

  return query
  select c.id, c.name, c.capacity, c.schedule_type, c.one_off_session_at,
         (select coalesce(jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', to_char(s.start_time, 'HH24:MI')) order by s.weekday, s.start_time), '[]'::jsonb)
            from class_schedule_slots s where s.class_id = c.id),
         v_timezone, c.cancelled_at,
         cs.id, cs.scheduled_at,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id),
         v.matches_slots,
         c.description, c.recurrence_start_date
  from classes c
  left join class_sessions cs
    on cs.class_id = c.id
   and cs.scheduled_at >= v_day_start
   and cs.cancelled_at is null
  left join class_sessions_with_match v on v.class_session_id = cs.id
  where c.gym_id = v_gym_id
    and c.coach_id = v_coach_id
  order by c.name, c.id, cs.scheduled_at nulls last;
end;
$$;

-- 6. list_my_class_session_roster: nothing for a cancelled session -----------------------------------------------

create or replace function public.list_my_class_session_roster(p_class_session_id uuid)
returns table (member_id uuid, member_name text, attended_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym_id uuid;
  v_coach_id uuid;
  v_day_start timestamptz;
begin
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    return;
  end if;

  select m.id into v_coach_id
  from members m
  where m.user_id = auth.uid()
    and m.gym_id = v_gym_id
    and m.role = 'coach'
    and m.deactivated_at is null;

  if v_coach_id is null then
    return;
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'list_my_class_session_roster: gym % is not active', v_gym_id;
  end if;

  select date_trunc('day', now() at time zone g.timezone) at time zone g.timezone
  into v_day_start
  from gyms g
  where g.id = v_gym_id;

  return query
  select b.id, b.name, cb.attended_at
  from class_sessions cs
  join classes c on c.id = cs.class_id
  join class_bookings cb on cb.class_session_id = cs.id
  join members b on b.id = cb.member_id
  where cs.id = p_class_session_id
    and cs.gym_id = v_gym_id
    and cs.scheduled_at >= v_day_start
    and cs.cancelled_at is null
    and c.coach_id = v_coach_id
  order by b.name, b.id;
end;
$$;

-- 7. Privileges ------------------------------------------------------------------------------------------------------

revoke execute on function public.create_class(text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb) from public, anon;
revoke execute on function public.update_class(uuid, text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb) from public, anon;
revoke execute on function public.cancel_class(uuid) from public, anon;
revoke execute on function public.list_my_classes() from public, anon;
revoke execute on function public.list_my_class_session_roster(uuid) from public, anon;

grant execute on function public.create_class(text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb) to authenticated;
grant execute on function public.update_class(uuid, text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb) to authenticated;
grant execute on function public.cancel_class(uuid) to authenticated;
grant execute on function public.list_my_classes() to authenticated;
grant execute on function public.list_my_class_session_roster(uuid) to authenticated;

-- 8. Self-check: any failure raises and rolls the whole migration back ---------------------------------------------------

do $verify$
declare
  v_fn regprocedure;
begin
  if to_regprocedure('private.is_live_own_coach(uuid)') is null then
    raise exception '0182: private.is_live_own_coach(uuid) is missing';
  end if;

  if has_function_privilege('anon', 'private.is_live_own_coach(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.is_live_own_coach(uuid)', 'EXECUTE')
  then
    raise exception '0182: private.is_live_own_coach is callable by a client role';
  end if;

  foreach v_fn in array array[
    'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
    'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
    'public.cancel_class(uuid)'::regprocedure
  ] loop
    if (select p.prosrc !~ 'is_live_own_coach' or p.prosrc !~ '''coach''' or p.prosrc !~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
               or p.prosrc not like '%is not active%' or p.prosrc ~ '(^|\n)\s*--'
        from pg_proc p where p.oid = v_fn)
    then
      raise exception '0182: % lost the Coach gate or the suspension guard, or carries a comment', v_fn;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.cancel_class(uuid)'::regprocedure,
      'public.list_my_classes()'::regprocedure,
      'public.list_my_class_session_roster(uuid)'::regprocedure
    )
    and (
      p.proacl is null
      or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      or exists (select 1 from aclexplode(p.proacl) a where a.grantee = (select oid from pg_roles where rolname = 'anon') and a.privilege_type = 'EXECUTE')
    )
  ) then
    raise exception '0182: a redefined function is executable by public or anon';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure,
      'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure
    )
    and p.prosrc ~ '''coach'''
  ) then
    raise exception '0182: an old-signature function was widened to a Coach';
  end if;

  if (select count(*) from information_schema.routines r
        where r.routine_schema = 'public' and r.routine_name = 'list_my_classes') <> 1
    or not exists (
      select 1 from pg_proc p
      where p.oid = 'public.list_my_classes()'::regprocedure
        and p.proargnames @> array['description', 'recurrence_start_date']
    )
  then
    raise exception '0182: list_my_classes() is missing description or recurrence_start_date';
  end if;

  if position('cancelled_at' in (select prosrc from pg_proc where oid = 'public.list_my_class_session_roster(uuid)'::regprocedure)) = 0 then
    raise exception '0182: list_my_class_session_roster does not skip a cancelled session';
  end if;

  if exists (select 1 from private.support_capabilities c where c.object_name in ('create_class', 'update_class', 'cancel_class', 'is_live_own_coach')) then
    raise exception '0182: a Coach function must not be a support capability';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('classes', 'class_sessions', 'class_schedule_slots', 'class_bookings')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'coach'
  ) then
    raise exception '0182: a Coach write policy exists on a class table';
  end if;
end;
$verify$;
