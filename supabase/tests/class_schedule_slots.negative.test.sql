-- Story 29.1: the refusals of 0180. The 14-slot cap (and the class-row lock that makes it race-safe), duplicate and bad slots, tenancy, direct
-- writes per role, RLS per role and across tenants, a suspended gym, the deferred presence check refusing, and create_class / update_class
-- refusals. The positive side is class_schedule_slots.test.sql; the real two-connection races are scripts/class-slot-race.sh.
-- Fixtures: 00000000-0000-0000-0181-* (gym A active, B active, S suspended; Douala).

begin;
select plan(69);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0181-000000000001', 'Slots Neg Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0181-0000000000a0', 'Slots Neg Gym A', '00000000-0000-0000-0181-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0181-0000000000b0', 'Slots Neg Gym B', '00000000-0000-0000-0181-000000000001', 'Africa/Douala');
insert into gyms (id, name, tier_id, timezone, status, saas_billing_status) values
  ('00000000-0000-0000-0181-0000000000e0', 'Slots Neg Gym S', '00000000-0000-0000-0181-000000000001', 'Africa/Douala', 'suspended', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0181-000000000201'), ('00000000-0000-0000-0181-000000000202'), ('00000000-0000-0000-0181-000000000203'),
  ('00000000-0000-0000-0181-000000000204'), ('00000000-0000-0000-0181-000000000205'), ('00000000-0000-0000-0181-000000000211'),
  ('00000000-0000-0000-0181-000000000212'), ('00000000-0000-0000-0181-000000000221'), ('00000000-0000-0000-0181-000000000222');

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0181-000000000301', '00000000-0000-0000-0181-0000000000a0', '00000000-0000-0000-0181-000000000201', 'owner', 'Neg A Owner'),
  ('00000000-0000-0000-0181-000000000302', '00000000-0000-0000-0181-0000000000a0', '00000000-0000-0000-0181-000000000202', 'manager', 'Neg A Manager'),
  ('00000000-0000-0000-0181-000000000303', '00000000-0000-0000-0181-0000000000a0', '00000000-0000-0000-0181-000000000203', 'coach', 'Neg A Coach'),
  ('00000000-0000-0000-0181-000000000304', '00000000-0000-0000-0181-0000000000a0', '00000000-0000-0000-0181-000000000204', 'receptionist', 'Neg A Receptionist'),
  ('00000000-0000-0000-0181-000000000305', '00000000-0000-0000-0181-0000000000a0', '00000000-0000-0000-0181-000000000205', 'member', 'Neg A Member'),
  ('00000000-0000-0000-0181-000000000311', '00000000-0000-0000-0181-0000000000b0', '00000000-0000-0000-0181-000000000211', 'owner', 'Neg B Owner'),
  ('00000000-0000-0000-0181-000000000312', '00000000-0000-0000-0181-0000000000b0', '00000000-0000-0000-0181-000000000212', 'coach', 'Neg B Coach'),
  ('00000000-0000-0000-0181-000000000321', '00000000-0000-0000-0181-0000000000e0', '00000000-0000-0000-0181-000000000221', 'owner', 'Neg S Owner'),
  ('00000000-0000-0000-0181-000000000322', '00000000-0000-0000-0181-0000000000e0', '00000000-0000-0000-0181-000000000222', 'coach', 'Neg S Coach');

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0181-000000000401', '00000000-0000-0000-0181-0000000000a0', 'Cap', '00000000-0000-0000-0181-000000000303', 10, 'recurring', '{1}', '08:00', current_date),
  ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 'Two slots', '00000000-0000-0000-0181-000000000303', 10, 'recurring', '{2,4}', '18:00', current_date),
  ('00000000-0000-0000-0181-000000000411', '00000000-0000-0000-0181-0000000000b0', 'B class', '00000000-0000-0000-0181-000000000312', 10, 'recurring', '{3}', '10:00', current_date),
  ('00000000-0000-0000-0181-000000000421', '00000000-0000-0000-0181-0000000000e0', 'S class', '00000000-0000-0000-0181-000000000322', 10, 'recurring', '{3}', '10:00', current_date);
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0181-000000000406', '00000000-0000-0000-0181-0000000000a0', 'One off', '00000000-0000-0000-0181-000000000303', 10, 'one_off', now() + interval '3 days');

-- ============================================================================
-- The 14-slot cap
-- ============================================================================
insert into class_schedule_slots (class_id, gym_id, weekday, start_time)
select '00000000-0000-0000-0181-000000000401', '00000000-0000-0000-0181-0000000000a0', 1 + (n % 6), ('09:' || lpad(n::text, 2, '0'))::time
from generate_series(1, 13) n;

select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401'), 14, 'a class holds 14 slots (the migrated one plus 13)');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000401', '00000000-0000-0000-0181-0000000000a0', 1, '23:00')$$,
  '%a class can have at most 14 weekly times%', 'a 15th slot on the same weekday is refused with the stable message');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000401', '00000000-0000-0000-0181-0000000000a0', 0, '23:00')$$,
  '%a class can have at most 14 weekly times%', 'a 15th slot on another weekday is refused too');
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401'), 14, 'the refused 15th inserted nothing');
delete from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401' and start_time = '09:13';
select lives_ok(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000401', '00000000-0000-0000-0181-0000000000a0', 0, '23:00')$$,
  'deleting one slot allows another');
select ok(
  (select position('for update' in lower(prosrc)) > 0 and position('for update' in lower(prosrc)) < position('count(*)' in lower(prosrc))
   from pg_proc where oid = 'private.class_schedule_slots_cap()'::regprocedure),
  'the cap trigger locks the class row FOR UPDATE before counting (the concurrent 14th/15th insert race is in scripts/class-slot-race.sh)');
select throws_like(
  $$select * from private.apply_class_slots('00000000-0000-0000-0181-000000000401', (select jsonb_agg(jsonb_build_object('weekday', 1 + (n % 6), 'start_time', ('11:' || lpad(n::text, 2, '0')))) from generate_series(1, 15) n))$$,
  '%at most 14 weekly times%', 'replacing the slots with 15 refuses (the apply path cannot exceed the cap either)');
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401'), 14, 'the refused 15-slot replacement left the 14 slots alone');
select lives_ok(
  $$select * from private.apply_class_slots('00000000-0000-0000-0181-000000000401', (select jsonb_agg(jsonb_build_object('weekday', weekday, 'start_time', to_char(start_time, 'HH24:MI'))) from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401'))$$,
  'a class holding 14 slots can be given its own 14 slots again (the cap counts new slots, not stored ones)');
select lives_ok(
  $$select * from private.apply_class_slots('00000000-0000-0000-0181-000000000401',
    (select jsonb_agg(jsonb_build_object('weekday', weekday, 'start_time', to_char(start_time, 'HH24:MI'))) from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401' and start_time <> '23:00')
    || jsonb_build_array(jsonb_build_object('weekday', 2, 'start_time', '22:00')))$$,
  'swapping one slot of a 14-slot class for a new one stays at 14');
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000401'), 14, 'the swap left 14 slots');

-- ============================================================================
-- Duplicate, seconds, weekday range
-- ============================================================================
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 2, '18:00')$$,
  '%class_schedule_slots_class_weekday_time_key%', 'the same (class, weekday, start_time) twice is a unique violation');
select lives_ok(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 2, '19:30')$$,
  'the same weekday at another time is accepted');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 3, '18:00:30')$$,
  '%class_schedule_slots_start_time_minute%', 'a start time with seconds is refused');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 3, '24:00')$$,
  '%class_schedule_slots_start_time_minute%', 'a start time of 24:00 is refused (it could never match a session of its own)');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 7, '18:00')$$,
  '%class_schedule_slots_weekday_check%', 'weekday 7 is refused');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', -1, '18:00')$$,
  '%class_schedule_slots_weekday_check%', 'weekday -1 is refused');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', null, '18:00')$$,
  '%null value%', 'a null weekday is refused');

-- ============================================================================
-- Tenancy trigger (as a superuser fixture and through the definer functions)
-- ============================================================================
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000b0', 5, '18:00')$$,
  '%must match the gym of its class%', 'a slot whose gym differs from its class''s gym is refused');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-00000000ffff', '00000000-0000-0000-0181-0000000000a0', 5, '18:00')$$,
  '%must match the gym of its class%', 'a slot for a missing class is refused');
select throws_like(
  $$update class_schedule_slots set class_id = '00000000-0000-0000-0181-000000000411' where class_id = '00000000-0000-0000-0181-000000000402' and weekday = 2 and start_time = '18:00'$$,
  '%cannot move%', 'a slot cannot be moved to another class');
select throws_like(
  $$update class_schedule_slots set class_id = '00000000-0000-0000-0181-000000000411', gym_id = '00000000-0000-0000-0181-0000000000b0' where class_id = '00000000-0000-0000-0181-000000000402' and weekday = 2 and start_time = '18:00'$$,
  '%cannot move%', 'a slot cannot be moved to another gym with its class');
select throws_like(
  $$update class_schedule_slots set gym_id = '00000000-0000-0000-0181-0000000000b0' where class_id = '00000000-0000-0000-0181-000000000402' and weekday = 2 and start_time = '18:00'$$,
  '%cannot move%', 'a slot cannot change gym on its own');
select lives_ok(
  $$update class_schedule_slots set start_time = '17:45' where class_id = '00000000-0000-0000-0181-000000000402' and weekday = 2 and start_time = '18:00'$$,
  'a slot''s own time can be edited in place');

-- ============================================================================
-- Direct writes: no role can write the table, whatever its role
-- ============================================================================
select set_config('test.slot_id', (select id::text from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000402' limit 1), false);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0181-000000000201","role":"authenticated","gym_id":"00000000-0000-0000-0181-0000000000a0","app_role":"owner"}', true);
select throws_like($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 6, '10:00')$$, '%permission denied%', 'an Owner cannot insert a slot directly');
select throws_like($$update class_schedule_slots set weekday = 6$$, '%permission denied%', 'an Owner cannot update a slot directly');
select throws_like($$delete from class_schedule_slots$$, '%permission denied%', 'an Owner cannot delete a slot directly');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0181-000000000202","role":"authenticated","gym_id":"00000000-0000-0000-0181-0000000000a0","app_role":"manager"}', true);
select throws_like($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 6, '10:00')$$, '%permission denied%', 'a Manager cannot insert a slot directly');
select throws_like($$delete from class_schedule_slots$$, '%permission denied%', 'a Manager cannot delete a slot directly');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0181-000000000203","role":"authenticated","gym_id":"00000000-0000-0000-0181-0000000000a0","app_role":"coach"}', true);
select throws_like($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 6, '10:00')$$, '%permission denied%', 'a Coach cannot insert a slot directly');
select throws_like($$update class_schedule_slots set weekday = 6$$, '%permission denied%', 'a Coach cannot update a slot directly');
reset role;

set local role service_role;
select throws_like($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000402', '00000000-0000-0000-0181-0000000000a0', 6, '10:00')$$, '%permission denied%', 'service_role cannot insert a slot directly');
select throws_like($$update class_schedule_slots set weekday = 6$$, '%permission denied%', 'service_role cannot update a slot directly');
select throws_like($$delete from class_schedule_slots$$, '%permission denied%', 'service_role cannot delete a slot directly');
select throws_like($$truncate class_schedule_slots$$, '%permission denied%', 'service_role cannot truncate the table');
reset role;
set local role anon;
select throws_like($$select count(*) from class_schedule_slots$$, '%permission denied%', 'anon cannot read the table');
reset role;

-- ============================================================================
-- Reads: every role of the gym sees the gym's slots and none of another gym's; a suspended gym sees nothing.
-- ============================================================================
create function pg_temp.as_role(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;

set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0181-000000000201', '00000000-0000-0000-0181-0000000000a0', 'owner');
select ok((select count(*) from class_schedule_slots where gym_id = '00000000-0000-0000-0181-0000000000a0') > 0, 'an Owner reads their gym''s slots');
select is((select count(*)::int from class_schedule_slots where gym_id = '00000000-0000-0000-0181-0000000000b0'), 0, 'an Owner reads none of gym B''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000202', '00000000-0000-0000-0181-0000000000a0', 'manager');
select ok((select count(*) from class_schedule_slots) > 0, 'a Manager reads their gym''s slots');
select is((select count(*)::int from class_schedule_slots where gym_id <> '00000000-0000-0000-0181-0000000000a0'), 0, 'a Manager reads no other gym''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000204', '00000000-0000-0000-0181-0000000000a0', 'receptionist');
select ok((select count(*) from class_schedule_slots) > 0, 'a Receptionist reads their gym''s slots');
select is((select count(*)::int from class_schedule_slots where gym_id <> '00000000-0000-0000-0181-0000000000a0'), 0, 'a Receptionist reads no other gym''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000203', '00000000-0000-0000-0181-0000000000a0', 'coach');
select ok((select count(*) from class_schedule_slots) > 0, 'a Coach reads their gym''s slots');
select is((select count(*)::int from class_schedule_slots where gym_id <> '00000000-0000-0000-0181-0000000000a0'), 0, 'a Coach reads no other gym''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000205', '00000000-0000-0000-0181-0000000000a0', 'member');
select ok((select count(*) from class_schedule_slots) > 0, 'a member reads their gym''s slots');
select is((select count(*)::int from class_schedule_slots where gym_id <> '00000000-0000-0000-0181-0000000000a0'), 0, 'a member reads no other gym''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000211', '00000000-0000-0000-0181-0000000000b0', 'owner');
select is((select count(*)::int from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000402'), 0, 'gym B''s Owner reads none of gym A''s slots');
select pg_temp.as_role('00000000-0000-0000-0181-000000000221', '00000000-0000-0000-0181-0000000000e0', 'owner');
select is((select count(*)::int from class_schedule_slots), 0, 'a suspended gym''s Owner reads no slots (restrictive tenant_active_gate), though the gym has some');
reset role;
select ok((select count(*) from class_schedule_slots where gym_id = '00000000-0000-0000-0181-0000000000e0') > 0, 'the suspended gym does have slots (superuser view)');

-- ============================================================================
-- The deferred presence check refuses at commit; forced immediate here.
-- ============================================================================
set constraints all immediate;
select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_start_date) values ('00000000-0000-0000-0181-000000000431', '00000000-0000-0000-0181-0000000000a0', 'No slots', '00000000-0000-0000-0181-000000000303', 5, 'recurring', current_date)$$,
  '%at least one weekly time%', 'a recurring class with no slot is refused');
select throws_like(
  $$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0181-000000000406', '00000000-0000-0000-0181-0000000000a0', 1, '10:00')$$,
  '%a one-off class cannot have weekly times%', 'a one-off class with a slot is refused');
select throws_like(
  $$delete from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000411'$$,
  '%at least one weekly time%', 'deleting the last slot of a recurring class is refused');
select lives_ok(
  $$delete from class_schedule_slots where class_id = '00000000-0000-0000-0181-000000000402' and start_time = '19:30'$$,
  'deleting one of several slots is accepted');
select throws_like(
  $$update classes set schedule_type = 'one_off', one_off_session_at = now() + interval '1 day', recurrence_days = null, recurrence_time = null, recurrence_start_date = null where id = '00000000-0000-0000-0181-000000000411'$$,
  '%a one-off class cannot have weekly times%', 'turning a recurring class into a one-off one without removing its slots is refused');
set constraints all deferred;

-- ============================================================================
-- classes CHECK
-- ============================================================================
select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at, recurrence_days) values ('00000000-0000-0000-0181-000000000441', '00000000-0000-0000-0181-0000000000a0', 'Bad one-off', '00000000-0000-0000-0181-000000000303', 5, 'one_off', now() + interval '1 day', array[1]::smallint[])$$,
  '%classes_schedule_matches_type%', 'a one-off class with a stray recurrence field is still rejected');
select throws_like(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time) values ('00000000-0000-0000-0181-000000000442', '00000000-0000-0000-0181-0000000000a0', 'Bad recurring', '00000000-0000-0000-0181-000000000303', 5, 'recurring', array[1]::smallint[], '09:00')$$,
  '%classes_schedule_matches_type%', 'a recurring class without a start date is still rejected');
select lives_ok(
  $$insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_start_date) values ('00000000-0000-0000-0181-000000000443', '00000000-0000-0000-0181-0000000000a0', 'Slot only recurring', '00000000-0000-0000-0181-000000000303', 5, 'recurring', current_date)$$,
  'a recurring class with no days and no time is now valid (its slots come at commit)');

-- ============================================================================
-- create_class / update_class / materialize_class_sessions refusals
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0181-000000000201', '00000000-0000-0000-0181-0000000000a0', 'owner');
select throws_like($$select create_class('No days', null, '00000000-0000-0000-0181-000000000303', 5, 'recurring', null, null, '09:00', current_date)$$,
  '%needs days and a time%', 'create_class refuses a recurring class with no days');
select throws_like($$select create_class('No time', null, '00000000-0000-0000-0181-000000000303', 5, 'recurring', null, array[1]::smallint[], null, current_date)$$,
  '%needs days and a time%', 'create_class refuses a recurring class with no time');
select throws_like($$select update_class('00000000-0000-0000-0181-000000000402', 'Two slots', null, '00000000-0000-0000-0181-000000000303', 10, 'recurring', null, array[]::smallint[], '18:00', current_date)$$,
  '%needs days and a time%', 'update_class refuses a recurring class with no days');
select throws_like($$select create_class('Seconds', null, '00000000-0000-0000-0181-000000000303', 5, 'recurring', null, array[1]::smallint[], '09:00:30', current_date)$$,
  '%class_schedule_slots_start_time_minute%', 'create_class refuses a time with seconds (the slot CHECK, whole call rolled back)');
select is((select count(*)::int from classes where lower(name) in ('seconds', 'no days', 'no time')), 0, 'no refused create_class left a class row behind');

select pg_temp.as_role('00000000-0000-0000-0181-000000000211', '00000000-0000-0000-0181-0000000000b0', 'owner');
select throws_like($$select update_class('00000000-0000-0000-0181-000000000402', 'Two slots', null, '00000000-0000-0000-0181-000000000312', 10, 'recurring', null, array[1]::smallint[], '18:00', current_date)$$,
  '%not found%', 'another gym''s Owner cannot update a class (uniform not found)');
select throws_like($$select materialize_class_sessions('00000000-0000-0000-0181-000000000402', true)$$,
  '%not found%', 'another gym''s Owner cannot regenerate a class');
select pg_temp.as_role('00000000-0000-0000-0181-000000000204', '00000000-0000-0000-0181-0000000000a0', 'receptionist');
select throws_like($$select create_class('Recep', null, '00000000-0000-0000-0181-000000000303', 5, 'recurring', null, array[1]::smallint[], '09:00', current_date)$$,
  '%permission denied%', 'a Receptionist cannot create a class');
select pg_temp.as_role('00000000-0000-0000-0181-000000000203', '00000000-0000-0000-0181-0000000000a0', 'coach');
select throws_like($$select update_class('00000000-0000-0000-0181-000000000402', 'Two slots', null, '00000000-0000-0000-0181-000000000303', 10, 'recurring', null, array[1]::smallint[], '18:00', current_date)$$,
  '%permission denied%', 'a Coach cannot update a class through update_class');
select pg_temp.as_role('00000000-0000-0000-0181-000000000221', '00000000-0000-0000-0181-0000000000e0', 'owner');
select throws_like($$select create_class('Susp', null, '00000000-0000-0000-0181-000000000322', 5, 'recurring', null, array[1]::smallint[], '09:00', current_date)$$,
  '%is not active%', 'a suspended gym cannot create a class');
select throws_like($$select update_class('00000000-0000-0000-0181-000000000421', 'S class', null, '00000000-0000-0000-0181-000000000322', 10, 'recurring', null, array[2]::smallint[], '10:00', current_date)$$,
  '%is not active%', 'a suspended gym cannot update a class');
select throws_like($$select materialize_class_sessions('00000000-0000-0000-0181-000000000421', true)$$,
  '%is not active%', 'a suspended gym cannot regenerate a class');
reset role;

select * from finish();
rollback;
