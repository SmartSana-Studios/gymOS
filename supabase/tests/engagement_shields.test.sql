-- Story 31.1: Streak Shields and the comeback (migration 0190). The matrix of the story, in the order of its acceptance criteria:
-- earning (4, 8, the cap), spending, the saved week that does not count, two Shields then a run end, no run, the corrections (late visit,
-- void, replay, A to B to A), a double settle, the comeback (visits, lapse and restart, a met week, withdrawn), the day path behind its
-- guard and its rolled-back activation, config-driven numbers, derived equals rebuild, the calendar read, the consumer gates (who writes a
-- week or comeback fact, who can call what, loyalty untouched, no support capability) shown failing against a mutant, and the plans of the
-- member-visit-day reads on a three-year member.
--
-- Time never comes from the clock: p_up_to is a fixed date in every call and every visit day is explicit. Gym A is Africa/Douala (UTC+1, no
-- DST). Weeks (Mondays): W1 03-02 (the epoch), W2 03-09, W3 03-16, W4 03-23, W5 03-30, W6 04-06, W7 04-13, W8 04-20, W9 04-27, W10 05-04,
-- W11 05-11, W12 05-18, W13 05-25. Goal 3 unless a case says otherwise. A pattern character is the number of visit days of that week
-- (Monday on): M is three, x is none.
--
-- Fixture ids: 00000000-0000-0000-0044-00000000nnnn.

begin;
select plan(159);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0044-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'SH Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'SH Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'SH Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'sh-' || n || '@x.example', now() from generate_series(1, 70) n;
-- 1 to 29 members of gym A (15 of gym B), 30 owner, 31 receptionist, 32 deactivated member, 40 to 59 bulk members for the plan check.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, case when n = 15 then 2 else 1 end), pg_temp.id(2, n),
       (case n when 30 then 'owner' when 31 then 'receptionist' else 'member' end)::member_role,
       'SH Member ' || n, date '2026-01-05', case when n = 32 then now() end
from generate_series(1, 70) n where n <= 32 or n between 40 and 59 or n = 20;

create function pg_temp.visit(p_n int, p_day date, p_hour int default 10) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + make_time(p_hour, 0, 0)) at time zone 'Africa/Douala', (p_day + make_time(p_hour + 1, 0, 0)) at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;
create function pg_temp.void(p_n int, p_day date) returns void language sql as $f$
  update attendance_events set voided_at = timestamptz '2026-03-10 12:00+00', voided_by = pg_temp.id(2, p_n), void_reason = 'test void on the same day'
  where member_id = pg_temp.m(p_n) and visit_day = p_day
$f$;
create function pg_temp.unvoid(p_n int, p_day date) returns void language sql as $f$
  update attendance_events set voided_at = null, voided_by = null, void_reason = null where member_id = pg_temp.m(p_n) and visit_day = p_day
$f$;
create function pg_temp.settle(p_n int, p_up_to date) returns integer language sql as $f$
  select private.settle_engagement(pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_up_to)
$f$;
create function pg_temp.mark_dirty(p_n int, p_week date) returns void language sql as $f$
  insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_week)
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)
$f$;
-- One visit day on each of the first p_visits days of a week.
create function pg_temp.wk(p_n int, p_week date, p_visits int) returns void language plpgsql as $f$
declare i int;
begin
  for i in 0 .. p_visits - 1 loop perform pg_temp.visit(p_n, p_week + i); end loop;
end $f$;
create function pg_temp.pat(p_n int, p_pattern text, p_start date default date '2026-03-02') returns void language plpgsql as $f$
declare i int; ch text;
begin
  for i in 1 .. length(p_pattern) loop
    ch := substr(p_pattern, i, 1);
    perform pg_temp.wk(p_n, p_start + 7 * (i - 1), case ch when 'M' then 3 when 'x' then 0 else ch::int end);
  end loop;
end $f$;
-- The effective week outcomes in week order: m met, s saved, x missed.
create function pg_temp.out(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(case e.outcome when 'met' then 'm' when 'saved' then 's' else 'x' end, '' order by e.subject_key), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'week'
$f$;
-- The effective comeback facts: "key:outcome[/completed_by]".
create function pg_temp.cb(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(e.subject_key || ':' || e.outcome || coalesce('/' || (e.detail ->> 'completed_by'), ''), ' ' order by e.subject_key), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'comeback'
$f$;
create function pg_temp.nweek(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'week' $f$;
create function pg_temp.ncb(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'comeback' $f$;
-- Columns of the state view at a gym-local noon (UTC+1), 'a|b|c' with 'null' for NULL.
create function pg_temp.vw(p_n int, p_day date, p_cols text[]) returns text language sql stable as $f$
  select string_agg(coalesce(to_jsonb(v) ->> k, 'null'), '|' order by o)
  from private.engagement_state_view_at(pg_temp.m(p_n), (p_day + time '12:00') at time zone 'Africa/Douala') v, unnest(p_cols) with ordinality as t(k, o)
$f$;
create function pg_temp.same(p_n int, p_up_to date) returns boolean language sql stable as $f$
  select (select to_jsonb(d) from private.engagement_derived_state(pg_temp.m(p_n)) d) = (select to_jsonb(r) from private.rebuild_engagement(pg_temp.m(p_n), p_up_to) r)
$f$;

-- Counts that must never move (FR-170): the loyalty ledger and progress, and guest sessions.
create temp table loyalty_before as
  select (select count(*) from loyalty_events) as events, (select count(*) from loyalty_progress) as progress, (select count(*) from guest_sessions) as guests;

-- ============================================================================
-- Dark: while the epoch is NULL nothing is written and nothing a member reads changes (the epoch is set right after)
-- ============================================================================
select pg_temp.pat(21, 'MMMMx');
select is(pg_temp.settle(21, date '2026-05-04'), 0, 'dark: settle writes nothing');
select is((select count(*)::int from engagement_facts) + (select count(*)::int from engagement_state), 0, 'dark: no week, comeback or saved fact and no watermark exists');
select is(pg_temp.vw(21, date '2026-05-04', array['enabled', 'streak_weeks', 'shields_held', 'comeback_state', 'saved_week_start', 'weeks_to_next_shield', 'comeback_window_start']),
          'false|null|0|none|null|null|null', 'dark: the view row is the disabled row with no run, no Shield and no comeback');
select is((select count(*)::int from private.rebuild_engagement(pg_temp.m(21), date '2026-05-04') r where r.shields_held = 0 and r.comeback ->> 'state' = 'none'), 1, 'dark: rebuild derives nothing');
update platform_engagement_config set release_week_start = date '2026-03-02';

-- ============================================================================
-- Shape and privileges
-- ============================================================================
select has_function('private', 'engagement_shield_walk', array['jsonb', 'boolean', 'integer', 'integer']::name[], 'the Shield walk exists');
select has_function('private', 'engagement_comeback_walk', array['jsonb', 'date[]', 'date', 'integer', 'integer']::name[], 'the comeback walk exists');
select has_function('private', 'engagement_comeback_fold', array['jsonb', 'jsonb', 'integer']::name[], 'the comeback fold exists');
select has_function('private', 'engagement_daily_streak_enabled', '{}'::name[], 'the daily streak guard exists');
select has_function('public', 'my_saved_weeks', array['date']::name[], 'public.my_saved_weeks(date) exists');
select is(
  (select count(*)::int
   from unnest(array[
     'private.engagement_shield_params()', 'private.engagement_shield_walk(jsonb, boolean, integer, integer)',
     'private.engagement_comeback_walk(jsonb, date[], date, integer, integer)', 'private.engagement_comeback_fold(jsonb, jsonb, integer)',
     'private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer)', 'private.engagement_daily_streak_enabled()',
     'private.engagement_day_reservation(integer, integer, boolean)', 'private.engagement_fold(uuid)',
     'private.engagement_evaluate_weeks(uuid, uuid, date, date)', 'private.settle_engagement(uuid, uuid, date)',
     'private.engagement_state_view_at(uuid, timestamptz)', 'private.engagement_state_view(uuid)', 'private.open_engagement_at(uuid, timestamptz)',
     'private.engagement_derived_state(uuid)', 'private.rebuild_engagement(uuid, date)'
   ]) f, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
   where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'none of the fifteen private functions this story created or replaced is executable by anon, authenticated, service_role or PUBLIC');
select is(
  (select count(*)::int from unnest(array['anon', 'service_role', 'public']) r where has_function_privilege(r, 'public.my_saved_weeks(date)'::regprocedure, 'execute')),
  0, 'my_saved_weeks is not executable by anon, service_role or PUBLIC');
select is(has_function_privilege('anon', 'public.my_engagement()'::regprocedure, 'execute') or has_function_privilege('anon', 'public.open_engagement()'::regprocedure, 'execute'),
          false, 'the re-created public pair is still not executable by anon');
select is(has_function_privilege('authenticated', 'public.my_saved_weeks(date)'::regprocedure, 'execute')
          and has_function_privilege('authenticated', 'public.my_engagement()'::regprocedure, 'execute')
          and has_function_privilege('authenticated', 'public.open_engagement()'::regprocedure, 'execute'), true, 'authenticated holds EXECUTE on the three public functions');
select is((select prosecdef and provolatile = 's' from pg_proc where oid = 'public.my_saved_weeks(date)'::regprocedure), true, 'my_saved_weeks is STABLE and SECURITY DEFINER');
select is((select prosrc !~* 'attendance_events' and prosrc !~* 'at time zone' from pg_proc where oid = 'public.my_saved_weeks(date)'::regprocedure), true,
          'my_saved_weeks reads no attendance table and does no timezone arithmetic');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname ~ 'shield|comeback|saved_week'), 1, 'my_saved_weeks is the only public function this story added');
select is((select count(*)::int from private.support_capabilities where object_name ~* 'engagement|shield|comeback|saved_week'), 0, 'none of the new functions is registered as a support capability');
select is((select prosrc !~* '(attendance|member_visit_days|platform_engagement_config|now\(\)|current_date|clock_timestamp|gym_today)' from pg_proc where oid = 'private.engagement_shield_walk(jsonb, boolean, integer, integer)'::regprocedure)
          and (select prosrc !~* '(attendance|member_visit_days|platform_engagement_config|now\(\)|current_date|clock_timestamp|gym_today|engagement_facts)' from pg_proc where oid = 'private.engagement_comeback_walk(jsonb, date[], date, integer, integer)'::regprocedure),
          true, 'the two walks are pure: no table, no clock');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
             and p.prosrc ~* 'execute\s+format\s*\(' and p.prosrc ~ 'engagement_facts'), 0, 'no function names engagement_facts inside dynamic SQL');

-- ============================================================================
-- Earning: a Shield at the 4th and 8th met week, never stored above the cap
-- ============================================================================
select pg_temp.pat(1, 'MMMMMMMMMMMM');
select is(pg_temp.settle(1, date '2026-03-30'), 4, 'earn: four closed weeks write four facts');
select is(pg_temp.vw(1, date '2026-03-30', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_earned_week', 'shield_cap', 'shield_every_weeks']),
          '4|1|4|2026-03-23|2|4', 'earn: run of 4 holds 1 Shield, 4 weeks to the next, earned on week 4, cap 2 and interval 4 from the config');
select pg_temp.settle(1, date '2026-04-27');
select is(pg_temp.vw(1, date '2026-04-27', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_earned_week']), '8|2|null|2026-04-20',
          'earn: run of 8 holds 2 and weeks_to_next_shield is NULL at the cap');
select pg_temp.settle(1, date '2026-05-25');
select is(pg_temp.vw(1, date '2026-05-25', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_earned_week']), '12|2|null|2026-04-20',
          'earn: run of 12 still holds 2 (a Shield earned at the cap is not stored) and the last stored one is week 8');
select is(pg_temp.out(1), 'mmmmmmmmmmmm', 'earn: twelve met weeks');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(1) and kind not in ('week', 'milestone', 'badge')), 0, 'earn: no Shield row or counter is written anywhere (only week, milestone and badge facts; 31.3 adds the badge)');
select pg_temp.pat(2, 'MMMMM');
select pg_temp.settle(2, date '2026-04-06');
select is(pg_temp.vw(2, date '2026-04-06', array['streak_weeks', 'shields_held', 'weeks_to_next_shield']), '5|1|3', 'earn: run of 5 holds 1, 3 weeks to the next');

-- ============================================================================
-- Spend on a miss: the golden example (cap 2, every 4)
-- ============================================================================
select pg_temp.pat(3, 'MMMMxMMMMxx');
select pg_temp.settle(3, date '2026-04-06');
select is(pg_temp.out(3), 'mmmms', 'golden: weeks 1-4 met, week 5 below goal is saved');
select is(pg_temp.vw(3, date '2026-04-06', array['streak_weeks', 'shields_held', 'saved_week_start', 'saved_week_streak', 'comeback_state', 'best_streak_weeks']),
          '4|0|2026-03-30|4|none|4', 'golden: the Shield is spent, the streak and best stay 4, the saved week and the streak after it are returned, no comeback');
select is((select outcome || ':' || goal || ':' || visits from private.effective_engagement_facts(pg_temp.m(3)) e where e.kind = 'week' and e.subject_key = '2026-03-30'), 'saved:3:0',
          'golden: the saved fact carries the goal and the visit count it was judged on');
select pg_temp.settle(3, date '2026-05-04');
select is(pg_temp.out(3), 'mmmmsmmmm', 'golden: weeks 6-9 met');
select is(pg_temp.vw(3, date '2026-05-04', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_earned_week']), '8|1|4|2026-04-27',
          'golden: the saved week did not count, so the second Shield comes at met-week 8 (week 9)');
select pg_temp.settle(3, date '2026-05-18');
select is(pg_temp.out(3), 'mmmmsmmmmsx', 'golden: week 10 is saved, week 11 with none left is missed');
select is(pg_temp.vw(3, date '2026-05-18', array['streak_weeks', 'best_streak_weeks', 'shields_held', 'comeback_state', 'saved_week_start', 'saved_week_streak', 'weeks_to_next_shield']),
          'null|8|0|active|2026-05-04|8|null', 'golden: the run ended (streak NULL, best 8), held 0, the comeback is active, the newest saved week is week 10');
select is(pg_temp.cb(3), '2026-05-11:started', 'golden: one comeback fact, started, on the missed week''s Monday');
select is((select max(revision) from engagement_facts where member_id = pg_temp.m(3) and kind = 'week'), 1, 'golden: every week has one revision (nothing was rewritten while settling forward)');

-- The saved week does not count toward the next Shield.
select pg_temp.pat(4, 'MMMMMMxMM');
select pg_temp.settle(4, date '2026-04-20');
select is(pg_temp.out(4) || '|' || pg_temp.vw(4, date '2026-04-20', array['streak_weeks', 'shields_held', 'saved_week_start', 'saved_week_streak']), 'mmmmmms|6|0|2026-04-13|6',
          'saved week: a run of 6 spends its Shield on week 7 and keeps 6');
select pg_temp.settle(4, date '2026-04-27');
select is(pg_temp.vw(4, date '2026-04-27', array['streak_weeks', 'shields_held']), '7|0', 'saved week: week 8 met makes 7 and earns nothing (the saved week adds nothing)');
select pg_temp.settle(4, date '2026-05-04');
select is(pg_temp.vw(4, date '2026-05-04', array['streak_weeks', 'shields_held', 'shield_earned_week']), '8|1|2026-04-27', 'saved week: the next Shield is earned at met-week count 8 (week 9)');

-- Two Shields, three misses: two saved, then the run ends.
select pg_temp.pat(5, 'MMMMMMMMxxx');
select pg_temp.settle(5, date '2026-05-11');
select is(pg_temp.out(5) || '|' || pg_temp.vw(5, date '2026-05-11', array['streak_weeks', 'shields_held']), 'mmmmmmmmss|8|0', 'two Shields: two missed weeks in a row spend both, the streak stays 8');
select is(pg_temp.cb(5), '-', 'two Shields: no comeback while a Shield saved the week');
select pg_temp.settle(5, date '2026-05-18');
select is(pg_temp.out(5) || '|' || pg_temp.vw(5, date '2026-05-18', array['streak_weeks', 'best_streak_weeks', 'shields_held', 'comeback_state']), 'mmmmmmmmssx|null|8|0|active',
          'two Shields: the third miss ends the run, best 8, comeback active');
select is(pg_temp.cb(5), '2026-05-11:started', 'two Shields: the comeback started on the third missed week');

-- No run: a week below the goal spends nothing and starts nothing.
select pg_temp.visit(6, date '2026-03-02');
select pg_temp.settle(6, date '2026-03-16');
select is(pg_temp.out(6) || '|' || pg_temp.cb(6) || '|' || pg_temp.vw(6, date '2026-03-16', array['streak_weeks', 'best_streak_weeks', 'shields_held', 'comeback_state']), 'xx|-|null|0|0|none',
          'no run: two missed weeks before any met week write no comeback and no Shield is involved');

-- ============================================================================
-- Corrections: a late visit and a void cascade, and a replay inserts nothing
-- ============================================================================
select pg_temp.pat(7, 'MMMMxMMMM');
select pg_temp.settle(7, date '2026-05-04');
select is(pg_temp.out(7) || '|' || pg_temp.vw(7, date '2026-05-04', array['streak_weeks', 'shields_held']), 'mmmmsmmmm|8|1', 'late visit: before, a saved week 5 and a run of 8 holding 1');
select pg_temp.wk(7, date '2026-03-30', 3);
select pg_temp.mark_dirty(7, date '2026-03-30');
select is(pg_temp.settle(7, date '2026-05-04'), 1, 'late visit: one new revision, week 5 only (later weeks keep their outcome, so no revision for them)');
select is(pg_temp.out(7) || '|' || pg_temp.vw(7, date '2026-05-04', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_earned_week']), 'mmmmmmmmm|9|2|null|2026-04-20',
          'late visit: the saved week is met, the Shield is back, the streak is 9, the later Shield moved to week 8');
select is((select revision from engagement_facts where member_id = pg_temp.m(7) and kind = 'week' and subject_key = '2026-03-30' order by revision desc limit 1), 2, 'late visit: week 5 is revision 2');
select is(pg_temp.nweek(7), 10, 'late visit: ten week rows, the old revision stays in the ledger');
select pg_temp.mark_dirty(7, date '2026-03-02');
select is(pg_temp.settle(7, date '2026-05-04'), 0, 'replay: a settle over the whole range inserts nothing');
select is(pg_temp.nweek(7), 10, 'replay: still ten rows');
select pg_temp.void(7, date '2026-03-31');
select pg_temp.mark_dirty(7, date '2026-03-30');
select is(pg_temp.settle(7, date '2026-05-04'), 1, 'A to B: voiding a visit of week 5 writes revision 3 (saved again)');
select is(pg_temp.out(7) || '|' || pg_temp.vw(7, date '2026-05-04', array['streak_weeks', 'shields_held']), 'mmmmsmmmm|8|1', 'A to B: back to the first state');
select pg_temp.unvoid(7, date '2026-03-31');
select pg_temp.mark_dirty(7, date '2026-03-30');
select is(pg_temp.settle(7, date '2026-05-04'), 1, 'B to A: restoring the visit writes revision 4');
select is(pg_temp.out(7) || '|' || pg_temp.vw(7, date '2026-05-04', array['streak_weeks', 'shields_held']), 'mmmmmmmmm|9|2', 'B to A: flipped back to the late-visit state');
select ok(pg_temp.same(7, date '2026-05-04'), 'late visit: derived equals rebuild');

-- A void that turns a met week into a saved one (a Shield is held) and one that ends the run (none is).
select pg_temp.pat(8, 'MMMMMMM');
select pg_temp.settle(8, date '2026-04-20');
select is(pg_temp.vw(8, date '2026-04-20', array['streak_weeks', 'shields_held', 'best_streak_weeks']), '7|1|7', 'void: before, a run of 7 holding 1');
select pg_temp.void(8, date '2026-03-31');
select pg_temp.mark_dirty(8, date '2026-03-30');
select is(pg_temp.settle(8, date '2026-04-20'), 1, 'void: one revision (week 5); weeks 6 and 7 are re-evaluated in the same pass and keep their outcome');
select is(pg_temp.out(8) || '|' || pg_temp.vw(8, date '2026-04-20', array['streak_weeks', 'shields_held', 'best_streak_weeks']), 'mmmmsmm|6|0|6',
          'void: week 5 spends the held Shield, the run is 6 and the Shield that week 8 would have given never comes');
select ok(pg_temp.same(8, date '2026-04-20'), 'void: derived equals rebuild');
select pg_temp.pat(9, 'MM');
select pg_temp.settle(9, date '2026-03-16');
select pg_temp.void(9, date '2026-03-10');
select pg_temp.mark_dirty(9, date '2026-03-09');
select is(pg_temp.settle(9, date '2026-03-16'), 1, 'void: a met week 2 with no Shield held turns missed (one revision)');
select is(pg_temp.out(9) || '|' || pg_temp.cb(9) || '|' || pg_temp.vw(9, date '2026-03-16', array['streak_weeks', 'best_streak_weeks', 'comeback_state']), 'mx|2026-03-09:started|null|1|active',
          'void: the run ended (best 1) and a comeback started on that week''s Monday');

-- A met week that is voided back turns a withdrawn-by-correction comeback away: the comeback fact is withdrawn, not deleted.
select pg_temp.unvoid(9, date '2026-03-10');
select pg_temp.mark_dirty(9, date '2026-03-09');
select pg_temp.settle(9, date '2026-03-16');
select is(pg_temp.out(9) || '|' || pg_temp.cb(9) || '|' || pg_temp.ncb(9), 'mm|2026-03-09:withdrawn|2', 'correction: the comeback the missed week started no longer holds, so it gets revision 2, withdrawn');
select is(pg_temp.vw(9, date '2026-03-16', array['streak_weeks', 'comeback_state']), '2|none', 'correction: and the state reads none again');

-- ============================================================================
-- Double settle: the second call writes nothing, one saved fact, one Shield spent
-- ============================================================================
select pg_temp.pat(10, 'MMMMx');
select is(pg_temp.settle(10, date '2026-04-06'), 5, 'double settle: the first call writes the five weeks');
select is(pg_temp.settle(10, date '2026-04-06'), 0, 'double settle: the second call writes nothing');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(10) and kind = 'week' and outcome = 'saved'), 1, 'double settle: one saved fact');
select is(pg_temp.vw(10, date '2026-04-06', array['shields_held', 'streak_weeks']), '0|4', 'double settle: one Shield spent');

-- ============================================================================
-- The comeback
-- ============================================================================
-- Two visit days in the window, then the third: completed by visits (and 'restored' until a met week).
select pg_temp.pat(11, 'MMx');
select pg_temp.visit(11, date '2026-03-24');
select pg_temp.visit(11, date '2026-03-27');
select pg_temp.visit(11, date '2026-03-31');
select pg_temp.settle(11, date '2026-03-30');
select is(pg_temp.cb(11), '2026-03-16:started', 'comeback: started on the missed week''s Monday, and the window is still open');
select is(pg_temp.vw(11, date '2026-03-30', array['comeback_state', 'comeback_visits_done', 'comeback_visits_goal', 'comeback_window_days', 'comeback_window_start', 'comeback_window_ends_on']),
          'active|2|3|10|2026-03-24|2026-04-02', 'comeback: two of three, counted from the first visit day after the run ended; the window is ten days from it, inclusive; the visit of 03-31 is not counted yet');
select pg_temp.settle(11, date '2026-04-06');
select is(pg_temp.cb(11), '2026-03-16:started 2026-03-24:completed/visits', 'comeback: the third visit day inside the window writes completed (subject the window start)');
select is(pg_temp.vw(11, date '2026-04-06', array['comeback_state', 'comeback_visits_done', 'comeback_window_start', 'streak_weeks', 'best_streak_weeks']), 'restored|3|2026-03-24|null|2',
          'comeback: restored, no streak was invented and the best stays 2');
select ok(pg_temp.same(11, date '2026-04-06'), 'comeback: derived equals rebuild');

-- Two visit days, then the window expires, then a new visit day starts a new window.
select pg_temp.pat(12, 'MMx');
select pg_temp.visit(12, date '2026-03-24');
select pg_temp.visit(12, date '2026-03-26');
select pg_temp.visit(12, date '2026-04-14');
select pg_temp.settle(12, date '2026-04-20');
select is(pg_temp.cb(12), '2026-03-16:started 2026-03-24:lapsed', 'lapse: the window that closed with two visits is lapsed (subject its start)');
select is(pg_temp.vw(12, date '2026-04-20', array['comeback_state', 'comeback_visits_done', 'comeback_window_start', 'comeback_window_ends_on']), 'active|1|2026-04-14|2026-04-23',
          'lapse: the next visit day starts a new window');
select is(pg_temp.vw(12, date '2026-04-25', array['comeback_state', 'comeback_visits_done', 'comeback_window_start']), 'lapsed|0|null',
          'lapse: the view reads lapsed as soon as the second window has closed, before settle has written the fact');
select pg_temp.settle(12, date '2026-04-27');
select is(pg_temp.cb(12), '2026-03-16:started 2026-03-24:lapsed 2026-04-14:lapsed', 'lapse: settle writes the second lapse');
select is(pg_temp.vw(12, date '2026-04-27', array['comeback_state', 'comeback_visits_done', 'comeback_window_start', 'comeback_window_ends_on']), 'lapsed|0|null|null', 'lapse: no window until a visit day');
select pg_temp.visit(12, date '2026-05-01');
select is(pg_temp.vw(12, date '2026-05-02', array['comeback_state', 'comeback_visits_done', 'comeback_window_start']), 'active|1|2026-05-01', 'restart: the next visit day starts a new window');
select ok(pg_temp.same(12, date '2026-04-27'), 'lapse: derived equals rebuild');

-- A week that settles as met while the comeback is open starts a new run and closes it (goal 1, so the week is met before three visits).
update platform_engagement_config set goal_default = 1;
select pg_temp.pat(13, '1101');
select pg_temp.settle(13, date '2026-03-30');
update platform_engagement_config set goal_default = 3;
select is(pg_temp.out(13) || '|' || pg_temp.cb(13), 'mmxm|2026-03-16:started 2026-03-23:completed/week', 'met week: the met week 4 closes the comeback, completed by week (subject the window start)');
select is(pg_temp.vw(13, date '2026-03-30', array['streak_weeks', 'comeback_state', 'shields_held', 'best_streak_weeks']), '1|none|0|2', 'met week: a new run at count 1, the comeback reads none, no Shield, best 2');
select ok(pg_temp.same(13, date '2026-03-30'), 'met week: derived equals rebuild');

-- A completed comeback that a void takes away is withdrawn, and flips back when the visit returns (A to B to A).
select pg_temp.pat(14, 'MMx');
select pg_temp.visit(14, date '2026-03-24');
select pg_temp.visit(14, date '2026-03-27');
select pg_temp.visit(14, date '2026-03-31');
select pg_temp.settle(14, date '2026-04-06');
select is(pg_temp.cb(14), '2026-03-16:started 2026-03-24:completed/visits', 'withdrawn: the comeback completed on 03-24');
select pg_temp.void(14, date '2026-03-24');
select pg_temp.mark_dirty(14, date '2026-03-23');
select pg_temp.settle(14, date '2026-04-06');
select is(pg_temp.cb(14), '2026-03-16:started 2026-03-24:withdrawn 2026-03-27:lapsed', 'withdrawn: the first window no longer holds (withdrawn, revision 2); the window that starts on the next visit day lapsed');
select is((select revision from engagement_facts where member_id = pg_temp.m(14) and kind = 'comeback' and subject_key = '2026-03-24' order by revision desc limit 1), 2, 'withdrawn: the next revision, nothing deleted');
select is(pg_temp.vw(14, date '2026-04-06', array['comeback_state', 'comeback_window_start']), 'lapsed|null', 'withdrawn: the state follows the effective facts');
select ok(pg_temp.same(14, date '2026-04-06'), 'withdrawn: derived equals rebuild');
select is(pg_temp.settle(14, date '2026-04-06'), 0, 'withdrawn: a replay writes no week');
select is(pg_temp.ncb(14), 4, 'withdrawn: and no comeback row (started, completed, withdrawn, lapsed)');
select pg_temp.unvoid(14, date '2026-03-24');
select pg_temp.mark_dirty(14, date '2026-03-23');
select pg_temp.settle(14, date '2026-04-06');
select is(pg_temp.cb(14), '2026-03-16:started 2026-03-24:completed/visits 2026-03-27:withdrawn', 'A to B to A: the visit returns, the completion returns (revision 3) and the other window is withdrawn');
select ok(pg_temp.same(14, date '2026-04-06'), 'A to B to A: derived equals rebuild');

-- The comeback reads member_visit_days only: a class attendance or a comment never counts (no other table is read).
select is((select prosrc !~* 'attendance_events|class_bookings|attended_at' from pg_proc where oid = 'private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer)'::regprocedure)
          and (select prosrc ~* 'member_visit_days' from pg_proc where oid = 'private.engagement_comeback_live(uuid, uuid, text, date, date, integer, integer)'::regprocedure),
          true, 'the comeback progress reads member_visit_days and no attendance table');

-- ============================================================================
-- A correction that changes LATER weeks: week 2 of the golden history loses a visit, the run ends early and the weeks after it are re-decided
-- ============================================================================
select pg_temp.pat(22, 'MMMMxMMMMxx');
select pg_temp.settle(22, date '2026-05-18');
select is(pg_temp.out(22), 'mmmmsmmmmsx', 'cascade: before, the golden history');
select pg_temp.void(22, date '2026-03-10');
select pg_temp.mark_dirty(22, date '2026-03-09');
select is(pg_temp.settle(22, date '2026-05-18'), 2, 'cascade: two new revisions, week 2 (the visit) and week 5 (a later week that no Shield can save any more)');
select is(pg_temp.out(22), 'mxmmxmmmmsx', 'cascade: week 2 is missed and ends the run, week 5 flips from saved to missed, the later weeks are re-decided (week 10 is still saved by the Shield week 9 now earns)');
select is((select string_agg(e.subject_key || ':' || e.revision, ' ' order by e.subject_key) from private.effective_engagement_facts(pg_temp.m(22)) e where e.kind = 'week' and e.revision > 1),
          '2026-03-09:2 2026-03-30:2', 'cascade: only the two changed weeks have a revision 2, every other week stays at revision 1');
select is(pg_temp.cb(22), '2026-03-09:started 2026-03-16:completed/visits 2026-03-30:started 2026-04-06:completed/visits 2026-05-11:started',
          'cascade: the comeback starts at the earlier week, a second one at the flipped week 5, and the one at week 11 is untouched');
select is(pg_temp.vw(22, date '2026-05-18', array['streak_weeks', 'best_streak_weeks', 'shields_held', 'comeback_state', 'saved_week_start']), 'null|4|0|active|2026-05-04',
          'cascade: the run ended (best 4), the Shield earned at week 9 was spent on week 10');
select ok(pg_temp.same(22, date '2026-05-18'), 'cascade: derived equals rebuild');

-- ============================================================================
-- restored turns into none once a later week settles as met
-- ============================================================================
select pg_temp.pat(23, 'MMx');
select pg_temp.visit(23, date '2026-03-24');
select pg_temp.visit(23, date '2026-03-27');
select pg_temp.visit(23, date '2026-03-31');
select pg_temp.settle(23, date '2026-04-06');
select is(pg_temp.vw(23, date '2026-04-06', array['comeback_state', 'streak_weeks']), 'restored|null', 'restored: completed by visits and no met week since');
select pg_temp.pat(23, '3', date '2026-04-06');
select pg_temp.settle(23, date '2026-04-13');
select is(pg_temp.out(23), 'mmxxxm', 'restored: week 6 settles as met');
select is(pg_temp.vw(23, date '2026-04-13', array['comeback_state', 'streak_weeks']), 'none|1', 'restored: the state reads none and the new run is at 1');
select ok((select (r.comeback ->> 'state') = 'none' and r.streak_weeks >= 1 from private.engagement_derived_state(pg_temp.m(23)) r), 'restored: the derived state says none with a run of at least 1');
select ok(pg_temp.same(23, date '2026-04-13'), 'restored: derived equals rebuild');

-- ============================================================================
-- Config-driven numbers: the screen never hard-codes 4, 2, 3 or 10
-- ============================================================================
update platform_engagement_config set shield_every_weeks = 2, shield_cap = 1, comeback_visits = 2, comeback_window_days = 5;
select pg_temp.pat(16, 'MMMMM');
select pg_temp.settle(16, date '2026-04-06');
select is(pg_temp.vw(16, date '2026-04-06', array['streak_weeks', 'shields_held', 'weeks_to_next_shield', 'shield_every_weeks', 'shield_cap', 'comeback_visits_goal', 'comeback_window_days']),
          '5|1|null|2|1|2|5', 'config: interval 2 and cap 1 give 1 held and no next Shield; the comeback goal and window come from the config');
update platform_engagement_config set shield_every_weeks = 4, shield_cap = 2, comeback_visits = 3, comeback_window_days = 10;

-- ============================================================================
-- Rebuild equals live over a seeded history that mixes every case, including a gym timezone change
-- ============================================================================
select pg_temp.pat(15, 'MMMMxMMMMxx');
select pg_temp.visit(15, date '2026-05-20');
select pg_temp.settle(15, date '2026-05-25');
select ok(pg_temp.same(15, date '2026-05-25'), 'rebuild: derived equals rebuild before the timezone change');
update gyms set timezone = 'Pacific/Auckland' where id = pg_temp.id(1, 2);
select ok(pg_temp.same(15, date '2026-05-25'), 'rebuild: and after it (past visit_day values do not move)');
select is(pg_temp.settle(15, date '2026-05-25'), 0, 'rebuild: a settle after the timezone change writes nothing');
select is((select (to_jsonb(d) -> 'comeback' ->> 'state') || '|' || (to_jsonb(d) ->> 'shields_held') from private.engagement_derived_state(pg_temp.m(15)) d), 'active|0',
          'rebuild: the derived state carries the Shields held and the comeback');
select is((select count(*)::int from jsonb_array_elements((select to_jsonb(d) -> 'weeks' from private.engagement_derived_state(pg_temp.m(15)) d)) w where w ->> 'outcome' = 'saved'), 2,
          'rebuild: the per-week outcomes include saved');
select ok(pg_temp.same(3, date '2026-05-18') and pg_temp.same(5, date '2026-05-18') and pg_temp.same(1, date '2026-05-25') and pg_temp.same(4, date '2026-05-04'),
          'rebuild: the golden, two-Shield, twelve-week and saved-week members all equal their rebuild');
select ok(pg_temp.same(9, date '2026-03-16') and pg_temp.same(10, date '2026-04-06') and pg_temp.same(2, date '2026-04-06') and pg_temp.same(6, date '2026-03-16'),
          'rebuild: the corrected, double-settled, short and no-run members equal their rebuild');
select is((select count(*)::int from private.rebuild_engagement(pg_temp.m(15), date '2026-05-25')), 1, 'rebuild: one row');

-- ============================================================================
-- The day path: inactive while the guard is false, and its rule proven by activating the guard (this file is rolled back)
-- ============================================================================
select is(private.engagement_daily_streak_enabled(), false, 'day path: the guard returns false in V1.8');
select pg_temp.pat(17, 'MMMMMMMM5');
select pg_temp.settle(17, date '2026-05-04');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(17) and kind = 'day_shield'), 0, 'day path: five consecutive visit days and 2 Shields, guard false: no day_shield fact');
select is(pg_temp.vw(17, date '2026-05-04', array['streak_weeks', 'shields_held']), '9|2', 'day path: the Shields held are unchanged');
select is((select count(*)::int from engagement_facts where kind = 'day_shield'), 0, 'day path: no day_shield fact exists anywhere');

select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(2, 1, false) d), '1|false|false', 'reservation: a missed day spends a Shield with two held');
select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(1, 1, false) d), '0|false|true', 'reservation: never with one held (it is kept for the week), the daily run ends');
select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(2, 3, false) d), '1|false|true', 'reservation: two held spend one day Shield, never the last');
select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(1, 0, true) d), '0|true|true', 'reservation: a whole missed week spends one on the weekly streak and ends the daily run');
select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(0, 0, true) d), '0|false|true', 'reservation: a whole missed week with none held only ends the daily run');
select is((select d.day_shields || '|' || d.week_shield || '|' || d.daily_run_ends from private.engagement_day_reservation(2, 0, false) d), '0|false|false', 'reservation: no missed day, nothing happens');

-- Activation: the guard replaced (the transaction is rolled back at the end of the file).
select pg_temp.pat(18, 'MMMMMMMM5');
select pg_temp.pat(19, 'MMMM5');
create or replace function private.engagement_daily_streak_enabled() returns boolean language sql stable as $f$ select true $f$;
select is(private.engagement_daily_streak_enabled(), true, 'activation: the guard is replaced by a function returning true');
select pg_temp.settle(18, date '2026-05-04');
select pg_temp.settle(19, date '2026-04-13');
select is((select string_agg(f.subject_key, ' ' order by f.subject_key) from engagement_facts f where f.member_id = pg_temp.m(18) and f.kind = 'day_shield'), '2026-05-02',
          'activation: with 2 Shields held a missed day (after a run of five) spends one: a day_shield fact on that Saturday');
select is((select count(*)::int from engagement_facts f where f.member_id = pg_temp.m(19) and f.kind = 'day_shield'), 0, 'activation: with 1 Shield held a missed day spends none (the last is reserved for the weekly streak)');
select is(pg_temp.vw(18, date '2026-05-04', array['streak_weeks', 'shields_held']), '9|2', 'activation: the weekly fold is not touched by the day path');
create or replace function private.engagement_daily_streak_enabled() returns boolean language sql stable as $f$ select false $f$;
select is(private.engagement_daily_streak_enabled(), false, 'activation: the guard is back to false');

-- ============================================================================
-- Calendar: my_saved_weeks
-- ============================================================================
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.asrole(r text, stmt text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', r);
  begin
    execute stmt into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;
select pg_temp.claims(3, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-03-01')$$), '2026-03-30', 'calendar: March shows the Monday of the saved week 5');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-04-01')$$), '2026-03-30', 'calendar: April shows it too (a week that touches the month)');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-05-01')$$), '2026-05-04', 'calendar: May shows week 10');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-02-01')$$), 'null', 'calendar: February has none');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-04-01') where week_start > date '2026-04-01'$$), 'null', 'calendar: only the Monday is returned');
select is(left(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(date '2026-03-15')$$), 6), '22023:', 'calendar: a month that is not the first of a month raises invalid_month');
select is(left(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(date '2099-01-01')$$), 6), '22023:', 'calendar: a future month raises invalid_month');
select is(left(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(null)$$), 6), '22023:', 'calendar: NULL raises invalid_month');
select is(pg_temp.asrole('anon', $$select count(*)::text from public.my_saved_weeks(date '2026-03-01')$$) ~ '^42501:', true, 'calendar: anon is refused');
select pg_temp.claims(30, 1, 'owner');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(date '2026-03-01')$$), '0', 'calendar: an owner gets no row');
select pg_temp.claims(31, 1, 'receptionist');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(date '2026-03-01')$$), '0', 'calendar: a receptionist gets no row');
select pg_temp.claims(32, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_saved_weeks(date '2026-03-01')$$), '0', 'calendar: a deactivated member gets no row');
select pg_temp.claims(4, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select string_agg(week_start::text, ' ') from public.my_saved_weeks(date '2026-04-01')$$), '2026-04-13', 'calendar: a member sees only their own saved weeks (member 4: week 7)');

-- ============================================================================
-- Gates that reach their consumers
-- ============================================================================
create function pg_temp.fact_writers() returns text[] language sql as $f$
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'insert\s+into\s+(public\.)?engagement_facts'
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ '''(week|comeback)'''
$f$;
select is(pg_temp.fact_writers(), array['private.settle_engagement(uuid,uuid,date)'], 'gate: settle_engagement is the only function that writes a week or comeback fact');

-- The same scan against a mutant: record_check_in with a comeback write added must be reported.
create temp table original_def as select pg_get_functiondef('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) as def;
do $mutate$
declare v_def text;
begin
  select def into v_def from original_def;
  v_def := regexp_replace(v_def, E'\\mbegin\\M', E'begin\n  insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome) select m.id, m.gym_id, ''comeback'', ''2000-01-03'', 1, ''started'' from members m where false;', '');
  execute v_def;
end
$mutate$;
select is(pg_temp.fact_writers(), array['private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)', 'private.settle_engagement(uuid,uuid,date)'],
          'gate: against a mutant that adds a fact write to record_check_in the scan names it');
do $restore$
begin
  execute (select def from original_def);
end
$restore$;
select is(pg_temp.fact_writers(), array['private.settle_engagement(uuid,uuid,date)'], 'gate: with record_check_in restored the scan is clean again');
select is((select pg_get_functiondef('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) = def from original_def), true, 'gate: record_check_in is byte-for-byte what it was');

select is((select count(*)::int from unnest(array['check_in(timestamptz,uuid)', 'private.record_check_in(uuid,uuid,text,uuid,timestamptz,uuid)', 'void_staff_check_in(uuid,text)']) f
           where pg_get_functiondef(to_regprocedure(f)) ~* 'engagement_facts|settle_engagement|engagement_fold|shield|comeback'), 0,
          'gate: check_in(), record_check_in and void_staff_check_in name no engagement fact, fold, Shield or comeback');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'public']) r, unnest(array['INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege(r, 'public.engagement_facts', p)),
  0, 'gate: no client role holds INSERT, UPDATE or DELETE on engagement_facts');
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?engagement_facts'),
  array['acknowledge_milestone(smallint)'], 'gate: the only function a client can call that writes a fact at all is acknowledge_milestone (an acknowledgement, never a Shield or a streak)');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
             and p.proname ~* 'buy|grant|transfer|edit|set_streak|set_shield|give' and p.prosrc ~* 'engagement_facts'), 0,
          'gate: no function that buys, grants, transfers or edits a Shield, streak or comeback exists');
select is((select loyalty_events from (select count(*)::bigint as loyalty_events from loyalty_events) x) - (select events from loyalty_before)
          + (select count(*) from loyalty_progress) - (select progress from loyalty_before)
          + (select count(*) from guest_sessions) - (select guests from loyalty_before), 0::bigint,
          'gate: after earned Shields, saved weeks and a completed comeback the loyalty ledger, stamps (progress) and guest sessions have identical row counts');
select cmp_ok((select count(*)::int from engagement_facts where kind = 'comeback' and outcome = 'completed' and detail ->> 'completed_by' = 'visits'), '>=', 3, 'gate: comebacks completed by visits exist in this file, so the loyalty comparison above compared something');
select cmp_ok((select count(*)::int from engagement_facts where kind = 'week' and outcome = 'saved'), '>', 5, 'gate: saved weeks exist in this file, so the loyalty comparison above compared something');

-- ============================================================================
-- Plans: no sequential scan of attendance_events on a three-year member
-- ============================================================================
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 1), pg_temp.m(20), (d + time '10:00') at time zone 'Africa/Douala', (d + time '11:00') at time zone 'Africa/Douala', 'manual', d::date
from (select date '2023-11-27' + (7 * w + i) as d from generate_series(0, 155) w, generate_series(0, 2) i) x;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 1), pg_temp.m(39 + k), (d + make_time(h, 0, 0)) at time zone 'Africa/Douala', (d + make_time(h, 30, 0)) at time zone 'Africa/Douala', 'manual', d::date
from generate_series(1, 10) k, (select date '2023-11-27' + i as d from generate_series(0, 1100) i) x, unnest(array[7, 10, 13, 16]) h;
analyze attendance_events;
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $f$
declare r text; out text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop out := out || r || E'\n'; end loop;
  return out;
end $f$;
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(20)), 468, 'plan: the three-year member holds 468 visit days');
select alike(pg_temp.plan_of(format($$select min(visit_day) from member_visit_days where member_id = %L and gym_id = %L and visit_day >= date '2026-03-01' and visit_day <= date '2026-11-23'$$, pg_temp.m(20), pg_temp.id(1, 1))),
             '%idx_attendance_events_member_visit_day%', 'plan: the comeback window start reads the (member, visit_day) index');
select alike(pg_temp.plan_of(format($$select count(*) from member_visit_days where member_id = %L and gym_id = %L and visit_day between date '2026-03-24' and date '2026-04-02'$$, pg_temp.m(20), pg_temp.id(1, 1))),
             '%idx_attendance_events_member_visit_day%', 'plan: the window progress count reads the same index');
select alike(pg_temp.plan_of(format($$select array_agg(visit_day order by visit_day) from member_visit_days where member_id = %L and gym_id = %L and visit_day >= date '2026-03-02'$$, pg_temp.m(20), pg_temp.id(1, 1))),
             '%idx_attendance_events_member_visit_day%', 'plan: the settle read of the member''s visit days reads it too');
select is(pg_temp.plan_of(format($$select count(*) from member_visit_days where member_id = %L and gym_id = %L and visit_day between date '2025-01-06' and date '2025-01-12'$$, pg_temp.m(20), pg_temp.id(1, 1))) !~ 'Seq Scan on attendance_events',
          true, 'plan: no sequential scan of attendance_events');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
             and p.proname in ('engagement_shield_params', 'engagement_shield_walk', 'engagement_comeback_walk', 'engagement_comeback_fold', 'engagement_comeback_live',
                               'engagement_daily_streak_enabled', 'engagement_day_reservation', 'engagement_fold', 'engagement_evaluate_weeks', 'engagement_state_view_at',
                               'engagement_state_view', 'open_engagement_at', 'my_engagement', 'open_engagement', 'my_saved_weeks', 'engagement_derived_state', 'rebuild_engagement')
             and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* '\mattendance_events\M'), 0,
          'plan: no function of the view family, the fold or the walks reads attendance_events');
select is((select count(*)::int from private.engagement_state_view_at(pg_temp.m(20), timestamptz '2026-11-23 12:00+01')), 1, 'plan: the view answers for the three-year member');

select * from finish();
rollback;
