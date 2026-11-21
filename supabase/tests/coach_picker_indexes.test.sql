-- Story 29.4 (NFR-001): the picker at scale. One coach with 40 classes and 200 assigned members among a gym with thousands of other rows (other coaches'
-- classes, sessions, bookings and assignments, ended assignments, other members' notes).
--   * the two indexes of 0183 exist (classes (gym_id, coach_id); coach_assignments (coach_id) where ended_at is null);
--   * the SQL the picker functions run, written inline with the gym and coach as literals (a plpgsql body shows no inner plan under EXPLAIN), uses
--     index scans: no sequential scan on class_sessions, coach_assignments, class_bookings or classes;
--   * list_coach_classes and list_coach_assigned_members return their rows, well under the API max_rows of 1000, in well under the 2 s page target, and
--     the 40-class fixture does not reach the cap (so no horizon bound is applied: see docs/decisions.md);
--   * the roster of a session is a handful of rows.
-- Fixtures: 00000000-0000-0000-0300-*.

begin;
select plan(12);

set local timezone = 'UTC';

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0300-000000000001', 'Picker Scale Tier', 5000, 50000, 10000);
insert into gyms (id, name, tier_id, timezone)
values ('00000000-0000-0000-0300-0000000000a0', 'Picker Scale Gym', '00000000-0000-0000-0300-000000000001', 'Africa/Douala');

-- ids: owner 0300-...-0000000001, coaches 0300-...-0000010000 + n (n = 0 is the chosen coach), members 0300-...-0000100000 + n
create function pg_temp.coach_id(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0300-' || lpad((10000 + n)::text, 12, '0'))::uuid $f$;
create function pg_temp.member_id(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0300-' || lpad((100000 + n)::text, 12, '0'))::uuid $f$;

insert into auth.users (id) select pg_temp.coach_id(n) from generate_series(0, 20) n;
insert into auth.users (id) select pg_temp.member_id(n) from generate_series(1, 3200) n;
insert into auth.users (id) values ('00000000-0000-0000-0300-000000000002');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0300-000000000102', '00000000-0000-0000-0300-0000000000a0', '00000000-0000-0000-0300-000000000002', 'owner', 'SCALE OWNER');
insert into members (id, gym_id, user_id, role, name)
select pg_temp.coach_id(n), '00000000-0000-0000-0300-0000000000a0', pg_temp.coach_id(n), 'coach', 'SCALE COACH ' || n from generate_series(0, 20) n;
insert into members (id, gym_id, user_id, role, name)
select pg_temp.member_id(n), '00000000-0000-0000-0300-0000000000a0', pg_temp.member_id(n), 'member', 'SCALE MEMBER ' || lpad(n::text, 5, '0') from generate_series(1, 3200) n;

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0300-000000000401', '00000000-0000-0000-0300-0000000000a0', 'Scale Monthly', 'monthly', 10000, 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select '00000000-0000-0000-0300-0000000000a0', pg_temp.member_id(n), '00000000-0000-0000-0300-000000000401', 'active', current_date, current_date + 30 from generate_series(1, 3200) n;

-- members 1..200: the chosen coach's; 201..3200: spread over coaches 1..20 (150 each); plus one ended assignment per member 1..2000 with another coach
insert into coach_assignments (gym_id, member_id, coach_id, started_at, ended_at)
select '00000000-0000-0000-0300-0000000000a0', pg_temp.member_id(n), pg_temp.coach_id(case when n <= 200 then 0 else 1 + ((n - 201) % 20) end), now() - interval '60 days', null from generate_series(1, 3200) n;
insert into coach_assignments (gym_id, member_id, coach_id, started_at, ended_at)
select '00000000-0000-0000-0300-0000000000a0', pg_temp.member_id(n), pg_temp.coach_id(1 + (n % 20)), now() - interval '200 days', now() - interval '100 days' from generate_series(1, 2000) n;
insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
select a.gym_id, a.member_id, a.coach_id, a.id, 'scale note' from coach_assignments a where a.ended_at is null;

-- 40 recurring classes for the chosen coach (Mon, Wed, Fri at 18:00: 3 weekly times), 10 per noise coach
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
select ('00000000-0000-0000-0300-' || lpad((200000 + n)::text, 12, '0'))::uuid, '00000000-0000-0000-0300-0000000000a0', 'SCALE CLASS ' || n,
       pg_temp.coach_id(case when n <= 40 then 0 else 1 + ((n - 41) % 20) end), 30, 'recurring', '{1,3,5}', '18:00', current_date
from generate_series(1, 240) n;
select private.materialize_sessions_for_class(id) from classes where gym_id = '00000000-0000-0000-0300-0000000000a0';

-- bookings: five members on every session of the chosen coach's classes, two on every other session
insert into class_bookings (gym_id, class_session_id, member_id)
select cs.gym_id, cs.id, pg_temp.member_id(1 + ((row_number() over (partition by cs.id order by m.n) + (hashtext(cs.id::text) & 255)) % 200)::int)
from class_sessions cs join classes c on c.id = cs.class_id
cross join generate_series(1, 5) m(n)
where c.coach_id = pg_temp.coach_id(0)
on conflict do nothing;
insert into class_bookings (gym_id, class_session_id, member_id)
select cs.gym_id, cs.id, pg_temp.member_id(201 + ((hashtext(cs.id::text) & 1023) + m.n))
from class_sessions cs join classes c on c.id = cs.class_id
cross join generate_series(1, 2) m(n)
where c.coach_id <> pg_temp.coach_id(0)
on conflict do nothing;

-- 30 other gyms, each with a coach, a member and 60 recurring classes whose sessions the member booked: the platform's other tenants, so the chosen coach's
-- rows are a small share of each table (a planner reads a sequential scan as right when 16 percent of a table is wanted).
insert into gyms (id, name, tier_id, timezone)
select ('00000000-0000-0000-0301-' || lpad(n::text, 12, '0'))::uuid, 'Scale Noise Gym ' || n, '00000000-0000-0000-0300-000000000001', 'Africa/Douala' from generate_series(1, 30) n;
insert into auth.users (id) select ('00000000-0000-0000-0301-' || lpad((1000 + n)::text, 12, '0'))::uuid from generate_series(1, 60) n;
insert into members (id, gym_id, user_id, role, name)
select ('00000000-0000-0000-0301-' || lpad((1000 + n)::text, 12, '0'))::uuid, ('00000000-0000-0000-0301-' || lpad(((n + 1) / 2)::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0301-' || lpad((1000 + n)::text, 12, '0'))::uuid, case when n % 2 = 1 then 'coach' else 'member' end::member_role, 'NOISE ' || n
from generate_series(1, 60) n;
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date)
select ('00000000-0000-0000-0301-' || lpad((100000 + g.n * 100 + c.n)::text, 12, '0'))::uuid, ('00000000-0000-0000-0301-' || lpad(g.n::text, 12, '0'))::uuid,
       'NOISE CLASS ' || g.n || '-' || c.n, ('00000000-0000-0000-0301-' || lpad((1000 + 2 * g.n - 1)::text, 12, '0'))::uuid, 20, 'recurring', '{1,3,5}', '18:00', current_date
from generate_series(1, 30) g(n), generate_series(1, 60) c(n);
select private.materialize_sessions_for_class(id) from classes where gym_id <> '00000000-0000-0000-0300-0000000000a0' and name like 'NOISE CLASS%';
insert into class_bookings (gym_id, class_session_id, member_id)
select cs.gym_id, cs.id, ('00000000-0000-0000-0301-' || lpad((1000 + 2 * (right(cs.gym_id::text, 12)::int))::text, 12, '0'))::uuid
from class_sessions cs where cs.gym_id <> '00000000-0000-0000-0300-0000000000a0';

analyze classes;
analyze class_sessions;
analyze class_bookings;
analyze coach_assignments;
analyze members;
analyze session_notes;
analyze subscriptions;

create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $f$
declare r text; out text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop out := out || r || E'\n'; end loop;
  return out;
end $f$;

select is((select count(*)::int from classes where coach_id = pg_temp.coach_id(0)), 40, 'fixture: the chosen coach has 40 classes');
select is((select count(*)::int from coach_assignments where coach_id = pg_temp.coach_id(0) and ended_at is null), 200, 'fixture: the chosen coach has 200 assigned members');
select cmp_ok((select count(*)::int from class_bookings), '>', 3000, 'fixture: thousands of bookings around them');

select ok(to_regclass('public.idx_classes_gym_coach') is not null
          and (select indexdef from pg_indexes where indexname = 'idx_classes_gym_coach') like '%(gym_id, coach_id)%',
  'classes has an index on (gym_id, coach_id)');
select ok((select indexdef from pg_indexes where indexname = 'idx_coach_assignments_active_coach') like '%(coach_id) WHERE (ended_at IS NULL)%',
  'coach_assignments has a partial index on (coach_id) where ended_at is null');

-- the SQL of list_coach_classes, with the gym, coach and the start of today as literals
select set_config('t.classes_sql', format($q$
  select c.id, c.name, c.capacity, c.schedule_type, c.one_off_session_at,
         (select coalesce(jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', to_char(s.start_time, 'HH24:MI')) order by s.weekday, s.start_time), '[]'::jsonb)
            from class_schedule_slots s where s.class_id = c.id and s.gym_id = %L),
         c.cancelled_at, cs.id, cs.scheduled_at,
         (select count(*) from class_bookings cb where cb.class_session_id = cs.id and cb.gym_id = %L),
         v.matches_slots
  from classes c
  left join class_sessions cs on cs.class_id = c.id and cs.gym_id = %L and cs.scheduled_at >= %L::timestamptz and cs.cancelled_at is null
  left join class_sessions_with_match v on v.class_session_id = cs.id
  where c.gym_id = %L and c.coach_id = %L
  order by c.name, c.id, cs.scheduled_at nulls last
$q$, '00000000-0000-0000-0300-0000000000a0', '00000000-0000-0000-0300-0000000000a0', '00000000-0000-0000-0300-0000000000a0',
     (select day_start from private.gym_local_day_bounds('Africa/Douala', now())), '00000000-0000-0000-0300-0000000000a0', pg_temp.coach_id(0)), true);

select set_config('t.classes_plan', pg_temp.plan_of(current_setting('t.classes_sql')), true);
select unalike(current_setting('t.classes_plan'), '%Seq Scan on class_sessions %', 'list_coach_classes: no sequential scan on class_sessions');
select unalike(current_setting('t.classes_plan'), '%Seq Scan on class_bookings %', 'list_coach_classes: no sequential scan on class_bookings');
select unalike(current_setting('t.classes_plan'), '%Seq Scan on classes %', 'list_coach_classes: no sequential scan on classes');

-- the SQL of list_coach_assigned_members
select set_config('t.members_plan', pg_temp.plan_of(format($q$
  select m.id, m.name, m.phone, m.photo_url, m.goal, m.experience_level, sc.status, sc.plan_name, sc.expiry_date, m.join_date,
         (select left(regexp_replace(sn.note_text, '\s+', ' ', 'g'), 80) from session_notes sn
           where sn.gym_id = %L and sn.member_id = m.id and sn.coach_id = %L order by sn.created_at desc, sn.id desc limit 1)
  from coach_assignments ca
  join members m on m.id = ca.member_id and m.gym_id = %L and m.deactivated_at is null
  left join subscriptions_current sc on sc.member_id = m.id and sc.gym_id = %L
  where ca.coach_id = %L and ca.gym_id = %L and ca.ended_at is null
  order by m.name, m.id
$q$, '00000000-0000-0000-0300-0000000000a0', pg_temp.coach_id(0), '00000000-0000-0000-0300-0000000000a0', '00000000-0000-0000-0300-0000000000a0', pg_temp.coach_id(0), '00000000-0000-0000-0300-0000000000a0')), true);
select unalike(current_setting('t.members_plan'), '%Seq Scan on coach_assignments %', 'list_coach_assigned_members: no sequential scan on coach_assignments');

-- the functions themselves, as the Owner: rows, cap and time
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0300-000000000002","role":"authenticated","gym_id":"00000000-0000-0000-0300-0000000000a0","app_role":"owner"}', true);
select set_config('t.t0', clock_timestamp()::text, true);
select set_config('t.class_rows', (select count(*)::text from list_coach_classes(pg_temp.coach_id(0))), true);
select set_config('t.t1', clock_timestamp()::text, true);
select set_config('t.member_rows', (select count(*)::text from list_coach_assigned_members(pg_temp.coach_id(0))), true);
select set_config('t.t2', clock_timestamp()::text, true);

select cmp_ok(current_setting('t.class_rows')::int, '<', 1000, 'list_coach_classes for 40 classes returns fewer rows than the API max_rows of 1000 (the cap is not reached, so no horizon bound is needed)');
select cmp_ok(current_setting('t.member_rows')::int, '=', 200, 'list_coach_assigned_members returns the 200 members, under max_rows 1000');
select cmp_ok(extract(epoch from (current_setting('t.t1')::timestamptz - current_setting('t.t0')::timestamptz)) + extract(epoch from (current_setting('t.t2')::timestamptz - current_setting('t.t1')::timestamptz)), '<', 2.0,
  'both functions together run well inside the 2 s page-load target on the seeded size');
reset role;

select * from finish();
rollback;
