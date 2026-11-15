-- Rollback for migration 0173: protected attendance counting.
--   psql -v ON_ERROR_STOP=1 --single-transaction -f scripts/rollback-0173-attendance-counting.sql
-- Data effects: visit_day and voided_at are dropped with their values (visit_day is derivable again from checked_in_at and the gym's
-- zone; voided_at is always null until Story 27.3 ships, so a rollback BEFORE 27.3 loses nothing). Do NOT run this after 27.3 has
-- voided a visit: the voided rows would silently count again.
-- Aborts if any attendance_events row has voided_at set (Story 27.3 onward): dropping the column would silently count those visits again.
-- Void-free data is the only state this rollback is safe for.
do $guard$
begin
  if exists (select 1 from public.attendance_events where voided_at is not null) then
    raise exception 'rollback-0173: attendance_events has voided rows; dropping voided_at would count them again';
  end if;
end;
$guard$;

set local lock_timeout = '5s';

-- The 0056 occupancy body (counts from the base table) and its grants.
create or replace function private.gym_occupancy_band(p_gym_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_checked_in_count integer;
  v_pct numeric;
begin
  select capacity into v_capacity from gyms where id = p_gym_id;
  if v_capacity is null or v_capacity <= 0 then
    return null;
  end if;

  select count(*) into v_checked_in_count
  from attendance_events
  where gym_id = p_gym_id and checked_out_at is null;

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

revoke execute on function private.gym_occupancy_band(uuid) from public;
grant execute on function private.gym_occupancy_band(uuid) to service_role;

-- The 0124 policy bodies.
alter policy "gym_staff_read_own_attendance_events" on public.attendance_events
  using (((gym_id = (select private.gym_id())) AND (((select private.current_member_role())::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text]))));

alter policy "member_read_own_attendance_events" on public.attendance_events
  using (((gym_id = (select private.gym_id())) AND (((select private.current_member_role())::text) = 'member'::text) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = attendance_events.member_id) AND (m.user_id = auth.uid()))))));

drop view if exists public.member_visit_days;
drop view if exists public.attendance_counted;

drop trigger if exists attendance_events_visit_day_immutable on public.attendance_events;
drop trigger if exists attendance_events_visit_day_insert on public.attendance_events;
drop function if exists private.attendance_events_visit_day_guard();

drop index if exists public.idx_attendance_events_member_visit_day;
drop index if exists public.idx_attendance_events_gym_visit_day;

alter table public.attendance_events
  drop column if exists voided_at,
  drop column if exists visit_day;

drop function if exists private.gym_local_date(uuid, timestamptz);
