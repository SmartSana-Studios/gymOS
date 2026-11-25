-- Story 29.1: class schedule slots foundation (0180). Positive side: schema, the expansion of existing recurring classes (slot sets exact,
-- sessions and bookings byte-identical), the slot-based materializer (set-equal to the pre-migration column-based one, incl. a Sunday slot and
-- daylight-saving gym zones, idempotent), private.apply_class_slots rules, create_class / update_class / materialize_class_sessions on a
-- recurring class, the compatibility trigger for a direct recurring insert, and the deferred presence check passing.
-- The refusals (cap, duplicates, tenancy, seconds, grants, RLS, the presence check failing) are in class_schedule_slots.negative.test.sql.
-- Fixtures: deterministic UUIDs under 00000000-0000-0000-0180-*. Gym A is Africa/Douala (no DST), gym B Europe/Paris, gym C America/New_York.

begin;
select plan(86);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0180-000000000001', 'Slots Test Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0180-0000000000a0', 'Slots Gym A', '00000000-0000-0000-0180-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0180-0000000000b0', 'Slots Gym B', '00000000-0000-0000-0180-000000000001', 'Europe/Paris'),
  ('00000000-0000-0000-0180-0000000000c0', 'Slots Gym C', '00000000-0000-0000-0180-000000000001', 'America/New_York'),
  ('00000000-0000-0000-0180-0000000000d0', 'Slots Gym D', '00000000-0000-0000-0180-000000000001', 'Africa/Douala');

insert into auth.users (id) values
  ('00000000-0000-0000-0180-000000000201'), ('00000000-0000-0000-0180-000000000202'), ('00000000-0000-0000-0180-000000000203'),
  ('00000000-0000-0000-0180-000000000204'), ('00000000-0000-0000-0180-000000000205'), ('00000000-0000-0000-0180-000000000213'), ('00000000-0000-0000-0180-000000000223'), ('00000000-0000-0000-0180-000000000233');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0180-000000000301', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000201', 'owner', 'Slots A Owner'),
  ('00000000-0000-0000-0180-000000000302', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000202', 'manager', 'Slots A Manager'),
  ('00000000-0000-0000-0180-000000000303', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000203', 'coach', 'Slots A Coach'),
  ('00000000-0000-0000-0180-000000000304', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000204', 'member', 'Slots A Member One'),
  ('00000000-0000-0000-0180-000000000305', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000205', 'member', 'Slots A Member Two'),
  ('00000000-0000-0000-0180-000000000313', '00000000-0000-0000-0180-0000000000b0', '00000000-0000-0000-0180-000000000213', 'coach', 'Slots B Coach'),
  ('00000000-0000-0000-0180-000000000323', '00000000-0000-0000-0180-0000000000c0', '00000000-0000-0000-0180-000000000223', 'coach', 'Slots C Coach'),
  ('00000000-0000-0000-0180-000000000333', '00000000-0000-0000-0180-0000000000d0', '00000000-0000-0000-0180-000000000233', 'coach', 'Slots D Coach');

-- The pre-migration generator, computed inline from recurrence_days / recurrence_time (0057, verbatim formula).
create function pg_temp.old_set(p_class uuid) returns table (scheduled_at timestamptz) language sql as $$
  select (d::date + c.recurrence_time) at time zone g.timezone
  from classes c
  join gyms g on g.id = c.gym_id
  cross join generate_series(current_date, current_date + interval '4 weeks', interval '1 day') d
  where c.id = p_class
    and d::date >= c.recurrence_start_date
    and extract(dow from d::date)::smallint = any(c.recurrence_days)
$$;

-- ============================================================================
-- Schema (Story 29.1 AC 1)
-- ============================================================================
select has_table('public', 'class_schedule_slots', 'class_schedule_slots exists');
select columns_are('public', 'class_schedule_slots', array['id', 'class_id', 'gym_id', 'weekday', 'start_time', 'created_at'], 'class_schedule_slots has exactly the specified columns');
select col_type_is('public', 'class_schedule_slots', 'weekday', 'smallint', 'weekday is smallint');
select col_type_is('public', 'class_schedule_slots', 'start_time', 'time without time zone', 'start_time is time');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.class_schedule_slots'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (class_id, weekday, start_time)'),
  1, 'a unique constraint on (class_id, weekday, start_time)');
select ok(exists (select 1 from pg_indexes where tablename = 'class_schedule_slots' and indexdef like '%(gym_id)%'), 'an index on gym_id');
select is(
  (select count(*)::int from information_schema.columns where table_name in ('classes', 'class_sessions', 'class_bookings')
     and table_schema = 'public' and column_name in ('slot_id', 'class_schedule_slot_id')),
  0, 'no slot reference column was added to classes, class_sessions or class_bookings (the cancelled_at columns of 0181 are covered by class_slot_editor.test.sql)');
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'classes' and column_name in ('recurrence_days', 'recurrence_time', 'recurrence_start_date')),
  3, 'recurrence_days, recurrence_time and recurrence_start_date stay on classes');

-- ============================================================================
-- Fixtures for the expansion proof: recurring classes written by a legacy writer (days and time on the row; the compatibility trigger
-- derives the slots), their sessions materialized, bookings placed.
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0180-000000000401', '00000000-0000-0000-0180-0000000000a0', 'Daily', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{0,1,2,3,4,5,6}', '07:00', current_date),
  ('00000000-0000-0000-0180-000000000402', '00000000-0000-0000-0180-0000000000a0', 'Tue Thu', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{2,4}', '18:00', current_date),
  ('00000000-0000-0000-0180-000000000403', '00000000-0000-0000-0180-0000000000a0', 'Sunday only', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{0}', '09:30', current_date),
  ('00000000-0000-0000-0180-000000000404', '00000000-0000-0000-0180-0000000000a0', 'Past start', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{1,3,5}', '18:15', current_date - 60),
  ('00000000-0000-0000-0180-000000000405', '00000000-0000-0000-0180-0000000000a0', 'Booked and attended', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{1,3}', '12:00', current_date - 30),
  ('00000000-0000-0000-0180-000000000411', '00000000-0000-0000-0180-0000000000b0', 'Paris', '00000000-0000-0000-0180-000000000313', 10, 'recurring', '{0,2}', '02:30', current_date),
  ('00000000-0000-0000-0180-000000000421', '00000000-0000-0000-0180-0000000000c0', 'New York', '00000000-0000-0000-0180-000000000323', 10, 'recurring', '{6,0}', '02:30', current_date);
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0180-000000000406', '00000000-0000-0000-0180-0000000000a0', 'One off', '00000000-0000-0000-0180-000000000303', 10, 'one_off', now() + interval '3 days');

select private.materialize_sessions_for_class(id) from classes where id::text like '00000000-0000-0000-0180-0000000004%';

-- A booked future session, and a past session with an attended booking, on class 405.
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0180-0000000000a0', id, '00000000-0000-0000-0180-000000000304'
from class_sessions where class_id = '00000000-0000-0000-0180-000000000405' and scheduled_at > now() order by scheduled_at limit 1;
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0180-000000000501', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000405', now() - interval '2 days');
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000501', '00000000-0000-0000-0180-000000000304', now() - interval '2 days');

-- ============================================================================
-- Compatibility trigger: a direct recurring insert gets its slots, a one-off gets none.
-- ============================================================================
select is(
  (select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000401'),
  7, 'a daily class inserted directly gets seven slots from the compatibility trigger');
select is(
  (select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000406'),
  0, 'a one-off class gets no slot');

-- ============================================================================
-- Expansion (the migration's own statement, re-run): slot sets exact, sessions and bookings byte-identical, idempotent.
-- ============================================================================
create temp table before_snap as
select
  (select count(*) from class_sessions) as sessions_n,
  (select md5(string_agg(id::text || '|' || class_id::text || '|' || scheduled_at::text, ',' order by id)) from class_sessions) as sessions_md5,
  (select count(*) from class_bookings) as bookings_n,
  (select md5(string_agg(id::text || '|' || class_session_id::text || '|' || member_id::text || '|' || coalesce(attended_at::text, ''), ',' order by id)) from class_bookings) as bookings_md5;

delete from class_schedule_slots;

create function pg_temp.expand() returns void language sql as $$
  insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
  select c.id, c.gym_id, d.day, c.recurrence_time
  from classes c
  cross join lateral unnest(c.recurrence_days) as d(day)
  where c.schedule_type = 'recurring'
    and c.recurrence_time is not null
  on conflict (class_id, weekday, start_time) do nothing
$$;
select pg_temp.expand();

select set_eq(
  $$select class_id, weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000401'$$,
  $$select '00000000-0000-0000-0180-000000000401'::uuid, d::smallint, '07:00'::time from generate_series(0, 6) d$$,
  'a daily class expands to one slot per weekday at its time');
select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000402'$$,
  $$values (2::smallint, '18:00'::time), (4::smallint, '18:00'::time)$$,
  'a Tue/Thu class expands to its two slots');
select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000403'$$,
  $$values (0::smallint, '09:30'::time)$$,
  'a Sunday-only class expands to a weekday 0 slot');
select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000404'$$,
  $$values (1::smallint, '18:15'::time), (3::smallint, '18:15'::time), (5::smallint, '18:15'::time)$$,
  'a class with a past start date expands to its slots');
select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000405'$$,
  $$values (1::smallint, '12:00'::time), (3::smallint, '12:00'::time)$$,
  'a class with booked and attended sessions expands to its slots');
select is(
  (select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000406'),
  0, 'the one-off class still has no slot after the expansion');
select is(
  (select count(*)::int from (
     (select c.id, d.day, c.recurrence_time from classes c cross join lateral unnest(c.recurrence_days) d(day) where c.schedule_type = 'recurring'
      except select class_id, weekday, start_time from class_schedule_slots)
     union all
     (select class_id, weekday, start_time from class_schedule_slots
      except select c.id, d.day, c.recurrence_time from classes c cross join lateral unnest(c.recurrence_days) d(day) where c.schedule_type = 'recurring')) x),
  0, 'for every class the slot set equals unnest(recurrence_days) x recurrence_time exactly');

select pg_temp.expand();
select is((select count(*)::int from class_schedule_slots), 7 + 2 + 1 + 3 + 2 + 2 + 2, 'the expansion is idempotent on a re-run (on conflict do nothing)');

select is(
  (select (sessions_n, sessions_md5) from before_snap),
  (select (count(*), md5(string_agg(id::text || '|' || class_id::text || '|' || scheduled_at::text, ',' order by id))) from class_sessions),
  'class_sessions is byte-identical (count and md5 over id, class_id, scheduled_at) before and after the expansion');
select is(
  (select (bookings_n, bookings_md5) from before_snap),
  (select (count(*), md5(string_agg(id::text || '|' || class_session_id::text || '|' || member_id::text || '|' || coalesce(attended_at::text, ''), ',' order by id))) from class_bookings),
  'class_bookings is byte-identical (count and md5 over id, class_session_id, member_id, attended_at) before and after the expansion');

-- ============================================================================
-- Materializer equivalence: the slot-based function generates the same (class_id, scheduled_at) set the column-based one would have.
-- ============================================================================
delete from class_bookings where class_session_id in (select id from class_sessions where class_id = '00000000-0000-0000-0180-000000000405' and scheduled_at > now());
delete from class_sessions where scheduled_at > now() and class_id::text like '00000000-0000-0000-0180-0000000004%' and class_id <> '00000000-0000-0000-0180-000000000406';
select private.materialize_sessions_for_class(id) from classes where schedule_type = 'recurring' and id::text like '00000000-0000-0000-0180-0000000004%';

select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000401' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000401') where scheduled_at > now()$$, 'equivalence: a daily class');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000402' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000402') where scheduled_at > now()$$, 'equivalence: a Tue/Thu class');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000403' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000403') where scheduled_at > now()$$, 'equivalence: a Sunday-only class (weekday 0)');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000404' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000404') where scheduled_at > now()$$, 'equivalence: a class with a past start date');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000405' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000405') where scheduled_at > now()$$, 'equivalence: a class with booked and attended sessions');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000411' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000411') where scheduled_at > now()$$, 'equivalence: a daylight-saving gym zone (Europe/Paris)');
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000421' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000421') where scheduled_at > now()$$, 'equivalence: a daylight-saving gym zone (America/New_York)');
select ok(
  (select count(*) from class_sessions where class_id = '00000000-0000-0000-0180-000000000403' and scheduled_at > now()) between 4 and 5
  and (select bool_and(extract(dow from scheduled_at at time zone 'Africa/Douala') = 0 and (scheduled_at at time zone 'Africa/Douala')::time = '09:30') from class_sessions where class_id = '00000000-0000-0000-0180-000000000403'),
  'the Sunday slot produces Sunday 09:30 sessions in the gym zone, 4 or 5 in the window');

-- Idempotence: the daily job twice, then a manual materialize, insert nothing and log one job_runs row per run.
select run_class_session_materializer_job();
create temp table job_snap as select count(*) as n, md5(string_agg(class_id::text || scheduled_at::text, ',' order by class_id, scheduled_at)) as m from class_sessions;
create temp table job_runs_snap as select count(*) as n from job_runs where job_name = 'class_session_materializer';
select run_class_session_materializer_job();
select is(
  (select (count(*), md5(string_agg(class_id::text || scheduled_at::text, ',' order by class_id, scheduled_at))) from class_sessions),
  (select (n, m) from job_snap), 'running the job twice in a row inserts no session the second time');
select is((select count(*)::int from job_runs where job_name = 'class_session_materializer'), (select n::int + 1 from job_runs_snap), 'each run logs one job_runs row named class_session_materializer');
select is((select status from job_runs where job_name = 'class_session_materializer' order by started_at desc, id desc limit 1), 'success', 'the daily job still records success');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok($$select materialize_class_sessions('00000000-0000-0000-0180-000000000402')$$, 'a manual materialize_class_sessions after the job runs');
reset role;
select is(
  (select (count(*), md5(string_agg(class_id::text || scheduled_at::text, ',' order by class_id, scheduled_at))) from class_sessions),
  (select (n, m) from job_snap), 'a manual materialize after the job inserts nothing');

-- ============================================================================
-- private.apply_class_slots (class 407: Tue/Thu 18:00 in Africa/Douala)
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0180-000000000407', '00000000-0000-0000-0180-0000000000a0', 'Apply', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{2,4}', '18:00', current_date);
select private.materialize_sessions_for_class('00000000-0000-0000-0180-000000000407');

create temp table apply_ids as
select
  (select id from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 4 order by scheduled_at limit 1) as booked_thu,
  (select id from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 2 order by scheduled_at limit 1) as booked_tue;
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0180-0000000000a0'::uuid, booked_thu, '00000000-0000-0000-0180-000000000304'::uuid from apply_ids
union all
select '00000000-0000-0000-0180-0000000000a0'::uuid, booked_tue, '00000000-0000-0000-0180-000000000304'::uuid from apply_ids;
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0180-000000000502', '00000000-0000-0000-0180-0000000000a0', '00000000-0000-0000-0180-000000000407', now() - interval '3 days');

create temp table tue_before as
select id from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 2;

create temp table left_unchanged as
select * from private.apply_class_slots('00000000-0000-0000-0180-000000000407', '[{"weekday":2,"start_time":"18:00"},{"weekday":5,"start_time":"07:30"}]');

select is((select count(*)::int from left_unchanged), 1, 'apply_class_slots returns exactly the one session that matches no slot and has a booking');
select is((select (class_session_id, booked_count) from left_unchanged), (select (booked_thu, 1) from apply_ids), 'the returned row names the booked Thursday session and its booking count');
select is((select scheduled_at from left_unchanged), (select scheduled_at from class_sessions where id = (select booked_thu from apply_ids)), 'the returned scheduled_at is the session''s own');
select ok(exists (select 1 from class_bookings where class_session_id = (select booked_thu from apply_ids)), 'the booked, no-longer-matching session keeps its booking untouched');
select is(
  (select count(*)::int from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 4),
  1, 'every unbooked future Thursday session was deleted; the booked one remains');
select set_eq(
  $$select id from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 2$$,
  $$select id from tue_before$$, 'sessions that still match a slot are kept (same ids), the booked Tuesday one included and not listed');
select ok(
  (select count(*) from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and extract(dow from scheduled_at at time zone 'Africa/Douala') = 5
     and (scheduled_at at time zone 'Africa/Douala')::time = '07:30') between 3 and 5,
  'sessions for the new Friday slot were generated through the shared materializer');
select ok(exists (select 1 from class_sessions where id = '00000000-0000-0000-0180-000000000502'), 'a past session is never touched');
select set_eq($$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000407'$$,
  $$values (2::smallint, '18:00'::time), (5::smallint, '07:30'::time)$$, 'the slot rows were replaced by the new set');

create temp table apply_snap as select md5(string_agg(id::text || scheduled_at::text, ',' order by id)) as m, count(*) as n from class_sessions where class_id = '00000000-0000-0000-0180-000000000407';
create temp table left_again as select * from private.apply_class_slots('00000000-0000-0000-0180-000000000407', '[{"weekday":5,"start_time":"07:30"},{"weekday":2,"start_time":"18:00"}]');
select is((select (count(*), md5(string_agg(id::text || scheduled_at::text, ',' order by id))) from class_sessions where class_id = '00000000-0000-0000-0180-000000000407'),
  (select (n, m) from apply_snap), 'repeating the same edit (slots in another order) changes nothing');
select is((select class_session_id from left_again), (select class_session_id from left_unchanged), 'repeating the edit lists the same left-unchanged session');

select lives_ok(
  $$select * from private.apply_class_slots('00000000-0000-0000-0180-000000000407', '[{"weekday":2,"start_time":"18:00"},{"weekday":2,"start_time":"19:30"},{"weekday":5,"start_time":"07:30"}]')$$,
  'the same weekday at two different times is accepted');
select ok(
  (select count(*) from class_sessions where class_id = '00000000-0000-0000-0180-000000000407' and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 2 and (scheduled_at at time zone 'Africa/Douala')::time = '19:30') between 3 and 5,
  'a second Tuesday time generates its own sessions next to the first');

-- Moving the start date later: earlier future sessions match no slot (apply_class_slots treats the start date as part of the match).
update classes set recurrence_start_date = current_date + 14 where id = '00000000-0000-0000-0180-000000000407';
select * from private.apply_class_slots('00000000-0000-0000-0180-000000000407', '[{"weekday":2,"start_time":"18:00"},{"weekday":5,"start_time":"07:30"}]');
select is(
  (select count(*)::int from class_sessions s where s.class_id = '00000000-0000-0000-0180-000000000407' and s.scheduled_at > now()
     and (s.scheduled_at at time zone 'Africa/Douala')::date < current_date + 14
     and not exists (select 1 from class_bookings b where b.class_session_id = s.id)),
  0, 'unbooked future sessions before a later start date are removed');

-- Daylight saving: a session generated in the next spring-forward gap keeps matching its own slot (instants are compared, not clock times).
-- The date is the next one on which 02:30 does not exist in Paris (it does not round-trip), so this is a gap date in every season: on a
-- fall-back date 02:30 exists and a clock-time comparison would pass too.
create temp table dst as
select d::date as dt, extract(dow from d::date)::smallint as dow
from generate_series(current_date + 1, current_date + 400, interval '1 day') d
where ((d::date + time '02:30') at time zone 'Europe/Paris') at time zone 'Europe/Paris' <> (d::date + time '02:30')
order by d limit 1;
select is((select count(*)::int from dst), 1, 'the daylight-saving fixture found a gap date');
insert into class_sessions (id, gym_id, class_id, scheduled_at)
select '00000000-0000-0000-0180-000000000503', '00000000-0000-0000-0180-0000000000b0', '00000000-0000-0000-0180-000000000411', (dt + time '02:30') at time zone 'Europe/Paris' from dst;
update classes set recurrence_days = array[(select dow from dst)] where id = '00000000-0000-0000-0180-000000000411';
select * from private.apply_class_slots('00000000-0000-0000-0180-000000000411',
  (select jsonb_build_array(jsonb_build_object('weekday', dow, 'start_time', '02:30')) from dst));
select ok(exists (select 1 from class_sessions where id = '00000000-0000-0000-0180-000000000503'),
  'a session generated at a daylight-saving transition keeps matching its slot');

-- ============================================================================
-- Error paths of apply_class_slots
-- ============================================================================
select throws_like($$select * from private.apply_class_slots('00000000-0000-0000-0180-000000000406', '[{"weekday":1,"start_time":"10:00"}]')$$,
  '%is not recurring%', 'apply_class_slots refuses a one-off class');
select throws_like($$select * from private.apply_class_slots('00000000-0000-0000-0180-000000000407', '[]')$$,
  '%at least one weekly time%', 'apply_class_slots refuses an empty slot set');
select throws_like($$select * from private.apply_class_slots('00000000-0000-0000-0180-00000000ffff', '[{"weekday":1,"start_time":"10:00"}]')$$,
  '%not found%', 'apply_class_slots refuses a missing class');
select ok(
  not has_function_privilege('authenticated', 'private.apply_class_slots(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.apply_class_slots(uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.apply_class_slots(uuid, jsonb)', 'EXECUTE'),
  'apply_class_slots is callable by service_role only');

-- ============================================================================
-- create_class / update_class / materialize_class_sessions on a recurring class (as an Owner)
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);

select lives_ok(
  $$select create_class('Slots Create', null, '00000000-0000-0000-0180-000000000303', 8, 'recurring', null, array[1,3,5]::smallint[], '18:00', current_date)$$,
  'create_class creates a recurring class');
reset role;

select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = (select id from classes where lower(name) = 'slots create')$$,
  $$values (1::smallint, '18:00'::time), (3::smallint, '18:00'::time), (5::smallint, '18:00'::time)$$,
  'create_class writes one slot per selected day at the single time');
select is(
  (select (recurrence_days, recurrence_time) from classes where lower(name) = 'slots create'),
  (select (array[1,3,5]::smallint[], '18:00'::time)), 'create_class keeps writing recurrence_days and recurrence_time');
select set_eq(
  $$select scheduled_at from class_sessions where class_id = (select id from classes where lower(name) = 'slots create')$$,
  $$select scheduled_at from pg_temp.old_set((select id from classes where lower(name) = 'slots create'))$$,
  'a class created through create_class generates the same sessions a migrated one does');

-- A booking on a Wednesday session, then update_class changes the days: no "cannot reschedule", the booked session is kept.
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0180-0000000000a0', id, '00000000-0000-0000-0180-000000000304'
from class_sessions where class_id = (select id from classes where lower(name) = 'slots create') and scheduled_at > now()
  and extract(dow from scheduled_at at time zone 'Africa/Douala') = 3 order by scheduled_at limit 1;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class((select id from classes where lower(name) = 'slots create'), 'Slots Create', null, '00000000-0000-0000-0180-000000000303', 8, 'recurring', null, array[1,2]::smallint[], '18:00', current_date)$$,
  'update_class on a recurring class with a booked future session no longer raises "cannot reschedule"');
reset role;

select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = (select id from classes where lower(name) = 'slots create')$$,
  $$values (1::smallint, '18:00'::time), (2::smallint, '18:00'::time)$$, 'update_class replaced the slots with the selected days');
select is(
  (select count(*)::int from class_sessions s where s.class_id = (select id from classes where lower(name) = 'slots create') and s.scheduled_at > now()
     and extract(dow from s.scheduled_at at time zone 'Africa/Douala') = 3),
  1, 'the booked Wednesday session is left, every unbooked one removed');
select ok(exists (select 1 from class_bookings b join class_sessions s on s.id = b.class_session_id
  where s.class_id = (select id from classes where lower(name) = 'slots create') and extract(dow from s.scheduled_at at time zone 'Africa/Douala') = 3), 'its booking is untouched');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok($$select materialize_class_sessions((select id from classes where lower(name) = 'slots create'), true)$$,
  'materialize_class_sessions(id, true) on a recurring class with bookings regenerates instead of raising');
reset role;
select is((select count(*)::int from class_sessions s where s.class_id = (select id from classes where lower(name) = 'slots create') and s.scheduled_at > now()
  and extract(dow from s.scheduled_at at time zone 'Africa/Douala') = 3), 1, 'the regenerate pass left the booked session alone');

-- Time change on a class with no bookings: the sessions move to the new time.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000402', 'Tue Thu', null, '00000000-0000-0000-0180-000000000303', 10, 'recurring', null, array[2,4]::smallint[], '19:00', current_date)$$,
  'update_class changes the single time of a recurring class');
reset role;
select set_eq($$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000402' and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000402') where scheduled_at > now()$$,
  'after a time change the future sessions equal the new time''s set');
select set_eq($$select weekday, start_time from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000402'$$,
  $$values (2::smallint, '19:00'::time), (4::smallint, '19:00'::time)$$, 'and the slots carry the new time');

-- Start date through update_class (the only public path that moves it): later removes the earlier unbooked sessions, earlier brings them back.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000402', 'Tue Thu', null, '00000000-0000-0000-0180-000000000303', 10, 'recurring', null, array[2,4]::smallint[], '19:00', current_date + 14)$$,
  'update_class moves a recurring class''s start date later');
reset role;
select is(
  (select count(*)::int from class_sessions s where s.class_id = '00000000-0000-0000-0180-000000000402' and s.scheduled_at > now()
     and (s.scheduled_at at time zone 'Africa/Douala')::date < current_date + 14
     and not exists (select 1 from class_bookings b where b.class_session_id = s.id)),
  0, 'update_class with a later start date removes the earlier unbooked sessions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000402', 'Tue Thu', null, '00000000-0000-0000-0180-000000000303', 10, 'recurring', null, array[2,4]::smallint[], '19:00', current_date)$$,
  'update_class moves the start date back to today');
reset role;
select ok(
  exists (select 1 from class_sessions s where s.class_id = '00000000-0000-0000-0180-000000000402' and s.scheduled_at > now()
     and (s.scheduled_at at time zone 'Africa/Douala')::date < current_date + 14),
  'update_class with an earlier start date generates the earlier sessions again');

-- One-off to recurring and back, with the deferred presence check forced immediate.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000406', 'One off', null, '00000000-0000-0000-0180-000000000303', 10, 'recurring', null, array[6]::smallint[], '08:00', current_date)$$,
  'update_class turns a one-off class into a recurring one');
reset role;
set constraints all immediate;
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000406'), 1, 'the converted class has its slot');
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000406', 'One off', null, '00000000-0000-0000-0180-000000000303', 10, 'one_off', now() + interval '6 days', null, null, null)$$,
  'update_class turns it back into a one-off class');
reset role;
set constraints all immediate;
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000406'), 0, 'the one-off class has no slot again, and the presence check passes');
set constraints all deferred;

-- One-off reschedule over a booking keeps the 0058 refusal.
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0180-0000000000a0', id, '00000000-0000-0000-0180-000000000304' from class_sessions
where class_id = '00000000-0000-0000-0180-000000000406' and scheduled_at > now() limit 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select throws_like(
  $$select update_class('00000000-0000-0000-0180-000000000406', 'One off', null, '00000000-0000-0000-0180-000000000303', 10, 'one_off', now() + interval '9 days', null, null, null)$$,
  '%cannot reschedule%', 'a one-off class still refuses a reschedule over bookings');
select throws_like($$select materialize_class_sessions('00000000-0000-0000-0180-000000000406', true)$$,
  '%cannot reschedule%', 'materialize_class_sessions(id, true) on a one-off class with bookings still refuses');
reset role;

-- ============================================================================
-- A type change over a booked future session follows the slot rule since 0181 (it no longer raises); only one-off to one-off keeps the 0058 refusal.
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0180-000000000409', '00000000-0000-0000-0180-0000000000a0', 'Rec to one-off', '00000000-0000-0000-0180-000000000303', 10, 'recurring', '{2}', '10:00', current_date);
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0180-000000000410', '00000000-0000-0000-0180-0000000000a0', 'One-off to rec', '00000000-0000-0000-0180-000000000303', 10, 'one_off', now() + interval '4 days');
select private.materialize_sessions_for_class('00000000-0000-0000-0180-000000000409');
select private.materialize_sessions_for_class('00000000-0000-0000-0180-000000000410');
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0180-0000000000a0', (select id from class_sessions where class_id = c.id and scheduled_at > now() order by scheduled_at limit 1), '00000000-0000-0000-0180-000000000304'
from classes c where c.id in ('00000000-0000-0000-0180-000000000409', '00000000-0000-0000-0180-000000000410');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0180-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0180-0000000000a0","app_role":"owner"}', true);
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000409', 'Rec to one-off', null, '00000000-0000-0000-0180-000000000303', 10, 'one_off', now() + interval '9 days', null, null, null)$$,
  'update_class turns a recurring class with a booked future session into a one-off class (0181: the slot rule, no refusal)');
select lives_ok(
  $$select update_class('00000000-0000-0000-0180-000000000410', 'One-off to rec', null, '00000000-0000-0000-0180-000000000303', 10, 'recurring', null, array[3]::smallint[], '10:00', current_date)$$,
  'update_class turns a one-off class with a booked session into a recurring class (0181: the slot rule, no refusal)');
reset role;
select ok(
  exists (select 1 from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = '00000000-0000-0000-0180-000000000409' and s.scheduled_at > now())
  and (select count(*) from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000409') = 0
  and (select schedule_type from classes where id = '00000000-0000-0000-0180-000000000409') = 'one_off',
  'the recurring-to-one-off change kept the booked session and its booking, dropped the slot and set the class type');
select ok(
  exists (select 1 from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = '00000000-0000-0000-0180-000000000410' and s.scheduled_at > now())
  and (select count(*) from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000410') = 1
  and (select schedule_type from classes where id = '00000000-0000-0000-0180-000000000410') = 'recurring',
  'the one-off-to-recurring change kept the booked session and its booking, created the slot and set the class type');

-- ============================================================================
-- Gym time zone changed: the next materializer run uses the new zone and moves no existing session.
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0180-000000000431', '00000000-0000-0000-0180-0000000000d0', 'Zone change', '00000000-0000-0000-0180-000000000333', 10, 'recurring', '{0,1,2,3,4,5,6}', '07:00', current_date);
select private.materialize_sessions_for_class('00000000-0000-0000-0180-000000000431');
create temp table zone_before as select id, scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000431';
update gyms set timezone = 'Asia/Dubai' where id = '00000000-0000-0000-0180-0000000000d0';
select private.materialize_sessions_for_class('00000000-0000-0000-0180-000000000431');
select run_class_session_materializer_job();

select ok((select count(*) from zone_before) > 0, 'the zone-change class had generated future sessions before the change');
select is(
  (select count(*)::int from zone_before z join class_sessions s on s.id = z.id and s.scheduled_at = z.scheduled_at),
  (select count(*)::int from zone_before), 'after the gym time zone changed, every pre-existing session keeps its id and its instant');
select set_eq(
  $$select scheduled_at from class_sessions where class_id = '00000000-0000-0000-0180-000000000431' and id not in (select id from zone_before)$$,
  $$select scheduled_at from pg_temp.old_set('00000000-0000-0000-0180-000000000431') except select scheduled_at from zone_before$$,
  'the newly generated sessions are the instants of the new zone (Asia/Dubai), computed inline');
select ok(
  (select count(*) from class_sessions where class_id = '00000000-0000-0000-0180-000000000431' and id not in (select id from zone_before)) > 0
  and (select bool_and((scheduled_at at time zone 'Asia/Dubai')::time = '07:00') from class_sessions where class_id = '00000000-0000-0000-0180-000000000431' and id not in (select id from zone_before)),
  'there are new sessions and each is 07:00 in the new zone');

-- ============================================================================
-- The deferred presence check: create-then-insert-slots in one transaction passes.
-- ============================================================================
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_start_date) values
  ('00000000-0000-0000-0180-000000000408', '00000000-0000-0000-0180-0000000000a0', 'Slot only', '00000000-0000-0000-0180-000000000303', 10, 'recurring', current_date);
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0180-000000000408'), 0, 'a recurring class inserted without days or time gets no derived slot (how Story 29.2 creates slot-only classes)');
insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
values ('00000000-0000-0000-0180-000000000408', '00000000-0000-0000-0180-0000000000a0', 1, '06:00');
set constraints all immediate;
select pass('create-then-insert-slots in one transaction passes the deferred presence check');
set constraints all deferred;

select * from finish();
rollback;
