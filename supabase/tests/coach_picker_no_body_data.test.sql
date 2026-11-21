-- Story 29.4 (FR-247, FR-095, NFR-011, NFR-016): the body and progress boundary, proven on data. For a coach's assigned member the fixtures seed a progress
-- entry with measurements and weight (the entry a Coach Overview feed would show), a progress note, a progress photo (one shared with the coach,
-- one not), a workout plan with a recorded plan completion, a session note, a class booking, and the member's own body and contact columns on the
-- members row (starting weight, height, birth year, date of birth, e-mail, emergency contact, neighbourhood, profession). Then EVERY picker function
-- is called as an Owner, a Supervisor and a Manager of that gym, and the full text of every returned row is scanned for each seeded value: none
-- may appear. The session note, the plan as authored, the booking and the profile DO appear (the positive side).
--
-- The test also fails when a picker function exists (by name pattern) that this file does not call, so a function added without a scan is caught
-- here; scripts/check-coach-picker-isolation.mjs fails when a name in scripts/coach-picker-functions.json is not called in this file.
-- Fixtures: 00000000-0000-0000-0299-*.

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0299-000000000001', 'Picker Body Tier', 5000, 50000, 500);
insert into gyms (id, name, tier_id, timezone)
values ('00000000-0000-0000-0299-0000000000a0', 'Picker Body Gym', '00000000-0000-0000-0299-000000000001', 'Africa/Douala');

insert into auth.users (id)
select ('00000000-0000-0000-0299-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 230) n;

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0299-000000000301', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000201', 'owner', 'BODY OWNER'),
  ('00000000-0000-0000-0299-000000000302', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000202', 'supervisor', 'BODY SUPERVISOR'),
  ('00000000-0000-0000-0299-000000000303', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000203', 'manager', 'BODY MANAGER'),
  ('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000211', 'coach', 'BODY COACH');
insert into members (id, gym_id, user_id, role, name, phone, email, dob, photo_url, emergency_contact, goal, experience_level,
                     height_cm, starting_weight_kg, birth_year, profession, neighborhood) values
  ('00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000221', 'member', 'BODY MEMBER', '+237670000299',
   'zq-secret-mail@body.example', date '1987-04-04', 'avatars/body-member.png', 'zq-emergency-contact-line', 'build_muscle', 'beginner',
   183.33, 77.77, 1987, 'zq-profession-value', 'zq-neighbourhood-value');
select set_config('request.jwt.claims', '', true);

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days)
values ('00000000-0000-0000-0299-000000000401', '00000000-0000-0000-0299-0000000000a0', 'Body Monthly', 'monthly', 10000, 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
values ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000401', 'active', current_date, current_date + 30);

insert into coach_assignments (id, gym_id, member_id, coach_id)
values ('00000000-0000-0000-0299-000000000501', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000311');

insert into session_notes (gym_id, member_id, coach_id, coach_assignment_id, note_text)
values ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000501', 'Session note that must show');

insert into workout_plans (id, gym_id, member_id, coach_id, name)
values ('00000000-0000-0000-0299-000000000701', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000311', 'Body plan as authored');
insert into workout_plan_exercises (id, gym_id, member_id, plan_id, exercise_id, order_index, sets, reps, note)
values ('00000000-0000-0000-0299-000000000711', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000701',
        (select id from exercise_library where gym_id is null and name = 'Squat'), 1, 3, 10, 'plan note that must show');
insert into workout_plan_completions (gym_id, member_id, plan_id, exercise_id, completed_at)
values ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000701',
        (select id from exercise_library where gym_id is null and name = 'Squat'), timestamptz '2031-03-03 03:03:03+00');

insert into progress_entries (id, gym_id, member_id, weight_kg, waist_cm, chest_cm, hips_cm, arms_cm, thighs_cm, note, logged_at) values
  ('00000000-0000-0000-0299-000000000b01', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321',
   83.77, 91.33, 101.77, 99.11, 35.55, 61.99, 'zq-progress-note-text', timestamptz '2032-02-02 02:02:02+00'),
  ('00000000-0000-0000-0299-000000000b02', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321',
   84.22, null, null, null, null, null, 'zq-second-progress-note', timestamptz '2032-02-03 02:02:02+00');
insert into progress_photos (gym_id, member_id, progress_entry_id, photo_path, shared_with_coach) values
  ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000b01', 'progress/zq-shared-photo.jpg', true),
  ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000321', '00000000-0000-0000-0299-000000000b02', 'progress/zq-private-photo.jpg', false);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at)
values ('00000000-0000-0000-0299-000000000901', '00000000-0000-0000-0299-0000000000a0', 'BODY CLASS', '00000000-0000-0000-0299-000000000311', 10, 'one_off', now() + interval '1 day');
insert into class_sessions (id, gym_id, class_id, scheduled_at)
values ('00000000-0000-0000-0299-000000000a01', '00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000901', now() + interval '1 day');
insert into class_bookings (gym_id, class_session_id, member_id)
values ('00000000-0000-0000-0299-0000000000a0', '00000000-0000-0000-0299-000000000a01', '00000000-0000-0000-0299-000000000321');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0299-0000000000a0', 'app_role', 'owner')::text, true);
end;
$f$;

-- Every picker function, called with the seeded ids; the text of every row of every result, one string. A function added to the allow-list but not
-- called here fails the "every picker function is called" assertion below.
create function pg_temp.everything() returns text language sql stable as $f$
  select concat_ws(E'\n',
    (select string_agg(x::text, E'\n') from public.list_picker_coaches() x),
    (select string_agg(x::text, E'\n') from public.list_coach_classes('00000000-0000-0000-0299-000000000311') x),
    (select string_agg(x::text, E'\n') from public.list_coach_class_session_roster('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000a01') x),
    (select string_agg(x::text, E'\n') from public.list_coach_assigned_members('00000000-0000-0000-0299-000000000311') x),
    (select string_agg(x::text, E'\n') from public.get_coach_assigned_member('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x),
    (select string_agg(x::text, E'\n') from public.list_coach_member_session_notes('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x),
    (select string_agg(x::text, E'\n') from public.get_coach_member_workout_plan('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x)
  )
$f$;
grant execute on function pg_temp.everything() to public;

create temp table markers (kind text, marker text);
insert into markers values
  ('weight', '83.77'), ('second weight', '84.22'), ('waist', '91.33'), ('chest', '101.77'), ('hips', '99.11'), ('arms', '35.55'), ('thighs', '61.99'),
  ('progress note', 'zq-progress-note-text'), ('second progress note', 'zq-second-progress-note'),
  ('shared photo path', 'zq-shared-photo'), ('private photo path', 'zq-private-photo'), ('progress path prefix', 'progress/'),
  ('plan completion mark', '2031-03-03'), ('progress entry time', '2032-02-02'), ('second progress entry time', '2032-02-03'),
  ('starting weight', '77.77'), ('height', '183.33'),
  ('birth year', '1987'), ('date of birth', '1987-04-04'), ('e-mail', 'zq-secret-mail'), ('emergency contact', 'zq-emergency-contact'),
  ('profession', 'zq-profession-value'), ('neighbourhood', 'zq-neighbourhood-value');
grant select on markers to public;

-- the discovery side: every function in public that matches the picker name pattern is called by pg_temp.everything()
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(list_coach_|get_coach_|list_picker_)'),
  array['get_coach_assigned_member', 'get_coach_member_workout_plan', 'list_coach_assigned_members', 'list_coach_class_session_roster', 'list_coach_classes', 'list_coach_member_session_notes', 'list_picker_coaches'],
  'every picker function is called by this file (a new one needs a call in pg_temp.everything and a place in scripts/coach-picker-functions.json)');
select is(
  (select coalesce(array_agg(n order by n), '{}') from (select unnest(regexp_matches(pg_get_functiondef('pg_temp.everything()'::regprocedure), 'public\.((?:list_coach_|get_coach_|list_picker_)[a-z_]+)\(', 'g')) n) x),
  array['get_coach_assigned_member', 'get_coach_member_workout_plan', 'list_coach_assigned_members', 'list_coach_class_session_roster', 'list_coach_classes', 'list_coach_member_session_notes', 'list_picker_coaches'],
  'pg_temp.everything() calls exactly those seven functions');

-- seeded data really exists for the scan to be meaningful
select is((select count(*)::int from progress_entries where member_id = '00000000-0000-0000-0299-000000000321'), 2, 'seeded: two progress entries');
select is((select count(*)::int from progress_photos where member_id = '00000000-0000-0000-0299-000000000321'), 2, 'seeded: two progress photos (one shared, one not)');
select is((select count(*)::int from workout_plan_completions where member_id = '00000000-0000-0000-0299-000000000321'), 1, 'seeded: a plan completion');
select is((select starting_weight_kg::text || '/' || height_cm::text from members where id = '00000000-0000-0000-0299-000000000321'), '77.77/183.33', 'seeded: the member''s starting weight and height');

-- the three roles
create temp table scanned (role_name text, everything text);
grant select, insert on scanned to public;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0299-000000000201');
insert into scanned values ('owner', pg_temp.everything());
select pg_temp.as_user('00000000-0000-0000-0299-000000000202');
insert into scanned values ('supervisor', pg_temp.everything());
select pg_temp.as_user('00000000-0000-0000-0299-000000000203');
insert into scanned values ('manager', pg_temp.everything());
reset role;

select is((select count(*)::int from scanned where length(everything) > 400), 3, 'positive control: each role got a substantial result from the seven functions');
select is((select count(distinct everything)::int from scanned), 1, 'the three roles read identical rows');

select is((select count(*)::int from scanned s, markers m where position(m.marker in s.everything) > 0), 0,
  'no seeded body, progress, completion or contact value appears in any row of any picker function, for any of the three roles');

select is((select string_agg(s.role_name || ':' || m.kind, ', ') from scanned s, markers m where position(m.marker in s.everything) > 0), null,
  'the scan names no offender');

select is((select count(*)::int from scanned where position('Session note that must show' in everything) > 0), 3, 'the session note as authored appears for all three roles');
select is((select count(*)::int from scanned where position('BODY PLAN AS AUTHORED' in everything) > 0 and position('plan note that must show' in everything) > 0 and position('Squat' in everything) > 0), 3,
  'the plan as authored (name, exercise, note) appears for all three roles');
select is((select count(*)::int from scanned where position('BODY MEMBER' in everything) > 0 and position('+237670000299' in everything) > 0 and position('build_muscle' in everything) > 0 and position('beginner' in everything) > 0 and position('BODY MONTHLY' in everything) > 0), 3,
  'the profile appears: name, unmasked phone, goal, experience level and plan');
select is((select count(*)::int from scanned where position('BODY CLASS' in everything) > 0), 3, 'the class appears');

-- each function on its own: no row of any function carries a body or progress value (so a regression names the function)
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0299-000000000203');
create temp table per_function (fn text, body text);
grant select, insert on per_function to public;
insert into per_function values
  ('list_picker_coaches', (select coalesce(string_agg(x::text, E'\n'), '') from public.list_picker_coaches() x)),
  ('list_coach_classes', (select coalesce(string_agg(x::text, E'\n'), '') from public.list_coach_classes('00000000-0000-0000-0299-000000000311') x)),
  ('list_coach_class_session_roster', (select coalesce(string_agg(x::text, E'\n'), '') from public.list_coach_class_session_roster('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000a01') x)),
  ('list_coach_assigned_members', (select coalesce(string_agg(x::text, E'\n'), '') from public.list_coach_assigned_members('00000000-0000-0000-0299-000000000311') x)),
  ('get_coach_assigned_member', (select coalesce(string_agg(x::text, E'\n'), '') from public.get_coach_assigned_member('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x)),
  ('list_coach_member_session_notes', (select coalesce(string_agg(x::text, E'\n'), '') from public.list_coach_member_session_notes('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x)),
  ('get_coach_member_workout_plan', (select coalesce(string_agg(x::text, E'\n'), '') from public.get_coach_member_workout_plan('00000000-0000-0000-0299-000000000311', '00000000-0000-0000-0299-000000000321') x));
reset role;

select is((select count(*)::int from per_function where length(body) > 0), 7, 'positive control: each of the seven functions returned rows');
select is((select string_agg(f.fn || ':' || m.kind, ', ') from per_function f, markers m where position(m.marker in f.body) > 0), null, 'no single function returns any seeded body or progress value');
select is((select count(*)::int from per_function f, markers m where f.fn = 'list_coach_assigned_members' and position(m.marker in f.body) > 0), 0, 'list_coach_assigned_members: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'get_coach_assigned_member' and position(m.marker in f.body) > 0), 0, 'get_coach_assigned_member: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'list_coach_member_session_notes' and position(m.marker in f.body) > 0), 0, 'list_coach_member_session_notes: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'get_coach_member_workout_plan' and position(m.marker in f.body) > 0), 0, 'get_coach_member_workout_plan: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'list_coach_classes' and position(m.marker in f.body) > 0), 0, 'list_coach_classes: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'list_coach_class_session_roster' and position(m.marker in f.body) > 0), 0, 'list_coach_class_session_roster: clean');
select is((select count(*)::int from per_function f, markers m where f.fn = 'list_picker_coaches' and position(m.marker in f.body) > 0), 0, 'list_picker_coaches: clean');

-- the same direct reads stay closed: a Manager reads no progress or completion row through RLS, 0183 opened nothing
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0299-000000000203');
select is((select count(*)::int from progress_entries), 0, 'a Manager still reads no progress_entries row');
select is((select count(*)::int from progress_photos), 0, 'a Manager still reads no progress_photos row');
reset role;

-- the function bodies themselves name none of the deny-listed tables or columns
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(list_coach_|get_coach_|list_picker_)'
            and p.prosrc ~* '(progress_entries|progress_photos|workout_plan_completions|progress-photos|starting_weight_kg|height_cm|birth_year|\mdob\M|emergency_contact|\memail\M|neighborhood|profession)'), 0,
  'no picker function body names a progress table, the progress bucket or a body or contact column');

select * from finish();
rollback;
