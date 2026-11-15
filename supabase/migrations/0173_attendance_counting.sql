-- ============================================================================
-- 0173: Protected attendance counting (Epic 27, Story 27.1; AD-56, AD-53, NFR-028).
--
-- Attendance was counted straight off attendance_events, so a visit voided later (27.3) would still be counted by any query that
-- forgot a filter, and the Attendance page's "today" used the UTC day (a Douala check-in between 00:00 and 01:00 local landed on
-- yesterday). Epics 28, 30 and 31 need ONE protected, timezone-stable place to count from. This migration adds:
--
--   * attendance_events.visit_day  (date, NOT NULL after the backfill) -- the gym-local calendar day of checked_in_at, written once at
--     insert and never recomputed (NFR-028): a later timezone change never moves a past day.
--   * attendance_events.voided_at  (timestamptz, nullable, no default) -- the ONLY void column here. Nothing writes it until 27.3.
--   * private.gym_local_date(gym, timestamptz) -- the single definition of a gym-local date; its fallback is private.gym_today's
--     (0157): an unknown gym, an empty or an unresolvable zone means UTC.
--   * BEFORE INSERT trigger: sets visit_day from the row's own checked_in_at when the insert does not supply one (an offline scan keeps
--     the day it was recorded on, not the day it synced). BEFORE UPDATE trigger: raises when visit_day changes.
--   * views attendance_counted and member_visit_days (security_invoker, explicit column lists, voided rows excluded, SELECT to
--     authenticated only).
--   * the two base-table SELECT policies (as last rewritten in 0124) hide voided rows; tenant_active_gate is untouched.
--   * private.gym_occupancy_band (0056; member_occupancy_band() only delegates to it) counts from attendance_counted. Signature, grants
--     and result are unchanged.
--   * partial indexes (gym_id, visit_day) and (member_id, visit_day) where voided_at is null.
--
-- BACKFILL CHOICE. The project keeps no history of gym timezone changes, so the gym's CURRENT gyms.timezone is the best available reading
-- of every past row. The default zone (Africa/Douala) has no daylight saving, so for a gym that never changed zone the result is exact.
-- docs/decisions.md records this.
--
-- check_in(), check_out*, the auto-timeout job, the one-open index and the 0111 write revokes are NOT touched here (27.2 owns them);
-- they stay base-table readers and are listed in the reader allowlist (scripts/attendance-readers.baseline.json and
-- supabase/tests/attendance_counting.test.sql).
--
-- Rollback: scripts/rollback-0173-attendance-counting.sql.
-- ============================================================================
set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- The one gym-local-date definition. Same body shape and fallback as private.gym_today (0157), applied to a given instant.
-- ----------------------------------------------------------------------------
create function private.gym_local_date(p_gym_id uuid, p_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select g.timezone into v_tz from gyms g where g.id = p_gym_id;
  return (p_at at time zone coalesce(nullif(btrim(v_tz), ''), 'UTC'))::date;
exception when others then
  return (p_at at time zone 'UTC')::date;
end;
$$;

revoke execute on function private.gym_local_date(uuid, timestamptz) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Columns, backfill (one statement), NOT NULL.
-- ----------------------------------------------------------------------------
alter table public.attendance_events
  add column visit_day date,
  add column voided_at timestamptz;

update public.attendance_events
set visit_day = private.gym_local_date(gym_id, checked_in_at);

alter table public.attendance_events alter column visit_day set not null;

-- ----------------------------------------------------------------------------
-- Triggers: written once. Created after the backfill so the backfill itself is not blocked by the immutability trigger.
-- SECURITY DEFINER so the insert-time lookup does not depend on the inserting role's privileges on private.gym_local_date.
-- ----------------------------------------------------------------------------
create function private.attendance_events_visit_day_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.visit_day is null then
      new.visit_day := private.gym_local_date(new.gym_id, new.checked_in_at);
    end if;
  elsif new.visit_day is distinct from old.visit_day then
    raise exception 'visit_day is written once at insert and cannot be changed';
  end if;
  return new;
end;
$$;

revoke execute on function private.attendance_events_visit_day_guard() from public, anon, authenticated;

create trigger attendance_events_visit_day_insert
  before insert on public.attendance_events
  for each row execute function private.attendance_events_visit_day_guard();

create trigger attendance_events_visit_day_immutable
  before update on public.attendance_events
  for each row when (old.visit_day is distinct from new.visit_day)
  execute function private.attendance_events_visit_day_guard();

-- ----------------------------------------------------------------------------
-- Indexes for the counting views. Partial on voided_at is null, which is every row the views return.
-- ----------------------------------------------------------------------------
create index idx_attendance_events_gym_visit_day
  on public.attendance_events (gym_id, visit_day) where voided_at is null;
create index idx_attendance_events_member_visit_day
  on public.attendance_events (member_id, visit_day) where voided_at is null;

-- ----------------------------------------------------------------------------
-- Views. security_invoker: the caller's own RLS on attendance_events applies, including the RESTRICTIVE tenant_active_gate.
-- Explicit column list, never select *, never a void column: a later column cannot leak through the view.
-- ----------------------------------------------------------------------------
create view public.attendance_counted with (security_invoker = true) as
select
  ae.id,
  ae.gym_id,
  ae.member_id,
  ae.checked_in_at,
  ae.checked_out_at,
  ae.checkout_type,
  ae.visit_day,
  ae.created_at,
  ae.client_scan_id
from public.attendance_events ae
where ae.voided_at is null;

create view public.member_visit_days with (security_invoker = true) as
select distinct
  ac.member_id,
  ac.gym_id,
  ac.visit_day
from public.attendance_counted ac;

revoke all on public.attendance_counted from public, anon, authenticated, service_role;
revoke all on public.member_visit_days from public, anon, authenticated, service_role;
grant select on public.attendance_counted to authenticated;
grant select on public.member_visit_days to authenticated;

-- ----------------------------------------------------------------------------
-- Base-table SELECT policies (0124 bodies) hide voided rows. tenant_active_gate and the live-role helpers are unchanged.
-- ----------------------------------------------------------------------------
alter policy "gym_staff_read_own_attendance_events" on public.attendance_events
  using (((gym_id = (select private.gym_id())) AND (((select private.current_member_role())::text) = ANY (ARRAY['owner'::text, 'manager'::text, 'supervisor'::text, 'receptionist'::text])) AND (voided_at is null)));

alter policy "member_read_own_attendance_events" on public.attendance_events
  using (((gym_id = (select private.gym_id())) AND (((select private.current_member_role())::text) = 'member'::text) AND (voided_at is null) AND (EXISTS ( SELECT 1
   FROM members m
  WHERE ((m.id = attendance_events.member_id) AND (m.user_id = auth.uid()))))));

-- ----------------------------------------------------------------------------
-- private.gym_occupancy_band (0056): the checked-in count reads attendance_counted. Everything else is the 0056 body.
-- create or replace keeps the owner, the ACL and the settings; the grants are restated for the reader.
-- ----------------------------------------------------------------------------
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
  from attendance_counted
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

revoke execute on function private.gym_occupancy_band(uuid) from public, anon;
grant execute on function private.gym_occupancy_band(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Verify.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if exists (select 1 from public.attendance_events where visit_day is null) then
    raise exception '0173: a row was left without visit_day';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance_events' and column_name = 'visit_day' and is_nullable = 'NO'
  ) then
    raise exception '0173: visit_day must be NOT NULL';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance_events' and column_name = 'voided_at' and is_nullable = 'YES'
  ) then
    raise exception '0173: voided_at must exist and be nullable';
  end if;
  if (select count(*) from pg_class c
      where c.oid in ('public.attendance_counted'::regclass, 'public.member_visit_days'::regclass)
        and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'::text[]))) <> 2 then
    raise exception '0173: both views must be security_invoker';
  end if;
  if has_table_privilege('anon', 'public.attendance_counted', 'SELECT') or has_table_privilege('anon', 'public.member_visit_days', 'SELECT')
     or not has_table_privilege('authenticated', 'public.attendance_counted', 'SELECT')
     or not has_table_privilege('authenticated', 'public.member_visit_days', 'SELECT') then
    raise exception '0173: the views must be readable by authenticated and not by anon';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in ('private.gym_local_date(uuid, timestamptz)'::regprocedure,
                    'private.attendance_events_visit_day_guard()'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception '0173: the new private functions must not be executable by anon or authenticated';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'attendance_events'
        and policyname in ('gym_staff_read_own_attendance_events', 'member_read_own_attendance_events')
        and qual like '%voided_at IS NULL%') <> 2 then
    raise exception '0173: both SELECT policies must hide voided rows';
  end if;
  if position('attendance_counted' in pg_get_functiondef('private.gym_occupancy_band(uuid)'::regprocedure)) = 0 then
    raise exception '0173: gym_occupancy_band must count from attendance_counted';
  end if;
end
$verify$;
