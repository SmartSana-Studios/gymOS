-- Story 31.3 (FR-230, FR-225, FR-232, NFR-028; AD-53): the badge facts, the release back-fill and public.get_my_badges() (migration 0192).
--
-- Proves, in the order of the story: the release back-fill (members at 0, 1, 6, 7, 29, 30, 99, 100 and 250 visit days get the exact silent sets
-- with the stored dates, never four_weeks, a second run inserts nothing, and it writes while the epoch is NULL); that the award stays dark while
-- the epoch is NULL; the award step (first visit, 7th, 30th, 100th day, the fourth met week, silent when the nth day is before the epoch, one row
-- per badge however often settle runs, no second celebration, a late offline visit awarded on the next settle with the true date, a void that
-- never removes a badge or changes earned_on); get_my_badges (always five rows in shelf order with the progress, the caller's own rows only, the
-- caller matrix, a plain read never awards and writes nothing); the shape and the grants of every function 0192 created (none anon-executable);
-- and the gates, each shown failing against a mutant: only award_milestones and the back-fill write a badge, only settle calls the award, the
-- check-in paths name neither, no function deletes a fact, the append-only guard refuses a badge update and delete, and a badge grants nothing
-- (the loyalty ledger, stamps, guest sessions, plans and subscriptions keep their row counts across every award in this file).
--
-- Time never comes from the clock: p_up_to is a fixed date in every call and every visit day is explicit. Gym A is Africa/Douala (UTC+1, no DST).
-- Fixture ids: 00000000-0000-0000-0046-00000000nnnn. Gym 1 (A, active), 2 (B, active), 3 (S, suspended); users 2xxx; members 3xxx.

begin;
select plan(121);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0046-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- One statement run as a database role, returning its first value or sqlstate:message.
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
-- The caller's five rows as one line: code:earned:earned_on:silent:visits_remaining:weeks_progress, '-' for NULL, in the order the function returned them.
create function pg_temp.q() returns text language sql as $f$
  select $q$select string_agg(t.code || ':' || t.earned::text || ':' || coalesce(t.earned_on::text, '-') || ':' || coalesce(t.silent::text, '-') || ':'
                              || coalesce(t.visits_remaining::text, '-') || ':' || coalesce(t.weeks_progress::text, '-'), ' ' order by t.ord)
            from public.get_my_badges() with ordinality as t(code, earned, earned_on, silent, visits_remaining, weeks_progress, ord)$q$
$f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'BD Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'BD Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'BD Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'BD Gym S', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'bd-' || n || '@x.example', now() from generate_series(1, 40) n;
-- 1 owner, 2 receptionist, 3 support person (a user with NO member row), 4 deactivated member, 5 member of the suspended gym, 6 member of gym B,
-- 10 to 18 the back-fill members (0, 1, 6, 7, 29, 30, 99, 100, 250 visit days), 19 a member with one visit while dark, 20 to 29 the award members.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, case when n = 5 then 3 when n = 6 then 2 else 1 end), pg_temp.id(2, n),
       (case n when 1 then 'owner' when 2 then 'receptionist' else 'member' end)::member_role,
       'BD Member ' || n, date '2026-01-05', case when n = 4 then now() end
from generate_series(1, 40) n where n <> 3 and (n <= 6 or n between 10 and 29);

-- p_count consecutive counted visit days from p_from.
create function pg_temp.days(p_n int, p_from date, p_count int) returns void language sql as $f$
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_from + g + time '10:00') at time zone 'Africa/Douala', (p_from + g + time '10:30') at time zone 'Africa/Douala', 'manual', (p_from + g)
  from members m, generate_series(0, p_count - 1) g where m.id = pg_temp.m(p_n)
$f$;
create function pg_temp.void(p_n int, p_day date) returns void language sql as $f$
  update attendance_events set voided_at = timestamptz '2026-03-10 12:00+00', voided_by = pg_temp.id(2, p_n), void_reason = 'test void on the same day'
  where member_id = pg_temp.m(p_n) and visit_day = p_day
$f$;
create function pg_temp.settle(p_n int, p_up_to date) returns integer language sql as $f$
  select private.settle_engagement(pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_up_to)
$f$;
create function pg_temp.mark_dirty(p_n int, p_week date) returns void language sql as $f$
  insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_week)
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)
$f$;
-- The effective badge facts: "code@earned_on/s|n" (s silent, n not silent) in shelf order, '-' for none.
create function pg_temp.bset(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(e.subject_key || '@' || (e.detail ->> 'earned_on') || '/' || case when e.silent then 's' else 'n' end, ' '
                             order by array_position(array['first_visit', 'visits_7', 'visits_30', 'visits_100', 'four_weeks'], e.subject_key)), '-')
  from private.effective_engagement_facts(pg_temp.m(p_n)) e where e.kind = 'badge'
$f$;
create function pg_temp.nbadge(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'badge' $f$;
create function pg_temp.nfact(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) $f$;
create function pg_temp.pending(p_n int) returns smallint language sql stable as $f$
  select v.pending_milestone from private.engagement_state_view_at(pg_temp.m(p_n), timestamptz '2026-07-01 12:00+00') v
$f$;
create function pg_temp.d(p_from date, p_add int) returns text language sql immutable as $f$ select (p_from + p_add)::text $f$;

-- Counts that must never move: the loyalty ledger, stamps, guest sessions, plans and subscriptions (a badge grants nothing).
create temp table grants_before as
  select (select count(*) from loyalty_events) as events, (select count(*) from loyalty_progress) as progress, (select count(*) from guest_sessions) as guests,
         (select count(*) from plans) as plans, (select count(*) from subscriptions) as subs;

-- ============================================================================
-- Shape and privileges of everything 0192 created
-- ============================================================================
select has_function('public', 'get_my_badges', '{}'::name[], 'public.get_my_badges() exists');
select is(pg_get_function_result('public.get_my_badges()'::regprocedure), 'TABLE(code text, earned boolean, earned_on date, silent boolean, visits_remaining integer, weeks_progress integer)', 'it returns the six columns of the story');
select is((select pronargs::int from pg_proc where oid = 'public.get_my_badges()'::regprocedure), 0, 'it takes no argument: no member id to forge');
select is((select prosecdef from pg_proc where oid = 'public.get_my_badges()'::regprocedure), true, 'it is SECURITY DEFINER');
select is((select provolatile::text from pg_proc where oid = 'public.get_my_badges()'::regprocedure), 's', 'it is STABLE (a read)');
select is((select proconfig from pg_proc where oid = 'public.get_my_badges()'::regprocedure), array['search_path=public'], 'it pins its search_path');
select is((select has_function_privilege('authenticated', 'public.get_my_badges()', 'execute')), true, 'authenticated can execute it');
select is((select count(*)::int from unnest(array['anon', 'service_role', 'public']) r where has_function_privilege(r, 'public.get_my_badges()', 'execute')), 0, 'anon, service_role and PUBLIC cannot');
select is(
  (select count(*)::int from unnest(array['private.engagement_first_shield_week(uuid)', 'private.backfill_badges()', 'private.award_milestones(uuid)',
                                          'private.engagement_derived_state(uuid)', 'private.rebuild_engagement(uuid, date)']) f,
          unnest(array['anon', 'authenticated', 'service_role', 'public']) r where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'no function 0192 created or replaced in private is executable by any client role');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('get_my_badges', 'backfill_badges', 'engagement_first_shield_week') and has_function_privilege('anon', p.oid, 'execute')),
  0, 'every function this story created is anon-unexecutable');
select is((select p.prosrc !~* 'attendance_events' from pg_proc p where p.oid = 'public.get_my_badges()'::regprocedure), true, 'get_my_badges never names the raw attendance table');
select is((select p.prosrc !~* '(insert\s+into|update\s+\w|delete\s+from|set_config|perform\s+private\.)' from pg_proc p where p.oid = 'public.get_my_badges()'::regprocedure), true, 'its source writes nothing and performs nothing');
select is((select p.prosrc !~* 'award_milestones' from pg_proc p where p.oid = 'public.get_my_badges()'::regprocedure), true, 'and never names the award');
select is((select p.prosrc !~* 'attendance_events' from pg_proc p where p.oid = 'private.award_milestones(uuid)'::regprocedure), true, 'award_milestones never names the raw attendance table (comments included)');
select is((select prosecdef from pg_proc where oid = 'private.award_milestones(uuid)'::regprocedure), true, 'award_milestones is still SECURITY DEFINER');
select is((select pg_get_function_result('private.engagement_derived_state(uuid)'::regprocedure) ~ 'badges jsonb\)$'), true, 'engagement_derived_state ends with badges jsonb');
select is((select pg_get_function_result('private.rebuild_engagement(uuid, date)'::regprocedure) ~ 'badges jsonb\)$'), true, 'rebuild_engagement ends with badges jsonb');
select is((select count(*)::int from private.support_capabilities where object_name ~* 'badge'), 0, 'no badge function is a support capability');

-- ============================================================================
-- The release back-fill (the epoch is NULL: production is live and dark). Members at 0, 1, 6, 7, 29, 30, 99, 100 and 250 visit days.
-- ============================================================================
select is((select release_week_start from platform_engagement_config), null::date, 'the epoch is NULL while the back-fill runs');
select pg_temp.days(11, date '2025-01-01', 1);
select pg_temp.days(12, date '2025-01-01', 6);
select pg_temp.days(13, date '2025-01-01', 7);
select pg_temp.days(14, date '2025-01-01', 29);
select pg_temp.days(15, date '2025-01-01', 30);
select pg_temp.days(16, date '2025-01-01', 99);
select pg_temp.days(17, date '2025-01-01', 100);
select pg_temp.days(18, date '2025-01-01', 250);
select pg_temp.days(6, date '2026-03-02', 2);
select is((select count(*)::int from engagement_facts where member_id in (select pg_temp.m(n) from generate_series(6, 18) n)), 0, 'before the back-fill no fact exists for the fixture members');
select cmp_ok(private.backfill_badges(), '>=', 21, 'the back-fill writes the 21 badges of the fixture members (and any a real member of this database still lacked)');
select is(pg_temp.bset(10), '-', 'back-fill 0 visit days: no badge');
select is(pg_temp.bset(11), 'first_visit@2025-01-01/s', 'back-fill 1 visit day: first_visit, silent, on the real date');
select is(pg_temp.bset(12), 'first_visit@2025-01-01/s', 'back-fill 6 visit days: first_visit only');
select is(pg_temp.bset(13), 'first_visit@2025-01-01/s visits_7@2025-01-07/s', 'back-fill 7 visit days: first_visit and visits_7, the 7th on the 7th day');
select is(pg_temp.bset(14), 'first_visit@2025-01-01/s visits_7@2025-01-07/s', 'back-fill 29 visit days: still only two');
select is(pg_temp.bset(15), 'first_visit@2025-01-01/s visits_7@2025-01-07/s visits_30@2025-01-30/s', 'back-fill 30 visit days: visits_30 on the 30th day');
select is(pg_temp.bset(16), 'first_visit@2025-01-01/s visits_7@2025-01-07/s visits_30@2025-01-30/s', 'back-fill 99 visit days: no visits_100');
select is(pg_temp.bset(17), 'first_visit@2025-01-01/s visits_7@2025-01-07/s visits_30@2025-01-30/s visits_100@' || pg_temp.d(date '2025-01-01', 99) || '/s', 'back-fill 100 visit days: visits_100 on the 100th day');
select is(pg_temp.bset(18), pg_temp.bset(17), 'back-fill 250 visit days: the same four, the dates of the 1st, 7th, 30th and 100th day (not the 250th)');
select is((select count(*)::int from engagement_facts where member_id in (select pg_temp.m(n) from generate_series(10, 18) n) and kind = 'badge' and subject_key = 'four_weeks'), 0, 'back-fill never writes four_weeks');
select is((select count(*)::int from engagement_facts where member_id in (select pg_temp.m(n) from generate_series(10, 18) n) and kind <> 'badge'), 0, 'back-fill writes no milestone, week or any other fact: no celebration is created');
select is((select count(*)::int from engagement_facts where member_id in (select pg_temp.m(n) from generate_series(10, 18) n) and kind = 'badge' and (not silent or revision <> 1 or acknowledged_at is not null or outcome is not null)), 0, 'every back-filled row is silent, revision 1, unacknowledged and has no outcome');
select is(private.backfill_badges(), 0, 'a second run of the back-fill inserts nothing');
select is((select count(*)::int from engagement_facts where member_id in (select pg_temp.m(n) from generate_series(10, 18) n) and kind = 'badge'), 0 + 1 + 1 + 2 + 2 + 3 + 3 + 4 + 4, 'and the badge rows are exactly 1+1+2+2+3+3+4+4');
select is((select count(*)::int from engagement_state where member_id in (select pg_temp.m(n) from generate_series(10, 18) n)), 0, 'the back-fill touched no watermark (it takes no member lock and marks nothing)');

-- Dark: the award and the settle write nothing while the epoch is NULL.
select pg_temp.days(19, date '2026-03-02', 1);
select is(pg_temp.settle(19, date '2026-03-20'), 0, 'dark: settle writes nothing');
select is(pg_temp.nfact(19), 0, 'dark: no badge or other fact for a member with a visit after the back-fill');
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(19)), 'dark: award_milestones returns');
select is(pg_temp.nfact(19), 0, 'dark: and still wrote nothing');
select pg_temp.claims(13, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2025-01-01:true:-:- visits_7:true:2025-01-07:true:-:- visits_30:false:-:-:23:- visits_100:false:-:-:93:- four_weeks:false:-:-:-:0',
          'dark: get_my_badges still returns five rows (the back-fill is visible, progress from the visit days, weeks_progress 0)');

-- ============================================================================
-- Lit: the epoch is set. The award step.
-- ============================================================================
update platform_engagement_config set release_week_start = date '2026-03-02';

-- First visit only.
select pg_temp.days(20, date '2026-03-03', 1);
select is(pg_temp.settle(20, date '2026-03-04'), 0, 'first visit: settle writes no week');
select is(pg_temp.bset(20), 'first_visit@2026-03-03/n', 'first visit: first_visit, not silent, earned on the visit day');
select is(pg_temp.nfact(20), 1, 'first visit: nothing else is written');
select is(pg_temp.pending(20), null::smallint, 'first visit: no celebration is pending');
select is(pg_temp.settle(20, date '2026-03-04'), 0, 'first visit: a second settle');
select is(pg_temp.nbadge(20), 1, 'first visit: still one badge row (idempotent)');

-- 7th day: the badge and the Epic 30 milestone, one celebration.
select pg_temp.days(21, date '2026-03-02', 7);
select pg_temp.settle(21, date '2026-03-09');
select is(pg_temp.bset(21), 'first_visit@2026-03-02/n visits_7@2026-03-08/n', 'day 7: first_visit and visits_7, earned on the 7th visit day');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(21) and kind = 'milestone'), 1, 'day 7: and the one milestone fact of Epic 30');
select is(pg_temp.pending(21), 7::smallint, 'day 7: exactly one celebration is pending (the milestone, not the badge)');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(21) and kind = 'badge' and (outcome is not null or acknowledged_at is not null or revision <> 1)), 0, 'day 7: a badge has no outcome, no acknowledgement and revision 1');
select is((select detail from engagement_facts where member_id = pg_temp.m(21) and kind = 'badge' and subject_key = 'visits_7'), '{"earned_on": "2026-03-08"}'::jsonb, 'day 7: earned_on lives in detail as a date string');
create function pg_temp.nawards(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind in ('badge', 'milestone') $f$;
select pg_temp.settle(21, date '2026-03-09');
select pg_temp.settle(21, date '2026-03-16');
select is(pg_temp.nawards(21), 3, 'day 7: two more settles leave exactly three rows: the first_visit and visits_7 badges and the 7 milestone, no second of any');

-- 30th day.
select pg_temp.days(22, date '2026-03-02', 30);
select pg_temp.settle(22, date '2026-04-06');
select is(pg_temp.bset(22), 'first_visit@2026-03-02/n visits_7@2026-03-08/n visits_30@2026-03-31/n four_weeks@2026-03-29/n', 'day 30: visits_30 on the 30th visit day (thirty daily visits also make four met weeks, so four_weeks too)');
select is((select string_agg(f.subject_key, ' ' order by f.subject_key::int) from engagement_facts f where f.member_id = pg_temp.m(22) and f.kind = 'milestone'), '7 30', 'day 30: the milestones are the Epic 30 ones, 7 and 30');
select is(pg_temp.pending(22), 30::smallint, 'day 30: one celebration, the highest');

-- 100th day and four_weeks: all five badges. The counts that must not move are compared at the end of the file.
select pg_temp.days(23, date '2026-03-02', 100);
select pg_temp.settle(23, date '2026-06-15');
select is(pg_temp.bset(23), 'first_visit@2026-03-02/n visits_7@2026-03-08/n visits_30@2026-03-31/n visits_100@2026-06-09/n four_weeks@2026-03-29/n',
          'day 100: all five badges, the visit ones on their nth day and four_weeks on the Sunday of the fourth met week');
select is(pg_temp.pending(23), 100::smallint, 'day 100: still one celebration pending, the 100');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(23) and kind = 'milestone'), 3, 'day 100: three milestone facts, as in Epic 30');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(23) and kind = 'badge'), 5, 'day 100: five badge rows');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(23) and kind not in ('week', 'milestone', 'badge', 'comeback')), 0, 'day 100: no Shield, stamp or other fact beside the weeks, milestones, badges and comebacks');
create temp table n23 as select pg_temp.nfact(23) as n;
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(23)), 'day 100: awarding again directly');
select is(pg_temp.nfact(23), (select n from n23), 'day 100: inserts nothing');

-- Silent: the 7th visit day is before the epoch.
select pg_temp.days(24, date '2026-02-20', 7);
select pg_temp.settle(24, date '2026-03-09');
select is(pg_temp.bset(24), 'first_visit@2026-02-20/s visits_7@2026-02-26/s', 'before the epoch: both badges are silent, on their real dates');
select is(pg_temp.pending(24), null::smallint, 'before the epoch: no celebration is pending');

-- A void never removes a badge or changes earned_on; a later visit inserts nothing.
select pg_temp.days(25, date '2026-03-02', 7);
select pg_temp.settle(25, date '2026-03-09');
select is(pg_temp.bset(25), 'first_visit@2026-03-02/n visits_7@2026-03-08/n', 'void: visits_7 earned on 2026-03-08');
select pg_temp.void(25, date '2026-03-08');
select pg_temp.mark_dirty(25, date '2026-03-02');
select pg_temp.settle(25, date '2026-03-09');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(25)), 6, 'void: the member is back to six visit days');
select is(pg_temp.bset(25), 'first_visit@2026-03-02/n visits_7@2026-03-08/n', 'void: the badge row and its earned_on are unchanged');
select pg_temp.days(25, date '2026-03-10', 1);
select pg_temp.mark_dirty(25, date '2026-03-02');
select pg_temp.settle(25, date '2026-03-16');
select is((select d.visit_day::text from member_visit_days d where d.member_id = pg_temp.m(25) order by d.visit_day offset 6 limit 1), '2026-03-10', 'void: back at seven days, the recomputed 7th visit day is 2026-03-10');
select is(pg_temp.bset(25), 'first_visit@2026-03-02/n visits_7@2026-03-08/n', 'void: a stored earned_on wins over the recomputed one, and nothing was reinserted');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(25) and kind = 'badge' and revision <> 1), 0, 'void: every badge row is revision 1');

-- A late offline visit: six days settled, then a visit for an earlier day arrives and makes seven. get_my_badges before the settle never awards.
select pg_temp.days(26, date '2026-03-02', 5);
select pg_temp.days(26, date '2026-03-09', 1);
select pg_temp.settle(26, date '2026-03-12');
select is(pg_temp.bset(26), 'first_visit@2026-03-02/n', 'late visit: six days hold first_visit only');
select pg_temp.days(26, date '2026-03-07', 1);
create temp table snap_state as select * from engagement_state;
create temp table snap_facts as select * from engagement_facts;
create function pg_temp.same_tables() returns boolean language sql stable as $f$
  select (select count(*) from (select * from engagement_state except select * from snap_state) x) = 0
     and (select count(*) from (select * from snap_state except select * from engagement_state) x) = 0
     and (select count(*) from (select * from engagement_facts except select * from snap_facts) x) = 0
     and (select count(*) from (select * from snap_facts except select * from engagement_facts) x) = 0
$f$;
select pg_temp.claims(26, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2026-03-02:false:-:- visits_7:false:-:-:0:- visits_30:false:-:-:23:- visits_100:false:-:-:93:- four_weeks:false:-:-:-:1',
          'late visit: seven visit days but not yet settled: visits_7 is unearned, remaining 0 (never negative), one met week of progress, and a read awards nothing');
select is(pg_temp.same_tables(), true, 'late visit: get_my_badges wrote nothing (engagement_facts and engagement_state identical, contents included)');
select pg_temp.mark_dirty(26, date '2026-03-02');
select pg_temp.settle(26, date '2026-03-12');
select is(pg_temp.bset(26), 'first_visit@2026-03-02/n visits_7@2026-03-09/n', 'late visit: the next settle awards visits_7 with the true date of the 7th visit day');

-- four_weeks: progress then the badge.
select pg_temp.days(27, date '2026-03-02', 3);
select pg_temp.days(27, date '2026-03-09', 3);
select pg_temp.days(27, date '2026-03-16', 3);
select pg_temp.days(27, date '2026-03-23', 3);
select pg_temp.settle(27, date '2026-03-16');
select pg_temp.claims(27, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2026-03-02:false:-:- visits_7:true:2026-03-16:false:-:- visits_30:false:-:-:18:- visits_100:false:-:-:88:- four_weeks:false:-:-:-:2',
          'four weeks: two closed met weeks show weeks_progress 2 (twelve visit days in all: visits_7 earned, 18 and 88 to go)');
select pg_temp.settle(27, date '2026-03-23');
select is(pg_temp.asrole('authenticated', $$select weeks_progress::text from public.get_my_badges() where code = 'four_weeks'$$), '3', 'four weeks: three closed met weeks show weeks_progress 3');
select is(pg_temp.bset(27) ~ 'four_weeks', false, 'four weeks: no badge before the fourth met week closes');
select pg_temp.settle(27, date '2026-03-30');
select is(pg_temp.bset(27), 'first_visit@2026-03-02/n visits_7@2026-03-16/n four_weeks@2026-03-29/n', 'four weeks: the fourth met week earns it on that week''s Sunday, silent false');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2026-03-02:false:-:- visits_7:true:2026-03-16:false:-:- visits_30:false:-:-:18:- visits_100:false:-:-:88:- four_weeks:true:2026-03-29:false:-:-',
          'four weeks: the earned row carries no progress; the unearned visit badges carry the remaining visits');
select is(pg_temp.pending(27), 7::smallint, 'four weeks: the only pending celebration is still the 7 milestone, never the badge');

-- ============================================================================
-- get_my_badges: the caller matrix and own rows only
-- ============================================================================
delete from snap_state;
insert into snap_state select * from engagement_state;
delete from snap_facts;
insert into snap_facts select * from engagement_facts;
select pg_temp.claims(10, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:false:-:-:-:- visits_7:false:-:-:7:- visits_30:false:-:-:30:- visits_100:false:-:-:100:- four_weeks:false:-:-:-:0',
          'a new member with no visit gets five unearned rows with progress, never an empty set');
select pg_temp.claims(13, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2025-01-01:true:-:- visits_7:true:2025-01-07:true:-:- visits_30:false:-:-:23:- visits_100:false:-:-:93:- four_weeks:false:-:-:-:0',
          'a back-filled member: silent badges on their real dates, 23 more visits to the 30th');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '5', 'always exactly five rows');
select pg_temp.claims(17, 1, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2025-01-01:true:-:- visits_7:true:2025-01-07:true:-:- visits_30:true:2025-01-30:true:-:- visits_100:true:' || pg_temp.d(date '2025-01-01', 99) || ':true:-:- four_weeks:false:-:-:-:0',
          'a member at 100 visit days: four earned, nothing remaining');
select pg_temp.claims(6, 2, 'member');
select is(pg_temp.asrole('authenticated', pg_temp.q()),
          'first_visit:true:2026-03-02:true:-:- visits_7:false:-:-:5:- visits_30:false:-:-:28:- visits_100:false:-:-:98:- four_weeks:false:-:-:-:0',
          'a member of gym B sees only their own rows and their own dates, never member 13''s');
select pg_temp.claims(13, 2, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a gym A member presenting gym B''s claim gets nothing (no live member row there)');
select pg_temp.claims(1, 1, 'owner');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'an Owner gets no row');
select pg_temp.claims(2, 1, 'receptionist');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a receptionist gets no row');
select pg_temp.claims(3, 1, 'support');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'support gets no row');
select pg_temp.claims(3, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a user with no member row gets no row');
select pg_temp.claims(4, 1, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a deactivated member gets no row');
select pg_temp.claims(5, 3, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a member of a suspended gym gets no row');
select pg_temp.claims(13, 0, 'member');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.get_my_badges()$$), '0', 'a caller with no gym gets no row');
select is(pg_temp.asrole('anon', $$select count(*)::text from public.get_my_badges()$$) ~ '^42501:', true, 'anon is refused (42501)');
select is(pg_temp.asrole('service_role', $$select count(*)::text from public.get_my_badges()$$) ~ '^42501:', true, 'service_role is refused (42501)');
reset role;
select is(pg_temp.same_tables(), true, 'the whole caller matrix above wrote nothing: engagement_facts and engagement_state are identical to the snapshot taken before it');

-- ============================================================================
-- Gates that reach their consumers (Epic 22 retro 66)
-- ============================================================================
create function pg_temp.badge_writers() returns text[] language sql as $f$
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'insert\s+into\s+(public\.)?engagement_facts'
    and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ '''badge'''
$f$;
create function pg_temp.callers() returns text language sql stable as $f$
  select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname), '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname <> 'award_milestones' and p.prosrc ~* 'award_milestones'
$f$;
select is(pg_temp.badge_writers(), array['private.award_milestones(uuid)', 'private.backfill_badges()'], 'gate: only award_milestones and the back-fill write a badge fact');
select is(pg_temp.callers(), 'private.settle_engagement', 'gate: the only caller of award_milestones is settle_engagement');

-- The scans shown failing: a mutant record_check_in that writes a badge and names the award is caught, then the original is put back.
create temp table original_def as select pg_get_functiondef('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) as def;
do $mutate$
declare v_def text;
begin
  select def into v_def from original_def;
  v_def := regexp_replace(v_def, E'\\mbegin\\M',
    E'begin\n  insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) select m.id, m.gym_id, ''badge'', ''first_visit'', 1 from members m where false;\n  perform private.award_milestones(p_member_id);', '');
  execute v_def;
end
$mutate$;
select is(pg_temp.badge_writers(), array['private.award_milestones(uuid)', 'private.backfill_badges()', 'private.record_check_in(uuid,uuid,text,uuid,timestamp with time zone,uuid)'],
          'gate: against a mutant record_check_in that writes a badge the writer scan names it');
select is(pg_temp.callers(), 'private.record_check_in,private.settle_engagement', 'gate: and the caller scan sees it name award_milestones (the assertion above would FAIL against it)');
do $restore$
begin
  execute (select def from original_def);
end
$restore$;
select is(pg_temp.badge_writers(), array['private.award_milestones(uuid)', 'private.backfill_badges()'], 'gate: with record_check_in restored the writer scan is clean again');
select is(pg_temp.callers(), 'private.settle_engagement', 'gate: and the caller scan too');
select is((select pg_get_functiondef('private.record_check_in(uuid, uuid, text, uuid, timestamptz, uuid)'::regprocedure) = def from original_def), true, 'gate: record_check_in is byte-for-byte what it was');
select is((select count(*)::int from unnest(array['check_in(timestamptz,uuid)', 'private.record_check_in(uuid,uuid,text,uuid,timestamptz,uuid)', 'void_staff_check_in(uuid,text)']) f
           where regexp_replace(pg_get_functiondef(to_regprocedure(f)), '--[^\n]*', '', 'g') ~* 'badge|award_milestones|backfill_badges'), 0, 'gate: check_in(), record_check_in and void_staff_check_in name no badge, award or back-fill in code (the 0186 comment that says they touch none is not code)');
-- A third writer is caught.
create function public.bd_mutant_writer() returns void language plpgsql as $f$ begin insert into engagement_facts (member_id, gym_id, kind, subject_key, revision) select m.id, m.gym_id, 'badge', 'visits_7', 2 from members m where false; end $f$;
select is((select count(*)::int from unnest(pg_temp.badge_writers()) w where w = 'bd_mutant_writer()'), 1, 'gate: a function that writes a badge at revision 2 is named by the writer scan');
drop function public.bd_mutant_writer();
select is(pg_temp.badge_writers(), array['private.award_milestones(uuid)', 'private.backfill_badges()'], 'gate: and gone again once dropped');
-- A badge is never revised or deleted: the two writers write revision 1 only, no function deletes a fact, and the guard refuses both.
select is((select count(*)::int from pg_proc p where p.oid in ('private.award_milestones(uuid)'::regprocedure, 'private.backfill_badges()'::regprocedure)
             and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'revision\s*[+]|max\s*\(\s*(f\.)?revision|\mrevision\s*=\s*[2-9]'), 0, 'gate: neither writer computes a next revision');
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind in ('f', 'p')
             and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* 'delete\s+from\s+(public\.)?engagement_facts'), 0, 'gate: no function deletes an engagement fact');
select throws_ok(format($$update engagement_facts set silent = not silent where member_id = %L and kind = 'badge' and subject_key = 'first_visit'$$, pg_temp.m(21)), '23514', null, 'gate: the append-only guard refuses to update a badge');
select throws_ok(format($$delete from engagement_facts where member_id = %L and kind = 'badge'$$, pg_temp.m(21)), '23514', null, 'gate: and to delete one');
select is((select count(*)::int from engagement_facts where kind = 'badge' and revision <> 1 and member_id in (select m.id from members m where m.name ilike 'BD Member %')), 0, 'gate: no fixture badge has a revision above 1');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname ~* 'buy|grant|transfer|edit|give' and p.prosrc ~* 'badge'), 0,
  'gate: no function that buys, grants, transfers or edits a badge exists');
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C")
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
     and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?engagement_facts'),
  array['acknowledge_milestone(smallint)'], 'gate: a client can call no function that writes a badge: only acknowledge_milestone writes a fact at all');

-- A badge grants nothing: after earning the five badges of member 23 (and four more members'), no ledger, stamp, guest session, plan or subscription row exists or moved.
select is((select events from grants_before) - (select count(*) from loyalty_events), 0::bigint, 'grants nothing: the loyalty ledger has the same row count');
select is((select progress from grants_before) - (select count(*) from loyalty_progress), 0::bigint, 'grants nothing: stamps (progress) the same');
select is((select guests from grants_before) - (select count(*) from guest_sessions), 0::bigint, 'grants nothing: guest sessions the same');
select is((select plans from grants_before) - (select count(*) from plans), 0::bigint, 'grants nothing: plans the same');
select is((select subs from grants_before) - (select count(*) from subscriptions), 0::bigint, 'grants nothing: subscriptions the same');
select cmp_ok((select count(*)::int from engagement_facts where kind = 'badge' and member_id in (select m.id from members m where m.name ilike 'BD Member %')), '>=', 25, 'grants nothing: badge rows exist in this file, so the comparisons above compared something');
select is((select count(*)::int from engagement_facts where kind = 'day_shield' and member_id in (select m.id from members m where m.name ilike 'BD Member %')), 0, 'grants nothing: no Shield fact was written by an award');

select * from finish();
rollback;
