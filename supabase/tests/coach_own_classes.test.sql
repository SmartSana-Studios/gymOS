-- Story 29.3: a Coach creates, edits and cancels their OWN classes (0182). The positive side: create (null and own id), edit with the weekly
-- times editor (a booked session left unchanged), cancel, the audit rows with the Coach as actor, the Coach's list and roster, Manager and
-- Owner unchanged on every class, a reassignment by a Manager moving the edit rights. The refusals are coach_own_classes.negative.test.sql.
-- Fixtures: 00000000-0000-0000-0295-*. Gym A is Africa/Douala.

begin;
select plan(56);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0295-000000000001', 'Coach Own Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0295-0000000000a0', 'Coach Own Gym A', '00000000-0000-0000-0295-000000000001', 'Africa/Douala');

insert into auth.users (id)
select ('00000000-0000-0000-0295-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 214) n;

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0295-000000000301', '00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000201', 'owner', 'Own A Owner'),
  ('00000000-0000-0000-0295-000000000302', '00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000202', 'manager', 'Own A Manager'),
  ('00000000-0000-0000-0295-000000000303', '00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000203', 'coach', 'Own A Coach One'),
  ('00000000-0000-0000-0295-000000000307', '00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000207', 'coach', 'Own A Coach Two'),
  ('00000000-0000-0000-0295-000000000305', '00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000205', 'supervisor', 'Own A Supervisor');
insert into members (id, gym_id, user_id, role, name)
select ('00000000-0000-0000-0295-000000000' || lpad((310 + n)::text, 3, '0'))::uuid, '00000000-0000-0000-0295-0000000000a0',
       ('00000000-0000-0000-0295-000000000' || lpad((207 + n)::text, 3, '0'))::uuid, 'member', 'Own Member ' || n
from generate_series(1, 4) n;

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0295-000000000061', '00000000-0000-0000-0295-0000000000a0', 'Own Monthly', 'monthly', 15000, 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select '00000000-0000-0000-0295-0000000000a0', m.id, '00000000-0000-0000-0295-000000000061', 'active', current_date, current_date + 30
from members m where m.role = 'member' and m.gym_id = '00000000-0000-0000-0295-0000000000a0';

create function pg_temp.as_role(p_user text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0295-0000000000a0', 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.coach1() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0295-000000000203', 'coach') $f$;
create function pg_temp.coach2() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0295-000000000207', 'coach') $f$;
create function pg_temp.manager() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0295-000000000202', 'manager') $f$;
create function pg_temp.owner() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0295-000000000201', 'owner') $f$;
create function pg_temp.res() returns jsonb language sql as $f$ select current_setting('test.res')::jsonb $f$;
create function pg_temp.mid(p int) returns uuid language sql as $f$ select ('00000000-0000-0000-0295-000000000' || lpad((310 + p)::text, 3, '0'))::uuid $f$;

-- ============================================================================
-- A Coach creates: p_coach_id null is stored as the caller, an own id is accepted
-- ============================================================================
set local role authenticated;
select pg_temp.coach1();
select lives_ok(
  $$select set_config('test.hiit', create_class('Hiit', 'Morning burn', null, 12, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:00"},{"weekday":4,"start_time":"18:30"}]'::jsonb)::text, false)$$,
  'a Coach creates a recurring class with two different times and no coach id');
select lives_ok(
  $$select set_config('test.pump', create_class('Pump', null, '00000000-0000-0000-0295-000000000303', 8, 'recurring', null, null, null, current_date,
      '[{"weekday":2,"start_time":"09:00"}]'::jsonb)::text, false)$$,
  'a Coach creates a class naming themselves');
select lives_ok(
  $$select set_config('test.once', create_class('One shot', null, null, 5, 'one_off', now() + interval '3 days', null, null, null, null)::text, false)$$,
  'a Coach creates a one-off class');
reset role;

select is((select coach_id from classes where id = current_setting('test.hiit')::uuid), '00000000-0000-0000-0295-000000000303'::uuid, 'null is stored as the calling Coach');
select is((select coach_id from classes where id = current_setting('test.pump')::uuid), '00000000-0000-0000-0295-000000000303'::uuid, 'an own id is stored as given');
select is((select gym_id from classes where id = current_setting('test.hiit')::uuid), '00000000-0000-0000-0295-0000000000a0'::uuid, 'the class is in the Coach''s gym');
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.hiit')::uuid), 2, 'both weekly times are stored');
select ok((select count(*) from class_sessions where class_id = current_setting('test.hiit')::uuid and scheduled_at > now()) >= 2, 'sessions were generated synchronously');
select is((select count(*)::int from class_sessions where class_id = current_setting('test.once')::uuid), 1, 'the one-off class has its session');

set local role authenticated;
select pg_temp.coach1();
select is((select count(distinct class_id)::int from list_my_classes()), 3, 'the three new classes are in the Coach''s list at once');
select is((select description from list_my_classes() where class_id = current_setting('test.hiit')::uuid limit 1), 'Morning burn', 'list_my_classes returns the description');
select is((select recurrence_start_date from list_my_classes() where class_id = current_setting('test.hiit')::uuid limit 1), current_date, 'and the recurrence start date');
select pg_temp.coach2();
select is((select count(*)::int from list_my_classes()), 0, 'a second Coach sees none of them');
reset role;

-- ============================================================================
-- A Coach edits their own class: one time changed, a booked session left unchanged
-- ============================================================================
select set_config('test.s1', (select id::text from class_sessions where class_id = current_setting('test.hiit')::uuid and scheduled_at > now() and extract(dow from scheduled_at at time zone 'Africa/Douala') = 1 order by scheduled_at limit 1), false);
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0295-0000000000a0', current_setting('test.s1')::uuid, pg_temp.mid(n) from generate_series(1, 3) n;
select set_config('test.s1_at', (select scheduled_at::text from class_sessions where id = current_setting('test.s1')::uuid), false);
create temp table before_edit as
select (select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.hiit')::uuid) as bookings_n;

set local role authenticated;
select pg_temp.coach1();
select is((select count(*)::int from list_my_class_session_roster(current_setting('test.s1')::uuid)), 3, 'before any cancel the Coach''s roster of that session lists the three bookers');
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.hiit')::uuid, 'Hiit', 'Evening burn', null, 12, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:00"},{"weekday":4,"start_time":"19:00"}]'::jsonb)::text, false)$$,
  'the Coach edits one time of their class, p_coach_id null');
reset role;

select is((select coach_id from classes where id = current_setting('test.hiit')::uuid), '00000000-0000-0000-0295-000000000303'::uuid, 'null on an update keeps the Coach as the class coach');
select is((select description from classes where id = current_setting('test.hiit')::uuid), 'Evening burn', 'the description changed');
select is(
  (select array_agg(to_char(start_time, 'HH24:MI') order by weekday) from class_schedule_slots where class_id = current_setting('test.hiit')::uuid),
  array['07:00', '19:00'], 'the slots were replaced');
select ok(jsonb_typeof(pg_temp.res() -> 'left_unchanged') = 'array', 'the result carries left_unchanged');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.hiit') and action_type = 'class_times_changed'), 1, 'one class_times_changed audit row');
select ok((select actor_display_name ilike 'own a coach one' from audit_log where target_entity_id = current_setting('test.hiit') and action_type = 'class_times_changed'), 'the audit row names the Coach as actor');
select is((select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.hiit')::uuid), (select bookings_n from before_edit), 'no booking was lost by the edit');

-- Repeating the same edit is idempotent and writes no second times-changed row.
set local role authenticated;
select pg_temp.coach1();
select lives_ok(
  $$select update_class(current_setting('test.hiit')::uuid, 'Hiit', 'Evening burn', '00000000-0000-0000-0295-000000000303', 12, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"07:00"},{"weekday":4,"start_time":"19:00"}]'::jsonb)$$,
  'the same edit again, with the Coach''s own id');
reset role;
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.hiit') and action_type = 'class_times_changed'), 1, 'still one times-changed row');

-- ============================================================================
-- A booked session moved by an edit is left unchanged and reported (as for a Manager)
-- ============================================================================
set local role authenticated;
select pg_temp.coach1();
select lives_ok(
  $$select set_config('test.res', update_class(current_setting('test.hiit')::uuid, 'Hiit', 'Evening burn', null, 12, 'recurring', null, null, null, current_date,
      '[{"weekday":4,"start_time":"19:00"}]'::jsonb)::text, false)$$,
  'the Coach drops the Monday time');
reset role;
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.res() -> 'left_unchanged') e where (e ->> 'class_session_id') = current_setting('test.s1') and (e ->> 'booked_count') = '3'),
  1, 'the booked Monday session that no longer matches is reported with its three bookings');
select ok(exists (select 1 from class_sessions where id = current_setting('test.s1')::uuid), 'and it is never deleted');
select is((select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.hiit')::uuid), (select bookings_n from before_edit), 'no booking was lost');

-- ============================================================================
-- A Coach cancels their own class
-- ============================================================================
select set_config('test.pump_s', (select id::text from class_sessions where class_id = current_setting('test.pump')::uuid and scheduled_at > now() order by scheduled_at limit 1), false);
insert into class_bookings (gym_id, class_session_id, member_id) values
  ('00000000-0000-0000-0295-0000000000a0', current_setting('test.pump_s')::uuid, pg_temp.mid(1)),
  ('00000000-0000-0000-0295-0000000000a0', current_setting('test.pump_s')::uuid, pg_temp.mid(2));
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0295-000000000501', '00000000-0000-0000-0295-0000000000a0', current_setting('test.pump')::uuid, now() - interval '2 days');
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0295-0000000000a0', '00000000-0000-0000-0295-000000000501', pg_temp.mid(1), now() - interval '2 days');

set local role authenticated;
select pg_temp.coach1();
select is((select count(*)::int from list_my_class_session_roster(current_setting('test.pump_s')::uuid)), 2, 'the roster of a live future session lists its bookers');
select lives_ok($$select set_config('test.res', cancel_class(current_setting('test.pump')::uuid)::text, false)$$, 'the Coach cancels their own class');
select is((select count(*)::int from list_my_class_session_roster(current_setting('test.pump_s')::uuid)), 0, 'the roster of a cancelled session is empty');
select ok((select bool_and(cancelled_at is not null) from list_my_classes() where class_id = current_setting('test.pump')::uuid), 'the cancelled class stays in the Coach''s list with its cancelled_at');
select is((select count(*)::int from list_my_classes() where class_id = current_setting('test.pump')::uuid and class_session_id is not null and scheduled_at > now()), 0, 'its future sessions are not listed');
select throws_like($$select cancel_class(current_setting('test.pump')::uuid)$$, 'cancel_class: class % is already cancelled', 'cancelling again gives the "already cancelled" message');
select throws_like(
  $$select update_class(current_setting('test.pump')::uuid, 'Pump', null, null, 8, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"09:00"}]'::jsonb)$$,
  'update_class: class % is already cancelled', 'editing a cancelled own class gives the "already cancelled" message');
reset role;

select is(pg_temp.res(), '{"bookings_cancelled": 2}'::jsonb, 'cancel_class returns the server-computed count');
select is((select cancelled_by from classes where id = current_setting('test.pump')::uuid), '00000000-0000-0000-0295-000000000303'::uuid, 'cancelled_by is the Coach''s member id');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.pump') and action_type = 'class_cancelled'), 1, 'one class_cancelled audit row');
select ok((select actor_display_name ilike 'own a coach one' from audit_log where target_entity_id = current_setting('test.pump') and action_type = 'class_cancelled'), 'the Coach is the actor');
select ok(exists (select 1 from class_bookings where class_session_id = current_setting('test.pump_s')::uuid), 'the bookings stay on record');
select ok(exists (select 1 from class_bookings where class_session_id = '00000000-0000-0000-0295-000000000501' and attended_at is not null), 'past attendance is untouched');

-- ============================================================================
-- Manager, Supervisor and Owner keep every class of their gym, as before
-- ============================================================================
set local role authenticated;
select pg_temp.manager();
select lives_ok(
  $$select set_config('test.mgr', create_class('Mgr class', null, '00000000-0000-0000-0295-000000000307', 10, 'recurring', null, null, null, current_date, '[{"weekday":3,"start_time":"10:00"}]'::jsonb)::text, false)$$,
  'a Manager creates a class for Coach Two');
select lives_ok(
  $$select update_class(current_setting('test.hiit')::uuid, 'Hiit', 'By the manager', '00000000-0000-0000-0295-000000000307', 12, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"19:00"}]'::jsonb)$$,
  'a Manager reassigns Coach One''s class to Coach Two');
reset role;
select is((select coach_id from classes where id = current_setting('test.hiit')::uuid), '00000000-0000-0000-0295-000000000307'::uuid, 'the class now belongs to Coach Two');
select is((select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.hiit')::uuid), (select bookings_n from before_edit), 'the reassignment left every booking untouched');

-- A Coach One edit now fails, a Coach Two edit works, on the next request.
set local role authenticated;
select pg_temp.coach1();
select throws_ok(
  $$select update_class(current_setting('test.hiit')::uuid, 'Hiit', null, null, 12, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"19:00"}]'::jsonb)$$,
  'update_class: coaches can only manage their own classes', 'the former Coach can no longer edit the reassigned class');
select throws_ok($$select cancel_class(current_setting('test.hiit')::uuid)$$, 'cancel_class: coaches can only manage their own classes', 'nor cancel it');
select pg_temp.coach2();
select lives_ok(
  $$select update_class(current_setting('test.hiit')::uuid, 'Hiit', 'By coach two', null, 12, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"19:30"}]'::jsonb)$$,
  'the new Coach can edit it on the next request');
select is((select count(distinct class_id)::int from list_my_classes()), 2, 'Coach Two lists the manager''s class and the reassigned one');
select pg_temp.owner();
select lives_ok($$select cancel_class(current_setting('test.mgr')::uuid)$$, 'an Owner cancels a class that is not theirs');
select pg_temp.as_role('00000000-0000-0000-0295-000000000205', 'supervisor');
select lives_ok(
  $$select update_class(current_setting('test.hiit')::uuid, 'Hiit', 'By the supervisor', '00000000-0000-0000-0295-000000000303', 12, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"19:30"}]'::jsonb)$$,
  'a Supervisor moves it back to Coach One');
reset role;
select is((select coach_id from classes where id = current_setting('test.hiit')::uuid), '00000000-0000-0000-0295-000000000303'::uuid, 'and the class is Coach One''s again');

-- ============================================================================
-- Table policies: no Coach write policy exists on the class tables
-- ============================================================================
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename in ('classes', 'class_sessions', 'class_schedule_slots', 'class_bookings')
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'coach'),
  0, 'no write policy on the four class tables mentions a Coach');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'class_bookings' and cmd in ('SELECT', 'ALL')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'coach'),
  0, 'and no Coach read policy on class_bookings');
select ok(not has_function_privilege('anon', 'private.is_live_own_coach(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'private.is_live_own_coach(uuid)', 'EXECUTE'),
  'the Coach predicate is not callable by a client role');
select ok(not exists (select 1 from private.support_capabilities where object_name in ('create_class', 'update_class', 'cancel_class', 'is_live_own_coach')), 'none of the Coach functions is a support capability');

select * from finish();
rollback;
