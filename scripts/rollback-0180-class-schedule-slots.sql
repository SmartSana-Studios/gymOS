-- Rollback for migration 0180: class schedule slots foundation (Epic 29, Story 29.1).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0180-class-schedule-slots.sql
--
-- VALID ONLY WHILE EVERY CLASS'S SLOTS STILL EQUAL ITS LEGACY COLUMNS. The restored 0057 materializer reads recurrence_days and
-- recurrence_time, and the restored classes_schedule_matches_type requires both on a recurring row. A class whose slots differ from
-- unnest(recurrence_days) x recurrence_time (a second time on one weekday, a different time on different days, a day missing from the legacy
-- array, null legacy columns: all of which only Story 29.2 onwards can produce) cannot be represented there, and dropping the slots would lose
-- its schedule. The script refuses, naming the first classes. Nothing else is lost: no session or booking row is touched by 0180 or by this
-- script, and slots written by create_class / update_class after 0180 equal the legacy columns they also wrote.
--
-- Restores: private.materialize_sessions_for_class as 0057 left it, public.create_class and public.update_class and
-- public.materialize_class_sessions as 0124 left them (grants are kept by CREATE OR REPLACE), the 0057 classes_schedule_matches_type CHECK.
-- Drops: the triggers and trigger functions, private.apply_class_slots, and the class_schedule_slots table with its policies.
set local lock_timeout = '5s';

do $$
declare
  v_bad text;
begin
  select string_agg(id::text, ', ') into v_bad from (
    select c.id
    from classes c
    where c.schedule_type = 'recurring'
      and (
        c.recurrence_days is null or c.recurrence_time is null or cardinality(c.recurrence_days) = 0
        or exists (
          select 1 from class_schedule_slots s
          where s.class_id = c.id
            and not (s.weekday = any(c.recurrence_days) and s.start_time = c.recurrence_time))
        or exists (
          select 1 from unnest(c.recurrence_days) d(day)
          where not exists (
            select 1 from class_schedule_slots s
            where s.class_id = c.id and s.weekday = d.day and s.start_time = c.recurrence_time))
      )
    order by c.id
    limit 5
  ) x;

  if v_bad is not null then
    raise exception '0180 rollback refused: the slots of these classes differ from recurrence_days x recurrence_time (first 5): %', v_bad;
  end if;
end;
$$;

drop trigger classes_derive_slots_trigger on public.classes;
drop trigger classes_slot_presence_check on public.classes;
drop trigger class_schedule_slots_presence_check on public.class_schedule_slots;
drop trigger class_schedule_slots_cap_trigger on public.class_schedule_slots;
drop trigger class_schedule_slots_validate_trigger on public.class_schedule_slots;

-- Every recurring class passed the guard above, so it satisfies the old CHECK.
alter table public.classes drop constraint classes_schedule_matches_type;
alter table public.classes add constraint classes_schedule_matches_type check (
  (schedule_type = 'one_off'
    and one_off_session_at is not null
    and recurrence_days is null and recurrence_time is null and recurrence_start_date is null)
  or
  (schedule_type = 'recurring'
    and one_off_session_at is null
    and recurrence_days is not null and array_length(recurrence_days, 1) > 0
    and recurrence_time is not null and recurrence_start_date is not null)
);

-- 0057 private.materialize_sessions_for_class
create or replace function private.materialize_sessions_for_class(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_gym_timezone text;
  v_schedule_type text;
  v_one_off_session_at timestamptz;
  v_recurrence_days smallint[];
  v_recurrence_time time;
  v_recurrence_start_date date;
  v_d date;
begin
  select c.gym_id, g.timezone, c.schedule_type, c.one_off_session_at,
         c.recurrence_days, c.recurrence_time, c.recurrence_start_date
  into v_gym_id, v_gym_timezone, v_schedule_type, v_one_off_session_at,
       v_recurrence_days, v_recurrence_time, v_recurrence_start_date
  from classes c
  join gyms g on g.id = c.gym_id
  where c.id = p_class_id;

  if not found then
    raise exception 'materialize_sessions_for_class: class % not found', p_class_id;
  end if;

  if v_schedule_type = 'one_off' then
    insert into class_sessions (gym_id, class_id, scheduled_at)
    values (v_gym_id, p_class_id, v_one_off_session_at)
    on conflict (class_id, scheduled_at) do nothing;
    return;
  end if;

  -- Recurring: materialize a rolling 4-week-ahead window. `d + v_recurrence_time`
  -- produces a plain timestamp (no zone); `at time zone v_gym_timezone`
  -- interprets that timestamp *as* the gym's own local time and converts it
  -- *to* timestamptz -- matching the direction Story 6.5's own
  -- `now() at time zone v_gym.timezone` usage relies on.
  --
  -- Review fix: the window is always [current_date, current_date + 4 weeks],
  -- filtered by v_d >= v_recurrence_start_date inside the loop -- not
  -- greatest(start_date, current_date) as the generate_series lower bound.
  -- When start_date is further out than 4 weeks, greatest() picked a lower
  -- bound past the upper bound, making generate_series silently produce zero
  -- rows (start > end) instead of correctly producing zero *matching* rows.
  for v_d in
    select generate_series(
      current_date,
      current_date + interval '4 weeks',
      interval '1 day'
    )::date
  loop
    if v_d >= v_recurrence_start_date and extract(dow from v_d)::smallint = any(v_recurrence_days) then
      insert into class_sessions (gym_id, class_id, scheduled_at)
      values (v_gym_id, p_class_id, (v_d + v_recurrence_time) at time zone v_gym_timezone)
      on conflict (class_id, scheduled_at) do nothing;
    end if;
  end loop;
end;
$$;


revoke execute on function private.materialize_sessions_for_class(uuid) from public, anon;
grant execute on function private.materialize_sessions_for_class(uuid) to service_role;

-- 0124 public.create_class
CREATE OR REPLACE FUNCTION public.create_class(p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_class_id uuid;
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
  end if;

  insert into classes (
    gym_id, name, description, coach_id, capacity, schedule_type,
    one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  ) values (
    v_gym_id, p_name, p_description, p_coach_id, p_capacity, p_schedule_type,
    p_one_off_session_at, p_recurrence_days, p_recurrence_time, p_recurrence_start_date
  )
  returning id into v_class_id;

  perform private.materialize_sessions_for_class(v_class_id);

  return v_class_id;
end;
$function$;

-- 0124 public.update_class
CREATE OR REPLACE FUNCTION public.update_class(p_class_id uuid, p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_old record;
  v_schedule_changed boolean;
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  select schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  into v_old
  from classes
  where id = p_class_id and gym_id = v_gym_id
  for update;

  if not found then
    raise exception 'update_class: class % not found', p_class_id;
  end if;

  v_schedule_changed :=
    v_old.schedule_type is distinct from p_schedule_type
    or v_old.one_off_session_at is distinct from p_one_off_session_at
    or v_old.recurrence_days is distinct from p_recurrence_days
    or v_old.recurrence_time is distinct from p_recurrence_time
    or v_old.recurrence_start_date is distinct from p_recurrence_start_date;

  if v_schedule_changed then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'update_class: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;
  end if;

  update classes set
    name = p_name,
    description = p_description,
    coach_id = p_coach_id,
    capacity = p_capacity,
    schedule_type = p_schedule_type,
    one_off_session_at = p_one_off_session_at,
    recurrence_days = p_recurrence_days,
    recurrence_time = p_recurrence_time,
    recurrence_start_date = p_recurrence_start_date
  where id = p_class_id and gym_id = v_gym_id;

  if v_schedule_changed then
    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
    perform private.materialize_sessions_for_class(p_class_id);
  end if;
end;
$function$;

-- 0124 public.materialize_class_sessions
CREATE OR REPLACE FUNCTION public.materialize_class_sessions(p_class_id uuid, p_reschedule boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_gym_id uuid;
  v_class_gym_id uuid;
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'materialize_class_sessions: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id into v_class_gym_id
  from classes
  where id = p_class_id and gym_id = v_caller_gym_id;

  if v_class_gym_id is null then
    raise exception 'materialize_class_sessions: class % not found', p_class_id;
  end if;

  if p_reschedule then
    if exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    ) then
      raise exception 'materialize_class_sessions: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
    end if;

    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
  end if;

  perform private.materialize_sessions_for_class(p_class_id);
end;
$function$;

revoke execute on function public.create_class(text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date) from public, anon;
revoke execute on function public.update_class(uuid, text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date) from public, anon;
revoke execute on function public.materialize_class_sessions(uuid, boolean) from public, anon;

drop function private.apply_class_slots(uuid, jsonb);
drop function private.classes_derive_slots();
drop function private.class_schedule_slots_check_presence();
drop function private.class_schedule_slots_cap();
drop function private.class_schedule_slots_validate();

drop table public.class_schedule_slots;

do $verify$
begin
  if to_regclass('public.class_schedule_slots') is not null then
    raise exception '0180 rollback: class_schedule_slots still exists';
  end if;
  if position('class_schedule_slots' in (select prosrc from pg_proc where oid = 'private.materialize_sessions_for_class(uuid)'::regprocedure)) > 0 then
    raise exception '0180 rollback: the materializer still reads class_schedule_slots';
  end if;
end;
$verify$;
