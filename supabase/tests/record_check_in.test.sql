-- Story 27.2: private.record_check_in, the one inserter of attendance_events (migration 0174).
--
-- Proves: the source / entered_by / voided_by / void_reason columns and their CHECKs, the voided_at-aware one-open index (same name,
-- same SQLSTATE and message, a voided open row no longer blocks), visit_day passed explicitly and equal to the trigger backstop, the lock
-- statement as the first statement of the body, privileges (EXECUTE and the 0111 direct-write revokes), every outcome of the function
-- called directly (including a staff source), that it writes no alert and no attempt row, and that attendance_counted carries source and
-- never entered_by. The scan path's own behaviour is pinned by check_in_record_path.test.sql (committed before this migration).
-- Two simultaneous callers cannot be shown by one pgTAP session: scripts/check-in-member-lock-race.sh does that.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002740xx.

begin;
select plan(71);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000274001', 'RCI Tier', 6000, 60000, null);

-- A: non-charging, Douala. C: charging. S: suspended (seeded suspended in its INSERT: a bare UPDATE of gyms.status is silently reverted).
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone) values
  ('00000000-0000-0000-0000-000000274011', 'RCI Gym A', '00000000-0000-0000-0000-000000274001', 'active',    false, 0, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000274012', 'RCI Gym C', '00000000-0000-0000-0000-000000274001', 'active',    true,  0, 'Africa/Douala'),
  ('00000000-0000-0000-0000-000000274013', 'RCI Gym S', '00000000-0000-0000-0000-000000274001', 'suspended', false, 0, 'Africa/Douala');

insert into auth.users (id)
select ('00000000-0000-0000-0000-0000002741' || lpad(to_hex(g), 2, '0'))::uuid from generate_series(1, 20) g;

-- 01 staff actor (receptionist, Gym A). 02-0e members of A (02 scan, 03 staff entry, 04 expired, 05 stale open, 06 replay, 07 index,
-- 08 voided-open, 09 CHECK fixtures, 0c scan over a voided open row, 0d visit_day, 0e deactivated). 0f PPS member at C. 10 member of S.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select ('00000000-0000-0000-0000-0000002742' || lpad(to_hex(g), 2, '0'))::uuid,
       case when g = 16 then '00000000-0000-0000-0000-000000274013'
            when g = 15 then '00000000-0000-0000-0000-000000274012'
            else             '00000000-0000-0000-0000-000000274011' end::uuid,
       ('00000000-0000-0000-0000-0000002741' || lpad(to_hex(g), 2, '0'))::uuid,
       (case when g = 1 then 'receptionist' else 'member' end)::member_role,
       'RCI Member ' || g, current_date,
       case when g = 14 then now() - interval '1 day' end
from generate_series(1, 16) g;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000274301', '00000000-0000-0000-0000-000000274011', 'RCI Monthly',   'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000274302', '00000000-0000-0000-0000-000000274012', 'RCI PPS',       'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000274303', '00000000-0000-0000-0000-000000274013', 'RCI Monthly S', 'monthly',         15000, 'XAF', 'monthly', 30);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id, s.plan_id::uuid, s.status::subscription_status, current_date - 5, s.expiry_date
from (values
  (2,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (3,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (4,  'expired', current_date - 1,  '00000000-0000-0000-0000-000000274301'),
  (5,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (6,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (7,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (8,  'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (12, 'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (13, 'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (14, 'active',  current_date + 25, '00000000-0000-0000-0000-000000274301'),
  (15, 'active',  null,              '00000000-0000-0000-0000-000000274302'),
  (16, 'active',  current_date + 25, '00000000-0000-0000-0000-000000274303')
) as s(n, status, expiry_date, plan_id)
join members m on m.id = ('00000000-0000-0000-0000-0000002742' || lpad(to_hex(s.n), 2, '0'))::uuid;

-- Session claims for the direct calls (current_gym_status() reads the session's gym).
create function pg_temp.claims(p_user uuid, p_gym uuid) returns text language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', 'member')::text, true)
$f$;

-- ============================================================================
-- (1) Columns and CHECKs
-- ============================================================================
select col_type_is('public', 'attendance_events', 'source', 'text', 'source is text');
select col_not_null('public', 'attendance_events', 'source', 'source is NOT NULL');
select col_default_is('public', 'attendance_events', 'source', 'qr', 'source defaults to qr (every earlier row is a scan)');
select col_is_null('public', 'attendance_events', 'entered_by', 'entered_by is nullable');
select col_is_null('public', 'attendance_events', 'voided_by', 'voided_by is nullable');
select col_is_null('public', 'attendance_events', 'void_reason', 'void_reason is nullable');
select is(
  (select array_agg(confrelid::regclass::text order by a.attname)
   from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.attendance_events'::regclass and c.contype = 'f' and a.attname in ('entered_by', 'voided_by')),
  array['users', 'users'],
  'entered_by and voided_by reference users, like payments.actor_id'
);


-- Closed rows that satisfy every other CHECK, so the one-open index is out of the way. Member 09, Gym A.
-- ids: u = user 01 (an existing users row), m = member 09.
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, source)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', 'kiosk') $$,
  '23514', null, 'source outside (qr, staff) is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, source)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', 'staff') $$,
  '23514', null, 'a staff row without entered_by is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, source, entered_by)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', 'qr', '00000000-0000-0000-0000-000000274101') $$,
  '23514', null, 'a qr row with entered_by is refused');
select lives_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, source, entered_by)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', 'staff', '00000000-0000-0000-0000-000000274101') $$,
  'a staff row with entered_by is accepted');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), 'wrong person') $$,
  '23514', null, 'voided_at and void_reason without voided_by are refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101') $$,
  '23514', null, 'voided_at and voided_by without void_reason are refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', 'wrong person') $$,
  '23514', null, 'void_reason alone is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_by)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', '00000000-0000-0000-0000-000000274101') $$,
  '23514', null, 'voided_by alone is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', 'abcd') $$,
  '23514', null, 'a 4 character reason is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', '   abcd   ') $$,
  '23514', null, 'a reason of 4 characters after trimming is refused');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', '        ') $$,
  '23514', null, 'a blank reason is refused');
select lives_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', 'abcde') $$,
  'a 5 character reason with all three void columns is accepted');
select lives_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', repeat('x', 300)) $$,
  'a 300 character reason is accepted');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', now() - interval '3 hours', now() - interval '2 hours', now(), '00000000-0000-0000-0000-000000274101', repeat('x', 301)) $$,
  '23514', null, 'a 301 character reason is refused');

-- ============================================================================
-- (2) The one-open index: same name, voided rows no longer count as open
-- ============================================================================
select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'idx_attendance_events_one_open_per_member'),
  'CREATE UNIQUE INDEX idx_attendance_events_one_open_per_member ON public.attendance_events USING btree (member_id) WHERE ((checked_out_at IS NULL) AND (voided_at IS NULL))',
  'the index keeps its name and now excludes voided rows');
select is((select count(*)::int from pg_indexes where tablename = 'attendance_events' and indexname like '%one_open%'), 1, 'exactly one one-open index exists');

insert into attendance_events (gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274207', now() - interval '10 minutes');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at) values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274207', now()) $$,
  '23505', 'duplicate key value violates unique constraint "idx_attendance_events_one_open_per_member"',
  'a second open row for the member is still refused with the same SQLSTATE and message');

-- 08: an open row with voided_at set is not open
select lives_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at, voided_at, voided_by, void_reason)
     values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274208', now() - interval '20 minutes', now(), '00000000-0000-0000-0000-000000274101', 'wrong person') $$,
  'a voided row may carry no check-out');
select lives_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at) values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274208', now()) $$,
  'an open row with voided_at set no longer blocks a new open row');
select throws_ok(
  $$ insert into attendance_events (gym_id, member_id, checked_in_at) values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274208', now()) $$,
  '23505', null, 'but the new open row is itself the one open row');

-- 0c: the scan path reads voided_at is null too (an open voided row neither blocks nor is auto-closed)
insert into attendance_events (id, gym_id, member_id, checked_in_at, voided_at, voided_by, void_reason) values
  ('00000000-0000-0000-0000-0000002746c1', '00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-00000027420c', now() - interval '20 hours', now(), '00000000-0000-0000-0000-000000274101', 'wrong person');
select pg_temp.claims('00000000-0000-0000-0000-00000027410c', '00000000-0000-0000-0000-000000274011');
set local role authenticated;
select isnt((select ae.id from check_in() ae), null, 'a scan succeeds over a stale voided open row');
reset role;
select is((select checked_out_at is null and checkout_type is null from attendance_events where id = '00000000-0000-0000-0000-0000002746c1'),
          true, 'the voided open row was not auto-closed');

-- ============================================================================
-- (3) visit_day: passed explicitly, equal to the trigger backstop
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-00000027410d', '00000000-0000-0000-0000-000000274011');
select is((select (r.event).visit_day from private.record_check_in('00000000-0000-0000-0000-00000027420d', '00000000-0000-0000-0000-000000274011', 'qr',
             '00000000-0000-0000-0000-00000027410d', timestamptz '2026-11-07 23:30:00+00', null) r),
          date '2026-11-08', 'visit_day is the gym-local day (Douala is UTC+1: 23:30 UTC on 7 Nov is 8 Nov)');
select is(
  (select ae.visit_day = private.gym_local_date(ae.gym_id, ae.checked_in_at) from attendance_events ae where ae.member_id = '00000000-0000-0000-0000-00000027420d'),
  true, 'the explicit visit_day equals private.gym_local_date');
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at)
values ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274209', timestamptz '2026-11-07 23:30:00+00', timestamptz '2026-11-08 01:00:00+00');
select is(
  (select visit_day from attendance_events where member_id = '00000000-0000-0000-0000-000000274209' and checked_in_at = timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-08', 'the BEFORE INSERT trigger backstop computes the same day for the same instant');

-- ============================================================================
-- (4) The body: the member lock is the first statement
-- ============================================================================
create function pg_temp.rci_src() returns text language sql as $f$
  select regexp_replace(prosrc, '--[^\n]*', '', 'g') from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure
$f$;
select matches(
  pg_temp.rci_src(),
  'begin\s+select\s+m\.deactivated_at\s+into\s+v_deactivated_at\s+from\s+members\s+m\s+where[^;]*for no key update\s*;',
  'the first statement of record_check_in is the member lock (FOR NO KEY UPDATE)');
select is(
  position('for no key update' in pg_temp.rci_src()) < least(
    position('current_gym_status' in pg_temp.rci_src()),
    position('consume_guest_session' in pg_temp.rci_src()),
    position('from attendance_events' in pg_temp.rci_src()),
    position('from subscriptions' in pg_temp.rci_src())),
  true, 'the lock precedes the status check, the plan read, the open-row lookup and the session gate');
select is(position('current_gym_status' in pg_temp.rci_src()) < position('insert into attendance_events' in pg_temp.rci_src()), true,
          'the gym status check precedes the insert');
select is(position('private.gym_local_date' in pg_temp.rci_src()) > 0, true, 'the insert passes visit_day explicitly');
select is(position('record_check_in' in (select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure)) > 0, true, 'check_in() calls record_check_in');
select is(position('insert into attendance_events' in lower((select prosrc from pg_proc where oid = 'public.check_in(timestamptz, uuid)'::regprocedure))), 0,
          'check_in() no longer inserts into attendance_events');

-- ============================================================================
-- (5) Privileges
-- ============================================================================
select is((select prosecdef from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure), true, 'record_check_in is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure), array['search_path=public'], 'record_check_in has search_path public');
select is((select not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0)
           from pg_proc where oid = 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure), true, 'EXECUTE is revoked from public');
select is(has_function_privilege('anon', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)', 'EXECUTE'), false, 'EXECUTE is revoked from anon');
select is(has_function_privilege('authenticated', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)', 'EXECUTE'), false, 'EXECUTE is revoked from authenticated');
select is(has_function_privilege('service_role', 'private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)', 'EXECUTE'), false, 'EXECUTE is revoked from service_role');
select is(has_function_privilege('anon', 'public.check_in(timestamptz, uuid)', 'EXECUTE'), false, 'check_in() is not executable by anon');
select is(has_function_privilege('authenticated', 'public.check_in(timestamptz, uuid)', 'EXECUTE'), true, 'check_in() is executable by authenticated');
select is(
  has_table_privilege('authenticated', 'public.attendance_events', 'INSERT') or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
  or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE') or has_table_privilege('service_role', 'public.attendance_events', 'INSERT')
  or has_table_privilege('service_role', 'public.attendance_events', 'UPDATE') or has_table_privilege('service_role', 'public.attendance_events', 'DELETE'),
  false, '0111 write revokes still hold: no client role can INSERT, UPDATE or DELETE attendance_events');

-- ============================================================================
-- (6) Outcomes, called directly (a staff-shaped call as a fixture; the staff function itself is 27.3)
-- ============================================================================
select pg_temp.claims('00000000-0000-0000-0000-000000274101', '00000000-0000-0000-0000-000000274011');

-- a scan: entered_by is ignored (a scan passes its own uid)
select is((select r.outcome || '/' || r.member_status::text || '/' || ((r.event).id is not null)::text
           from private.record_check_in('00000000-0000-0000-0000-000000274202', '00000000-0000-0000-0000-000000274011', 'qr', '00000000-0000-0000-0000-000000274101', null) r),
          'checked_in/active/true', 'a scan is checked in');
select is((select source || '/' || coalesce(entered_by::text, 'null') from attendance_events where member_id = '00000000-0000-0000-0000-000000274202'),
          'qr/null', 'a qr entry ignores the actor: entered_by stays null');

-- a staff-shaped call (the 27.3 caller): entered_by is the actor
select is((select r.outcome from private.record_check_in('00000000-0000-0000-0000-000000274203', '00000000-0000-0000-0000-000000274011', 'staff', '00000000-0000-0000-0000-000000274101', now()) r),
          'checked_in', 'a staff entry is checked in under the same rules');
select is((select source || '/' || entered_by::text from attendance_events where member_id = '00000000-0000-0000-0000-000000274203'),
          'staff/00000000-0000-0000-0000-000000274101', 'a staff entry records source staff and the actor in entered_by');
select is((select source from attendance_counted where member_id = '00000000-0000-0000-0000-000000274203'), 'staff', 'attendance_counted carries source');
select is((select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'public.attendance_counted'::regclass and attnum > 0 and not attisdropped),
          array['id', 'gym_id', 'member_id', 'checked_in_at', 'checked_out_at', 'checkout_type', 'visit_day', 'created_at', 'client_scan_id', 'source'],
          'attendance_counted appends source and never carries entered_by or a void column');

-- already open: no write, the open row comes back
select is((select r.outcome || '/' || ((r.event).id = (select id from attendance_events where member_id = '00000000-0000-0000-0000-000000274203'))::text
           from private.record_check_in('00000000-0000-0000-0000-000000274203', '00000000-0000-0000-0000-000000274011', 'staff', '00000000-0000-0000-0000-000000274101', now()) r),
          'already_open/true', 'a second entry while one is open returns already_open with the open row');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000274203'), 1, 'already_open wrote nothing');

-- blocked_expired
select is((select r.outcome || '/' || r.member_status::text || '/' || ((r.event).id is not null)::text
           from private.record_check_in('00000000-0000-0000-0000-000000274204', '00000000-0000-0000-0000-000000274011', 'qr', '00000000-0000-0000-0000-000000274101', null) r),
          'blocked_expired/expired/false', 'an expired member is blocked_expired');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000274204'), 0, 'blocked_expired wrote no row');

-- blocked_session (charging gym, Pay-per-session, no usable session)
select pg_temp.claims('00000000-0000-0000-0000-00000027410f', '00000000-0000-0000-0000-000000274012');
select is((select r.outcome || '/' || ((r.event).id is not null)::text
           from private.record_check_in('00000000-0000-0000-0000-00000027420f', '00000000-0000-0000-0000-000000274012', 'qr', '00000000-0000-0000-0000-00000027410f', null) r),
          'blocked_session/false', 'a Pay-per-session member with no session is blocked_session');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-00000027420f'), 0, 'blocked_session wrote no row');

-- replay
select pg_temp.claims('00000000-0000-0000-0000-000000274106', '00000000-0000-0000-0000-000000274011');
select is((select r.outcome from private.record_check_in('00000000-0000-0000-0000-000000274206', '00000000-0000-0000-0000-000000274011', 'qr', '00000000-0000-0000-0000-000000274106',
             now() - interval '1 hour', '00000000-0000-0000-0000-0000002747a1') r), 'checked_in', 'an offline scan is checked in');
select is((select r.outcome || '/' || ((r.event).id = (select id from attendance_events where member_id = '00000000-0000-0000-0000-000000274206'))::text
           from private.record_check_in('00000000-0000-0000-0000-000000274206', '00000000-0000-0000-0000-000000274011', 'qr', '00000000-0000-0000-0000-000000274106',
             now() - interval '1 hour', '00000000-0000-0000-0000-0000002747a1') r), 'replayed/true', 'the same scan id is replayed with the stored row');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000274206'), 1, 'a replay inserts nothing');

-- stale open row: auto-closed, then a new entry
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-0000002746c5', '00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274205', now() - interval '10 hours');
select pg_temp.claims('00000000-0000-0000-0000-000000274105', '00000000-0000-0000-0000-000000274011');
select is((select r.outcome from private.record_check_in('00000000-0000-0000-0000-000000274205', '00000000-0000-0000-0000-000000274011', 'qr', '00000000-0000-0000-0000-000000274105', null) r),
          'checked_in', 'a stale open row does not block');
select is((select checkout_type from attendance_events where id = '00000000-0000-0000-0000-0000002746c5'), 'auto', 'the stale row was auto-closed');
select is((select count(*)::int from audit_log where action_type = 'attendance_stale_check_in_auto_closed' and target_entity_id = '00000000-0000-0000-0000-0000002746c5'), 1,
          'the auto-close wrote its audit row');

-- refusals
select throws_ok(
  $$ select 1 from private.record_check_in('00000000-0000-0000-0000-00000027420e', '00000000-0000-0000-0000-000000274011', 'qr', null, null) $$,
  'P0001', 'check_in: member is deactivated', 'a deactivated member raises');
select throws_ok(
  $$ select 1 from private.record_check_in('00000000-0000-0000-0000-000000274202', '00000000-0000-0000-0000-000000274012', 'qr', null, null) $$,
  'P0001', 'check_in: no member record found for the caller', 'a member of another gym is not found');
select pg_temp.claims('00000000-0000-0000-0000-000000274110', '00000000-0000-0000-0000-000000274013');
select throws_ok(
  $$ select 1 from private.record_check_in('00000000-0000-0000-0000-000000274210', '00000000-0000-0000-0000-000000274013', 'qr', null, null) $$,
  'P0001', 'check_in: gym 00000000-0000-0000-0000-000000274013 is not active', 'a suspended gym raises the gym-not-active text');
select is((select count(*)::int from attendance_events where member_id = '00000000-0000-0000-0000-000000274210'), 0, 'the suspended gym wrote nothing');

-- the function writes no alert and no attempt row
select is((select count(*)::int from front_desk_alerts where gym_id in ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274012', '00000000-0000-0000-0000-000000274013')), 0,
          'record_check_in wrote no front_desk_alerts row (a staff entry makes none; check_in() writes them)');
select is((select count(*)::int from session_attempts where gym_id in ('00000000-0000-0000-0000-000000274011', '00000000-0000-0000-0000-000000274012', '00000000-0000-0000-0000-000000274013')), 0,
          'record_check_in wrote no session_attempts row');

select * from finish();
rollback;
