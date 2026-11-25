-- Story 30.1: private.gym_local_week_bounds(text, timestamptz) and private.week_start_of(date) (migration 0184).
--
-- Proves, against an independent make_timestamptz() oracle:
--  * shape and privileges (invoker rights, IMMUTABLE, no EXECUTE for PUBLIC or anon);
--  * the week is Monday 00:00 gym-local to the next Monday 00:00 gym-local, for every day of 2026 at local 00:00, 12:00 and 23:59, in Douala,
--    Los Angeles, Paris, Nairobi and UTC, under a UTC and a UTC+14 session time zone;
--  * the instant Sunday 23:30 UTC is Monday 00:30 in Douala and falls in the NEW week; an instant exactly at Monday 00:00 local belongs to the
--    new week and one second earlier to the old one;
--  * the Paris week with the last Sunday of March is 167 hours and the one with the last Sunday of October 169 hours (the interval is added to
--    the local timestamp, the 0095 rule), and a positive control that the oracle sees the `+ interval` on a timestamptz bug;
--  * week_start_of returns the Monday on or before a date, for every day of a 2-year span.

begin;
select plan(28);

-- ============================================================================
-- Shape and privileges
-- ============================================================================
select has_function('private', 'gym_local_week_bounds', array['text', 'timestamp with time zone']::name[], 'private.gym_local_week_bounds(text, timestamptz) exists');
select isnt_definer('private', 'gym_local_week_bounds', array['text', 'timestamp with time zone']::name[], 'gym_local_week_bounds is SECURITY INVOKER');
select volatility_is('private', 'gym_local_week_bounds', array['text', 'timestamp with time zone']::name[], 'immutable', 'gym_local_week_bounds is IMMUTABLE -- it reads no table');
select has_function('private', 'week_start_of', array['date']::name[], 'private.week_start_of(date) exists');
select volatility_is('private', 'week_start_of', array['date']::name[], 'immutable', 'week_start_of is IMMUTABLE');
select ok(
  not has_function_privilege('anon', 'private.gym_local_week_bounds(text, timestamptz)', 'execute')
  and not has_function_privilege('public', 'private.gym_local_week_bounds(text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.week_start_of(date)', 'execute')
  and not has_function_privilege('public', 'private.week_start_of(date)', 'execute'),
  'anon and PUBLIC cannot execute either helper'
);
select is(
  has_function_privilege('authenticated', 'private.gym_local_week_bounds(text, timestamptz)', 'execute'),
  has_function_privilege('authenticated', 'private.gym_local_month_bounds(text, timestamptz)', 'execute'),
  'authenticated has exactly what the month helper has'
);

-- ============================================================================
-- Every day of 2026, at local 00:00, 12:00 and 23:59, against the oracle
-- ============================================================================
create temp table week_oracle as
select tz, d as day, i.at_instant,
  make_timestamptz(extract(year from m)::int, extract(month from m)::int, extract(day from m)::int, 0, 0, 0, tz) as exp_start,
  make_timestamptz(extract(year from m + 7)::int, extract(month from m + 7)::int, extract(day from m + 7)::int, 0, 0, 0, tz) as exp_next
from unnest(array['Africa/Douala', 'America/Los_Angeles', 'Europe/Paris', 'Africa/Nairobi', 'UTC']) as zones(tz)
cross join lateral (select g::date as d from generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') as g) as days
cross join lateral (select (d - (extract(isodow from d)::int - 1)) as m) as mon
cross join lateral (values
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 0, 0, 0, tz)),
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 12, 0, 0, tz)),
  (make_timestamptz(extract(year from d)::int, extract(month from d)::int, extract(day from d)::int, 23, 59, 0, tz))
) as i(at_instant);

select is((select count(*)::int from week_oracle), 5 * 365 * 3, 'the oracle holds 5 zones x 365 days x 3 instants');

set local timezone = 'UTC';
select is(
  (select count(*)::int from week_oracle o, private.gym_local_week_bounds(o.tz, o.at_instant) b
   where b.week_start is distinct from o.exp_start or b.next_week_start is distinct from o.exp_next),
  0,
  'every instant of 2026 maps to the oracle week, in every zone, under a UTC session'
);
set local timezone = 'Pacific/Kiritimati';
select is(
  (select count(*)::int from week_oracle o, private.gym_local_week_bounds(o.tz, o.at_instant) b
   where b.week_start is distinct from o.exp_start or b.next_week_start is distinct from o.exp_next),
  0,
  'and the same under a UTC+14 session: the session time zone never leaks in'
);
set local timezone = 'UTC';

-- ============================================================================
-- Monday boundaries
-- ============================================================================
-- Sunday 22 November 2026 23:30 UTC is Monday 23 November 00:30 in Douala (UTC+1): the new week.
select is(
  (select week_start from private.gym_local_week_bounds('Africa/Douala', timestamptz '2026-11-22 23:30:00+00')),
  timestamptz '2026-11-22 23:00:00+00',
  'Sunday 23:30 UTC is in the NEW week in Douala (it started Sunday 23:00 UTC)'
);
select is(
  (select week_start from private.gym_local_week_bounds('UTC', timestamptz '2026-11-22 23:30:00+00')),
  timestamptz '2026-11-16 00:00:00+00',
  'and in the OLD week in UTC (control: the same instant, the zone decides)'
);
select is(
  (select week_start from private.gym_local_week_bounds('Africa/Douala', timestamptz '2026-11-22 23:00:00+00')),
  timestamptz '2026-11-22 23:00:00+00',
  'an instant exactly at Monday 00:00 local belongs to the new week'
);
select is(
  (select week_start from private.gym_local_week_bounds('Africa/Douala', timestamptz '2026-11-22 22:59:59+00')),
  timestamptz '2026-11-15 23:00:00+00',
  'one second earlier belongs to the old week'
);
select is(
  (select next_week_start from private.gym_local_week_bounds('Africa/Douala', timestamptz '2026-11-22 22:59:59+00')),
  timestamptz '2026-11-22 23:00:00+00',
  'and the old week ends exactly where the new one starts'
);
select is(
  (select week_start from private.gym_local_week_bounds('America/Los_Angeles', timestamptz '2026-11-23 07:59:59+00')),
  timestamptz '2026-11-16 08:00:00+00',
  'Los Angeles (UTC-8 in November): Monday 07:59:59 UTC is still Sunday evening local, the old week'
);
select is(
  (select week_start from private.gym_local_week_bounds('America/Los_Angeles', timestamptz '2026-11-23 08:00:00+00')),
  timestamptz '2026-11-23 08:00:00+00',
  'and Monday 08:00:00 UTC is Monday 00:00 local, the new week'
);

-- ============================================================================
-- Paris DST: 167 and 169 hours
-- ============================================================================
-- Last Sunday of March 2026 is the 29th (CET to CEST, the week is one hour short); last Sunday of October 2026 is the 25th (one hour long).
select is(
  (select extract(epoch from next_week_start - week_start) / 3600 from private.gym_local_week_bounds('Europe/Paris', timestamptz '2026-03-29 12:00:00+00')),
  167::numeric,
  'the Paris week with the last Sunday of March is 167 hours'
);
select is(
  (select extract(epoch from next_week_start - week_start) / 3600 from private.gym_local_week_bounds('Europe/Paris', timestamptz '2026-10-25 12:00:00+00')),
  169::numeric,
  'the Paris week with the last Sunday of October is 169 hours'
);
select is(
  (select extract(epoch from next_week_start - week_start) / 3600 from private.gym_local_week_bounds('Europe/Paris', timestamptz '2026-07-15 12:00:00+00')),
  168::numeric,
  'an ordinary Paris week is 168 hours'
);
select is(
  (select week_start from private.gym_local_week_bounds('Europe/Paris', timestamptz '2026-03-30 12:00:00+00')),
  timestamptz '2026-03-29 22:00:00+00',
  'the week after the March change starts at 00:00 CEST (22:00 UTC the day before)'
);
select is(
  (select count(*)::int from unnest(array[timestamptz '2026-03-29 12:00:00+00', timestamptz '2026-10-25 12:00:00+00']) t,
     private.gym_local_week_bounds('Africa/Douala', t) b where b.next_week_start - b.week_start <> interval '168 hours'),
  0,
  'Douala has no DST: the same two weeks are 168 hours'
);
-- Positive control: adding the interval to the timestamptz (the wrong form) is wrong in Paris on exactly those weeks, and the oracle sees it.
select is(
  (select count(*)::int from unnest(array[timestamptz '2026-03-29 12:00:00+00', timestamptz '2026-10-25 12:00:00+00']) t,
     private.gym_local_week_bounds('Europe/Paris', t) b
   where (b.week_start + interval '1 week') is distinct from b.next_week_start),
  2,
  'positive control: week_start + interval 1 week on a timestamptz differs from the helper in both DST weeks'
);

-- ============================================================================
-- week_start_of
-- ============================================================================
select is(
  (select count(*)::int from generate_series(date '2025-01-01', date '2026-12-31', interval '1 day') g
   where private.week_start_of(g::date) is distinct from (g::date - (extract(isodow from g::date)::int - 1))),
  0,
  'week_start_of is the Monday on or before the date, every day of 2025 and 2026'
);
select is(private.week_start_of(date '2026-11-23'), date '2026-11-23', 'a Monday maps to itself');
select is(private.week_start_of(date '2026-11-22'), date '2026-11-16', 'a Sunday maps to the Monday six days earlier');
select is(private.week_start_of(date '2026-01-01'), date '2025-12-29', 'across a year boundary');
select is(
  (select count(*)::int from generate_series(date '2025-01-01', date '2026-12-31', interval '1 day') g where extract(isodow from private.week_start_of(g::date)) <> 1),
  0,
  'it always returns a Monday'
);

select * from finish();
rollback;
