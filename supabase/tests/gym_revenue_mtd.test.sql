-- Story 17.1: gym_revenue_mtd() (0095_gym_revenue_mtd.sql) -- the AD-02
-- Overview's "Revenue this month" card. Proves, each rule against its own
-- positive control: the month arithmetic in private.gym_local_month_bounds()
-- at FIXED dates, for every month and every allowed gym timezone; verified-
-- only; net of refunds (refunds are stored positive and subtract); the month
-- window is gym-local and half-open [start, end); refunds are attributed by
-- refund date; gym scoping; a receptionist gets the owner's figure; RLS
-- genuinely applies under invoker rights (coach -> 0, suspended gym -> 0); and
-- a session with no gym_id claim gets 0, never NULL.
--
-- Fixtures are added INCREMENTALLY and the figure re-asserted after each
-- step, so every exclusion assertion is paired with the inclusion assertion
-- immediately before it -- an exclusion that passes because nothing was
-- counted at all is caught by the step before it. Every assertion reads this
-- test's own gyms only, so it holds against a non-empty local database.
--
-- Gym C is seeded `status = 'suspended'` IN ITS INSERT, never by UPDATE: the
-- protect_super_admin_only_gym_columns trigger (0014) silently reverts a
-- non-super-admin `update gyms set status` with no error, which would make
-- the suspension assertion pass for the wrong reason.

begin;
select plan(36);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0017-000000000001', 'Revenue MTD Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity, timezone, status) values
  ('00000000-0000-0000-0017-000000000011', 'Revenue MTD Gym A', '00000000-0000-0000-0017-000000000001', 30, 'Africa/Douala', 'active'),
  ('00000000-0000-0000-0017-000000000012', 'Revenue MTD Gym B', '00000000-0000-0000-0017-000000000001', 30, 'Africa/Douala', 'active'),
  ('00000000-0000-0000-0017-000000000013', 'Revenue MTD Gym C', '00000000-0000-0000-0017-000000000001', 30, 'Africa/Douala', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0017-000000000021'), -- Gym A owner
  ('00000000-0000-0000-0017-000000000022'), -- Gym A receptionist
  ('00000000-0000-0000-0017-000000000023'), -- Gym A coach
  ('00000000-0000-0000-0017-000000000024'), -- Gym B owner
  ('00000000-0000-0000-0017-000000000025'), -- Gym C owner
  ('00000000-0000-0000-0017-000000000031'), -- Gym A payer
  ('00000000-0000-0000-0017-000000000032'), -- Gym B payer
  ('00000000-0000-0000-0017-000000000033'); -- Gym C payer

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0017-000000000041', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000021', 'owner', 'Revenue Gym A Owner'),
  ('00000000-0000-0000-0017-000000000042', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000022', 'receptionist', 'Revenue Gym A Receptionist'),
  ('00000000-0000-0000-0017-000000000043', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000023', 'coach', 'Revenue Gym A Coach'),
  ('00000000-0000-0000-0017-000000000044', '00000000-0000-0000-0017-000000000012', '00000000-0000-0000-0017-000000000024', 'owner', 'Revenue Gym B Owner'),
  ('00000000-0000-0000-0017-000000000045', '00000000-0000-0000-0017-000000000013', '00000000-0000-0000-0017-000000000025', 'owner', 'Revenue Gym C Owner'),
  ('00000000-0000-0000-0017-000000000051', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000031', 'member', 'Revenue Gym A Payer'),
  ('00000000-0000-0000-0017-000000000052', '00000000-0000-0000-0017-000000000012', '00000000-0000-0000-0017-000000000032', 'member', 'Revenue Gym B Payer'),
  ('00000000-0000-0000-0017-000000000053', '00000000-0000-0000-0017-000000000013', '00000000-0000-0000-0017-000000000033', 'member', 'Revenue Gym C Payer');

-- Gym-local (Africa/Douala, UTC+1) month bounds for "now", taken from the
-- helper gym_revenue_mtd() itself uses -- the helper's arithmetic is proven
-- at fixed dates in its own section below, so these rows test the function's
-- use of the window rather than re-deriving it. Seeding rows relative to
-- "now", rather than at fixed dates, keeps the test valid in every month.
create temp table revenue_mtd_bounds as
select month_start, next_month_start
from private.gym_local_month_bounds('Africa/Douala', now());

-- make_timestamptz() as an INDEPENDENT oracle for the helper: every month of
-- 2026 (December rolls into 2027), at three instants per month -- its first
-- instant, mid-month, and its last minute -- in every gym timezone the app
-- allows (packages/types gymSettingsSchema.timezone).
create temp table month_bounds_oracle as
select tz, m, i.at_instant,
  make_timestamptz(2026, m, 1, 0, 0, 0, tz) as exp_start,
  make_timestamptz(2026 + (m = 12)::int, m % 12 + 1, 1, 0, 0, 0, tz) as exp_next
from unnest(array['Africa/Douala', 'Africa/Lagos', 'Africa/Bangui', 'Africa/Kinshasa', 'UTC']) as zones(tz)
cross join generate_series(1, 12) as months(m)
cross join lateral (values
  (make_timestamptz(2026, m, 1, 0, 0, 0, tz)),
  (make_timestamptz(2026, m, 15, 12, 0, 0, tz)),
  (make_timestamptz(2026 + (m = 12)::int, m % 12 + 1, 1, 0, 0, 0, tz) - interval '1 minute')
) as i(at_instant);

-- ============================================================================
-- Shape and privileges.
-- ============================================================================
select has_function('public', 'gym_revenue_mtd', '{}'::name[], 'gym_revenue_mtd() exists and takes no arguments');
select function_returns('public', 'gym_revenue_mtd', '{}'::name[], 'bigint', 'gym_revenue_mtd() returns bigint');
select isnt_definer('public', 'gym_revenue_mtd', '{}'::name[], 'gym_revenue_mtd() is SECURITY INVOKER -- RLS stays the authorization boundary');
select volatility_is('public', 'gym_revenue_mtd', '{}'::name[], 'stable', 'gym_revenue_mtd() is STABLE');
select ok(
  not has_function_privilege('anon', 'public.gym_revenue_mtd()', 'execute'),
  'anon cannot execute gym_revenue_mtd() -- EXECUTE is revoked from PUBLIC'
);
select ok(
  has_function_privilege('authenticated', 'public.gym_revenue_mtd()', 'execute'),
  'authenticated can execute gym_revenue_mtd()'
);

-- Fixture sanity: the boundary rows below only distinguish gym-local from UTC
-- bucketing because the gym-local month start is NOT midnight UTC.
select is(
  extract(hour from (select month_start from revenue_mtd_bounds) at time zone 'UTC')::int,
  23,
  'the Africa/Douala month start is 23:00 UTC on the previous day, so the boundary rows below separate gym-local from UTC bucketing'
);

-- ============================================================================
-- private.gym_local_month_bounds(): the month arithmetic, at FIXED dates.
-- gym_revenue_mtd() reads now(), which a test cannot pin, and the "+ interval
-- after at time zone" bug is invisible in seven months of twelve -- so the
-- arithmetic lives in this helper and is proven here against the oracle
-- above, whatever month the suite happens to run in. The session timezone is
-- pinned to UTC, as under PostgREST: that is the session the bug needs.
-- ============================================================================
set local timezone = 'UTC';

select has_function('private', 'gym_local_month_bounds', array['text', 'timestamp with time zone']::name[], 'private.gym_local_month_bounds(text, timestamptz) exists');
select isnt_definer('private', 'gym_local_month_bounds', array['text', 'timestamp with time zone']::name[], 'private.gym_local_month_bounds() is SECURITY INVOKER');
select volatility_is('private', 'gym_local_month_bounds', array['text', 'timestamp with time zone']::name[], 'immutable', 'private.gym_local_month_bounds() is IMMUTABLE -- it reads no table');
select ok(
  not has_function_privilege('anon', 'private.gym_local_month_bounds(text, timestamptz)', 'execute'),
  'anon cannot execute private.gym_local_month_bounds() -- EXECUTE is revoked from PUBLIC'
);
select ok(
  has_function_privilege('authenticated', 'private.gym_local_month_bounds(text, timestamptz)', 'execute'),
  'authenticated can execute private.gym_local_month_bounds() -- gym_revenue_mtd() runs with the caller''s rights, so the caller needs it'
);
select ok(
  pg_get_functiondef('public.gym_revenue_mtd()'::regprocedure) like '%private.gym_local_month_bounds(%',
  'gym_revenue_mtd() takes its month window from the helper, so the fixed-date proof below covers the live figure'
);

select is(
  (select month_start from private.gym_local_month_bounds('Africa/Douala', '2026-03-15 12:00+00')),
  '2026-02-28 23:00+00'::timestamptz,
  'March 2026 in Africa/Douala starts at 2026-02-28 23:00 UTC'
);
select is(
  (select next_month_start from private.gym_local_month_bounds('Africa/Douala', '2026-03-15 12:00+00')),
  '2026-03-31 23:00+00'::timestamptz,
  'March 2026 in Africa/Douala ends at 2026-03-31 23:00 UTC -- the wrong form ends it three days early, at 2026-03-28 23:00'
);
select is(
  (select count(*) from month_bounds_oracle),
  180::bigint,
  'the oracle covers 5 timezones x 12 months x 3 instants -- so "no mismatches" below cannot pass vacuously'
);
select is(
  (select count(*) from month_bounds_oracle o, private.gym_local_month_bounds(o.tz, o.at_instant) b
   where b.month_start <> o.exp_start or b.next_month_start <> o.exp_next),
  0::bigint,
  'every month of 2026, in every allowed gym timezone, at its first instant, mid-month and last minute, matches the make_timestamptz() oracle'
);
select is(
  (select array_agg(distinct o.m order by o.m) from month_bounds_oracle o
   where o.tz = 'Africa/Douala'
     and ((date_trunc('month', o.at_instant at time zone o.tz) at time zone o.tz) + interval '1 month') <> o.exp_next),
  array[3, 5, 7, 10, 12],
  'positive control: the WRONG form (+ interval after at time zone) fails the oracle in exactly March, May, July, October and December -- the oracle can see the bug'
);

set local timezone = 'Pacific/Kiritimati';
select is(
  (select count(*) from month_bounds_oracle o, private.gym_local_month_bounds(o.tz, o.at_instant) b
   where b.month_start <> o.exp_start or b.next_month_start <> o.exp_next),
  0::bigint,
  'the helper does not depend on the session timezone -- the same 180 cases hold under a UTC+14 session'
);
set local timezone = 'UTC';

-- ============================================================================
-- Gym A owner: rules, one step at a time.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000101', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 10000, 'XAF', 'cash', 'verified', now());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000021","role":"authenticated","gym_id":"00000000-0000-0000-0017-000000000011","app_role":"owner"}',
  true
);

select is(gym_revenue_mtd(), 10000::bigint, 'a verified in-window payment counts');

-- Verified-only.
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000102', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 4000, 'XAF', 'cash', 'pending', now()),
  ('00000000-0000-0000-0017-000000000103', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 2000, 'XAF', 'cash', 'processing', now()),
  ('00000000-0000-0000-0017-000000000104', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 3000, 'XAF', 'cash', 'flagged', now());
set local role authenticated;

select is(gym_revenue_mtd(), 10000::bigint, 'pending, processing and flagged in-window payments are excluded -- verified only');

-- Net of refunds.
reset role;
insert into refunds (id, gym_id, payment_id, amount, reason, actor_id, created_at) values
  ('00000000-0000-0000-0017-000000000201', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000101', 2500, 'Revenue MTD refund', '00000000-0000-0000-0017-000000000021', now());
set local role authenticated;

select is(gym_revenue_mtd(), 7500::bigint, 'a positive-amount refund recorded this month is subtracted, not summed in');

-- Month window, lower bound.
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000105', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 20000, 'XAF', 'cash', 'verified', (select month_start - interval '1 minute' from revenue_mtd_bounds));
set local role authenticated;

select is(gym_revenue_mtd(), 7500::bigint, 'a verified payment one minute before the gym-local month start is excluded');

reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000106', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 500, 'XAF', 'cash', 'verified', (select month_start from revenue_mtd_bounds));
set local role authenticated;

select is(gym_revenue_mtd(), 8000::bigint, 'a verified payment exactly at the gym-local month start is included -- a UTC-bucketed window would drop it');

-- Month window, upper bound (half-open).
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000107', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 700, 'XAF', 'cash', 'verified', (select next_month_start - interval '1 minute' from revenue_mtd_bounds));
set local role authenticated;

select is(gym_revenue_mtd(), 8700::bigint, 'a verified payment one minute before the next gym-local month start is included');

reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000108', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 800, 'XAF', 'cash', 'verified', (select next_month_start from revenue_mtd_bounds));
set local role authenticated;

select is(gym_revenue_mtd(), 8700::bigint, 'a verified payment exactly at the next gym-local month start is excluded -- the window is [start, end)');

-- Refund attribution is by refund date.
reset role;
insert into refunds (id, gym_id, payment_id, amount, reason, actor_id, created_at) values
  ('00000000-0000-0000-0017-000000000202', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000105', 1000, 'Revenue MTD refund of a prior-month payment', '00000000-0000-0000-0017-000000000021', now());
set local role authenticated;

select is(gym_revenue_mtd(), 7700::bigint, 'a refund recorded this month against a prior-month payment reduces this month');

reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000109', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000051', 5000, 'XAF', 'cash', 'verified', (select month_start - interval '1 day' from revenue_mtd_bounds));
insert into refunds (id, gym_id, payment_id, amount, reason, actor_id, created_at) values
  ('00000000-0000-0000-0017-000000000203', '00000000-0000-0000-0017-000000000011', '00000000-0000-0000-0017-000000000109', 5000, 'Revenue MTD prior-month refund', '00000000-0000-0000-0017-000000000021', (select month_start - interval '1 day' from revenue_mtd_bounds));
set local role authenticated;

select is(gym_revenue_mtd(), 7700::bigint, 'a refund recorded in the prior gym-local month is excluded');

-- ============================================================================
-- Gym scoping.
-- ============================================================================
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000110', '00000000-0000-0000-0017-000000000012', '00000000-0000-0000-0017-000000000052', 99000, 'XAF', 'cash', 'verified', now());
set local role authenticated;

select is(gym_revenue_mtd(), 7700::bigint, 'Gym B''s verified payment does not appear in Gym A''s figure');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000024","role":"authenticated","gym_id":"00000000-0000-0000-0017-000000000012","app_role":"owner"}',
  true
);

select is(gym_revenue_mtd(), 99000::bigint, 'Gym B''s owner sees Gym B''s own figure');

-- ============================================================================
-- Roles: receptionist matches owner; coach is outside both SELECT policies.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000022","role":"authenticated","gym_id":"00000000-0000-0000-0017-000000000011","app_role":"receptionist"}',
  true
);

select is(gym_revenue_mtd(), 7700::bigint, 'a Gym A receptionist gets the same figure as the Gym A owner');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000023","role":"authenticated","gym_id":"00000000-0000-0000-0017-000000000011","app_role":"coach"}',
  true
);

select is(gym_revenue_mtd(), 0::bigint, 'a Gym A coach gets 0, not NULL -- outside both SELECT policies, so RLS is genuinely applied under invoker rights');

-- ============================================================================
-- Suspended gym: tenant_active_gate applies with no explicit guard.
-- ============================================================================
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status, created_at) values
  ('00000000-0000-0000-0017-000000000111', '00000000-0000-0000-0017-000000000013', '00000000-0000-0000-0017-000000000053', 42000, 'XAF', 'cash', 'verified', now());

select is(
  (select status::text from gyms where id = '00000000-0000-0000-0017-000000000013'),
  'suspended',
  'Gym C is genuinely suspended (seeded at insert, not by a silently-reverted UPDATE)'
);

select is(
  (select count(*) from payments where gym_id = '00000000-0000-0000-0017-000000000013' and status = 'verified'),
  1::bigint,
  'Gym C does hold a verified in-window payment'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000025","role":"authenticated","gym_id":"00000000-0000-0000-0017-000000000013","app_role":"owner"}',
  true
);

select is(gym_revenue_mtd(), 0::bigint, 'a suspended gym''s owner gets 0 -- tenant_active_gate hides its payments without any guard in the function');

-- ============================================================================
-- No gym_id claim: private.gym_id() is NULL, the figure is 0, never NULL.
-- ============================================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0017-000000000021","role":"authenticated","app_role":"owner"}',
  true
);

select is(gym_revenue_mtd(), 0::bigint, 'a session with no gym_id claim gets 0, never NULL');

select * from finish();
rollback;
