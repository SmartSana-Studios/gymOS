-- Story 29.4: the refusals of 0183. Every caller who is not an Owner, Supervisor or Manager of the coach's own gym gets an EMPTY result from every
-- picker function (never an error that reveals state): a Receptionist, a Coach (the chosen coach for themselves, or another coach), a member, a
-- member holding a forged manager claim, a caller with no gym claim, a deactivated Owner, a GymOS Support session (aal2, live assignment: it is
-- not a support capability, FR-251), and anon (no EXECUTE at all). A Manager of gym B who passes a gym A coach id gets nothing from each function.
-- A bad coach id (null, a random uuid, a member, a manager, a deactivated coach, another gym's coach) gives nothing. A member whose assignment
-- ended, a member assigned to another coach and a member of another gym give nothing for that pair. A suspended gym raises "is not active" for its
-- Owner and nothing for a Receptionist. The positive side is coach_picker.test.sql.
-- Fixtures: 00000000-0000-0000-0298-*. Gym A and Gym B active (Douala), Gym S suspended.

begin;
select plan(60);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0298-000000000001', 'Picker Negative Tier', 5000, 50000, 500);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0298-0000000000a0', 'Picker Neg Gym A', '00000000-0000-0000-0298-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0298-0000000000b0', 'Picker Neg Gym B', '00000000-0000-0000-0298-000000000001', 'Africa/Douala');
insert into gyms (id, name, tier_id, timezone, status, saas_billing_status) values
  ('00000000-0000-0000-0298-0000000000c0', 'Picker Neg Gym S', '00000000-0000-0000-0298-000000000001', 'Africa/Douala', 'suspended', 'suspended');

insert into auth.users (id)
select ('00000000-0000-0000-0298-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 260) n;

-- A: owner 201, supervisor 202, manager 203, receptionist 204, coach One 211, coach Two 212, coach Three (deactivated) 213, member M1 (One) 221,
-- member M2 (assignment with One ended) 222, member M3 (Two) 223, member M4 (Three) 224, member forged-claim 225, owner to be deactivated 205.
-- B: manager 231, coach 232, member 233. S: owner 241, receptionist 242, coach 243, member 244. Support person 251.
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0298-000000000301', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000201', 'owner', 'NEG OWNER'),
  ('00000000-0000-0000-0298-000000000302', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000202', 'supervisor', 'NEG SUPERVISOR'),
  ('00000000-0000-0000-0298-000000000303', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000203', 'manager', 'NEG MANAGER'),
  ('00000000-0000-0000-0298-000000000304', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000204', 'receptionist', 'NEG RECEPTIONIST'),
  ('00000000-0000-0000-0298-000000000305', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000205', 'owner', 'NEG SECOND OWNER'),
  ('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000211', 'coach', 'NEG COACH ONE'),
  ('00000000-0000-0000-0298-000000000312', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000212', 'coach', 'NEG COACH TWO'),
  ('00000000-0000-0000-0298-000000000321', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000221', 'member', 'NEG M ONE'),
  ('00000000-0000-0000-0298-000000000322', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000222', 'member', 'NEG M TWO'),
  ('00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000223', 'member', 'NEG M THREE'),
  ('00000000-0000-0000-0298-000000000324', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000224', 'member', 'NEG M FOUR'),
  ('00000000-0000-0000-0298-000000000325', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000225', 'member', 'NEG FORGER'),
  ('00000000-0000-0000-0298-000000000331', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000231', 'manager', 'NEG B MANAGER'),
  ('00000000-0000-0000-0298-000000000332', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000232', 'coach', 'NEG B COACH'),
  ('00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000233', 'member', 'NEG B MEMBER'),
  ('00000000-0000-0000-0298-000000000341', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000241', 'owner', 'NEG S OWNER'),
  ('00000000-0000-0000-0298-000000000342', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000242', 'receptionist', 'NEG S RECEPTIONIST'),
  ('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000243', 'coach', 'NEG S COACH'),
  ('00000000-0000-0000-0298-000000000344', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000244', 'member', 'NEG S MEMBER');
insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0298-000000000313', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000213', 'coach', 'NEG COACH THREE', now() - interval '1 day');

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0298-000000000501', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000321', '00000000-0000-0000-0298-000000000311', now() - interval '30 days', null),
  ('00000000-0000-0000-0298-000000000502', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000322', '00000000-0000-0000-0298-000000000311', now() - interval '30 days', now() - interval '3 days'),
  ('00000000-0000-0000-0298-000000000503', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-000000000312', now() - interval '30 days', null),
  ('00000000-0000-0000-0298-000000000504', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000324', '00000000-0000-0000-0298-000000000313', now() - interval '30 days', null),
  ('00000000-0000-0000-0298-000000000505', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-000000000332', now() - interval '30 days', null),
  ('00000000-0000-0000-0298-000000000506', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000344', '00000000-0000-0000-0298-000000000343', now() - interval '30 days', null);

insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text) values
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000321', '00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000501', 'note M1 by One'),
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000322', '00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000502', 'note M2 by One (ended)'),
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-000000000312', '00000000-0000-0000-0298-000000000503', 'note M3 by Two'),
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000324', '00000000-0000-0000-0298-000000000313', '00000000-0000-0000-0298-000000000504', 'note M4 by Three'),
  ('00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-000000000332', '00000000-0000-0000-0298-000000000505', 'note B by B coach'),
  ('00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000344', '00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000506', 'note S by S coach');

insert into workout_plans (id, gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0298-000000000701', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000321', '00000000-0000-0000-0298-000000000311', 'neg plan M1'),
  ('00000000-0000-0000-0298-000000000702', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000322', '00000000-0000-0000-0298-000000000311', 'neg plan M2'),
  ('00000000-0000-0000-0298-000000000703', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-000000000312', 'neg plan M3'),
  ('00000000-0000-0000-0298-000000000704', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000324', '00000000-0000-0000-0298-000000000313', 'neg plan M4'),
  ('00000000-0000-0000-0298-000000000705', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-000000000332', 'neg plan B'),
  ('00000000-0000-0000-0298-000000000706', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000344', '00000000-0000-0000-0298-000000000343', 'neg plan S');
insert into workout_plan_exercises (gym_id, member_id, plan_id, exercise_id, order_index, sets, reps)
select p.gym_id, p.member_id, p.id, (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10 from workout_plans p
where p.id::text like '00000000-0000-0000-0298-%';

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0298-000000000901', '00000000-0000-0000-0298-0000000000a0', 'NEG CLASS ONE', '00000000-0000-0000-0298-000000000311', 10, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000902', '00000000-0000-0000-0298-0000000000a0', 'NEG CLASS TWO', '00000000-0000-0000-0298-000000000312', 10, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000903', '00000000-0000-0000-0298-0000000000a0', 'NEG CLASS THREE', '00000000-0000-0000-0298-000000000313', 10, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000904', '00000000-0000-0000-0298-0000000000b0', 'NEG CLASS B', '00000000-0000-0000-0298-000000000332', 10, 'one_off', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000905', '00000000-0000-0000-0298-0000000000c0', 'NEG CLASS S', '00000000-0000-0000-0298-000000000343', 10, 'one_off', now() + interval '1 day');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0298-000000000a01', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000901', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000a02', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000902', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000a03', '00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000903', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000a04', '00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000904', now() + interval '1 day'),
  ('00000000-0000-0000-0298-000000000a05', '00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000905', now() + interval '1 day');
insert into class_bookings (gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000a01', '00000000-0000-0000-0298-000000000321'),
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000a02', '00000000-0000-0000-0298-000000000323'),
  ('00000000-0000-0000-0298-0000000000a0', '00000000-0000-0000-0298-000000000a03', '00000000-0000-0000-0298-000000000324'),
  ('00000000-0000-0000-0298-0000000000b0', '00000000-0000-0000-0298-000000000a04', '00000000-0000-0000-0298-000000000333'),
  ('00000000-0000-0000-0298-0000000000c0', '00000000-0000-0000-0298-000000000a05', '00000000-0000-0000-0298-000000000344');

-- a GymOS Support person with a live assignment to gym A (the same fixture as support_capabilities.test.sql)
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0298-000000000251', now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0298-000000000401', '00000000-0000-0000-0298-000000000251', '00000000-0000-0000-0298-0000000000a0', 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0298-0000000000f1', '00000000-0000-0000-0298-000000000251', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0298-0000000000f1', '00000000-0000-0000-0298-000000000251', now(), now());
select private.support_set_membership('00000000-0000-0000-0298-000000000401', true);

create function pg_temp.as_user(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;
grant execute on function pg_temp.err(text) to public;

create function pg_temp.total(c uuid, m uuid, s uuid) returns int language sql stable as $f$
  select (select count(*)::int from public.list_picker_coaches())
       + (select count(*)::int from public.list_coach_classes(c))
       + (select count(*)::int from public.list_coach_class_session_roster(c, s))
       + (select count(*)::int from public.list_coach_assigned_members(c))
       + (select count(*)::int from public.get_coach_assigned_member(c, m))
       + (select count(*)::int from public.list_coach_member_session_notes(c, m))
       + (select count(*)::int from public.get_coach_member_workout_plan(c, m))
$f$;
grant execute on function pg_temp.total(uuid, uuid, uuid) to public;

-- the real ids of gym A: coach One, member M1 (assigned to One), session of One's class
select set_config('t.c1', '00000000-0000-0000-0298-000000000311', false);
select set_config('t.m1', '00000000-0000-0000-0298-000000000321', false);
select set_config('t.s1', '00000000-0000-0000-0298-000000000a01', false);

-- ============================================================================
-- Positive control: an Owner of gym A reads something from the same ids, so every empty result below means a refusal
-- ============================================================================

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000201', '00000000-0000-0000-0298-0000000000a0', 'owner');
select cmp_ok(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), '>=', 8,
  'positive control: the Owner reads rows from all seven functions with these ids');
reset role;

-- ============================================================================
-- Every caller who is not Owner, Supervisor or Manager of the gym: empty from every function, no error
-- ============================================================================

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000204', '00000000-0000-0000-0298-0000000000a0', 'receptionist');
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a Receptionist gets nothing from any picker function');
select pg_temp.as_user('00000000-0000-0000-0298-000000000211', '00000000-0000-0000-0298-0000000000a0', 'coach');
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'the chosen Coach calling the picker for themselves gets nothing');
select is(pg_temp.total('00000000-0000-0000-0298-000000000312', '00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-000000000a02'), 0, 'a Coach asking for another coach gets nothing');
select pg_temp.as_user('00000000-0000-0000-0298-000000000221', '00000000-0000-0000-0298-0000000000a0', 'member');
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a member gets nothing');
select pg_temp.as_user('00000000-0000-0000-0298-000000000225', '00000000-0000-0000-0298-0000000000a0', 'manager');
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a member holding a forged manager claim gets nothing (the live role is member)');
select pg_temp.as_user('00000000-0000-0000-0298-000000000203', '', 'manager');
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a Manager with an empty gym claim gets nothing');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0298-000000000203', 'role', 'authenticated')::text, true);
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a Manager with no gym claim at all gets nothing');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0298-000000000203', 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0298-0000000000b0', 'app_role', 'manager')::text, true);
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a Manager of gym A with a forged gym B claim gets nothing (the claim must match a live membership)');
reset role;

-- GymOS Support: aal2, live assignment to gym A. Not a support capability: every function is empty (private.gym_id() is null for a support row).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0298-000000000251', 'role', 'authenticated', 'aal', 'aal2',
  'session_id', '00000000-0000-0000-0298-0000000000f1', 'app_role', 'support', 'gym_id', '00000000-0000-0000-0298-0000000000a0')::text, true);
select is(pg_temp.total(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid), 0, 'a GymOS Support session (aal2, live assignment) gets nothing from any picker function');
select is(pg_temp.err($$ select * from list_picker_coaches() $$), 'no error', 'and no error that reveals why');
reset role;
select is((select count(*)::int from private.support_capabilities where object_name ~ '^(list_coach_|get_coach_|list_picker_)'), 0, 'no picker function is registered as a support capability');

-- anon has no EXECUTE at all
set local role anon;
select is(pg_temp.err($$ select * from list_picker_coaches() $$), '42501:permission denied for function list_picker_coaches', 'anon is refused list_picker_coaches');
select is(pg_temp.err($$ select * from list_coach_classes('00000000-0000-0000-0298-000000000311') $$), '42501:permission denied for function list_coach_classes', 'anon is refused list_coach_classes');
select is(pg_temp.err($$ select * from list_coach_class_session_roster('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000a01') $$), '42501:permission denied for function list_coach_class_session_roster', 'anon is refused list_coach_class_session_roster');
select is(pg_temp.err($$ select * from list_coach_assigned_members('00000000-0000-0000-0298-000000000311') $$), '42501:permission denied for function list_coach_assigned_members', 'anon is refused list_coach_assigned_members');
select is(pg_temp.err($$ select * from get_coach_assigned_member('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000321') $$), '42501:permission denied for function get_coach_assigned_member', 'anon is refused get_coach_assigned_member');
select is(pg_temp.err($$ select * from list_coach_member_session_notes('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000321') $$), '42501:permission denied for function list_coach_member_session_notes', 'anon is refused list_coach_member_session_notes');
select is(pg_temp.err($$ select * from get_coach_member_workout_plan('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000321') $$), '42501:permission denied for function get_coach_member_workout_plan', 'anon is refused get_coach_member_workout_plan');
reset role;

-- ============================================================================
-- Cross-gym: the Manager of gym B passes a gym A coach, member and session, one assertion per function
-- ============================================================================

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000231', '00000000-0000-0000-0298-0000000000b0', 'manager');
select is((select count(*)::int from list_picker_coaches() where coach_id = current_setting('t.c1')::uuid), 0, 'cross-gym: list_picker_coaches lists no gym A coach');
select is((select count(*)::int from list_picker_coaches()), 1, 'cross-gym: list_picker_coaches lists gym B''s own coach (positive control)');
select is((select count(*)::int from list_coach_classes(current_setting('t.c1')::uuid)), 0, 'cross-gym: list_coach_classes is empty for a gym A coach');
select is((select count(*)::int from list_coach_class_session_roster(current_setting('t.c1')::uuid, current_setting('t.s1')::uuid)), 0, 'cross-gym: list_coach_class_session_roster is empty for a gym A coach and session');
select is((select count(*)::int from list_coach_class_session_roster('00000000-0000-0000-0298-000000000332', current_setting('t.s1')::uuid)), 0, 'cross-gym: gym B''s own coach with a gym A session is empty');
select is((select count(*)::int from list_coach_assigned_members(current_setting('t.c1')::uuid)), 0, 'cross-gym: list_coach_assigned_members is empty for a gym A coach');
select is((select count(*)::int from get_coach_assigned_member(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)), 0, 'cross-gym: get_coach_assigned_member is empty for a gym A coach and member');
select is((select count(*)::int from get_coach_assigned_member('00000000-0000-0000-0298-000000000332', current_setting('t.m1')::uuid)), 0, 'cross-gym: gym B''s own coach with a gym A member is empty');
select is((select count(*)::int from list_coach_member_session_notes(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)), 0, 'cross-gym: list_coach_member_session_notes is empty for a gym A coach and member');
select is((select count(*)::int from get_coach_member_workout_plan(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)), 0, 'cross-gym: get_coach_member_workout_plan is empty for a gym A coach and member');
select is(pg_temp.total('00000000-0000-0000-0298-000000000332', '00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-000000000a04'), 7,
  'positive control: gym B''s Manager reads gym B''s own coach, member, notes, plan, class and roster');
reset role;

-- ============================================================================
-- A bad coach id, for a Manager of gym A
-- ============================================================================

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000203', '00000000-0000-0000-0298-0000000000a0', 'manager');
select is(pg_temp.total(null, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid) - (select count(*)::int from list_picker_coaches()), 0, 'a null coach id gives nothing from the six coach functions');
select is(pg_temp.total(gen_random_uuid(), current_setting('t.m1')::uuid, current_setting('t.s1')::uuid) - (select count(*)::int from list_picker_coaches()), 0, 'a random uuid as coach gives nothing');
select is(pg_temp.total(current_setting('t.m1')::uuid, current_setting('t.m1')::uuid, current_setting('t.s1')::uuid) - (select count(*)::int from list_picker_coaches()), 0, 'a member id as coach gives nothing');
select is(pg_temp.total('00000000-0000-0000-0298-000000000303', current_setting('t.m1')::uuid, current_setting('t.s1')::uuid) - (select count(*)::int from list_picker_coaches()), 0, 'a manager id as coach gives nothing');
select is(pg_temp.total('00000000-0000-0000-0298-000000000313', '00000000-0000-0000-0298-000000000324', '00000000-0000-0000-0298-000000000a03') - (select count(*)::int from list_picker_coaches()), 0,
  'a deactivated coach gives nothing from the six coach functions (classes, roster, members, header, notes, plan), although each has an active assignment, a note, a plan and a class');
select is(pg_temp.total('00000000-0000-0000-0298-000000000332', '00000000-0000-0000-0298-000000000333', '00000000-0000-0000-0298-000000000a04') - (select count(*)::int from list_picker_coaches()), 0,
  'another gym''s coach gives nothing, even with that gym''s own member and session');
select is((select count(*)::int from list_picker_coaches() where coach_id = '00000000-0000-0000-0298-000000000313' and not is_active), 1,
  'the deactivated coach is listed by list_picker_coaches as not active, for the "no longer a coach" state');

-- ============================================================================
-- The member-scoped functions: the assignment must be current and to THAT coach
-- ============================================================================

select is((select count(*)::int from get_coach_assigned_member(current_setting('t.c1')::uuid, '00000000-0000-0000-0298-000000000322')), 0, 'M2 (assignment ended): no header');
select is((select count(*)::int from list_coach_member_session_notes(current_setting('t.c1')::uuid, '00000000-0000-0000-0298-000000000322')), 0, 'M2 (assignment ended): no note, although Coach One wrote one');
select is((select count(*)::int from get_coach_member_workout_plan(current_setting('t.c1')::uuid, '00000000-0000-0000-0298-000000000322')), 0, 'M2 (assignment ended): no plan, although Coach One wrote one');
select is((select count(*)::int from list_coach_assigned_members(current_setting('t.c1')::uuid) where member_id = '00000000-0000-0000-0298-000000000322'), 0, 'M2 (assignment ended): not in Coach One''s list');
select is((select count(*)::int from get_coach_assigned_member('00000000-0000-0000-0298-000000000312', current_setting('t.m1')::uuid)), 0, 'M1 is Coach One''s: Coach Two''s id gives no header');
select is((select count(*)::int from list_coach_member_session_notes('00000000-0000-0000-0298-000000000312', current_setting('t.m1')::uuid)), 0, 'M1 asked with Coach Two: no note');
select is((select count(*)::int from get_coach_member_workout_plan('00000000-0000-0000-0298-000000000312', current_setting('t.m1')::uuid)), 0, 'M1 asked with Coach Two: no plan');
select is((select count(*)::int from get_coach_assigned_member(current_setting('t.c1')::uuid, null)), 0, 'a null member id: no header');
select is((select count(*)::int from list_coach_member_session_notes(current_setting('t.c1')::uuid, gen_random_uuid())), 0, 'a random member id: no note');
select is((select count(*)::int from get_coach_member_workout_plan(current_setting('t.c1')::uuid, '00000000-0000-0000-0298-000000000333')), 0, 'another gym''s member: no plan');
select is((select count(*)::int from list_coach_class_session_roster(current_setting('t.c1')::uuid, '00000000-0000-0000-0298-000000000a02')), 0, 'a session of Coach Two''s class asked with Coach One: no roster');
select is((select count(*)::int from list_coach_class_session_roster(current_setting('t.c1')::uuid, null)), 0, 'a null session id: no roster');
reset role;

-- an ended assignment drops the member on the next call (the assignment is read live)
select set_config('request.jwt.claims', '', true);
update coach_assignments set ended_at = now() where id = '00000000-0000-0000-0298-000000000501';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000203', '00000000-0000-0000-0298-0000000000a0', 'manager');
select is((select count(*)::int from get_coach_assigned_member(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)) + (select count(*)::int from list_coach_member_session_notes(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)) + (select count(*)::int from get_coach_member_workout_plan(current_setting('t.c1')::uuid, current_setting('t.m1')::uuid)), 0, 'M1''s assignment ended a moment ago: no header, note or plan on the next call (the coach has no class session here either)');
reset role;

-- ============================================================================
-- A deactivated Owner and a demoted Manager lose the picker on the next call (the gate is live, never the claim)
-- ============================================================================

select set_config('request.jwt.claims', '', true);
update members set deactivated_at = now() where id = '00000000-0000-0000-0298-000000000305';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000205', '00000000-0000-0000-0298-0000000000a0', 'owner');
select is(pg_temp.total('00000000-0000-0000-0298-000000000311', '00000000-0000-0000-0298-000000000321', '00000000-0000-0000-0298-000000000a01'), 0, 'a deactivated Owner gets nothing');
reset role;
select set_config('request.jwt.claims', '', true);
update members set role = 'coach' where id = '00000000-0000-0000-0298-000000000303';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000203', '00000000-0000-0000-0298-0000000000a0', 'manager');
select is(pg_temp.total('00000000-0000-0000-0298-000000000312', '00000000-0000-0000-0298-000000000323', '00000000-0000-0000-0298-000000000a02'), 0, 'a Manager changed to Coach in the database, with a stale manager token, gets nothing');
reset role;
select set_config('request.jwt.claims', '', true);
update members set role = 'manager' where id = '00000000-0000-0000-0298-000000000303';

-- ============================================================================
-- A suspended gym: the Owner gets the standard raise from every function, a Receptionist gets nothing (the role gate is first)
-- ============================================================================

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0298-000000000241', '00000000-0000-0000-0298-0000000000c0', 'owner');
select is(pg_temp.err($$ select * from list_picker_coaches() $$), 'P0001:list_picker_coaches: gym 00000000-0000-0000-0298-0000000000c0 is not active', 'a suspended gym: list_picker_coaches raises "is not active"');
select alike(pg_temp.err($$ select * from list_coach_classes('00000000-0000-0000-0298-000000000343') $$), '%is not active', 'a suspended gym: list_coach_classes raises "is not active"');
select alike(pg_temp.err($$ select * from list_coach_class_session_roster('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000a05') $$), '%is not active', 'a suspended gym: list_coach_class_session_roster raises "is not active"');
select alike(pg_temp.err($$ select * from list_coach_assigned_members('00000000-0000-0000-0298-000000000343') $$), '%is not active', 'a suspended gym: list_coach_assigned_members raises "is not active"');
select alike(pg_temp.err($$ select * from get_coach_assigned_member('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000344') $$), '%is not active', 'a suspended gym: get_coach_assigned_member raises "is not active"');
select alike(pg_temp.err($$ select * from list_coach_member_session_notes('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000344') $$), '%is not active', 'a suspended gym: list_coach_member_session_notes raises "is not active"');
select alike(pg_temp.err($$ select * from get_coach_member_workout_plan('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000344') $$), '%is not active', 'a suspended gym: get_coach_member_workout_plan raises "is not active"');
select pg_temp.as_user('00000000-0000-0000-0298-000000000242', '00000000-0000-0000-0298-0000000000c0', 'receptionist');
select is(pg_temp.total('00000000-0000-0000-0298-000000000343', '00000000-0000-0000-0298-000000000344', '00000000-0000-0000-0298-000000000a05'), 0,
  'a Receptionist at a suspended gym gets the empty result, not the raise (the role gate sits below caller resolution and above the status guard)');
reset role;

select * from finish();
rollback;
