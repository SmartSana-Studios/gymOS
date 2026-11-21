-- Story 29.4: the coach picker reads of 0183 -- the positive side. Seven STABLE SECURITY DEFINER functions with the coach as a parameter, read by an
-- Owner, a Supervisor or a Manager of the same gym, and nothing else. The refusals are coach_picker.negative.test.sql; the body and progress
-- boundary is coach_picker_no_body_data.test.sql and coach_picker_isolation.test.sql; the indexes are coach_picker_indexes.test.sql.
--
-- What must hold, and why it is worth a test each:
--   * Shape: SECURITY DEFINER, STABLE, search_path = public, pg_temp, no PUBLIC or anon EXECUTE, authenticated EXECUTE, no comment in the body (the
--     coverage meta-tests scan prosrc), and a RETURNS TABLE column list that is exactly the allow-list (profile columns only: no body, contact or
--     birth column, no completion column, no photo path of a progress photo).
--   * The same rows for Owner, Supervisor and Manager.
--   * Classes: sessions from 00:00 today in the gym's zone (a session a minute before is out), a cancelled session is out, a cancelled class stays
--     listed, every booking is counted, and a coach's classes never include another coach's.
--   * Assigned members: only currently assigned (an ended assignment, a deactivated member and another coach's member are out), the newest
--     subscription decides the plan and status (0176), the phone is unmasked, and the snippet is that coach's own latest note.
--   * Notes: the chosen coach's own notes only, newest first, with author and time.
--   * Plan: ordered exercises, the author's id and name (a plan the chosen coach did not write names its author), one row with null exercise columns
--     for a plan with no exercise, nothing for no plan.
--   * No RLS policy changed on the progress tables, nor on the coach tables.
-- Fixtures: 00000000-0000-0000-0297-*. Gym A and Gym B active (Douala). A trigger uppercases names, so names here are already upper case.

begin;
select plan(61);

set local timezone = 'UTC';

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0297-000000000001', 'Coach Picker Tier', 5000, 50000, 500);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0297-0000000000a0', 'Coach Picker Gym A', '00000000-0000-0000-0297-000000000001', 'Africa/Douala'),
  ('00000000-0000-0000-0297-0000000000b0', 'Coach Picker Gym B', '00000000-0000-0000-0297-000000000001', 'Africa/Douala');

insert into auth.users (id)
select ('00000000-0000-0000-0297-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 240) n;

-- Gym A: owner 201, supervisor 202, manager 203, receptionist 204, coach One 211, coach Two 212, coach Three (deactivated) 213,
-- members 221 (assigned One, two subscriptions), 222 (assigned One, no subscription), 223 (assigned Two), 224 (assignment with One ended),
-- 225 (deactivated, assigned One), 226 (unassigned). Gym B: manager 231, coach 232, member 233 (assigned to coach 232).
insert into members (id, gym_id, user_id, role, name, phone, photo_url, goal, experience_level, join_date, starting_weight_kg, height_cm, deactivated_at) values
  ('00000000-0000-0000-0297-000000000301', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000201', 'owner', 'PICKER OWNER', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000302', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000202', 'supervisor', 'PICKER SUPERVISOR', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000303', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000203', 'manager', 'PICKER MANAGER', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000304', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000204', 'receptionist', 'PICKER RECEPTIONIST', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000211', 'coach', 'PICKER COACH ONE', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000212', 'coach', 'PICKER COACH TWO', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000313', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000213', 'coach', 'PICKER COACH THREE', null, null, null, null, current_date, null, null, now() - interval '1 day'),
  ('00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000221', 'member', 'PICKER ALICE', '+237670000221', 'avatars/alice.png', 'build_muscle', 'beginner', date '2026-01-15', 70.5, 171, null),
  ('00000000-0000-0000-0297-000000000322', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000222', 'member', 'PICKER BOB', null, null, null, null, date '2026-02-01', null, null, null),
  ('00000000-0000-0000-0297-000000000323', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000223', 'member', 'PICKER CAROL', '+237670000223', null, 'lose_weight', 'advanced', current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000324', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000224', 'member', 'PICKER DAN', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000325', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000225', 'member', 'PICKER ERIN', null, null, null, null, current_date, null, null, now() - interval '1 day'),
  ('00000000-0000-0000-0297-000000000326', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000226', 'member', 'PICKER FRED', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000331', '00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000231', 'manager', 'PICKER B MANAGER', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000332', '00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000232', 'coach', 'PICKER B COACH', null, null, null, null, current_date, null, null, null),
  ('00000000-0000-0000-0297-000000000333', '00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000233', 'member', 'PICKER B MEMBER', null, null, null, null, current_date, null, null, null);

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0297-000000000401', '00000000-0000-0000-0297-0000000000a0', 'Picker Basic', 'monthly', 10000, 'monthly', 30),
  ('00000000-0000-0000-0297-000000000402', '00000000-0000-0000-0297-0000000000a0', 'Picker Premium', 'monthly', 20000, 'monthly', 30);

-- Alice: an OLD subscription (Basic, expired) and a NEWER one (Premium, active): the newest row decides. Carol: expired.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0297-000000000411', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000401', 'expired', date '2026-01-01', date '2026-01-31', now() - interval '60 days'),
  ('00000000-0000-0000-0297-000000000412', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000402', 'active', date '2026-06-01', date '2099-06-30', now() - interval '10 days'),
  ('00000000-0000-0000-0297-000000000413', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000323', '00000000-0000-0000-0297-000000000401', 'expired', date '2026-01-01', date '2026-01-31', now() - interval '60 days');

insert into coach_assignments (id, gym_id, member_id, coach_id, started_at, ended_at) values
  ('00000000-0000-0000-0297-000000000501', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000312', now() - interval '90 days', now() - interval '40 days'),
  ('00000000-0000-0000-0297-000000000502', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000311', now() - interval '40 days', null),
  ('00000000-0000-0000-0297-000000000503', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000322', '00000000-0000-0000-0297-000000000311', now() - interval '30 days', null),
  ('00000000-0000-0000-0297-000000000504', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000323', '00000000-0000-0000-0297-000000000312', now() - interval '30 days', null),
  ('00000000-0000-0000-0297-000000000505', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000324', '00000000-0000-0000-0297-000000000311', now() - interval '30 days', now() - interval '5 days'),
  ('00000000-0000-0000-0297-000000000506', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000325', '00000000-0000-0000-0297-000000000311', now() - interval '30 days', null),
  ('00000000-0000-0000-0297-000000000507', '00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000333', '00000000-0000-0000-0297-000000000332', now() - interval '30 days', null);

-- Alice: two notes from Coach One (the newer one is the snippet) and a NEWER one from Coach Two, written when Coach Two was hers (it must not become the snippet).
insert into session_notes (id, gym_id, member_id, coach_id, coach_assignment_id, note_text, created_at, edited_at) values
  ('00000000-0000-0000-0297-000000000601', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000502', 'First note from One', now() - interval '20 days', null),
  ('00000000-0000-0000-0297-000000000602', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000502', 'Second note from One, edited', now() - interval '2 days', now() - interval '1 day'),
  ('00000000-0000-0000-0297-000000000603', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-000000000501', 'A note from Two', now() - interval '1 hour', null);

insert into session_notes (id, gym_id, member_id, coach_id, coach_assignment_id, note_text) values
  ('00000000-0000-0000-0297-000000000604', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000325', '00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000506', 'Note on deactivated Erin');

insert into workout_plans (id, gym_id, member_id, coach_id, name) values
  ('00000000-0000-0000-0297-000000000703', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000325', '00000000-0000-0000-0297-000000000311', 'Erin deactivated plan'),
  ('00000000-0000-0000-0297-000000000701', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000312', 'Alice strength plan'),
  ('00000000-0000-0000-0297-000000000702', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000322', '00000000-0000-0000-0297-000000000311', 'Bob empty plan');
insert into exercise_library (id, gym_id, name) values
  ('00000000-0000-0000-0297-000000000801', '00000000-0000-0000-0297-0000000000a0', 'Picker Custom Row');
insert into workout_plan_exercises (id, gym_id, member_id, plan_id, exercise_id, order_index, sets, reps, note) values
  ('00000000-0000-0000-0297-000000000811', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000701', '00000000-0000-0000-0297-000000000801', 2, 4, 8, 'slow tempo'),
  ('00000000-0000-0000-0297-000000000812', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', '00000000-0000-0000-0297-000000000701', (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10, null);

-- Classes. Names are upper case. Coach One: a recurring class with two sessions in the window and one a minute before 00:00 today, a one-off class
-- whose only session is long past, a cancelled recurring class. Coach Two: one class. Gym B: one class.
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0297-000000000901', '00000000-0000-0000-0297-0000000000a0', 'PICKER HIIT', '00000000-0000-0000-0297-000000000311', 15, 'recurring', null, '{1,3,5}', '18:00', current_date),
  ('00000000-0000-0000-0297-000000000902', '00000000-0000-0000-0297-0000000000a0', 'PICKER ARCHIVE', '00000000-0000-0000-0297-000000000311', 10, 'one_off', now() - interval '10 days', null, null, null),
  ('00000000-0000-0000-0297-000000000903', '00000000-0000-0000-0297-0000000000a0', 'PICKER STRETCH', '00000000-0000-0000-0297-000000000312', 8, 'recurring', null, '{2}', '12:30', current_date),
  ('00000000-0000-0000-0297-000000000904', '00000000-0000-0000-0297-0000000000a0', 'PICKER CANCELLED', '00000000-0000-0000-0297-000000000311', 8, 'recurring', null, '{4}', '07:00', current_date),
  ('00000000-0000-0000-0297-000000000905', '00000000-0000-0000-0297-0000000000b0', 'PICKER B CLASS', '00000000-0000-0000-0297-000000000332', 8, 'one_off', now() + interval '1 day', null, null, null);
update classes set cancelled_at = now(), cancelled_by = '00000000-0000-0000-0297-000000000303' where id = '00000000-0000-0000-0297-000000000904';

insert into class_sessions (id, gym_id, class_id, scheduled_at, cancelled_at) values
  ('00000000-0000-0000-0297-000000000a01', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000901',
     (select day_start from private.gym_local_day_bounds('Africa/Douala', now())), null),
  ('00000000-0000-0000-0297-000000000a02', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000901',
     (select day_start from private.gym_local_day_bounds('Africa/Douala', now())) - interval '1 minute', null),
  ('00000000-0000-0000-0297-000000000a03', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000901', now() + interval '2 days', null),
  ('00000000-0000-0000-0297-000000000a04', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000901', now() + interval '3 days', now()),
  ('00000000-0000-0000-0297-000000000a05', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000902', now() - interval '10 days', null),
  ('00000000-0000-0000-0297-000000000a06', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000903', now() + interval '1 day', null),
  ('00000000-0000-0000-0297-000000000a07', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000904', now() + interval '1 day', now()),
  ('00000000-0000-0000-0297-000000000a08', '00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000905', now() + interval '1 day', null);

-- Bookings on Gym A: today's session has Alice (attended) and the unassigned Fred; in two days Alice, Bob and the deactivated Erin; Carol on Two's class.
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a01', '00000000-0000-0000-0297-000000000321', now()),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a01', '00000000-0000-0000-0297-000000000326', null),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a02', '00000000-0000-0000-0297-000000000326', null),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a03', '00000000-0000-0000-0297-000000000321', null),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a03', '00000000-0000-0000-0297-000000000322', null),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a03', '00000000-0000-0000-0297-000000000325', null),
  ('00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000a06', '00000000-0000-0000-0297-000000000323', null),
  ('00000000-0000-0000-0297-0000000000b0', '00000000-0000-0000-0297-000000000a08', '00000000-0000-0000-0297-000000000333', null);

create function pg_temp.as_user(p_user text, p_gym text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.as_owner() returns void language sql as $f$ select pg_temp.as_user('00000000-0000-0000-0297-000000000201', '00000000-0000-0000-0297-0000000000a0', 'owner') $f$;
create function pg_temp.as_supervisor() returns void language sql as $f$ select pg_temp.as_user('00000000-0000-0000-0297-000000000202', '00000000-0000-0000-0297-0000000000a0', 'supervisor') $f$;
create function pg_temp.as_manager() returns void language sql as $f$ select pg_temp.as_user('00000000-0000-0000-0297-000000000203', '00000000-0000-0000-0297-0000000000a0', 'manager') $f$;

create temp table picker_fns (fn regprocedure primary key, cols text[]);
insert into picker_fns values
  ('public.list_picker_coaches()'::regprocedure, array['coach_id', 'coach_name', 'is_active']),
  ('public.list_coach_classes(uuid)'::regprocedure, array['class_id', 'class_name', 'capacity', 'schedule_type', 'one_off_session_at', 'slots', 'gym_timezone', 'cancelled_at', 'class_session_id', 'scheduled_at', 'booked_count', 'matches_slots']),
  ('public.list_coach_class_session_roster(uuid, uuid)'::regprocedure, array['member_id', 'member_name', 'attended_at']),
  ('public.list_coach_assigned_members(uuid)'::regprocedure, array['member_id', 'member_name', 'phone', 'photo_url', 'goal', 'experience_level', 'status', 'plan_name', 'expiry_date', 'join_date', 'last_note_snippet']),
  ('public.get_coach_assigned_member(uuid, uuid)'::regprocedure, array['member_id', 'member_name', 'phone', 'photo_url', 'goal', 'experience_level', 'status', 'plan_name', 'expiry_date', 'join_date']),
  ('public.list_coach_member_session_notes(uuid, uuid)'::regprocedure, array['note_id', 'coach_id', 'coach_name', 'note_text', 'created_at', 'edited_at']),
  ('public.get_coach_member_workout_plan(uuid, uuid)'::regprocedure, array['plan_id', 'plan_name', 'author_id', 'author_name', 'plan_exercise_id', 'order_index', 'exercise_name', 'sets', 'reps', 'note']);
grant select on picker_fns to public;

-- ============================================================================
-- Shape and privileges (seven functions, one assertion each, so a new function that skips a rule fails here)
-- ============================================================================

select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(list_coach_|get_coach_|list_picker_)'), 7,
  'the seven picker functions exist in public');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(list_coach_|get_coach_|list_picker_)' and p.oid not in (select fn from picker_fns)), 0,
  'no other function in public matches the picker name pattern (a new one must be added to this file and to scripts/coach-picker-functions.json)');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where not p.prosecdef), 0, 'every picker function is SECURITY DEFINER');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where p.provolatile <> 's'), 0, 'every picker function is STABLE');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where p.proconfig is distinct from array['search_path=public, pg_temp']), 0,
  'every picker function pins search_path to public, pg_temp');
select is((select count(*)::int from picker_fns f where has_function_privilege('anon', f.fn, 'EXECUTE')), 0, 'anon cannot execute any picker function');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn
            where exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')), 0, 'PUBLIC cannot execute any picker function');
select is((select count(*)::int from picker_fns f where not has_function_privilege('authenticated', f.fn, 'EXECUTE')), 0, 'authenticated can execute every picker function');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where p.prosrc ~ '(^|\n)\s*--' or p.prosrc ~ '/\*'), 0,
  'no picker function body carries a comment (the coverage meta-tests scan prosrc)');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn where p.prosrc ~* 'select\s+\*' or p.prosrc ~* 'to_jsonb|row_to_json|to_json\s*\(' or p.prosrc ~* '\mexecute\M\s+(format|''|\$)'), 0,
  'no picker function uses select *, to_jsonb of a row or dynamic SQL');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn
            where p.prosrc !~* 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active''' or p.prosrc not like '%is not active%'), 0,
  'every picker function carries the fail-closed suspension guard and the "is not active" raise');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn
            where p.prosrc !~ 'private\.current_member_role\(\)' or p.prosrc !~ 'private\.gym_id\(\)' or p.prosrc ~* 'auth\.jwt'), 0,
  'every picker function reads the live role and gym (private.current_member_role, private.gym_id), never the token claim');
select is((select count(*)::int from picker_fns f join pg_proc p on p.oid = f.fn
            where f.fn <> 'public.list_picker_coaches()'::regprocedure and p.prosrc !~ 'm\.id = p_coach_id and m\.gym_id = v_gym_id and m\.role = ''coach'' and m\.deactivated_at is null'), 0,
  'every function that takes a coach asserts first that it is an active coach of the caller''s gym');

select results_eq(
  $$ select f.fn::text, (select array_agg(a.n order by a.o) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o) where p.oid = f.fn and a.m = 't') = f.cols
     from picker_fns f order by 1 $$,
  $$ select f.fn::text, true from picker_fns f order by 1 $$,
  'every picker function returns exactly its column allow-list'
);

select is((select cols from picker_fns where fn = 'public.list_coach_class_session_roster(uuid, uuid)'::regprocedure), array['member_id', 'member_name', 'attended_at'],
  'the roster is exactly (member_id, member_name, attended_at)');
select is((select count(*)::int from picker_fns f, unnest(f.cols) c
            where c ~* '(starting_weight|height|birth|dob|emergency|email|neighbo|profession|weight_kg|waist|chest|hips|arms|thighs|photo_path|completion|progress)'), 0,
  'no returned column names a body, contact, birth or progress field');
select is((select count(*)::int from picker_fns f, unnest(f.cols) c where c = 'photo_url' and f.fn::text not like '%assigned_member%'), 0,
  'photo_url is returned by the two member functions only');

-- ============================================================================
-- No policy changed: the progress tables are pinned by a hash of their whole policy set; the coach tables by name
-- ============================================================================

select is(
  (select md5(string_agg(tablename || '|' || policyname || '|' || permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname))
     from pg_policies where schemaname = 'public' and tablename in ('progress_entries', 'progress_photos', 'session_notes', 'workout_plan_completions')),
  'b8ebc760677fb417e442d858f0e8154b',
  'the policies of progress_entries, progress_photos, session_notes and workout_plan_completions are exactly as before 0183 (a change here needs its own review)');
select policies_are('public', 'coach_assignments', array['manager_or_owner_read_own_coach_assignments', 'tenant_active_gate'], 'coach_assignments policies are unchanged');
select policies_are('public', 'workout_plans', array['coach_read_assigned_workout_plan', 'manager_or_owner_read_own_workout_plan', 'self_read_own_workout_plan', 'tenant_active_gate'], 'workout_plans policies are unchanged');
select policies_are('public', 'workout_plan_exercises', array['coach_read_assigned_workout_plan_exercises', 'manager_or_owner_read_own_workout_plan_exercises', 'self_read_own_workout_plan_exercises', 'tenant_active_gate'], 'workout_plan_exercises policies are unchanged');
select is((select count(*)::int from private.support_capabilities where object_name ~ '^(list_coach_|get_coach_|list_picker_)'), 0, 'no picker function is a support capability (FR-251)');

-- ============================================================================
-- Owner: the coaches, classes and rosters
-- ============================================================================

set local role authenticated;
select pg_temp.as_owner();

select results_eq(
  $$ select coach_id, coach_name, is_active from list_picker_coaches() $$,
  $$ values ('00000000-0000-0000-0297-000000000311'::uuid, 'PICKER COACH ONE'::text, true),
            ('00000000-0000-0000-0297-000000000313'::uuid, 'PICKER COACH THREE'::text, false),
            ('00000000-0000-0000-0297-000000000312'::uuid, 'PICKER COACH TWO'::text, true) $$,
  'the Owner reads this gym''s coaches, active and not, and no other role and no other gym''s coach'
);

select results_eq(
  $$ select class_name, class_session_id, booked_count, gym_timezone, cancelled_at is not null from list_coach_classes('00000000-0000-0000-0297-000000000311') $$,
  $$ values ('PICKER ARCHIVE'::text, null::uuid, 0::bigint, 'Africa/Douala'::text, false),
            ('PICKER CANCELLED'::text, null::uuid, 0::bigint, 'Africa/Douala'::text, true),
            ('PICKER HIIT'::text, '00000000-0000-0000-0297-000000000a01'::uuid, 2::bigint, 'Africa/Douala'::text, false),
            ('PICKER HIIT'::text, '00000000-0000-0000-0297-000000000a03'::uuid, 3::bigint, 'Africa/Douala'::text, false) $$,
  'Coach One''s classes: a past-only class as one session-less row, a cancelled class still listed (its cancelled session out), HIIT''s sessions from 00:00 today with every booking counted (deactivated and unassigned members included)'
);
select ok(not exists (select 1 from list_coach_classes('00000000-0000-0000-0297-000000000311') where class_session_id = '00000000-0000-0000-0297-000000000a02'),
  'a session one minute before 00:00 today in the gym''s zone is outside the window');
select ok(not exists (select 1 from list_coach_classes('00000000-0000-0000-0297-000000000311') where class_session_id = '00000000-0000-0000-0297-000000000a04'),
  'a cancelled session is not listed');
select results_eq(
  $$ select class_name from list_coach_classes('00000000-0000-0000-0297-000000000312') $$,
  $$ values ('PICKER STRETCH'::text) $$,
  'Coach Two''s classes are Coach Two''s only (Gym B''s class and Coach One''s classes are not there)');
select results_eq(
  $$ select distinct class_name, capacity, schedule_type, slots from list_coach_classes('00000000-0000-0000-0297-000000000311') where class_name = 'PICKER HIIT' $$,
  $$ values ('PICKER HIIT'::text, 15, 'recurring'::text, '[{"weekday":1,"start_time":"18:00"},{"weekday":3,"start_time":"18:00"},{"weekday":5,"start_time":"18:00"}]'::jsonb) $$,
  'a class carries its capacity and its weekly times');

select results_eq(
  $$ select member_id, member_name, attended_at is not null from list_coach_class_session_roster('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000a01') $$,
  $$ values ('00000000-0000-0000-0297-000000000321'::uuid, 'PICKER ALICE'::text, true),
            ('00000000-0000-0000-0297-000000000326'::uuid, 'PICKER FRED'::text, false) $$,
  'today''s roster: name and attendance only, unassigned members included, in name order');
select is_empty($$ select * from list_coach_class_session_roster('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000a02') $$,
  'a session before 00:00 today has no roster');
select is_empty($$ select * from list_coach_class_session_roster('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000a04') $$,
  'a cancelled session has no roster');
select is_empty($$ select * from list_coach_class_session_roster('00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-000000000a01') $$,
  'a session of Coach One''s class asked for with Coach Two''s id gives nothing');

-- ============================================================================
-- Owner: assigned members, header, notes, plan
-- ============================================================================

select results_eq(
  $$ select member_id, member_name, phone, photo_url, goal, experience_level, status::text, plan_name, expiry_date, join_date, last_note_snippet
     from list_coach_assigned_members('00000000-0000-0000-0297-000000000311') $$,
  $$ values ('00000000-0000-0000-0297-000000000321'::uuid, 'PICKER ALICE'::text, '+237670000221'::text, 'avatars/alice.png'::text, 'build_muscle'::text, 'beginner'::text,
              'active'::text, 'PICKER PREMIUM'::text, date '2099-06-30', date '2026-01-15', 'Second note from One, edited'::text),
            ('00000000-0000-0000-0297-000000000322'::uuid, 'PICKER BOB'::text, null::text, null::text, null::text, null::text,
              null::text, null::text, null::date, date '2026-02-01', null::text) $$,
  'Coach One''s members: Alice (newest subscription decides plan and status, phone unmasked, latest note of Coach One) and Bob (no subscription, no note); not Dan (ended), Erin (deactivated), Carol (Coach Two''s) or Fred'
);
select results_eq(
  $$ select member_name, plan_name, status::text from list_coach_assigned_members('00000000-0000-0000-0297-000000000312') $$,
  $$ values ('PICKER CAROL'::text, 'PICKER BASIC'::text, 'expired'::text) $$,
  'Coach Two''s members: Carol only (Alice''s assignment to Coach Two ended)');

select results_eq(
  $$ select member_id, member_name, phone, photo_url, goal, experience_level, status::text, plan_name, expiry_date, join_date
     from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') $$,
  $$ values ('00000000-0000-0000-0297-000000000321'::uuid, 'PICKER ALICE'::text, '+237670000221'::text, 'avatars/alice.png'::text, 'build_muscle'::text, 'beginner'::text,
              'active'::text, 'PICKER PREMIUM'::text, date '2099-06-30', date '2026-01-15') $$,
  'the one-member header carries the profile columns, the newest subscription''s plan and status');
select is((select count(*)::int from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000322')), 1,
  'a member with no subscription still has a header');
select is_empty($$ select * from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000323') $$,
  'Carol (Coach Two''s) has no header under Coach One');
select is_empty($$ select * from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000324') $$,
  'Dan (assignment ended) has no header');
select is_empty($$ select * from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000325') $$,
  'Erin (deactivated) has no header');
select is_empty($$ select * from get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000326') $$,
  'Fred (unassigned) has no header');

select is_empty($$ select * from list_coach_member_session_notes('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000325') $$,
  'Erin (deactivated, assigned to Coach One, with a note) has no notes through the picker');
select is_empty($$ select * from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000325') $$,
  'Erin (deactivated, assigned to Coach One, with a plan) has no plan through the picker');

select results_eq(
  $$ select note_id, coach_id, coach_name, note_text, edited_at is not null from list_coach_member_session_notes('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') $$,
  $$ values ('00000000-0000-0000-0297-000000000602'::uuid, '00000000-0000-0000-0297-000000000311'::uuid, 'PICKER COACH ONE'::text, 'Second note from One, edited'::text, true),
            ('00000000-0000-0000-0297-000000000601'::uuid, '00000000-0000-0000-0297-000000000311'::uuid, 'PICKER COACH ONE'::text, 'First note from One'::text, false) $$,
  'Alice''s notes under Coach One: Coach One''s own two, newest first, with author; Coach Two''s old note is not there');
select is_empty($$ select * from list_coach_member_session_notes('00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-000000000321') $$,
  'Alice''s notes under Coach Two: nothing, she is no longer Coach Two''s (and the old note is not shown)');
select is((select count(*)::int from list_coach_member_session_notes('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000322')), 0,
  'a member with no note has an empty list');

select set_config('test.plan_one', (select string_agg(plan_name || '/' || coalesce(exercise_name, 'null') || '/' || coalesce(sets::text, 'null') || 'x' || coalesce(reps::text, 'null') || '/' || coalesce(note, 'null') || '/' || coalesce(order_index::text, 'null'), ' | ' order by order_index)
                                       from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321')), true);
select is(current_setting('test.plan_one'),
  'ALICE STRENGTH PLAN/Squat/3x10/null/1 | ALICE STRENGTH PLAN/Picker Custom Row/4x8/slow tempo/2',
  'Alice''s plan: exercises in order, the platform default and the gym''s own exercise named, sets, reps and note');
select results_eq(
  $$ select distinct author_id, author_name from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') $$,
  $$ values ('00000000-0000-0000-0297-000000000312'::uuid, 'PICKER COACH TWO'::text) $$,
  'the plan''s author is Coach Two, not the chosen Coach One, and is named');
select results_eq(
  $$ select plan_name, author_name, plan_exercise_id, order_index, exercise_name, sets, reps, note from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000322') $$,
  $$ values ('BOB EMPTY PLAN'::text, 'PICKER COACH ONE'::text, null::uuid, null::smallint, null::text, null::smallint, null::smallint, null::text) $$,
  'a plan with no exercise returns one row with null exercise columns');
select is((select count(*)::int from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-000000000323')), 0,
  'a member with no plan returns nothing');
select is((select count(*)::int from get_coach_member_workout_plan('00000000-0000-0000-0297-000000000312', '00000000-0000-0000-0297-000000000321')), 0,
  'Alice''s plan asked for with Coach Two''s id returns nothing: she is not currently Coach Two''s');

reset role;

-- ============================================================================
-- Supervisor and Manager read exactly what the Owner reads
-- ============================================================================

create function pg_temp.fingerprint() returns text language sql stable as $f$
  select md5(concat_ws('#',
    (select string_agg(x::text, ',' order by x::text) from public.list_picker_coaches() x),
    (select string_agg(x::text, ',' order by x::text) from public.list_coach_classes('00000000-0000-0000-0297-000000000311') x),
    (select string_agg(x::text, ',' order by x::text) from public.list_coach_class_session_roster('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000a01') x),
    (select string_agg(x::text, ',' order by x::text) from public.list_coach_assigned_members('00000000-0000-0000-0297-000000000311') x),
    (select string_agg(x::text, ',' order by x::text) from public.get_coach_assigned_member('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') x),
    (select string_agg(x::text, ',' order by x::text) from public.list_coach_member_session_notes('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') x),
    (select string_agg(x::text, ',' order by x::text) from public.get_coach_member_workout_plan('00000000-0000-0000-0297-000000000311', '00000000-0000-0000-0297-000000000321') x)
  ))
$f$;
grant execute on function pg_temp.fingerprint() to public;

set local role authenticated;
select pg_temp.as_owner();
select set_config('test.owner_fp', pg_temp.fingerprint(), true);
select pg_temp.as_supervisor();
select is(pg_temp.fingerprint(), current_setting('test.owner_fp'), 'the Supervisor reads exactly what the Owner reads, from all seven functions');
select is((select count(*)::int from list_coach_assigned_members('00000000-0000-0000-0297-000000000311')), 2, 'the Supervisor reads Coach One''s two members');
select pg_temp.as_manager();
select is(pg_temp.fingerprint(), current_setting('test.owner_fp'), 'the Manager reads exactly what the Owner reads, from all seven functions');
select is((select count(*)::int from list_coach_assigned_members('00000000-0000-0000-0297-000000000311')), 2, 'the Manager reads Coach One''s two members');
select isnt(current_setting('test.owner_fp'), md5(''), 'the fingerprint is not of an empty result');

reset role;

-- ============================================================================
-- Live role, not the claim: a Manager demoted in the database loses the picker on the next call, whatever the token says
-- ============================================================================

select set_config('request.jwt.claims', '', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0297-000000000303';
set local role authenticated;
select pg_temp.as_manager();
select is((select count(*)::int from list_picker_coaches()), 0, 'a Manager demoted to Receptionist gets nothing from list_picker_coaches() although the token still says manager');
select is((select count(*)::int from list_coach_assigned_members('00000000-0000-0000-0297-000000000311')), 0, 'and nothing from list_coach_assigned_members()');
reset role;
select set_config('request.jwt.claims', '', true);
update members set role = 'manager' where id = '00000000-0000-0000-0297-000000000303';

-- A promoted Receptionist reaches the picker on the next call, whatever the token says
select set_config('request.jwt.claims', '', true);
update members set role = 'manager' where id = '00000000-0000-0000-0297-000000000304';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0297-000000000204', '00000000-0000-0000-0297-0000000000a0', 'receptionist');
select is((select count(*)::int from list_picker_coaches()), 3, 'a Receptionist promoted to Manager reads the coaches on the next call although the token still says receptionist');
reset role;
select set_config('request.jwt.claims', '', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0297-000000000304';

-- ============================================================================
-- The Owner who becomes deactivated loses access on the next call
-- ============================================================================

select set_config('request.jwt.claims', '', true);
update members set deactivated_at = now() where id = '00000000-0000-0000-0297-000000000301';
set local role authenticated;
select pg_temp.as_owner();
select is((select count(*)::int from list_picker_coaches()), 0, 'a deactivated Owner gets nothing on the next call');
reset role;
select set_config('request.jwt.claims', '', true);
update members set deactivated_at = null where id = '00000000-0000-0000-0297-000000000301';

-- ============================================================================
-- Seeded body data is not in any picker row (the scan over every function is coach_picker_no_body_data.test.sql); here the cheap proof that the
-- Owner's own measurements read is unchanged by 0183: direct reads stay what RLS gives
-- ============================================================================

insert into progress_entries (id, gym_id, member_id, weight_kg, waist_cm, note, logged_at)
values ('00000000-0000-0000-0297-000000000b01', '00000000-0000-0000-0297-0000000000a0', '00000000-0000-0000-0297-000000000321', 69.9, 80.1, 'private progress note', now());
set local role authenticated;
select pg_temp.as_manager();
select is((select count(*)::int from progress_entries), 0, 'a Manager still reads no progress_entries row directly');
select is((select count(*)::int from progress_photos), 0, 'a Manager still reads no progress_photos row directly');
reset role;

select * from finish();
rollback;
