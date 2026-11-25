-- ============================================================================
-- 0180: Class schedule slots foundation (Epic 29, Story 29.1; FR-244, FR-245; spine AD-57, AD-21, AD-1).
--
-- A recurring class stored one time and a list of days on the classes row, so it could not run at a different time on each day. This
-- migration stores the times as rows (class_schedule_slots, one per weekday and start time), expands every existing recurring class into
-- slots, points the shared session materializer at the slots, and adds the one regeneration path, private.apply_class_slots. Nothing a
-- member, a coach or a manager sees changes: create_class and update_class keep their signatures and derive the slots from the single
-- time and the selected days, and no existing session or booking is moved or deleted.
--
-- Objects:
--   * class_schedule_slots   read-only for clients (the 0111 pattern: revoke all, grant select, RLS select policy, restrictive
--                            tenant_active_gate as in 0124). Every writer is a SECURITY DEFINER function owned by postgres.
--   * triggers on the table  tenancy (same gym as the class, a slot never moves), the 14-slot cap (locks the class row first, so two
--                            concurrent 14th and 15th inserts serialize), and a DEFERRED constraint trigger pair that refuses to commit a
--                            recurring class with no slot or a one-off class with one.
--   * classes_derive_slots   AFTER INSERT trigger on classes: a recurring class inserted directly with days and time (the legacy
--                            writers: older pgTAP fixtures, any script) gets its slots derived. It does nothing when the legacy columns
--                            are null, which is how Story 29.2 will create a slot-only class.
--   * classes_schedule_matches_type  replaced: a recurring class requires only recurrence_start_date. recurrence_days and
--                            recurrence_time stay on the table (nullable for recurring rows) and are still written by create_class and
--                            update_class; the clean-up migration that drops them is recorded in deferred-work.md.
--   * private.materialize_sessions_for_class  same signature, same ON CONFLICT (class_id, scheduled_at) DO NOTHING, same window
--                            (current_date .. current_date + 4 weeks, server date), same gym time-zone conversion; only the source of the
--                            weekdays and the time changes (the slots). It takes FOR KEY SHARE on the class row first, so a daily run
--                            queued behind a slot edit reads the new slots, never the old ones. run_class_session_materializer_job() is
--                            not touched.
--   * private.apply_class_slots(class_id, slots jsonb)  the single regeneration path. Lock order (AD-21): the class row FOR UPDATE, then
--                            the future session rows FOR UPDATE in scheduled_at order, never the reverse (book_class_session locks one
--                            session row and takes no class lock). A future session that matches no slot and still has no booking
--                            (re-checked under the session lock) is deleted; one that matches is kept; one that matches no slot but has
--                            a booking is left exactly as it is and returned. Past sessions are never touched.
--   * create_class, update_class, materialize_class_sessions  same signatures. For a RECURRING class update_class and
--                            materialize_class_sessions(id, true) no longer raise "cannot reschedule ... existing bookings" (the reverse
--                            of 0058's rule); a one-off class keeps that refusal.
--
-- A session matches a slot when it is the instant the materializer would generate for that slot on that gym-local date, i.e. the gym-local
-- weekday and clock time of scheduled_at equal the slot's, and the local date is not before recurrence_start_date. (Comparing instants
-- rather than clock times keeps a session generated inside a daylight-saving gap matching its own slot.)
--
-- Lock and gate notes. The three public functions carry the suspension guard (current_gym_status() is distinct from 'active') before their
-- first write and no comments in the body (suspension_rpc_coverage.test.sql matches on the source). private.apply_class_slots and
-- private.classes_derive_slots write gated tables but are reachable only behind those gated functions or an already-gated classes insert,
-- like private.materialize_sessions_for_class, and are on that test's exclusion list. Nothing here names the supervisor role in a policy or
-- a new function (support_capabilities.test.sql classifies those).
--
-- Pre-flight and lock. A DO block at the top refuses, naming the class ids, before any DDL when a recurring class has a recurrence_time with seconds or at
-- 24:00 or later, or a recurrence_days entry outside 0..6 (the expansion would otherwise fail later on a raw constraint name). The migration then takes
-- LOCK TABLE class_sessions, class_bookings IN SHARE MODE before the before-snapshot, so a live booking or the 02:00 job cannot land between the
-- snapshot and the self-check and roll back a correct migration; writers to those two tables wait for the length of the migration.
--
-- Rollback: scripts/rollback-0180-class-schedule-slots.sql (refuses when a class's slots differ from its legacy columns).
-- ============================================================================

-- 0a. Pre-flight: refuse before any DDL, naming the rows, instead of failing later on a raw constraint name ----

do $preflight$
declare
  v_bad text;
begin
  select string_agg(c.id::text, ', ' order by c.id) into v_bad
  from classes c
  where c.schedule_type = 'recurring'
    and c.recurrence_time is not null
    and (date_trunc('minute', c.recurrence_time) <> c.recurrence_time or c.recurrence_time >= time '24:00');
  if v_bad is not null then
    raise exception '0180 pre-flight: recurring classes whose recurrence_time has seconds or is 24:00 or later (a slot start time is a whole minute before 24:00): %', v_bad;
  end if;

  select string_agg(c.id::text, ', ' order by c.id) into v_bad
  from classes c
  where c.schedule_type = 'recurring'
    and c.recurrence_days is not null
    and not (c.recurrence_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
  if v_bad is not null then
    raise exception '0180 pre-flight: recurring classes with a recurrence_days entry outside 0..6: %', v_bad;
  end if;
end;
$preflight$;

set local lock_timeout = '10s';

-- 0b. Snapshot of the sessions and bookings, compared by the self-check at the end ---------
-- The share lock keeps a live booking or the daily job from landing between the snapshot and the self-check (which would make a correct
-- migration roll back on a count or md5 difference); it blocks writers to the two tables for the length of this migration.
-- A DO block, not a bare statement: the Supabase CLI replays a migration file statement by statement outside a transaction (a fresh `supabase start`, CI,
-- `supabase db reset`), where a bare LOCK TABLE fails with "can only be used in transaction blocks". scripts/deploy-migration.sh wraps the file in begin ... commit, so
-- in a production apply the lock taken here is held to the end of the migration, as designed; in a replay it is released at once, which is harmless on a database
-- the migration is building from nothing.
do $lock$
begin
  lock table class_sessions, class_bookings in share mode;
end;
$lock$;

create temp table m0180_before as
select
  (select count(*) from class_sessions) as sessions_n,
  (select coalesce(md5(string_agg(id::text || '|' || class_id::text || '|' || scheduled_at::text, ',' order by id)), '') from class_sessions) as sessions_md5,
  (select count(*) from class_bookings) as bookings_n,
  (select coalesce(md5(string_agg(id::text || '|' || class_session_id::text || '|' || member_id::text || '|' || coalesce(attended_at::text, ''), ',' order by id)), '') from class_bookings) as bookings_md5;

-- 1. The table ----------------------------------------------------------------------------

create table class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  gym_id uuid not null references gyms(id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  created_at timestamptz not null default now(),
  constraint class_schedule_slots_start_time_minute check (date_trunc('minute', start_time) = start_time and start_time < time '24:00'),
  constraint class_schedule_slots_class_weekday_time_key unique (class_id, weekday, start_time)
);

create index idx_class_schedule_slots_gym_id on class_schedule_slots (gym_id);

alter table class_schedule_slots enable row level security;

-- Read-only for clients; every writer is SECURITY DEFINER. Default privileges also hand out TRUNCATE (which bypasses RLS), so strip all first.
revoke all on class_schedule_slots from anon, authenticated, service_role;
grant select on class_schedule_slots to authenticated, service_role;

create policy "gym_members_read_own_class_schedule_slots" on class_schedule_slots
  for select
  using (gym_id = (select private.gym_id()));

create policy "tenant_active_gate" on class_schedule_slots
  as restrictive
  for all
  using ((select private.current_gym_status()) = 'active' or (select private.is_super_admin()))
  with check ((select private.current_gym_status()) = 'active' or (select private.is_super_admin()));

-- 2. Tenancy, cap and presence triggers --------------------------------------------------

-- Same shape as classes_validate_coach (0057): definer, so the class lookup sees the true row whatever the caller's RLS visibility.
create function private.class_schedule_slots_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_gym_id uuid;
begin
  if tg_op = 'UPDATE' and (new.class_id is distinct from old.class_id or new.gym_id is distinct from old.gym_id) then
    raise exception 'class_schedule_slots: a slot cannot move to another class or gym';
  end if;

  select c.gym_id into v_class_gym_id
  from classes c
  where c.id = new.class_id
  for update;

  if v_class_gym_id is distinct from new.gym_id then
    raise exception 'class_schedule_slots.gym_id must match the gym of its class';
  end if;

  return new;
end;
$$;

revoke execute on function private.class_schedule_slots_validate() from public, anon;

create trigger class_schedule_slots_validate_trigger
  before insert or update on class_schedule_slots
  for each row
  execute function private.class_schedule_slots_validate();

-- The count is taken under the class row lock (FOR UPDATE), so two concurrent inserts of the 14th and the 15th slot cannot both pass.
create function private.class_schedule_slots_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from classes c where c.id = new.class_id for update;

  -- A slot that is already stored is not a new one: `insert ... on conflict do nothing` fires this BEFORE trigger before it detects the
  -- duplicate, so without this a class holding 14 slots could not be given its own set again.
  if exists (
    select 1 from class_schedule_slots s
    where s.class_id = new.class_id and s.weekday = new.weekday and s.start_time = new.start_time
  ) then
    return new;
  end if;

  if (select count(*) from class_schedule_slots s where s.class_id = new.class_id) >= 14 then
    raise exception 'a class can have at most 14 weekly times'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function private.class_schedule_slots_cap() from public, anon;

create trigger class_schedule_slots_cap_trigger
  before insert on class_schedule_slots
  for each row
  execute function private.class_schedule_slots_cap();

-- 3. The classes CHECK: a recurring class requires only its start date ------------------

alter table classes drop constraint classes_schedule_matches_type;

-- Same explicit is not null / is null guards as 0057 (a bare comparison against a nullable column silently no-ops under three-valued logic).
alter table classes add constraint classes_schedule_matches_type check (
  (schedule_type = 'one_off'
    and one_off_session_at is not null
    and recurrence_days is null and recurrence_time is null and recurrence_start_date is null)
  or
  (schedule_type = 'recurring'
    and one_off_session_at is null
    and recurrence_start_date is not null)
);

-- 4. Expansion of every existing recurring class ----------------------------------------

insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
select c.id, c.gym_id, d.day, c.recurrence_time
from classes c
cross join lateral unnest(c.recurrence_days) as d(day)
where c.schedule_type = 'recurring'
  and c.recurrence_time is not null
on conflict (class_id, weekday, start_time) do nothing;

-- 5. Deferred presence check: a recurring class has a slot, a one-off class has none -------

create function private.class_schedule_slots_check_presence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_type text;
  v_slots integer;
begin
  if tg_table_name = 'classes' then
    v_class_id := new.id;
  elsif tg_op = 'DELETE' then
    v_class_id := old.class_id;
  else
    v_class_id := new.class_id;
  end if;

  select c.schedule_type into v_type from classes c where c.id = v_class_id;
  if not found then
    return null;
  end if;

  select count(*) into v_slots from class_schedule_slots s where s.class_id = v_class_id;

  if v_type = 'recurring' and v_slots = 0 then
    raise exception 'class %: a recurring class needs at least one weekly time', v_class_id
      using errcode = '23514';
  end if;

  if v_type = 'one_off' and v_slots > 0 then
    raise exception 'class %: a one-off class cannot have weekly times', v_class_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function private.class_schedule_slots_check_presence() from public, anon;

create constraint trigger classes_slot_presence_check
  after insert or update of schedule_type on classes
  deferrable initially deferred
  for each row
  execute function private.class_schedule_slots_check_presence();

create constraint trigger class_schedule_slots_presence_check
  after insert or update or delete on class_schedule_slots
  deferrable initially deferred
  for each row
  execute function private.class_schedule_slots_check_presence();

-- 6. Compatibility: a recurring class inserted directly with days and time gets its slots ---

create function private.classes_derive_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.schedule_type = 'recurring'
    and new.recurrence_days is not null
    and cardinality(new.recurrence_days) > 0
    and new.recurrence_time is not null
    and not exists (select 1 from class_schedule_slots s where s.class_id = new.id)
  then
    insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
    select new.id, new.gym_id, d.day, new.recurrence_time
    from unnest(new.recurrence_days) as d(day)
    on conflict (class_id, weekday, start_time) do nothing;
  end if;

  return null;
end;
$$;

revoke execute on function private.classes_derive_slots() from public, anon;

create trigger classes_derive_slots_trigger
  after insert on classes
  for each row
  execute function private.classes_derive_slots();

-- 7. The shared materializer reads the slots --------------------------------------------

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
  v_recurrence_start_date date;
  v_d date;
begin
  select c.gym_id, g.timezone, c.schedule_type, c.one_off_session_at, c.recurrence_start_date
  into v_gym_id, v_gym_timezone, v_schedule_type, v_one_off_session_at, v_recurrence_start_date
  from classes c
  join gyms g on g.id = c.gym_id
  where c.id = p_class_id
  for key share of c;

  if not found then
    raise exception 'materialize_sessions_for_class: class % not found', p_class_id;
  end if;

  if v_schedule_type = 'one_off' then
    insert into class_sessions (gym_id, class_id, scheduled_at)
    values (v_gym_id, p_class_id, v_one_off_session_at)
    on conflict (class_id, scheduled_at) do nothing;
    return;
  end if;

  -- Recurring: a rolling 4-week-ahead window, one session per slot on each matching weekday. `d + start_time` is a plain timestamp;
  -- `at time zone <gym zone>` reads it as the gym's local time and converts it to timestamptz. The window is always
  -- [current_date, current_date + 4 weeks], filtered by v_d >= start date inside the loop (a start date beyond 4 weeks would otherwise
  -- invert the generate_series bounds, see 0057).
  for v_d in
    select generate_series(
      current_date,
      current_date + interval '4 weeks',
      interval '1 day'
    )::date
  loop
    if v_d >= v_recurrence_start_date then
      insert into class_sessions (gym_id, class_id, scheduled_at)
      select v_gym_id, p_class_id, (v_d + s.start_time) at time zone v_gym_timezone
      from class_schedule_slots s
      where s.class_id = p_class_id
        and s.weekday = extract(dow from v_d)::smallint
      on conflict (class_id, scheduled_at) do nothing;
    end if;
  end loop;
end;
$$;

revoke execute on function private.materialize_sessions_for_class(uuid) from public, anon;
grant execute on function private.materialize_sessions_for_class(uuid) to service_role;

-- 8. The single regeneration path -------------------------------------------------------

create function private.apply_class_slots(p_class_id uuid, p_slots jsonb)
returns table (class_session_id uuid, scheduled_at timestamptz, booked_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_gym_id uuid;
  v_type text;
  v_start_date date;
  v_tz text;
  v_session record;
  v_matches boolean;
  v_booked integer;
begin
  select c.gym_id, c.schedule_type, c.recurrence_start_date, g.timezone
  into v_gym_id, v_type, v_start_date, v_tz
  from classes c
  join gyms g on g.id = c.gym_id
  where c.id = p_class_id
  for update of c;

  if not found then
    raise exception 'apply_class_slots: class % not found', p_class_id;
  end if;

  if v_type is distinct from 'recurring' then
    raise exception 'apply_class_slots: class % is not recurring', p_class_id;
  end if;

  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'apply_class_slots: a recurring class needs at least one weekly time';
  end if;

  delete from class_schedule_slots s
  where s.class_id = p_class_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_slots) as x(weekday smallint, start_time time)
      where x.weekday = s.weekday and x.start_time = s.start_time
    );

  insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
  select distinct p_class_id, v_gym_id, x.weekday, x.start_time
  from jsonb_to_recordset(p_slots) as x(weekday smallint, start_time time)
  on conflict (class_id, weekday, start_time) do nothing;

  for v_session in
    select cs.id, cs.scheduled_at
    from class_sessions cs
    where cs.class_id = p_class_id
      and cs.scheduled_at > now()
    order by cs.scheduled_at
    for update of cs
  loop
    v_matches := (v_session.scheduled_at at time zone v_tz)::date >= v_start_date
      and exists (
        select 1
        from class_schedule_slots s
        where s.class_id = p_class_id
          and s.weekday = extract(dow from (v_session.scheduled_at at time zone v_tz))::smallint
          and (((v_session.scheduled_at at time zone v_tz)::date + s.start_time) at time zone v_tz) = v_session.scheduled_at
      );

    if v_matches then
      continue;
    end if;

    select count(*) into v_booked from class_bookings cb where cb.class_session_id = v_session.id;

    if v_booked = 0 then
      delete from class_sessions cs where cs.id = v_session.id;
    else
      class_session_id := v_session.id;
      scheduled_at := v_session.scheduled_at;
      booked_count := v_booked;
      return next;
    end if;
  end loop;

  perform private.materialize_sessions_for_class(p_class_id);
end;
$$;

revoke execute on function private.apply_class_slots(uuid, jsonb) from public, anon;
grant execute on function private.apply_class_slots(uuid, jsonb) to service_role;

-- 9. create_class, update_class, materialize_class_sessions ----------------------------
-- Bodies carry no comments: suspension_rpc_coverage.test.sql matches the guard and the first write on the source text.

create or replace function public.create_class(p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'create_class: gym % is not active', v_gym_id;
  end if;

  if p_schedule_type = 'recurring'
    and (coalesce(cardinality(p_recurrence_days), 0) = 0 or p_recurrence_time is null)
  then
    raise exception 'create_class: a recurring class needs days and a time'
      using errcode = '23514';
  end if;

  insert into classes (
    gym_id, name, description, coach_id, capacity, schedule_type,
    one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date
  ) values (
    v_gym_id, p_name, p_description, p_coach_id, p_capacity, p_schedule_type,
    p_one_off_session_at, p_recurrence_days, p_recurrence_time, p_recurrence_start_date
  )
  returning id into v_class_id;

  if p_schedule_type = 'recurring' then
    insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
    select v_class_id, v_gym_id, d.day, p_recurrence_time
    from unnest(p_recurrence_days) as d(day)
    on conflict (class_id, weekday, start_time) do nothing;
  end if;

  perform private.materialize_sessions_for_class(v_class_id);

  return v_class_id;
end;
$function$;

create or replace function public.update_class(p_class_id uuid, p_name text, p_description text, p_coach_id uuid, p_capacity integer, p_schedule_type text, p_one_off_session_at timestamp with time zone, p_recurrence_days smallint[], p_recurrence_time time without time zone, p_recurrence_start_date date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gym_id uuid;
  v_old record;
  v_schedule_changed boolean;
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
    raise exception 'update_class: gym % is not active', v_gym_id;
  end if;

  if p_schedule_type = 'recurring'
    and (coalesce(cardinality(p_recurrence_days), 0) = 0 or p_recurrence_time is null)
  then
    raise exception 'update_class: a recurring class needs days and a time'
      using errcode = '23514';
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

  if v_schedule_changed
    and (v_old.schedule_type = 'one_off' or p_schedule_type = 'one_off')
    and exists (
      select 1
      from class_sessions cs
      join class_bookings cb on cb.class_session_id = cs.id
      where cs.class_id = p_class_id and cs.scheduled_at > now()
    )
  then
    raise exception 'update_class: cannot reschedule class % -- existing bookings on its future sessions', p_class_id;
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
    if p_schedule_type = 'recurring' and v_old.schedule_type = 'recurring' then
      select jsonb_agg(jsonb_build_object('weekday', d.day, 'start_time', p_recurrence_time::text))
      into v_slots
      from (select distinct unnest(p_recurrence_days) as day) d;

      perform 1 from private.apply_class_slots(p_class_id, v_slots);
    else
      delete from class_schedule_slots where class_id = p_class_id;
      delete from class_sessions where class_id = p_class_id and scheduled_at > now();

      if p_schedule_type = 'recurring' then
        insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
        select p_class_id, v_gym_id, d.day, p_recurrence_time
        from unnest(p_recurrence_days) as d(day)
        on conflict (class_id, weekday, start_time) do nothing;
      end if;

      perform private.materialize_sessions_for_class(p_class_id);
    end if;
  end if;
end;
$function$;

create or replace function public.materialize_class_sessions(p_class_id uuid, p_reschedule boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller_gym_id uuid;
  v_class_gym_id uuid;
  v_type text;
  v_slots jsonb;
begin
  if not coalesce((select private.current_member_role())::text = any(array['manager', 'supervisor', 'owner']), false) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  if private.current_gym_status() is distinct from 'active' then
    raise exception 'materialize_class_sessions: gym % is not active', v_caller_gym_id;
  end if;

  select gym_id, schedule_type into v_class_gym_id, v_type
  from classes
  where id = p_class_id and gym_id = v_caller_gym_id
  for update;

  if v_class_gym_id is null then
    raise exception 'materialize_class_sessions: class % not found', p_class_id;
  end if;

  if p_reschedule and v_type = 'recurring' then
    select jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', s.start_time::text))
    into v_slots
    from class_schedule_slots s
    where s.class_id = p_class_id;

    perform 1 from private.apply_class_slots(p_class_id, v_slots);
    return;
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

-- 10. Self-check: any failure raises and rolls the whole migration back ----------------

do $verify$
declare
  v_before record;
  v_sessions_n bigint;
  v_sessions_md5 text;
  v_bookings_n bigint;
  v_bookings_md5 text;
begin
  if to_regclass('public.class_schedule_slots') is null then
    raise exception '0180: class_schedule_slots missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.class_schedule_slots'::regclass) then
    raise exception '0180: class_schedule_slots has no row level security';
  end if;

  if has_table_privilege('authenticated', 'public.class_schedule_slots', 'INSERT')
    or has_table_privilege('authenticated', 'public.class_schedule_slots', 'UPDATE')
    or has_table_privilege('authenticated', 'public.class_schedule_slots', 'DELETE')
    or has_table_privilege('service_role', 'public.class_schedule_slots', 'INSERT')
    or has_table_privilege('service_role', 'public.class_schedule_slots', 'UPDATE')
    or has_table_privilege('service_role', 'public.class_schedule_slots', 'DELETE')
    or has_table_privilege('anon', 'public.class_schedule_slots', 'SELECT')
  then
    raise exception '0180: class_schedule_slots has a client write grant or an anon read grant';
  end if;

  if not has_table_privilege('authenticated', 'public.class_schedule_slots', 'SELECT')
    or not has_table_privilege('service_role', 'public.class_schedule_slots', 'SELECT')
  then
    raise exception '0180: class_schedule_slots lost its SELECT grant';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'class_schedule_slots' and policyname = 'tenant_active_gate') <> 1
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'class_schedule_slots') <> 2
  then
    raise exception '0180: class_schedule_slots policies are not the select policy plus tenant_active_gate';
  end if;

  if exists (select 1 from classes c where c.schedule_type = 'recurring' and not exists (select 1 from class_schedule_slots s where s.class_id = c.id)) then
    raise exception '0180: a recurring class ended with zero slots';
  end if;

  if exists (select 1 from classes c where c.schedule_type = 'one_off' and exists (select 1 from class_schedule_slots s where s.class_id = c.id)) then
    raise exception '0180: a one-off class has a slot';
  end if;

  if exists (
    select 1
    from classes c
    where c.schedule_type = 'recurring'
      and c.recurrence_days is not null
      and (select count(*) from class_schedule_slots s where s.class_id = c.id)
          <> (select count(distinct d.day) from unnest(c.recurrence_days) as d(day))
  ) then
    raise exception '0180: a class slot count differs from its distinct recurrence_days';
  end if;

  if exists (
    select 1 from (
      (select c.id as class_id, d.day as weekday, c.recurrence_time as start_time
         from classes c cross join lateral unnest(c.recurrence_days) as d(day)
        where c.schedule_type = 'recurring' and c.recurrence_days is not null
       except
       select s.class_id, s.weekday, s.start_time from class_schedule_slots s)
      union all
      (select s.class_id, s.weekday, s.start_time from class_schedule_slots s
         join classes c on c.id = s.class_id and c.recurrence_days is not null
       except
       select c.id, d.day, c.recurrence_time
         from classes c cross join lateral unnest(c.recurrence_days) as d(day)
        where c.schedule_type = 'recurring' and c.recurrence_days is not null)
    ) diff
  ) then
    raise exception '0180: a class slot set differs from unnest(recurrence_days) x recurrence_time';
  end if;

  select * into v_before from m0180_before;
  select count(*), coalesce(md5(string_agg(id::text || '|' || class_id::text || '|' || scheduled_at::text, ',' order by id)), '')
    into v_sessions_n, v_sessions_md5 from class_sessions;
  select count(*), coalesce(md5(string_agg(id::text || '|' || class_session_id::text || '|' || member_id::text || '|' || coalesce(attended_at::text, ''), ',' order by id)), '')
    into v_bookings_n, v_bookings_md5 from class_bookings;

  if v_sessions_n <> v_before.sessions_n or v_sessions_md5 <> v_before.sessions_md5 then
    raise exception '0180: class_sessions changed (% rows before, % after)', v_before.sessions_n, v_sessions_n;
  end if;

  if v_bookings_n <> v_before.bookings_n or v_bookings_md5 <> v_before.bookings_md5 then
    raise exception '0180: class_bookings changed (% rows before, % after)', v_before.bookings_n, v_bookings_n;
  end if;

  if position('class_schedule_slots' in (select prosrc from pg_proc where oid = 'private.materialize_sessions_for_class(uuid)'::regprocedure)) = 0 then
    raise exception '0180: the materializer does not read class_schedule_slots';
  end if;

  if to_regprocedure('private.apply_class_slots(uuid, jsonb)') is null then
    raise exception '0180: private.apply_class_slots missing';
  end if;

  if position('apply_class_slots' in (select prosrc from pg_proc where oid = 'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure)) = 0
    or position('apply_class_slots' in (select prosrc from pg_proc where oid = 'public.materialize_class_sessions(uuid, boolean)'::regprocedure)) = 0
    or position('class_schedule_slots' in (select prosrc from pg_proc where oid = 'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure)) = 0
  then
    raise exception '0180: create_class, update_class or materialize_class_sessions was not replaced';
  end if;
end;
$verify$;

drop table m0180_before;
