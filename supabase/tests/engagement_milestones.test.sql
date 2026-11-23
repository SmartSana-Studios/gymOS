-- Story 30.7 (FR-225, FR-229, NFR-028; AD-53, AD-56): milestones and the celebration's server side (migration 0189).
--
-- Proves: private.award_milestones (one fact per reached number, never twice, silent exactly when the Nth distinct day is before the epoch
-- Monday, nothing while dark, nothing for a member who has not reached 7); that it is called only from settle (a scan over every function, shown
-- failing against a mutant record_check_in that calls it) and that no function but acknowledge_milestone raises the acknowledge flag; that a plain
-- read never awards; pending_milestone (the highest unacknowledged non-silent number); public.acknowledge_milestone (the number shown and every
-- lower one, a second call writes nothing, a number not held or not 7/30/100 writes nothing, the caller matrix, no cross-member or cross-gym
-- effect, the shape and the source rules); the derived marker of my_visit_days (follows the ordered distinct days, a void or a late visit moves the
-- marker and never the fact); and the `milestones` array of the derived and rebuilt states.
--
-- Fixture ids: 00000000-0000-0000-0043-00000000nnnn. Gym 1 (A, active), gym 2 (B, active), gym 3 (S, suspended), users 2xxx, members 3xxx.

begin;
select plan(142);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0043-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
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

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'MS Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'MS Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'MS Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'MS Gym S', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'ms-' || n || '@x.example', now() from generate_series(1, 30) n;
-- 1 owner, 2 receptionist, 3 support person (a user with NO member row), 4 deactivated member, 5 member of the suspended gym, 16 member of gym B,
-- the rest are members of gym A.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, case when n = 5 then 3 when n = 16 then 2 else 1 end), pg_temp.id(2, n),
       (case n when 1 then 'owner' when 2 then 'receptionist' else 'member' end)::member_role,
       'MS Member ' || n, date '2026-01-05', case when n = 4 then now() end
from generate_series(1, 30) n where n <> 3;

-- p_count consecutive counted visit days from p_from (one attendance row per day, the day written as visit_day).
create function pg_temp.days(p_n int, p_from date, p_count int) returns void language sql as $f$
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_from + g + time '10:00') at time zone 'Africa/Douala', (p_from + g + time '10:30') at time zone 'Africa/Douala', 'manual', (p_from + g)
  from members m, generate_series(0, p_count - 1) g where m.id = pg_temp.m(p_n)
$f$;
create function pg_temp.settle(p_n int, p_up_to date) returns integer language sql as $f$
  select private.settle_engagement(pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_up_to)
$f$;
-- 'subject:silent:acknowledged' per milestone fact of a member, in number order; '-' when none.
create function pg_temp.ms(p_n int) returns text language sql stable as $f$
  select coalesce(string_agg(f.subject_key || ':' || f.silent || ':' || (f.acknowledged_at is not null), ' ' order by f.subject_key::int), '-')
  from engagement_facts f where f.member_id = pg_temp.m(p_n) and f.kind = 'milestone'
$f$;
create function pg_temp.mark_dirty(p_n int, p_week date) returns void language sql as $f$
  insert into engagement_state (member_id, gym_id, dirty_from) values (pg_temp.m(p_n), (select gym_id from members where id = pg_temp.m(p_n)), p_week)
  on conflict (member_id) do update set dirty_from = least(coalesce(engagement_state.dirty_from, excluded.dirty_from), excluded.dirty_from)
$f$;
create function pg_temp.nms(p_n int) returns int language sql stable as $f$ select count(*)::int from engagement_facts where member_id = pg_temp.m(p_n) and kind = 'milestone' $f$;
create function pg_temp.mrow(p_n int, p_ms int) returns text language sql stable as $f$
  select coalesce((select md5(f::text) from engagement_facts f where f.member_id = pg_temp.m(p_n) and f.kind = 'milestone' and f.subject_key = p_ms::text), 'none')
$f$;
create function pg_temp.mxmin(p_n int, p_ms int) returns text language sql stable as $f$
  select coalesce((select f.xmin::text from engagement_facts f where f.member_id = pg_temp.m(p_n) and f.kind = 'milestone' and f.subject_key = p_ms::text), 'none')
$f$;
create function pg_temp.pending(p_n int) returns text language sql stable as $f$
  select coalesce((select v.pending_milestone::text from private.engagement_state_view_at(pg_temp.m(p_n), now()) v), 'null')
$f$;
create function pg_temp.allfacts() returns text language sql stable as $f$ select coalesce(string_agg(f::text, '|' order by f::text), '') from engagement_facts f $f$;
create function pg_temp.derived(p_n int) returns jsonb language sql stable as $f$ select to_jsonb(d) from private.engagement_derived_state(pg_temp.m(p_n)) d $f$;
create function pg_temp.rebuilt(p_n int, p_up_to date) returns jsonb language sql stable as $f$ select to_jsonb(r) from private.rebuild_engagement(pg_temp.m(p_n), p_up_to) r $f$;
-- The days of one month that carry a marker, as 'date:number' pairs, read as the member through the public function.
create function pg_temp.marks(p_n int, p_month date) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.claims(p_n, 1, 'member');
  set local role authenticated;
  begin
    select coalesce(string_agg(visit_day::text || ':' || milestone, ',' order by visit_day), '-') into v from public.my_visit_days(p_month) where milestone is not null;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

-- ============================================================================
-- Dark: while the epoch is NULL nothing is awarded and nothing is read as pending
-- ============================================================================
select pg_temp.days(19, date '2026-03-02', 10);
select is((select release_week_start from platform_engagement_config), null, 'the epoch is NULL (dark)');
select is(pg_temp.settle(19, date '2026-03-20'), 0, 'dark: settle writes nothing');
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(19)), 'dark: award_milestones can be called');
select is((select count(*)::int from engagement_facts), 0, 'dark: no fact exists, for a member with 10 visit days');
select is(pg_temp.pending(19), 'null', 'dark: pending_milestone is NULL');

update platform_engagement_config set release_week_start = date '2026-03-02';

-- ============================================================================
-- Shape, grants, source rules
-- ============================================================================
select is((select pronargs::int from pg_proc where oid = 'public.acknowledge_milestone(smallint)'::regprocedure), 1, 'acknowledge_milestone takes one argument');
select is((select proargnames from pg_proc where oid = 'public.acknowledge_milestone(smallint)'::regprocedure), array['p_milestone']::text[], 'and it is the milestone number: no member id to forge');
select is((select pg_get_function_result('public.acknowledge_milestone(smallint)'::regprocedure)), 'smallint', 'it returns smallint');
select is((select prosecdef from pg_proc where oid = 'public.acknowledge_milestone(smallint)'::regprocedure), true, 'it is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.acknowledge_milestone(smallint)'::regprocedure), array['search_path=public'], 'it pins its search_path');
select is((select provolatile::text from pg_proc where oid = 'public.acknowledge_milestone(smallint)'::regprocedure), 'v', 'it is VOLATILE');
select is((select has_function_privilege('authenticated', 'public.acknowledge_milestone(smallint)', 'execute')), true, 'authenticated can execute it');
select is(
  (select count(*)::int from unnest(array['anon', 'service_role', 'public']) r where has_function_privilege(r, 'public.acknowledge_milestone(smallint)', 'execute')),
  0, 'anon, service_role and PUBLIC cannot');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role', 'public']) r where has_function_privilege(r, 'private.award_milestones(uuid)', 'execute')),
  0, 'no client role can execute award_milestones');
select is((select prosecdef from pg_proc where oid = 'private.award_milestones(uuid)'::regprocedure), true, 'award_milestones is SECURITY DEFINER (the engagement tables have no client grant)');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'milestone'), 0, 'neither milestone function is a support capability');
select is(
  (select (p.prosrc !~* 'execute\s+format' and p.prosrc !~* 'count\(' and p.prosrc !~* '''support''' and p.prosrc !~* '''supervisor''')
   from pg_proc p where p.oid = 'public.acknowledge_milestone(smallint)'::regprocedure),
  true, 'acknowledge_milestone has no dynamic SQL, no count(, and names no support or supervisor literal');
select is(
  (select p.prosrc ~ 'private\.current_gym_status\(\) is distinct from ''active''' and p.prosrc ~ 'is not active'
          and position('current_member_role' in p.prosrc) < position('current_gym_status' in p.prosrc)
   from pg_proc p where p.oid = 'public.acknowledge_milestone(smallint)'::regprocedure),
  true, 'it refuses a suspended gym with the `is not active` phrase, after the role check');
select is(
  (select p.prosrc !~* 'attendance_events' from pg_proc p where p.oid = 'private.award_milestones(uuid)'::regprocedure),
  true, 'award_milestones never names the raw attendance table (comments included)');
select is(
  (select p.prosrc ~ 'member_visit_days' from pg_proc p where p.oid = 'private.award_milestones(uuid)'::regprocedure),
  true, 'it reads member_visit_days');
select is((select pg_get_function_result('private.engagement_state_view_at(uuid, timestamptz)'::regprocedure) ~ 'pending_milestone smallint\)$'), true, 'the state view row type still ends with pending_milestone smallint');

-- ============================================================================
-- Consumers (Epic 22 retro 66/67): the gate "an award runs only in settle" reaches every function that could breach it
-- ============================================================================
create function pg_temp.callers() returns text language sql stable as $f$
  select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname), '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname <> 'award_milestones' and p.prosrc ~* 'award_milestones'
$f$;
create function pg_temp.raisers() returns text language sql stable as $f$
  select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by n.nspname, p.proname), '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosrc ~* 'set_config\(\s*''app\.engagement_acknowledge'''
$f$;
select is(pg_temp.callers(), 'private.settle_engagement', 'the only caller of award_milestones is settle_engagement');
select is(pg_temp.raisers(), 'public.acknowledge_milestone', 'the only function that raises the acknowledge flag is acknowledge_milestone');
select is(
  (select count(*)::int from pg_proc p where p.proname = 'record_check_in' and p.prosrc ~* 'award_milestones|engagement_acknowledge|milestone'),
  0, 'record_check_in names no milestone function');
select is(
  (select count(*)::int from pg_proc p where p.proname in ('void_staff_check_in', 'check_in', 'staff_check_in') and p.prosrc ~* 'award_milestones|engagement_acknowledge|milestone'),
  0, 'nor do void_staff_check_in, check_in and staff_check_in');
-- The scan shown failing: a mutant record_check_in that calls the award is caught, then the original is put back.
create temp table orig_def as select pg_get_functiondef(p.oid) as def from pg_proc p where p.oid = (
  select p2.oid from pg_proc p2 where p2.proname = 'record_check_in' and p2.pronamespace = 'private'::regnamespace);
select is((select count(*)::int from orig_def), 1, 'mutation: exactly one record_check_in to mutate');
do $mut$
declare v_def text;
begin
  select def into v_def from orig_def;
  execute regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform private.award_milestones(p_member_id);\n');
end;
$mut$;
select is(pg_temp.callers(), 'private.record_check_in,private.settle_engagement', 'mutation: the scan sees the award added to record_check_in');
select isnt(pg_temp.callers(), 'private.settle_engagement', 'mutation: so the gate assertion above would FAIL against it');
do $unmut$
declare v_def text;
begin
  select def into v_def from orig_def;
  execute v_def;
end;
$unmut$;
select is(pg_temp.callers(), 'private.settle_engagement', 'mutation undone: the only caller is settle_engagement again');
-- The same for the flag: a mutant that raises it elsewhere is caught.
create function public.ms_mutant_flag() returns void language plpgsql as $f$ begin perform set_config('app.engagement_acknowledge', 'on', true); end $f$;
select is(pg_temp.raisers(), 'public.acknowledge_milestone,public.ms_mutant_flag', 'mutation: the scan sees a second function raising the flag');
drop function public.ms_mutant_flag();
select is(pg_temp.raisers(), 'public.acknowledge_milestone', 'mutation undone: only acknowledge_milestone raises the flag');

-- ============================================================================
-- The award: the 7th day after the epoch (member 10)
-- ============================================================================
select pg_temp.days(10, date '2026-03-02', 7);
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(10)), 7, 'member 10 has 7 distinct visit days, the 7th on 2026-03-08 (after the epoch)');
select is(pg_temp.pending(10), 'null', 'before any settle there is no fact and nothing pending: a plain read never awards');
select is(pg_temp.nms(10), 0, 'no milestone fact yet');
select is(pg_temp.settle(10, date '2026-03-09'), 1, 'settle returns the week-fact count only (one closed week), not the milestone');
select is(pg_temp.ms(10), '7:false:false', 'one fact: 7, not silent, not acknowledged');
select is((select f.revision::text || '|' || f.kind || '|' || coalesce(f.outcome, 'null') || '|' || coalesce(f.goal::text, 'null') || '|' || coalesce(f.visits::text, 'null')
           from engagement_facts f where f.member_id = pg_temp.m(10) and f.kind = 'milestone'), '1|milestone|null|null|null', 'revision 1, no outcome, goal or visits');
select is(pg_temp.pending(10), '7', 'pending_milestone is 7');
create temp table row10 as select pg_temp.mrow(10, 7) as r, pg_temp.allfacts() as a;
select is(pg_temp.settle(10, date '2026-03-09'), 0, 'a replay settle writes nothing');
select is(pg_temp.mrow(10, 7), (select r from row10), 'and the milestone row is byte-identical');
select is(pg_temp.allfacts(), (select a from row10), 'and so is every fact');
select lives_ok(format($$select private.award_milestones(%L)$$, pg_temp.m(10)), 'calling award_milestones again directly');
select is(pg_temp.nms(10), 1, 'inserts nothing');
select is(pg_temp.derived(10) -> 'milestones', '[7]'::jsonb, 'derived state: milestones [7]');
select is(pg_temp.derived(10), pg_temp.rebuilt(10, date '2026-03-09'), 'derived equals rebuild');

-- fewer than 7, and nobody
select pg_temp.days(20, date '2026-03-02', 6);
select pg_temp.settle(20, date '2026-03-20');
select is(pg_temp.nms(20), 0, '6 visit days: no milestone');
select is(pg_temp.settle(21, date '2026-03-20'), 0, 'a member with no visit day: settle writes nothing');
select is(pg_temp.nms(21), 0, 'and no milestone');
select is(pg_temp.derived(20) -> 'milestones', '[]'::jsonb, '6 days: derived milestones []');
select is(pg_temp.rebuilt(20, date '2026-03-20') -> 'milestones', '[]'::jsonb, 'and rebuilt milestones []');

-- ============================================================================
-- The epoch line: the Nth day decides, not the day of the award
-- ============================================================================
select pg_temp.days(22, date '2026-02-23', 6);
select pg_temp.days(22, date '2026-03-02', 1);
select pg_temp.settle(22, date '2026-03-20');
select is(pg_temp.ms(22), '7:false:false', 'the 7th day ON the epoch Monday is celebrated (not silent)');
select pg_temp.days(23, date '2026-02-23', 6);
select pg_temp.days(23, date '2026-03-01', 1);
select pg_temp.settle(23, date '2026-03-20');
select is(pg_temp.ms(23), '7:true:true', 'the 7th day the day BEFORE the epoch is silent and already acknowledged');
select is(pg_temp.pending(23), 'null', 'and not pending');

-- ============================================================================
-- History before the epoch: 120 days, three silent facts, no celebration
-- ============================================================================
select pg_temp.days(11, date '2025-10-01', 120);
select is((select max(visit_day) from member_visit_days where member_id = pg_temp.m(11)) < date '2026-03-02', true, 'member 11: 120 visit days, all before the epoch');
select pg_temp.settle(11, date '2026-03-09');
select is(pg_temp.ms(11), '7:true:true 30:true:true 100:true:true', 'three silent, acknowledged facts, whatever the number');
select is(pg_temp.pending(11), 'null', 'no pending celebration');
select is(pg_temp.derived(11) -> 'milestones', '[7, 30, 100]'::jsonb, 'derived milestones include the silent ones');
select is(pg_temp.derived(11), pg_temp.rebuilt(11, date '2026-03-09'), 'derived equals rebuild');

-- ============================================================================
-- 35 days before the epoch and 2 after: 7 and 30 silent; the 100th is celebrated when reached
-- ============================================================================
select pg_temp.days(12, date '2026-01-01', 35);
select pg_temp.days(12, date '2026-03-03', 2);
select pg_temp.settle(12, date '2026-03-09');
select is(pg_temp.ms(12), '7:true:true 30:true:true', '35 before, 2 after: the 7th and 30th are silent');
select is(pg_temp.pending(12), 'null', 'no celebration on the first day after the epoch');
select is(pg_temp.derived(12), pg_temp.rebuilt(12, date '2026-03-09'), 'derived equals rebuild');
create temp table row12 as select pg_temp.mrow(12, 7) as r7, pg_temp.mrow(12, 30) as r30;
select pg_temp.days(12, date '2026-03-05', 63);
select pg_temp.mark_dirty(12, date '2026-03-02');
select pg_temp.settle(12, date '2026-05-11');
select is(pg_temp.ms(12), '7:true:true 30:true:true 100:false:false', 'at 100 days (the 100th on 2026-05-06) the 100th is a celebrated fact');
select is(pg_temp.pending(12), '100', 'pending is 100');
select is(pg_temp.mrow(12, 7) || pg_temp.mrow(12, 30), (select r7 || r30 from row12), 'the silent 7th and 30th rows are untouched');
select is(pg_temp.derived(12), pg_temp.rebuilt(12, date '2026-05-11'), 'derived equals rebuild at 100');

-- ============================================================================
-- A void never reverses a milestone; the marker follows the derived 7th day (member 13)
-- ============================================================================
select pg_temp.days(13, date '2026-03-02', 7);
select pg_temp.settle(13, date '2026-03-09');
select is(pg_temp.marks(13, date '2026-03-01'), '2026-03-08:7', 'member 13: the marker is on the 7th day, 03-08');
create temp table row13 as select pg_temp.mrow(13, 7) as r, pg_temp.mxmin(13, 7) as x;
update attendance_events set voided_at = now(), voided_by = pg_temp.id(2, 13), void_reason = 'test void'
 where member_id = pg_temp.m(13) and visit_day = date '2026-03-08';
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(13)), 6, 'the 7th day is voided: the count drops to 6');
select pg_temp.mark_dirty(13, date '2026-03-02');
select pg_temp.settle(13, date '2026-03-16');
select is(pg_temp.mrow(13, 7), (select r from row13), 'the milestone row is unchanged after the void');
select is(pg_temp.pending(13), '7', 'and still pending (never reversed, never acknowledged by the void)');
select is(pg_temp.marks(13, date '2026-03-01'), '-', 'the marker is gone while the count is 6');
select pg_temp.days(13, date '2026-03-10', 1);
select pg_temp.mark_dirty(13, date '2026-03-09');
select pg_temp.settle(13, date '2026-03-16');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.m(13)), 7, 'a new visit brings the count back to 7');
select is(pg_temp.nms(13), 1, 'no second milestone row');
select is(pg_temp.mxmin(13, 7), (select x from row13), 'and the row was not rewritten');
select is(pg_temp.marks(13, date '2026-03-01'), '2026-03-10:7', 'the marker follows the 7th distinct day as now derived (03-10)');

-- ============================================================================
-- A late offline visit moves the marker and writes no fact (member 14)
-- ============================================================================
select pg_temp.days(14, date '2026-03-02', 5);
select pg_temp.days(14, date '2026-03-09', 2);
select pg_temp.settle(14, date '2026-03-12');
select is(pg_temp.marks(14, date '2026-03-01'), '2026-03-10:7', 'member 14: the 7th day is 03-10');
create temp table row14 as select pg_temp.mrow(14, 7) as r;
select pg_temp.days(14, date '2026-03-07', 1);
select pg_temp.mark_dirty(14, date '2026-03-02');
select pg_temp.settle(14, date '2026-03-12');
select is(pg_temp.marks(14, date '2026-03-01'), '2026-03-09:7', 'a late visit on 03-07: the marker moves to 03-09');
select is(pg_temp.nms(14), 1, 'no new fact');
select is(pg_temp.mrow(14, 7), (select r from row14), 'and the fact is unchanged');
select is(pg_temp.derived(14), pg_temp.rebuilt(14, date '2026-03-12'), 'derived equals rebuild after the late visit');

-- A marker whose day changes month (member 24): the 7th day moves from April to March.
select pg_temp.days(24, date '2026-03-26', 6);
select pg_temp.days(24, date '2026-04-01', 1);
select is(pg_temp.marks(24, date '2026-04-01') || '|' || pg_temp.marks(24, date '2026-03-01'), '2026-04-01:7|-', 'member 24: the 7th day is 04-01, so April carries the marker');
select pg_temp.days(24, date '2026-03-25', 1);
select is(pg_temp.marks(24, date '2026-04-01') || '|' || pg_temp.marks(24, date '2026-03-01'), '-|2026-03-31:7', 'after a late visit on 03-25 the marker is in March (03-31)');

-- 30th and 100th markers
select pg_temp.days(25, date '2026-01-01', 100);
select is(pg_temp.marks(25, date '2026-01-01'), '2026-01-07:7,2026-01-30:30', 'member 25: January carries the 7th and the 30th');
select is(pg_temp.marks(25, date '2026-04-01'), '2026-04-10:100', 'and April the 100th (2026-04-10)');
select is(pg_temp.marks(25, date '2026-02-01'), '-', 'February has none');

-- ============================================================================
-- 7 and 30 both waiting: pending is the highest; one acknowledge clears both (member 15)
-- ============================================================================
select pg_temp.days(15, date '2026-03-02', 30);
select pg_temp.settle(15, date '2026-04-06');
select is(pg_temp.ms(15), '7:false:false 30:false:false', 'member 15: both facts exist after a long gap');
select is(pg_temp.pending(15), '30', 'pending is the highest (30)');
select pg_temp.claims(15, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(30::smallint)::text'), '30', 'acknowledge_milestone(30) returns 30');
select is(pg_temp.ms(15), '7:false:true 30:false:true', 'it acknowledged 30 and the lower 7');
select is((select count(distinct f.acknowledged_at)::int from engagement_facts f where f.member_id = pg_temp.m(15) and f.kind = 'milestone'), 1, 'at one timestamp');
select is(pg_temp.pending(15), 'null', 'nothing is pending afterwards');
select is(pg_temp.nms(15), 2, 'no row was added or removed');
select is((select count(*)::int from engagement_facts f where f.member_id = pg_temp.m(15) and f.kind = 'milestone' and f.silent), 0, 'and no other column changed (silent)');
select is((select current_setting('app.engagement_acknowledge', true)), 'off', 'the flag is back to off after the call');

-- ============================================================================
-- Acknowledge: not held, bad numbers, twice (member 10 holds only the 7)
-- ============================================================================
select pg_temp.claims(10, 1, 'member');
create temp table x10 as select pg_temp.mxmin(10, 7) as x, pg_temp.allfacts() as a;
select is(pg_temp.asrole('authenticated', 'select coalesce(public.acknowledge_milestone(30::smallint)::text, ''null'')'), 'null', 'a milestone the member does not hold returns NULL');
select is(pg_temp.allfacts(), (select a from x10), 'and wrote nothing');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(8::smallint)::text'), '22023:%', '8 is refused (22023)');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(0::smallint)::text'), '22023:%', '0 is refused');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(null::smallint)::text'), '22023:%', 'NULL is refused');
select is(pg_temp.allfacts(), (select a from x10), 'a refused number wrote nothing');
select is(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '7', 'acknowledge_milestone(7) returns 7');
select is(pg_temp.ms(10), '7:false:true', 'the 7 is acknowledged');
select is(pg_temp.pending(10), 'null', 'and no longer pending');
create temp table x10b as select pg_temp.mxmin(10, 7) as x, pg_temp.allfacts() as a;
select is(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '7', 'a second call returns the same result');
select is(pg_temp.allfacts(), (select a from x10b), 'and writes nothing (every fact identical)');
select is(pg_temp.mxmin(10, 7), (select x from x10b), 'the row was not even rewritten');
select is(pg_temp.asrole('authenticated', 'select coalesce(public.acknowledge_milestone(100::smallint)::text, ''null'')'), 'null', 'a number held by nobody still returns NULL');
select is(pg_temp.settle(10, date '2026-03-23'), 2, 'a later settle (two newly closed weeks)');
select is(pg_temp.ms(10), '7:false:true', 'does not un-acknowledge the milestone, nor add one');

-- ============================================================================
-- The caller matrix: nobody but a live member of an active gym acknowledges
-- ============================================================================
select pg_temp.days(26, date '2026-03-02', 7);
select pg_temp.settle(26, date '2026-03-09');
select pg_temp.days(4, date '2026-03-02', 7);
select pg_temp.settle(4, date '2026-03-09');
select pg_temp.days(5, date '2026-03-02', 7);
select pg_temp.settle(5, date '2026-03-09');
create temp table snap_all as select pg_temp.allfacts() as a;
select is(pg_temp.ms(26) || '|' || pg_temp.ms(4) || '|' || pg_temp.ms(5), '7:false:false|7:false:false|7:false:false', 'members 26, 4 (deactivated) and 5 (suspended gym) each hold an unacknowledged 7');
select pg_temp.claims(1, 1, 'owner');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'an Owner is refused');
select pg_temp.claims(2, 1, 'receptionist');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'a Receptionist is refused');
select pg_temp.claims(3, 1, 'support');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'GymOS Support is refused');
select pg_temp.claims(4, 1, 'member');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'a deactivated member is refused');
select pg_temp.claims(5, 3, 'member');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%is not active%', 'a member of a suspended gym is refused with the `is not active` phrase');
select pg_temp.claims(26, 0, 'member');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'a caller with no gym in the session is refused');
select pg_temp.claims(26, 2, 'member');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:%', 'a member whose token names another gym is refused');
select pg_temp.claims(26, 1, 'member');
select is(pg_temp.asrole('anon', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:permission denied for function acknowledge_milestone', 'anon cannot execute it');
select is(pg_temp.asrole('service_role', 'select public.acknowledge_milestone(7::smallint)::text'), '42501:permission denied for function acknowledge_milestone', 'service_role cannot execute it');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(8::smallint)::text'), '22023:%', 'a live member with a bad number gets 22023');
select is(pg_temp.allfacts(), (select a from snap_all), 'nothing was written for any refused caller');
select pg_temp.claims(1, 1, 'owner');
select alike(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(8::smallint)::text'), '42501:%', 'a bad number from a refused caller is a permission refusal, not a number refusal (no probing)');

-- ============================================================================
-- Isolation: two members of one gym, and two gyms
-- ============================================================================
select pg_temp.days(17, date '2026-03-02', 7);
select pg_temp.settle(17, date '2026-03-09');
select pg_temp.days(16, date '2026-03-02', 7);
select pg_temp.settle(16, date '2026-03-09');
select is(pg_temp.ms(17) || '|' || pg_temp.ms(16), '7:false:false|7:false:false', 'member 17 (gym A) and member 16 (gym B) each hold an unacknowledged 7');
select pg_temp.claims(17, 1, 'member');
select is((select pending_milestone::text from public.my_engagement()), '7', 'member 17 reads their own pending 7');
select pg_temp.claims(16, 2, 'member');
select is((select pending_milestone::text from public.my_engagement()), '7', 'member 16 reads theirs');
create temp table x26 as select pg_temp.mrow(26, 7) as r, pg_temp.mrow(17, 7) as r17;
select is(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '7', 'member 16 acknowledges their 7');
select is(pg_temp.ms(16), '7:false:true', 'theirs is acknowledged');
select is(pg_temp.mrow(26, 7) || pg_temp.mrow(17, 7), (select r || r17 from x26), 'no other member of any gym changed (26 and 17 are byte-identical)');
select pg_temp.claims(17, 1, 'member');
select is((select pending_milestone::text from public.my_engagement()), '7', 'member 17 still sees their own pending 7');
select pg_temp.claims(10, 1, 'member');
select is((select coalesce(pending_milestone::text, 'null') from public.my_engagement()), 'null', 'member 10 (acknowledged) reads NULL and none of the others'' numbers');
select pg_temp.claims(26, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select public.acknowledge_milestone(7::smallint)::text'), '7', 'member 26 acknowledges their own');
select is(pg_temp.ms(17) || '|' || pg_temp.ms(4) || '|' || pg_temp.ms(5), '7:false:false|7:false:false|7:false:false', 'member 17, the deactivated member and the suspended gym''s member are untouched');

-- ============================================================================
-- Reads never award; open_engagement does (settle), exactly once (member 27)
-- ============================================================================
select pg_temp.days(27, date '2026-03-02', 7);
select pg_temp.claims(27, 1, 'member');
select is((select coalesce(pending_milestone::text, 'null') from public.my_engagement()), 'null', 'my_engagement: nothing pending before a settle');
select is(pg_temp.nms(27), 0, 'and it wrote no fact');
select is((select pending_milestone::text from public.open_engagement()), '7', 'open_engagement settles, awards, and returns pending 7');
select is((select pending_milestone::text from public.my_engagement()), '7', 'my_engagement then reads 7');
select is((select pending_milestone::text from public.open_engagement()), '7', 'a second open still reads 7');
select is(pg_temp.nms(27), 1, 'with exactly one fact');

-- ============================================================================
-- Determinism with the milestones array
-- ============================================================================
select is(pg_temp.derived(13) -> 'milestones', '[7]'::jsonb, 'member 13 (void and return): derived milestones [7]');
select is(pg_temp.rebuilt(13, date '2026-03-16') -> 'milestones', '[7]'::jsonb, 'and the rebuild reaches 7 again');
select is(pg_temp.derived(13), pg_temp.rebuilt(13, date '2026-03-16'), 'derived equals rebuild for the void-then-return case');
select is(pg_temp.derived(25) -> 'milestones', '[]'::jsonb, 'a member whose days were never settled has no fact: derived []');
select is(pg_temp.rebuilt(25, date '2026-04-20') -> 'milestones', '[7, 30, 100]'::jsonb, 'while the rebuild from attendance reaches 7, 30 and 100');

select * from finish();
rollback;
