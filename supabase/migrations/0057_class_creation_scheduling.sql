-- Story 12.1: Class Creation & Scheduling (FR-104, FR-121). First story in
-- Epic 12 -- no classes/scheduling concept exists anywhere in the schema
-- before this migration. `classes` + `class_sessions` are wholly new,
-- additive-only tables; no existing table's migration file is touched.
--
-- Schema/function design here is this story's own invention, grounded in
-- ARCHITECTURE-SPINE.md's ERD (CLASSES ||--o{ CLASS_SESSIONS, gym-scoped)
-- and the `private`-helper/public-RPC/cron-job dual-layer pattern
-- 0056_quiet_gym_alert_opt_in_delivery.sql already proved out for a
-- different feature (see private.materialize_sessions_for_class() below).

-- ============================================================================
-- classes: admin-configured class definitions. One-off classes carry a
-- single `one_off_session_at`; recurring classes carry a day(s)-of-week +
-- time + start-date pattern. No deactivated_at/delete path -- no AC in this
-- story or epic asks for class deletion.
-- ============================================================================
create table classes (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  name text not null,
  description text,
  coach_id uuid not null references members(id),
  capacity integer not null check (capacity > 0),
  schedule_type text not null check (schedule_type in ('one_off', 'recurring')),
  one_off_session_at timestamptz,
  -- Postgres's own extract(dow from ...) convention: 0 = Sunday .. 6 =
  -- Saturday, so the materializer's date-generation loop can compare with
  -- zero conversion. Only the UI's day-toggle labels need EN/FR translation
  -- -- these stored values are plain integers (locale formatting only at
  -- UI render, matching this schema's established convention).
  recurrence_days smallint[],
  recurrence_time time,
  recurrence_start_date date,
  created_at timestamptz not null default now()
);

-- Mirrors plans_duration_days_matches_plan_type's (0017) explicit
-- is not null/is null guards -- a bare comparison against a nullable column
-- silently no-ops under SQL's three-valued logic (NULL compared to
-- anything is NULL, and Postgres treats a NULL CHECK result as satisfied,
-- not a violation), the exact trap 0017's own comment documents.
alter table classes add constraint classes_schedule_matches_type check (
  (schedule_type = 'one_off'
    and one_off_session_at is not null
    and recurrence_days is null and recurrence_time is null and recurrence_start_date is null)
  or
  (schedule_type = 'recurring'
    and one_off_session_at is null
    and recurrence_days is not null and array_length(recurrence_days, 1) > 0
    and recurrence_time is not null and recurrence_start_date is not null)
);

-- Review fix: every other enum-like column in this migration (schedule_type,
-- capacity) has a CHECK bounding its values -- recurrence_days didn't. Out-
-- of-range elements would make the UI's DAY_KEY[d] lookup undefined.
-- CHECK constraints cannot contain subqueries (not even over unnest() of the
-- row's own column) -- the array containment operator (<@, "is contained
-- by") expresses the same 0-6 bound without one.
alter table classes add constraint classes_recurrence_days_valid check (
  recurrence_days is null or recurrence_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
);

-- ============================================================================
-- class_sessions: pure schedule metadata (when a session happens). Carries
-- no capacity snapshot, no booking list, no attendance state -- Story 12.2
-- (AD-21) adds class_bookings referencing this table's id, reading
-- classes.capacity live via the class_id FK rather than a per-session
-- snapshot. gym_id is denormalized here (reachable via classes.gym_id),
-- matching coach_assignments' own denormalized-gym_id convention.
-- ============================================================================
create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  class_id uuid not null references classes(id),
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- The materializer's idempotency key (on conflict (class_id, scheduled_at)
-- do nothing below) -- not just a data-quality constraint.
create unique index idx_class_sessions_class_scheduled_at on class_sessions(class_id, scheduled_at);

-- RLS enabled in this same migration, no open-table window (Consistency
-- Conventions table). Full grant, same as every deny-all-by-default table
-- in this schema (coach_assignments, job_runs) -- RLS having zero write
-- policies on class_sessions is what actually blocks client writes, not
-- withholding the grant.
alter table classes enable row level security;
alter table class_sessions enable row level security;

grant select, insert, update, delete on classes, class_sessions to authenticated, service_role;

-- ============================================================================
-- classes RLS. Copies 0017_membership_plan_configuration.sql's exact shape
-- -- a like-for-like Manager/Owner-write, all-staff-read admin-config
-- table, not a booking/capacity-race table. AD-21's SECURITY DEFINER-RPC
-- treatment is scoped to Story 12.2/12.3's booking/attendance RPCs, not
-- this story's class CRUD.
-- ============================================================================
create policy "gym_staff_read_own_classes" on classes
  for select
  using (gym_id = private.gym_id());

create policy "manager_or_owner_insert_own_classes" on classes
  for insert
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

create policy "manager_or_owner_update_own_classes" on classes
  for update
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  )
  with check (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])
  );

-- No delete policy -- no delete feature in scope.

-- ============================================================================
-- Review fix: coach_id (references members(id)) had no DB-level enforcement
-- that the referenced member belongs to the class's own gym or holds the
-- 'coach' role -- only the UI's gym-scoped listCoaches() dropdown narrowed
-- the choice. A trigger (not a CHECK, which cannot reference other tables)
-- enforces this on every write path, including direct RPC/service_role
-- calls, not just the dashboard's own Server Actions.
-- ============================================================================
-- security definer: this lookup must see the true members row regardless of
-- the caller's own RLS-scoped visibility (a manager/owner in gym B has no
-- RLS-select access to gym A's members, which would otherwise make a
-- cross-gym coach_id resolve to NULL/NULL here and raise this trigger's own
-- exception instead of letting the classes RLS policy be the one that
-- blocks a cross-gym insert, breaking the "%row-level security%" contract
-- every other cross-tenant test in this file relies on).
create function private.classes_validate_coach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach_gym_id uuid;
  v_coach_role text;
begin
  select gym_id, role into v_coach_gym_id, v_coach_role
  from members
  where id = new.coach_id;

  if v_coach_gym_id is distinct from new.gym_id or v_coach_role is distinct from 'coach' then
    raise exception 'classes.coach_id must reference a coach-role member of the same gym';
  end if;

  return new;
end;
$$;

create trigger classes_validate_coach_trigger
  before insert or update of coach_id, gym_id on classes
  for each row
  execute function private.classes_validate_coach();

-- class_sessions: read-only for all gym staff. No insert/update/delete
-- policy for authenticated at all -- every row is written by the
-- materializer functions below, owned by postgres, which bypasses RLS as a
-- superuser (same reasoning 0021's own comment documents for
-- run_subscription_lifecycle_job).
create policy "gym_staff_read_own_class_sessions" on class_sessions
  for select
  using (gym_id = private.gym_id());

-- ============================================================================
-- private.materialize_sessions_for_class(): the FR-104/FR-105 shared
-- helper. Mirrors private.gym_occupancy_band()'s (0056) dual-layer shape
-- -- an unchecked private-schema helper, wrapped by a role-checked public
-- entry point for the interactive path (materialize_class_sessions below)
-- and called directly by the cron job for the batch path
-- (run_class_session_materializer_job).
--
-- Schema `private` is USAGE-granted to `authenticated` (0009) and Postgres
-- grants EXECUTE to PUBLIC by default on function creation -- the revoke
-- below prevents any authenticated caller from invoking this directly with
-- an arbitrary class id, same reasoning 0056's own comment documents.
-- ============================================================================
create function private.materialize_sessions_for_class(p_class_id uuid)
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

revoke execute on function private.materialize_sessions_for_class(uuid) from public;
grant execute on function private.materialize_sessions_for_class(uuid) to service_role;

-- ============================================================================
-- materialize_class_sessions(): interactive entry point, called by the
-- dashboard's create/edit Server Actions. Role-checks manager/owner first
-- (cheapest, no data read, matches assign_coach()'s ordering), then a
-- gym-scoped existence lookup with the uniform not-found failure mode.
--
-- p_reschedule = true deletes not-yet-occurred sessions (future-only,
-- preserves history -- AC #7) and re-materializes in the same transaction,
-- so the client never sees a window with zero future sessions between two
-- separate calls.
-- ============================================================================
create function materialize_class_sessions(p_class_id uuid, p_reschedule boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_gym_id uuid;
  v_class_gym_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_caller_gym_id := private.gym_id();
  if v_caller_gym_id is null then
    raise exception 'permission denied';
  end if;

  select gym_id into v_class_gym_id
  from classes
  where id = p_class_id and gym_id = v_caller_gym_id;

  if v_class_gym_id is null then
    raise exception 'materialize_class_sessions: class % not found', p_class_id;
  end if;

  if p_reschedule then
    delete from class_sessions where class_id = p_class_id and scheduled_at > now();
  end if;

  perform private.materialize_sessions_for_class(p_class_id);
end;
$$;

revoke execute on function materialize_class_sessions(uuid, boolean) from public;
grant execute on function materialize_class_sessions(uuid, boolean) to authenticated;

-- ============================================================================
-- Review fix: create_class()/update_class() -- atomic interactive entry
-- points replacing the dashboard's previous two-round-trip pattern (insert/
-- update the classes row, then a separate materialize_class_sessions RPC
-- call). That pattern left a partial-failure window: insertClass's
-- compensating delete on materialize failure was never itself checked for
-- success, and updateClass had no compensating action at all if
-- materialize_class_sessions failed after the row UPDATE had already
-- committed. Combining the row write and materialization into one
-- SECURITY DEFINER plpgsql function makes both succeed or both roll back
-- atomically in a single DB transaction, closing that window entirely.
--
-- update_class() also computes "did the schedule actually change" itself,
-- via typed IS DISTINCT FROM comparisons against the pre-update row read in
-- the same transaction -- not by comparing serialized strings across the
-- client/DB boundary the way the dashboard's previous JS-side comparison
-- did (which mismatched on timestamptz "+00:00" vs ISO "Z" formatting, and
-- on time "HH:mm:ss" vs "HH:mm" formatting, making it a near-permanent
-- false positive).
-- ============================================================================
create function create_class(
  p_name text,
  p_description text,
  p_coach_id uuid,
  p_capacity integer,
  p_schedule_type text,
  p_one_off_session_at timestamptz,
  p_recurrence_days smallint[],
  p_recurrence_time time,
  p_recurrence_start_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_class_id uuid;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
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
$$;

revoke execute on function create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date) from public;
grant execute on function create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date) to authenticated;

create function update_class(
  p_class_id uuid,
  p_name text,
  p_description text,
  p_coach_id uuid,
  p_capacity integer,
  p_schedule_type text,
  p_one_off_session_at timestamptz,
  p_recurrence_days smallint[],
  p_recurrence_time time,
  p_recurrence_start_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_old record;
  v_schedule_changed boolean;
begin
  if not ((auth.jwt() ->> 'app_role') = any(array['manager', 'owner'])) then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
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
$$;

revoke execute on function update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date) from public;
grant execute on function update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date) to authenticated;

-- ============================================================================
-- run_class_session_materializer_job(): daily top-up for recurring classes,
-- keeping the rolling 4-week window extended forward indefinitely without
-- anyone re-triggering anything by hand. One-off classes need no top-up
-- (materialized once at creation via the interactive entry point above).
--
-- Mirrors run_subscription_lifecycle_job's outer shape (job_runs insert on
-- success/failure, log_audit_event on failure). Each class's failure is
-- wrapped in its own BEGIN...EXCEPTION block -- one class's failure must
-- never abort the loop for the rest, matching every other job's per-item
-- isolation discipline (run_quiet_gym_alert_job, 0056).
-- ============================================================================
create function run_class_session_materializer_job()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_started_at timestamptz := now();
  v_class record;
begin
  begin
    for v_class in select id from classes where schedule_type = 'recurring' loop
      begin
        perform private.materialize_sessions_for_class(v_class.id);
      exception when others then
        raise warning 'run_class_session_materializer_job: materialization failed for class %: %', v_class.id, sqlerrm;
      end;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('class_session_materializer', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('class_session_materializer', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'class_session_materializer_job_failure',
      p_system_actor_label => 'system:class_session_materializer_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$$;

-- cron/direct-postgres only, matching every other job function.
revoke execute on function run_class_session_materializer_job() from public;

-- Daily cadence -- no 15-minute urgency here, unlike occupancy-driven jobs.
-- 02:00 UTC, distinct from subscription_lifecycle's 01:00 UTC to avoid both
-- jobs contending at the exact same minute. cron.schedule() upserts by
-- name -- safe across supabase db reset.
select cron.schedule(
  'class_session_materializer',
  '0 2 * * *',
  $$ select run_class_session_materializer_job(); $$
);
