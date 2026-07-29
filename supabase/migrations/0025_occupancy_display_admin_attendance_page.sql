-- Story 3.6: Occupancy Display & Admin Attendance Page. Adds the first real
-- RLS SELECT policy on attendance_events (every access so far has gone
-- through a SECURITY DEFINER function, which can't ergonomically support
-- the plain filterable/paginated read the dashboard's Attendance page
-- needs) plus the member-facing occupancy-band SECURITY DEFINER function.
-- See the story file's Scope Notes #1/#2 for full design rationale.

-- ============================================================================
-- gym_staff_read_own_attendance_events: staff read RLS policy (AC #2).
-- Mirrors gym_staff_read_own_members' exact shape (0018_member_management.sql,
-- lines 167-172) -- gym-scoped, owner/manager/receptionist only. No `coach`
-- in the role array (unlike gym_staff_read_own_members): EXPERIENCE.md's
-- Role visibility matrix (line 187-193) explicitly excludes Coach from
-- Attendance, matching the Sidebar's existing /attendance nav entry's own
-- role scoping (components/shared/Sidebar.tsx:41).
--
-- Table-level grants already exist (0006_attendance.sql) -- only the RLS
-- policy is missing.
-- ============================================================================
create policy "gym_staff_read_own_attendance_events" on attendance_events
  for select
  using (
    gym_id = private.gym_id()
    and (auth.jwt() ->> 'app_role') = any(array['owner', 'manager', 'receptionist'])
  );

-- ============================================================================
-- member_occupancy_band(): member-facing occupancy band (AC #1). Computes
-- the band entirely server-side -- the raw checked-in count and gym capacity
-- must never reach the member client, in any form, ever (FR-047's own
-- wording) -- so only the band label itself is returned, never the inputs
-- that produced it.
--
-- Band boundaries resolve a genuine FR-047 gap: the FR's table only defines
-- Low/Medium/Busy up to 90% and says the 91%+ "Full" state is admin-only,
-- "never in the member app" -- it does not say what the member app shows at
-- 91%+. Since the member app has only three bands and no fourth state to
-- fall back to, >70% (inclusive of 91-100%) resolves to 'busy' here.
--
-- Returns null (not an error) when the gym hasn't configured a capacity yet
-- (gyms.capacity is nullable, 0002) -- this is an expected, non-error state.
-- ============================================================================
create function member_occupancy_band()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_capacity integer;
  v_checked_in_count integer;
  v_pct numeric;
begin
  if not ((auth.jwt() ->> 'app_role') = 'member') then
    raise exception 'permission denied';
  end if;

  v_gym_id := private.gym_id();
  if v_gym_id is null then
    raise exception 'permission denied';
  end if;

  select capacity into v_capacity from gyms where id = v_gym_id;
  if v_capacity is null or v_capacity <= 0 then
    return null;
  end if;

  select count(*) into v_checked_in_count
  from attendance_events
  where gym_id = v_gym_id and checked_out_at is null;

  v_pct := (v_checked_in_count::numeric / v_capacity) * 100;

  if v_pct < 30 then
    return 'low';
  elsif v_pct <= 70 then
    return 'medium';
  else
    return 'busy';
  end if;
end;
$$;

revoke execute on function member_occupancy_band() from public;
grant execute on function member_occupancy_band() to authenticated;
