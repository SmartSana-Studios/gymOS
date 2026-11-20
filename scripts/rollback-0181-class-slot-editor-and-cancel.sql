-- Rollback for migration 0181: per-day slot editor and cancel class (Epic 29, Story 29.2).
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0181-class-slot-editor-and-cancel.sql
--
-- REFUSES while the data cannot be represented without 0181. A per-day class stores recurrence_days and recurrence_time as null, which the
-- restored 0180 update_class and the restored list_my_classes (0096) cannot read; a cancelled class or session has no home once the columns
-- are gone, and un-cancelling it here would silently put a cancelled class back on sale. The script names the first rows and changes nothing.
--
-- Restores the bodies 0181 replaced: private.materialize_sessions_for_class, public.update_class (10 arguments), public.materialize_class_sessions
-- (0180); public.book_class_session, public.cancel_class_booking, public.list_bookable_class_sessions (0124); public.mark_class_attendance
-- (0179); public.list_my_class_bookings (0124, dropped and re-created: 0181 added class_cancelled); public.list_my_classes (0096, dropped and
-- re-created); public.run_class_reminder_job (0059); private.send_class_reminder (0084). Drops: the p_slots overloads of create_class and
-- update_class, public.cancel_class, private.validate_class_slots, the view public.class_sessions_with_match, the cancelled columns and the CHECK.
-- Audit rows already written (class_cancelled, class_times_changed) stay: the audit log is append-only.
set local lock_timeout = '5s';

do $guard$
declare
  v_bad text;
begin
  select string_agg(id::text, ', ') into v_bad from (
    select c.id from classes c
    where c.schedule_type = 'recurring' and (c.recurrence_days is null or c.recurrence_time is null)
    order by c.id limit 5
  ) x;
  if v_bad is not null then
    raise exception '0181 rollback refused: these recurring classes have null recurrence_days or recurrence_time (a per-day class; first 5): %', v_bad;
  end if;

  select string_agg(id::text, ', ') into v_bad from (
    select c.id from classes c where c.cancelled_at is not null order by c.id limit 5
  ) x;
  if v_bad is not null then
    raise exception '0181 rollback refused: these classes are cancelled (first 5): %', v_bad;
  end if;

  select string_agg(id::text, ', ') into v_bad from (
    select s.id from class_sessions s where s.cancelled_at is not null order by s.id limit 5
  ) x;
  if v_bad is not null then
    raise exception '0181 rollback refused: these sessions are cancelled (first 5): %', v_bad;
  end if;
end;
$guard$;

drop view public.class_sessions_with_match;

-- 0180 public.update_class (10 arguments), restored before the p_slots overload it called is dropped
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

drop function public.update_class(uuid, text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb);
drop function public.create_class(text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date, jsonb);
drop function public.cancel_class(uuid);
drop function private.validate_class_slots(text, jsonb);

-- 0180 private.materialize_sessions_for_class
CREATE OR REPLACE FUNCTION private.materialize_sessions_for_class(p_class_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 0180 public.materialize_class_sessions
CREATE OR REPLACE FUNCTION public.materialize_class_sessions(p_class_id uuid, p_reschedule boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- 0124 public.book_class_session
CREATE OR REPLACE FUNCTION public.book_class_session(p_class_session_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_sub_status subscription_status;
  v_scheduled_at timestamptz;
  v_capacity integer;
  v_count integer;
  v_row class_bookings;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'book_class_session: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'book_class_session: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'book_class_session: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'book_class_session: no member record found for the caller';
  end if;

  -- Defense in depth, mirroring check_in()'s own deactivated_at guard: this
  -- RPC is reachable by any holder of a valid session token, not just
  -- through the app's own navigation gate.
  if v_deactivated_at is not null then
    raise exception 'book_class_session: member is deactivated';
  end if;

  -- Subscription eligibility (AC #1) -- mirrors check_in()'s broader
  -- null/expired-only rejection, not a strict status = 'active' filter. See
  -- the story's Dev Notes "Subscription Eligibility" for the reasoning --
  -- this is a judgment call, flagged in docs/decisions.md.
  select status into v_sub_status
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_sub_status is null or v_sub_status = 'expired' then
    raise exception 'book_class_session: member has no active subscription';
  end if;

  -- Row-locked capacity check (AC #2, AD-21): locks the contested row (the
  -- session), matching check_in()'s lock-the-contested-row shape exactly.
  -- Uniform not-found failure covers nonexistent id and cross-gym id
  -- identically, matching this schema's uniform-deny-all-failure
  -- convention.
  select cs.scheduled_at, c.capacity into v_scheduled_at, v_capacity
  from class_sessions cs
  join classes c on c.id = cs.class_id
  where cs.id = p_class_session_id and cs.gym_id = v_gym_id
  for update of cs;

  if v_scheduled_at is null then
    raise exception 'book_class_session: session % not found', p_class_session_id;
  end if;

  if v_scheduled_at <= now() then
    raise exception 'book_class_session: cannot book a session that has already started or passed';
  end if;

  -- Duplicate-booking pre-check (friendly error, unique index is the
  -- concurrency backstop -- same dual-layer pattern check_in()'s
  -- open-session check plays against its own unique index). Checked before
  -- the capacity count below: the member's own existing booking already
  -- counts toward v_count, so checking capacity first would surface "class
  -- is full" instead of "already booked" for a member re-attempting to book
  -- a session they hold the last spot in.
  if exists (select 1 from class_bookings where class_session_id = p_class_session_id and member_id = v_member_id) then
    raise exception 'book_class_session: member already booked this session';
  end if;

  select count(*) into v_count from class_bookings where class_session_id = p_class_session_id;

  if v_count >= v_capacity then
    raise exception 'book_class_session: class is full';
  end if;

  insert into class_bookings (gym_id, class_session_id, member_id)
  values (v_gym_id, p_class_session_id, v_member_id)
  returning * into v_row;

  return v_row;
end;
$function$;

-- 0124 public.cancel_class_booking
CREATE OR REPLACE FUNCTION public.cancel_class_booking(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_found_id uuid;
  v_scheduled_at timestamptz;
  v_cutoff_minutes integer;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'cancel_class_booking: gym % is not active', v_gym_id;
  end if;

  -- order by deactivated_at nulls first: idx_members_active_gym_user (0003)
  -- only guarantees uniqueness among *active* rows, so if a deactivated
  -- historical row for this user/gym ever coexists with an active one,
  -- prefer the active row rather than letting an arbitrary pick reject a
  -- legitimately active member below.
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members
  where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first
  limit 1;

  if v_member_id is null then
    raise exception 'cancel_class_booking: no member record found for the caller';
  end if;

  if v_deactivated_at is not null then
    raise exception 'cancel_class_booking: member is deactivated';
  end if;

  -- Gym- and member-scoped lookup, joined to its session's scheduled_at.
  -- This one query collapses "doesn't exist," "someone else's booking," and
  -- "wrong gym" into the same generic message -- deliberately matching
  -- updateClass's (Story 12.1) already-accepted not-found convention, not a
  -- new gap.
  select cb.id, cs.scheduled_at into v_found_id, v_scheduled_at
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  where cb.id = p_booking_id and cb.gym_id = v_gym_id and cb.member_id = v_member_id;

  if v_found_id is null then
    raise exception 'cancel_class_booking: booking % not found', p_booking_id;
  end if;

  select class_booking_cancellation_cutoff_minutes into v_cutoff_minutes
  from gyms
  where id = v_gym_id;

  if now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes) then
    raise exception 'cancel_class_booking: cancellation cutoff has passed';
  end if;

  -- No row lock needed here (unlike booking): freeing a spot has no
  -- capacity race to guard against; a duplicate cancel attempt on an
  -- already-deleted row simply re-hits the not-found branch above.
  delete from class_bookings where id = v_found_id;
end;
$function$;

-- 0179 public.mark_class_attendance
CREATE OR REPLACE FUNCTION public.mark_class_attendance(p_booking_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_booking_id uuid;
  v_member_id uuid;
  v_class_session_id uuid;
  v_attended_at timestamptz;
  v_status subscription_status;
  v_expiry_date date;
  v_row class_bookings;
  v_charging boolean;
  v_gate_outcome text;
begin
  -- Include supervisor here too, for the same reason as the RLS widening
  -- above (this is new code; match the current UX matrix, don't perpetuate
  -- the pre-Supervisor gap into it). Explicitly excludes coach, matching
  -- the Attendance/Classes-attendance role matrix row.
  if not coalesce((select private.current_member_role())::text = any(array['owner', 'manager', 'receptionist', 'supervisor']), false) then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'mark_class_attendance: gym % is not active', v_gym_id;
  end if;

  -- Gym-scoped booking lookup. Uniform not-found failure covers a
  -- nonexistent id and a cross-gym id identically, matching
  -- cancel_class_booking()'s collapsed not-found convention.
  select cb.id, cb.member_id, cb.class_session_id, cb.attended_at
  into v_booking_id, v_member_id, v_class_session_id, v_attended_at
  from class_bookings cb
  where cb.id = p_booking_id and cb.gym_id = v_gym_id;

  if v_booking_id is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
  end if;

  -- 0112: an already-attended booking returns the stored row and consumes
  -- nothing (also with the charging flag off); attended_at is never rewritten.
  if v_attended_at is not null then
    select * into v_row from class_bookings where id = v_booking_id;
    return v_row;
  end if;

  -- Subscription eligibility (AC #3), copied from book_class_session()'s
  -- exact query/branch -- reject only null/expired, not a stricter
  -- active-only filter (expiring_soon/grace_period can still be marked
  -- attended).
  select status, expiry_date into v_status, v_expiry_date
  from subscriptions
  where member_id = v_member_id
  order by created_at desc
  limit 1;

  if v_status is null or v_status = 'expired' then
    -- Copies check_in()'s exact rejection branch verbatim (0034), including
    -- the on-conflict dedup and the null-v_status-maps-to-'expired'-alert
    -- reasoning -- a booked member with zero subscription rows is the same
    -- defensive "no plan" case check_in() already handles. Does not raise --
    -- returning null on rejection matches check_in()'s own contract, which
    -- callers must handle explicitly.
    insert into front_desk_alerts (gym_id, member_id, status, expiry_date)
    values (v_gym_id, v_member_id, 'expired', v_expiry_date)
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- 0112 kill switch: the charging flag is read here, before any V1.6 call
  -- or lock. Off (or null) skips the consume/gate/attempt/alert/lock path below
  -- (the already-attended return above and the update guard below still
  -- apply to every gym).
  select g.charge_guests_per_session into v_charging
  from gyms g where g.id = v_gym_id;
  v_charging := coalesce(v_charging, false);

  if v_charging then
    -- Canonical lock order: class_sessions, then member (FOR NO KEY UPDATE).
    perform 1 from class_sessions where id = v_class_session_id for no key update;
    perform 1 from members where id = v_member_id for no key update;

    -- A concurrent mark of the same booking may have committed while this
    -- call waited for the locks: return the stored row, consume nothing.
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
    if v_row.attended_at is not null then
      return v_row;
    end if;

    select c.outcome into v_gate_outcome
    from private.consume_guest_session(v_member_id, v_gym_id, now(), 'class', v_booking_id) c;

    if v_gate_outcome = 'denied' then
      -- A denied class mark commits (never raises): one attempt row (fresh
      -- scan id, so every refusal counts) and one active session_required
      -- alert per member (null status; NULLS NOT DISTINCT one-active index).
      insert into session_attempts (gym_id, member_id, scan_id, source, scanned_at, class_session_id)
      values (v_gym_id, v_member_id, gen_random_uuid(), 'class', now(), v_class_session_id);

      insert into front_desk_alerts (gym_id, member_id, kind, status, expiry_date)
      values (v_gym_id, v_member_id, 'session_required', null, null)
      on conflict (member_id, kind, status) where dismissed_at is null do nothing;

      -- attended_at stays null: that is the refusal signal to the caller.
      return v_row;
    end if;
  end if;

  -- Review fix: the booking could still be deleted (cancel_class_booking())
  -- between the existence check above and this update -- without the
  -- not-found recheck, a 0-row update leaves v_row an all-null composite,
  -- indistinguishable from the expired-member rejection shape once it
  -- crosses the PostgREST/JSON boundary.
  update class_bookings set attended_at = now()
  where id = v_booking_id and attended_at is null
  returning * into v_row;

  if v_row.id is null then
    -- Either deleted, or a concurrent mark won the race (flag-off path).
    select * into v_row from class_bookings where id = v_booking_id;
    if v_row.id is null then
      raise exception 'mark_class_attendance: booking % not found', p_booking_id;
    end if;
  end if;

  return v_row;
end;
$function$;

-- 0124 public.list_bookable_class_sessions
CREATE OR REPLACE FUNCTION public.list_bookable_class_sessions()
 RETURNS TABLE(class_session_id uuid, class_name text, description text, coach_name text, scheduled_at timestamp with time zone, capacity integer, booked_count bigint, my_booking_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'list_bookable_class_sessions: caller is not a member';
  end if;
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'list_bookable_class_sessions: caller is not a member';
  end if;
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first limit 1;
  if v_member_id is null then
    raise exception 'list_bookable_class_sessions: no member record found for the caller';
  end if;
  if v_deactivated_at is not null then
    raise exception 'list_bookable_class_sessions: member is deactivated';
  end if;

  return query
  select cs.id, c.name, c.description, coach.name, cs.scheduled_at, c.capacity,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id),
         (select cb.id from class_bookings cb where cb.class_session_id = cs.id and cb.member_id = v_member_id)
  from class_sessions cs
  join classes c on c.id = cs.class_id
  join members coach on coach.id = c.coach_id
  where cs.gym_id = v_gym_id and cs.scheduled_at > now()
  order by cs.scheduled_at asc;
end;
$function$;

-- 0124 public.list_my_class_bookings
drop function public.list_my_class_bookings();
CREATE OR REPLACE FUNCTION public.list_my_class_bookings()
 RETURNS TABLE(booking_id uuid, class_name text, scheduled_at timestamp with time zone, can_cancel boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if (select private.current_member_role())::text is distinct from 'member' then
    raise exception 'list_my_class_bookings: caller is not a member';
  end if;
  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'list_my_class_bookings: caller is not a member';
  end if;
  select id, deactivated_at into v_member_id, v_deactivated_at
  from members where user_id = auth.uid() and gym_id = v_gym_id
  order by deactivated_at nulls first limit 1;
  if v_member_id is null then
    raise exception 'list_my_class_bookings: no member record found for the caller';
  end if;
  if v_deactivated_at is not null then
    raise exception 'list_my_class_bookings: member is deactivated';
  end if;

  return query
  select cb.id, c.name, cs.scheduled_at,
         (now() < cs.scheduled_at - make_interval(mins => g.class_booking_cancellation_cutoff_minutes))
  from class_bookings cb
  join class_sessions cs on cs.id = cb.class_session_id
  join classes c on c.id = cs.class_id
  join gyms g on g.id = cb.gym_id
  where cb.member_id = v_member_id and cb.gym_id = v_gym_id and cs.scheduled_at > now()
  order by cs.scheduled_at asc;
end;
$function$;

revoke execute on function public.list_my_class_bookings() from public, anon;
grant execute on function public.list_my_class_bookings() to authenticated;

-- 0059 public.run_class_reminder_job
CREATE OR REPLACE FUNCTION public.run_class_reminder_job()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_started_at timestamptz := now();
  v_booking record;
begin
  begin
    for v_booking in
      select cb.member_id, cb.class_session_id
      from class_bookings cb
      join class_sessions cs on cs.id = cb.class_session_id
      join classes cl on cl.id = cs.class_id
      join gyms g on g.id = cb.gym_id
      join members m on m.id = cb.member_id
      join member_preferences mp on mp.member_id = m.id
      where g.status = 'active'
        and cs.scheduled_at > now()
        and cs.scheduled_at <= now() + interval '60 minutes'
        and m.deactivated_at is null
        and m.role = 'member'
        and mp.class_reminder_opted_out = false
        and not exists (
          select 1 from private.class_reminder_dispatches d
          where d.class_session_id = cb.class_session_id and d.member_id = cb.member_id
        )
    loop
      -- Implicit savepoint, matching every other dispatch call site in
      -- 0045/0046/0056: one member's send failure must never abort the loop
      -- for the rest of the sessions.
      begin
        perform private.send_class_reminder(v_booking.member_id, v_booking.class_session_id);
      exception when others then
        raise warning 'run_class_reminder_job: dispatch failed for member %, session %: %', v_booking.member_id, v_booking.class_session_id, sqlerrm;
      end;
    end loop;

    insert into job_runs (job_name, started_at, finished_at, status)
    values ('class_reminder', v_started_at, now(), 'success');
  exception when others then
    insert into job_runs (job_name, started_at, finished_at, status, error)
    values ('class_reminder', v_started_at, now(), 'failure', sqlerrm);

    perform log_audit_event(
      p_action_type => 'class_reminder_job_failure',
      p_system_actor_label => 'system:class_reminder_job',
      p_metadata => jsonb_build_object('error', sqlerrm)
    );
  end;
end;
$function$;

-- 0084 private.send_class_reminder
CREATE OR REPLACE FUNCTION private.send_class_reminder(p_member_id uuid, p_class_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_dispatch_id uuid;
  v_user_id uuid;
  v_gym_id uuid;
  v_language text;
  v_class_name text;
  v_title text;
  v_body text;
  v_token record;
  v_request_id bigint;
  v_delivery_count integer := 0;
begin
  select m.user_id, cb.gym_id, cl.name,
         case when lower(coalesce(u.preferred_language, 'en')) = 'fr' then 'fr' else 'en' end
  into v_user_id, v_gym_id, v_class_name, v_language
  from members m
  join users u on u.id = m.user_id
  join class_bookings cb on cb.class_session_id = p_class_session_id and cb.member_id = p_member_id
  join class_sessions cs on cs.id = p_class_session_id
  join classes cl on cl.id = cs.class_id
  where m.id = p_member_id;

  if not found then
    raise exception 'member or booking not found: member %, session %', p_member_id, p_class_session_id;
  end if;

  if v_language = 'fr' then
    v_title := 'Rappel de cours';
    v_body := format('Votre cours « %s » commence dans 60 minutes.', v_class_name);
  else
    v_title := 'Class reminder';
    v_body := format('Your class "%s" starts in 60 minutes.', v_class_name);
  end if;

  insert into private.class_reminder_dispatches (class_session_id, member_id, gym_id)
  values (p_class_session_id, p_member_id, v_gym_id)
  on conflict (class_session_id, member_id) do nothing
  returning id into v_dispatch_id;

  -- Another invocation already owns this booking's one reminder. Do not
  -- enqueue even if its outcome was no_tokens or a terminal delivery
  -- failure.
  if v_dispatch_id is null then
    return;
  end if;

  -- Story 6.7: history row, written unconditionally on this branch.
  insert into public.notifications (member_id, gym_id, type, title, body)
  values (p_member_id, v_gym_id, 'N-07', v_title, v_body);

  -- Each token's enqueue is wrapped in its own BEGIN...EXCEPTION block so a
  -- net.http_post/insert failure on one device cannot roll back the dispatch
  -- row or another device's already-queued delivery in this same loop.
  for v_token in
    select expo_push_token
    from device_push_tokens
    where user_id = v_user_id
    order by id
  loop
    begin
      v_request_id := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := jsonb_build_object(
          'to', v_token.expo_push_token,
          'title', v_title,
          'body', v_body,
          'sound', 'default',
          'data', jsonb_build_object(
            'notificationCode', 'N-07',
            'classSessionId', p_class_session_id::text,
            'gymId', v_gym_id::text
          )
        ),
        headers := jsonb_build_object('Content-Type', 'application/json')
      );

      insert into private.class_reminder_deliveries (
        dispatch_id,
        expo_push_token,
        push_request_id
      ) values (
        v_dispatch_id,
        v_token.expo_push_token,
        v_request_id
      );

      v_delivery_count := v_delivery_count + 1;
    exception when others then
      raise warning 'send_class_reminder: delivery enqueue failed for token %: %', v_token.expo_push_token, sqlerrm;
    end;
  end loop;

  update private.class_reminder_dispatches
  set status = case when v_delivery_count = 0 then 'no_tokens' else 'queued' end,
      updated_at = now()
  where id = v_dispatch_id;
end;
$function$;

-- 0096 public.list_my_classes
drop function public.list_my_classes();
CREATE OR REPLACE FUNCTION public.list_my_classes()
 RETURNS TABLE(class_id uuid, class_name text, capacity integer, schedule_type text, one_off_session_at timestamp with time zone, recurrence_days smallint[], recurrence_time time without time zone, gym_timezone text, class_session_id uuid, scheduled_at timestamp with time zone, booked_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         c.recurrence_days, c.recurrence_time, v_timezone,
         cs.id, cs.scheduled_at,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id)
  from classes c
  left join class_sessions cs
    on cs.class_id = c.id
   and cs.scheduled_at >= v_day_start
  where c.gym_id = v_gym_id
    and c.coach_id = v_coach_id
  order by c.name, c.id, cs.scheduled_at nulls last;
end;
$function$;

revoke execute on function public.list_my_classes() from public, anon;
grant execute on function public.list_my_classes() to authenticated;

alter table public.class_sessions drop column cancelled_at;
alter table public.classes drop constraint classes_cancelled_by_needs_cancelled_at;
alter table public.classes drop column cancelled_by;
alter table public.classes drop column cancelled_at;

revoke execute on function public.update_class(uuid, text, text, uuid, integer, text, timestamp with time zone, smallint[], time without time zone, date) from public, anon;
revoke execute on function public.materialize_class_sessions(uuid, boolean) from public, anon;
revoke execute on function public.book_class_session(uuid) from public, anon;
revoke execute on function public.cancel_class_booking(uuid) from public, anon;
revoke execute on function public.mark_class_attendance(uuid) from public, anon;
revoke execute on function public.list_bookable_class_sessions() from public, anon;
revoke execute on function public.run_class_reminder_job() from public, anon;
revoke execute on function private.send_class_reminder(uuid, uuid) from public, anon;
revoke execute on function private.materialize_sessions_for_class(uuid) from public, anon;

do $verify$
begin
  if to_regprocedure('public.cancel_class(uuid)') is not null
    or to_regprocedure('public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)') is not null
    or to_regprocedure('public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)') is not null
    or to_regclass('public.class_sessions_with_match') is not null
  then
    raise exception '0181 rollback: a 0181 object is still present';
  end if;

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('classes', 'class_sessions') and column_name in ('cancelled_at', 'cancelled_by')) then
    raise exception '0181 rollback: a cancelled column is still present';
  end if;

  if position('cancelled_at' in (select prosrc from pg_proc where oid = 'public.book_class_session(uuid)'::regprocedure)) > 0
    or position('cancelled_at' in (select prosrc from pg_proc where oid = 'private.materialize_sessions_for_class(uuid)'::regprocedure)) > 0
  then
    raise exception '0181 rollback: a restored function still reads cancelled_at';
  end if;
end;
$verify$;
