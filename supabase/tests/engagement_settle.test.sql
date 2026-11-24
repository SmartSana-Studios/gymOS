-- Story 30.2: private.settle_engagement (migration 0185), the matrix of the story: dark, dormant, pre-epoch history, the open week, empty weeks,
-- replay, dirty re-evaluation (a late visit and an identical recount), void, wrong gym, the watermark, the frozen goal, the epoch guard and
-- the scan that every function naming the engagement tables is a reviewed one.
--
-- Time never comes from the clock: p_up_to is a fixed date in every call, visit days are explicit, join dates are explicit, the gym is
-- Africa/Douala. Mondays used: 2026-03-02 (the epoch), 03-09, 03-16, 03-23, 03-30, 04-06.
-- "A late visit" is marked by the test itself: it sets engagement_state.dirty_from as the table owner (pg_temp.mark_dirty, the statement 30.3
-- added to record_check_in), because the fixtures are fixed March 2026 dates the real clock cannot reach. The mark written by the REAL
-- record_check_in and void_staff_check_in is proven in engagement_dirty_mark.test.sql, engagement_journey.test.sql and engagement-race.sh.
--
-- Fixture ids: 00000000-0000-0000-0033-00000000nnnn. Gym 1001 (A), gym 1002 (B), users 2xxx, members 3xxx.

begin;
select plan(128);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0033-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'ST Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'ST Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'ST Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'st-' || n || '@x.example', now() from generate_series(1, 40) n;
-- Member 12 belongs to gym B; everyone else to gym A. All joined before the epoch.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, case when n = 12 then 2 else 1 end), pg_temp.id(2, n), 'member', 'ST Member ' || n, date '2026-01-05' from generate_series(1, 40) n;

-- A counted visit: one attendance row, closed, on the given gym-local day.
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

-- The result of a settle, or the error: "N" or "sqlstate:message".
create function pg_temp.settle(p_n int, p_up_to date, p_gym int default 1) returns text language plpgsql as $f$
begin
  return private.settle_engagement(pg_temp.m(p_n), pg_temp.id(1, p_gym), p_up_to)::text;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

-- The effective week facts as "week:revision:outcome:goal:visits", in week order, or '-'.
create function pg_temp.facts(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(e.subject_key || ':' || e.revision || ':' || e.outcome || ':' || e.goal || ':' || e.visits, ' ' order by e.subject_key), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'week'
$f$;
create function pg_temp.nrows(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'week' $f$;  -- week rows only since 31.1 (a run that ends also writes a comeback fact)
create function pg_temp.st(p_n int) returns text language sql stable as $f$
  select coalesce((select coalesce(s.settled_through::text, 'null') || '|' || coalesce(s.dirty_from::text, 'null') from engagement_state s where s.member_id = pg_temp.m(p_n)), 'none')
$f$;
-- The two states of the determinism rule, compared as jsonb.
create function pg_temp.same(p_n int, p_up_to date) returns boolean language sql stable as $f$
  select (select to_jsonb(d) from private.engagement_derived_state(pg_temp.m(p_n)) d) = (select to_jsonb(r) from private.rebuild_engagement(pg_temp.m(p_n), p_up_to) r)
$f$;
create function pg_temp.mark_dirty(p_n int, p_week date) returns void language sql as $f$
  insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_week)
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)
$f$;

-- ============================================================================
-- Shape
-- ============================================================================
select has_function('private', 'settle_engagement', array['uuid', 'uuid', 'date']::name[], 'private.settle_engagement(uuid, uuid, date) exists');
select is_definer('private', 'settle_engagement', array['uuid', 'uuid', 'date']::name[], 'settle is SECURITY DEFINER');
select volatility_is('private', 'settle_engagement', array['uuid', 'uuid', 'date']::name[], 'volatile', 'settle is VOLATILE (it writes)');
select is((select p.proconfig from pg_proc p where p.oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure), array['search_path=public, pg_temp'], 'settle pins its search_path');
select function_returns('private', 'settle_engagement', array['uuid', 'uuid', 'date']::name[], 'integer', 'settle returns the number of facts written');
select is_definer('private', 'engagement_facts_append_only_guard', '{}'::name[], 'the append-only guard is SECURITY DEFINER');
select is_definer('private', 'engagement_epoch_guard', '{}'::name[], 'the epoch guard is SECURITY DEFINER');
select volatility_is('private', 'engagement_derived_state', array['uuid']::name[], 'stable', 'engagement_derived_state is STABLE');
select volatility_is('private', 'rebuild_engagement', array['uuid', 'date']::name[], 'stable', 'rebuild_engagement is STABLE');
select volatility_is('private', 'engagement_evaluate_weeks', array['uuid', 'uuid', 'date', 'date']::name[], 'stable', 'engagement_evaluate_weeks is STABLE');

-- The lock is the first statement: it comes before the config, the state and member_visit_days are read, and before any write.
select ok(
  (select position('for no key update' in p.prosrc) > 0
      and position('for no key update' in p.prosrc) < position('platform_engagement_config' in p.prosrc)
      and position('for no key update' in p.prosrc) < position('from engagement_state s' in p.prosrc)
      and position('for no key update' in p.prosrc) < position('member_visit_days' in p.prosrc)
      and position('for no key update' in p.prosrc) < position('engagement_facts' in p.prosrc)
      and position('for no key update' in p.prosrc) < position('evaluate_weeks' in p.prosrc)
      and p.prosrc ~* 'begin\s+perform 1 from members m where m\.id = p_member_id and m\.gym_id = p_gym_id for no key update;'
   from pg_proc p where p.oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure),
  'the member lock (members, for no key update) is the first statement of settle, before every read and write');
select ok(
  (select p.prosrc !~* 'attendance_events|attendance_counted' from pg_proc p where p.oid = 'private.settle_engagement(uuid, uuid, date)'::regprocedure)
  and (select p.prosrc !~* 'attendance_events|attendance_counted' from pg_proc p where p.oid = 'private.engagement_evaluate_weeks(uuid, uuid, date, date)'::regprocedure)
  and (select p.prosrc ~* 'member_visit_days' from pg_proc p where p.oid = 'private.engagement_evaluate_weeks(uuid, uuid, date, date)'::regprocedure),
  'every count reads member_visit_days, never attendance_events or attendance_counted');

-- ============================================================================
-- Dark: release_week_start NULL writes nothing and leaves dirty_from alone
-- ============================================================================
select is((select release_week_start from platform_engagement_config), null::date, 'the epoch is unset (dark) in this database');
select pg_temp.visit(1, date '2026-03-02');
select pg_temp.visit(1, date '2026-03-03');
select pg_temp.visit(1, date '2026-03-04');
select pg_temp.mark_dirty(1, date '2026-03-02');
select is(pg_temp.settle(1, date '2026-03-23'), '0', 'dark: settle writes nothing and returns 0 for a member with three visits in a closed week');
select is(pg_temp.nrows(1), 0, 'dark: no fact exists');
select is(pg_temp.st(1), 'null|2026-03-02', 'dark: dirty_from is untouched and settled_through is still unset');
select is((select count(*)::int from engagement_facts), 0, 'dark: no fact exists anywhere in the database');
select is((select updated_at from engagement_state where member_id = pg_temp.m(1)) is not null, true, 'dark: the state row is the one this test made');

-- ============================================================================
-- The epoch is frozen once a week fact exists (the 30.1 deferral). Free while no fact exists.
-- ============================================================================
select lives_ok($$update platform_engagement_config set release_week_start = date '2026-03-09'$$, 'epoch: NULL to a Monday while no week fact exists is allowed');
select lives_ok($$update platform_engagement_config set release_week_start = null$$, 'epoch: and back to NULL while no week fact exists');
select lives_ok($$update platform_engagement_config set release_week_start = date '2026-03-02'$$, 'epoch: the test epoch, Monday 2026-03-02');
select is((select release_week_start from platform_engagement_config), date '2026-03-02', 'the epoch is 2026-03-02');
select throws_ok($$update platform_engagement_config set release_week_start = date '2026-03-03'$$, '23514', null, 'epoch: a non-Monday is still refused by the 30.1 CHECK');

-- ============================================================================
-- Dormant: no counted visit day, no row, no state
-- ============================================================================
select is(pg_temp.settle(2, date '2026-03-23'), '0', 'dormant: a member with no visit day writes nothing');
select is(pg_temp.nrows(2), 0, 'dormant: no fact');
select is(pg_temp.st(2), 'none', 'dormant: no state row');
-- ... even when every visit was voided
select pg_temp.visit(3, date '2026-03-03');
select pg_temp.void(3, date '2026-03-03');
select is(pg_temp.settle(3, date '2026-03-23'), '0', 'dormant: a member whose only visit was voided writes nothing');
select is(pg_temp.st(3), 'none', 'dormant: and gets no state row');
select pg_temp.mark_dirty(3, date '2026-03-02');
select is(pg_temp.settle(3, date '2026-03-23'), '0', 'dormant: a dirty mark left by the voided visit writes nothing');
select is(pg_temp.st(3), 'null|null', 'dormant: and the mark is cleared');

-- ============================================================================
-- Pre-epoch visits: no fact before the epoch, the days still count, the first fact is the epoch week
-- ============================================================================
select pg_temp.visit(4, date '2026-02-16');
select pg_temp.visit(4, date '2026-02-25');
select pg_temp.visit(4, date '2026-03-03');
select pg_temp.visit(4, date '2026-03-04');
select pg_temp.visit(4, date '2026-03-05');
select pg_temp.visit(4, date '2026-03-17');
select is(pg_temp.settle(4, date '2026-03-23'), '3', 'pre-epoch: three weeks are closed three weeks after the epoch (03-02, 03-09, 03-16), three facts written');
select is(pg_temp.facts(4), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0 2026-03-16:1:missed:3:1', 'pre-epoch: the first fact is the epoch week (met, 3 visits); the week of 03-16 has one visit');
select is((select min(subject_key) from engagement_facts where member_id = pg_temp.m(4)), '2026-03-02', 'pre-epoch: no fact exists for any week before the epoch');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(4)), 6, 'pre-epoch: member_visit_days still holds all six days, the two before the epoch included');
select is(pg_temp.st(4), '2026-03-16|null', 'pre-epoch: settled_through is the last closed week, dirty_from is clear');
select ok(pg_temp.same(4, date '2026-03-23'), 'pre-epoch: derived state equals the rebuild');
-- A member whose visits are all before the epoch still starts at the epoch week.
select pg_temp.visit(5, date '2026-02-10');
select is(pg_temp.settle(5, date '2026-03-16'), '2', 'pre-epoch only: the weeks 03-02 and 03-09 are written as missed (the start week is the epoch)');
select is(pg_temp.facts(5), '2026-03-02:1:missed:3:0 2026-03-09:1:missed:3:0', 'pre-epoch only: empty missed weeks from the epoch, none before it');

-- ============================================================================
-- Open week: a week is closed only when p_up_to >= Monday + 7
-- ============================================================================
select pg_temp.visit(6, date '2026-03-02');
select pg_temp.visit(6, date '2026-03-03');
select pg_temp.visit(6, date '2026-03-04');
select pg_temp.visit(6, date '2026-03-09');
select is(pg_temp.settle(6, date '2026-03-04'), '0', 'open week: inside the first week nothing is closed');
select is(pg_temp.st(6), 'none', 'open week: and no state row is made');
select is(pg_temp.settle(6, date '2026-03-08'), '0', 'open week: the Sunday of the first week is still inside it');
select is(pg_temp.settle(6, date '2026-03-09'), '1', 'open week: on the next Monday the first week closes');
select is(pg_temp.facts(6), '2026-03-02:1:met:3:3', 'open week: week 03-09 (one visit, open) has no fact');
select is(pg_temp.settle(6, date '2026-03-15'), '0', 'open week: the Sunday of the second week keeps it open');
select is(pg_temp.settle(6, date '2026-03-16'), '1', 'open week: the Monday after closes it');
select is(pg_temp.facts(6), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:1', 'open week: now both are settled');

-- ============================================================================
-- Empty weeks: a gap between the start week and the last closed week gets missed facts with 0 visits
-- ============================================================================
select pg_temp.visit(7, date '2026-03-02');
select pg_temp.visit(7, date '2026-03-23');
select is(pg_temp.settle(7, date '2026-04-06'), '5', 'empty weeks: five weeks closed, five facts');
select is(pg_temp.facts(7), '2026-03-02:1:missed:3:1 2026-03-09:1:missed:3:0 2026-03-16:1:missed:3:0 2026-03-23:1:missed:3:1 2026-03-30:1:missed:3:0',
          'empty weeks: the two weeks with no visit are missed facts with 0 visits, distinguishable from an unsettled one');
select ok(pg_temp.same(7, date '2026-04-06'), 'empty weeks: derived equals rebuild');

-- ============================================================================
-- Replay: settle twice, same arguments
-- ============================================================================
select pg_temp.visit(8, date '2026-03-02');
select pg_temp.visit(8, date '2026-03-03');
select pg_temp.visit(8, date '2026-03-04');
select is(pg_temp.settle(8, date '2026-03-16'), '2', 'replay: the first call writes two weeks');
select is(pg_temp.st(8), '2026-03-09|null', 'replay: settled_through is 03-09');
create temp table replay_before as select ctid::text as c from engagement_state where member_id = pg_temp.m(8);
select is(pg_temp.settle(8, date '2026-03-16'), '0', 'replay: the second call returns zero weeks written');
select is(pg_temp.nrows(8), 2, 'replay: still two rows');
select is(pg_temp.st(8), '2026-03-09|null', 'replay: settled_through unchanged');
select is((select ctid::text from engagement_state where member_id = pg_temp.m(8)), (select c from replay_before), 'replay: the state row was not even rewritten (same tuple)');

-- ============================================================================
-- Late visit: a Sunday visit synced on the Tuesday after the week was settled missed
-- ============================================================================
select pg_temp.visit(9, date '2026-03-02');
select pg_temp.visit(9, date '2026-03-04');
select is(pg_temp.settle(9, date '2026-03-16'), '2', 'late visit: week 03-02 (two visits) and 03-09 (none) settle as missed');
select is(pg_temp.facts(9), '2026-03-02:1:missed:3:2 2026-03-09:1:missed:3:0', 'late visit: revision 1 of 03-02 is missed with two visits');
select pg_temp.visit(9, date '2026-03-08');   -- the Sunday visit, recorded offline, received on the Tuesday
select is(pg_temp.settle(9, date '2026-03-16'), '0', 'late visit: without a dirty mark settle does not look back (30.3 adds the mark to record_check_in)');
select pg_temp.mark_dirty(9, date '2026-03-02');
select is(pg_temp.settle(9, date '2026-03-16'), '1', 'late visit: with the mark it writes one new revision');
select is(pg_temp.facts(9), '2026-03-02:2:met:3:3 2026-03-09:1:missed:3:0', 'late visit: week 03-02 is revision 2, met, three visits; week 03-09 untouched (no new row for an identical recount)');
select is(pg_temp.nrows(9), 3, 'late visit: the old revision stays in the ledger');
select is(pg_temp.st(9), '2026-03-09|null', 'late visit: dirty_from is cleared and settled_through did not move');
select ok(pg_temp.same(9, date '2026-03-16'), 'late visit: derived equals rebuild');

-- ============================================================================
-- Identical recount: a dirty week that recounts the same gets no new row
-- ============================================================================
select pg_temp.visit(10, date '2026-03-02');
select pg_temp.visit(10, date '2026-03-03');
select pg_temp.visit(10, date '2026-03-04');
select pg_temp.settle(10, date '2026-03-16');
select pg_temp.mark_dirty(10, date '2026-03-02');
select is(pg_temp.settle(10, date '2026-03-16'), '0', 'identical recount: a dirty week with the same count writes no revision');
select is(pg_temp.nrows(10), 2, 'identical recount: still two rows');
select is(pg_temp.st(10), '2026-03-09|null', 'identical recount: the mark is consumed');
select pg_temp.mark_dirty(10, date '2026-03-09');
select is(pg_temp.settle(10, date '2026-03-16'), '0', 'identical recount: the second week too');

-- A mark inside the open week is consumed without a fact, and the week is still settled when it closes.
select pg_temp.visit(11, date '2026-03-02');
select pg_temp.visit(11, date '2026-03-03');
select pg_temp.visit(11, date '2026-03-04');
select pg_temp.mark_dirty(11, date '2026-03-02');
select is(pg_temp.settle(11, date '2026-03-04'), '0', 'open-week mark: a check-in in the open week marks it dirty and settle writes nothing');
select is(pg_temp.st(11), 'null|null', 'open-week mark: the mark is cleared and nothing is settled');
select is(pg_temp.settle(11, date '2026-03-10'), '1', 'open-week mark: the week is still settled when it closes (it is after settled_through)');
select is(pg_temp.facts(11), '2026-03-02:1:met:3:3', 'open-week mark: met');

-- ============================================================================
-- Void: a same-day void lowers the open week only
-- ============================================================================
select pg_temp.visit(13, date '2026-03-02');
select pg_temp.visit(13, date '2026-03-03');
select pg_temp.visit(13, date '2026-03-04');
select pg_temp.settle(13, date '2026-03-09');
select pg_temp.visit(13, date '2026-03-09');
select pg_temp.visit(13, date '2026-03-10');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(13) and visit_day >= date '2026-03-09'), 2, 'void: two visit days in the open week');
select pg_temp.void(13, date '2026-03-10');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(13) and visit_day >= date '2026-03-09'), 1, 'void: the voided day no longer counts in the open week');
select pg_temp.mark_dirty(13, date '2026-03-09');
select is(pg_temp.settle(13, date '2026-03-12'), '0', 'void: settle writes no fact for the open week');
select is(pg_temp.facts(13), '2026-03-02:1:met:3:3', 'void: the closed week is untouched');
select is((select best_streak_weeks from private.engagement_fold(pg_temp.m(13))), 1, 'void: best_streak_weeks is not lowered');
select ok(pg_temp.same(13, date '2026-03-12'), 'void: derived equals rebuild');

-- ============================================================================
-- Wrong gym and bad arguments
-- ============================================================================
select pg_temp.visit(12, date '2026-03-02');
select is(pg_temp.settle(12, date '2026-03-16', 1), 'P0001:settle_engagement: member ' || pg_temp.m(12) || ' is not a member of gym ' || pg_temp.id(1, 1),
          'wrong gym: a member of gym B settled as gym A raises');
select is(pg_temp.nrows(12) + (select count(*)::int from engagement_state where member_id = pg_temp.m(12)), 0, 'wrong gym: nothing was written');
select is(pg_temp.settle(12, date '2026-03-16', 2), '2', 'the right gym settles the same member');
select ok(pg_temp.settle(14, date '2026-03-16', 2) like 'P0001:%', 'a member of gym A settled as gym B raises too');
select is(pg_temp.settle(1, null), 'P0001:settle_engagement: p_up_to is required', 'a NULL p_up_to raises');
select ok(pg_temp.settle(99, date '2026-03-16') like 'P0001:%', 'an unknown member raises');

-- ============================================================================
-- The watermark: never backwards, dirty_from kept only when this run could not reach it
-- ============================================================================
select pg_temp.visit(15, date '2026-03-02');
select pg_temp.settle(15, date '2026-03-30');
select is(pg_temp.st(15), '2026-03-23|null', 'watermark: settled_through 03-23 after a settle up to 03-30');
select is(pg_temp.settle(15, date '2026-03-16'), '0', 'watermark: an earlier p_up_to writes nothing');
select is(pg_temp.st(15), '2026-03-23|null', 'watermark: and settled_through does not move backwards');
select pg_temp.mark_dirty(15, date '2026-03-23');
select is(pg_temp.settle(15, date '2026-03-16'), '0', 'watermark: a run that cannot reach the dirty week writes nothing');
select is(pg_temp.st(15), '2026-03-23|2026-03-23', 'watermark: and keeps the mark (the clock went back over a Monday)');
select is(pg_temp.settle(15, date '2026-03-30'), '0', 'watermark: the next run reaches it, the count is the same');
select is(pg_temp.st(15), '2026-03-23|null', 'watermark: and clears it');

-- ============================================================================
-- The start week is greatest(epoch, week of the first visit day)
-- ============================================================================
select pg_temp.visit(16, date '2026-03-24');
select is(pg_temp.settle(16, date '2026-04-06'), '2', 'start week: a first visit in the week of 03-23 starts the member there (not at the epoch)');
select is(pg_temp.facts(16), '2026-03-23:1:missed:3:1 2026-03-30:1:missed:3:0', 'start week: the first fact is 03-23');
-- A visit earlier than the first one, received late and marked: the start moves back and the earlier weeks are evaluated.
select pg_temp.visit(16, date '2026-03-10');
select pg_temp.mark_dirty(16, date '2026-03-09');
select is(pg_temp.settle(16, date '2026-04-06'), '2', 'start week: a late visit before the first fact adds the weeks from its own week');
select is(pg_temp.facts(16), '2026-03-09:1:missed:3:1 2026-03-16:1:missed:3:0 2026-03-23:1:missed:3:1 2026-03-30:1:missed:3:0', 'start week: 03-09 and the empty 03-16 are new facts');
select ok(pg_temp.same(16, date '2026-04-06'), 'start week: derived equals rebuild');

-- ============================================================================
-- Counting rules: distinct days, Sunday and Monday, class-free
-- ============================================================================
select pg_temp.visit(17, date '2026-03-03', 9);
select pg_temp.visit(17, date '2026-03-03', 17);
select pg_temp.visit(17, date '2026-03-04');
select is(pg_temp.settle(17, date '2026-03-09'), '1', 'counting: two check-ins on one day and one on another');
select is(pg_temp.facts(17), '2026-03-02:1:missed:3:2', 'counting: several check-ins on a day count once');
select pg_temp.visit(18, date '2026-03-08');
select pg_temp.visit(18, date '2026-03-09');
select pg_temp.settle(18, date '2026-03-16');
select is(pg_temp.facts(18), '2026-03-02:1:missed:3:1 2026-03-09:1:missed:3:1', 'counting: a Sunday visit belongs to the week it ends, a Monday visit to the week it starts');

-- ============================================================================
-- The frozen goal: a settled week keeps its goal when the default or the goal history changes
-- ============================================================================
select pg_temp.visit(19, date '2026-03-02');
select pg_temp.visit(19, date '2026-03-03');
select pg_temp.visit(19, date '2026-03-04');
select pg_temp.settle(19, date '2026-03-16');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0', 'frozen goal (default): both weeks settle at the default goal 3');
update platform_engagement_config set goal_default = 4;
select pg_temp.mark_dirty(19, date '2026-03-02');
select is(pg_temp.settle(19, date '2026-03-16'), '0', 'frozen goal (default): after goal_default changes to 4 a dirty recount of the settled weeks writes nothing');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0', 'frozen goal (default): week 03-02 is still met at goal 3 (3 visits would be missed at goal 4)');
select pg_temp.visit(19, date '2026-03-16');
select pg_temp.visit(19, date '2026-03-17');
select pg_temp.visit(19, date '2026-03-18');
select is(pg_temp.settle(19, date '2026-03-23'), '1', 'frozen goal (default): a new unsettled week is evaluated');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0 2026-03-16:1:missed:4:3', 'frozen goal (default): the new week uses the new default 4, so three visits miss it');
update platform_engagement_config set goal_default = 3;

-- A goal history row added for a week that is already settled does not rewrite it either.
alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (pg_temp.m(19), pg_temp.id(1, 1), date '2026-03-02', 1);
alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;
select pg_temp.mark_dirty(19, date '2026-03-02');
select is(pg_temp.settle(19, date '2026-03-23'), '0', 'frozen goal (history): a goal row for a settled week changes nothing');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0 2026-03-16:1:missed:4:3', 'frozen goal (history): the settled weeks keep their goals');
-- The same row does decide a week that has no fact yet.
select pg_temp.visit(19, date '2026-03-23');
select is(pg_temp.settle(19, date '2026-03-30'), '1', 'frozen goal (history): the next week is evaluated');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:1:missed:3:0 2026-03-16:1:missed:4:3 2026-03-23:1:met:1:1', 'frozen goal (history): and takes the goal of the latest history row at or before its Monday (1)');

-- The goal of a revision stays the goal of the first one, whatever happens to the history in between.
select pg_temp.visit(19, date '2026-03-09');
select pg_temp.visit(19, date '2026-03-10');
select pg_temp.visit(19, date '2026-03-11');
select pg_temp.mark_dirty(19, date '2026-03-09');
select is(pg_temp.settle(19, date '2026-03-30'), '1', 'frozen goal: a late recount of a settled week writes a new revision');
select is(pg_temp.facts(19), '2026-03-02:1:met:3:3 2026-03-09:2:met:3:3 2026-03-16:1:missed:4:3 2026-03-23:1:met:1:1', 'frozen goal: revision 2 keeps goal 3 (the history row for 03-02 and the default 3 are irrelevant)');
select ok(pg_temp.same(19, date '2026-03-30'), 'frozen goal: derived equals rebuild');

-- ============================================================================
-- A saved week is decided by the in-order fold, not kept by the stand-in rule of 30.2 (31.1)
-- ============================================================================
select pg_temp.visit(20, date '2026-03-03');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
values (pg_temp.m(20), pg_temp.id(1, 1), 'week', '2026-03-02', 1, 'saved', 3, 1);
select pg_temp.mark_dirty(20, date '2026-03-02');
select is(pg_temp.settle(20, date '2026-03-09'), '1', 'saved: a hand-written saved fact with no run behind it is re-decided (a Shield is only ever spent inside a run): revision 2');
select is(pg_temp.facts(20), '2026-03-02:2:missed:3:1', 'saved: it is now missed');
select pg_temp.visit(20, date '2026-03-04');
select pg_temp.mark_dirty(20, date '2026-03-02');
select is(pg_temp.settle(20, date '2026-03-09'), '1', 'saved: another visit below the goal is a new revision');
select is(pg_temp.facts(20), '2026-03-02:3:missed:3:2', 'saved: still missed, with the new count');
select pg_temp.visit(20, date '2026-03-05');
select pg_temp.mark_dirty(20, date '2026-03-02');
select is(pg_temp.settle(20, date '2026-03-09'), '1', 'saved: reaching the goal makes it met');
select is(pg_temp.facts(20), '2026-03-02:4:met:3:3', 'saved: revision 4 is met');

-- ============================================================================
-- Epoch guard: frozen once any week fact exists
-- ============================================================================
select cmp_ok((select count(*)::int from engagement_facts where kind = 'week'), '>', 0, 'week facts exist now');
select throws_ok($$update platform_engagement_config set release_week_start = date '2026-03-09'$$, '23514', null, 'epoch guard: moving the epoch later is refused once a week fact exists');
select throws_ok($$update platform_engagement_config set release_week_start = date '2026-02-23'$$, '23514', null, 'epoch guard: moving it earlier is refused');
select throws_ok($$update platform_engagement_config set release_week_start = null$$, '23514', null, 'epoch guard: setting it to NULL (dark again) is refused');
select is((select release_week_start from platform_engagement_config), date '2026-03-02', 'epoch guard: the epoch is unchanged');
select lives_ok($$update platform_engagement_config set release_week_start = release_week_start$$, 'epoch guard: an update that leaves it as it is is allowed');
select lives_ok($$update platform_engagement_config set daily_streak_min = daily_streak_min$$, 'epoch guard: so is an update of another column');
select lives_ok($$update platform_engagement_config set goal_default = 3$$, 'epoch guard: and a change of goal_default');

-- ============================================================================
-- Every function that names the engagement tables, the settle, the job or the state view is a reviewed one (a PINNED list), and none is callable by
-- a client except void_staff_check_in (an Epic 27 staff function), and the member pair my_engagement and open_engagement (30.3)
-- ============================================================================
select is(
  (select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname !~ '^(pg_|information_schema$)'
     and p.prosrc ~* '\m(engagement_facts|engagement_state|engagement_state_view|engagement_state_view_at|open_engagement_at|settle_engagement|engagement_settle(_[a-z_]+)?)\M'),
  'private.award_milestones, private.effective_engagement_facts, private.engagement_epoch_guard, private.engagement_facts_append_only_guard, private.engagement_settle_candidates, private.engagement_settle_job, private.engagement_settle_member, private.engagement_settle_record_run, private.engagement_state_view, private.engagement_state_view_at, private.open_engagement_at, private.record_check_in, private.settle_engagement, public.acknowledge_milestone, public.my_engagement, public.open_engagement, public.void_staff_check_in',
  'the functions that name the engagement tables, settle, the job or the state view are exactly: the 30.2 set (settle, the two guards, the effective-facts reader), the job and its three helpers, the view family, the two Epic 27 check-in paths and the public pair (30.7 adds award_milestones and the acknowledge function here)');
select is(
  (select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname !~ '^(pg_|information_schema$)'
     and p.prosrc ~* '\m(engagement_facts|engagement_state|engagement_state_view|engagement_state_view_at|open_engagement_at|settle_engagement|engagement_settle(_[a-z_]+)?)\M'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  'public.acknowledge_milestone, public.my_engagement, public.open_engagement, public.void_staff_check_in',
  'the only ones an authenticated client can execute are void_staff_check_in (staff, Epic 27), the member pair my_engagement and open_engagement, and acknowledge_milestone (30.7)');
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'service_role', 'public']) r
   where n.nspname !~ '^(pg_|information_schema$)'
     and p.prosrc ~* '\m(engagement_facts|engagement_state|engagement_state_view|engagement_state_view_at|open_engagement_at|settle_engagement|engagement_settle(_[a-z_]+)?)\M'
     and has_function_privilege(r, p.oid, 'execute')),
  0, 'and none of them can be executed by anon, service_role or PUBLIC');
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated']) r
   where n.nspname = 'private' and (p.proname ~ 'engagement' or p.proname = 'settle_engagement' or p.proname = 'record_check_in') and has_function_privilege(r, p.oid, 'execute')),
  0, 'no engagement function, nor record_check_in, of the private schema is executable by anon or authenticated');

select * from finish();
rollback;
