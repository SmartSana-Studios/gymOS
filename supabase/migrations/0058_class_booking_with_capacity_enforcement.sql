-- Story 12.2: Class Booking with Capacity Enforcement (FR-105, FR-106).
-- First *booking* story in Epic 12 -- Story 12.1 built pure schedule
-- metadata (classes/class_sessions) with explicitly zero capacity/booking
-- concept. `class_bookings` is the table ARCHITECTURE-SPINE.md's ERD
-- already names (MEMBERS ||--o{ CLASS_BOOKINGS, CLASS_SESSIONS ||--o{
-- CLASS_BOOKINGS) and AD-21 already names the RPC for (book_class_session()
-- -- a row-locked check-then-insert RPC, same shape as check_in() (0034)).
-- cancel_class_booking() and the cancellation-cutoff column are this
-- story's own new design surface, unnamed by the architecture.

-- ============================================================================
-- gyms.class_booking_cancellation_cutoff_minutes: mirrors
-- alert_auto_dismiss_minutes' (0002) exact gym-configurable-integer-column
-- shape. Minutes over hours (unlike checkin_timeout_hours) since
-- alert_auto_dismiss_minutes already establishes minutes as a valid unit in
-- this same table, and a 2-hour default expressed in minutes needs no
-- unit-conversion at read time.
-- ============================================================================
alter table gyms add column class_booking_cancellation_cutoff_minutes integer not null default 120
  check (class_booking_cancellation_cutoff_minutes >= 0);

-- ============================================================================
-- class_bookings: a member's reservation for a class_session. No `status`
-- column -- cancellation is a row DELETE, not a status transition. Story
-- 12.3 ("class attendance... is a status column on class_bookings", AD-21)
-- will ALTER TABLE to add that column when it needs it; pre-adding it now
-- with no AC asking for it would be exactly the kind of anticipatory column
-- Story 12.1 explicitly avoided on class_sessions for the same reason.
-- gym_id is denormalized here, matching class_sessions' own
-- denormalized-gym_id convention from Story 12.1.
-- ============================================================================
create table class_bookings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  class_session_id uuid not null references class_sessions(id),
  member_id uuid not null references members(id),
  created_at timestamptz not null default now()
);

-- Prevents a member double-booking the same session; also doubles as the
-- concurrent-request backstop for the duplicate-booking pre-check inside
-- book_class_session() below (same dual-role pattern
-- idx_attendance_events_one_open_per_member plays for check_in()).
create unique index idx_class_bookings_session_member on class_bookings(class_session_id, member_id);

-- RLS enabled in this same migration, no open-table window. Full grant --
-- RLS having zero INSERT/UPDATE/DELETE policies for authenticated is what
-- actually blocks direct writes (matches class_sessions' established
-- convention); all writes go through the two SECURITY DEFINER RPCs below.
alter table class_bookings enable row level security;

grant select, insert, update, delete on class_bookings to authenticated, service_role;

-- ============================================================================
-- class_bookings RLS -- two SELECT policies, OR'd together (matching gyms'
-- and attendance_events' two-SELECT-policy precedent). No INSERT/UPDATE/
-- DELETE policy for authenticated at all.
-- ============================================================================

-- Copies member_read_own_attendance_events' (0026) exact ownership-proof
-- shape (members.user_id = auth.uid()), not a raw member_id = auth.uid()
-- comparison -- class_bookings.member_id references members.id, a
-- different UUID from the auth user id.
create policy "member_read_own_class_bookings" on class_bookings
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = 'member'
    and exists (
      select 1 from members m
      where m.id = class_bookings.member_id and m.user_id = auth.uid()
    )
  );

-- Story spec review fix: the story's own text called this "ungated by
-- role," but a same-gym `using` clause with no role filter is OR'd
-- together with member_read_own_class_bookings above for every SELECT --
-- an ungated policy here would also match `member`-role sessions and grant
-- them blanket gym-wide read access to every other member's bookings,
-- silently defeating the member-only-own-bookings policy entirely (caught
-- by this migration's own pgTAP negative-test coverage). Gated to
-- owner/manager/receptionist instead, copying
-- gym_staff_read_own_attendance_events' (0025) exact role set and its own
-- documented reasoning for excluding coach (EXPERIENCE.md's Role
-- visibility matrix excludes Coach from Attendance; class_bookings is the
-- same category of admin-visibility data). Needed now, not deferred to
-- Story 12.3, because Task 2 makes the Classes admin page's booking-count
-- column (Story 12.1) read real data from this table.
create policy "gym_staff_read_own_class_bookings" on class_bookings
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- ============================================================================
-- book_class_session(): follows check_in()'s (0034) established shape and
-- ordering exactly -- role-check, resolve gym, resolve member, guard,
-- (subscription-eligibility guard here in place of check_in()'s), lock,
-- act.
-- ============================================================================
create function book_class_session(p_class_session_id uuid)
returns class_bookings
language plpgsql
security definer
set search_path = public
as $$
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
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'book_class_session: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'book_class_session: caller is not a member';
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
$$;

revoke execute on function book_class_session(uuid) from public;
grant execute on function book_class_session(uuid) to authenticated;

-- ============================================================================
-- cancel_class_booking(): resolves v_gym_id/v_member_id via its own copy of
-- book_class_session()'s member-resolution steps (not a shared helper --
-- matches this codebase's established per-function-copy discipline over
-- premature RPC-body sharing).
-- ============================================================================
create function cancel_class_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
  v_found_id uuid;
  v_scheduled_at timestamptz;
  v_cutoff_minutes integer;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'cancel_class_booking: caller is not a member';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'cancel_class_booking: caller is not a member';
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
$$;

revoke execute on function cancel_class_booking(uuid) from public;
grant execute on function cancel_class_booking(uuid) to authenticated;

-- ============================================================================
-- Review fix: materialize_class_sessions()/update_class() (0057) both delete
-- a class's not-yet-occurred sessions on reschedule
-- (`delete from class_sessions where class_id = ... and scheduled_at >
-- now()`). class_bookings.class_session_id references class_sessions(id)
-- with no ON DELETE clause (default RESTRICT), so as soon as any future
-- session has a booking, that delete now raises an unhandled foreign-key-
-- violation error instead of the friendly, uniform-deny-all-failure style
-- every other guard in this schema uses. Both functions are redefined here
-- (create or replace, 0057 already committed) to check for existing
-- bookings on the sessions about to be deleted and raise a friendly
-- exception instead -- reschedule is blocked outright when bookings exist;
-- resolving those bookings is left to the admin, out of band, for now (no
-- cascade-cancel of a member's booking without their own action).
-- ============================================================================
create or replace function materialize_class_sessions(p_class_id uuid, p_reschedule boolean default false)
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
$$;

revoke execute on function materialize_class_sessions(uuid, boolean) from public;
grant execute on function materialize_class_sessions(uuid, boolean) to authenticated;

create or replace function update_class(
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
$$;

revoke execute on function update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date) from public;
grant execute on function update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date) to authenticated;
