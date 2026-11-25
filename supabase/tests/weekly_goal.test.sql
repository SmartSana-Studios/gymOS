-- Story 30.1: set_weekly_goal(smallint), my_weekly_goal() and the goal-history trigger (migration 0184), positive paths and the history rule.
-- Refusals (callers that are not a live member, privileges, source scans) live in weekly_goal.negative.test.sql.
--
-- pgTAP runs in one transaction: now() is constant, so the gym-local week is fixed for the whole file. Expected dates are computed with an
-- independent formula (date_trunc on the local timestamp), not with the helpers under test, and work on any weekday.
--
-- Time cannot move inside a test, and the functions take no clock. The state "the clock is in the pending Monday" is built the way the database
-- itself would reach it: the pending row's effective_week becomes the current Monday (trigger disabled by this superuser-only helper, then enabled again).
-- Past rows are seeded the same way.
--
-- Fixture ids: 00000000-0000-0000-0030-0000000002xx. Gyms 2 1n, users 2 2nn, members 2 3nn.

begin;
select plan(87);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000002' || lpad(to_hex(16 + n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000022' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000023' || lpad(to_hex(n), 2, '0'))::uuid $f$;

-- Gym-local (Africa/Douala) Mondays, from first principles.
create function pg_temp.this_monday() returns date language sql stable as $f$ select date_trunc('week', now() at time zone 'Africa/Douala')::date $f$;
create function pg_temp.next_monday() returns date language sql stable as $f$ select (date_trunc('week', now() at time zone 'Africa/Douala') + interval '7 days')::date $f$;

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- set_weekly_goal as member n of gym g: "goal|effective_week|current_goal|is_default", or sqlstate:message.
create function pg_temp.setg(p_n int, p_gym int, p_goal int) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.claims(pg_temp.u(p_n), pg_temp.g(p_gym), 'member');
  set local role authenticated;
  begin
    select format('%s|%s|%s|%s', r.goal, coalesce(r.effective_week::text, '-'), r.current_goal, r.current_goal_is_default::text)
      into v from set_weekly_goal(p_goal::smallint) r;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

-- set_weekly_goal(NULL).
create function pg_temp.setg_null(p_n int, p_gym int) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.claims(pg_temp.u(p_n), pg_temp.g(p_gym), 'member');
  set local role authenticated;
  begin
    select r.goal::text into v from set_weekly_goal(null) r;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;

-- my_weekly_goal as member n of gym g: "current|is_default|pending|pending_week|next_week|min|max", or 'no row'.
create function pg_temp.myg(p_n int, p_gym int) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.claims(pg_temp.u(p_n), pg_temp.g(p_gym), 'member');
  set local role authenticated;
  select format('%s|%s|%s|%s|%s|%s|%s', r.current_goal, r.current_goal_is_default::text, coalesce(r.pending_goal::text, '-'),
                coalesce(r.pending_effective_week::text, '-'), r.next_effective_week, r.goal_min, r.goal_max)
    into v from my_weekly_goal() r;
  reset role;
  return coalesce(v, 'no row');
end $f$;

-- Rows of member n, as "week:goal" sorted by week, or '-'.
create function pg_temp.rows_of(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(effective_week::text || ':' || goal, ',' order by effective_week), '-') from member_weekly_goals where member_id = pg_temp.m(p_n)
$f$;

-- Seeds a goal row `p_weeks_ago` weeks before the current gym-local Monday (0 = the current Monday itself).
create function pg_temp.seed(p_n int, p_gym int, p_weeks_ago int, p_goal int) returns void language plpgsql as $f$
begin
  alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
  insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (pg_temp.m(p_n), pg_temp.g(p_gym), pg_temp.this_monday() - 7 * p_weeks_ago, p_goal);
  alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
end $f$;

-- The clock reaches the pending Monday: the pending row becomes the row of the current week.
create function pg_temp.reach_pending_monday(p_n int) returns void language plpgsql as $f$
begin
  alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
  update member_weekly_goals set effective_week = pg_temp.this_monday() where member_id = pg_temp.m(p_n) and effective_week = pg_temp.next_monday();
  alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0030-000000000201', 'WG Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.g(1), 'WG Gym A', '00000000-0000-0000-0030-000000000201', 'active', 'Africa/Douala'),
  (pg_temp.g(2), 'WG Gym B', '00000000-0000-0000-0030-000000000201', 'active', 'Africa/Douala'),
  (pg_temp.g(3), 'WG Gym D (time zone flip)', '00000000-0000-0000-0030-000000000201', 'active', 'Africa/Douala'),
  (pg_temp.g(4), 'WG Gym E (cascade)', '00000000-0000-0000-0030-000000000201', 'active', 'Africa/Douala');

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'wg-' || n || '@x.example', now() from generate_series(1, 30) n;

-- Members 1..12: gym A. 13: gym B. 14: gym D. 15, 16: gym E. 17: gym A (history-trigger subject). 18: gym A (cascade subject). 20: gym A owner.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.g(case when n = 13 then 2 when n = 14 then 3 when n in (15, 16) then 4 else 1 end), pg_temp.u(n),
       (case when n = 20 then 'owner' else 'member' end)::member_role, 'WG Member ' || n, current_date
from generate_series(1, 20) n where n <> 19;

-- ============================================================================
-- Shape
-- ============================================================================
select has_function('public', 'set_weekly_goal', array['smallint']::name[], 'set_weekly_goal(smallint) exists');
select has_function('public', 'my_weekly_goal', '{}'::name[], 'my_weekly_goal() exists');
select is_definer('public', 'set_weekly_goal', array['smallint']::name[], 'set_weekly_goal is SECURITY DEFINER');
select is_definer('public', 'my_weekly_goal', '{}'::name[], 'my_weekly_goal is SECURITY DEFINER');
select volatility_is('public', 'my_weekly_goal', '{}'::name[], 'stable', 'my_weekly_goal is STABLE');
select volatility_is('public', 'set_weekly_goal', array['smallint']::name[], 'volatile', 'set_weekly_goal is VOLATILE');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.set_weekly_goal(smallint)'::regprocedure),
  array['search_path=public'],
  'set_weekly_goal pins search_path to public'
);

-- ============================================================================
-- First goal: one row at the next gym-local Monday, the default applies meanwhile
-- ============================================================================
select is(pg_temp.myg(1, 1), '3|true|-|-|' || pg_temp.next_monday() || '|1|7', 'no goal yet: the default 3 is in force, nothing pending, the range comes from the config');
select is(pg_temp.setg(1, 1, 5), '5|' || pg_temp.next_monday() || '|3|true', 'first goal 5: returns the pending goal and its Monday, and the default 3 is still in force');
select is(pg_temp.rows_of(1), pg_temp.next_monday() || ':5', 'exactly one row, at the next Monday');
select is((select gym_id from member_weekly_goals where member_id = pg_temp.m(1)), pg_temp.g(1), 'stamped with the member''s gym');
select is(pg_temp.myg(1, 1), '3|true|5|' || pg_temp.next_monday() || '|' || pg_temp.next_monday() || '|1|7', 'my_weekly_goal: current 3 (default), pending 5 on the next Monday');
select is((select count(*)::int from member_weekly_goals), 1, 'the read wrote nothing, and nothing else was written');

-- Replace the pending row
select is(pg_temp.setg(1, 1, 4), '4|' || pg_temp.next_monday() || '|3|true', 'a second call in the same week replaces the pending row');
select is(pg_temp.rows_of(1), pg_temp.next_monday() || ':4', 'still one row, now 4 (no unique-key error)');
select is(pg_temp.setg(1, 1, 4), '4|' || pg_temp.next_monday() || '|3|true', 'setting the pending value again changes nothing');
select is(pg_temp.rows_of(1), pg_temp.next_monday() || ':4', 'and writes nothing');

-- Cancel a pending change
select pg_temp.seed(3, 1, 2, 3);
select is(pg_temp.myg(3, 1), '3|false|-|-|' || pg_temp.next_monday() || '|1|7', 'a goal of 3 in force from an explicit row');
select is(pg_temp.setg(3, 1, 5), '5|' || pg_temp.next_monday() || '|3|false', 'pending 5 on top of 3 in force');
select is(pg_temp.rows_of(3), (pg_temp.this_monday() - 14) || ':3,' || pg_temp.next_monday() || ':5', 'two rows');
select is(pg_temp.setg(3, 1, 3), '3|-|3|false', 'setting the goal in force cancels the pending change: no pending Monday in the result');
select is(pg_temp.rows_of(3), (pg_temp.this_monday() - 14) || ':3', 'the pending row is deleted and the history row is untouched');

-- Cancel back to the default, for a member with NO explicit history
select is(pg_temp.setg(12, 1, 5), '5|' || pg_temp.next_monday() || '|3|true', 'a member with no history sets 5: pending, the default 3 in force');
select is(pg_temp.setg(12, 1, 3), '3|-|3|true', 'setting the default cancels it: 3 in force, still the default, nothing pending');
select is(pg_temp.rows_of(12), '-', 'and the member has no member_weekly_goals row at all');

-- No-op
select pg_temp.seed(4, 1, 3, 4);
select is(pg_temp.setg(4, 1, 4), '4|-|4|false', 'the goal in force, nothing pending, history explicit: the same result');
select is(pg_temp.rows_of(4), (pg_temp.this_monday() - 21) || ':4', 'and nothing was written');
select is(pg_temp.setg(4, 1, 6), '6|' || pg_temp.next_monday() || '|4|false', 'a change from an explicit goal in force is pending');
select is(pg_temp.rows_of(4), (pg_temp.this_monday() - 21) || ':4,' || pg_temp.next_monday() || ':6', 'next to the row in force');

-- First goal equal to the default
select is(pg_temp.setg(5, 1, 3), '3|' || pg_temp.next_monday() || '|3|true', 'no rows and set 3: an explicit row at 3 is written');
select is(pg_temp.rows_of(5), pg_temp.next_monday() || ':3', 'one explicit row at the next Monday');
select is(pg_temp.setg(5, 1, 3), '3|' || pg_temp.next_monday() || '|3|true', 'asking for 3 again changes nothing (it is the pending choice)');
select is(pg_temp.rows_of(5), pg_temp.next_monday() || ':3', 'still one row');

-- Monday rollover
select pg_temp.seed(7, 1, 2, 3);
select pg_temp.setg(7, 1, 5);
select is(pg_temp.myg(7, 1), '3|false|5|' || pg_temp.next_monday() || '|' || pg_temp.next_monday() || '|1|7', 'before the Monday: 3 in force, 5 pending');
select pg_temp.reach_pending_monday(7);
select is(pg_temp.myg(7, 1), '5|false|-|-|' || pg_temp.next_monday() || '|1|7', 'in the pending Monday: 5 is in force and nothing is pending');
select is(pg_temp.rows_of(7), (pg_temp.this_monday() - 14) || ':3,' || pg_temp.this_monday() || ':5', 'the earlier week''s value is unchanged');
select is(pg_temp.setg(7, 1, 2), '2|' || pg_temp.next_monday() || '|5|false', 'a new change after the rollover is pending again, from the new goal in force');
select is(pg_temp.setg(7, 1, 5), '5|-|5|false', 'and going back to 5 cancels it');

-- A member whose only row has become the goal in force (a first goal that has taken effect)
select pg_temp.setg(8, 1, 6);
select pg_temp.reach_pending_monday(8);
select is(pg_temp.myg(8, 1), '6|false|-|-|' || pg_temp.next_monday() || '|1|7', 'a first goal that has taken effect is explicit, not the default');

-- ============================================================================
-- Bad goals
-- ============================================================================
select is(pg_temp.setg(9, 1, 0), '22023:invalid_goal', '0 is refused with the stable code');
select is(pg_temp.setg(9, 1, 8), '22023:invalid_goal', '8 is refused');
select is(pg_temp.setg(9, 1, -1), '22023:invalid_goal', '-1 is refused');
select is(pg_temp.setg_null(9, 1), '22023:invalid_goal', 'NULL is refused');
select is(pg_temp.rows_of(9), '-', 'nothing was written by any of them');
select is(pg_temp.setg(9, 1, 7), '7|' || pg_temp.next_monday() || '|3|true', 'the boundary 7 is accepted');
select is(pg_temp.setg(9, 1, 1), '1|' || pg_temp.next_monday() || '|3|true', 'and so is 1');

-- The range is read from the config: goal_max 6 refuses 7 with no code change.
update platform_engagement_config set goal_max = 6;
select is(pg_temp.setg(10, 1, 7), '22023:invalid_goal', 'goal_max 6 in the config refuses 7');
select is(pg_temp.rows_of(10), '-', 'and writes nothing');
select is(pg_temp.setg(10, 1, 6), '6|' || pg_temp.next_monday() || '|3|true', 'but accepts 6');
select is(pg_temp.myg(10, 1), '3|true|6|' || pg_temp.next_monday() || '|' || pg_temp.next_monday() || '|1|6', 'and my_weekly_goal reports the config range');
update platform_engagement_config set goal_max = 7, goal_min = 2, goal_default = 3;
select is(pg_temp.setg(11, 1, 1), '22023:invalid_goal', 'goal_min 2 in the config refuses 1');
select is(pg_temp.myg(11, 1), '3|true|-|-|' || pg_temp.next_monday() || '|2|7', 'and the range follows');
update platform_engagement_config set goal_min = 1;
update platform_engagement_config set goal_default = 4;
select is(pg_temp.myg(11, 1), '4|true|-|-|' || pg_temp.next_monday() || '|1|7', 'the default in force follows goal_default for a member with no explicit row');
update platform_engagement_config set goal_default = 3;

-- ============================================================================
-- A member only ever affects their own row, in their own gym
-- ============================================================================
select is(pg_temp.setg(13, 2, 2), '2|' || pg_temp.next_monday() || '|3|true', 'a member of gym B sets a goal');
select is((select gym_id from member_weekly_goals where member_id = pg_temp.m(13)), pg_temp.g(2), 'the row carries gym B');
select is(pg_temp.rows_of(13), pg_temp.next_monday() || ':2', 'one row for that member');
select is((select count(*)::int from member_weekly_goals where member_id <> pg_temp.m(13) and goal = 2), 0, 'and no other member''s row changed');
-- a member of gym B who sends a claim naming gym A is not a member of A: refused
select is(pg_temp.setg(13, 1, 4), '42501:permission denied', 'a gym B member presenting gym A''s claim is refused');
select is(pg_temp.myg(13, 1), 'no row', 'and reads no row');

-- ============================================================================
-- Time zone change: the stored date does not move
-- ============================================================================
select is(pg_temp.setg(14, 3, 5), '5|' || pg_temp.next_monday() || '|3|true', 'a Douala gym member sets a goal');
update gyms set timezone = 'Africa/Nairobi' where id = pg_temp.g(3);
select is(pg_temp.rows_of(14), pg_temp.next_monday() || ':5', 'the stored effective_week did not move when the gym changed to Nairobi');
update gyms set timezone = 'Africa/Douala' where id = pg_temp.g(3);
select is(pg_temp.rows_of(14), pg_temp.next_monday() || ':5', 'nor when it changed back');
update gyms set timezone = 'Africa/Nairobi' where id = pg_temp.g(3);
select ok(
  case when date_trunc('week', now() at time zone 'Africa/Nairobi')::date = pg_temp.this_monday()
       then pg_temp.myg(14, 3) = '3|true|5|' || pg_temp.next_monday() || '|' || pg_temp.next_monday() || '|1|7'
       else true end,
  'the pending goal still takes effect on the stored date (asserted whenever Nairobi and Douala share the current week: Sunday 21:00 to 23:00 UTC they do not)'
);
update gyms set timezone = 'Africa/Douala' where id = pg_temp.g(3);

-- ============================================================================
-- The history trigger: anyone, including the table owner and a definer function
-- ============================================================================
select pg_temp.seed(17, 1, 2, 3);
select pg_temp.seed(17, 1, 1, 4);
select throws_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 4)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.this_monday()),
  '23514', null, 'the table owner cannot insert a row for the current week');
select throws_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 4)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.this_monday() - 28),
  '23514', null, 'nor for a past week');
select lives_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 5)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.next_monday()),
  'but can insert the next Monday');
select throws_ok(
  format($$update member_weekly_goals set effective_week = %L where member_id = %L and effective_week = %L$$, pg_temp.this_monday(), pg_temp.m(17), pg_temp.next_monday()),
  '23514', null, 'a pending row cannot be moved into the current week');
select throws_ok(
  format($$update member_weekly_goals set goal = 7 where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.this_monday() - 7),
  '23514', null, 'the goal in force cannot be rewritten');
select throws_ok(
  format($$update member_weekly_goals set goal = 7 where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.this_monday() - 14),
  '23514', null, 'nor a past goal');
select throws_ok(
  format($$delete from member_weekly_goals where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.this_monday() - 7),
  '23514', null, 'the goal in force cannot be deleted');
select throws_ok(
  format($$delete from member_weekly_goals where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.this_monday() - 14),
  '23514', null, 'nor a past one');
select throws_ok(
  format($$update member_weekly_goals set effective_week = %L where member_id = %L and effective_week = %L$$, pg_temp.next_monday() + 7, pg_temp.m(17), pg_temp.this_monday() - 14),
  '23514', null, 'a past row cannot be moved to the future either');
select is(pg_temp.rows_of(17), (pg_temp.this_monday() - 14) || ':3,' || (pg_temp.this_monday() - 7) || ':4,' || pg_temp.next_monday() || ':5', 'every refusal left the rows as they were');

create function pg_temp.definer_rewrites() returns void language plpgsql security definer as $f$
begin
  update member_weekly_goals set goal = 1 where member_id = pg_temp.m(17) and effective_week = pg_temp.this_monday() - 7;
end $f$;
select throws_ok($$select pg_temp.definer_rewrites()$$, '23514', null, 'a SECURITY DEFINER function cannot rewrite the goal in force either');
select lives_ok(
  format($$update member_weekly_goals set goal = 6 where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.next_monday()),
  'the pending row may still change');
select lives_ok(
  format($$delete from member_weekly_goals where member_id = %L and effective_week = %L$$, pg_temp.m(17), pg_temp.next_monday()),
  'and be deleted');

select throws_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 4)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.next_monday() + 1),
  '23514', null, 'effective_week must be a Monday');
select throws_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 8)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.next_monday()),
  '23514', null, 'goal 8 is refused by the table');
select throws_ok(
  format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, %L, 0)$$, pg_temp.m(17), pg_temp.g(1), pg_temp.next_monday()),
  '23514', null, 'and goal 0');

-- ============================================================================
-- Deleting a member or a gym is not blocked by their history
-- ============================================================================
select pg_temp.seed(18, 1, 2, 3);
select pg_temp.setg(18, 1, 5);
select is(pg_temp.rows_of(18), (pg_temp.this_monday() - 14) || ':3,' || pg_temp.next_monday() || ':5', 'a member with history in force and a pending row');
select lives_ok(format($$delete from members where id = %L$$, pg_temp.m(18)), 'deleting the member is allowed');
select is(pg_temp.rows_of(18), '-', 'and their history went with them');

select pg_temp.seed(15, 4, 3, 3);
select pg_temp.seed(16, 4, 1, 5);
select is((select count(*)::int from member_weekly_goals where gym_id = pg_temp.g(4)), 2, 'gym E holds two history rows');
select lives_ok(format($$delete from members where gym_id = %L$$, pg_temp.g(4)), 'deleting the gym''s members is allowed');
select is((select count(*)::int from member_weekly_goals where gym_id = pg_temp.g(4)), 0, 'and their history went with them');
select lives_ok(format($$delete from gyms where id = %L$$, pg_temp.g(4)), 'so deleting the gym is allowed');

-- ============================================================================
-- Nothing else wrote anything
-- ============================================================================
select is((select count(*)::int from member_weekly_goals where member_id = pg_temp.m(20)), 0, 'the owner has no goal row');

select * from finish();
rollback;
