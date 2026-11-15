-- Story 27.1: protected attendance counting (migration 0173).
--
-- Proves: the gym-local date helper and its fallback (pinned to private.gym_today), the visit_day insert trigger and its immutability
-- trigger (incl. the offline-replay day), the two views and their isolation matrix (member, staff, other gym, suspended gym, anon),
-- voided rows hidden from the base-table policies and from both views, the occupancy band counting through the view, the partial indexes
-- being used on a 100,000-row fixture, the 0111 write revokes still holding, and the committed list of every base-table reader of
-- attendance_events (function bodies, policies, views), with a seeded offender that makes the comparison fail.
--
-- Fixture ids: 00000000-0000-0000-0000-0000002701xx.

begin;
select plan(81);

-- ============================================================================
-- Fixtures
-- ============================================================================
insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000270101', 'Counting Tier', 5000, 50000, null);

-- A: default zone Africa/Douala (UTC+1), capacity 10. B: UTC. C: suspended, seeded suspended in its INSERT (a bare UPDATE of gyms.status
-- is silently reverted by a trigger). D: empty zone. E: invalid zone.
insert into gyms (id, name, tier_id, status, timezone, capacity) values
  ('00000000-0000-0000-0000-000000270111', 'Counting Gym A', '00000000-0000-0000-0000-000000270101', 'active', 'Africa/Douala', 10),
  ('00000000-0000-0000-0000-000000270112', 'Counting Gym B', '00000000-0000-0000-0000-000000270101', 'active', 'UTC', null),
  ('00000000-0000-0000-0000-000000270113', 'Counting Gym C', '00000000-0000-0000-0000-000000270101', 'suspended', 'Africa/Douala', null),
  ('00000000-0000-0000-0000-000000270114', 'Counting Gym D', '00000000-0000-0000-0000-000000270101', 'active', '', null),
  ('00000000-0000-0000-0000-000000270115', 'Counting Gym E', '00000000-0000-0000-0000-000000270101', 'active', 'Mars/Phobos', null);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000270121'), -- A member M1
  ('00000000-0000-0000-0000-000000270122'), -- A member M2
  ('00000000-0000-0000-0000-000000270123'), -- A receptionist
  ('00000000-0000-0000-0000-000000270124'), -- B owner
  ('00000000-0000-0000-0000-000000270125'), -- B member
  ('00000000-0000-0000-0000-000000270126'), -- C member
  ('00000000-0000-0000-0000-000000270127'), -- C receptionist
  ('00000000-0000-0000-0000-000000270128'), -- D member
  ('00000000-0000-0000-0000-000000270129'), -- E member
  ('00000000-0000-0000-0000-00000027012a'); -- A member M3 (open visits for the occupancy band)

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000270131', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270121', 'member', 'Counting M1', current_date),
  ('00000000-0000-0000-0000-000000270132', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270122', 'member', 'Counting M2', current_date),
  ('00000000-0000-0000-0000-000000270133', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270123', 'receptionist', 'Counting A Receptionist', current_date),
  ('00000000-0000-0000-0000-000000270134', '00000000-0000-0000-0000-000000270112', '00000000-0000-0000-0000-000000270124', 'owner', 'Counting B Owner', current_date),
  ('00000000-0000-0000-0000-000000270135', '00000000-0000-0000-0000-000000270112', '00000000-0000-0000-0000-000000270125', 'member', 'Counting B Member', current_date),
  ('00000000-0000-0000-0000-000000270136', '00000000-0000-0000-0000-000000270113', '00000000-0000-0000-0000-000000270126', 'member', 'Counting C Member', current_date),
  ('00000000-0000-0000-0000-000000270137', '00000000-0000-0000-0000-000000270113', '00000000-0000-0000-0000-000000270127', 'receptionist', 'Counting C Receptionist', current_date),
  ('00000000-0000-0000-0000-000000270138', '00000000-0000-0000-0000-000000270114', '00000000-0000-0000-0000-000000270128', 'member', 'Counting D Member', current_date),
  ('00000000-0000-0000-0000-000000270139', '00000000-0000-0000-0000-000000270115', '00000000-0000-0000-0000-000000270129', 'member', 'Counting E Member', current_date),
  ('00000000-0000-0000-0000-00000027013a', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-00000027012a', 'member', 'Counting M3', current_date);

-- ============================================================================
-- (1) private.gym_local_date and its fallback, pinned to private.gym_today
-- ============================================================================
set local timezone = 'UTC';

select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270111', timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-08',
  'gym_local_date: 23:30 UTC is the NEXT local day for Africa/Douala (UTC+1)'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270112', timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-07',
  'gym_local_date: 23:30 UTC is the SAME day for UTC'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270114', timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-07',
  'gym_local_date: an empty zone means UTC'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270115', timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-07',
  'gym_local_date: an unresolvable zone means UTC, no exception'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-0000002701ff', timestamptz '2026-11-07 23:30:00+00'),
  date '2026-11-07',
  'gym_local_date: an unknown gym (no zone at all) means UTC'
);

select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270111', now()),
  private.gym_today('00000000-0000-0000-0000-000000270111'),
  'pinned to gym_today: valid zone (Douala)'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270112', now()),
  private.gym_today('00000000-0000-0000-0000-000000270112'),
  'pinned to gym_today: UTC'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270114', now()),
  private.gym_today('00000000-0000-0000-0000-000000270114'),
  'pinned to gym_today: empty zone'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-000000270115', now()),
  private.gym_today('00000000-0000-0000-0000-000000270115'),
  'pinned to gym_today: invalid zone'
);
select is(
  private.gym_local_date('00000000-0000-0000-0000-0000002701ff', now()),
  private.gym_today('00000000-0000-0000-0000-0000002701ff'),
  'pinned to gym_today: unknown gym'
);

-- ============================================================================
-- (2) Columns: visit_day is NOT NULL; 27.2 (0174) adds source, entered_by, voided_by and void_reason beside voided_at
-- ============================================================================
select col_type_is('public', 'attendance_events', 'visit_day', 'date', 'visit_day is a date');
select col_not_null('public', 'attendance_events', 'visit_day', 'visit_day is NOT NULL');
select col_type_is('public', 'attendance_events', 'voided_at', 'timestamp with time zone', 'voided_at is a timestamptz');
select col_is_null('public', 'attendance_events', 'voided_at', 'voided_at is nullable');
select col_hasnt_default('public', 'attendance_events', 'voided_at', 'voided_at has no default');
select is(
  (select array_agg(column_name::text order by column_name)
   from information_schema.columns where table_schema = 'public' and table_name = 'attendance_events'),
  array['checked_in_at', 'checked_out_at', 'checkout_type', 'client_scan_id', 'created_at', 'entered_by', 'gym_id', 'id', 'member_id', 'source', 'visit_day', 'void_reason', 'voided_at', 'voided_by'],
  'the table has visit_day and voided_at (27.1) and source, entered_by, voided_by, void_reason (27.2, 0174)'
);

-- ============================================================================
-- (3) Insert trigger: visit_day from the row's own checked_in_at
-- ============================================================================
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type) values
  -- e1: 23:30 UTC on 7 Nov = 00:30 on 8 Nov in Douala
  ('00000000-0000-0000-0000-000000270151', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270131', timestamptz '2026-11-07 23:30:00+00', timestamptz '2026-11-08 00:30:00+00', 'manual'),
  -- e2: same local day (8 Nov), same member
  ('00000000-0000-0000-0000-000000270152', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270131', timestamptz '2026-11-08 10:00:00+00', timestamptz '2026-11-08 11:00:00+00', 'manual'),
  -- e3: another member, same local day
  ('00000000-0000-0000-0000-000000270153', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270132', timestamptz '2026-11-08 12:00:00+00', timestamptz '2026-11-08 13:00:00+00', 'manual'),
  -- e4: M1 next day
  ('00000000-0000-0000-0000-000000270154', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270131', timestamptz '2026-11-09 12:00:00+00', timestamptz '2026-11-09 13:00:00+00', 'manual'),
  -- gym B (UTC): the same 23:30 UTC instant stays on 7 Nov
  ('00000000-0000-0000-0000-000000270155', '00000000-0000-0000-0000-000000270112', '00000000-0000-0000-0000-000000270135', timestamptz '2026-11-07 23:30:00+00', timestamptz '2026-11-08 00:30:00+00', 'manual'),
  -- gym C (suspended)
  ('00000000-0000-0000-0000-000000270156', '00000000-0000-0000-0000-000000270113', '00000000-0000-0000-0000-000000270136', timestamptz '2026-11-08 12:00:00+00', timestamptz '2026-11-08 13:00:00+00', 'manual');

select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270151'),
  date '2026-11-08',
  'insert without visit_day: Douala 23:30 UTC check-in is the next local day (fixtures need no edit)'
);
select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270155'),
  date '2026-11-07',
  'insert without visit_day: UTC gym keeps the same day'
);

-- Offline replay (FR-061): a scan stamped 23:50 local on Sunday 15 Nov (22:50 UTC), received at 00:20 Monday local (23:20 UTC Sunday).
-- The stored day is Sunday: the recorded checked_in_at, not the receipt time (created_at).
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, created_at, client_scan_id) values
  ('00000000-0000-0000-0000-000000270157', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270132',
   timestamptz '2026-11-15 22:50:00+00', timestamptz '2026-11-15 23:10:00+00', 'auto', timestamptz '2026-11-15 23:20:00+00', '00000000-0000-0000-0000-000000270f01');
select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270157'),
  date '2026-11-15',
  'offline replay: a scan stamped 23:50 local Sunday that syncs at 00:20 Monday keeps Sunday as its visit_day'
);
select is(
  (select (created_at at time zone 'Africa/Douala')::date from attendance_events where id = '00000000-0000-0000-0000-000000270157'),
  date '2026-11-16',
  'offline replay: the receipt time really is the next local day (the test is not vacuous)'
);

-- A supplied visit_day is kept; an explicit NULL is treated as not supplied.
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  ('00000000-0000-0000-0000-000000270158', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270132',
   timestamptz '2026-11-10 12:00:00+00', timestamptz '2026-11-10 13:00:00+00', 'manual', date '2026-01-01');
select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270158'),
  date '2026-01-01',
  'an insert that supplies visit_day keeps it (27.2 will supply it explicitly)'
);
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  ('00000000-0000-0000-0000-000000270159', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270132',
   timestamptz '2026-11-11 12:00:00+00', timestamptz '2026-11-11 13:00:00+00', 'manual', null);
select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270159'),
  date '2026-11-11',
  'an explicit NULL visit_day is filled from checked_in_at'
);
delete from attendance_events where id in ('00000000-0000-0000-0000-000000270158', '00000000-0000-0000-0000-000000270159');

-- ============================================================================
-- (4) Update trigger: visit_day is written once
-- ============================================================================
select throws_like(
  $$update attendance_events set visit_day = date '2026-12-31' where id = '00000000-0000-0000-0000-000000270151'$$,
  '%visit_day is written once%',
  'an UPDATE that changes visit_day raises'
);
select lives_ok(
  $$update attendance_events set checked_out_at = checked_out_at + interval '1 minute' where id = '00000000-0000-0000-0000-000000270151'$$,
  'an UPDATE of another column is allowed'
);
select lives_ok(
  $$update attendance_events set visit_day = visit_day where id = '00000000-0000-0000-0000-000000270151'$$,
  'an UPDATE that leaves visit_day unchanged is allowed'
);
select throws_like(
  $$update attendance_events set visit_day = null where id = '00000000-0000-0000-0000-000000270151'$$,
  '%visit_day%',
  'visit_day cannot be set back to NULL'
);
-- A timezone change never moves a past day (NFR-028).
update gyms set timezone = 'Pacific/Kiritimati' where id = '00000000-0000-0000-0000-000000270111';
select is(
  (select visit_day from attendance_events where id = '00000000-0000-0000-0000-000000270151'),
  date '2026-11-08',
  'a later timezone change does not move a stored visit_day'
);
update gyms set timezone = 'Africa/Douala' where id = '00000000-0000-0000-0000-000000270111';

-- ============================================================================
-- (5) The 0111 direct-write closure still holds (27.2 owns any change)
-- ============================================================================
select is(
  (select has_table_privilege('authenticated', 'public.attendance_events', 'INSERT')
       or has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
       or has_table_privilege('authenticated', 'public.attendance_events', 'DELETE')
       or has_table_privilege('service_role', 'public.attendance_events', 'INSERT')
       or has_table_privilege('service_role', 'public.attendance_events', 'UPDATE')
       or has_table_privilege('service_role', 'public.attendance_events', 'DELETE')
       or has_table_privilege('anon', 'public.attendance_events', 'INSERT')
       or has_table_privilege('anon', 'public.attendance_events', 'UPDATE')
       or has_table_privilege('anon', 'public.attendance_events', 'DELETE')),
  false,
  '0111 write revokes still hold: no client role can INSERT, UPDATE or DELETE attendance_events'
);

-- ============================================================================
-- (6) The views: shape, options, privileges
-- ============================================================================
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.attendance_counted'::regclass and attnum > 0 and not attisdropped),
  array['id', 'gym_id', 'member_id', 'checked_in_at', 'checked_out_at', 'checkout_type', 'visit_day', 'created_at', 'client_scan_id', 'source'],
  'attendance_counted has the explicit column list (27.2 appends source), no void column and never entered_by'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.member_visit_days'::regclass and attnum > 0 and not attisdropped),
  array['member_id', 'gym_id', 'visit_day'],
  'member_visit_days has member_id, gym_id, visit_day'
);
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.attendance_counted'::regclass),
  'attendance_counted is security_invoker'
);
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.member_visit_days'::regclass),
  'member_visit_days is security_invoker'
);
select is(
  (select pg_get_viewdef('public.member_visit_days'::regclass) ~ 'attendance_counted' and pg_get_viewdef('public.member_visit_days'::regclass) !~ 'attendance_events'),
  true,
  'member_visit_days reads from attendance_counted, never the base table'
);
select is(
  (select pg_get_viewdef('public.attendance_counted'::regclass) ~ 'voided_at IS NULL'),
  true,
  'attendance_counted filters voided_at is null'
);
select is(
  (select array_agg(r order by r) from (
     select 'anon' r where has_table_privilege('anon', 'public.attendance_counted', 'SELECT') or has_table_privilege('anon', 'public.member_visit_days', 'SELECT')
     union all select 'service_role' where has_table_privilege('service_role', 'public.attendance_counted', 'SELECT') or has_table_privilege('service_role', 'public.member_visit_days', 'SELECT')
     union all select 'public' where exists (select 1 from pg_class c, aclexplode(c.relacl) a
        where c.oid in ('public.attendance_counted'::regclass, 'public.member_visit_days'::regclass) and a.grantee = 0)
   ) q),
  null::text[],
  'neither view is readable by anon, service_role or PUBLIC'
);
select ok(
  has_table_privilege('authenticated', 'public.attendance_counted', 'SELECT') and has_table_privilege('authenticated', 'public.member_visit_days', 'SELECT'),
  'both views grant SELECT to authenticated'
);
select ok(
  not has_table_privilege('authenticated', 'public.attendance_counted', 'INSERT')
  and not has_table_privilege('authenticated', 'public.member_visit_days', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.attendance_counted', 'DELETE'),
  'the views grant authenticated nothing but SELECT'
);
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C") from pg_proc p
   where p.oid in ('private.gym_local_date(uuid, timestamptz)'::regprocedure, 'private.attendance_events_visit_day_guard()'::regprocedure)
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))),
  null::text[],
  'the new private functions are executable by neither anon, authenticated nor PUBLIC'
);

-- ============================================================================
-- (7) The isolation matrix. Gym A counted rows: e1, e2, e4 (M1), e3 and the replay row (M2) = 5.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270111","app_role":"member"}', true);
select is((select count(*)::int from attendance_counted), 3, 'a member sees only their own rows in attendance_counted (M1: e1, e2, e4)');
select is((select count(*)::int from member_visit_days), 2, 'a member sees only their own visit days (M1: 8 Nov, 9 Nov; two visits on 8 Nov are one day)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270111","app_role":"receptionist"}', true);
select is((select count(*)::int from attendance_counted), 5, 'a receptionist sees every row of their gym and none of gym B');
select is((select count(*)::int from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112'), 0, 'a receptionist sees no row of gym B');
select is((select count(*)::int from member_visit_days), 4, 'a receptionist sees every visit day of their gym (M1 x2, M2 x2)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270112","app_role":"owner"}', true);
select is((select count(*)::int from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270111'), 0, 'the owner of gym B sees no row of gym A');
select is((select count(*)::int from attendance_counted), 1, 'the owner of gym B sees gym B''s own row');
select is((select count(*)::int from member_visit_days where gym_id = '00000000-0000-0000-0000-000000270111'), 0, 'the owner of gym B sees no visit day of gym A');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270113","app_role":"receptionist"}', true);
select is((select count(*)::int from attendance_counted), 0, 'a suspended gym returns zero rows to its own staff (tenant_active_gate applies through security_invoker)');
select is((select count(*)::int from member_visit_days), 0, 'a suspended gym returns zero visit days to its own staff');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270113","app_role":"member"}', true);
select is((select count(*)::int from attendance_counted), 0, 'a suspended gym returns zero rows to its own members');

reset role;
set local role anon;
select throws_ok($$select * from attendance_counted$$, '42501', null, 'anon is refused on attendance_counted');
select throws_ok($$select * from member_visit_days$$, '42501', null, 'anon is refused on member_visit_days');
reset role;
set local role service_role;
select throws_ok($$select * from attendance_counted$$, '42501', null, 'service_role is not granted the views (SELECT is authenticated only)');
reset role;

-- ============================================================================
-- (8) A voided row (fixture as postgres) is hidden from the base policies and from both views
-- ============================================================================
update attendance_events set voided_at = now(), voided_by = '00000000-0000-0000-0000-000000270121', void_reason = 'wrong person' where id = '00000000-0000-0000-0000-000000270153'; -- e3: M2's visit on 8 Nov

select is((select count(*)::int from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270111'), 4,
  'as the table owner (no RLS), attendance_counted still excludes the voided row');
select is((select count(*)::int from member_visit_days where gym_id = '00000000-0000-0000-0000-000000270111' and member_id = '00000000-0000-0000-0000-000000270132'), 1,
  'member_visit_days excludes the voided row (M2 keeps only the replay day)');
select is((select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000270111'), 5,
  'the base table still holds the voided row for its owner');

set local role service_role;
select is((select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000270111'), 5,
  'service_role (BYPASSRLS) is unchanged: the base table still returns the voided row to it');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270111","app_role":"receptionist"}', true);
select is((select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000270111'), 4,
  'staff: the base-table policy no longer returns the voided row');
select is((select count(*)::int from attendance_counted), 4, 'staff: attendance_counted does not return the voided row');
select is((select count(*)::int from member_visit_days where member_id = '00000000-0000-0000-0000-000000270132'), 1, 'staff: member_visit_days does not return the voided day');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000270122","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000270111","app_role":"member"}', true);
select is((select count(*)::int from attendance_events), 1, 'member: the base-table policy no longer returns the member''s voided row');
select is((select count(*)::int from attendance_counted), 1, 'member: attendance_counted does not return the voided row');
select is((select count(*)::int from member_visit_days), 1, 'member: member_visit_days does not return the voided day');
reset role;

-- ============================================================================
-- (9) The occupancy band counts through the view (capacity 10; 30% is "medium", under 30% is "low")
-- ============================================================================
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-000000270161', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270131', now()),
  ('00000000-0000-0000-0000-000000270162', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-000000270132', now()),
  ('00000000-0000-0000-0000-000000270163', '00000000-0000-0000-0000-000000270111', '00000000-0000-0000-0000-00000027013a', now());
select is(private.gym_occupancy_band('00000000-0000-0000-0000-000000270111'), 'medium', 'occupancy: three open rows of ten is medium');
update attendance_events set voided_at = now(), voided_by = '00000000-0000-0000-0000-000000270121', void_reason = 'wrong person' where id = '00000000-0000-0000-0000-000000270163';
select is(private.gym_occupancy_band('00000000-0000-0000-0000-000000270111'), 'low', 'occupancy: a voided open row is not counted (two of ten is low)');
select is(
  (select position('attendance_counted' in pg_get_functiondef('private.gym_occupancy_band(uuid)'::regprocedure)) > 0
      and position('attendance_events' in pg_get_functiondef('private.gym_occupancy_band(uuid)'::regprocedure)) = 0),
  true,
  'private.gym_occupancy_band reads attendance_counted and never the base table'
);
select is(private.gym_occupancy_band('00000000-0000-0000-0000-000000270112'), null, 'occupancy: a gym without capacity still returns null');
select ok(
  has_function_privilege('service_role', 'private.gym_occupancy_band(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.gym_occupancy_band(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.gym_occupancy_band(uuid)', 'EXECUTE'),
  'occupancy: grants are unchanged (service_role only)'
);

-- ============================================================================
-- (10) The partial indexes are used on a 100,000-row fixture
-- ============================================================================
insert into auth.users (id)
select ('00000000-0000-0000-0000-0000002702' || lpad(to_hex(i), 2, '0'))::uuid from generate_series(1, 50) i;
insert into members (id, gym_id, user_id, role, name, join_date)
select ('00000000-0000-0000-0000-0000002703' || lpad(to_hex(i), 2, '0'))::uuid, '00000000-0000-0000-0000-000000270112',
       ('00000000-0000-0000-0000-0000002702' || lpad(to_hex(i), 2, '0'))::uuid, 'member', 'Counting Bulk ' || i, current_date
from generate_series(1, 50) i;
-- visit_day is supplied so the fixture does not run the trigger 100,000 times (the trigger is proven above).
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select '00000000-0000-0000-0000-000000270112',
       ('00000000-0000-0000-0000-0000002703' || lpad(to_hex(1 + (i % 50)), 2, '0'))::uuid,
       timestamptz '2025-01-01 08:00:00+00' + ((i % 700) || ' days')::interval + ((i % 600) || ' seconds')::interval,
       timestamptz '2025-01-01 09:00:00+00' + ((i % 700) || ' days')::interval + ((i % 600) || ' seconds')::interval,
       'manual',
       date '2025-01-01' + (i % 700)
from generate_series(1, 100000) i;
analyze attendance_events;

create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $f$
declare r text; out text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop out := out || r || E'\n'; end loop;
  return out;
end $f$;

select is((select count(*)::int from attendance_events where gym_id = '00000000-0000-0000-0000-000000270112'), 100001, 'the bulk fixture holds 100,000 rows (plus gym B''s one)');
select alike(
  pg_temp.plan_of($$select count(*) from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112' and visit_day = date '2025-06-01'$$),
  '%idx_attendance_events_gym_visit_day%',
  'a gym-and-day count on attendance_counted uses the (gym_id, visit_day) partial index'
);
select alike(
  pg_temp.plan_of($$select * from member_visit_days where member_id = '00000000-0000-0000-0000-000000270301' and visit_day >= date '2025-06-01' and visit_day < date '2025-06-15'$$),
  '%idx_attendance_events_member_visit_day%',
  'a member-and-day-range read on member_visit_days uses the (member_id, visit_day) partial index'
);
-- The Attendance page's three reads (apps/dashboard/services/attendance.ts), as PostgREST sends them against the view: none filter on
-- visit_day, so the (gym_id, checked_in_at) partial index is the one they use.
-- Read 1 asks for open rows only, so the planner takes the existing one-open partial index (open rows only, a far smaller set than the
-- gym's history); what is pinned is an index scan and no sequential scan.
select ok(
  pg_temp.plan_of($$select member_id, checked_in_at from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112' and checked_out_at is null order by checked_in_at asc limit 5$$) ~ 'Index Scan'
  and pg_temp.plan_of($$select member_id, checked_in_at from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112' and checked_out_at is null order by checked_in_at asc limit 5$$) !~ 'Seq Scan',
  'page read 1 (Currently Checked In: the gym''s open rows, oldest first) reads through an index, not a sequential scan'
);
select alike(
  pg_temp.plan_of($$select count(id) from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112' and checked_in_at >= timestamptz '2025-06-01 00:00:00+01' and checked_in_at < timestamptz '2025-06-02 00:00:00+01'$$),
  '%idx_attendance_events_gym_checked_in%',
  'page read 2 (the today count: a gym-local day range) uses the (gym_id, checked_in_at) partial index'
);
select alike(
  pg_temp.plan_of($$select id, member_id, checked_in_at, checked_out_at from attendance_counted where gym_id = '00000000-0000-0000-0000-000000270112' and checked_in_at >= timestamptz '2025-06-01 00:00:00+00' and checked_in_at < timestamptz '2025-06-08 00:00:00+00' order by checked_in_at desc limit 5$$),
  '%idx_attendance_events_gym_checked_in%',
  'page read 3 (the Daily Log: a date range, newest first) uses the (gym_id, checked_in_at) partial index'
);
select is(
  (select count(*)::int from pg_indexes where tablename = 'attendance_events'
     and indexname in ('idx_attendance_events_gym_visit_day', 'idx_attendance_events_member_visit_day', 'idx_attendance_events_gym_checked_in')
     and indexdef ~ 'WHERE \(voided_at IS NULL\)'),
  3,
  'all three counting indexes are partial on voided_at is null'
);

-- ============================================================================
-- (11) The committed list of base-table readers (the pgTAP half of the reader gate; the node half is scripts/check-attendance-readers.mjs)
--
-- Every function body, policy expression and view definition that mentions attendance_events must be on this list. A new reader makes
-- pg_temp.attendance_readers_outside_list() return its name (functions by full signature, so a new overload counts; bodies are read with
-- pg_get_functiondef, which also covers BEGIN ATOMIC functions whose prosrc is empty). Backfills are migrations and exempt.
-- ============================================================================
create function pg_temp.attendance_readers_outside_list() returns setof text language sql as $f$
  with found as (
    select 'function ' || p.oid::regprocedure::text as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'pg_temp') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
      and p.prokind in ('f', 'p')
      -- CASE: the planner may evaluate this before the prokind filter, and pg_get_functiondef raises for an aggregate. \m..\M matches the table name
      -- as a whole word, so a function merely NAMED attendance_events_... (the visit_day trigger function) is not a reader.
      and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) ~ '\mattendance_events\M'
    union all
    select 'policy ' || schemaname || '.' || tablename || '.' || policyname
    from pg_policies
    where tablename = 'attendance_events' or coalesce(qual, '') ~ 'attendance_events' or coalesce(with_check, '') ~ 'attendance_events'
    union all
    select 'view ' || schemaname || '.' || viewname
    from pg_views
    where schemaname not in ('pg_catalog', 'information_schema') and definition ~ 'attendance_events'
    union all
    select 'matview ' || schemaname || '.' || matviewname
    from pg_matviews
    where definition ~ 'attendance_events'
  )
  select name from found
  where name not in (
    -- check_in no longer writes (27.2): it calls record_check_in, and still names the table in its RETURNS type
    'function check_in(timestamp with time zone,uuid)',
    -- the one inserter of attendance_events (27.2, 0174) and the stale-open closer
    'function private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)',
    -- staff and member check-out close the open row
    'function check_out()',
    'function check_out_member(uuid)',
    -- the auto-timeout job closes stale open rows
    'function run_check_in_auto_timeout_job()',
    -- the protected counting view; member_visit_days reads this view, not the table, so it is not listed
    'view public.attendance_counted',
    -- the two SELECT policies (voided rows hidden) and the RESTRICTIVE tenant gate, all on the table itself
    'policy public.attendance_events.gym_staff_read_own_attendance_events',
    'policy public.attendance_events.member_read_own_attendance_events',
    'policy public.attendance_events.tenant_active_gate'
  )
  order by 1
$f$;

select is(
  (select array_agg(x) from pg_temp.attendance_readers_outside_list() x),
  null::text[],
  'every function body, policy and view that mentions attendance_events is on the committed list'
);

-- The list is also complete in the other direction: every committed entry still exists (a removed reader means the list must shrink).
select is(
  (select count(*)::int from (
     select p.oid from pg_proc p
     where p.oid::regprocedure::text in ('check_in(timestamp with time zone,uuid)', 'private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)',
                                          'check_out()', 'check_out_member(uuid)', 'run_check_in_auto_timeout_job()')
       and p.prokind in ('f', 'p')
       and (case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) ~ '\mattendance_events\M') q),
  5,
  'the five committed function readers exist and still mention attendance_events'
);

-- ----------------------------------------------------------------------------
-- (11b) Story 27.2: exactly ONE function inserts into attendance_events, and exactly four update it. Comments are stripped before matching.
-- ----------------------------------------------------------------------------
create function pg_temp.attendance_writers(p_verb text) returns text[] language sql as $f$
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'pg_temp') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
    and p.prokind in ('f', 'p')
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* (p_verb || '\s+(public\.)?attendance_events\M')
$f$;
select is(
  pg_temp.attendance_writers('insert\s+into'),
  array['private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)'],
  'exactly one function inserts into attendance_events: private.record_check_in');
select is(
  pg_temp.attendance_writers('update'),
  array['check_out()', 'check_out_member(uuid)', 'private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)', 'run_check_in_auto_timeout_job()'],
  'the updaters of attendance_events are exactly check_out, check_out_member, run_check_in_auto_timeout_job and record_check_in (the stale branch); 27.3 adds void_staff_check_in');

-- Seeded offenders: a fake reader in each place is returned by the comparison.
create function public.zz_attendance_offender() returns bigint language sql as $f$ select count(*) from attendance_events $f$;
-- a new overload of check_in and a BEGIN ATOMIC function (empty prosrc) are readers too
create function public.check_in(p_zz integer) returns bigint language sql as $f$ select count(*) from attendance_events $f$;
create function public.zz_attendance_atomic_offender() returns bigint language sql begin atomic select count(*) from public.attendance_events; end;
create view public.zz_attendance_offender_view as select id from public.attendance_events;
create table public.zz_attendance_offender_table (id uuid primary key, member_id uuid);
create policy zz_attendance_offender_policy on public.zz_attendance_offender_table for select
  using (exists (select 1 from attendance_events ae where ae.member_id = zz_attendance_offender_table.member_id));

select is(
  (select array_agg(x order by x) from pg_temp.attendance_readers_outside_list() x),
  array[
    'function check_in(integer)',
    'function zz_attendance_atomic_offender()',
    'function zz_attendance_offender()',
    'policy public.zz_attendance_offender_table.zz_attendance_offender_policy',
    'view public.zz_attendance_offender_view'
  ],
  'seeded offenders (a function, a policy on another table, a view) are all returned by the enumeration'
);

-- A seeded second inserter and a second updater are returned by the two enumerations.
create function public.zz_attendance_insert_offender() returns void language sql as $f$ insert into attendance_events (gym_id, member_id) values (gen_random_uuid(), gen_random_uuid()) $f$;
create function public.zz_attendance_update_offender() returns void language sql as $f$ update attendance_events set checkout_type = 'manual' $f$;
select is(
  pg_temp.attendance_writers('insert\s+into'),
  array['private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)', 'zz_attendance_insert_offender()'],
  'a seeded second inserter is returned by the insert enumeration');
select is(
  array_length(pg_temp.attendance_writers('update'), 1),
  5,
  'a seeded second updater is returned by the update enumeration');

select * from finish();
rollback;
