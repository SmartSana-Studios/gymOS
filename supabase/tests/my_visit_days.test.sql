-- Story 30.5 (FR-224, FR-225, NFR-027, NFR-028): public.my_visit_days(date) and public.my_first_visit_day() (migration 0187).
--
-- Proves: the shape (one date argument / none, STABLE, SECURITY DEFINER, a pinned search_path, EXECUTE for authenticated only, the return
-- columns), neither a support capability, neither reading attendance_events nor doing timezone arithmetic; the month filter (first and last day,
-- the neighbouring months, distinct days when a day has two check-ins, ordered, `milestone` NULL on every row); that class-only attendance and a
-- voided check-in light nothing while a staff check-in and a visit that synced late light their own day; that history from before the release
-- counts (the epoch is NULL for this whole file); a 23:30 visit keeps its day across a gyms.timezone change; that a member reads only their own
-- days, in their own gym; the refused months (not the first of a month, NULL, after the gym's current month) with the stable error code and
-- a month with no visit returning no row; and my_first_visit_day() as the lower bound of the previous-month chevron.
--
-- The caller matrix (staff roles, support, anon, deactivated, suspended, another gym) lives in my_visit_days.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0040-00000000nnnn. Gym 1 (A) and gym 2 (B), both active, users 2xxx, members 3xxx.

begin;
select plan(45);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0040-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- One statement run as a database role, returning its first value or sqlstate:message.
create function pg_temp.asrole(r text, stmt text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', r);
  begin
    execute stmt into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;
-- The days of one month as a comma list, run as an authenticated member.
create function pg_temp.days(p_month date) returns text language plpgsql as $f$
declare v text;
begin
  set local role authenticated;
  begin
    select coalesce(string_agg(visit_day::text, ',' order by visit_day), '') into v from public.my_visit_days(p_month);
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'MVD Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'MVD Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'MVD Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'mvd-' || n || '@x.example', now() from generate_series(1, 30) n;
-- 1 owner A (enters the staff check-in), 5 coach A (the class), 7 member A (the subject), 8 member A (a neighbour with their own days),
-- 9 member A with no visit at all, 10 member A with only a voided check-in and a class, 20 member of gym B.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(s.n), pg_temp.id(1, s.gym), pg_temp.id(2, s.n), s.role::member_role, 'MVD ' || s.n, date '2026-01-05'
from (values (1, 1, 'owner'), (5, 1, 'coach'), (7, 1, 'member'), (8, 1, 'member'), (9, 1, 'member'), (10, 1, 'member'), (20, 2, 'member')) s(n, gym, role);

create function pg_temp.visit(p_n int, p_day date, p_extra text default '') returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '10:30') at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;

-- Member 7: before the month, both ends of March, a day with two check-ins, the first of April, and the neighbour's day not theirs.
select pg_temp.visit(7, date '2026-02-28');
select pg_temp.visit(7, date '2026-03-01');
select pg_temp.visit(7, date '2026-03-10');
select pg_temp.visit(7, date '2026-03-10');   -- a second check-in the same day
select pg_temp.visit(7, date '2026-03-31');
select pg_temp.visit(7, date '2026-04-01');
-- A staff-entered check-in lights its day like a scan.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, source, entered_by)
values (pg_temp.id(1, 1), pg_temp.m(7), timestamptz '2026-03-22 09:00+01', timestamptz '2026-03-22 09:30+01', 'manual', date '2026-03-22', 'staff', pg_temp.id(2, 1));
-- A visit that synced late (created long after the day it belongs to) lights its own past day.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, created_at, client_scan_id)
values (pg_temp.id(1, 1), pg_temp.m(7), timestamptz '2026-03-25 18:00+01', timestamptz '2026-03-25 18:40+01', 'manual', date '2026-03-25', timestamptz '2026-04-02 08:00+01', pg_temp.id(5, 1));
-- A voided check-in (member 7, 20 March) and a class that member 7 attended on a day with no check-in (15 March): neither lights a day.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, voided_at, voided_by, void_reason)
values (pg_temp.id(1, 1), pg_temp.m(7), timestamptz '2026-03-20 10:00+01', timestamptz '2026-03-20 10:30+01', 'void', date '2026-03-20', now(), pg_temp.id(2, 1), 'entered by mistake');
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
values (pg_temp.id(6, 1), pg_temp.id(1, 1), 'MVD Class', pg_temp.m(5), 10, 'one_off', timestamptz '2026-03-15 17:00+01');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values (pg_temp.id(7, 1), pg_temp.id(1, 1), pg_temp.id(6, 1), timestamptz '2026-03-15 17:00+01');
insert into class_bookings (id, gym_id, class_session_id, member_id, attended_at) values
  (pg_temp.id(8, 1), pg_temp.id(1, 1), pg_temp.id(7, 1), pg_temp.m(7), timestamptz '2026-03-15 17:05+01'),
  (pg_temp.id(8, 2), pg_temp.id(1, 1), pg_temp.id(7, 1), pg_temp.m(10), timestamptz '2026-03-15 17:05+01');
-- Member 10: only a voided check-in and a class. Member 8 and member 20 have days of their own on days member 7 does not.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, voided_at, voided_by, void_reason)
values (pg_temp.id(1, 1), pg_temp.m(10), timestamptz '2026-03-04 10:00+01', timestamptz '2026-03-04 10:30+01', 'void', date '2026-03-04', now(), pg_temp.id(2, 1), 'entered by mistake');
select pg_temp.visit(8, date '2026-03-05');
select pg_temp.visit(8, date '2026-03-06');
select pg_temp.visit(20, date '2026-03-07');
select pg_temp.visit(20, date '2026-03-10');

-- ============================================================================
-- Shape, grants, no support capability, no raw attendance read
-- ============================================================================
select is((select pronargs::int from pg_proc where oid = 'public.my_visit_days(date)'::regprocedure), 1, 'my_visit_days takes one argument (the month; no member id to forge)');
select is((select pronargs::int from pg_proc where oid = 'public.my_first_visit_day()'::regprocedure), 0, 'my_first_visit_day takes no argument');
select is((select provolatile::text from pg_proc where oid = 'public.my_visit_days(date)'::regprocedure), 's', 'my_visit_days is STABLE');
select is((select provolatile::text from pg_proc where oid = 'public.my_first_visit_day()'::regprocedure), 's', 'my_first_visit_day is STABLE');
select is((select prosecdef from pg_proc where oid = 'public.my_visit_days(date)'::regprocedure), true, 'my_visit_days is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.my_first_visit_day()'::regprocedure), true, 'my_first_visit_day is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.my_visit_days(date)'::regprocedure), array['search_path=public'], 'my_visit_days pins its search_path');
select is((select proconfig from pg_proc where oid = 'public.my_first_visit_day()'::regprocedure), array['search_path=public'], 'my_first_visit_day pins its search_path');
select is((select pg_get_function_result('public.my_visit_days(date)'::regprocedure)), 'TABLE(visit_day date, milestone smallint)', 'my_visit_days returns (visit_day date, milestone smallint)');
select is((select pg_get_function_result('public.my_first_visit_day()'::regprocedure)), 'date', 'my_first_visit_day returns a date');
select is(
  (select count(*)::int from unnest(array['public.my_visit_days(date)', 'public.my_first_visit_day()']) f, unnest(array['anon', 'service_role', 'public']) r
   where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'neither is executable by anon, service_role or PUBLIC');
select is(
  (select count(*)::int from unnest(array['public.my_visit_days(date)', 'public.my_first_visit_day()']) f where has_function_privilege('authenticated', to_regprocedure(f), 'execute')),
  2, 'both are executable by authenticated');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'visit_day'), 0, 'neither is a support capability');
select is(
  (select count(*)::int from pg_proc p where p.oid in ('public.my_visit_days(date)'::regprocedure, 'public.my_first_visit_day()'::regprocedure)
     and (p.prosrc ~* 'attendance_events' or p.prosrc ~* 'at time zone' or p.prosrc !~ 'member_visit_days')),
  0, 'both read member_visit_days, never attendance_events, and do no timezone arithmetic');

-- ============================================================================
-- The month filter
-- ============================================================================
select pg_temp.claims(7, 1, 'member');
select is(pg_temp.days(date '2026-03-01'), '2026-03-01,2026-03-10,2026-03-22,2026-03-25,2026-03-31',
          'March: both ends, the staff check-in and the late sync; one row for the day with two check-ins; ordered');
select is(pg_temp.days(date '2026-04-01'), '2026-04-01', 'April holds only the first of April (the end of March is not in it)');
select is(pg_temp.days(date '2026-02-01'), '2026-02-28', 'February holds only the 28th (the 1st of March is not in it)');
select is((select count(*)::int from public.my_visit_days(date '2026-03-01')), 5, 'the row count is the summary figure (5 visit days)');
select is((select count(*)::int from public.my_visit_days(date '2026-03-01') where milestone is not null), 0, 'milestone is NULL on every row');
select is(pg_temp.days(date '2026-01-01'), '', 'a past month with no visit returns no row and no error');
select is(pg_temp.days(date '2020-01-01'), '', 'a month long before the first visit returns no row and no error');
select is(pg_temp.days(date '2026-03-01') like '%2026-03-15%' or pg_temp.days(date '2026-03-01') like '%2026-03-20%', false, 'a class-only day (15 March) and a voided check-in (20 March) are not lit');
select is(pg_temp.days(date '2026-03-01') like '%2026-03-22%', true, 'a staff check-in lights its own day (22 March)');
select is(pg_temp.days(date '2026-03-01') like '%2026-03-25%', true, 'a visit synced a week later lights its own past day (25 March)');
select is(pg_temp.days(date '2026-03-01') like '%2026-03-05%' or pg_temp.days(date '2026-03-01') like '%2026-03-06%' or pg_temp.days(date '2026-03-01') like '%2026-03-07%', false, 'another member''s days (same gym or another gym) never appear');

-- ============================================================================
-- Pre-release history: the epoch is NULL for this whole file and the history still counts
-- ============================================================================
select is((select release_week_start from platform_engagement_config), null, 'the release epoch is NULL (dark)');
select is(pg_temp.days(date '2026-03-01') <> '', true, 'and the March days of a member are still returned (history counts as stored)');
select is(pg_temp.asrole('authenticated', 'select my_first_visit_day()::text'), '2026-02-28', 'my_first_visit_day is the earliest counted day (28 February)');

-- ============================================================================
-- A member reads only their own days
-- ============================================================================
select pg_temp.claims(8, 1, 'member');
select is(pg_temp.days(date '2026-03-01'), '2026-03-05,2026-03-06', 'a neighbour in the same gym sees only their own two days');
select is(pg_temp.asrole('authenticated', 'select my_first_visit_day()::text'), '2026-03-05', 'and their own first day');
select pg_temp.claims(20, 2, 'member');
select is(pg_temp.days(date '2026-03-01'), '2026-03-07,2026-03-10', 'a member of gym B sees only gym B days, including their own 10 March');
select pg_temp.claims(9, 1, 'member');
select is(pg_temp.days(date '2026-03-01'), '', 'a member with no visit gets no row');
select is(pg_temp.asrole('authenticated', 'select coalesce(my_first_visit_day()::text, ''none'')'), 'none', 'and my_first_visit_day is NULL for them');
select pg_temp.claims(10, 1, 'member');
select is(pg_temp.days(date '2026-03-01'), '', 'a member whose only records are a voided check-in and a class gets no row');
select is(pg_temp.asrole('authenticated', 'select coalesce(my_first_visit_day()::text, ''none'')'), 'none', 'and no first visit day');

-- ============================================================================
-- Refused months: a stable code, only after the caller is known to be a live member
-- ============================================================================
select pg_temp.claims(7, 1, 'member');
select is(pg_temp.days(date '2026-03-15'), '22023:invalid_month', 'a month that is not the first of a month is refused (22023 invalid_month)');
select is(pg_temp.days(null), '22023:invalid_month', 'a NULL month is refused');
select is(pg_temp.days((date_trunc('month', private.gym_today(pg_temp.id(1, 1))) + interval '1 month')::date), '22023:invalid_month', 'the month after the gym''s current month is refused');
select is(pg_temp.days((date_trunc('month', private.gym_today(pg_temp.id(1, 1))) + interval '5 years')::date), '22023:invalid_month', 'a month years ahead is refused');
select lives_ok(format('select * from public.my_visit_days(%L)', date_trunc('month', private.gym_today(pg_temp.id(1, 1)))::date), 'the gym''s current month is accepted');
select is(pg_temp.days((date_trunc('month', private.gym_today(pg_temp.id(1, 1))) - interval '1 month')::date) like '22023:%', false, 'and so is the month before it (not refused)');

-- ============================================================================
-- A 23:30 visit keeps its day across a gyms.timezone change (NFR-028)
-- ============================================================================
select pg_temp.claims(8, 1, 'member');
reset role;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type)
values (pg_temp.id(1, 1), pg_temp.m(8), timestamptz '2026-03-12 23:30+01', timestamptz '2026-03-12 23:50+01', 'manual');
select is((select visit_day from attendance_events where member_id = pg_temp.m(8) and checked_in_at = timestamptz '2026-03-12 23:30+01'), date '2026-03-12', 'the 23:30 visit is stored on its gym-local day');
select is(pg_temp.days(date '2026-03-01'), '2026-03-05,2026-03-06,2026-03-12', 'and the calendar shows it on 12 March');
update gyms set timezone = 'Pacific/Kiritimati' where id = pg_temp.id(1, 1);
select is(pg_temp.days(date '2026-03-01'), '2026-03-05,2026-03-06,2026-03-12', 'after the Owner moves the gym to UTC+14 the same three days are lit');
update gyms set timezone = 'Pacific/Pago_Pago' where id = pg_temp.id(1, 1);
select is(pg_temp.days(date '2026-03-01'), '2026-03-05,2026-03-06,2026-03-12', 'and after a move to UTC-11 they are still the same');

select * from finish();
rollback;
