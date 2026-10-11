
-- Forward-fix rollback for migration 0112 (class attendance session gate).
-- Restores: mark_class_attendance() as of 0110 (no flag read, no gate, no
-- already-attended guard), the class_bookings table-level INSERT/UPDATE
-- grants as of 0058, and drops session_attempts.class_session_id.
--
-- Aborts if any session_attempts row carries a class_session_id: those are
-- blocked class attempts and must be archived deliberately before the column
-- is dropped. Active session_required alerts are left in place.
--
-- Run with host psql, one transaction:
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0112-class-attendance-session-gate.sql

do $guard$
begin
  if exists (select 1 from session_attempts where class_session_id is not null) then
    raise exception 'rollback-0112: session_attempts has class attempts; archive them before dropping the column';
  end if;
end;
$guard$;

create or replace function public.mark_class_attendance(p_booking_id uuid)
 RETURNS class_bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Story 11.8: suspension gate. `is distinct from`, never `<>` -- see migration header.
  if private.current_gym_status() is distinct from 'active' then
    raise exception 'mark_class_attendance: gym % is not active', v_gym_id;
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
    on conflict (member_id, kind, status) where dismissed_at is null do nothing;
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
$function$;

revoke execute on function public.mark_class_attendance(uuid) from public, anon;

-- class_bookings grants back to 0058 (table-level INSERT/UPDATE).
revoke insert (id, gym_id, class_session_id, member_id, created_at) on class_bookings from authenticated, service_role;
revoke update (gym_id, class_session_id, member_id, created_at) on class_bookings from authenticated, service_role;
grant insert, update on class_bookings to authenticated, service_role;

drop index if exists idx_session_attempts_class_session_id;
alter table session_attempts drop column class_session_id;

do $verify$
begin
  if not has_column_privilege('service_role', 'public.class_bookings', 'attended_at', 'UPDATE') then
    raise exception 'rollback-0112: class_bookings.attended_at UPDATE grant not restored';
  end if;
  if position('consume_guest_session' in (
    select prosrc from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure
  )) > 0 then
    raise exception 'rollback-0112: mark_class_attendance() still gated';
  end if;
end;
$verify$;
