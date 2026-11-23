-- Story 30.2 (NFR-028): counts are deterministic and recomputable from attendance. The six cases of the story, each followed by the same check:
-- private.engagement_derived_state (the effective facts, folded) equals private.rebuild_engagement (visits re-derived from member_visit_days)
-- as jsonb {streak_weeks, best_streak_weeks, last_settled_week, weeks}, never as row counts, because revisions legitimately add rows.
--
-- Fixtures are in Africa/Douala with explicit join dates and fixed p_up_to dates; nothing reads the clock. Mondays: 2026-03-02 (the epoch),
-- 03-09, 03-16, 03-23, 03-30, 04-06. A late visit is marked by the test itself (engagement_state.dirty_from, as the table owner, the statement 30.3 added to record_check_in)
-- because the fixtures are fixed March 2026 dates the real clock cannot reach; the mark of the REAL check-in and void paths is proven in
-- engagement_dirty_mark.test.sql, engagement_journey.test.sql and scripts/engagement-race.sh.
--
-- Fixture ids: 00000000-0000-0000-0034-00000000nnnn.

begin;
select plan(74);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0034-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'DT Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'DT Gym', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'DT Gym Zone', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'dt-' || n || '@x.example', now() from generate_series(1, 30) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, case when n = 9 then 2 else 1 end), pg_temp.id(2, n), 'member', 'DT Member ' || n, date '2026-01-05' from generate_series(1, 30) n;

update platform_engagement_config set release_week_start = date '2026-03-02';

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
create function pg_temp.settle(p_n int, p_up_to date) returns integer language sql as $f$
  select private.settle_engagement(pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_up_to)
$f$;
create function pg_temp.facts(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(e.subject_key || ':' || e.revision || ':' || e.outcome || ':' || e.goal || ':' || e.visits, ' ' order by e.subject_key), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'week'
$f$;
create function pg_temp.nrows(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.derived(p_n int) returns jsonb language sql stable as $f$ select to_jsonb(d) from private.engagement_derived_state(pg_temp.m(p_n)) d $f$;
create function pg_temp.rebuilt(p_n int, p_up_to date) returns jsonb language sql stable as $f$ select to_jsonb(r) from private.rebuild_engagement(pg_temp.m(p_n), p_up_to) r $f$;
create function pg_temp.mark_dirty(p_n int, p_week date) returns void language sql as $f$
  insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_week)
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)
$f$;
create function pg_temp.streak(p_n int) returns text language sql stable as $f$
  select f.streak_weeks || '|' || f.best_streak_weeks from private.engagement_fold(pg_temp.m(p_n)) f
$f$;

-- ============================================================================
-- 1. A late offline visit: a Sunday visit synced on the Tuesday after the week was settled missed (goal 3, two visits)
-- ============================================================================
select pg_temp.visit(1, date '2026-03-02');
select pg_temp.visit(1, date '2026-03-04');
select is(pg_temp.settle(1, date '2026-03-09'), 1, 'late visit: week 03-02 closes on the Monday and settles');
select is(pg_temp.facts(1), '2026-03-02:1:missed:3:2', 'late visit: missed, goal 3, two visits (revision 1)');
select is(pg_temp.derived(1), pg_temp.rebuilt(1, date '2026-03-09'), 'late visit: derived equals rebuild before the late visit');
select pg_temp.visit(1, date '2026-03-08');            -- Sunday, recorded offline, synced on Tuesday 03-10
select pg_temp.mark_dirty(1, date '2026-03-02');       -- the week of the visit, not the week of receipt
select is(pg_temp.settle(1, date '2026-03-10'), 1, 'late visit: the Tuesday settle writes one new revision');
select is(pg_temp.facts(1), '2026-03-02:2:met:3:3', 'late visit: revision 2, met, visits 3 (the week of the visit is corrected, not the week of receipt)');
select is(pg_temp.nrows(1), 2, 'late visit: revision 1 stays in the ledger');
select is(pg_temp.derived(1), pg_temp.rebuilt(1, date '2026-03-10'), 'late visit: derived equals rebuild after the correction');
select is(pg_temp.streak(1), '1|1', 'late visit: the streak is 1 and so is the best');
select is(pg_temp.settle(1, date '2026-03-10'), 0, 'late visit: a replay writes nothing');
select is(pg_temp.derived(1) -> 'weeks', '[{"goal": 3, "week": "2026-03-02", "visits": 3, "outcome": "met"}]'::jsonb, 'late visit: the derived weeks are the one corrected week');

-- ============================================================================
-- 2. A void: a same-day voided staff visit lowers the open week's count only
-- ============================================================================
select pg_temp.visit(2, date '2026-03-02');
select pg_temp.visit(2, date '2026-03-03');
select pg_temp.visit(2, date '2026-03-04');
select pg_temp.settle(2, date '2026-03-09');
select pg_temp.visit(2, date '2026-03-09');
select pg_temp.visit(2, date '2026-03-10');
select pg_temp.visit(2, date '2026-03-11');
select pg_temp.void(2, date '2026-03-11');
select pg_temp.mark_dirty(2, date '2026-03-09');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(2) and visit_day >= date '2026-03-09'), 2, 'void: the open week count dropped from 3 to 2');
select is(pg_temp.settle(2, date '2026-03-12'), 0, 'void: no fact is written for the open week');
select is(pg_temp.facts(2), '2026-03-02:1:met:3:3', 'void: the closed week is as it was');
select is(pg_temp.streak(2), '1|1', 'void: best_streak_weeks is not lowered');
select is(pg_temp.derived(2), pg_temp.rebuilt(2, date '2026-03-12'), 'void: derived equals rebuild');
-- The week closes with the void in place: the voided day never counted.
select is(pg_temp.settle(2, date '2026-03-16'), 1, 'void: the week closes');
select is(pg_temp.facts(2), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:2', 'void: it settles with two visits (3 would have met the goal)');
select is(pg_temp.streak(2), '0|1', 'void: the run ended but best stays 1');
select is(pg_temp.derived(2), pg_temp.rebuilt(2, date '2026-03-16'), 'void: derived equals rebuild after the close');

-- ============================================================================
-- 3. A goal change mid-week: 3 in force, changed to 5 on a Wednesday
-- ============================================================================
-- The change made on Wednesday 03-04 applies from Monday 03-09 (set_weekly_goal picks the next Monday). The row is written with the history
-- trigger off only because the week is in the past of the real clock; its shape is exactly what set_weekly_goal writes.
alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (pg_temp.m(3), pg_temp.id(1, 1), date '2026-03-09', 5);
alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
select pg_temp.visit(3, date '2026-03-02');
select pg_temp.visit(3, date '2026-03-03');
select pg_temp.visit(3, date '2026-03-05');
select pg_temp.visit(3, date '2026-03-09');
select pg_temp.visit(3, date '2026-03-10');
select pg_temp.visit(3, date '2026-03-11');
select pg_temp.visit(3, date '2026-03-12');
select is(pg_temp.settle(3, date '2026-03-16'), 2, 'goal change: two weeks settle');
select is(pg_temp.facts(3), '2026-03-02:1:met:3:3 2026-03-09:1:missed:5:4', 'goal change: the changed week keeps goal 3 and three visits make it met; the next week has goal 5 and four visits miss it');
select is(pg_temp.derived(3), pg_temp.rebuilt(3, date '2026-03-16'), 'goal change: derived equals rebuild');
-- Changing the history again for a settled week, or deleting it, changes nothing about the settled facts.
alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
update member_weekly_goals set goal = 2 where member_id = pg_temp.m(3);
alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
select pg_temp.mark_dirty(3, date '2026-03-02');
select is(pg_temp.settle(3, date '2026-03-16'), 0, 'goal change: a rewritten history row does not rewrite the settled weeks');
select is(pg_temp.facts(3), '2026-03-02:1:met:3:3 2026-03-09:1:missed:5:4', 'goal change: both facts keep the goal they were settled with');
select is(pg_temp.derived(3), pg_temp.rebuilt(3, date '2026-03-16'), 'goal change: and the rebuild takes the goal in force as settle does');

-- ============================================================================
-- 4. A timezone change never moves past days
-- ============================================================================
select pg_temp.visit(4, date '2026-03-02');
select pg_temp.visit(4, date '2026-03-03');
-- 23:30 Douala on Sunday 03-08 (22:30 UTC); visit_day is computed by the database at insert, not passed.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type)
values (pg_temp.id(1, 1), pg_temp.m(4), timestamptz '2026-03-08 23:30:00+01', timestamptz '2026-03-09 00:20:00+01', 'manual');
select is((select visit_day from attendance_events where member_id = pg_temp.m(4) and checked_in_at = timestamptz '2026-03-08 23:30:00+01'), date '2026-03-08', 'timezone: the 23:30 Douala visit is on D = Sunday 03-08');
select is(pg_temp.settle(4, date '2026-03-16'), 2, 'timezone: two weeks settle');
select is(pg_temp.facts(4), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0', 'timezone: week 03-02 is met only because the 23:30 visit is on Sunday');
create temp table tz_before as
  select pg_temp.derived(4) as derived, pg_temp.rebuilt(4, date '2026-03-16') as rebuilt, pg_temp.facts(4) as facts,
         (select array_agg(visit_day order by visit_day) from member_visit_days where member_id = pg_temp.m(4)) as days;
select is((select derived from tz_before), (select rebuilt from tz_before), 'timezone: derived equals rebuild before the change');
update gyms set timezone = 'Africa/Nairobi' where id = pg_temp.id(1, 1);
select is((select timezone from gyms where id = pg_temp.id(1, 1)), 'Africa/Nairobi', 'timezone: the gym moved to Africa/Nairobi (UTC+3), where that visit is 01:30 on Monday');
select is((select visit_day from attendance_events where member_id = pg_temp.m(4) and checked_in_at = timestamptz '2026-03-08 23:30:00+01'), date '2026-03-08', 'timezone: the visit is still on D');
select is((select array_agg(visit_day order by visit_day) from member_visit_days where member_id = pg_temp.m(4)), (select days from tz_before), 'timezone: the member''s visit days are identical');
select is(pg_temp.facts(4), (select facts from tz_before), 'timezone: the week facts are identical');
select is(pg_temp.rebuilt(4, date '2026-03-16'), (select rebuilt from tz_before), 'timezone: the rebuild is identical');
select is(pg_temp.derived(4), pg_temp.rebuilt(4, date '2026-03-16'), 'timezone: derived equals rebuild after the change');
select is(pg_temp.settle(4, date '2026-03-16'), 0, 'timezone: a settle after the change writes nothing');
update gyms set timezone = 'Africa/Douala' where id = pg_temp.id(1, 1);

-- ============================================================================
-- 5. A default change after a week settled
-- ============================================================================
select pg_temp.visit(5, date '2026-03-02');
select pg_temp.visit(5, date '2026-03-03');
select pg_temp.visit(5, date '2026-03-04');
select pg_temp.settle(5, date '2026-03-09');
select is(pg_temp.facts(5), '2026-03-02:1:met:3:3', 'default change: week 03-02 settled at goal 3');
update platform_engagement_config set goal_default = 4;
select pg_temp.mark_dirty(5, date '2026-03-02');
select is(pg_temp.settle(5, date '2026-03-09'), 0, 'default change: goal_default 4, a dirty recount of the settled week writes nothing');
select is(pg_temp.facts(5), '2026-03-02:1:met:3:3', 'default change: the settled week keeps goal 3');
select pg_temp.visit(5, date '2026-03-09');
select pg_temp.visit(5, date '2026-03-10');
select pg_temp.visit(5, date '2026-03-11');
select is(pg_temp.settle(5, date '2026-03-16'), 1, 'default change: the new unsettled week is evaluated');
select is(pg_temp.facts(5), '2026-03-02:1:met:3:3 2026-03-09:1:missed:4:3', 'default change: it uses the new default 4, so three visits miss it');
select is(pg_temp.derived(5), pg_temp.rebuilt(5, date '2026-03-16'), 'default change: derived equals rebuild');
update platform_engagement_config set goal_default = 3;

-- ============================================================================
-- 6. A regained streak: met, met, missed, met
-- ============================================================================
select pg_temp.visit(6, date '2026-03-02'); select pg_temp.visit(6, date '2026-03-03'); select pg_temp.visit(6, date '2026-03-04');
select pg_temp.visit(6, date '2026-03-09'); select pg_temp.visit(6, date '2026-03-10'); select pg_temp.visit(6, date '2026-03-11');
select pg_temp.visit(6, date '2026-03-16');
select pg_temp.visit(6, date '2026-03-23'); select pg_temp.visit(6, date '2026-03-24'); select pg_temp.visit(6, date '2026-03-25');
select is(pg_temp.settle(6, date '2026-03-30'), 4, 'regained streak: four weeks settle');
select is(pg_temp.facts(6), '2026-03-02:1:met:3:3 2026-03-09:1:met:3:3 2026-03-16:1:missed:3:1 2026-03-23:1:met:3:3', 'regained streak: met, met, missed, met');
select is(pg_temp.streak(6), '1|2', 'regained streak: the run is 1 and the best is 2');
select is(pg_temp.derived(6), pg_temp.rebuilt(6, date '2026-03-30'), 'regained streak: derived equals rebuild');

-- ============================================================================
-- More determinism: the order and the pace of settling do not matter
-- ============================================================================
-- Member 7 settles every Monday, member 8 once at the end, with the same visits: the same derived state.
select pg_temp.visit(n, d) from (values (7), (8)) as v(n),
  unnest(array[date '2026-03-02', date '2026-03-03', date '2026-03-04', date '2026-03-09', date '2026-03-16', date '2026-03-17', date '2026-03-18', date '2026-03-30']) d;
select pg_temp.settle(7, date '2026-03-09');
select pg_temp.settle(7, date '2026-03-16');
select pg_temp.settle(7, date '2026-03-23');
select pg_temp.settle(7, date '2026-03-30');
select pg_temp.settle(7, date '2026-04-06');
select pg_temp.settle(8, date '2026-04-06');
select is(pg_temp.facts(7), pg_temp.facts(8), 'pace: settling weekly and settling once give the same effective facts');
select is(pg_temp.derived(7) -> 'weeks', pg_temp.derived(8) -> 'weeks', 'pace: and the same weeks as jsonb');
select is(pg_temp.derived(7), pg_temp.rebuilt(7, date '2026-04-06'), 'pace: derived equals rebuild for the weekly member');
select is(pg_temp.derived(8), pg_temp.rebuilt(8, date '2026-04-06'), 'pace: and for the member settled once');
select is(pg_temp.rebuilt(7, date '2026-04-06'), pg_temp.rebuilt(7, date '2026-04-06'), 'a rebuild is repeatable');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(7)), (select count(*)::int from engagement_facts where member_id = pg_temp.m(8)), 'pace: no revision is needed for either (one row per week)');

-- The rebuild never writes, and a rebuild for a different p_up_to does not change what is stored.
select pg_temp.rebuilt(8, date '2026-06-01');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(8) and kind = 'week'), (select count(*)::int from jsonb_array_elements(pg_temp.derived(8) -> 'weeks')), 'rebuild: writes nothing (week facts; 30.7: the member''s 7th visit day also holds one milestone fact)');
select ok(pg_temp.rebuilt(8, date '2026-06-01') <> pg_temp.derived(8), 'rebuild: for a later p_up_to it reports the weeks that have not been settled yet (a diagnostic, not a write)');

-- A gym with a different timezone setting: nothing in a settle depends on the session's time zone.
set local timezone = 'Pacific/Kiritimati';
select is(pg_temp.derived(8), pg_temp.rebuilt(8, date '2026-04-06'), 'a UTC+14 session time zone changes nothing');
set local timezone = 'America/Los_Angeles';
select pg_temp.visit(9, date '2026-03-02');
select is(pg_temp.settle(9, date '2026-03-16'), 2, 'a UTC-8 session time zone settles the same weeks');
select is(pg_temp.facts(9), '2026-03-02:1:missed:3:1 2026-03-09:1:missed:3:0', 'with the same facts');
reset timezone;

-- ============================================================================
-- 30.7: the milestones array. derived (the effective milestone facts) equals rebuild (the thresholds the visit days reach) in the late-visit,
-- void-then-return and timezone cases of the 7th visit day
-- ============================================================================
select is(pg_temp.derived(8) -> 'milestones', '[7]'::jsonb, 'milestones: member 8 (eight visit days) holds the 7');
select is(pg_temp.derived(7) -> 'milestones', pg_temp.derived(8) -> 'milestones', 'milestones: the weekly settler and the one-shot settler agree');
-- late visit: five days settled, then two more arrive (the second a late offline visit for the settled week)
select pg_temp.visit(10, date '2026-03-02'); select pg_temp.visit(10, date '2026-03-03'); select pg_temp.visit(10, date '2026-03-04');
select pg_temp.visit(10, date '2026-03-05'); select pg_temp.visit(10, date '2026-03-09'); select pg_temp.visit(10, date '2026-03-10');
select pg_temp.settle(10, date '2026-03-12');
select is(pg_temp.derived(10) -> 'milestones', '[]'::jsonb, 'milestones late visit: six visit days, none yet');
select is(pg_temp.derived(10), pg_temp.rebuilt(10, date '2026-03-12'), 'milestones late visit: derived equals rebuild at six days');
select pg_temp.visit(10, date '2026-03-06');            -- Friday of the settled week, synced on Thursday 03-12
select pg_temp.mark_dirty(10, date '2026-03-02');
select pg_temp.settle(10, date '2026-03-12');
select is(pg_temp.derived(10) -> 'milestones', '[7]'::jsonb, 'milestones late visit: the late visit makes seven, one milestone fact');
select is(pg_temp.derived(10), pg_temp.rebuilt(10, date '2026-03-12'), 'milestones late visit: derived equals rebuild after the late visit');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(10) and kind = 'milestone'), 1, 'milestones late visit: exactly one milestone row');
-- void then return to 7: the fact keeps the 7 while the count is 6, and the rebuild agrees again once the count is back
select pg_temp.visit(11, date '2026-03-02'); select pg_temp.visit(11, date '2026-03-03'); select pg_temp.visit(11, date '2026-03-04');
select pg_temp.visit(11, date '2026-03-05'); select pg_temp.visit(11, date '2026-03-06'); select pg_temp.visit(11, date '2026-03-09'); select pg_temp.visit(11, date '2026-03-10');
select pg_temp.settle(11, date '2026-03-12');
select is(pg_temp.derived(11) -> 'milestones', '[7]'::jsonb, 'milestones void: seven visit days, the 7 is held');
select pg_temp.void(11, date '2026-03-10');
select pg_temp.mark_dirty(11, date '2026-03-09');
select pg_temp.settle(11, date '2026-03-12');
select is(pg_temp.derived(11) -> 'milestones', '[7]'::jsonb, 'milestones void: the voided 7th day does not reverse the milestone');
select pg_temp.visit(11, date '2026-03-11');
select pg_temp.mark_dirty(11, date '2026-03-09');
select pg_temp.settle(11, date '2026-03-12');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(11) and kind = 'milestone'), 1, 'milestones void: back to seven days, still one row');
select is(pg_temp.derived(11), pg_temp.rebuilt(11, date '2026-03-12'), 'milestones void: derived equals rebuild once the count is back at 7');
-- timezone: the 7th day is a 23:30 Douala visit; a later gym timezone change moves nothing
select pg_temp.visit(12, date '2026-03-02'); select pg_temp.visit(12, date '2026-03-03'); select pg_temp.visit(12, date '2026-03-04');
select pg_temp.visit(12, date '2026-03-05'); select pg_temp.visit(12, date '2026-03-06'); select pg_temp.visit(12, date '2026-03-07');
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type)
values (pg_temp.id(1, 1), pg_temp.m(12), timestamptz '2026-03-08 23:30:00+01', timestamptz '2026-03-09 00:20:00+01', 'manual');
select pg_temp.settle(12, date '2026-03-16');
create temp table tz_ms as select pg_temp.derived(12) as derived, pg_temp.rebuilt(12, date '2026-03-16') as rebuilt;
select is((select derived from tz_ms), (select rebuilt from tz_ms), 'milestones timezone: derived equals rebuild before the change (the 23:30 visit is the 7th day)');
select is((select derived -> 'milestones' from tz_ms), '[7]'::jsonb, 'milestones timezone: the 7th is held');
update gyms set timezone = 'Africa/Nairobi' where id = pg_temp.id(1, 1);
select is(pg_temp.derived(12), (select derived from tz_ms), 'milestones timezone: derived is identical after the change');
select is(pg_temp.rebuilt(12, date '2026-03-16'), (select rebuilt from tz_ms), 'milestones timezone: and so is the rebuild');
select is(pg_temp.settle(12, date '2026-03-16'), 0, 'milestones timezone: a settle after the change writes nothing');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(12) and kind = 'milestone'), 1, 'milestones timezone: and the milestone is one row');
update gyms set timezone = 'Africa/Douala' where id = pg_temp.id(1, 1);

select * from finish();
rollback;
