-- Story 17.4: the Coach Portal's My Classes page (AD-21, FR-145) -- the
-- classes a Coach teaches, their sessions with booked counts, and who is
-- booked into each session.
--
-- WHAT THIS CLOSES. Every class already has exactly one owning coach
-- (classes.coach_id NOT NULL, trigger-validated, 0057:23,140-165), and that
-- coach had no way to see it. Plain reads cannot build the page:
--   * `classes` and `class_sessions` ARE readable by a Coach -- their only
--     SELECT policies are `gym_id = private.gym_id()` with no role check
--     (0057:101,172) -- but
--   * `class_bookings` is NOT: gym_staff_read_own_class_bookings is
--     owner/manager/receptionist/supervisor only (0068:37-42). Under a coach
--     session a count(*) returns 0 rows, silently, so every booked count
--     would read "0/15" and every roster "no one booked"; and
--   * the NAMES of booked members are not readable either: a Coach's
--     `members` access is coach_read_assigned_members (0040:81-87), assigned
--     members only, and most people booked into a class are not the Coach's
--     coaching clients.
--
-- TWO SECURITY DEFINER READS, NOT AN RLS WIDENING. This migration creates,
-- alters and drops no policy. A row-level widening of `members` would have
-- handed the Coach every readable column of every booked member, phone
-- number included. These functions bypass RLS for exactly two projections:
--   * list_my_classes()                  -- the Coach's classes, their
--     sessions and booked COUNTS; no member identity at all.
--   * list_my_class_session_roster(uuid) -- exactly (member_id, member_name,
--     attended_at) for one session of one of the Coach's own classes.
-- The epic first specified one function; the product owner approved the
-- second on 2026-09-10 because the booked count was otherwise unreachable
-- (epics.md Story 17.4 amendment note). Story 17.5's My Next Sessions reuses
-- list_my_classes().
--
-- THE CALLER IS RESOLVED FROM A LIVE `members` ROW, NEVER FROM THE JWT. Rows
-- come back only when the caller has a gym_id claim AND an active
-- (deactivated_at is null) members row in that gym whose role is 'coach'.
-- `auth.jwt() ->> 'app_role'` is not read anywhere here: AD-3 forbids new
-- call sites, and a claim lags a demotion or deactivation by up to the
-- JWT's one-hour expiry. FR-089 requires deactivation to revoke access
-- immediately, and a demoted coach's classes still point at their members
-- row -- classes_validate_coach() only fires when coach_id itself changes --
-- so only the live role check closes that. idx_members_active_gym_user
-- (0003:39) guarantees at most one active row per (gym, user), which is why
-- the non-strict `select ... into` is safe.
--
-- UNAUTHORIZED CALLERS GET AN EMPTY SET, NOT AN EXCEPTION. No gym claim, a
-- non-coach, a deactivated coach, another coach's class or session, another
-- gym's session, a nonexistent id and (for the roster) a session from before
-- today all return zero rows. One uniform
-- outcome leaks nothing, not even whether a session id exists, and a staff
-- member who opens /coach/classes by URL simply sees the empty state.
-- (A non-uuid argument is rejected by Postgres before the body runs; that
-- is reachable only by tampering and surfaces as a mapped error.)
--
-- THE SUSPENSION GUARD, IN READ-ONLY FUNCTIONS. tenant_active_gate does
-- nothing inside a SECURITY DEFINER function (0090:9-19), and AD-3 binds
-- every DEFINER function that gates on role, which both of these do. So both
-- carry 0090's fail-closed guard -- `is distinct from 'active'`, never `<>`
-- -- and its load-bearing `is not active` message. It sits BELOW caller
-- resolution, so a non-coach at a suspended gym learns nothing about the
-- gym's status (0090:76-80). This is a deliberate departure from the three
-- older read-only DEFINER functions (0078's list_bookable_class_sessions()
-- and list_my_class_bookings(), and get_workout_plan_viewer_context()),
-- which carry none. Being read-only, neither function is a guarded writer
-- nor an exclusion-list entry in suspension_rpc_coverage.test.sql, and that
-- file needs no change. Deliberately, neither function body contains a
-- comment: that meta-test scans prosrc, and prose there can be misread as a
-- write or as dynamic SQL.
--
-- SESSIONS FROM 00:00 TODAY, GYM-LOCAL -- NOT STRICTLY UPCOMING. attended_at
-- is only ever set once a session has started (mark_class_attendance(),
-- 0068:121), so a strictly-upcoming list would hide the class a Coach is
-- teaching right now together with its attendance. Decided with the product
-- owner, 2026-09-10. There is no upper bound: the materializer keeps
-- recurring classes four weeks ahead (0057:224-248).
--
-- THE START OF TODAY IS COMPUTED INLINE, NOT BY 0097's HELPER. Migrations
-- apply in filename order (and `supabase db reset` in CI does too), so this
-- file runs BEFORE 0097 creates private.gym_local_day_bounds(); calling it
-- would be a forward dependency. The inline expression is 0097's day_start
-- with p_at := now() and p_timezone := g.timezone. The DST trap 0095 and 0097
-- document is an interval added after the `at time zone` round trip, and
-- there is no interval arithmetic here at all
-- (coach_portal_my_classes.test.sql pins both facts).
--
-- A CLASS WITH NO SESSION IN THE WINDOW STILL RETURNS ONE ROW (left join),
-- with a null session and booked_count 0. A Coach who teaches only a
-- finished one-off class or a far-future recurring class is therefore never
-- told "You are not assigned to any classes yet". booked_count counts EVERY
-- booking on the session -- cancellation is a row DELETE (0058:22-31), so
-- count(*) is the true total, the same definition as book_class_session()'s
-- capacity check (0058:193) and the member app (0078:68). gym_timezone is
-- repeated on every row so the page formats times in the gym's zone with no
-- extra read.
--
-- THE ROSTER USES THE SAME WINDOW: sessions from 00:00 today, gym-local. A
-- manager can move a class to another coach (update_class sets
-- classes.coach_id), and session ids are readable by every gym user, so an
-- unbounded roster would hand a newly assigned coach the names and attendance
-- of every past session they never taught. The page lists nothing older, so
-- the bound costs a Coach nothing they can see (decided with the product owner
-- in Story 17.4's code review, 2026-09-10). Deactivated BOOKED members are
-- included -- deactivation does not cancel a booking, and the admin roster
-- (services/classes.ts listSessionBookings) shows them too.
--
-- `max_rows = 1000` (supabase/config.toml:18) also caps a set-returning RPC
-- response, silently. list_my_classes() returns one row per (class, session
-- in window). The materializer creates one session per matching day over four
-- weeks (0057:236-248), so a daily class contributes about 29 rows and a
-- three-times-weekly class about 12: a Coach would need roughly 35 daily
-- classes, or 80 thrice-weekly ones, to reach it. Accepted and recorded in
-- deferred-work.md.

create function list_my_classes()
returns table (
  class_id uuid,
  class_name text,
  capacity integer,
  schedule_type text,
  one_off_session_at timestamptz,
  recurrence_days smallint[],
  recurrence_time time,
  gym_timezone text,
  class_session_id uuid,
  scheduled_at timestamptz,
  booked_count bigint
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
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default -- revoked
-- explicitly, per 0040:51-52's discipline for DEFINER functions.
revoke execute on function list_my_classes() from public;
grant execute on function list_my_classes() to authenticated;

create function list_my_class_session_roster(p_class_session_id uuid)
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

revoke execute on function list_my_class_session_roster(uuid) from public;
grant execute on function list_my_class_session_roster(uuid) to authenticated;

do $verify$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_my_classes' and p.pronargs = 0
  ) then
    raise exception '0096: list_my_classes() was not created';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_my_class_session_roster' and p.pronargs = 1
  ) then
    raise exception '0096: list_my_class_session_roster(uuid) was not created';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.list_my_classes()'::regprocedure,
                    'public.list_my_class_session_roster(uuid)'::regprocedure)
      and (
        p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) then
    raise exception '0096: EXECUTE on list_my_classes() and list_my_class_session_roster() must not be granted to PUBLIC';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.list_my_classes()'::regprocedure,
                    'public.list_my_class_session_roster(uuid)'::regprocedure)
      and not p.prosecdef
  ) then
    raise exception '0096: both functions must be SECURITY DEFINER -- a Coach has no RLS read on class_bookings, nor on the names of members they are not assigned to';
  end if;

  if exists (
    select 1 from pg_proc p
    where p.oid in ('public.list_my_classes()'::regprocedure,
                    'public.list_my_class_session_roster(uuid)'::regprocedure)
      and p.prosrc !~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
  ) then
    raise exception '0096: both functions must carry the fail-closed suspension guard (is distinct from ''active'', 0090)';
  end if;
end;
$verify$;
