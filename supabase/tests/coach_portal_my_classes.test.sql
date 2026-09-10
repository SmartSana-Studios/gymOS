-- Story 17.4: Coach Portal My Classes. Tests list_my_classes() and
-- list_my_class_session_roster() (0096_coach_portal_my_classes.sql) -- both
-- SECURITY DEFINER, read-only, and the epic's only new privilege.
--
-- What must hold, and why it is worth a test each:
--   * The Coach reaches ONLY their own classes and rosters. Every other
--     caller -- another coach, another gym, a deactivated coach, staff, a
--     member, a member holding a forged coach claim, no gym claim, a coach
--     demoted with a stale JWT -- gets an empty set, never an error.
--   * DEFINER rights are genuinely needed: under plain RLS the same coach
--     reads 0 class_bookings and 0 names of booked, unassigned members, while
--     a receptionist's positive control reads the bookings.
--   * booked_count counts EVERY booking -- unassigned and deactivated
--     members included. No coach_assignments row exists in these fixtures, so
--     every booked member is unassigned to every coach.
--   * The session window starts at 00:00 today in the GYM's timezone: a
--     session exactly at local midnight is in, one a minute before is out,
--     proven for Africa/Douala and for a UTC+14 gym under a UTC session.
--   * The roster uses the same window: yesterday's session of the Coach's own
--     class returns nothing, so a class's newly assigned coach cannot read the
--     names and attendance of sessions they never taught.
--   * The suspension guard sits below caller resolution: a non-coach at a
--     suspended gym gets the empty set, not the raise.
--   * A suspended gym's coach gets the load-bearing `is not active` raise.
--   * No RLS policy changed: the four tables' policy sets are pinned.
--
-- Style follows member_app_classes_surfaces.test.sql: fixtures inserted up
-- front as postgres, then `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)` per caller. Session times are
-- seeded relative to 0097's private.gym_local_day_bounds(tz, now()); now() is
-- fixed for the whole transaction, so no fixture can straddle midnight. The
-- suspended gym is seeded suspended IN ITS INSERT (a trigger silently reverts
-- a status UPDATE, 0014).

begin;
select plan(58);

set local timezone = 'UTC';

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0174-000000000001', 'Coach My Classes Test Tier', 0, 0, 100);

insert into gyms (id, name, tier_id, status, timezone) values
  ('00000000-0000-0000-0174-00000000a000', 'Coach Classes Gym A', '00000000-0000-0000-0174-000000000001', 'active', 'Africa/Douala'),
  ('00000000-0000-0000-0174-00000000b000', 'Coach Classes Gym B', '00000000-0000-0000-0174-000000000001', 'active', 'Africa/Douala'),
  ('00000000-0000-0000-0174-00000000c000', 'Coach Classes Gym C (suspended)', '00000000-0000-0000-0174-000000000001', 'suspended', 'Africa/Douala'),
  ('00000000-0000-0000-0174-00000000d000', 'Coach Classes Gym D (UTC+14)', '00000000-0000-0000-0174-000000000001', 'active', 'Pacific/Kiritimati');

insert into auth.users (id) values
  ('00000000-0000-0000-0174-0000000000a1'), -- Gym A: coach A1 (the primary caller)
  ('00000000-0000-0000-0174-0000000000a2'), -- Gym A: coach A2 (another coach; demoted at the very end)
  ('00000000-0000-0000-0174-0000000000a3'), -- Gym A: coach A3, deactivated
  ('00000000-0000-0000-0174-0000000000a4'), -- Gym A: receptionist
  ('00000000-0000-0000-0174-0000000000a5'), -- Gym A: manager
  ('00000000-0000-0000-0174-0000000000a6'), -- Gym A: member Alice
  ('00000000-0000-0000-0174-0000000000a7'), -- Gym A: member Bob
  ('00000000-0000-0000-0174-0000000000a8'), -- Gym A: member Carol, deactivated but still booked
  ('00000000-0000-0000-0174-0000000000a9'), -- Gym A: member Dan
  ('00000000-0000-0000-0174-0000000000b1'), -- Gym B: coach
  ('00000000-0000-0000-0174-0000000000b2'), -- Gym B: member
  ('00000000-0000-0000-0174-0000000000c1'), -- Gym C: coach
  ('00000000-0000-0000-0174-0000000000c2'), -- Gym C: member
  ('00000000-0000-0000-0174-0000000000d1'); -- Gym D: coach

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0174-0000000001a1', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a1', 'coach', 'Coach A1', null),
  ('00000000-0000-0000-0174-0000000001a2', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a2', 'coach', 'Coach A2', null),
  ('00000000-0000-0000-0174-0000000001a3', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a3', 'coach', 'Coach A3 (deactivated)', now()),
  ('00000000-0000-0000-0174-0000000001a4', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a4', 'receptionist', 'Receptionist A', null),
  ('00000000-0000-0000-0174-0000000001a5', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a5', 'manager', 'Manager A', null),
  ('00000000-0000-0000-0174-0000000001a6', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a6', 'member', 'Alice Member', null),
  ('00000000-0000-0000-0174-0000000001a7', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a7', 'member', 'Bob Member', null),
  ('00000000-0000-0000-0174-0000000001a8', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a8', 'member', 'Carol Deactivated', now()),
  ('00000000-0000-0000-0174-0000000001a9', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000000a9', 'member', 'Dan Member', null),
  ('00000000-0000-0000-0174-0000000001b1', '00000000-0000-0000-0174-00000000b000', '00000000-0000-0000-0174-0000000000b1', 'coach', 'Coach B', null),
  ('00000000-0000-0000-0174-0000000001b2', '00000000-0000-0000-0174-00000000b000', '00000000-0000-0000-0174-0000000000b2', 'member', 'Member B', null),
  ('00000000-0000-0000-0174-0000000001c1', '00000000-0000-0000-0174-00000000c000', '00000000-0000-0000-0174-0000000000c1', 'coach', 'Coach C', null),
  ('00000000-0000-0000-0174-0000000001c2', '00000000-0000-0000-0174-00000000c000', '00000000-0000-0000-0174-0000000000c2', 'member', 'Member C', null),
  ('00000000-0000-0000-0174-0000000001d1', '00000000-0000-0000-0174-00000000d000', '00000000-0000-0000-0174-0000000000d1', 'coach', 'Coach D', null);

-- classes_schedule_matches_type (0057:43-52): a recurring class needs all three
-- recurrence_* columns; a one-off class needs one_off_session_at and none of them.
insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at, recurrence_days, recurrence_time, recurrence_start_date) values
  ('00000000-0000-0000-0174-0000000002a1', '00000000-0000-0000-0174-00000000a000', 'HIIT Circuit', '00000000-0000-0000-0174-0000000001a1', 15, 'recurring', null, '{1,3,5}', '18:00', current_date),
  ('00000000-0000-0000-0174-0000000002a0', '00000000-0000-0000-0174-00000000a000', 'Archived Workshop', '00000000-0000-0000-0174-0000000001a1', 10, 'one_off', now() - interval '10 days', null, null, null),
  ('00000000-0000-0000-0174-0000000002a2', '00000000-0000-0000-0174-00000000a000', 'Other Coach Class', '00000000-0000-0000-0174-0000000001a2', 8, 'one_off', now() + interval '1 day', null, null, null),
  ('00000000-0000-0000-0174-0000000002a3', '00000000-0000-0000-0174-00000000a000', 'Deactivated Coach Class', '00000000-0000-0000-0174-0000000001a3', 6, 'one_off', now() + interval '1 day', null, null, null),
  ('00000000-0000-0000-0174-0000000002b1', '00000000-0000-0000-0174-00000000b000', 'Gym B Class', '00000000-0000-0000-0174-0000000001b1', 5, 'one_off', now() + interval '1 day', null, null, null),
  ('00000000-0000-0000-0174-0000000002c1', '00000000-0000-0000-0174-00000000c000', 'Gym C Class', '00000000-0000-0000-0174-0000000001c1', 5, 'one_off', now() + interval '1 day', null, null, null),
  ('00000000-0000-0000-0174-0000000002d1', '00000000-0000-0000-0174-00000000d000', 'Gym D Class', '00000000-0000-0000-0174-0000000001d1', 5, 'one_off', now() + interval '1 day', null, null, null);

-- A plain insert into classes materializes nothing, so every session is
-- inserted by hand.
insert into class_sessions (id, gym_id, class_id, scheduled_at) values
  -- HIIT: exactly local 00:00 today (in), 23:59 yesterday (out), in two days (in)
  ('00000000-0000-0000-0174-0000000003a1', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a1',
     (select day_start from private.gym_local_day_bounds('Africa/Douala', now()))),
  ('00000000-0000-0000-0174-0000000003a2', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a1',
     (select day_start from private.gym_local_day_bounds('Africa/Douala', now())) - interval '1 minute'),
  ('00000000-0000-0000-0174-0000000003a3', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a1', now() + interval '2 days'),
  -- Archived Workshop: its only session is long past
  ('00000000-0000-0000-0174-0000000003a4', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a0', now() - interval '10 days'),
  ('00000000-0000-0000-0174-0000000003a5', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a2', now() + interval '1 day'),
  ('00000000-0000-0000-0174-0000000003a6', '00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000002a3', now() + interval '1 day'),
  ('00000000-0000-0000-0174-0000000003b1', '00000000-0000-0000-0174-00000000b000', '00000000-0000-0000-0174-0000000002b1', now() + interval '1 day'),
  ('00000000-0000-0000-0174-0000000003c1', '00000000-0000-0000-0174-00000000c000', '00000000-0000-0000-0174-0000000002c1', now() + interval '1 day'),
  -- Gym D (UTC+14): local midnight (in) and a minute before (out)
  ('00000000-0000-0000-0174-0000000003d1', '00000000-0000-0000-0174-00000000d000', '00000000-0000-0000-0174-0000000002d1',
     (select day_start from private.gym_local_day_bounds('Pacific/Kiritimati', now()))),
  ('00000000-0000-0000-0174-0000000003d2', '00000000-0000-0000-0174-00000000d000', '00000000-0000-0000-0174-0000000002d1',
     (select day_start from private.gym_local_day_bounds('Pacific/Kiritimati', now())) - interval '1 minute');

-- Seven Gym A bookings: today Alice (attended); yesterday Dan; in two days Bob,
-- Alice and Carol (deactivated); Other Coach Class Dan; the deactivated coach's
-- class Alice. Plus one each in Gyms B and C.
insert into class_bookings (gym_id, class_session_id, member_id, attended_at) values
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a1', '00000000-0000-0000-0174-0000000001a6', now()),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a2', '00000000-0000-0000-0174-0000000001a9', null),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a3', '00000000-0000-0000-0174-0000000001a7', null),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a3', '00000000-0000-0000-0174-0000000001a6', null),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a3', '00000000-0000-0000-0174-0000000001a8', null),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a5', '00000000-0000-0000-0174-0000000001a9', null),
  ('00000000-0000-0000-0174-00000000a000', '00000000-0000-0000-0174-0000000003a6', '00000000-0000-0000-0174-0000000001a6', null),
  ('00000000-0000-0000-0174-00000000b000', '00000000-0000-0000-0174-0000000003b1', '00000000-0000-0000-0174-0000000001b2', null),
  ('00000000-0000-0000-0174-00000000c000', '00000000-0000-0000-0174-0000000003c1', '00000000-0000-0000-0174-0000000001c2', null);

-- ============================================================================
-- Shape and privileges
-- ============================================================================

select has_function('public', 'list_my_classes', ARRAY[]::name[], 'list_my_classes() exists');
select has_function('public', 'list_my_class_session_roster', ARRAY['uuid'], 'list_my_class_session_roster(uuid) exists');
select is_definer('public', 'list_my_classes', ARRAY[]::name[], 'list_my_classes() is SECURITY DEFINER');
select is_definer('public', 'list_my_class_session_roster', ARRAY['uuid'], 'list_my_class_session_roster(uuid) is SECURITY DEFINER');
select volatility_is('public', 'list_my_classes', ARRAY[]::name[], 'stable', 'list_my_classes() is STABLE');
select volatility_is('public', 'list_my_class_session_roster', ARRAY['uuid'], 'stable', 'list_my_class_session_roster(uuid) is STABLE');

select is(
  (select proconfig from pg_proc where oid = 'public.list_my_classes()'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'list_my_classes() pins search_path to public, pg_temp'
);
select is(
  (select proconfig from pg_proc where oid = 'public.list_my_class_session_roster(uuid)'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'list_my_class_session_roster(uuid) pins search_path to public, pg_temp'
);

select ok(not has_function_privilege('anon', 'public.list_my_classes()', 'EXECUTE'), 'anon cannot execute list_my_classes()');
select ok(not has_function_privilege('anon', 'public.list_my_class_session_roster(uuid)', 'EXECUTE'), 'anon cannot execute list_my_class_session_roster(uuid)');
select ok(has_function_privilege('authenticated', 'public.list_my_classes()', 'EXECUTE'), 'authenticated can execute list_my_classes()');
select ok(has_function_privilege('authenticated', 'public.list_my_class_session_roster(uuid)', 'EXECUTE'), 'authenticated can execute list_my_class_session_roster(uuid)');

-- position(), not matches()/alike: now()'s parentheses are a regex group, and
-- `_` is an alike wildcard.
select ok(
  position($x$date_trunc('day', now() at time zone g.timezone) at time zone g.timezone$x$
           in pg_get_functiondef('public.list_my_classes()'::regprocedure)) > 0,
  'list_my_classes() computes the start of today with 0097''s day_start expression (p_at := now(), p_timezone := g.timezone)'
);
select ok(
  position('interval' in lower(pg_get_functiondef('public.list_my_classes()'::regprocedure))) = 0,
  'list_my_classes() contains no interval arithmetic -- the DST trap 0095/0097 document cannot appear in it'
);
select ok(
  position($x$date_trunc('day', now() at time zone g.timezone) at time zone g.timezone$x$
           in pg_get_functiondef('public.list_my_class_session_roster(uuid)'::regprocedure)) > 0,
  'list_my_class_session_roster() bounds sessions with the same start-of-today expression'
);
select ok(
  position('interval' in lower(pg_get_functiondef('public.list_my_class_session_roster(uuid)'::regprocedure))) = 0,
  'list_my_class_session_roster() contains no interval arithmetic either'
);

select is(
  (select count(*)::int from pg_proc p, unnest(p.proargmodes) m
   where p.oid = 'public.list_my_class_session_roster(uuid)'::regprocedure and m = 't'),
  3,
  'list_my_class_session_roster returns exactly three columns (member_id, member_name, attended_at) -- no phone, no other members column'
);

-- ============================================================================
-- Zero RLS policies modified by 0096
-- ============================================================================

select policies_are('public', 'classes',
  ARRAY['gym_staff_read_own_classes', 'manager_or_owner_insert_own_classes', 'manager_or_owner_update_own_classes', 'tenant_active_gate'],
  'classes policies are unchanged');
select policies_are('public', 'class_sessions',
  ARRAY['gym_staff_read_own_class_sessions', 'tenant_active_gate'],
  'class_sessions policies are unchanged');
select policies_are('public', 'class_bookings',
  ARRAY['gym_staff_read_own_class_bookings', 'member_read_own_class_bookings', 'tenant_active_gate'],
  'class_bookings policies are unchanged');
select policies_are('public', 'members',
  ARRAY['coach_read_assigned_members', 'gym_staff_read_own_members', 'manager_or_owner_insert_own_members',
        'manager_or_owner_update_own_members', 'member_read_gym_staff_members', 'self_read_own_membership',
        'self_update_own_member_onboarding_fields', 'super_admin_escalated_read_members',
        'super_admin_insert_owner_member', 'super_admin_read_owner_members', 'tenant_active_gate'],
  'members policies are unchanged');

-- ============================================================================
-- Receptionist: the positive control for the bookings read, and no access to
-- either function
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a4","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"receptionist"}', true);

select is((select count(*)::int from class_bookings), 7,
  'positive control: a receptionist reads all seven Gym A bookings through plain RLS');
select is_empty($$ select * from list_my_classes() $$, 'a receptionist gets no classes from list_my_classes()');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  'a receptionist gets no roster from list_my_class_session_roster()');

reset role;

-- ============================================================================
-- Coach A1: why DEFINER rights are needed, then their own classes and rosters
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a1","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"coach"}', true);

select is((select count(*)::int from class_bookings), 0,
  'under plain RLS a coach reads zero class_bookings -- the booked count needs a DEFINER function');
select is((select count(*)::int from members
           where id in ('00000000-0000-0000-0174-0000000001a6', '00000000-0000-0000-0174-0000000001a7')), 0,
  'under plain RLS a coach reads none of the booked, unassigned members'' names -- the roster needs a DEFINER function');

select results_eq(
  $$ select class_name, class_session_id, booked_count, gym_timezone from list_my_classes() $$,
  $$ values
       ('Archived Workshop'::text, null::uuid, 0::bigint, 'Africa/Douala'::text),
       ('HIIT Circuit'::text, '00000000-0000-0000-0174-0000000003a1'::uuid, 1::bigint, 'Africa/Douala'::text),
       ('HIIT Circuit'::text, '00000000-0000-0000-0174-0000000003a3'::uuid, 3::bigint, 'Africa/Douala'::text) $$,
  'coach A1 gets both classes, in name order: the past-only one-off class as one null-session row, and HIIT''s sessions from local midnight with every booking counted (deactivated and unassigned members included)'
);

select ok(
  not exists (select 1 from list_my_classes() where class_session_id = '00000000-0000-0000-0174-0000000003a2'),
  'a session one minute before 00:00 today in the gym''s timezone is outside the window'
);

select results_eq(
  $$ select distinct class_name, capacity, schedule_type, recurrence_days, recurrence_time from list_my_classes() order by class_name $$,
  $$ values
       ('Archived Workshop'::text, 10, 'one_off'::text, null::smallint[], null::time),
       ('HIIT Circuit'::text, 15, 'recurring'::text, '{1,3,5}'::smallint[], '18:00'::time) $$,
  'each class carries its capacity and schedule'
);

select results_eq(
  $$ select member_id, member_name, attended_at is not null from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a1') $$,
  $$ values ('00000000-0000-0000-0174-0000000001a6'::uuid, 'Alice Member'::text, true) $$,
  'coach A1 reads today''s roster: Alice, attended'
);
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a2') $$,
  'the roster is bounded to sessions from 00:00 today: yesterday''s session of their own class (booked, per the receptionist control) returns nothing, so a class''s new coach cannot read its history');
select results_eq(
  $$ select member_name from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  $$ values ('Alice Member'::text), ('Bob Member'::text), ('Carol Deactivated'::text) $$,
  'coach A1 reads a future session''s full roster in name order, the deactivated booked member included'
);
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a5') $$,
  'coach A1 gets an empty roster for another coach''s session');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003b1') $$,
  'coach A1 gets an empty roster for another gym''s session');
select is_empty($$ select * from list_my_class_session_roster(gen_random_uuid()) $$,
  'coach A1 gets an empty roster for a nonexistent session');

reset role;

-- ============================================================================
-- Coach A2: sees only their own class
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a2","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"coach"}', true);

select results_eq($$ select class_name from list_my_classes() $$, $$ values ('Other Coach Class'::text) $$,
  'coach A2 sees only the class they teach');
select is((select count(*)::int from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a5')), 1,
  'positive control: coach A2 reads their own session''s roster');

reset role;

-- ============================================================================
-- Callers who must get nothing
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a3","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"coach"}', true);
select is_empty($$ select * from list_my_classes() $$, 'a deactivated coach (JWT still says coach) gets no classes');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a6') $$,
  'a deactivated coach gets no roster, even for their own class''s session');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a5","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"manager"}', true);
select is_empty($$ select * from list_my_classes() $$, 'a manager gets no classes from list_my_classes()');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  'a manager gets no roster from list_my_class_session_roster()');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a6","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"member"}', true);
select is_empty($$ select * from list_my_classes() $$, 'a member gets no classes');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  'a member booked on the session gets no roster');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a6","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"coach"}', true);
select is_empty($$ select * from list_my_classes() $$,
  'a member whose claims say app_role = coach gets no classes -- the live members.role decides');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  'a member whose claims say app_role = coach gets no roster');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a1","role":"authenticated","app_role":"coach"}', true);
select is_empty($$ select * from list_my_classes() $$, 'coach A1 with no gym_id claim gets no classes');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a3') $$,
  'coach A1 with no gym_id claim gets no roster');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a1","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000b000","app_role":"coach"}', true);
select is_empty($$ select * from list_my_classes() $$,
  'coach A1 carrying Gym B''s gym_id (no membership there) gets no classes');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003b1') $$,
  'coach A1 carrying Gym B''s gym_id gets no Gym B roster');
reset role;

-- ============================================================================
-- Gym-local day start: a UTC+14 gym under a UTC session
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000d1","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000d000","app_role":"coach"}', true);
select results_eq($$ select class_session_id from list_my_classes() $$,
  $$ values ('00000000-0000-0000-0174-0000000003d1'::uuid) $$,
  'a UTC+14 gym''s coach sees the session at its own local midnight and not the one a minute before');
select is((select distinct gym_timezone from list_my_classes()), 'Pacific/Kiritimati',
  'list_my_classes() reports the gym''s own timezone');
reset role;

-- ============================================================================
-- Suspended gym: the load-bearing raise
-- ============================================================================

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000c1","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000c000","app_role":"coach"}', true);
select throws_like($$ select * from list_my_classes() $$, '%is not active%',
  'a suspended gym''s coach gets list_my_classes: gym ... is not active');
select throws_like($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003c1') $$, '%is not active%',
  'a suspended gym''s coach gets list_my_class_session_roster: gym ... is not active');
reset role;

-- The guard sits BELOW caller resolution: a non-coach at the same suspended
-- gym gets the uniform empty set and learns nothing about the gym's status.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000c2","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000c000","app_role":"member"}', true);
select is_empty($$ select * from list_my_classes() $$,
  'a non-coach at a suspended gym gets an empty set, not the suspension raise -- the guard runs after caller resolution');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003c1') $$,
  'a non-coach at a suspended gym gets an empty roster, not the suspension raise');
reset role;

-- ============================================================================
-- A coach demoted to manager whose JWT still says coach. Last, because it
-- mutates a fixture. The claims are cleared first: set_config(..., true) lasts
-- until the transaction ends, even after `reset role`, and
-- protect_self_managed_member_columns silently restores the old role when
-- auth.uid() is the row's own user.
-- ============================================================================

select set_config('request.jwt.claims', '', true);
update members set role = 'manager' where id = '00000000-0000-0000-0174-0000000001a2';
select is((select role::text from members where id = '00000000-0000-0000-0174-0000000001a2'), 'manager',
  'fixture: coach A2 is now a manager');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0174-0000000000a2","role":"authenticated","gym_id":"00000000-0000-0000-0174-00000000a000","app_role":"coach"}', true);
select is_empty($$ select * from list_my_classes() $$,
  'a coach demoted to manager, stale coach JWT, gets no classes -- even though classes.coach_id still points at their row');
select is_empty($$ select * from list_my_class_session_roster('00000000-0000-0000-0174-0000000003a5') $$,
  'a coach demoted to manager, stale coach JWT, gets no roster for their former class');
reset role;

select * from finish();
rollback;
