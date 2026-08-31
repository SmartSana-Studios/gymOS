-- Story 12.4: Member App Classes Surfaces (FR-105/FR-106/FR-108/FR-123).
-- Stories 12.1-12.3 built the entire class/booking/attendance data model
-- and dashboard-side admin UI, deferring all member-facing UI to this
-- story. Member-role RLS on classes/class_sessions/class_bookings/members
-- was designed for the dashboard's staff-side needs, not this story's
-- browse/capacity-count/coach-name needs -- these two new SECURITY DEFINER
-- RPCs close exactly that gap, mirroring private.gym_occupancy_band()'s
-- (0056) established aggregate-not-raw-rows pattern rather than widening
-- either existing restrictive policy:
--   (a) capacity aggregate -- member_read_own_class_bookings (0058) only
--       ever returns the caller's own row(s), so a client-side count(*)
--       would undercount every session's true booked total.
--   (b) coach name -- member_read_gym_staff_members (0038) deliberately
--       excludes role = 'coach' from a member's read access to `members`.
-- No RLS policy changes in this migration -- both functions are SECURITY
-- DEFINER and deliberately bypass those restrictions only for their own
-- narrow, already-scoped-to-caller projections.

-- ============================================================================
-- list_bookable_class_sessions(): member-only SECURITY DEFINER RPC. Follows
-- book_class_session()'s (0058) exact role-check -> resolve-gym ->
-- resolve-member shape, member-resolution block copied verbatim including
-- the deactivated_at nulls first tie-break and the deactivated-member
-- guard. `scheduled_at > now()` mirrors book_class_session()'s own
-- `cs.scheduled_at <= now()` rejection guard exactly -- a session that
-- becomes unbookable naturally drops off this list, no separate filter
-- logic to keep in sync.
-- ============================================================================
create function list_bookable_class_sessions()
returns table (
  class_session_id uuid,
  class_name text,
  description text,
  coach_name text,
  scheduled_at timestamptz,
  capacity integer,
  booked_count bigint,
  my_booking_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
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
$$;
revoke execute on function list_bookable_class_sessions() from public;
grant execute on function list_bookable_class_sessions() to authenticated;

-- ============================================================================
-- list_my_class_bookings(): same member-only role-check/resolve shape,
-- returns the caller's own upcoming bookings with `can_cancel` computed
-- server-side (identical cutoff formula to cancel_class_booking()'s own
-- `now() >= v_scheduled_at - make_interval(mins => v_cutoff_minutes)`, just
-- inverted and returned instead of raised) -- avoids the client needing its
-- own read access to gyms.class_booking_cancellation_cutoff_minutes or
-- duplicating cutoff-window math. `cb.gym_id = v_gym_id` is redundant with
-- `cb.member_id = v_member_id` in practice -- a member row belongs to
-- exactly one gym -- but matches this codebase's established explicit-
-- gym-scoping-as-defense-in-depth convention (Story 12.3's own Task 2
-- precedent).
-- ============================================================================
create function list_my_class_bookings()
returns table (
  booking_id uuid,
  class_name text,
  scheduled_at timestamptz,
  can_cancel boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_deactivated_at timestamptz;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
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
$$;
revoke execute on function list_my_class_bookings() from public;
grant execute on function list_my_class_bookings() to authenticated;
