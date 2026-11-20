-- Story 29.3: the refusals of 0182. A Coach reaches create_class, update_class and cancel_class only for their OWN classes: creating for another
-- coach or a manager, editing or cancelling another coach's class, reassigning an own class, adopting another coach's class, another gym's class
-- and a missing class (one message for all three), a deactivated Coach, a Coach whose role changed, a suspended gym, a Receptionist and a member;
-- the cap and duplicate refusals are the Manager's; direct table writes change nothing. The positive side is coach_own_classes.test.sql.
-- Fixtures: 00000000-0000-0000-0296-*. Gym A and B active (Douala), S suspended.

begin;
select plan(79);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0296-000000000001', 'Coach Own Neg Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0296-0000000000a0', 'Coach Neg Gym A', '00000000-0000-0000-0296-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0296-0000000000b0', 'Coach Neg Gym B', '00000000-0000-0000-0296-000000000001', 'Africa/Douala');
insert into gyms (id, name, tier_id, timezone, status, saas_billing_status) values
  ('00000000-0000-0000-0296-0000000000e0', 'Coach Neg Gym S', '00000000-0000-0000-0296-000000000001', 'Africa/Douala', 'suspended', 'suspended');

insert into auth.users (id)
select ('00000000-0000-0000-0296-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 230) n;

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0296-000000000302', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000202', 'manager', 'Coach Neg A Manager', null),
  ('00000000-0000-0000-0296-000000000303', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000203', 'coach', 'Coach Neg A Coach One', null),
  ('00000000-0000-0000-0296-000000000307', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000207', 'coach', 'Coach Neg A Coach Two', null),
  ('00000000-0000-0000-0296-000000000304', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000204', 'receptionist', 'Coach Neg A Receptionist', null),
  ('00000000-0000-0000-0296-000000000305', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000205', 'member', 'Coach Neg A Member', null),
  ('00000000-0000-0000-0296-000000000306', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000206', 'coach', 'Coach Neg A Deactivated Coach', now() - interval '1 day'),
  ('00000000-0000-0000-0296-000000000308', '00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000208', 'coach', 'Coach Neg A Demoted Coach', null),
  ('00000000-0000-0000-0296-000000000312', '00000000-0000-0000-0296-0000000000b0', '00000000-0000-0000-0296-000000000212', 'coach', 'Coach Neg B Coach', null),
  ('00000000-0000-0000-0296-000000000322', '00000000-0000-0000-0296-0000000000e0', '00000000-0000-0000-0296-000000000222', 'coach', 'Coach Neg S Coach', null);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0296-000000000401', '00000000-0000-0000-0296-0000000000a0', 'One class', '00000000-0000-0000-0296-000000000303', 10, 'recurring', '{1,3}', '18:00', current_date),
  ('00000000-0000-0000-0296-000000000402', '00000000-0000-0000-0296-0000000000a0', 'Two class', '00000000-0000-0000-0296-000000000307', 10, 'recurring', '{2}', '09:00', current_date),
  ('00000000-0000-0000-0296-000000000403', '00000000-0000-0000-0296-0000000000a0', 'Two cancelled', '00000000-0000-0000-0296-000000000307', 10, 'recurring', '{4}', '09:00', current_date),
  ('00000000-0000-0000-0296-000000000404', '00000000-0000-0000-0296-0000000000a0', 'One cancelled', '00000000-0000-0000-0296-000000000303', 10, 'recurring', '{5}', '09:00', current_date),
  ('00000000-0000-0000-0296-000000000411', '00000000-0000-0000-0296-0000000000b0', 'Gym B class', '00000000-0000-0000-0296-000000000312', 10, 'recurring', '{3}', '10:00', current_date),
  ('00000000-0000-0000-0296-000000000421', '00000000-0000-0000-0296-0000000000e0', 'S class', '00000000-0000-0000-0296-000000000322', 10, 'recurring', '{3}', '10:00', current_date),
  ('00000000-0000-0000-0296-000000000431', '00000000-0000-0000-0296-0000000000a0', 'Demoted class', '00000000-0000-0000-0296-000000000308', 10, 'recurring', '{6}', '10:00', current_date);
select private.materialize_sessions_for_class(id) from classes where gym_id in ('00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-0000000000b0', '00000000-0000-0000-0296-0000000000e0');
update classes set cancelled_at = now(), cancelled_by = '00000000-0000-0000-0296-000000000302' where id in ('00000000-0000-0000-0296-000000000403', '00000000-0000-0000-0296-000000000404');
update class_sessions set cancelled_at = now() where class_id in ('00000000-0000-0000-0296-000000000403', '00000000-0000-0000-0296-000000000404') and scheduled_at > now();
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0296-0000000000a0', id, '00000000-0000-0000-0296-000000000305' from class_sessions
where class_id = '00000000-0000-0000-0296-000000000402' and scheduled_at > now() order by scheduled_at limit 1;
select set_config('test.two_session', (select id::text from class_sessions where class_id = '00000000-0000-0000-0296-000000000402' and scheduled_at > now() order by scheduled_at limit 1), false);
select set_config('test.two_booking', (select id::text from class_bookings where class_session_id = current_setting('test.two_session')::uuid limit 1), false);

create function pg_temp.as_role(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.coach1() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0296-000000000203', '00000000-0000-0000-0296-0000000000a0', 'coach') $f$;
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
create function pg_temp.slots_of(p_class text) returns text language sql as $f$
  select coalesce(string_agg(weekday || '@' || to_char(start_time, 'HH24:MI'), ',' order by weekday, start_time), '') from class_schedule_slots where class_id = p_class::uuid
$f$;

create temp table snapshot as
select (select count(*) from classes) as classes_n,
       (select count(*) from class_sessions) as sessions_n,
       (select count(*) from class_schedule_slots) as slots_n,
       (select count(*) from class_bookings) as bookings_n,
       (select count(*) from classes where cancelled_at is not null) as cancelled_n,
       (select count(*) from audit_log where action_type in ('class_cancelled', 'class_times_changed')) as audit_n,
       (select string_agg(id::text || coach_id::text || name || coalesce(cancelled_at::text, ''), ',' order by id) from classes) as class_state;

create function pg_temp.unchanged() returns boolean language sql as $f$
  select (select count(*) from classes) = s.classes_n
     and (select count(*) from class_sessions) = s.sessions_n
     and (select count(*) from class_schedule_slots) = s.slots_n
     and (select count(*) from class_bookings) = s.bookings_n
     and (select count(*) from classes where cancelled_at is not null) = s.cancelled_n
     and (select count(*) from audit_log where action_type in ('class_cancelled', 'class_times_changed')) = s.audit_n
     and (select string_agg(id::text || coach_id::text || name || coalesce(cancelled_at::text, ''), ',' order by id) from classes) = s.class_state
  from snapshot s
$f$;

-- ============================================================================
-- Coach One against everything that is not theirs
-- ============================================================================
set local role authenticated;
select pg_temp.coach1();

select is(pg_temp.err($$select create_class('For two', null, '00000000-0000-0000-0296-000000000307', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'a Coach cannot create a class for another coach');
select is(pg_temp.err($$select create_class('For mgr', null, '00000000-0000-0000-0296-000000000302', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'a Coach cannot create a class naming a manager''s member id');
select is(pg_temp.err($$select create_class('For member', null, '00000000-0000-0000-0296-000000000305', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'a Coach cannot create a class naming a member');
select is(pg_temp.err($$select create_class('For ghost', null, gen_random_uuid(), 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'nor an id that is nobody');
select is(pg_temp.err($$select create_class('For gym B coach', null, '00000000-0000-0000-0296-000000000312', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'nor another gym''s coach');
select is(pg_temp.err($$select create_class('One-off for two', null, '00000000-0000-0000-0296-000000000307', 5, 'one_off', now() + interval '2 days', null, null, null, null)$$),
  'create_class: coaches can only manage their own classes', 'a one-off class for another coach is refused too');

select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000402', 'Two class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"11:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'a Coach cannot edit another coach''s class (no coach id)');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000402', 'Two class', null, '00000000-0000-0000-0296-000000000307', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"11:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'nor with that coach''s id');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000402', 'Taken', null, '00000000-0000-0000-0296-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"09:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'nor adopt it by naming themselves as its coach');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000402')$$),
  'cancel_class: coaches can only manage their own classes', 'a Coach cannot cancel another coach''s class');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, '00000000-0000-0000-0296-000000000307', 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"},{"weekday":3,"start_time":"18:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'a Coach cannot reassign their own class to another coach');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, '00000000-0000-0000-0296-000000000302', 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"},{"weekday":3,"start_time":"18:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'nor to a manager');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, gen_random_uuid(), 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"},{"weekday":3,"start_time":"18:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'nor to an id that is nobody');

select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000411', 'Gym B class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":3,"start_time":"11:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'another gym''s class gets the same message on update');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000411')$$),
  'cancel_class: coaches can only manage their own classes', 'and on cancel');
select is(pg_temp.err($$select update_class(gen_random_uuid(), 'Missing', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":3,"start_time":"11:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'a missing class gets that message on update');
select is(pg_temp.err($$select cancel_class(gen_random_uuid())$$),
  'cancel_class: coaches can only manage their own classes', 'and on cancel');
select is(pg_temp.err($$select cancel_class(null)$$),
  'cancel_class: coaches can only manage their own classes', 'a null class id too');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000403')$$),
  'cancel_class: coaches can only manage their own classes', 'another coach''s already-cancelled class does not say it is cancelled');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000403', 'x', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"09:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'nor on update');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000404')$$),
  'cancel_class: class 00000000-0000-0000-0296-000000000404 is already cancelled', 'the Coach''s own already-cancelled class says so');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000404', 'x', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":5,"start_time":"09:00"}]'::jsonb)$$),
  'update_class: class 00000000-0000-0000-0296-000000000404 is already cancelled', 'and on update');

select is((select count(*)::int from list_my_class_session_roster(current_setting('test.two_session')::uuid)), 0, 'the roster of another coach''s session is empty');
select is(pg_temp.err(format($$select mark_class_attendance(%L)$$, current_setting('test.two_booking'))), 'mark_class_attendance: permission denied', 'a Coach still cannot mark attendance');
select is((select count(*)::int from class_bookings), 0, 'a Coach reads no class booking');
reset role;

select ok(pg_temp.unchanged(), 'after every refusal no class, session, slot, booking, cancel flag or audit row changed');
select is(pg_temp.slots_of('00000000-0000-0000-0296-000000000402'), '2@09:00', 'the other coach''s slots are as they were');

-- ============================================================================
-- Another gym's Coach: the same message for the same two classes
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0296-000000000212', '00000000-0000-0000-0296-0000000000b0', 'coach');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000401')$$), 'cancel_class: coaches can only manage their own classes', 'a gym B Coach cancelling a gym A class');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"}]'::jsonb)$$),
  'update_class: coaches can only manage their own classes', 'a gym B Coach editing a gym A class');
select is(pg_temp.err($$select create_class('X', null, '00000000-0000-0000-0296-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: coaches can only manage their own classes', 'a gym B Coach creating for a gym A coach');
reset role;
select ok(pg_temp.unchanged(), 'nothing changed');

-- ============================================================================
-- Receptionist, member, deactivated Coach, Coach whose role changed (the role is read live)
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0296-000000000204', '00000000-0000-0000-0296-0000000000a0', 'receptionist');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000401')$$), 'permission denied', 'a Receptionist cannot cancel');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, '00000000-0000-0000-0296-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"}]'::jsonb)$$), 'permission denied', 'cannot update');
select is(pg_temp.err($$select create_class('X', null, '00000000-0000-0000-0296-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$), 'permission denied', 'cannot create');
select pg_temp.as_role('00000000-0000-0000-0296-000000000205', '00000000-0000-0000-0296-0000000000a0', 'member');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000401')$$), 'permission denied', 'a member cannot cancel');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, '00000000-0000-0000-0296-000000000303', 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"}]'::jsonb)$$), 'permission denied', 'cannot update');
select is(pg_temp.err($$select create_class('X', null, '00000000-0000-0000-0296-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$), 'permission denied', 'cannot create');
select pg_temp.as_role('00000000-0000-0000-0296-000000000205', '00000000-0000-0000-0296-0000000000a0', 'coach');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000401')$$), 'permission denied', 'a member whose token claims coach is refused (the claim is never read)');
select pg_temp.as_role('00000000-0000-0000-0296-000000000206', '00000000-0000-0000-0296-0000000000a0', 'coach');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000401')$$), 'permission denied', 'a deactivated Coach with a valid token cannot cancel');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"18:00"}]'::jsonb)$$), 'permission denied', 'cannot update');
select is(pg_temp.err($$select create_class('X', null, null, 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$), 'permission denied', 'cannot create');
reset role;

update members set role = 'receptionist' where id = '00000000-0000-0000-0296-000000000308';
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0296-000000000208', '00000000-0000-0000-0296-0000000000a0', 'coach');
select is(pg_temp.err($$select cancel_class('00000000-0000-0000-0296-000000000431')$$), 'permission denied', 'a Coach moved to Receptionist, token still coach, cannot cancel their former class');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000431', 'Demoted class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":6,"start_time":"10:00"}]'::jsonb)$$), 'permission denied', 'cannot update it');
select is(pg_temp.err($$select create_class('X', null, null, 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$), 'permission denied', 'cannot create');
reset role;
select ok(pg_temp.unchanged(), 'nothing changed for any of them');

-- ============================================================================
-- The predicate itself: gym, role, deactivation and a null id
-- ============================================================================
set local role authenticated;
select pg_temp.coach1();
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0296-000000000203', 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0296-0000000000a0', 'app_role', 'coach')::text, true);
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000303'), true, 'the predicate is true for the caller''s own live coach row');
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000307'), false, 'false for another coach');
select is(private.is_live_own_coach(null), false, 'false for null');
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000302'), false, 'false for a manager''s row');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0296-000000000206', 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0296-0000000000a0', 'app_role', 'coach')::text, true);
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000306'), false, 'false for the caller''s own deactivated row (is_own_coach_id alone would say true)');
select is(private.is_own_coach_id('00000000-0000-0000-0296-000000000306'), true, 'and is_own_coach_id alone does say true, which is why the predicate exists');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0296-000000000208', 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0296-0000000000a0', 'app_role', 'coach')::text, true);
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000308'), false, 'false for the caller''s own row once its role is not coach');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0296-000000000203', 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0296-0000000000b0', 'app_role', 'coach')::text, true);
select is(private.is_live_own_coach('00000000-0000-0000-0296-000000000303'), false, 'false when the caller''s gym is not the row''s gym');

-- ============================================================================
-- A suspended gym
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0296-000000000222', '00000000-0000-0000-0296-0000000000e0', 'coach');
select throws_like($$select cancel_class('00000000-0000-0000-0296-000000000421')$$, '%is not active%', 'a suspended gym''s Coach cannot cancel');
select throws_like($$select create_class('Susp', null, null, 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"}]'::jsonb)$$, '%is not active%', 'nor create');
select throws_like($$select update_class('00000000-0000-0000-0296-000000000421', 'S class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"07:00"}]'::jsonb)$$, '%is not active%', 'nor update');
reset role;

-- ============================================================================
-- The cap and the duplicate refusal are the Manager's, for a Coach
-- ============================================================================
create function pg_temp.slots14(p_extra boolean) returns text language sql as $f$
  select '[' || string_agg(format('{"weekday":%s,"start_time":"%s"}', d, t), ',') || ']'
  from (select d, t from generate_series(0, 6) d cross join (values ('06:00'), ('08:00')) v(t) union all select 0, '23:00' where p_extra) x
$f$;
set local role authenticated;
select pg_temp.coach1();
select is(pg_temp.err(format($$select create_class('Fifteen', null, null, 5, 'recurring', null, null, null, current_date, %L::jsonb)$$, pg_temp.slots14(true))),
  'create_class: a class can have at most 14 weekly times', 'a Coach creating with 15 weekly times gets the cap refusal');
select is(pg_temp.err($$select create_class('Dup', null, null, 5, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"},{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'create_class: the same weekday and time appears twice in the weekly times', 'a duplicate time gets the duplicate refusal');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, null, 10, 'recurring', null, null, null, current_date, '[{"weekday":1,"start_time":"07:00"},{"weekday":1,"start_time":"07:00"}]'::jsonb)$$),
  'update_class: the same weekday and time appears twice in the weekly times', 'and on update');
select is(pg_temp.err(format($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, null, 10, 'recurring', null, null, null, current_date, %L::jsonb)$$, pg_temp.slots14(true))),
  'update_class: a class can have at most 14 weekly times', 'and the cap on update');
select is(pg_temp.err($$select create_class('None', null, null, 5, 'recurring', null, null, null, current_date, '[]'::jsonb)$$),
  'create_class: a recurring class needs at least one weekly time', 'none is refused as for a Manager');
select lives_ok(format($$select create_class('Fourteen', null, null, 5, 'recurring', null, null, null, current_date, %L::jsonb)$$, pg_temp.slots14(false)), 'fourteen weekly times are accepted');
select pg_temp.as_role('00000000-0000-0000-0296-000000000202', '00000000-0000-0000-0296-0000000000a0', 'manager');
select is(pg_temp.err(format($$select create_class('Fifteen mgr', null, null, 5, 'recurring', null, null, null, current_date, %L::jsonb)$$, pg_temp.slots14(true))),
  'create_class: a class can have at most 14 weekly times', 'a Manager gets the same text');
select is(pg_temp.err($$select create_class('Old sig', null, '00000000-0000-0000-0296-000000000303', 5, 'recurring', null, array[1]::smallint[], '07:00', current_date)$$), 'no error', 'the old 9-argument create_class still works for a Manager');
select pg_temp.coach1();
select is(pg_temp.err($$select create_class('Old sig', null, '00000000-0000-0000-0296-000000000303', 5, 'recurring', null, array[1]::smallint[], '07:00', current_date)$$), 'permission denied', 'and stays refused for a Coach');
select is(pg_temp.err($$select update_class('00000000-0000-0000-0296-000000000401', 'One class', null, '00000000-0000-0000-0296-000000000303', 10, 'recurring', null, array[2]::smallint[], '07:00', current_date)$$), 'permission denied', 'the old 10-argument update_class stays refused for a Coach');
reset role;

-- ============================================================================
-- Direct table writes stay refused for a Coach, on each of the four tables
-- ============================================================================
create temp table writes_before as
select (select count(*) from classes) c, (select count(*) from class_sessions) s, (select count(*) from class_schedule_slots) sl, (select count(*) from class_bookings) b,
       (select string_agg(id::text || name || capacity::text || coach_id::text, ',' order by id) from classes where gym_id = '00000000-0000-0000-0296-0000000000a0') cstate;
set local role authenticated;
select pg_temp.coach1();
select ok(pg_temp.blocked($$insert into classes (gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values ('00000000-0000-0000-0296-0000000000a0', 'Direct', '00000000-0000-0000-0296-000000000303', 5, 'one_off', now() + interval '1 day')$$), 'a Coach cannot insert into classes');
select ok(pg_temp.blocked($$update classes set name = 'Hacked', capacity = 99 where id = '00000000-0000-0000-0296-000000000401'$$), 'cannot update classes, even their own');
select ok(pg_temp.blocked($$delete from classes where id = '00000000-0000-0000-0296-000000000401'$$), 'cannot delete from classes');
select ok(pg_temp.blocked($$insert into class_sessions (gym_id, class_id, scheduled_at) values ('00000000-0000-0000-0296-0000000000a0', '00000000-0000-0000-0296-000000000401', now() + interval '9 days')$$), 'cannot insert into class_sessions');
select ok(pg_temp.blocked($$update class_sessions set scheduled_at = scheduled_at + interval '1 hour' where class_id = '00000000-0000-0000-0296-000000000401'$$), 'cannot update class_sessions');
select ok(pg_temp.blocked($$delete from class_sessions where class_id = '00000000-0000-0000-0296-000000000401'$$), 'cannot delete from class_sessions');
select ok(pg_temp.blocked($$insert into class_schedule_slots (class_id, gym_id, weekday, start_time) values ('00000000-0000-0000-0296-000000000401', '00000000-0000-0000-0296-0000000000a0', 6, '10:00')$$), 'cannot insert into class_schedule_slots');
select ok(pg_temp.blocked($$update class_schedule_slots set start_time = '05:00' where class_id = '00000000-0000-0000-0296-000000000401'$$), 'cannot update class_schedule_slots');
select ok(pg_temp.blocked($$delete from class_schedule_slots where class_id = '00000000-0000-0000-0296-000000000401'$$), 'cannot delete from class_schedule_slots');
select ok(pg_temp.blocked(format($$insert into class_bookings (gym_id, class_session_id, member_id) values ('00000000-0000-0000-0296-0000000000a0', %L, '00000000-0000-0000-0296-000000000305')$$, current_setting('test.two_session'))), 'cannot insert into class_bookings');
select ok(pg_temp.blocked($$update class_bookings set attended_at = now()$$), 'cannot update class_bookings');
select ok(pg_temp.blocked($$delete from class_bookings$$), 'cannot delete from class_bookings');
reset role;
select ok(
  (select (select count(*) from classes) = w.c and (select count(*) from class_sessions) = w.s and (select count(*) from class_schedule_slots) = w.sl
      and (select count(*) from class_bookings) = w.b
      and (select string_agg(id::text || name || capacity::text || coach_id::text, ',' order by id) from classes where gym_id = '00000000-0000-0000-0296-0000000000a0') = w.cstate
   from writes_before w),
  'every direct write left the four tables as they were');

select * from finish();
rollback;
