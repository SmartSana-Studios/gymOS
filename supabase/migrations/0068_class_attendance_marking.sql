-- Story 12.3: Class Attendance Marking (FR-107). Fills in the one piece of
-- class_bookings Stories 12.1/12.2 explicitly deferred -- 0058's own
-- migration comment names this story as the one adding the attendance
-- status column when it needs it. AD-21 names this exact design (a status
-- column on class_bookings, never a write to attendance_events) and
-- explicitly reuses check_in()'s (0034) member-status rules (expired
-- rejection + front-desk alert), which FR-107 cites via FR-049.

-- ============================================================================
-- attended_at timestamptz, not a `status text` column despite AD-21's
-- literal wording -- the state is strictly binary (attended / not), and a
-- nullable timestamp mirrors this codebase's own established binary-state
-- convention (attendance_events.checked_out_at, front_desk_alerts.
-- dismissed_at) more precisely than a text enum would, while still
-- satisfying AD-21's actual intent (a column on class_bookings, never a
-- write to attendance_events). Recorded as a deliberate, reasoned deviation
-- from AD-21's literal phrasing in docs/decisions.md.
-- ============================================================================
alter table class_bookings add column attended_at timestamptz;

-- ============================================================================
-- Widen gym_staff_read_own_class_bookings to include supervisor. Story 12.2
-- copied this policy's role list verbatim from
-- gym_staff_read_own_attendance_events (0025), which predates the
-- Supervisor role (Epic 9) and was never updated -- a known, already-
-- documented gap (deferred-work.md, "~30 other call sites...
-- grandfathered, not big-bang"). That gap stays out of scope everywhere
-- else, but this story's own AC #1 breaks for Supervisor if left as-is:
-- EXPERIENCE.md's current Role visibility matrix explicitly grants
-- Supervisor "Classes -- view/attendance (AD-18)," the exact feature this
-- story builds. Fixed only here, not gym_staff_read_own_attendance_events
-- or any other pre-Supervisor policy -- those remain the accepted, tracked
-- gap.
-- ============================================================================
drop policy "gym_staff_read_own_class_bookings" on class_bookings;

create policy "gym_staff_read_own_class_bookings" on class_bookings
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'supervisor'])
  );

-- ============================================================================
-- mark_class_attendance(): follows check_in()'s (0034) and
-- book_class_session()'s (0058) established role-check -> resolve -> guard
-- -> act shape. No RLS write policy is added for attended_at -- class_bookings
-- already has zero UPDATE policies for authenticated (Story 12.2), which is
-- what blocks direct writes; this function's SECURITY DEFINER privilege is
-- what performs the write.
-- ============================================================================
create function mark_class_attendance(p_booking_id uuid)
returns class_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_booking_id uuid;
  v_member_id uuid;
  v_status subscription_status;
  v_expiry_date date;
  v_row class_bookings;
begin
  -- Include supervisor here too, for the same reason as the RLS widening
  -- above (this is new code; match the current UX matrix, don't perpetuate
  -- the pre-Supervisor gap into it). Explicitly excludes coach, matching
  -- the Attendance/Classes-attendance role matrix row.
  if not ((auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist', 'supervisor'])) then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'mark_class_attendance: permission denied';
  end if;

  -- Gym-scoped booking lookup. Uniform not-found failure covers a
  -- nonexistent id and a cross-gym id identically, matching
  -- cancel_class_booking()'s collapsed not-found convention.
  select cb.id, cb.member_id into v_booking_id, v_member_id
  from class_bookings cb
  where cb.id = p_booking_id and cb.gym_id = v_gym_id;

  if v_booking_id is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
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
    on conflict (member_id, status) where dismissed_at is null do nothing;
    return null;
  end if;

  -- No row lock needed (unlike book_class_session()'s capacity race) --
  -- this is a single-row, non-contended write. Review fix: the booking
  -- could still be deleted (cancel_class_booking()) between the existence
  -- check above and this update -- without the not-found recheck, a 0-row
  -- update leaves v_row an all-null composite, indistinguishable from the
  -- expired-member rejection shape once it crosses the PostgREST/JSON
  -- boundary, misleading the caller into showing a "member expired" toast
  -- for what was actually a just-cancelled booking.
  update class_bookings set attended_at = now() where id = v_booking_id
  returning * into v_row;

  if v_row is null then
    raise exception 'mark_class_attendance: booking % not found', p_booking_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function mark_class_attendance(uuid) from public;
grant execute on function mark_class_attendance(uuid) to authenticated;
