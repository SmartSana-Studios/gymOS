-- Story 30.2: engagement_facts and engagement_state (migration 0185): shape, CHECKs per kind, privileges, cascade delete, the append-only
-- trigger and its two exceptions, and the effective fact (the highest revision).
--
-- Everything here is written as the table owner on purpose: the trigger must refuse the owner and a definer function too, not only a
-- client role (which has no privilege on the tables at all). Fixtures are fixed dates, never the clock.
--
-- Fixture ids: 00000000-0000-0000-0031-00000000nnnn. Gym 1001, users 2001.., members 3001...

begin;
select plan(88);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0031-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'EF Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values (pg_temp.id(1, 1), 'EF Gym', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'ef-' || n || '@x.example', now() from generate_series(1, 8) n;
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(n), pg_temp.id(1, 1), pg_temp.id(2, n), 'member', 'EF Member ' || n, date '2026-01-05' from generate_series(1, 8) n;

-- A week fact, with every column the CHECK looks at spelled out.
create function pg_temp.wk(p_n int, p_week text, p_rev int, p_outcome text, p_goal int, p_visits int) returns text language sql immutable as $f$
  select format($q$insert into engagement_facts (member_id, gym_id, kind, subject_key, revision, outcome, goal, visits)
                   values (%L, %L, 'week', %L, %s, %L, %s, %s)$q$,
                pg_temp.m(p_n), pg_temp.id(1, 1), p_week, p_rev, p_outcome, coalesce(p_goal::text, 'null'), coalesce(p_visits::text, 'null'))
$f$;
create function pg_temp.fact(p_n int, p_kind text, p_subject text, p_outcome text default null) returns text language sql immutable as $f$
  select format($q$insert into engagement_facts (member_id, gym_id, kind, subject_key, outcome) values (%L, %L, %L, %L, %L)$q$,
                pg_temp.m(p_n), pg_temp.id(1, 1), p_kind, p_subject, p_outcome)
$f$;

-- ============================================================================
-- Shape
-- ============================================================================
select has_table('public', 'engagement_facts', 'engagement_facts exists');
select has_table('public', 'engagement_state', 'engagement_state exists');
select col_is_pk('public', 'engagement_facts', array['member_id', 'kind', 'subject_key', 'revision'], 'engagement_facts keys on (member_id, kind, subject_key, revision)');
select col_is_pk('public', 'engagement_state', 'member_id', 'engagement_state keys on member_id');
select columns_are('public', 'engagement_facts',
  array['member_id', 'gym_id', 'kind', 'subject_key', 'revision', 'outcome', 'goal', 'visits', 'silent', 'acknowledged_at', 'detail', 'created_at'],
  'engagement_facts has exactly the twelve columns of AD-53');
select columns_are('public', 'engagement_state', array['member_id', 'gym_id', 'settled_through', 'dirty_from', 'updated_at'],
  'engagement_state has exactly its five columns');
select ok((select relrowsecurity from pg_class where oid = 'public.engagement_facts'::regclass)
          and (select relrowsecurity from pg_class where oid = 'public.engagement_state'::regclass), 'row level security is on for both tables');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('engagement_facts', 'engagement_state')), 0, 'neither table has a policy');
select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.engagement_facts', p)),
  0, 'anon, authenticated and service_role hold no privilege on engagement_facts');
select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, 'public.engagement_state', p)),
  0, 'anon, authenticated and service_role hold no privilege on engagement_state');
select is((select confdeltype::text from pg_constraint where conrelid = 'public.engagement_facts'::regclass and contype = 'f' and confrelid = 'public.members'::regclass), 'c',
          'engagement_facts.member_id cascades on member delete');
select is((select confdeltype::text from pg_constraint where conrelid = 'public.engagement_state'::regclass and contype = 'f' and confrelid = 'public.members'::regclass), 'c',
          'engagement_state.member_id cascades on member delete');
select is((select count(*)::int from public.engagement_facts), 0, 'the ledger starts empty (nothing is written while the epoch is unset)');

-- The epoch guard freezes the epoch for a WEEK fact only: while the ledger holds nothing but a milestone, the epoch still moves (the
-- `kind = 'week'` filter of private.engagement_epoch_guard). The epoch is put back, so the cases below run with it unset as before.
select lives_ok(pg_temp.fact(7, 'milestone', '7'), 'epoch filter: a milestone fact, and no week fact anywhere');
select lives_ok($$update platform_engagement_config set release_week_start = date '2026-03-02'$$, 'epoch filter: the epoch can be set while only a non-week fact exists');
select lives_ok($$update platform_engagement_config set release_week_start = null$$, 'epoch filter: and cleared again');

-- ============================================================================
-- CHECKs per kind
-- ============================================================================
select lives_ok(pg_temp.wk(1, '2026-03-02', 1, 'met', 3, 3), 'a week fact: met, goal 3, 3 visits, on a Monday');
select lives_ok(pg_temp.wk(1, '2026-03-09', 1, 'missed', 7, 0), 'missed, goal 7, zero visits');
select lives_ok(pg_temp.wk(1, '2026-03-16', 1, 'saved', 1, 0), 'saved, goal 1');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'maybe', 3, 3), '23514', null, 'an outcome outside met, missed, saved is refused');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, null, 3, 3), '23514', null, 'a week fact needs an outcome');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'met', 0, 3), '23514', null, 'goal 0 is refused');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'met', 8, 3), '23514', null, 'goal 8 is refused');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'met', null, 3), '23514', null, 'a week fact needs a goal');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'met', 3, -1), '23514', null, 'negative visits are refused');
select throws_ok(pg_temp.wk(1, '2026-03-23', 1, 'met', 3, null), '23514', null, 'a week fact needs a visit count');
select throws_ok(pg_temp.wk(1, '2026-03-24', 1, 'met', 3, 3), '23514', null, 'a subject that is not a Monday is refused');
select throws_ok(pg_temp.wk(1, 'week-12', 1, 'met', 3, 3), '23514', null, 'a subject that is not YYYY-MM-DD is refused');
select throws_ok(pg_temp.wk(1, '2026-3-23', 1, 'met', 3, 3), '23514', null, 'a subject that is not zero-padded is refused');
select throws_ok(pg_temp.wk(1, '2026-03-23', 0, 'met', 3, 3), '23514', null, 'revision 0 is refused');
select throws_ok(pg_temp.wk(1, '2026-03-02', 1, 'met', 3, 3), '23505', null, 'the same (member, kind, subject, revision) twice is a primary key violation');
select throws_ok(pg_temp.fact(1, 'bogus', '1'), '23514', null, 'a kind outside the five of AD-53 is refused');

select lives_ok(pg_temp.fact(2, 'milestone', '7'), 'a milestone fact at 7');
select lives_ok(pg_temp.fact(2, 'milestone', '30'), 'a milestone fact at 30');
select lives_ok(pg_temp.fact(2, 'milestone', '100'), 'a milestone fact at 100');
select throws_ok(pg_temp.fact(2, 'milestone', '8'), '23514', null, 'a milestone subject outside 7, 30, 100 is refused');
select throws_ok(pg_temp.fact(2, 'milestone', '2026-03-02'), '23514', null, 'a milestone keyed by a date is refused');
select throws_ok(pg_temp.fact(2, 'milestone', '7', 'met'), '23514', null, 'a milestone fact has no outcome');
select lives_ok(pg_temp.fact(2, 'day_shield', '2026-03-04'), 'a day_shield fact is accepted (Epic 31 fills it)');
select lives_ok(pg_temp.fact(2, 'badge', 'first-week'), 'a badge fact is accepted');
select lives_ok(pg_temp.fact(2, 'comeback', '2026-03-09'), 'a comeback fact is accepted');

-- ============================================================================
-- Append-only
-- ============================================================================
select lives_ok(pg_temp.wk(3, '2026-03-02', 1, 'missed', 3, 2), 'a fact for the append-only cases');
select throws_ok(format($$update engagement_facts set outcome = 'met' where member_id = %L$$, pg_temp.m(3)), '23514', null, 'an UPDATE of outcome is refused');
select throws_ok(format($$update engagement_facts set visits = 3 where member_id = %L$$, pg_temp.m(3)), '23514', null, 'an UPDATE of visits is refused');
select throws_ok(format($$update engagement_facts set goal = 2 where member_id = %L$$, pg_temp.m(3)), '23514', null, 'an UPDATE of goal is refused');
select throws_ok(format($$update engagement_facts set revision = 2 where member_id = %L$$, pg_temp.m(3)), '23514', null, 'an UPDATE of revision is refused');
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L$$, pg_temp.m(3)), '23514', null, 'acknowledged_at on a week fact is refused');
select throws_ok(format($$delete from engagement_facts where member_id = %L$$, pg_temp.m(3)), '23514', null, 'a DELETE is refused, for the table owner too');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(3) and outcome = 'missed' and visits = 2), 1, 'and the fact is unchanged');

select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'acknowledged_at on a milestone without the flag is refused');
select set_config('app.engagement_acknowledge', 'off', true);
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'and with the flag off');
select set_config('app.engagement_acknowledge', 'on', true);
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'week'$$, pg_temp.m(3)),
                 '23514', null, 'the flag does not open a week fact');
select throws_ok(format($$update engagement_facts set acknowledged_at = now(), silent = true where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'the flag allows acknowledged_at and no other column (silent changed too)');
select throws_ok(format($$update engagement_facts set acknowledged_at = now(), detail = '{"x":1}' where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'nor detail');
select lives_ok(format($$update engagement_facts set acknowledged_at = timestamptz '2026-03-04 10:00+00' where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                'with the flag on, acknowledged_at goes from NULL to a timestamp on a milestone fact');
select is((select acknowledged_at from engagement_facts where member_id = pg_temp.m(2) and kind = 'milestone' and subject_key = '7'), timestamptz '2026-03-04 10:00+00', 'and it is set');
select throws_ok(format($$update engagement_facts set acknowledged_at = null where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'clearing acknowledged_at is refused, flag on');
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'moving an acknowledged_at that is already set is refused, flag on');
select set_config('app.engagement_acknowledge', 'off', true);
select throws_ok(format($$update engagement_facts set acknowledged_at = null where member_id = %L and kind = 'milestone' and subject_key = '7'$$, pg_temp.m(2)),
                 '23514', null, 'clearing acknowledged_at is refused, flag off');
select throws_ok(format($$delete from engagement_facts where member_id = %L and kind = 'milestone'$$, pg_temp.m(2)), '23514', null, 'a milestone fact cannot be deleted either');

-- 30.7: the same flag through the REAL functions. award_milestones writes the fact (the epoch is set with its guard off: week facts of the cases
-- above already exist); acknowledge_milestone is the only writer of acknowledged_at, and leaves the flag off.
alter table platform_engagement_config disable trigger engagement_epoch_guard;
update platform_engagement_config set release_week_start = date '2026-03-02';
alter table platform_engagement_config enable trigger engagement_epoch_guard;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 1), pg_temp.m(n), (d + time '10:00') at time zone 'Africa/Douala', (d + time '10:30') at time zone 'Africa/Douala', 'manual', d
from generate_series(7, 8) n, generate_series(date '2026-03-02', date '2026-03-08', interval '1 day') g(d2), lateral (select g.d2::date as d) x;
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(7)), 'award_milestones writes a milestone fact for a member with seven visit days');
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(8)), 'and for another');
select is((select silent::text || '|' || (acknowledged_at is null)::text from engagement_facts where member_id = pg_temp.m(7) and kind = 'milestone' and subject_key = '7'), 'false|true', 'the fact is not silent and not acknowledged');
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'milestone'$$, pg_temp.m(7)), '23514', null, 'a direct UPDATE of it, with no flag, is refused');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 7), 'role', 'authenticated', 'gym_id', pg_temp.id(1, 1), 'app_role', 'member')::text, true);
select is(public.acknowledge_milestone(7::smallint), 7::smallint, 'acknowledge_milestone sets acknowledged_at through the guard');
select is((select (acknowledged_at is not null)::text from engagement_facts where member_id = pg_temp.m(7) and kind = 'milestone'), 'true', 'it is set');
select is(current_setting('app.engagement_acknowledge', true), 'off', 'and the flag is off again once the function returns');
select throws_ok(format($$update engagement_facts set acknowledged_at = now() where member_id = %L and kind = 'milestone'$$, pg_temp.m(8)), '23514', null, 'so a direct UPDATE of another member''s milestone is still refused after the call');
select is((select (acknowledged_at is null)::text from engagement_facts where member_id = pg_temp.m(8) and kind = 'milestone'), 'true', 'and member 8''s milestone was not touched by member 7''s call');
select throws_ok(format($$delete from engagement_facts where member_id = %L and kind = 'milestone'$$, pg_temp.m(7)), '23514', null, 'an acknowledged milestone cannot be deleted');

-- A new revision is an INSERT, the only way a fact changes.
select lives_ok(pg_temp.wk(3, '2026-03-02', 2, 'met', 3, 3), 'a correction is a new revision');

-- ============================================================================
-- The effective fact: the highest revision
-- ============================================================================
select lives_ok(pg_temp.wk(4, '2026-03-02', 1, 'missed', 3, 1), 'member 4, week 1, revision 1');
select lives_ok(pg_temp.wk(4, '2026-03-02', 2, 'missed', 3, 2), 'revision 2');
select lives_ok(pg_temp.wk(4, '2026-03-02', 3, 'met', 3, 3), 'revision 3');
select lives_ok(pg_temp.wk(4, '2026-03-09', 1, 'missed', 3, 0), 'another subject of the same member');
select is((select string_agg(e.subject_key || ':' || e.revision || ':' || e.outcome || ':' || e.visits, ',' order by e.subject_key) from private.effective_engagement_facts(pg_temp.m(4)) e),
          '2026-03-02:3:met:3,2026-03-09:1:missed:0', 'the effective facts are the highest revision of each subject');
select is((select count(*)::int from private.effective_engagement_facts(pg_temp.m(4))), 2, 'two effective facts from four rows');
select is((select count(*)::int from private.effective_engagement_facts(pg_temp.m(5))), 0, 'a member with no fact has none, and member 4''s facts never appear for member 5');
select is((select string_agg(e.subject_key || ':' || e.revision, ',' order by e.subject_key) from private.effective_engagement_facts(pg_temp.m(3)) e), '2026-03-02:2', 'the correction of member 3 is the effective fact');
select is((select string_agg(e.kind || ':' || e.subject_key, ',' order by e.kind, e.subject_key) from private.effective_engagement_facts(pg_temp.m(2)) e),
          'badge:first-week,comeback:2026-03-09,day_shield:2026-03-04,milestone:100,milestone:30,milestone:7', 'every kind is a subject of its own');

-- ============================================================================
-- Cascade delete: the owning member going away is the one DELETE the trigger allows
-- ============================================================================
insert into engagement_state (member_id, gym_id, settled_through, dirty_from) values (pg_temp.m(6), pg_temp.id(1, 1), date '2026-03-02', date '2026-03-09');
select lives_ok(pg_temp.wk(6, '2026-03-02', 1, 'met', 3, 3), 'member 6 has a fact and a state row');
select lives_ok(pg_temp.fact(6, 'milestone', '7'), 'and a milestone');
select lives_ok(format($$delete from members where id = %L$$, pg_temp.m(6)), 'deleting the member is not blocked by the append-only guard');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(6)) + (select count(*)::int from engagement_state where member_id = pg_temp.m(6)), 0,
          'the member''s facts and state row are gone with them');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(4)), 4, 'and no other member lost a row');

-- ============================================================================
-- Privileges of the functions this migration adds
-- ============================================================================
select is(
  (select count(*)::int
   from unnest(array[
     'private.engagement_facts_append_only_guard()', 'private.engagement_epoch_guard()', 'private.effective_engagement_facts(uuid)',
     'private.engagement_fold_weeks(jsonb)', 'private.engagement_fold(uuid)', 'private.engagement_evaluate_weeks(uuid, uuid, date, date)',
     'private.settle_engagement(uuid, uuid, date)', 'private.engagement_derived_state(uuid)', 'private.rebuild_engagement(uuid, date)'
   ]) f, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
   where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'none of the nine functions is executable by anon, authenticated, service_role or PUBLIC');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname ~ 'engagement' and proname not in ('set_weekly_goal', 'my_engagement', 'open_engagement')), 0,
          'no engagement function lives in the public schema except the member pair my_engagement and open_engagement (30.3)');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'engagement'), 0, 'none is registered as a support capability');

select * from finish();
rollback;
