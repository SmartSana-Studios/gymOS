-- Story 29.2: the per-day slot editor (0181). Positive side: schema, the p_slots overloads of create_class and update_class (per-day times,
-- left_unchanged, idempotency, 14 then 15, type switches, the stable refusals), the old signatures, the audit rows, the matches_slots view and
-- list_my_classes. Cancel is class_cancel.test.sql, the refusals per role are class_cancel.negative.test.sql, and the real two-connection races
-- are scripts/class-slot-race.sh.
-- Fixtures: 00000000-0000-0000-0292-*. Gym A is Africa/Douala (no DST), gym B Europe/Paris.

begin;
select plan(129);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0292-000000000001', 'Editor Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0292-0000000000a0', 'Editor Gym A', '00000000-0000-0000-0292-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0292-0000000000b0', 'Editor Gym B', '00000000-0000-0000-0292-000000000001', 'Europe/Paris');

insert into auth.users (id) values
  ('00000000-0000-0000-0292-000000000201'), ('00000000-0000-0000-0292-000000000202'), ('00000000-0000-0000-0292-000000000203'),
  ('00000000-0000-0000-0292-000000000204'), ('00000000-0000-0000-0292-000000000205'), ('00000000-0000-0000-0292-000000000206'),
  ('00000000-0000-0000-0292-000000000207'), ('00000000-0000-0000-0292-000000000211'), ('00000000-0000-0000-0292-000000000213');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0292-000000000301', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000201', 'owner', 'Editor A Owner'),
  ('00000000-0000-0000-0292-000000000302', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000202', 'manager', 'Editor A Manager'),
  ('00000000-0000-0000-0292-000000000303', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000203', 'coach', 'Editor A Coach'),
  ('00000000-0000-0000-0292-000000000304', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000204', 'member', 'Editor A Member One'),
  ('00000000-0000-0000-0292-000000000305', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000205', 'member', 'Editor A Member Two'),
  ('00000000-0000-0000-0292-000000000306', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000206', 'receptionist', 'Editor A Receptionist'),
  ('00000000-0000-0000-0292-000000000307', '00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000207', 'supervisor', 'Editor A Supervisor'),
  ('00000000-0000-0000-0292-000000000311', '00000000-0000-0000-0292-0000000000b0', '00000000-0000-0000-0292-000000000211', 'owner', 'Editor B Owner'),
  ('00000000-0000-0000-0292-000000000313', '00000000-0000-0000-0292-0000000000b0', '00000000-0000-0000-0292-000000000213', 'coach', 'Editor B Coach');

create function pg_temp.as_role(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;

create function pg_temp.owner() returns void language sql as $f$
  select pg_temp.as_role('00000000-0000-0000-0292-000000000201', '00000000-0000-0000-0292-0000000000a0', 'owner')
$f$;

create function pg_temp.res() returns jsonb language sql as $f$ select current_setting('test.res')::jsonb $f$;

-- The instants the slots generate (the apply_class_slots rule), computed inline for one class.
create function pg_temp.slot_set(p_class uuid) returns table (scheduled_at timestamptz) language sql as $f$
  select (d::date + s.start_time) at time zone g.timezone
  from classes c
  join gyms g on g.id = c.gym_id
  join class_schedule_slots s on s.class_id = c.id
  cross join generate_series(current_date, current_date + interval '4 weeks', interval '1 day') d
  where c.id = p_class
    and d::date >= c.recurrence_start_date
    and extract(dow from d::date)::smallint = s.weekday
$f$;

create function pg_temp.sessions_md5(p_class uuid) returns text language sql as $f$
  select coalesce(md5(string_agg(id::text || '|' || scheduled_at::text, ',' order by id)), '') from class_sessions where class_id = p_class
$f$;

-- ============================================================================
-- Schema
-- ============================================================================
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'classes' and column_name in ('cancelled_at', 'cancelled_by')),
  2, 'classes gains cancelled_at and cancelled_by');
select is(
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'class_sessions' and column_name = 'cancelled_at'),
  1, 'class_sessions gains cancelled_at');
select ok(
  to_regprocedure('public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date)') is not null
  and to_regprocedure('public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date)') is not null,
  'the old create_class and update_class signatures still exist');
select ok(
  to_regprocedure('public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)') is not null
  and to_regprocedure('public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)') is not null,
  'the p_slots overloads exist');
select is(
  (select array_agg(pronargdefaults order by oid) from pg_proc
    where oid in ('public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
                  'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure)),
  array[0, 0]::smallint[], 'p_slots has no default on either overload (PostgREST resolves by argument names)');
select is(
  (select p.proargnames[array_length(p.proargnames, 1)] from pg_proc p where p.oid = 'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure),
  'p_slots', 'p_slots is the trailing parameter');
select is(
  (select prorettype::regtype::text from pg_proc where oid = 'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure),
  'jsonb', 'the p_slots update_class returns jsonb');
select is(
  (select prorettype::regtype::text from pg_proc where oid = 'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure),
  'void', 'the old update_class still returns void');
select ok(
  not exists (select 1 from pg_proc p where p.oid in (
      'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
      'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date)'::regprocedure)
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))),
  'neither new nor redefined signature is executable by anon or public');
select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.class_sessions_with_match'::regclass),
  'class_sessions_with_match is a security_invoker view');
select ok(
  not exists (select 1 from private.support_capabilities where object_name in ('cancel_class', 'class_sessions_with_match')),
  'cancel_class is not registered as a support capability');

-- ============================================================================
-- create_class with slots (an Owner): Mon 07:00, Wed 18:30, Sat 09:00
-- ============================================================================
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select create_class('Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:00"},{"weekday":3,"start_time":"18:30"},{"weekday":6,"start_time":"09:00"}]'::jsonb)$$,
  'create_class with per-day slots creates a recurring class');
reset role;

select set_config('test.pilates', (select id::text from classes where name = 'PILATES'), false);
select set_eq(
  $$select weekday, start_time from class_schedule_slots where class_id = current_setting('test.pilates')::uuid$$,
  $$values (1::smallint, '07:00'::time), (3::smallint, '18:30'::time), (6::smallint, '09:00'::time)$$,
  'the three slots are stored with their own times');
select is(
  (select (recurrence_days is null and recurrence_time is null) from classes where id = current_setting('test.pilates')::uuid),
  true, 'a per-day class stores recurrence_days and recurrence_time as null');
select set_eq(
  $$select scheduled_at from class_sessions where class_id = current_setting('test.pilates')::uuid$$,
  $$select scheduled_at from pg_temp.slot_set(current_setting('test.pilates')::uuid)$$,
  'the generated sessions are exactly the slots'' instants over the rolling window');
select is(
  (select count(*)::int from audit_log where target_entity_id = current_setting('test.pilates') and action_type in ('class_created', 'class_times_changed', 'class_cancelled')),
  0, 'create_class writes no audit row of its own (the dashboard writes class_created)');

-- One-off with slots, and a one-off created the old way and the new way.
set local role authenticated;
select pg_temp.owner();
select throws_like(
  $$select create_class('Bad one-off', null, '00000000-0000-0000-0292-000000000303', 5, 'one_off', now() + interval '2 days', null, null, null, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$,
  'create_class: a one-off class cannot have weekly times', 'slots on a one-off class are refused');
select lives_ok(
  $$select create_class('One off null', null, '00000000-0000-0000-0292-000000000303', 5, 'one_off', now() + interval '2 days', null, null, null, null)$$,
  'a one-off class with p_slots null is created');
select lives_ok(
  $$select create_class('One off json null', null, '00000000-0000-0000-0292-000000000303', 5, 'one_off', now() + interval '3 days', null, null, null, 'null'::jsonb)$$,
  'a one-off class with JSON null slots is created (null means not supplied)');
reset role;
select is((select count(*)::int from class_sessions s join classes c on c.id = s.class_id where c.name in ('ONE OFF NULL', 'ONE OFF JSON NULL')), 2,
  'each one-off class got its session');

-- ============================================================================
-- The stable refusals (a recurring class, then an edit), each its own message prefixed with the function name
-- ============================================================================
set local role authenticated;
select pg_temp.owner();
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, null)$$,
  'create_class: a recurring class needs at least one weekly time', 'none: null slots for a recurring class');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[]'::jsonb)$$,
  'create_class: a recurring class needs at least one weekly time', 'none: an empty array for a recurring class');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date,
    (select jsonb_agg(jsonb_build_object('weekday', 1 + (n % 6), 'start_time', ('10:' || lpad(n::text, 2, '0')))) from generate_series(1, 15) n))$$,
  'create_class: a class can have at most 14 weekly times', 'over 14: fifteen slots');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":7,"start_time":"07:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a weekday from 0%', 'bad weekday: 7');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":-1,"start_time":"07:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a weekday from 0%', 'bad weekday: -1');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1.5,"start_time":"07:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a weekday from 0%', 'bad weekday: 1.5');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":"1","start_time":"07:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a weekday from 0%', 'bad weekday: a string');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"start_time":"07:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a weekday from 0%', 'bad weekday: missing');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"25:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a start time written HH:MM%', 'bad time: 25:00');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"7:00"}]'::jsonb)$$,
  'create_class: a weekly time needs a start time written HH:MM%', 'bad time: 7:00');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"7pm"}]'::jsonb)$$,
  'create_class: a weekly time needs a start time written HH:MM%', 'bad time: free text');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1}]'::jsonb)$$,
  'create_class: a weekly time needs a start time written HH:MM%', 'bad time: missing');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00:00"}]'::jsonb)$$,
  'create_class: a weekly time is a whole minute, without seconds', 'seconds: 07:00:00');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00:30"}]'::jsonb)$$,
  'create_class: a weekly time is a whole minute, without seconds', 'seconds: 07:00:30');
select throws_like($$select create_class('R', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"},{"weekday":1,"start_time":"07:00"}]'::jsonb)$$,
  'create_class: the same weekday and time appears twice in the weekly times', 'duplicate: the same weekday and time twice');
select lives_ok($$select create_class('Same day twice', null, '00000000-0000-0000-0292-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"},{"weekday":1,"start_time":"19:00"}]'::jsonb)$$,
  'the same weekday at two different times is accepted');
select throws_like($$select update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date, '[]'::jsonb)$$,
  'update_class: a recurring class needs at least one weekly time', 'update_class: the same refusals carry the function name');
select throws_like($$select update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'one_off', now() + interval '1 day', null, null, null, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$,
  'update_class: a one-off class cannot have weekly times', 'update_class: slots on a one-off');
reset role;
select is((select count(*)::int from classes where name = 'R'), 0, 'no refused create_class left a class row behind');

-- ============================================================================
-- update_class: move a booked time (Mon 07:00 -> 07:30)
-- ============================================================================
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0292-0000000000a0', s.id, m.id
from (select id from class_sessions where class_id = current_setting('test.pilates')::uuid
        and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 order by scheduled_at limit 1) s
cross join (select id from members where id in ('00000000-0000-0000-0292-000000000304', '00000000-0000-0000-0292-000000000305')) m;
select set_config('test.monday', (select id::text from class_sessions where class_id = current_setting('test.pilates')::uuid
  and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 order by scheduled_at limit 1), false);

set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:30"},{"weekday":3,"start_time":"18:30"},{"weekday":6,"start_time":"09:00"}]'::jsonb)::text, false)$$,
  'update_class moves Monday 07:00 to 07:30 with the 07:00 session booked');
reset role;

select is(jsonb_array_length(pg_temp.res() -> 'left_unchanged'), 1, 'exactly the booked session is left unchanged');
select is(pg_temp.res() -> 'left_unchanged' -> 0 ->> 'class_session_id', current_setting('test.monday'), 'it is the booked Monday 07:00 session');
select is((pg_temp.res() -> 'left_unchanged' -> 0 ->> 'booked_count')::int, 2, 'it reports its booked count');
select is((pg_temp.res() -> 'left_unchanged' -> 0 ->> 'capacity')::int, 15, 'it reports the class capacity');
select is((pg_temp.res() -> 'left_unchanged' -> 0 ->> 'scheduled_at')::timestamptz,
  (select scheduled_at from class_sessions where id = current_setting('test.monday')::uuid), 'it reports the session''s own instant');
select is((select count(*)::int from class_bookings where class_session_id = current_setting('test.monday')::uuid), 2, 'the old session keeps its bookings');
select is(
  (select count(*)::int from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 and (scheduled_at at time zone 'Africa/Douala')::time = '07:00'),
  1, 'only the booked 07:00 Monday session remains (every unbooked one was deleted)');
select ok(
  exists (select 1 from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 and (scheduled_at at time zone 'Africa/Douala')::time = '07:30'),
  'the new 07:30 Monday sessions were created beside it');
select set_eq(
  $$select scheduled_at from class_sessions where class_id = current_setting('test.pilates')::uuid and id <> current_setting('test.monday')::uuid and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.slot_set(current_setting('test.pilates')::uuid) where scheduled_at > now()$$,
  'every other future session is exactly the new slots'' instant');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'), 1,
  'one class_times_changed audit row was written');
select is(
  (select metadata ->> 'left_unchanged_count' from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'),
  '1', 'the audit row counts the sessions left unchanged');
select is(
  (select metadata ->> 'class_name' from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'),
  'Pilates', 'the audit row carries the class name');
select is(
  (select metadata -> 'old_slots' -> 0 ->> 'start_time' from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'),
  '07:00', 'the audit row carries the old times');
select is(
  (select metadata -> 'new_slots' -> 0 ->> 'start_time' from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'),
  '07:30', 'the audit row carries the new times');

-- Idempotent: the same payload again returns the same list and changes no row.
select set_config('test.md5', pg_temp.sessions_md5(current_setting('test.pilates')::uuid), false);
select set_config('test.res1', pg_temp.res()::text, false);
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:30"},{"weekday":3,"start_time":"18:30"},{"weekday":6,"start_time":"09:00"}]'::jsonb)::text, false)$$,
  'the same edit again does not raise');
reset role;
select is(pg_temp.res(), current_setting('test.res1')::jsonb, 'the repeated edit returns the same left_unchanged');
select is(pg_temp.sessions_md5(current_setting('test.pilates')::uuid), current_setting('test.md5'), 'and changes no session row');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'), 1,
  'and writes no second times-changed audit row (the times did not change)');

-- A name-only edit does not write a times-changed row either.
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select update_class(current_setting('test.pilates')::uuid, 'Pilates Plus', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:30"},{"weekday":3,"start_time":"18:30"},{"weekday":6,"start_time":"09:00"}]'::jsonb)$$,
  'a name-only edit succeeds');
reset role;
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.pilates') and action_type = 'class_times_changed'), 1,
  'a name-only edit writes no times-changed audit row');

-- A booked session that still matches is untouched and not returned; a booked non-matching one stays listed.
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0292-0000000000a0', id, '00000000-0000-0000-0292-000000000304'
from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
  and extract(dow from scheduled_at at time zone 'Africa/Douala') = 3 order by scheduled_at limit 1;
select set_config('test.wed', (select id::text from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
  and extract(dow from scheduled_at at time zone 'Africa/Douala') = 3 order by scheduled_at limit 1), false);
-- A past session of the class, booked and attended, that no new time matches.
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0292-000000000501', '00000000-0000-0000-0292-0000000000a0', current_setting('test.pilates')::uuid, now() - interval '3 days');
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0292-0000000000a0', '00000000-0000-0000-0292-000000000501', '00000000-0000-0000-0292-000000000304', now() - interval '3 days');

set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"08:00"},{"weekday":3,"start_time":"18:30"},{"weekday":1,"start_time":"19:00"}]'::jsonb)::text, false)$$,
  'a day removed (Saturday), a time moved and a second Monday time added');
reset role;
select is(jsonb_array_length(pg_temp.res() -> 'left_unchanged'), 1, 'the Monday 07:00 session is still the only one left unchanged');
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.res() -> 'left_unchanged') e where e ->> 'class_session_id' = current_setting('test.wed')),
  'the booked Wednesday session that still matches is not returned');
select ok(exists (select 1 from class_sessions where id = current_setting('test.wed')::uuid)
  and (select count(*) from class_bookings where class_session_id = current_setting('test.wed')::uuid) = 1,
  'it and its booking are untouched');
select is((select count(*)::int from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
   and extract(dow from scheduled_at at time zone 'Africa/Douala') = 6), 0, 'the unbooked Saturday sessions were deleted');
select ok(
  exists (select 1 from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 and (scheduled_at at time zone 'Africa/Douala')::time = '19:00')
  and exists (select 1 from class_sessions where class_id = current_setting('test.pilates')::uuid and scheduled_at > now()
     and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 and (scheduled_at at time zone 'Africa/Douala')::time = '08:00'),
  'Monday now has sessions at two times');
select ok(exists (select 1 from class_sessions where id = '00000000-0000-0000-0292-000000000501')
  and exists (select 1 from class_bookings where class_session_id = '00000000-0000-0000-0292-000000000501' and attended_at is not null),
  'the past session and its attended booking are untouched');

-- 14 slots then 15, and re-applying 14.
select set_config('test.s14', (select jsonb_agg(jsonb_build_object('weekday', w, 'start_time', t))::text
  from (values (0,'06:00'),(0,'18:00'),(1,'06:00'),(1,'18:00'),(2,'06:00'),(2,'18:00'),(3,'06:00'),(3,'18:00'),(4,'06:00'),(4,'18:00'),(5,'06:00'),(5,'18:00'),(6,'06:00'),(6,'18:00')) v(w, t)), false);
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date, current_setting('test.s14')::jsonb)$$,
  'fourteen weekly times are accepted');
reset role;
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.pilates')::uuid), 14, 'the class holds 14 slots');
select set_config('test.md5', pg_temp.sessions_md5(current_setting('test.pilates')::uuid), false);
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date, current_setting('test.s14')::jsonb)$$,
  'the same 14 are accepted again');
select throws_like(
  $$select update_class(current_setting('test.pilates')::uuid, 'Pilates', null, '00000000-0000-0000-0292-000000000303', 15, 'recurring', null, null, null, current_date,
      current_setting('test.s14')::jsonb || '[{"weekday":0,"start_time":"12:00"}]'::jsonb)$$,
  'update_class: a class can have at most 14 weekly times', 'a 15th time is refused');
reset role;
select is(pg_temp.sessions_md5(current_setting('test.pilates')::uuid), current_setting('test.md5'), 're-applying 14 and the refused 15th changed no session');
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.pilates')::uuid), 14, 'the refused 15th left 14 slots');

-- ============================================================================
-- Type switches follow the slot rule; only one-off to one-off keeps the 0058 refusal
-- ============================================================================
set local role authenticated;
select pg_temp.owner();
select lives_ok($$select create_class('Switch', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"10:00"},{"weekday":4,"start_time":"10:00"}]'::jsonb)$$,
  'a recurring class to switch');
reset role;
select set_config('test.switch', (select id::text from classes where name = 'SWITCH'), false);
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0292-0000000000a0', id, '00000000-0000-0000-0292-000000000304'
from class_sessions where class_id = current_setting('test.switch')::uuid and scheduled_at > now() order by scheduled_at limit 1;

set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.switch')::uuid, 'Switch', null, '00000000-0000-0000-0292-000000000303', 10, 'one_off', now() + interval '40 days', null, null, null, null)::text, false)$$,
  'recurring to one-off over a booked future session does not raise');
reset role;
select is(jsonb_array_length(pg_temp.res() -> 'left_unchanged'), 1, 'the booked session is listed');
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.switch')::uuid), 0, 'the slots are gone');
select is((select count(*)::int from class_sessions where class_id = current_setting('test.switch')::uuid and scheduled_at > now()), 2,
  'the booked session stays and the one-off session is generated');
select is(
  (select (recurrence_days is null and recurrence_time is null and recurrence_start_date is null and schedule_type = 'one_off') from classes where id = current_setting('test.switch')::uuid),
  true, 'the class is a one-off class with no recurrence fields');

set local role authenticated;
select pg_temp.owner();
select throws_like(
  $$select update_class(current_setting('test.switch')::uuid, 'Switch', null, '00000000-0000-0000-0292-000000000303', 10, 'one_off', now() + interval '50 days', null, null, null, null)$$,
  '%cannot reschedule%', 'one-off to one-off over a booking keeps the 0058 refusal');
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.switch')::uuid, 'Switch', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date,
      '[{"weekday":5,"start_time":"11:00"}]'::jsonb)::text, false)$$,
  'one-off to recurring over a booked session does not raise');
reset role;
select is(jsonb_array_length(pg_temp.res() -> 'left_unchanged'), 1, 'the booked one-off-era session is listed (it matches no slot)');
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.switch')::uuid), 1, 'entering recurring created its slot');
select ok((select count(*) from class_sessions where class_id = current_setting('test.switch')::uuid and scheduled_at > now()) > 1,
  'sessions follow the new slot beside the kept booked one');

-- ============================================================================
-- A start-date-only edit: the slots are identical, only recurrence_start_date moves
-- ============================================================================
set local role authenticated;
select pg_temp.owner();
select lives_ok($$select create_class('Start only', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"10:00"}]'::jsonb)$$,
  'a recurring class with one Tuesday time');
reset role;
select set_config('test.sd', (select id::text from classes where name = 'START ONLY'), false);
select set_config('test.sd_early', (select id::text from class_sessions where class_id = current_setting('test.sd')::uuid and scheduled_at > now() order by scheduled_at limit 1), false);
select set_config('test.sd_late', (select id::text from class_sessions where class_id = current_setting('test.sd')::uuid
  and (scheduled_at at time zone 'Africa/Douala')::date >= current_date + 21 order by scheduled_at limit 1), false);
insert into class_bookings (gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0292-0000000000a0', current_setting('test.sd_early')::uuid, '00000000-0000-0000-0292-000000000304'),
  ('00000000-0000-0000-0292-0000000000a0', current_setting('test.sd_late')::uuid, '00000000-0000-0000-0292-000000000305');

set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.sd')::uuid, 'Start only', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date + 21,
      '[{"weekday":2,"start_time":"10:00"}]'::jsonb)::text, false)$$,
  'update_class moves only the start date three weeks later');
reset role;
select is(jsonb_array_length(pg_temp.res() -> 'left_unchanged'), 1, 'only the booked session dated before the new start date is left unchanged');
select is(pg_temp.res() -> 'left_unchanged' -> 0 ->> 'class_session_id', current_setting('test.sd_early'), 'it is the early booked session, though its weekday and time still match a slot');
select is((select matches_slots from class_sessions_with_match where class_session_id = current_setting('test.sd_early')::uuid), false,
  'the view says it no longer matches: the local date is before recurrence_start_date');
select is((select matches_slots from class_sessions_with_match where class_session_id = current_setting('test.sd_late')::uuid), true,
  'a booked session on or after the new start date still matches');
select ok(exists (select 1 from class_sessions where id = current_setting('test.sd_late')::uuid)
  and not exists (select 1 from jsonb_array_elements(pg_temp.res() -> 'left_unchanged') e where e ->> 'class_session_id' = current_setting('test.sd_late')),
  'it is untouched and not returned');
select is((select count(*)::int from class_sessions where class_id = current_setting('test.sd')::uuid and scheduled_at > now()
   and (scheduled_at at time zone 'Africa/Douala')::date < current_date + 21 and id <> current_setting('test.sd_early')::uuid), 0,
  'the unbooked sessions before the new start date were deleted');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.sd') and action_type = 'class_times_changed'), 1,
  'a start-date change writes a class_times_changed row');
select is((select metadata -> 'old_slots' = metadata -> 'new_slots' from audit_log where target_entity_id = current_setting('test.sd') and action_type = 'class_times_changed'), true,
  'its old and new slots are identical');
select set_config('test.md5', pg_temp.sessions_md5(current_setting('test.sd')::uuid), false);
select set_config('test.res1', pg_temp.res()::text, false);
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.sd')::uuid, 'Start only', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date + 21,
      '[{"weekday":2,"start_time":"10:00"}]'::jsonb)::text, false)$$,
  'the same start-date edit again does not raise');
reset role;
select is(pg_temp.res(), current_setting('test.res1')::jsonb, 'it returns the same left_unchanged');
select is(pg_temp.sessions_md5(current_setting('test.sd')::uuid), current_setting('test.md5'), 'it changes no session row');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.sd') and action_type = 'class_times_changed'), 1, 'and writes no second audit row');
set local role authenticated;
select pg_temp.owner();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.sd')::uuid, 'Start only', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, null, null, current_date,
      '[{"weekday":2,"start_time":"10:00"}]'::jsonb)::text, false)$$,
  'moving the start date back to today');
reset role;
select is((select matches_slots from class_sessions_with_match where class_session_id = current_setting('test.sd_early')::uuid), true, 'the early session matches again');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.sd') and action_type = 'class_times_changed'), 2, 'the second change is audited too');

-- ============================================================================
-- Old signatures behave as before (the previous dashboard)
-- ============================================================================
set local role authenticated;
select pg_temp.owner();
select lives_ok($$select create_class('Old signature', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, array[2,4]::smallint[], '18:00', current_date)$$,
  'the old create_class signature creates a recurring class');
reset role;
select set_config('test.old', (select id::text from classes where name = 'OLD SIGNATURE'), false);
select is((select (recurrence_days, recurrence_time) from classes where id = current_setting('test.old')::uuid), (select (array[2,4]::smallint[], '18:00'::time)),
  'the old create_class still writes recurrence_days and recurrence_time');
select set_eq($$select weekday, start_time from class_schedule_slots where class_id = current_setting('test.old')::uuid$$,
  $$values (2::smallint, '18:00'::time), (4::smallint, '18:00'::time)$$, 'and its slots');
set local role authenticated;
select pg_temp.owner();
select lives_ok($$select update_class(current_setting('test.old')::uuid, 'Old signature', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, array[2,5]::smallint[], '19:15', current_date)$$,
  'the old update_class signature changes days and time');
reset role;
select is((select (recurrence_days, recurrence_time) from classes where id = current_setting('test.old')::uuid), (select (array[2,5]::smallint[], '19:15'::time)),
  'the old update_class restores the legacy columns on a recurring row');
select set_eq($$select weekday, start_time from class_schedule_slots where class_id = current_setting('test.old')::uuid$$,
  $$values (2::smallint, '19:15'::time), (5::smallint, '19:15'::time)$$, 'and the slots follow the days and the single time');
select set_eq($$select scheduled_at from class_sessions where class_id = current_setting('test.old')::uuid and scheduled_at > now()$$,
  $$select scheduled_at from pg_temp.slot_set(current_setting('test.old')::uuid) where scheduled_at > now()$$,
  'and the future sessions');
set local role authenticated;
select pg_temp.owner();
select throws_like($$select update_class(current_setting('test.old')::uuid, 'Old signature', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, array[]::smallint[], '19:15', current_date)$$,
  '%needs days and a time%', 'the old update_class keeps its own refusal for a recurring class with no days');
select throws_like($$select update_class(current_setting('test.old')::uuid, 'Old signature', null, '00000000-0000-0000-0292-000000000303', 10, 'recurring', null, array[2,5]::smallint[], '07:00:30', current_date)$$,
  '%whole minute, without seconds%', 'the old update_class refuses a recurring time with seconds');
reset role;
select is((select (recurrence_days, recurrence_time) from classes where id = current_setting('test.old')::uuid), (select (array[2,5]::smallint[], '19:15'::time)),
  'and the refused edit changed neither the legacy columns');
select set_eq($$select weekday, start_time from class_schedule_slots where class_id = current_setting('test.old')::uuid$$,
  $$values (2::smallint, '19:15'::time), (5::smallint, '19:15'::time)$$, 'nor the slots');

-- ============================================================================
-- matches_slots (the single source of the "Old time" tag) and its isolation
-- ============================================================================
select is((select matches_slots from class_sessions_with_match where class_session_id = current_setting('test.monday')::uuid), false,
  'the kept Monday 07:00 session no longer matches the class''s times');
select is((select matches_slots from class_sessions_with_match where class_session_id = current_setting('test.wed')::uuid), false,
  'the kept Wednesday session no longer matches either (the 14 slots changed the times)');
select is((select bool_and(matches_slots) from class_sessions_with_match v
  where v.class_id = current_setting('test.old')::uuid), true, 'every session of a class that was just regenerated matches its slots');
select is((select matches_slots from class_sessions_with_match v join classes c on c.id = v.class_id where c.name = 'ONE OFF NULL'), true,
  'a one-off class''s session always matches');
select is((select count(*)::int from class_sessions_with_match v where v.class_id = current_setting('test.pilates')::uuid and v.matches_slots and v.scheduled_at > now()),
  (select count(*)::int from class_sessions s where s.class_id = current_setting('test.pilates')::uuid and s.scheduled_at > now() and s.id not in (current_setting('test.monday')::uuid, current_setting('test.wed')::uuid)),
  'exactly the regenerated sessions match, the two kept ones do not');
select is(
  (select count(*)::int from class_sessions_with_match v where v.matches_slots is distinct from (
     (v.scheduled_at at time zone 'Africa/Douala')::date >= (select recurrence_start_date from classes where id = v.class_id)
     and exists (select 1 from class_schedule_slots s where s.class_id = v.class_id
        and s.weekday = extract(dow from v.scheduled_at at time zone 'Africa/Douala')::smallint
        and ((v.scheduled_at at time zone 'Africa/Douala')::date + s.start_time) at time zone 'Africa/Douala' = v.scheduled_at))
     and v.class_id in (select id from classes where schedule_type = 'recurring' and gym_id = '00000000-0000-0000-0292-0000000000a0')),
  0, 'matches_slots is exactly apply_class_slots'' rule (local date on or after the start date, same weekday and time of day in the gym zone)');

set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0292-000000000202', '00000000-0000-0000-0292-0000000000a0', 'manager');
select ok((select count(*) from class_sessions_with_match) > 0, 'a Manager reads the view');
select pg_temp.as_role('00000000-0000-0000-0292-000000000206', '00000000-0000-0000-0292-0000000000a0', 'receptionist');
select ok((select count(*) from class_sessions_with_match) > 0, 'a Receptionist reads the view');
select pg_temp.as_role('00000000-0000-0000-0292-000000000203', '00000000-0000-0000-0292-0000000000a0', 'coach');
select ok((select count(*) from class_sessions_with_match) > 0, 'a Coach reads the view');
select pg_temp.as_role('00000000-0000-0000-0292-000000000204', '00000000-0000-0000-0292-0000000000a0', 'member');
select ok((select count(*) from class_sessions_with_match) > 0, 'a member reads the view');
select pg_temp.as_role('00000000-0000-0000-0292-000000000211', '00000000-0000-0000-0292-0000000000b0', 'owner');
select is((select count(*)::int from class_sessions_with_match), 0, 'a gym B Owner reads none of gym A''s sessions through the view');
reset role;
set local role anon;
select throws_like($$select count(*) from class_sessions_with_match$$, '%permission denied%', 'anon cannot read the view');
reset role;

-- ============================================================================
-- list_my_classes (the Coach's own list): slots, cancelled_at and per-session matches_slots
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0292-000000000203', '00000000-0000-0000-0292-0000000000a0', 'coach');
select is(
  (select slots from list_my_classes() where class_id = current_setting('test.old')::uuid limit 1),
  '[{"weekday":2,"start_time":"19:15"},{"weekday":5,"start_time":"19:15"}]'::jsonb, 'list_my_classes returns the class''s slots as weekday and HH:MM');
select is(
  (select slots from list_my_classes() where class_id = (select id from classes where name = 'ONE OFF NULL') limit 1),
  '[]'::jsonb, 'a one-off class has an empty slots array');
select is((select count(*)::int from list_my_classes() where cancelled_at is not null), 0, 'no class of this Coach is cancelled yet');
select is((select matches_slots from list_my_classes() where class_session_id = current_setting('test.monday')::uuid), false,
  'list_my_classes tags the kept Monday session as not matching');
select ok(
  not exists (select 1 from unnest((select proargnames from pg_proc where oid = 'public.list_my_classes()'::regprocedure)) n where n in ('recurrence_days', 'recurrence_time')),
  'list_my_classes no longer returns recurrence_days or recurrence_time');
reset role;

select * from finish();
rollback;
