-- Story 30.3 (PRD UJ-15 without Shields; FR-219, FR-220, NFR-028): a member with goal 3, in Africa/Douala, with the clock moved by the test.
--
-- Every visit goes through the REAL private.record_check_in (an offline scan with its recorded time, which the function stores as visit_day and
-- marks dirty), the clock is the p_now of private.open_engagement_at / engagement_state_view_at, and open_engagement is called each Monday.
--   Member 1: week 1 (Mon 2026-03-02) three visit days -> 1; week 2 none -> 0 (best stays 1); week 3 three visit days -> 1; THEN a late offline
--             visit set for week 2 syncs (during week 4) -> on the next open week 2 is revision 2 `met`, the streak is 3 and the best is 3.
--   Member 2: the same weeks, but the late visits for week 2 sync DURING week 3 (Thursday 2026-03-19): the Monday open settles week 2 as revision
--             2 `met` and week 3 together: streak 3, best 3.
-- The ring counts (visits_this_week) follow the check-ins. A plain read (the view, my_engagement) never changes a row: the contents of
-- engagement_state and engagement_facts are hashed before and after every read.
--
-- Fixture ids: 00000000-0000-0000-0040-00000000nnnn. Gym 1001, users 2xxx, members 3xxx.

begin;
set local timezone = 'UTC';
select plan(68);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0040-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'JR Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone)
values (pg_temp.id(1, 1), 'JR Gym', pg_temp.id(0, 1), 'active', false, 0, 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'jr-' || n || '@x.example', now() from generate_series(1, 3) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, 1), pg_temp.id(2, n), 'member', 'JR Member ' || n, date '2026-01-05' from generate_series(1, 3) n;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days)
values (pg_temp.id(4, 1), pg_temp.id(1, 1), 'JR Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.id(1, 1), pg_temp.m(n), pg_temp.id(4, 1), 'active', date '2026-01-05', date '2030-01-01' from generate_series(1, 3) n;

update platform_engagement_config set release_week_start = date '2026-03-02';

-- A check-in recorded on a day (an offline scan: its stored visit_day is the recorded local day).
create function pg_temp.chk(p_n int, p_day date) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
  return (select r.outcome from private.record_check_in(pg_temp.m(p_n), pg_temp.id(1, 1), 'qr', null, (p_day + time '10:00') at time zone 'Africa/Douala', gen_random_uuid()) r);
end $f$;
-- The hash of every engagement row: a read must leave it as it was.
create function pg_temp.sig() returns text language sql stable as $f$
  select md5(coalesce((select string_agg(s::text, '|' order by s::text) from engagement_state s), '') || '#' ||
             coalesce((select string_agg(f::text, '|' order by f::text) from engagement_facts f), ''))
$f$;
-- A plain read: 'streak|best|visits_this_week|goal_met|streak_if_met|needs_settle|has_settled_week'; the hash is compared by the caller.
create function pg_temp.rd(p_n int, p_now timestamptz) returns text language sql stable as $f$
  select coalesce(v.streak_weeks, 0) || '|' || v.best_streak_weeks || '|' || v.visits_this_week || '|' || v.goal_met || '|' || coalesce(v.streak_if_met::text, 'null') || '|' || v.needs_settle || '|' || v.has_settled_week
  from private.engagement_state_view_at(pg_temp.m(p_n), p_now) v
$f$;
create function pg_temp.op(p_n int, p_now timestamptz) returns text language sql as $f$
  select coalesce(v.streak_weeks, 0) || '|' || v.best_streak_weeks || '|' || v.visits_this_week || '|' || v.goal_met || '|' || coalesce(v.streak_if_met::text, 'null') || '|' || v.needs_settle || '|' || v.has_settled_week
  from private.open_engagement_at(pg_temp.m(p_n), p_now) v
$f$;
create function pg_temp.facts(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(e.subject_key || ':' || e.revision || ':' || e.outcome || ':' || e.visits, ' ' order by e.subject_key), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'week'
$f$;
create function pg_temp.rows_of(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'week' $f$;
-- 30.7: the milestone rows and the pending number of a member (a plain read of the view).
create function pg_temp.ms_of(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'milestone' $f$;
create function pg_temp.pend(p_n int, p_now timestamptz) returns text language sql stable as $f$ select coalesce((select v.pending_milestone::text from private.engagement_state_view_at(pg_temp.m(p_n), p_now) v), 'null') $f$;
create function pg_temp.dirty(p_n int) returns text language sql stable as $f$ select coalesce((select dirty_from::text from engagement_state where member_id = pg_temp.m(p_n)), 'none') $f$;

-- ============================================================================
-- Member 1, week 1 (2026-03-02): three visit days; the ring follows each check-in
-- ============================================================================
select is(pg_temp.chk(1, date '2026-03-02'), 'checked_in', 'week 1, Monday: a check-in');
select is(pg_temp.dirty(1), '2026-03-02', 'the real check-in marked the week dirty');
select is(pg_temp.rd(1, '2026-03-02 18:00+01'), '0|0|1|false|null|true|false', 'Monday evening: 1 of 3, the streak 0, and the view says it needs a settle (a mark exists)');
select is(pg_temp.chk(1, date '2026-03-04'), 'checked_in', 'Wednesday: a check-in');
select is(pg_temp.rd(1, '2026-03-04 18:00+01'), '0|0|2|false|null|true|false', 'Wednesday evening: 2 of 3');
select is(pg_temp.chk(1, date '2026-03-06'), 'checked_in', 'Friday: a check-in');
select is(pg_temp.rd(1, '2026-03-06 18:00+01'), '0|0|3|true|1|true|false', 'Friday evening: 3 of 3, goal met, the streak would be 1 if the week ended now, the settled streak is still 0');
select is(pg_temp.op(1, '2026-03-06 18:30+01'), '0|0|3|true|1|false|false', 'open_engagement in the open week settles nothing (no closed week) and clears the mark');
select is(pg_temp.rows_of(1), 0, 'no fact yet: the open week never gets one');

-- ============================================================================
-- Monday 2026-03-09: week 1 settles, 1
-- ============================================================================
create temp table sig_a as select pg_temp.sig() as s;
select is(pg_temp.rd(1, '2026-03-09 08:00+01'), '0|0|0|false|null|true|false', 'Monday 2026-03-09 before opening: the settled streak is still 0 and needs_settle is true (a closed week)');
select is(pg_temp.sig(), (select s from sig_a), 'the plain read wrote nothing');
select is(pg_temp.op(1, '2026-03-09 08:00+01'), '1|1|0|false|null|false|true', 'open_engagement: week 1 is settled, the streak reads 1 (best 1), the new week shows 0 visits');
select is(pg_temp.facts(1), '2026-03-02:1:met:3', 'one fact: week 2026-03-02 met with 3 visits');

-- ============================================================================
-- Week 2 (2026-03-09): nothing. Monday 2026-03-16: missed, the run ends, the best stays 1
-- ============================================================================
select is(pg_temp.rd(1, '2026-03-15 20:00+01'), '1|1|0|false|null|false|true', 'Sunday evening of week 2: still 1 settled, nothing visited, nothing to settle until the week closes');
select is(pg_temp.op(1, '2026-03-16 08:00+01'), '0|1|0|false|null|false|true', 'Monday 2026-03-16: week 2 settles missed, the streak is 0 and the best stays 1');
select is(pg_temp.facts(1), '2026-03-02:1:met:3 2026-03-09:1:missed:0', 'week 2 is a missed fact with 0 visits');

-- ============================================================================
-- Week 3 (2026-03-16): three visit days; Monday 2026-03-23: 1
-- ============================================================================
select is(pg_temp.chk(1, date '2026-03-16'), 'checked_in', 'week 3, Monday: a check-in');
select is(pg_temp.chk(1, date '2026-03-17'), 'checked_in', 'Tuesday: a check-in');
select is(pg_temp.rd(1, '2026-03-17 20:00+01'), '0|1|2|false|null|true|true', 'Tuesday evening: 2 of 3');
select is(pg_temp.chk(1, date '2026-03-18'), 'checked_in', 'Wednesday: a check-in');
select is(pg_temp.rd(1, '2026-03-18 20:00+01'), '0|1|3|true|1|true|true', 'Wednesday evening: 3 of 3, the streak would be 1');
select is(pg_temp.op(1, '2026-03-23 08:00+01'), '1|1|0|false|null|false|true', 'Monday 2026-03-23: week 3 settles met, the streak reads 1 (best 1)');
select is(pg_temp.facts(1), '2026-03-02:1:met:3 2026-03-09:1:missed:0 2026-03-16:1:met:3', 'three week facts');
select is(pg_temp.rows_of(1), 3, 'three rows in the ledger');

-- ============================================================================
-- A late offline visit set for week 2 syncs: week 2 becomes revision 2 `met`, the streak is 3 and the best is 3 on the next open
-- ============================================================================
select is(pg_temp.chk(1, date '2026-03-10'), 'checked_in', 'late: an offline scan recorded in week 2 syncs (Tuesday 2026-03-10)');
select is(pg_temp.dirty(1), '2026-03-09', 'its mark is the Monday of the RECORDED week (2026-03-09), not the week it synced in');
select is(pg_temp.chk(1, date '2026-03-11'), 'checked_in', 'late: Wednesday 2026-03-11');
select is(pg_temp.chk(1, date '2026-03-12'), 'checked_in', 'late: Thursday 2026-03-12');
select is(pg_temp.dirty(1), '2026-03-09', 'the mark is still the earliest week');
select is(pg_temp.rd(1, '2026-03-24 09:00+01'), '1|1|0|false|null|true|true', 'a plain read after the sync: the settled streak is still 1, needs_settle is true, the ring of the open week is untouched');
select is(pg_temp.rows_of(1), 3, 'and the plain read wrote no fact');
select is(pg_temp.ms_of(1) || '|' || pg_temp.pend(1, '2026-03-24 09:00+01'), '0|null', '30.7: the real check-ins that made the 7th visit day wrote no milestone, and the plain read awards nothing (pending is NULL)');
create temp table sig_b as select pg_temp.sig() as s;
select is(pg_temp.rd(1, '2026-03-24 09:00+01'), '1|1|0|false|null|true|true', 'a second plain read is the same');
select is(pg_temp.sig(), (select s from sig_b), 'and changed nothing');
select is(pg_temp.op(1, '2026-03-24 09:00+01'), '3|3|0|false|null|false|true', 'open_engagement: the streak is 3 and the best is 3');
select is(pg_temp.facts(1), '2026-03-02:1:met:3 2026-03-09:2:met:3 2026-03-16:1:met:3', 'week 2 is revision 2, met, 3 visits');
select is(pg_temp.rows_of(1), 4, 'the ledger grew by exactly one week row (revision 2); revision 1 is still there');
select is(pg_temp.op(1, '2026-03-24 09:05+01'), '3|3|0|false|null|false|true', 'a second open returns the same row');
select is(pg_temp.rows_of(1), 4, 'and writes nothing');
-- The 7th visit day arrived by offline sync after the week was settled: the milestone becomes pending with the open that settled it, exactly once.
select is(pg_temp.ms_of(1) || '|' || pg_temp.pend(1, '2026-03-24 09:10+01'), '1|7', '30.7: the open that settled the offline visits awarded one milestone, and pending_milestone is 7');
select is(pg_temp.pend(1, '2026-03-24 09:10+01'), '7', '30.7: a plain read again: still 7');
select is((select pending_milestone::text from private.open_engagement_at(pg_temp.m(1), '2026-03-24 09:20+01')), '7', '30.7: a third open still reads 7 (pending until acknowledged)');
select is(pg_temp.ms_of(1), 1, '30.7: with a single milestone row');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 1), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
select is(public.acknowledge_milestone(7::smallint), 7::smallint, '30.7: the member acknowledges it');
select is(pg_temp.pend(1, '2026-03-24 09:30+01') || '|' || pg_temp.ms_of(1), 'null|1', '30.7: nothing is pending afterwards, and the next open adds no second milestone');
select is((select pending_milestone::text from private.open_engagement_at(pg_temp.m(1), '2026-03-25 09:30+01')) is null, true, '30.7: a later open reads NULL: the celebration is pending exactly once');
select is((select to_jsonb(d) from private.engagement_derived_state(pg_temp.m(1)) d),
          (select to_jsonb(r) from private.rebuild_engagement(pg_temp.m(1), date '2026-03-24') r), 'the derived state equals the rebuild from attendance (determinism)');

-- ============================================================================
-- Member 2: the late visits sync DURING week 3; the Monday open settles both weeks
-- ============================================================================
select is(pg_temp.chk(2, date '2026-03-02'), 'checked_in', 'member 2, week 1 Monday');
select is(pg_temp.chk(2, date '2026-03-04'), 'checked_in', 'week 1 Wednesday');
select is(pg_temp.chk(2, date '2026-03-06'), 'checked_in', 'week 1 Friday');
select is(pg_temp.op(2, '2026-03-09 08:00+01'), '1|1|0|false|null|false|true', 'Monday 2026-03-09: 1');
select is(pg_temp.op(2, '2026-03-16 08:00+01'), '0|1|0|false|null|false|true', 'Monday 2026-03-16: week 2 missed, 0 (best 1)');
select is(pg_temp.chk(2, date '2026-03-16'), 'checked_in', 'week 3 Monday');
select is(pg_temp.chk(2, date '2026-03-17'), 'checked_in', 'week 3 Tuesday');
select is(pg_temp.chk(2, date '2026-03-18'), 'checked_in', 'week 3 Wednesday');
select is(pg_temp.chk(2, date '2026-03-10'), 'checked_in', 'late, synced on Thursday 2026-03-19 (week 3): a visit recorded in week 2');
select is(pg_temp.chk(2, date '2026-03-11'), 'checked_in', 'late: another');
select is(pg_temp.chk(2, date '2026-03-12'), 'checked_in', 'late: and a third');
select is(pg_temp.rd(2, '2026-03-19 09:00+01'), '0|1|3|true|1|true|true', 'Thursday 2026-03-19: the ring is the open week only (3 of 3), the settled streak is still 0, a settle is due');
select is(pg_temp.op(2, '2026-03-23 08:00+01'), '3|3|0|false|null|false|true', 'Monday 2026-03-23: weeks 2 and 3 settle together: the streak is 3, the best is 3');
select is(pg_temp.facts(2), '2026-03-02:1:met:3 2026-03-09:2:met:3 2026-03-16:1:met:3', 'week 2 is revision 2 met');

-- ============================================================================
-- Member 3: the open happens just after the gym's local Monday midnight, still Sunday by the UTC date
-- ============================================================================
select is(pg_temp.chk(3, date '2026-03-02'), 'checked_in', 'member 3, week 1 Monday');
select is(pg_temp.chk(3, date '2026-03-04'), 'checked_in', 'week 1 Wednesday');
select is(pg_temp.chk(3, date '2026-03-06'), 'checked_in', 'week 1 Friday');
select is(pg_temp.op(3, '2026-03-08 23:30+00'), '1|1|0|false|null|false|true',
          'Sunday 23:30 UTC is Monday 00:30 in Douala: open_engagement settles at the gym-local day, so week 1 is settled (the UTC date would leave it open)');

-- ============================================================================
-- The same through the public pair at the real clock: a plain read changes no row
-- ============================================================================
create temp table sig_c as select pg_temp.sig() as s;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 1), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
select is((select count(*)::int from public.my_engagement()), 1, 'my_engagement answers for member 1 at the real clock');
select is((select needs_settle from public.my_engagement()), true, 'the real clock is months after the journey: weeks have closed that are not yet settled');
select is(pg_temp.sig(), (select s from sig_c), 'and at no point did a plain my_engagement change a row');

select * from finish();
rollback;
