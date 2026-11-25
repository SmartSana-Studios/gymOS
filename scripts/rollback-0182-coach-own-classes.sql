-- Rollback for migration 0182: coaches create, edit and cancel their own classes (Epic 29, Story 29.3).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0182-coach-own-classes.sql
--
-- Restores the 0181 bodies of public.create_class (10 arguments), public.update_class (11 arguments), public.cancel_class and
-- public.list_my_classes (dropped and re-created without description and recurrence_start_date), and the 0096 body of
-- public.list_my_class_session_roster (no cancelled filter). Drops private.is_live_own_coach. Classes a Coach created stay (they are ordinary
-- classes); audit rows already written (class_created_by_coach and the rest) stay: the audit log is append-only. The restored Coach My
-- Classes page of the previous dashboard release reads the same columns as before 0182 except description and recurrence_start_date.
set local lock_timeout = '5s';

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
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
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
    v_gym_id, p_name, p_description, p_coach_id, p_capacity, p_schedule_type,
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
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  select c.name, c.schedule_type, c.one_off_session_at, c.recurrence_start_date, c.cancelled_at
  into v_old
  from classes c
  where c.id = p_class_id and c.gym_id = v_gym_id
  for update;

  if not found then
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
    coach_id = p_coach_id,
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
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'cancel_class: gym % is not active', v_gym_id;
  end if;

  select c.name, c.cancelled_at, c.schedule_type, c.one_off_session_at
  into v_class
  from classes c
  where c.id = p_class_id and c.gym_id = v_gym_id
  for update;

  if not found then
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
  matches_slots boolean
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
         v.matches_slots
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
    and c.coach_id = v_coach_id
  order by b.name, b.id;
end;
$$;

drop function private.is_live_own_coach(uuid);

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

do $verify$
begin
  if to_regprocedure('private.is_live_own_coach(uuid)') is not null then
    raise exception '0182 rollback: private.is_live_own_coach still exists';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.cancel_class(uuid)'::regprocedure
    )
    and p.prosrc ~ 'is_live_own_coach'
  ) then
    raise exception '0182 rollback: a function still carries the Coach gate';
  end if;

  if exists (select 1 from pg_proc p where p.oid = 'public.list_my_classes()'::regprocedure and p.proargnames @> array['description']) then
    raise exception '0182 rollback: list_my_classes still returns description';
  end if;
end;
$verify$;
