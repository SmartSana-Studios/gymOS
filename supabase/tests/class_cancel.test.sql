-- Story 29.2: cancel_class (0181). A class and its future sessions are flagged, never deleted; bookings, past sessions and attendance stay; the
-- count comes from the server; one audit row; no notification and no dispatch row. A cancelled class is skipped by the daily job, the class
-- reminder and the bookable list, and refused by update_class, materialize_class_sessions, book_class_session, mark_class_attendance and
-- cancel_class_booking, each with its own message. The refusals per role are class_cancel.negative.test.sql.
-- Fixtures: 00000000-0000-0000-0293-*. Gym A is Africa/Douala.

begin;
select plan(63);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0293-000000000001', 'Cancel Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, timezone) values
  ('00000000-0000-0000-0293-0000000000a0', 'Cancel Gym A', '00000000-0000-0000-0293-000000000001', 'Africa/Douala');

insert into auth.users (id)
select ('00000000-0000-0000-0293-000000000' || lpad(n::text, 3, '0'))::uuid from generate_series(201, 214) n;

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0293-000000000301', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000201', 'owner', 'Cancel A Owner'),
  ('00000000-0000-0000-0293-000000000302', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000202', 'manager', 'Cancel A Manager'),
  ('00000000-0000-0000-0293-000000000303', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000203', 'coach', 'Cancel A Coach'),
  ('00000000-0000-0000-0293-000000000304', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000204', 'receptionist', 'Cancel A Receptionist'),
  ('00000000-0000-0000-0293-000000000305', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000205', 'supervisor', 'Cancel A Supervisor');
insert into members (id, gym_id, user_id, role, name)
select ('00000000-0000-0000-0293-000000000' || lpad((310 + n)::text, 3, '0'))::uuid, '00000000-0000-0000-0293-0000000000a0',
       ('00000000-0000-0000-0293-000000000' || lpad((205 + n)::text, 3, '0'))::uuid, 'member', 'Cancel Member ' || n
from generate_series(1, 8) n;

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0293-000000000061', '00000000-0000-0000-0293-0000000000a0', 'Cancel Monthly', 'monthly', 15000, 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select '00000000-0000-0000-0293-0000000000a0', m.id, '00000000-0000-0000-0293-000000000061', 'active', current_date, current_date + 30
from members m where m.role = 'member' and m.gym_id = '00000000-0000-0000-0293-0000000000a0';

create function pg_temp.as_role(p_user text, p_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', '00000000-0000-0000-0293-0000000000a0', 'app_role', p_role)::text, true);
end;
$f$;
create function pg_temp.manager() returns void language sql as $f$ select pg_temp.as_role('00000000-0000-0000-0293-000000000202', 'manager') $f$;
create function pg_temp.member(p int) returns void language sql as $f$
  select pg_temp.as_role(('00000000-0000-0000-0293-000000000' || lpad((205 + p)::text, 3, '0')), 'member')
$f$;
create function pg_temp.res() returns jsonb language sql as $f$ select current_setting('test.res')::jsonb $f$;
create function pg_temp.mid(p int) returns uuid language sql as $f$ select ('00000000-0000-0000-0293-000000000' || lpad((310 + p)::text, 3, '0'))::uuid $f$;

-- ============================================================================
-- Fixtures: Spin (Mon/Wed/Fri 18:00) with eight members booked on its next sessions and one attended booking on a past session.
-- ============================================================================
set local role authenticated;
select pg_temp.manager();
select lives_ok(
  $$select create_class('Spin', null, '00000000-0000-0000-0293-000000000303', 20, 'recurring', null, null, null, current_date,
      '[{"weekday":1,"start_time":"18:00"},{"weekday":3,"start_time":"18:00"},{"weekday":5,"start_time":"18:00"}]'::jsonb)$$,
  'a recurring class to cancel');
reset role;
select set_config('test.spin', (select id::text from classes where name = 'SPIN'), false);
select set_config('test.s1', (select id::text from class_sessions where class_id = current_setting('test.spin')::uuid and scheduled_at > now() order by scheduled_at limit 1), false);
select set_config('test.s2', (select id::text from class_sessions where class_id = current_setting('test.spin')::uuid and scheduled_at > now() order by scheduled_at offset 1 limit 1), false);
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0293-0000000000a0', current_setting('test.s1')::uuid, pg_temp.mid(n) from generate_series(1, 6) n;
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0293-0000000000a0', current_setting('test.s2')::uuid, pg_temp.mid(n) from generate_series(1, 2) n;
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0293-000000000501', '00000000-0000-0000-0293-0000000000a0', current_setting('test.spin')::uuid, now() - interval '2 days');
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000501', pg_temp.mid(1), now() - interval '2 days');
-- A second class that stays live, with a booking by member 1 (for the member lists).
set local role authenticated;
select pg_temp.manager();
select lives_ok(
  $$select create_class('Yoga', null, '00000000-0000-0000-0293-000000000303', 20, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"09:00"}]'::jsonb)$$,
  'a class that stays live');
reset role;
select set_config('test.yoga', (select id::text from classes where name = 'YOGA'), false);
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0293-0000000000a0', id, pg_temp.mid(1) from class_sessions where class_id = current_setting('test.yoga')::uuid and scheduled_at > now() order by scheduled_at limit 1;

create temp table before_cancel as
select
  (select count(*) from class_sessions where class_id = current_setting('test.spin')::uuid) as sessions_n,
  (select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.spin')::uuid) as bookings_n,
  (select count(*) from notifications) as notifications_n,
  (select count(*) from private.class_reminder_dispatches) as dispatches_n;

-- ============================================================================
-- cancel_class as a Manager: eight bookings on future sessions
-- ============================================================================
set local role authenticated;
select pg_temp.manager();
select lives_ok($$select set_config('test.res', cancel_class(current_setting('test.spin')::uuid)::text, false)$$, 'a Manager cancels the class');
reset role;

select is(pg_temp.res(), '{"bookings_cancelled": 8}'::jsonb, 'cancel_class returns the server-computed count of bookings on future sessions');
select ok((select cancelled_at is not null from classes where id = current_setting('test.spin')::uuid), 'the class is flagged');
select is((select cancelled_by from classes where id = current_setting('test.spin')::uuid), '00000000-0000-0000-0293-000000000302'::uuid, 'cancelled_by is the cancelling Manager''s member id');
select is((select count(*)::int from class_sessions where class_id = current_setting('test.spin')::uuid and scheduled_at > now() and cancelled_at is null), 0, 'every future session is flagged');
select ok((select count(*) from class_sessions where class_id = current_setting('test.spin')::uuid and scheduled_at > now() and cancelled_at is not null) > 2, 'there were future sessions to flag');
select is((select cancelled_at from class_sessions where id = '00000000-0000-0000-0293-000000000501'), null, 'the past session is not flagged');
select is((select count(*) from class_sessions where class_id = current_setting('test.spin')::uuid), (select sessions_n from before_cancel), 'no session was deleted');
select is(
  (select count(*) from class_bookings b join class_sessions s on s.id = b.class_session_id where s.class_id = current_setting('test.spin')::uuid),
  (select bookings_n from before_cancel), 'no booking was deleted (the member keeps the booking on record)');
select ok(exists (select 1 from class_bookings where class_session_id = '00000000-0000-0000-0293-000000000501' and attended_at is not null), 'the past attended booking is untouched');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.spin') and action_type = 'class_cancelled'), 1, 'one class_cancelled audit row');
select is((select metadata from audit_log where target_entity_id = current_setting('test.spin') and action_type = 'class_cancelled'),
  '{"class_name": "SPIN", "bookings_cancelled": 8}'::jsonb, 'the audit row carries the class name and the booking count');
select is((select actor_display_name from audit_log where target_entity_id = current_setting('test.spin') and action_type = 'class_cancelled'), 'CANCEL A MANAGER', 'the audit row names the actor');
select is((select count(*) from notifications), (select notifications_n from before_cancel), 'no notifications row was created');
select is((select count(*) from private.class_reminder_dispatches), (select dispatches_n from before_cancel), 'no dispatch row was created');
select is((select count(*)::int from class_sessions_with_match where class_id = current_setting('test.spin')::uuid and cancelled_at is not null),
  (select count(*)::int from class_sessions where class_id = current_setting('test.spin')::uuid and cancelled_at is not null), 'the view carries cancelled_at');

-- Cancelling again, and the constraint on cancelled_by.
set local role authenticated;
select pg_temp.manager();
select throws_like($$select cancel_class(current_setting('test.spin')::uuid)$$, 'cancel_class: class % is already cancelled', 'cancelling again raises the stable "already cancelled" message');
reset role;
select throws_like($$update classes set cancelled_by = '00000000-0000-0000-0293-000000000302' where id = current_setting('test.yoga')::uuid$$,
  '%classes_cancelled_by_needs_cancelled_at%', 'cancelled_by cannot be set while cancelled_at is null');
select is((select count(*)::int from audit_log where target_entity_id = current_setting('test.spin') and action_type = 'class_cancelled'), 1, 'the refused second cancel wrote no second audit row');

-- ============================================================================
-- A cancelled class: daily job, update_class, materialize_class_sessions
-- ============================================================================
delete from class_sessions where class_id = current_setting('test.spin')::uuid and scheduled_at > now() and id not in (select class_session_id from class_bookings);
select set_config('test.md5', (select md5(string_agg(id::text || scheduled_at::text, ',' order by id)) from class_sessions where class_id = current_setting('test.spin')::uuid), false);
select run_class_session_materializer_job();
select private.materialize_sessions_for_class(current_setting('test.spin')::uuid);
select is((select md5(string_agg(id::text || scheduled_at::text, ',' order by id)) from class_sessions where class_id = current_setting('test.spin')::uuid), current_setting('test.md5'),
  'the daily job and the shared materializer generate nothing for a cancelled class');
select is((select jobs.status from job_runs jobs where job_name = 'class_session_materializer' order by started_at desc limit 1), 'success', 'the job still logs a successful run');

set local role authenticated;
select pg_temp.manager();
select throws_like(
  $$select update_class(current_setting('test.spin')::uuid, 'Spin', null, '00000000-0000-0000-0293-000000000303', 20, 'recurring', null, null, null, current_date, '[{"weekday":2,"start_time":"10:00"}]'::jsonb)$$,
  'update_class: class % is already cancelled', 'update_class (p_slots) refuses a cancelled class');
select throws_like(
  $$select update_class(current_setting('test.spin')::uuid, 'Spin', null, '00000000-0000-0000-0293-000000000303', 20, 'recurring', null, array[2]::smallint[], '10:00', current_date)$$,
  'update_class: class % is already cancelled', 'the old update_class refuses a cancelled class too');
select throws_like($$select materialize_class_sessions(current_setting('test.spin')::uuid)$$,
  'materialize_class_sessions: class % is already cancelled', 'materialize_class_sessions refuses a cancelled class');
select throws_like($$select materialize_class_sessions(current_setting('test.spin')::uuid, true)$$,
  'materialize_class_sessions: class % is already cancelled', 'materialize_class_sessions(id, true) refuses a cancelled class');
reset role;
select is((select count(*)::int from class_schedule_slots where class_id = current_setting('test.spin')::uuid), 3, 'the refused edits left the slots alone');

-- ============================================================================
-- Member side: book, cancel booking, lists
-- ============================================================================
set local role authenticated;
select pg_temp.member(5);
select throws_like($$select book_class_session(current_setting('test.s1')::uuid)$$, 'book_class_session: session % is cancelled', 'a member cannot book a cancelled session');
select pg_temp.member(1);
select throws_like($$select cancel_class_booking((select id from class_bookings where class_session_id = current_setting('test.s1')::uuid and member_id = pg_temp.mid(1)))$$,
  'cancel_class_booking: booking % is on a cancelled class', 'a member cannot cancel a booking on a cancelled class');
select is((select count(*)::int from list_bookable_class_sessions() where class_name = 'SPIN'), 0, 'list_bookable_class_sessions omits a cancelled class');
select ok((select count(*) from list_bookable_class_sessions() where class_name = 'YOGA') > 0, 'and still lists a live class');
select is((select class_cancelled from list_my_class_bookings() where class_name = 'SPIN' and scheduled_at = (select scheduled_at from class_sessions where id = current_setting('test.s1')::uuid)), true,
  'list_my_class_bookings marks the booking class_cancelled');
select is((select can_cancel from list_my_class_bookings() where class_name = 'SPIN' and scheduled_at = (select scheduled_at from class_sessions where id = current_setting('test.s1')::uuid)), false,
  'and can_cancel is false');
select is((select class_cancelled from list_my_class_bookings() where class_name = 'YOGA' limit 1), false, 'a live class booking is not class_cancelled');
select is((select can_cancel from list_my_class_bookings() where class_name = 'YOGA' limit 1), true, 'and can still be cancelled');
reset role;
select is((select count(*)::int from class_bookings where class_session_id = current_setting('test.s1')::uuid), 6, 'the refused member cancel left the bookings on record');

-- ============================================================================
-- Attendance marking on a cancelled session
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0293-000000000204', 'receptionist');
select throws_like($$select mark_class_attendance((select id from class_bookings where class_session_id = current_setting('test.s1')::uuid and member_id = pg_temp.mid(1)))$$,
  'mark_class_attendance: booking % is on a cancelled class', 'mark_class_attendance refuses a booking on a cancelled session');
reset role;
select ok((select attended_at is null from class_bookings where class_session_id = current_setting('test.s1')::uuid and member_id = pg_temp.mid(1)), 'the booking was not marked attended');
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0293-000000000204', 'receptionist');
select lives_ok($$select mark_class_attendance((select b.id from class_bookings b where b.class_session_id = '00000000-0000-0000-0293-000000000501' and b.attended_at is not null limit 1))$$,
  'the past session of the cancelled class still answers mark_class_attendance (attendance stays on record)');
reset role;

-- ============================================================================
-- The class reminder: a booked session starting in 30 minutes, once live and once cancelled
-- ============================================================================
set local role authenticated;
select pg_temp.manager();
select lives_ok($$select create_class('Soon live', null, '00000000-0000-0000-0293-000000000303', 5, 'one_off', now() + interval '30 minutes', null, null, null, null)$$, 'a one-off class starting in 30 minutes (control)');
select lives_ok($$select create_class('Soon cancelled', null, '00000000-0000-0000-0293-000000000303', 5, 'one_off', now() + interval '31 minutes', null, null, null, null)$$, 'another one');
reset role;
insert into class_bookings (gym_id, class_session_id, member_id)
select '00000000-0000-0000-0293-0000000000a0', s.id, pg_temp.mid(2) from class_sessions s join classes c on c.id = s.class_id where c.name in ('SOON LIVE', 'SOON CANCELLED');
set local role authenticated;
select pg_temp.manager();
select lives_ok($$select cancel_class((select id from classes where name = 'SOON CANCELLED'))$$, 'the second one is cancelled');
reset role;
select run_class_reminder_job();
select is((select count(*)::int from private.class_reminder_dispatches d join class_sessions s on s.id = d.class_session_id join classes c on c.id = s.class_id where c.name = 'SOON LIVE'), 1,
  'control: the live class''s booked member gets a reminder dispatch');
select is((select count(*)::int from private.class_reminder_dispatches d join class_sessions s on s.id = d.class_session_id join classes c on c.id = s.class_id where c.name = 'SOON CANCELLED'), 0,
  'a booked, cancelled session with a reminder due produces no class_reminder_dispatches row');
select private.send_class_reminder(pg_temp.mid(2), (select s.id from class_sessions s join classes c on c.id = s.class_id where c.name = 'SOON CANCELLED'));
select is((select count(*)::int from private.class_reminder_dispatches d join class_sessions s on s.id = d.class_session_id join classes c on c.id = s.class_id where c.name = 'SOON CANCELLED'), 0,
  'calling send_class_reminder directly for the cancelled session dispatches nothing either');
select is((select count(*)::int from notifications n where n.member_id = pg_temp.mid(2) and n.type = 'N-07'), 1, 'only the live class produced a reminder notification');

-- ============================================================================
-- Who may cancel; zero bookings; the Coach's list
-- ============================================================================
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0293-000000000201', 'owner');
select lives_ok($$select set_config('test.res', cancel_class(current_setting('test.yoga')::uuid)::text, false)$$, 'an Owner cancels a class');
reset role;
select is(pg_temp.res(), '{"bookings_cancelled": 1}'::jsonb, 'the Owner''s cancel counts the one booking');
set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0293-000000000205', 'supervisor');
select pg_temp.manager();
select lives_ok($$select create_class('Empty', null, '00000000-0000-0000-0293-000000000303', 5, 'recurring', null, null, null, current_date, '[{"weekday":4,"start_time":"12:00"}]'::jsonb)$$, 'a class nobody booked');
select pg_temp.as_role('00000000-0000-0000-0293-000000000205', 'supervisor');
select lives_ok($$select set_config('test.res', cancel_class((select id from classes where name = 'EMPTY'))::text, false)$$, 'a Supervisor cancels a class');
reset role;
select is(pg_temp.res(), '{"bookings_cancelled": 0}'::jsonb, 'a class with no bookings reports zero');
select is((select cancelled_by from classes where name = 'EMPTY'), '00000000-0000-0000-0293-000000000305'::uuid, 'cancelled_by is the Supervisor''s member id');

set local role authenticated;
select pg_temp.as_role('00000000-0000-0000-0293-000000000203', 'coach');
select is((select count(*)::int from list_my_classes() where class_name = 'SPIN' and cancelled_at is not null), 1, 'the Coach''s list shows the class with cancelled_at (one row, no sessions)');
select is((select count(*)::int from list_my_classes() where class_name = 'SPIN' and class_session_id is not null and scheduled_at > now()), 0, 'and no upcoming session of the cancelled class');
reset role;

-- A cancelled class's old and new overloads cannot resurrect it: create_class still works for a new class with the same name.
set local role authenticated;
select pg_temp.manager();
select lives_ok($$select create_class('Spin', null, '00000000-0000-0000-0293-000000000303', 20, 'recurring', null, null, null, current_date, '[{"weekday":6,"start_time":"08:00"}]'::jsonb)$$,
  'a new class can reuse a cancelled class''s name');
reset role;
select is((select count(*)::int from classes where name = 'SPIN' and cancelled_at is null), 1, 'exactly one live Spin exists next to the cancelled one');

-- A one-off class whose session is already past has nothing left to cancel; a recurring class is always cancellable, even before its first session exists.
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0293-000000000601', '00000000-0000-0000-0293-0000000000a0', 'Finished one-off', '00000000-0000-0000-0293-000000000303', 5, 'one_off', now() - interval '3 days');
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0293-000000000602', '00000000-0000-0000-0293-0000000000a0', '00000000-0000-0000-0293-000000000601', now() - interval '3 days');
set local role authenticated;
select pg_temp.manager();
select throws_like($$select cancel_class('00000000-0000-0000-0293-000000000601')$$, '%has nothing left to cancel%', 'a one-off class whose session is past is refused');
reset role;
select is((select cancelled_at from classes where id = '00000000-0000-0000-0293-000000000601'), null, 'and it is not flagged');
select is((select count(*)::int from audit_log where target_entity_id = '00000000-0000-0000-0293-000000000601' and action_type = 'class_cancelled'), 0, 'and it wrote no audit row');
set local role authenticated;
select pg_temp.manager();
select lives_ok($$select create_class('Later', null, '00000000-0000-0000-0293-000000000303', 5, 'recurring', null, null, null, current_date + 60, '[{"weekday":2,"start_time":"10:00"}]'::jsonb)$$,
  'a recurring class that starts in two months (no session yet)');
select lives_ok($$select cancel_class((select id from classes where name = 'LATER'))$$, 'is still cancellable');
reset role;
select isnt((select cancelled_at from classes where name = 'LATER'), null, 'and flagged');

select * from finish();
rollback;
