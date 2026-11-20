-- Story 29.2: the refusals of 0181. Every caller that is not a Manager, Supervisor or Owner of the class's own gym is refused by cancel_class,
-- both create_class overloads and both update_class overloads; another gym's class, a missing class and a deactivated or claim-forged caller
-- get the uniform answer; a suspended gym is refused; the direct writes of classes and class_sessions by a Receptionist, a Coach and a member
-- change nothing. The positive side is class_slot_editor.test.sql and class_cancel.test.sql.
-- Fixtures: 00000000-0000-0000-0294-*. Gym A and B active (Douala), S suspended.

begin;
select plan(53);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0294-000000000001', 'Cancel Neg Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0294-0000000000a0', 'Cancel Neg Gym A', '00000000-0000-0000-0294-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0294-0000000000b0', 'Cancel Neg Gym B', '00000000-0000-0000-0294-000000000001', 'Africa/Douala');
insert into gyms (id, name, tier_id, timezone, status, saas_billing_status) values
  ('00000000-0000-0000-0294-0000000000e0', 'Cancel Neg Gym S', '00000000-0000-0000-0294-000000000001', 'Africa/Douala', 'suspended', 'suspended');

insert into auth.users (id)
select ('00000000-0000-0000-0294-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 230) n;

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0294-000000000301', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000201', 'owner', 'Neg A Owner', null),
  ('00000000-0000-0000-0294-000000000302', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000202', 'manager', 'Neg A Manager', null),
  ('00000000-0000-0000-0294-000000000303', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000203', 'coach', 'Neg A Coach', null),
  ('00000000-0000-0000-0294-000000000304', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000204', 'receptionist', 'Neg A Receptionist', null),
  ('00000000-0000-0000-0294-000000000305', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000205', 'member', 'Neg A Member', null),
  ('00000000-0000-0000-0294-000000000306', '00000000-0000-0000-0294-0000000000a0', '00000000-0000-0000-0294-000000000206', 'manager', 'Neg A Deactivated Manager', now() - interval '1 day'),
  ('00000000-0000-0000-0294-000000000311', '00000000-0000-0000-0294-0000000000b0', '00000000-0000-0000-0294-000000000211', 'manager', 'Neg B Manager', null),
  ('00000000-0000-0000-0294-000000000312', '00000000-0000-0000-0294-0000000000b0', '00000000-0000-0000-0294-000000000212', 'coach', 'Neg B Coach', null),
  ('00000000-0000-0000-0294-000000000321', '00000000-0000-0000-0294-0000000000e0', '00000000-0000-0000-0294-000000000221', 'owner', 'Neg S Owner', null),
  ('00000000-0000-0000-0294-000000000322', '00000000-0000-0000-0294-0000000000e0', '00000000-0000-0000-0294-000000000222', 'coach', 'Neg S Coach', null);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0294-000000000401', '00000000-0000-0000-0294-0000000000a0', 'Target', '00000000-0000-0000-0294-000000000303', 10, 'recurring', '{1,3}', '18:00', current_date),
  ('00000000-0000-0000-0294-000000000421', '00000000-0000-0000-0294-0000000000e0', 'S class', '00000000-0000-0000-0294-000000000322', 10, 'recurring', '{3}', '10:00', current_date);
select private.materialize_sessions_for_class(id) from classes where id in ('00000000-0000-0000-0294-000000000401', '00000000-0000-0000-0294-000000000421');
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0294-0000000000a0', id, '00000000-0000-0000-0294-000000000305' from class_sessions
where class_id = '00000000-0000-0000-0294-000000000401' and scheduled_at > now() order by scheduled_at limit 1;

create function pg_temp.as_role(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlerrm;
end;
$f$;
create function pg_temp.blocked(p_sql text) returns boolean language plpgsql as $f$
declare
  v_rows bigint;
begin
  execute p_sql;
  get diagnostics v_rows = row_count;
  return v_rows = 0;
exception when insufficient_privilege then
  return true;
end;
$f$;

create temp table target_before as
select (select cancelled_at from classes where id = '00000000-0000-0000-0294-000000000401') as class_cancelled_at,
       (select count(*) from class_sessions where class_id = '00000000-0000-0000-0294-000000000401' and cancelled_at is not null) as flagged,
       (select count(*) from class_sessions where class_id = '00000000-0000-0000-0294-000000000401') as sessions_n,
       (select count(*) from audit_log where action_type in ('class_cancelled', 'class_times_changed')) as audit_n;

-- ============================================================================
-- Receptionist, Coach, member, GymOS Support (a caller with no live non-support role in the gym: private.current_member_role() excludes the
-- support role, so a support session resolves to null exactly like a user with no membership): every write function refused
-- ============================================================================
create function pg_temp.sql_cancel() returns text language sql as $f$ select 'select cancel_class(''00000000-0000-0000-0294-000000000401'')' $f$;
create function pg_temp.sql_create_slots() returns text language sql as $f$
  select $s$select create_class('Neg', null, '00000000-0000-0000-0294-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$s$ $f$;
create function pg_temp.sql_create_old() returns text language sql as $f$
  select $s$select create_class('Neg', null, '00000000-0000-0000-0294-000000000303', 5, 'recurring', null, array[1]::smallint[], '07:00', current_date)$s$ $f$;
create function pg_temp.sql_update_slots() returns text language sql as $f$
  select $s$select update_class('00000000-0000-0000-0294-000000000401', 'Target', null, '00000000-0000-0000-0294-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"07:00"}]'::jsonb)$s$ $f$;
create function pg_temp.sql_update_old() returns text language sql as $f$
  select $s$select update_class('00000000-0000-0000-0294-000000000401', 'Target', null, '00000000-0000-0000-0294-000000000303', 10, 'recurring', null, array[2]::smallint[], '07:00', current_date)$s$ $f$;

set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0294-000000000204', '00000000-0000-0000-0294-0000000000a0', 'receptionist');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a Receptionist cannot cancel a class');
select is(pg_temp.err(pg_temp.sql_create_slots()), 'permission denied', 'a Receptionist cannot create a class with slots');
select is(pg_temp.err(pg_temp.sql_create_old()), 'permission denied', 'a Receptionist cannot create a class (old signature)');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'a Receptionist cannot update a class with slots');
select is(pg_temp.err(pg_temp.sql_update_old()), 'permission denied', 'a Receptionist cannot update a class (old signature)');

select pg_temp.as_role('00000000-0000-0000-0294-000000000203', '00000000-0000-0000-0294-0000000000a0', 'coach');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a Coach cannot cancel a class (not even their own, before Story 29.3)');
select is(pg_temp.err(pg_temp.sql_create_slots()), 'permission denied', 'a Coach cannot create a class with slots');
select is(pg_temp.err(pg_temp.sql_create_old()), 'permission denied', 'a Coach cannot create a class (old signature)');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'a Coach cannot update a class with slots');
select is(pg_temp.err(pg_temp.sql_update_old()), 'permission denied', 'a Coach cannot update a class (old signature)');

select pg_temp.as_role('00000000-0000-0000-0294-000000000205', '00000000-0000-0000-0294-0000000000a0', 'member');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a member cannot cancel a class');
select is(pg_temp.err(pg_temp.sql_create_slots()), 'permission denied', 'a member cannot create a class with slots');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'a member cannot update a class with slots');
select is(pg_temp.err(pg_temp.sql_update_old()), 'permission denied', 'a member cannot update a class (old signature)');

select pg_temp.as_role('00000000-0000-0000-0294-000000000230', '00000000-0000-0000-0294-0000000000a0', 'support');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'GymOS Support gets the uniform denied result from cancel_class');
select is(pg_temp.err(pg_temp.sql_create_slots()), 'permission denied', 'GymOS Support cannot create a class with slots');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'GymOS Support cannot update a class with slots');

select pg_temp.as_role('00000000-0000-0000-0294-000000000206', '00000000-0000-0000-0294-0000000000a0', 'manager');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a deactivated Manager whose token still says manager is refused (the role is read live)');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'and cannot update a class');

select pg_temp.as_role('00000000-0000-0000-0294-000000000204', '00000000-0000-0000-0294-0000000000a0', 'owner');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a Receptionist whose token claims owner is refused (the claim is never read)');
select is(pg_temp.err(pg_temp.sql_update_slots()), 'permission denied', 'and cannot update a class');
reset role;

set local role anon;
select throws_like(pg_temp.sql_cancel(), '%permission denied%', 'anon cannot execute cancel_class');
select throws_like(pg_temp.sql_create_slots(), '%permission denied%', 'anon cannot execute create_class with slots');
select throws_like(pg_temp.sql_update_slots(), '%permission denied%', 'anon cannot execute update_class with slots');
reset role;

-- ============================================================================
-- Another gym's Manager, and a missing class: the same answer, no gym information
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0294-000000000211', '00000000-0000-0000-0294-0000000000b0', 'manager');
select is(
  regexp_replace(pg_temp.err(pg_temp.sql_cancel()), '[0-9a-f]{8}-[0-9a-f-]{27}', 'ID'),
  regexp_replace(pg_temp.err('select cancel_class(gen_random_uuid())'), '[0-9a-f]{8}-[0-9a-f-]{27}', 'ID'),
  'a gym B Manager gets the same message for gym A''s class as for a missing class');
select throws_like(pg_temp.sql_cancel(), 'cancel_class: class % not found', 'the message is the uniform not-found');
select throws_like(pg_temp.sql_update_slots(), 'update_class: class % not found', 'a gym B Manager cannot update gym A''s class (p_slots)');
select throws_like(pg_temp.sql_update_old(), 'update_class: class % not found', 'a gym B Manager cannot update gym A''s class (old signature)');
select throws_like($$select cancel_class(null)$$, 'cancel_class: class % not found', 'a null class id is the same not-found');
select pg_temp.as_role('00000000-0000-0000-0294-000000000212', '00000000-0000-0000-0294-0000000000b0', 'coach');
select is(pg_temp.err(pg_temp.sql_cancel()), 'permission denied', 'a gym B Coach is refused on the role before the class is looked at');
reset role;

-- ============================================================================
-- A suspended gym
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0294-000000000221', '00000000-0000-0000-0294-0000000000e0', 'owner');
select throws_like($$select cancel_class('00000000-0000-0000-0294-000000000421')$$, '%is not active%', 'a suspended gym cannot cancel a class');
select throws_like($$select create_class('Susp', null, '00000000-0000-0000-0294-000000000322', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$,
  '%is not active%', 'a suspended gym cannot create a class with slots');
select throws_like($$select update_class('00000000-0000-0000-0294-000000000421', 'S class', null, '00000000-0000-0000-0294-000000000322', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"07:00"}]'::jsonb)$$,
  '%is not active%', 'a suspended gym cannot update a class with slots');
select throws_like($$select update_class('00000000-0000-0000-0294-000000000421', 'S class', null, '00000000-0000-0000-0294-000000000322', 10, 'recurring', null, array[2]::smallint[], '07:00', current_date)$$,
  '%is not active%', 'a suspended gym cannot update a class (old signature)');
reset role;
select is((select cancelled_at from classes where id = '00000000-0000-0000-0294-000000000421'), null, 'the suspended gym''s class is untouched');

-- ============================================================================
-- Direct writes of classes and class_sessions change nothing for a Receptionist, a Coach and a member
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0294-000000000204', '00000000-0000-0000-0294-0000000000a0', 'receptionist');
select ok(pg_temp.blocked($$update classes set cancelled_at = now(), cancelled_by = '00000000-0000-0000-0294-000000000304' where id = '00000000-0000-0000-0294-000000000401'$$), 'a Receptionist cannot flag a class by a direct update');
select ok(pg_temp.blocked($$update class_sessions set cancelled_at = now() where class_id = '00000000-0000-0000-0294-000000000401'$$), 'a Receptionist cannot flag a session by a direct update');
select ok(pg_temp.blocked($$delete from class_sessions where class_id = '00000000-0000-0000-0294-000000000401'$$), 'a Receptionist cannot delete a session');
select pg_temp.as_role('00000000-0000-0000-0294-000000000203', '00000000-0000-0000-0294-0000000000a0', 'coach');
select ok(pg_temp.blocked($$update classes set cancelled_at = now(), cancelled_by = '00000000-0000-0000-0294-000000000303' where id = '00000000-0000-0000-0294-000000000401'$$), 'a Coach cannot flag a class by a direct update');
select ok(pg_temp.blocked($$update class_sessions set cancelled_at = now() where class_id = '00000000-0000-0000-0294-000000000401'$$), 'a Coach cannot flag a session by a direct update');
select ok(pg_temp.blocked($$insert into classes (gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values ('00000000-0000-0000-0294-0000000000a0', 'Direct', '00000000-0000-0000-0294-000000000303', 5, 'one_off', now() + interval '1 day')$$), 'a Coach cannot insert a class directly');
select pg_temp.as_role('00000000-0000-0000-0294-000000000205', '00000000-0000-0000-0294-0000000000a0', 'member');
select ok(pg_temp.blocked($$update classes set cancelled_at = now() where id = '00000000-0000-0000-0294-000000000401'$$), 'a member cannot flag a class by a direct update');
select ok(pg_temp.blocked($$update class_sessions set cancelled_at = now() where class_id = '00000000-0000-0000-0294-000000000401'$$), 'a member cannot flag a session by a direct update');
select ok(pg_temp.blocked($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0294-000000000401', '00000000-0000-0000-0294-0000000000a0', 6, '10:00')$$), 'a member cannot write a slot');
reset role;

select is((select cancelled_at from classes where id = '00000000-0000-0000-0294-000000000401'), (select class_cancelled_at from target_before), 'after every refusal the target class is not cancelled');
select is((select count(*) from class_sessions where class_id = '00000000-0000-0000-0294-000000000401' and cancelled_at is not null), (select flagged from target_before), 'no session of it was flagged');
select is((select count(*) from class_sessions where class_id = '00000000-0000-0000-0294-000000000401'), (select sessions_n from target_before), 'no session of it was deleted');
select is((select count(*) from audit_log where action_type in ('class_cancelled', 'class_times_changed')), (select audit_n from target_before), 'no audit row was written by a refused call');

-- ============================================================================
-- Guards on the redefined functions: every one still says "is not active" and the new ones read the role live
-- ============================================================================
select ok(
  (select bool_and(p.prosrc like '%is not active%' and p.prosrc ~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''')
   from pg_proc p where p.oid in (
     'public.cancel_class(uuid)'::regprocedure,
     'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
     'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure)),
  'cancel_class and both p_slots overloads carry the suspension guard with the load-bearing phrase');
select ok(
  (select bool_and(p.prosrc like '%private.current_member_role()%' and p.prosrc not like '%request.jwt%' and p.prosrc not like '%app_role%')
   from pg_proc p where p.oid in (
     'public.cancel_class(uuid)'::regprocedure,
     'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
     'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure)),
  'they read the role live through private.current_member_role(), never the claim');
select ok(
  (select bool_and(p.prosrc !~ '(^|\n)\s*--' and p.prosrc !~ '/\*')
   from pg_proc p where p.oid in (
     'public.cancel_class(uuid)'::regprocedure,
     'public.create_class(text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure,
     'public.update_class(uuid, text, text, uuid, integer, text, timestamptz, smallint[], time, date, jsonb)'::regprocedure)),
  'their bodies carry no comments');
select ok(
  not has_function_privilege('anon', 'public.cancel_class(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.cancel_class(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.validate_class_slots(text, jsonb)', 'EXECUTE') and not has_function_privilege('authenticated', 'private.validate_class_slots(text, jsonb)', 'EXECUTE'),
  'cancel_class is for authenticated only and the parser is private');
select ok(not exists (select 1 from private.support_capabilities where object_name in ('cancel_class', 'create_class', 'update_class')), 'none of the three is a support capability');

select * from finish();
rollback;
