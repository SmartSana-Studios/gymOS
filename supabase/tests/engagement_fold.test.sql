-- Story 30.2: private.engagement_fold(member) and the arithmetic under it (migration 0185).
--
-- The fold reads effective week facts only. Facts are inserted directly as the table owner (the fold does not care who wrote them), so every
-- case is a plain sequence of outcomes. Weeks are consecutive Mondays from 2026-03-02 unless a case says otherwise.
--
-- Fixture ids: 00000000-0000-0000-0032-00000000nnnn.

begin;
select plan(38);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0032-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'FO Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values (pg_temp.id(1, 1), 'FO Gym', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'fo-' || n || '@x.example', now() from generate_series(1, 30) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, 1), pg_temp.id(2, n), 'member', 'FO Member ' || n, date '2026-01-05' from generate_series(1, 30) n;

-- Consecutive weeks from p_start, one outcome each (revision 1, goal 3, visits 3 for met and 0 otherwise: the fold ignores both).
create function pg_temp.seq(p_n int, p_outcomes text[], p_start date default date '2026-03-02') returns void language plpgsql as $f$
declare i int;
begin
  for i in 1 .. array_length(p_outcomes, 1) loop
    insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
    values (pg_temp.m(p_n), pg_temp.id(1, 1), 'week', to_char(p_start + 7 * (i - 1), 'YYYY-MM-DD'), 1, p_outcomes[i], 3, case when p_outcomes[i] = 'met' then 3 else 0 end);
  end loop;
end $f$;

create function pg_temp.fold(p_n int) returns text language sql stable as $f$
  select format('%s|%s|%s|%s|%s', f.streak_weeks, f.best_streak_weeks, coalesce(f.last_settled_week::text, '-'), f.shields_held, f.comeback_state)
  from private.engagement_fold(pg_temp.m(p_n)) f
$f$;

-- ============================================================================
-- Shape
-- ============================================================================
select has_function('private', 'engagement_fold', array['uuid']::name[], 'private.engagement_fold(uuid) exists');
select volatility_is('private', 'engagement_fold', array['uuid']::name[], 'stable', 'the fold is STABLE');
select isnt_definer('private', 'engagement_fold', array['uuid']::name[], 'the fold is SECURITY INVOKER (nothing client-callable reaches it)');
select function_returns('private', 'engagement_fold', array['uuid']::name[], 'setof record', 'it returns a row type (streak, best, last week, shields, comeback)');
select ok(
  (select prosrc !~* '(attendance|member_visit_days|platform_engagement_config|member_weekly_goals|now\(\)|current_date|current_timestamp|clock_timestamp|gym_today)'
     and prosrc !~* 'engagement_state'
   from pg_proc where oid = 'private.engagement_fold(uuid)'::regprocedure)
  and (select prosrc !~* '(attendance|member_visit_days|platform_engagement_config|member_weekly_goals|now\(\)|current_date|current_timestamp|clock_timestamp|gym_today|engagement_facts)'
       from pg_proc where oid = 'private.engagement_fold_weeks(jsonb)'::regprocedure),
  'the fold and its arithmetic read facts only: no attendance, no config, no goal history, no clock');

-- ============================================================================
-- The arithmetic
-- ============================================================================
select is(pg_temp.fold(1), '0|0|-|0|none', 'no fact: a zero run, no last week, no shields, comeback none');
select pg_temp.seq(2, array['met']);
select is(pg_temp.fold(2), '1|1|2026-03-02|0|none', 'one met week: run 1, best 1');
select pg_temp.seq(3, array['met', 'met', 'met']);
select is(pg_temp.fold(3), '3|3|2026-03-16|0|none', 'three met weeks in a row: run 3, best 3, last week is the Monday of the last fact');
select pg_temp.seq(4, array['met', 'met', 'missed']);
select is(pg_temp.fold(4), '0|2|2026-03-16|0|none', 'a missed week sets the run to 0 and best stays 2');
select pg_temp.seq(5, array['missed']);
select is(pg_temp.fold(5), '0|0|2026-03-02|0|none', 'a missed first week: nothing to protect');
select pg_temp.seq(6, array['met', 'met', 'missed', 'met']);
select is(pg_temp.fold(6), '1|2|2026-03-23|0|none', 'regained streak: met, met, missed, met gives run 1 and best 2');
select pg_temp.seq(7, array['met', 'met', 'met', 'missed', 'met', 'met']);
select is(pg_temp.fold(7), '2|3|2026-04-06|0|none', 'a shorter later run does not lower best (3 then 2)');
select pg_temp.seq(8, array['met', 'met', 'met', 'missed', 'met', 'met', 'met', 'met']);
select is(pg_temp.fold(8), '4|4|2026-04-20|1|none', 'a longer later run raises best (and its fourth met week stored a Shield)');

-- A gap: a week that is not the Monday after the previous one restarts the run, whatever its outcome.
select pg_temp.seq(9, array['met', 'met']);
select pg_temp.seq(9, array['met'], date '2026-03-23');
select is(pg_temp.fold(9), '1|2|2026-03-23|0|none', 'a gap (week 2026-03-16 has no fact) restarts the run: met, met, gap, met gives run 1, best 2');
select pg_temp.seq(10, array['met']);
select pg_temp.seq(10, array['met', 'met'], date '2026-03-23');
select is(pg_temp.fold(10), '2|2|2026-03-30|0|none', 'after a gap the run counts again from the first week after it');
select pg_temp.seq(11, array['met', 'met']);
select pg_temp.seq(11, array['saved'], date '2026-03-23');
select is(pg_temp.fold(11), '0|2|2026-03-23|0|none', 'a saved week after a gap does not carry the run over the gap');

-- saved: the run is unchanged and nothing is added.
select pg_temp.seq(12, array['met', 'met', 'saved']);
select is(pg_temp.fold(12), '2|2|2026-03-16|0|none', 'a saved week keeps the run at 2 and adds nothing');
select pg_temp.seq(13, array['met', 'met', 'saved', 'met']);
select is(pg_temp.fold(13), '3|3|2026-03-23|0|none', 'met, met, saved, met: the saved week keeps the run, the next met makes 3');
select pg_temp.seq(14, array['saved']);
select is(pg_temp.fold(14), '0|0|2026-03-02|0|none', 'a saved first week adds nothing: run 0, best 0');
select pg_temp.seq(15, array['met', 'saved', 'saved', 'missed']);
select is(pg_temp.fold(15), '0|1|2026-03-23|0|none', 'saved weeks never add and a missed week after them ends the run (best 1)');

-- best never decreases as weeks are added.
select pg_temp.seq(16, array['met', 'met', 'met']);
select is(pg_temp.fold(16), '3|3|2026-03-16|0|none', 'best 3 after three met weeks');
select pg_temp.seq(16, array['missed'], date '2026-03-23');
select is(pg_temp.fold(16), '0|3|2026-03-23|0|none', 'a missed week added after: best is still 3');
select pg_temp.seq(16, array['missed', 'missed'], date '2026-03-30');
select is(pg_temp.fold(16), '0|3|2026-04-06|0|none', 'more missed weeks: best is still 3');

-- The effective revision is the one folded.
select pg_temp.seq(17, array['met', 'missed']);
select is(pg_temp.fold(17), '0|1|2026-03-09|0|none', 'revision 1: met, missed');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
values (pg_temp.m(17), pg_temp.id(1, 1), 'week', '2026-03-09', 2, 'met', 3, 3);
select is(pg_temp.fold(17), '2|2|2026-03-09|0|none', 'revision 2 of the second week (a late visit) is what the fold uses: met, met');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
values (pg_temp.m(17), pg_temp.id(1, 1), 'week', '2026-03-09', 3, 'missed', 3, 2);
select is(pg_temp.fold(17), '0|1|2026-03-09|0|none', 'and revision 3 over it, whatever the order the rows were written');

-- Synthetic facts of the kinds Epic 31 will write: the fold neither errors nor miscounts.
select pg_temp.seq(18, array['met', 'met', 'met']);
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
values (pg_temp.m(18), pg_temp.id(1, 1), 'week', '2026-03-23', 1, 'saved', 3, 1);
select is(pg_temp.fold(18), '3|3|2026-03-23|0|none', 'a synthetic saved fact inserted as the owner: the run stays 3 and shields_held is still 0');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) values (pg_temp.m(18), pg_temp.id(1, 1), 'comeback', '2026-03-30', 1);
select is(pg_temp.fold(18), '3|3|2026-03-23|0|none', 'a synthetic comeback fact: ignored, comeback_state stays none');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) values
  (pg_temp.m(18), pg_temp.id(1, 1), 'day_shield', '2026-03-24', 1),
  (pg_temp.m(18), pg_temp.id(1, 1), 'badge', 'first-week', 1),
  (pg_temp.m(18), pg_temp.id(1, 1), 'milestone', '7', 1),
  (pg_temp.m(18), pg_temp.id(1, 1), 'milestone', '30', 1);
select is(pg_temp.fold(18), '3|3|2026-03-23|0|none', 'day_shield, badge and milestone facts are accepted and ignored');
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) values
  (pg_temp.m(19), pg_temp.id(1, 1), 'milestone', '7', 1),
  (pg_temp.m(19), pg_temp.id(1, 1), 'comeback', '2026-03-09', 1);
select is(pg_temp.fold(19), '0|0|-|0|none', 'a member with only non-week facts has a zero fold');
select pg_temp.seq(20, array['met', 'met']);
insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) values (pg_temp.m(20), pg_temp.id(1, 1), 'comeback', '2026-03-16', 1);
select is(pg_temp.fold(20), '2|2|2026-03-09|0|none', 'a comeback fact on a later Monday does not move last_settled_week (only week facts do)');

-- Another member's facts never reach this member's fold.
select pg_temp.seq(21, array['met', 'met', 'met', 'met']);
select is(pg_temp.fold(22), '0|0|-|0|none', 'a member next to a member with a four-week run still has none');

-- The fold's own rows: one row always, typed columns.
select is((select count(*)::int from private.engagement_fold(pg_temp.m(22))), 1, 'the fold returns exactly one row, even for a member with no fact');
select is((select count(*)::int from private.engagement_fold(pg_temp.m(8))), 1, 'and for a member with eight');
select is((select count(*)::int from private.engagement_fold(null)), 1, 'and for a NULL member (an empty fold, not an error)');

-- The arithmetic on its own, on a hand-written week list.
select is((select h.streak_weeks || '|' || h.best_streak_weeks || '|' || coalesce(h.last_settled_week::text, '-')
           from private.engagement_fold_weeks('[{"week":"2026-03-02","outcome":"met"},{"week":"2026-03-09","outcome":"met"},{"week":"2026-03-23","outcome":"met"}]'::jsonb) h),
          '1|2|2026-03-23', 'engagement_fold_weeks follows the array order and detects the gap');
select is((select h.streak_weeks || '|' || h.best_streak_weeks || '|' || coalesce(h.last_settled_week::text, '-')
           from private.engagement_fold_weeks('[]'::jsonb) h), '0|0|-', 'engagement_fold_weeks of an empty list');
select is((select h.streak_weeks || '|' || h.best_streak_weeks || '|' || coalesce(h.last_settled_week::text, '-')
           from private.engagement_fold_weeks(null) h), '0|0|-', 'and of NULL');

select * from finish();
rollback;
