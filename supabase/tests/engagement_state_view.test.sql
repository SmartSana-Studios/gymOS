-- Story 30.3 (FR-219, FR-220, FR-224, NFR-028): private.engagement_state_view_at / engagement_state_view (migration 0186), the single source of
-- the open week, the at-risk flags and the day bounds.
--
-- Proves: every column of the row in order; the at-risk boundary table of the story (goal 3 on Saturday, Friday, Sunday, Sunday with two
-- visits, a visit today, goal 7 on a Monday with and without a visit, an expired member) and the plan matrix (Pay-per-session, monthly, no
-- plan, grace_period, the LATEST of two subscriptions); the release week (both flags false, no streak_if_met); the epoch unset; the settled
-- streak and streak_if_met; the goal in force, the default flag and the pending goal; the visit-day count (distinct days, voided rows and other
-- weeks excluded); needs_settle in each of its cases; the 23 h and 25 h days and the local midnight; a timezone change that moves "today" but
-- no past visit_day; that the view writes nothing; and that the non-`_at` form is the `_at` form at now().
--
-- Time never comes from the clock: every call passes p_now, visit days are explicit, the gym is Africa/Douala (Europe/Paris for the DST days).
-- Mondays used: 2026-02-23 (the release week), 2026-03-02 (the epoch), 03-09, 03-16. The session time zone is pinned to UTC so timestamps compare as text.
--
-- Fixture ids: 00000000-0000-0000-0038-00000000nnnn. Gym 1001 (Douala), 1002 (Paris), 1003 (timezone change); users 2xxx, members 3xxx.

begin;
set local timezone = 'UTC';
select plan(70);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0038-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'SV Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'SV Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'SV Gym P', pg_temp.id(0, 1), 'active', 'Europe/Paris'),
  (pg_temp.id(1, 3), 'SV Gym T', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'sv-' || n || '@x.example', now() from generate_series(1, 40) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, case when n = 20 then 2 when n = 21 then 3 else 1 end), pg_temp.id(2, n), 'member', 'SV Member ' || n, date '2026-01-05'
from generate_series(1, 40) n;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.id(4, 1), pg_temp.id(1, 1), 'SV Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  (pg_temp.id(4, 2), pg_temp.id(1, 1), 'SV PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);
-- Every member has an active monthly subscription except: 8 expired, 9 Pay-per-session, 10 none, 11 grace_period, 22 and 23 two subscriptions.
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id, pg_temp.id(4, 1),
       (case m.id when pg_temp.m(8) then 'expired' when pg_temp.m(11) then 'grace_period' else 'active' end)::subscription_status,
       date '2026-01-05', date '2030-01-01'
from members m where m.id between pg_temp.m(1) and pg_temp.m(40) and m.id not in (pg_temp.m(9), pg_temp.m(10), pg_temp.m(22), pg_temp.m(23), pg_temp.m(20), pg_temp.m(21));
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  (pg_temp.id(1, 1), pg_temp.m(9), pg_temp.id(4, 2), 'active', date '2026-01-05', null);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  (pg_temp.id(1, 1), pg_temp.m(22), pg_temp.id(4, 1), 'expired', date '2025-01-05', date '2025-12-01', timestamptz '2026-01-01 00:00:00+00'),
  (pg_temp.id(1, 1), pg_temp.m(22), pg_temp.id(4, 1), 'active',  date '2026-01-05', date '2030-01-01', timestamptz '2026-02-01 00:00:00+00'),
  (pg_temp.id(1, 1), pg_temp.m(23), pg_temp.id(4, 1), 'active',  date '2025-01-05', date '2030-01-01', timestamptz '2026-01-01 00:00:00+00'),
  (pg_temp.id(1, 1), pg_temp.m(23), pg_temp.id(4, 1), 'expired', date '2026-01-05', date '2026-02-01', timestamptz '2026-02-01 00:00:00+00');

create function pg_temp.visit(p_n int, p_day date, p_hour int default 10) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + make_time(p_hour, 0, 0)) at time zone 'Africa/Douala', (p_day + make_time(p_hour, 30, 0)) at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;
create function pg_temp.voided_visit(p_n int, p_day date) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, voided_at, voided_by, void_reason)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '10:30') at time zone 'Africa/Douala', 'void', p_day,
         (p_day + time '10:20') at time zone 'Africa/Douala', pg_temp.id(2, p_n), 'voided in the fixture'
  from members m where m.id = pg_temp.m(p_n);
end $f$;
-- One column of the view row, as text ('null' when NULL).
create function pg_temp.c(p_n int, p_now timestamptz, p_col text) returns text language sql stable as $f$
  select coalesce(to_jsonb(v) ->> p_col, 'null') from private.engagement_state_view_at(pg_temp.m(p_n), p_now) v
$f$;
-- Several columns, 'a|b|c'.
create function pg_temp.cs(p_n int, p_now timestamptz, p_cols text[]) returns text language sql stable as $f$
  select string_agg(coalesce(to_jsonb(v) ->> k, 'null'), '|' order by o) from private.engagement_state_view_at(pg_temp.m(p_n), p_now) v, unnest(p_cols) with ordinality as t(k, o)
$f$;

-- ============================================================================
-- Shape: the column list, in the order of the story
-- ============================================================================
select is(
  (select array_to_string(array(select x.name from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(name, mode, ord)
     where p.oid = 'private.engagement_state_view_at(uuid, timestamptz)'::regprocedure and x.mode = 't' order by x.ord), ',')),
  'enabled,gym_today,week_start,week_end,in_release_week,goal,goal_is_default,pending_goal,pending_effective_week,visits_this_week,goal_met,visited_today,streak_weeks,streak_if_met,best_streak_weeks,has_settled_week,days_left_in_week,visits_needed,at_risk_weekly,at_risk_daily,daily_run,shields_held,comeback_state,day_starts_at,day_ends_at,server_now,needs_settle,pending_milestone',
  'the view returns exactly the AC columns, in order');
select is((select proretset from pg_proc where oid = 'private.engagement_state_view_at(uuid, timestamptz)'::regprocedure), true, 'it returns a set (one row per member that exists)');
select is((select provolatile::text from pg_proc where oid = 'private.engagement_state_view(uuid)'::regprocedure), 's', 'engagement_state_view is STABLE');
select is((select provolatile::text from pg_proc where oid = 'private.engagement_state_view_at(uuid, timestamptz)'::regprocedure), 's', 'engagement_state_view_at is STABLE');
select is((select count(*)::int from private.engagement_state_view_at(gen_random_uuid(), now())), 0, 'a member id that does not exist gives no row');

-- ============================================================================
-- The epoch unset: enabled false, both flags false, nothing to settle
-- ============================================================================
select pg_temp.visit(1, date '2026-03-02');
select is(pg_temp.cs(1, '2026-03-07 12:00+01', array['enabled', 'in_release_week', 'at_risk_weekly', 'at_risk_daily', 'needs_settle', 'streak_if_met']), 'false|false|false|false|false|null',
          'epoch NULL: enabled false, in_release_week false, both at-risk flags false, needs_settle false, streak_if_met null (the Saturday case would be at risk if the epoch were set)');
insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(17), pg_temp.id(1, 1), date '2026-03-02');
select is(pg_temp.c(17, '2026-03-14 12:00+01', 'needs_settle'), 'false', 'epoch NULL: needs_settle is false even for a dirty member (nothing is settled while dark)');
select is(pg_temp.c(17, '2026-03-14 12:00+01', 'enabled'), 'false', 'epoch NULL: enabled is false');
delete from engagement_state where member_id = pg_temp.m(17);

update platform_engagement_config set release_week_start = date '2026-03-02';

-- ============================================================================
-- Every column, in a typical state: Saturday 2026-03-07, goal 3 by default, one visit on Monday, a duplicate that day, a visit next week, a voided visit
-- ============================================================================
select pg_temp.visit(1, date '2026-03-02', 15);
select pg_temp.visit(1, date '2026-03-09');
select pg_temp.voided_visit(1, date '2026-03-05');
select is(
  (select to_jsonb(v) from private.engagement_state_view_at(pg_temp.m(1), timestamptz '2026-03-07 12:00+01') v),
  jsonb_build_object(
    'enabled', true, 'gym_today', '2026-03-07', 'week_start', '2026-03-02', 'week_end', '2026-03-08', 'in_release_week', false,
    'goal', 3, 'goal_is_default', true, 'pending_goal', null, 'pending_effective_week', null,
    'visits_this_week', 1, 'goal_met', false, 'visited_today', false,
    'streak_weeks', 0, 'streak_if_met', null, 'best_streak_weeks', 0, 'has_settled_week', false,
    'days_left_in_week', 2, 'visits_needed', 2, 'at_risk_weekly', true, 'at_risk_daily', false,
    'daily_run', null, 'shields_held', 0, 'comeback_state', 'none',
    'day_starts_at', '2026-03-06T23:00:00+00:00', 'day_ends_at', '2026-03-07T23:00:00+00:00', 'server_now', '2026-03-07T11:00:00+00:00',
    'needs_settle', false, 'pending_milestone', null),
  'every column: Saturday, goal 3, one visit day (two check-ins that day count once; the next week and the voided visit do not), at risk');

-- ============================================================================
-- The at-risk boundary table (goal 3)
-- ============================================================================
select pg_temp.visit(2, date '2026-03-02');
select is(pg_temp.cs(2, '2026-03-06 12:00+01', array['visits_needed', 'days_left_in_week', 'at_risk_weekly']), '2|3|false', 'Friday, 1 visit: needed 2, left 3 -> false (a rest day remains)');
select pg_temp.visit(3, date '2026-03-02');
select is(pg_temp.cs(3, '2026-03-08 12:00+01', array['visits_needed', 'days_left_in_week', 'at_risk_weekly']), '2|1|false', 'Sunday, 1 visit: needed 2, left 1 -> false (cannot be met)');
select pg_temp.visit(4, date '2026-03-02');
select pg_temp.visit(4, date '2026-03-03');
select is(pg_temp.cs(4, '2026-03-08 12:00+01', array['visits_needed', 'days_left_in_week', 'visited_today', 'at_risk_weekly']), '1|1|false|true', 'Sunday, 2 visits, none today: needed 1, left 1 -> true');
select pg_temp.visit(5, date '2026-03-07');
select is(pg_temp.cs(5, '2026-03-07 12:00+01', array['visits_needed', 'days_left_in_week', 'visited_today', 'at_risk_weekly']), '2|2|true|false', 'Saturday, 1 visit including one today: false (visited today)');
-- goal 7: an explicit row at the epoch Monday (the history guard is for the real clock, so it is switched off for the fixture).
alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values
  (pg_temp.m(6), pg_temp.id(1, 1), date '2026-03-02', 7), (pg_temp.m(7), pg_temp.id(1, 1), date '2026-03-02', 7);
select pg_temp.visit(7, date '2026-03-02');
select is(pg_temp.cs(6, '2026-03-02 12:00+01', array['goal', 'visits_needed', 'days_left_in_week', 'visited_today', 'at_risk_weekly']), '7|7|7|false|true',
          'goal 7 on a Monday with 0 visits: needed 7, left 7 -> true (the definition applies literally)');
select is(pg_temp.cs(7, '2026-03-02 12:00+01', array['goal', 'visits_needed', 'days_left_in_week', 'visited_today', 'at_risk_weekly']), '7|6|7|true|false',
          'the same Monday after a visit that day: false');
select is(pg_temp.cs(7, '2026-03-03 12:00+01', array['visits_needed', 'days_left_in_week', 'visited_today', 'at_risk_weekly']), '6|6|false|true',
          'goal 7, Tuesday, one visit (Monday), none today: needed 6, left 6 -> true again');
select pg_temp.visit(8, date '2026-03-02');
select is(pg_temp.cs(8, '2026-03-07 12:00+01', array['visits_needed', 'days_left_in_week', 'at_risk_weekly']), '2|2|false', 'the Saturday case for an expired subscription: false');
select pg_temp.visit(9, date '2026-03-02');
select is(pg_temp.c(9, '2026-03-07 12:00+01', 'at_risk_weekly'), 'true', 'a Pay-per-session member with no expiry is treated like any other: true');
select pg_temp.visit(10, date '2026-03-02');
select is(pg_temp.cs(10, '2026-03-07 12:00+01', array['enabled', 'at_risk_weekly']), 'true|false', 'a member with no subscription (awaiting the fee) gets a row; no plan behaves as expired: false');
select pg_temp.visit(11, date '2026-03-02');
select is(pg_temp.c(11, '2026-03-07 12:00+01', 'at_risk_weekly'), 'true', 'a grace_period member is at risk like an active one');
select pg_temp.visit(22, date '2026-03-02');
select is(pg_temp.c(22, '2026-03-07 12:00+01', 'at_risk_weekly'), 'true', 'two subscriptions, the LATEST active (older expired): true');
select pg_temp.visit(23, date '2026-03-02');
select is(pg_temp.c(23, '2026-03-07 12:00+01', 'at_risk_weekly'), 'false', 'two subscriptions, the LATEST expired (older active): false');
select is(pg_temp.c(1, '2026-03-08 12:00+01', 'days_left_in_week'), '1', 'days_left_in_week is 1 on the Sunday');
select is(pg_temp.c(1, '2026-03-02 12:00+01', 'days_left_in_week'), '7', 'and 7 on the Monday (today included)');
select is(pg_temp.cs(1, '2026-03-07 23:30+00', array['gym_today', 'days_left_in_week']), '2026-03-08|1', 'a UTC time that is already Sunday in Douala is Sunday: the day is the gym-local one');
select is(pg_temp.c(3, '2026-03-08 12:00+01', 'goal_met'), 'false', 'goal_met is false below the goal');
select pg_temp.visit(3, date '2026-03-03');
select pg_temp.visit(3, date '2026-03-04');
select is(pg_temp.cs(3, '2026-03-08 12:00+01', array['visits_this_week', 'goal_met', 'visits_needed', 'at_risk_weekly']), '3|true|0|false', 'three visit days meet goal 3: goal_met, visits_needed 0, not at risk');
select pg_temp.visit(3, date '2026-03-05');
select is(pg_temp.cs(3, '2026-03-08 12:00+01', array['visits_this_week', 'visits_needed']), '4|0', 'a fourth day: visits_needed never goes below 0');

-- ============================================================================
-- The release week: both flags false, no streak_if_met, in_release_week true; the epoch Monday itself is counted
-- ============================================================================
select pg_temp.visit(12, date '2026-02-23');
select is(pg_temp.cs(12, '2026-02-28 12:00+01', array['in_release_week', 'week_start', 'visits_needed', 'days_left_in_week', 'at_risk_weekly', 'at_risk_daily']), 'true|2026-02-23|2|2|false|false',
          'the release week (before the epoch): the Saturday shape is NOT at risk');
select pg_temp.visit(13, date '2026-02-23'); select pg_temp.visit(13, date '2026-02-24'); select pg_temp.visit(13, date '2026-02-25');
select is(pg_temp.cs(13, '2026-02-28 12:00+01', array['goal_met', 'streak_if_met']), 'true|null', 'the release week with the goal met: streak_if_met is NULL');
select is(pg_temp.cs(3, '2026-03-02 09:00+01', array['in_release_week', 'enabled']), 'false|true', 'the epoch Monday is a counted week, not the release week');

-- ============================================================================
-- The goal in force, the default flag and the pending goal
-- ============================================================================
insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values
  (pg_temp.m(14), pg_temp.id(1, 1), date '2026-03-02', 2), (pg_temp.m(14), pg_temp.id(1, 1), date '2026-03-16', 5), (pg_temp.m(14), pg_temp.id(1, 1), date '2026-03-23', 6);
alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
select is(pg_temp.cs(14, '2026-03-11 12:00+01', array['goal', 'goal_is_default', 'pending_goal', 'pending_effective_week']), '2|false|5|2026-03-16', 'goal 2 in force, the earliest later row is pending (5 from 2026-03-16)');
select is(pg_temp.cs(14, '2026-03-18 12:00+01', array['goal', 'pending_goal', 'pending_effective_week']), '5|6|2026-03-23', 'a week later: goal 5 in force, 6 pending');
select is(pg_temp.cs(14, '2026-03-26 12:00+01', array['goal', 'pending_goal', 'pending_effective_week']), '6|null|null', 'and later still: goal 6, nothing pending');
select is(pg_temp.cs(1, '2026-03-11 12:00+01', array['goal', 'goal_is_default', 'pending_goal']), '3|true|null', 'a member with no goal row: the default 3, goal_is_default true');
select is(pg_temp.cs(7, '2026-03-11 12:00+01', array['goal', 'goal_is_default']), '7|false', 'a member whose only row is in the past: goal_is_default is false');

-- ============================================================================
-- The settled streak, streak_if_met, best streak, has_settled_week
-- ============================================================================
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits) values
  (pg_temp.m(15), pg_temp.id(1, 1), 'week', '2026-03-02', 1, 'met', 3, 3), (pg_temp.m(15), pg_temp.id(1, 1), 'week', '2026-03-09', 1, 'met', 3, 3),
  (pg_temp.m(25), pg_temp.id(1, 1), 'week', '2026-03-02', 1, 'met', 3, 3), (pg_temp.m(25), pg_temp.id(1, 1), 'week', '2026-03-09', 1, 'met', 3, 3),
  (pg_temp.m(26), pg_temp.id(1, 1), 'week', '2026-03-02', 1, 'met', 3, 3), (pg_temp.m(26), pg_temp.id(1, 1), 'week', '2026-03-09', 1, 'met', 3, 3),
  (pg_temp.m(26), pg_temp.id(1, 1), 'week', '2026-03-16', 1, 'missed', 3, 1), (pg_temp.m(26), pg_temp.id(1, 1), 'week', '2026-03-23', 1, 'met', 3, 3);
select pg_temp.visit(15, date '2026-03-16'); select pg_temp.visit(15, date '2026-03-17'); select pg_temp.visit(15, date '2026-03-18');
select is(pg_temp.cs(15, '2026-03-20 12:00+01', array['streak_weeks', 'best_streak_weeks', 'has_settled_week', 'goal_met', 'streak_if_met']), '2|2|true|true|3',
          'two settled met weeks and the open week already met: streak 2, streak_if_met 3 (the open week is never in streak_weeks)');
select pg_temp.visit(25, date '2026-03-16');
select is(pg_temp.cs(25, '2026-03-20 12:00+01', array['streak_weeks', 'goal_met', 'streak_if_met']), '2|false|null', 'the open week not met yet: streak_if_met is NULL');
select is(pg_temp.cs(26, '2026-03-31 12:00+01', array['streak_weeks', 'best_streak_weeks']), '1|2', 'met, met, missed, met: the streak is 1 and the best stays 2');
select is(pg_temp.cs(1, '2026-03-20 12:00+01', array['streak_weeks', 'best_streak_weeks', 'has_settled_week']), '0|0|false', 'a member with no week fact: 0, 0 and has_settled_week false');
select is(pg_temp.c(15, '2026-03-12 12:00+01', 'streak_weeks'), '2', 'the streak read is the same wherever in the open week the call is made');

-- ============================================================================
-- needs_settle
-- ============================================================================
select pg_temp.visit(16, date '2026-03-03');
select is(pg_temp.c(16, '2026-03-14 12:00+01', 'needs_settle'), 'true', 'a visit day, settled_through unset and a closed counted week (2026-03-02): true');
select is(pg_temp.c(16, '2026-03-04 12:00+01', 'needs_settle'), 'false', 'the same member while only the release week has closed: false (that Monday is before the epoch)');
select is(pg_temp.c(18, '2026-03-14 12:00+01', 'needs_settle'), 'false', 'no visit day and no mark: false');
select pg_temp.visit(27, date '2026-03-10');
select is(pg_temp.c(27, '2026-03-12 12:00+01', 'needs_settle'), 'false', 'a member whose only visit day is in the open week (2026-03-09, the last closed week 2026-03-02 is counted): false, there is nothing to settle');
select is(pg_temp.c(27, '2026-03-17 12:00+01', 'needs_settle'), 'true', 'and true once that week has closed');
insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(17), pg_temp.id(1, 1), date '2026-03-02');
select is(pg_temp.c(17, '2026-03-04 12:00+01', 'needs_settle'), 'true', 'a dirty mark: true, with or without a visit');
select pg_temp.visit(19, date '2026-03-03');
update attendance_events set voided_at = timestamptz '2026-03-03 11:00+01', voided_by = pg_temp.id(2, 19), void_reason = 'voided fixture' where member_id = pg_temp.m(19);
select is(pg_temp.c(19, '2026-03-14 12:00+01', 'needs_settle'), 'false', 'a member whose only visit was voided has no visit day: false');
insert into engagement_state (member_id, gym_id, settled_through) values (pg_temp.m(24), pg_temp.id(1, 1), date '2026-03-02');
select pg_temp.visit(24, date '2026-03-03');
select is(pg_temp.c(24, '2026-03-14 12:00+01', 'needs_settle'), 'false', 'settled through the last closed week (2026-03-02): false');
select is(pg_temp.c(24, '2026-03-21 12:00+01', 'needs_settle'), 'true', 'a week later the last closed week is 2026-03-09: true');
-- After the settle that the view asks for, it no longer asks.
select is(private.settle_engagement(pg_temp.m(16), pg_temp.id(1, 1), date '2026-03-14'), 1, 'settle writes the one closed week of member 16');
select is(pg_temp.c(16, '2026-03-14 12:00+01', 'needs_settle'), 'false', 'and then needs_settle is false');
select is(pg_temp.cs(16, '2026-03-14 12:00+01', array['streak_weeks', 'best_streak_weeks', 'has_settled_week']), '0|0|true', 'the settled week (1 visit, goal 3: missed) is in the fold: streak 0, has_settled_week true');

-- ============================================================================
-- The day: local midnight, 23 h and 25 h days, the gym's current timezone
-- ============================================================================
select pg_temp.visit(20, date '2026-03-29');
select is(pg_temp.cs(20, '2026-03-29 12:00+02', array['gym_today', 'day_starts_at', 'day_ends_at']), '2026-03-29|2026-03-28T23:00:00+00:00|2026-03-29T22:00:00+00:00', 'Paris, 2026-03-29 (spring forward): the day runs 23 h, to the next local midnight');
select is((select extract(epoch from (to_jsonb(v) ->> 'day_ends_at')::timestamptz - (to_jsonb(v) ->> 'day_starts_at')::timestamptz) / 3600
           from private.engagement_state_view_at(pg_temp.m(20), timestamptz '2026-03-29 12:00+02') v), 23::numeric, 'that day is 23 hours long');
select is((select extract(epoch from (to_jsonb(v) ->> 'day_ends_at')::timestamptz - (to_jsonb(v) ->> 'day_starts_at')::timestamptz) / 3600
           from private.engagement_state_view_at(pg_temp.m(20), timestamptz '2026-10-25 12:00+01') v), 25::numeric, 'Paris 2026-10-25 (fall back) is 25 hours long');
select is(pg_temp.cs(20, '2026-10-25 12:00+01', array['day_starts_at', 'day_ends_at']), '2026-10-24T22:00:00+00:00|2026-10-25T23:00:00+00:00', 'with the local midnights as bounds');
select is(pg_temp.cs(20, '2026-03-29 23:30+00', array['gym_today', 'week_start']), '2026-03-30|2026-03-30', 'Paris at 23:30 UTC is already Monday 2026-03-30: today and the week follow the gym, not UTC');
select is(pg_temp.c(20, '2026-03-29 12:00+02', 'server_now'), '2026-03-29T10:00:00+00:00', 'server_now is the p_now it was given');

select pg_temp.visit(21, date '2026-03-04');
select is(pg_temp.cs(21, '2026-03-07 12:00+00', array['gym_today', 'visits_this_week', 'day_starts_at']), '2026-03-07|1|2026-03-06T23:00:00+00:00', 'before the change: Douala, Saturday, the visit counted');
update gyms set timezone = 'Pacific/Kiritimati' where id = pg_temp.id(1, 3);
select is(pg_temp.cs(21, '2026-03-07 12:00+00', array['gym_today', 'visits_this_week', 'day_starts_at', 'day_ends_at']), '2026-03-08|1|2026-03-07T10:00:00+00:00|2026-03-08T10:00:00+00:00',
          'after the gym moves to UTC+14: today and the day bounds follow the new timezone, and the stored visit is still in the week');
select is((select visit_day from attendance_events where member_id = pg_temp.m(21)), date '2026-03-04', 'the stored visit_day did not move');
select is(pg_temp.cs(21, '2026-03-07 12:00+00', array['week_start', 'week_end']), '2026-03-02|2026-03-08', 'and the week is the Monday of the new today');

-- ============================================================================
-- Reads only; the plain form is the `_at` form at now()
-- ============================================================================
create temp table snap_state as select * from engagement_state;
create temp table snap_facts as select * from engagement_facts;
select is((select count(pg_temp.c(m, '2026-03-14 12:00+01', 'needs_settle'))::int from generate_series(1, 26) m), 26, 'the view answers for every fixture member');
select is((select count(*)::int from (select * from engagement_state except select * from snap_state) x), 0, 'reading the view for every fixture member changed no engagement_state row');
select is((select count(*)::int from (select * from snap_state except select * from engagement_state) x), 0, 'and removed none');
select is((select count(*)::int from (select * from engagement_facts except select * from snap_facts) x) + (select count(*)::int from (select * from snap_facts except select * from engagement_facts) x), 0, 'and changed no engagement_facts row');
select is((select to_jsonb(v) from private.engagement_state_view(pg_temp.m(1)) v), (select to_jsonb(v) from private.engagement_state_view_at(pg_temp.m(1), now()) v),
          'engagement_state_view(member) is engagement_state_view_at(member, now())');
select is((select to_jsonb(v) from private.engagement_state_view(pg_temp.m(15)) v), (select to_jsonb(v) from private.engagement_state_view_at(pg_temp.m(15), now()) v),
          'and for a member with facts');
select is(
  (select count(*)::int from pg_proc p where p.oid in ('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure, 'private.engagement_state_view(uuid)'::regprocedure)
     and p.prosrc ~* '\m(insert|update|delete)\M\s+(into|from)?\s*(public\.)?(engagement_|member_weekly)'),
  0, 'the view source has no write statement');

select * from finish();
rollback;
