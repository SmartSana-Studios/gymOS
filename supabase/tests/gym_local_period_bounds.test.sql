-- Story 17.2: gym_local_period_bounds() and private.gym_local_day_bounds()
-- (0097_gym_local_period_bounds.sql), and the four counts the AD-02 Overview's
-- Manager-plus gym-health row runs against them. Proves:
--
--  * shape and privileges of both functions (invoker rights, volatility,
--    EXECUTE revoked from PUBLIC), and that the wrapper takes its bounds from
--    both helpers, so the fixed-date proofs below cover the live wrapper;
--  * the day arithmetic at FIXED dates -- every day of 2026, at local 00:00,
--    12:00 and 23:59, in every gym timezone the app allows -- against an
--    independent make_timestamptz() oracle, under UTC and UTC+14 sessions;
--  * a positive control that the oracle can see the `+ interval` bug: no
--    allowed zone has DST, so Europe/Paris stands in, where the wrong form is
--    wrong on exactly its two transition days and the helper is not;
--  * the wrapper returns 0095's month bounds as dates and the day helper's
--    instants, one row for the caller's gym, zero rows with no gym_id claim,
--    and still one row for a suspended gym;
--  * the four count predicates under RLS -- the same filters the services
--    send -- for owner, manager, supervisor and receptionist.
--
-- Fixtures are added INCREMENTALLY and the figures re-asserted after each
-- step, so every exclusion is paired with the inclusion immediately before it.
-- Every assertion reads this test's own gyms only, so it holds against a
-- non-empty local database.
--
-- Fixture traps (see the story's Dev Notes):
--  * Gym C is seeded `status = 'suspended'` IN ITS INSERT: the
--    protect_super_admin_only_gym_columns trigger (0014) silently reverts an
--    UPDATE of gyms.status with no error.
--  * Every member, staff included, gets an explicit join_date: the column
--    defaults to UTC current_date, which on the gym-local 1st before 01:00 is
--    still the previous month.
--  * Session times are relative to the day helper's own bounds for now():
--    now() is fixed for the whole transaction, so they cannot straddle
--    midnight.
--  * gym_staff_read_own_members resolves the caller's role LIVE through
--    private.current_member_role(), so every caller's `sub` has a real
--    members row in that gym.

begin;
select plan(44);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0172-000000000001', 'Gym Health Test Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, capacity, timezone, status) values
  ('00000000-0000-0000-0172-000000000011', 'Gym Health Gym A', '00000000-0000-0000-0172-000000000001', 30, 'Africa/Douala', 'active'),
  ('00000000-0000-0000-0172-000000000012', 'Gym Health Gym B', '00000000-0000-0000-0172-000000000001', 30, 'Africa/Douala', 'active'),
  ('00000000-0000-0000-0172-000000000013', 'Gym Health Gym C', '00000000-0000-0000-0172-000000000001', 30, 'Africa/Douala', 'suspended');

-- Gym-local (Africa/Douala, UTC+1) bounds for "now", straight from the two
-- helpers. Used only to seed fixtures, as the superuser: the helpers' own
-- arithmetic is proven at fixed dates below.
create temp table health_bounds as
select
  (m.month_start at time zone 'Africa/Douala')::date as month_start_date,
  (m.next_month_start at time zone 'Africa/Douala')::date as next_month_start_date,
  d.day_start,
  d.next_day_start
from private.gym_local_month_bounds('Africa/Douala', now()) m,
     private.gym_local_day_bounds('Africa/Douala', now()) d;

-- make_timestamptz() as an INDEPENDENT oracle for the day helper: every day of
-- 2026, at local 00:00, 12:00 and 23:59, in every gym timezone the app allows
-- (packages/types gymSettingsSchema.timezone) plus Europe/Paris, which has DST.
create temp table day_bounds_oracle as
select tz, d as day, i.at_instant,
  make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 0, 0, 0, tz) as exp_start,
  make_timestamptz(extract(year from d + 1)::int, extract(month from d + 1)::int, extract(day from d + 1)::int, 0, 0, 0, tz) as exp_next
from unnest(array['Africa/Douala', 'Africa/Lagos', 'Africa/Bangui', 'Africa/Kinshasa', 'UTC', 'Europe/Paris']) as zones(tz)
cross join lateral (select g::date as d from generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') as g) as days
cross join lateral (values
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 0, 0, 0, tz)),
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 12, 0, 0, tz)),
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 23, 59, 0, tz))
) as i(at_instant);

-- The four gym-health figures for one gym, as "active/at_risk/new/today", with
-- exactly the predicates the services send: countSubscriptions() over
-- subscriptions_current (gym, deactivated_at is null, status group),
-- countMembersJoinedBetween() over members (gym, role = 'member', join_date in
-- the month dates) and countClassSessionsBetween() over class_sessions (gym,
-- scheduled_at in the day instants). SECURITY INVOKER, so every figure is read
-- under the caller's RLS. Test-only; rolled back with everything else.
create function public.gym_health_test_figures(p_gym_id uuid)
returns text
language sql
stable
as $$
  select format('%s/%s/%s/%s',
    (select count(*) from subscriptions_current s
     where s.gym_id = p_gym_id and s.deactivated_at is null and s.status in ('active', 'expiring_soon')),
    (select count(*) from subscriptions_current s
     where s.gym_id = p_gym_id and s.deactivated_at is null and s.status in ('grace_period', 'expired')),
    (select count(*) from members m, gym_local_period_bounds() pb
     where m.gym_id = p_gym_id and m.role = 'member'
       and m.join_date >= pb.month_start_date and m.join_date < pb.next_month_start_date),
    (select count(*) from class_sessions cs, gym_local_period_bounds() pb
     where cs.gym_id = p_gym_id and cs.scheduled_at >= pb.day_start and cs.scheduled_at < pb.next_day_start));
$$;

-- ============================================================================
-- Shape and privileges.
-- ============================================================================
select has_function('public', 'gym_local_period_bounds', '{}'::name[], 'gym_local_period_bounds() exists and takes no arguments');
select isnt_definer('public', 'gym_local_period_bounds', '{}'::name[], 'gym_local_period_bounds() is SECURITY INVOKER');
select volatility_is('public', 'gym_local_period_bounds', '{}'::name[], 'stable', 'gym_local_period_bounds() is STABLE -- it reads gyms and now()');
select ok(
  not has_function_privilege('anon', 'public.gym_local_period_bounds()', 'execute'),
  'anon cannot execute gym_local_period_bounds() -- EXECUTE is revoked from PUBLIC'
);
select ok(
  has_function_privilege('authenticated', 'public.gym_local_period_bounds()', 'execute'),
  'authenticated can execute gym_local_period_bounds()'
);

select has_function('private', 'gym_local_day_bounds', array['text', 'timestamp with time zone']::name[], 'private.gym_local_day_bounds(text, timestamptz) exists');
select isnt_definer('private', 'gym_local_day_bounds', array['text', 'timestamp with time zone']::name[], 'private.gym_local_day_bounds() is SECURITY INVOKER');
select volatility_is('private', 'gym_local_day_bounds', array['text', 'timestamp with time zone']::name[], 'immutable', 'private.gym_local_day_bounds() is IMMUTABLE -- it reads no table');
select ok(
  not has_function_privilege('anon', 'private.gym_local_day_bounds(text, timestamptz)', 'execute'),
  'anon cannot execute private.gym_local_day_bounds() -- EXECUTE is revoked from PUBLIC'
);
select ok(
  has_function_privilege('authenticated', 'private.gym_local_day_bounds(text, timestamptz)', 'execute'),
  'authenticated can execute private.gym_local_day_bounds() -- the wrapper runs with the caller''s rights, so the caller needs it'
);

select ok(
  pg_get_functiondef('public.gym_local_period_bounds()'::regprocedure) like '%private.gym_local_month_bounds(%'
  and pg_get_functiondef('public.gym_local_period_bounds()'::regprocedure) like '%private.gym_local_day_bounds(%',
  'gym_local_period_bounds() takes its bounds from both helpers, so the fixed-date proofs cover the live wrapper'
);

-- Fixture sanity: the day-boundary sessions below only separate gym-local
-- from UTC bucketing because the gym-local day does NOT start at midnight UTC.
select is(
  extract(hour from (select day_start from health_bounds) at time zone 'UTC')::int,
  23,
  'the Africa/Douala day starts at 23:00 UTC the previous day, so the boundary sessions below separate gym-local from UTC bucketing'
);

-- ============================================================================
-- private.gym_local_day_bounds(): the day arithmetic, at FIXED dates. The
-- session timezone is pinned to UTC, as under PostgREST: that is the session
-- the `+ interval` bug needs.
-- ============================================================================
set local timezone = 'UTC';

select is(
  (select count(*) from day_bounds_oracle where tz <> 'Europe/Paris'),
  5475::bigint,
  'the oracle covers 5 allowed timezones x 365 days x 3 instants -- so "no mismatches" below cannot pass vacuously'
);
select is(
  (select count(*) from day_bounds_oracle o, private.gym_local_day_bounds(o.tz, o.at_instant) b
   where o.tz <> 'Europe/Paris' and (b.day_start <> o.exp_start or b.next_day_start <> o.exp_next)),
  0::bigint,
  'every day of 2026, in every allowed gym timezone, at local 00:00, 12:00 and 23:59, matches the make_timestamptz() oracle'
);
select is(
  (select count(*) from day_bounds_oracle o, private.gym_local_day_bounds(o.tz, o.at_instant) b
   where o.tz = 'Europe/Paris' and (b.day_start <> o.exp_start or b.next_day_start <> o.exp_next)),
  0::bigint,
  'the helper also matches the oracle on every day in Europe/Paris, both DST transition days included'
);
select is(
  (select array_agg(distinct o.day order by o.day) from day_bounds_oracle o
   where o.tz = 'Europe/Paris'
     and ((date_trunc('day', o.at_instant at time zone o.tz) at time zone o.tz) + interval '1 day') <> o.exp_next),
  array['2026-03-29', '2026-10-25']::date[],
  'positive control: the WRONG form (+ interval after at time zone) fails the oracle on exactly Europe/Paris''s two DST days -- the oracle can see the bug'
);
select is(
  (select format('%s/%s', b.day_start, b.next_day_start) from private.gym_local_day_bounds('Europe/Paris', '2026-03-29 12:00+00') b),
  format('%s/%s', '2026-03-28 23:00+00'::timestamptz, '2026-03-29 22:00+00'::timestamptz),
  '2026-03-29 in Europe/Paris is the 23-hour day [2026-03-28 23:00 UTC, 2026-03-29 22:00 UTC)'
);

set local timezone = 'Pacific/Kiritimati';
select is(
  (select count(*) from day_bounds_oracle o, private.gym_local_day_bounds(o.tz, o.at_instant) b
   where b.day_start <> o.exp_start or b.next_day_start <> o.exp_next),
  0::bigint,
  'the helper does not depend on the session timezone -- all 6570 cases hold under a UTC+14 session'
);
set local timezone = 'UTC';

-- ============================================================================
-- Staff and member fixtures. Every join_date is explicit.
-- ============================================================================
insert into auth.users (id) values
  ('00000000-0000-0000-0172-000000000021'), -- Gym A owner
  ('00000000-0000-0000-0172-000000000022'), -- Gym A manager
  ('00000000-0000-0000-0172-000000000023'), -- Gym A supervisor
  ('00000000-0000-0000-0172-000000000024'), -- Gym A receptionist
  ('00000000-0000-0000-0172-000000000025'), -- Gym A coach
  ('00000000-0000-0000-0172-000000000026'), -- Gym B coach
  ('00000000-0000-0000-0172-000000000027'), -- Gym C owner
  ('00000000-0000-0000-0172-000000000028'), -- Gym C coach
  ('00000000-0000-0000-0172-000000000031'), -- m1
  ('00000000-0000-0000-0172-000000000032'), -- m2
  ('00000000-0000-0000-0172-000000000033'), -- m3
  ('00000000-0000-0000-0172-000000000034'), -- m4
  ('00000000-0000-0000-0172-000000000035'), -- m5
  ('00000000-0000-0000-0172-000000000036'), -- m6
  ('00000000-0000-0000-0172-000000000037'), -- Gym B member
  ('00000000-0000-0000-0172-000000000038'), -- Gym C member
  ('00000000-0000-0000-0172-000000000039'); -- Gym C at-risk member

insert into members (id, gym_id, user_id, role, name, join_date)
select v.id::uuid, v.gym_id::uuid, v.user_id::uuid, v.role::member_role, v.name, (select month_start_date from health_bounds)
from (values
  ('00000000-0000-0000-0172-000000000121', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000021', 'owner', 'Gym Health A Owner'),
  ('00000000-0000-0000-0172-000000000122', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000022', 'manager', 'Gym Health A Manager'),
  ('00000000-0000-0000-0172-000000000123', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000023', 'supervisor', 'Gym Health A Supervisor'),
  ('00000000-0000-0000-0172-000000000124', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000024', 'receptionist', 'Gym Health A Receptionist'),
  ('00000000-0000-0000-0172-000000000125', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000025', 'coach', 'Gym Health A Coach'),
  ('00000000-0000-0000-0172-000000000126', '00000000-0000-0000-0172-000000000012', '00000000-0000-0000-0172-000000000026', 'coach', 'Gym Health B Coach'),
  ('00000000-0000-0000-0172-000000000127', '00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000027', 'owner', 'Gym Health C Owner'),
  ('00000000-0000-0000-0172-000000000128', '00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000028', 'coach', 'Gym Health C Coach')
) as v(id, gym_id, user_id, role, name);

insert into plans (id, gym_id, name, plan_type, price, billing_interval, duration_days) values
  ('00000000-0000-0000-0172-000000000161', '00000000-0000-0000-0172-000000000011', 'Gym Health A Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0172-000000000162', '00000000-0000-0000-0172-000000000012', 'Gym Health B Monthly', 'monthly', 15000, 'monthly', 30),
  ('00000000-0000-0000-0172-000000000163', '00000000-0000-0000-0172-000000000013', 'Gym Health C Monthly', 'monthly', 15000, 'monthly', 30);

insert into classes (id, gym_id, name, coach_id, capacity, schedule_type, one_off_session_at) values
  ('00000000-0000-0000-0172-000000000171', '00000000-0000-0000-0172-000000000011', 'Gym Health A Class', '00000000-0000-0000-0172-000000000125', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0172-000000000172', '00000000-0000-0000-0172-000000000012', 'Gym Health B Class', '00000000-0000-0000-0172-000000000126', 10, 'one_off', now() + interval '3 days'),
  ('00000000-0000-0000-0172-000000000173', '00000000-0000-0000-0172-000000000013', 'Gym Health C Class', '00000000-0000-0000-0172-000000000128', 10, 'one_off', now() + interval '3 days');

-- ============================================================================
-- gym_local_period_bounds(): composition, under Gym A owner claims.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000021","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000011","app_role":"owner"}',
  true
);

select is((select count(*) from gym_local_period_bounds()), 1::bigint, 'the wrapper returns exactly one row for the caller''s gym');
select is(
  (select format('%s/%s', month_start_date, next_month_start_date) from gym_local_period_bounds()),
  (select format('%s/%s', (m.month_start at time zone 'Africa/Douala')::date, (m.next_month_start at time zone 'Africa/Douala')::date)
   from private.gym_local_month_bounds('Africa/Douala', now()) m),
  'its month dates are 0095''s month bounds for now(), in the gym''s timezone, as dates -- the same period as "Revenue this month"'
);
select is(
  (select format('%s/%s', day_start, next_day_start) from gym_local_period_bounds()),
  (select format('%s/%s', d.day_start, d.next_day_start) from private.gym_local_day_bounds('Africa/Douala', now()) d),
  'its day instants are the day helper''s bounds for now(), in the gym''s timezone'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000021","role":"authenticated","app_role":"owner"}',
  true
);
select is((select count(*) from gym_local_period_bounds()), 0::bigint, 'with no gym_id claim the wrapper returns zero rows, never an invented window');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000027","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000013","app_role":"owner"}',
  true
);
select is((select count(*) from gym_local_period_bounds()), 1::bigint, 'a suspended gym''s owner still gets its bounds -- they are not tenant data');

-- ============================================================================
-- The four counts, Gym A owner, one fixture at a time.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000021","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000011","app_role":"owner"}',
  true
);

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '0/0/0/0', 'baseline: staff who all joined this month count toward nothing');

-- m1: joined on the gym-local 1st, active.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000131', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000031', 'member', 'Gym Health m1', (select month_start_date from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000131', '00000000-0000-0000-0172-000000000161', 'active', current_date, current_date + 30);
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '1/0/1/0', 'an active member who joined on the gym-local 1st counts as Active and New this month');

-- m2: joined on the last gym-local day of the month, expiring_soon.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000132', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000032', 'member', 'Gym Health m2', (select next_month_start_date - 1 from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000132', '00000000-0000-0000-0172-000000000161', 'expiring_soon', current_date - 25, current_date + 5);
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '2/0/2/0', 'an expiring_soon member counts as Active, and a join on the last day of the month is still New this month');

-- m3: joined on the last day of the PRIOR month, grace_period.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000133', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000033', 'member', 'Gym Health m3', (select month_start_date - 1 from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000133', '00000000-0000-0000-0172-000000000161', 'grace_period', current_date - 40, current_date - 10);
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '2/1/2/0', 'a grace_period member counts as At risk, and a join the day before the month starts is not New this month');

-- m4: joined on the 1st of NEXT month, expired.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000134', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000034', 'member', 'Gym Health m4', (select next_month_start_date from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000134', '00000000-0000-0000-0172-000000000161', 'expired', current_date - 80, current_date - 50);
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '2/2/2/0', 'an expired member counts as At risk, and a join on the 1st of next month is not New this month -- the window is [start, end)');

-- m5: deactivated, joined this month, with an active subscription.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  ('00000000-0000-0000-0172-000000000135', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000035', 'member', 'Gym Health m5', (select month_start_date from health_bounds), now());
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000135', '00000000-0000-0000-0172-000000000161', 'active', current_date, current_date + 30);
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '2/2/3/0', 'a deactivated member with an active subscription is excluded from Active but still counts as New this month -- a join, not headcount');

-- m6: joined in 2025 and renewed -- an older grace_period row, a newer active one.
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000136', '00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000036', 'member', 'Gym Health m6', date '2025-01-15');
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000136', '00000000-0000-0000-0172-000000000161', 'grace_period', current_date - 35, current_date - 5, now() - interval '10 days'),
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000136', '00000000-0000-0000-0172-000000000161', 'active', current_date, current_date + 30, now());
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/0', 'a renewed member counts once, by their current (active) row -- their old grace_period row is not At risk');

-- Today's classes: inclusions first, each boundary exclusion after its inclusion.
reset role;
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000171', (select day_start from health_bounds));
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/1', 'a session exactly at the gym-local day start counts as today');

reset role;
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000171', (select next_day_start - interval '1 minute' from health_bounds));
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a session one minute before the next gym-local day counts as today');

reset role;
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000171', (select day_start - interval '1 minute' from health_bounds));
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a session one minute before the gym-local day start is not today -- a UTC-bucketed day would count it');

reset role;
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000011', '00000000-0000-0000-0172-000000000171', (select next_day_start from health_bounds));
set local role authenticated;

select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a session exactly at the next gym-local day start is not today -- the window is [start, end)');

select is(
  (select count(*) from members m, gym_local_period_bounds() pb
   where m.gym_id = '00000000-0000-0000-0172-000000000011'
     and m.join_date >= pb.month_start_date and m.join_date < pb.next_month_start_date),
  8::bigint,
  'the role = ''member'' filter is load-bearing: without it the five staff who joined this month count too (8, not 3)'
);

-- ============================================================================
-- Gym scoping.
-- ============================================================================
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000141', '00000000-0000-0000-0172-000000000012', '00000000-0000-0000-0172-000000000037', 'member', 'Gym Health B member', (select month_start_date from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000012', '00000000-0000-0000-0172-000000000141', '00000000-0000-0000-0172-000000000162', 'active', current_date, current_date + 30);
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000012', '00000000-0000-0000-0172-000000000172', (select day_start + interval '10 hours' from health_bounds));

select is(
  (select format('%s/%s', (select count(*) from subscriptions where gym_id = '00000000-0000-0000-0172-000000000012'),
                          (select count(*) from class_sessions where gym_id = '00000000-0000-0000-0172-000000000012'))),
  '1/1',
  'Gym B does hold an active subscription and a session today'
);

set local role authenticated;
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000012'), '0/0/0/0', 'Gym A''s owner reads none of Gym B''s rows');
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'Gym B''s rows do not change Gym A''s figures');

-- ============================================================================
-- Every role that can see the row gets the owner's figures.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000022","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000011","app_role":"manager"}',
  true
);
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a Gym A manager gets the owner''s figures');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000023","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000011","app_role":"supervisor"}',
  true
);
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a Gym A supervisor gets the owner''s figures');

-- The row is hidden from the front desk in the UI, not by RLS: a
-- receptionist can read every figure on it.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000024","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000011","app_role":"receptionist"}',
  true
);
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000011'), '3/2/3/2', 'a Gym A receptionist gets the same figures -- the Manager-plus gate is a UI choice, not an authorization boundary');

-- ============================================================================
-- Suspended gym: tenant_active_gate hides the counted rows.
-- ============================================================================
reset role;
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0172-000000000151', '00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000038', 'member', 'Gym Health C member', (select month_start_date from health_bounds)),
  ('00000000-0000-0000-0172-000000000152', '00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000039', 'member', 'Gym Health C at-risk member', (select month_start_date from health_bounds));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000151', '00000000-0000-0000-0172-000000000163', 'active', current_date, current_date + 30),
  ('00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000152', '00000000-0000-0000-0172-000000000163', 'expired', current_date - 80, current_date - 50);
insert into class_sessions (gym_id, class_id, scheduled_at) values
  ('00000000-0000-0000-0172-000000000013', '00000000-0000-0000-0172-000000000173', (select day_start + interval '10 hours' from health_bounds));

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0172-000000000013'),
  'suspended',
  'Gym C is genuinely suspended (seeded at insert, not by a silently-reverted UPDATE)'
);
select is(
  gym_health_test_figures('00000000-0000-0000-0172-000000000013'),
  '1/1/2/1',
  'as the superuser, Gym C does hold an active member, an at-risk member, two joins this month and a session today'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0172-000000000027","role":"authenticated","gym_id":"00000000-0000-0000-0172-000000000013","app_role":"owner"}',
  true
);
select is(gym_health_test_figures('00000000-0000-0000-0172-000000000013'), '0/0/0/0', 'a suspended gym''s owner gets 0 on every card -- tenant_active_gate hides the rows with no guard in any function');

select * from finish();
rollback;
