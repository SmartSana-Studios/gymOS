-- Story 30.6 (FR-226, NFR-001, NFR-029): public.gym_leaderboard(date) (migration 0188): the shape, the ranking rules, the rows chosen for each caller
-- position, the fewer-than-3 form, both months, the month validation (and its dependence on private.gym_today, not on the database clock),
-- the label rule, the ineligible members and the allow-list of columns.
--
-- Gym A holds 43 ranked members in the PREVIOUS gym month (member 100+p is at position p, except that the three members tied across position
-- 10 are, in order of who reached the count first, 112, 110 and 111), two members who never rank (a deactivated one and a support row, both with
-- the most visits) and unranked viewers. Positions and visits:
--   1..9    visits 28..20 (29 - p)
--   10..12  visits 19, three members tied (rank 10); the earliest check-in on their last day orders them 112, 110, 111
--   13..29  visits 18..2  (31 - p)
--   30..43  visits 1, fourteen members tied (rank 30), ordered by the time they reached it (member number order)
-- Gym C is the small gym (fewer than 3 ranked, then 3 with a staff row). Gym D holds the label cases.
--
-- The privacy side (who is Anonymous, no names, no ids, every read path, the caller matrix) lives in leaderboard_privacy.test.sql; the
-- preference columns and writers in leaderboard_visibility.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0039-nnnnnnnnnnnn. Every member has chosen on the notice (so labels are names) except where a test says so.

begin;
select plan(102);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0039-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- The board as jsonb, as an authenticated caller; {"error": "sqlstate:message"} when the call fails.
create function pg_temp.jb(p_month date) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role authenticated;
  begin
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from public.gym_leaderboard(p_month) r;
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return v;
end $f$;
create function pg_temp.poslist(p_month date) returns text language sql as $f$
  select coalesce((select string_agg(e->>'position', ',') from jsonb_array_elements(pg_temp.jb(p_month)) e), '') $f$;
-- One field of the row at a position.
create function pg_temp.f(p_month date, p_pos int, p_field text) returns text language sql as $f$
  select e->>p_field from jsonb_array_elements(pg_temp.jb(p_month)) e where (e->>'position')::int = p_pos $f$;
create function pg_temp.selfrow(p_month date, p_field text) returns text language sql as $f$
  select e->>p_field from jsonb_array_elements(pg_temp.jb(p_month)) e where (e->>'is_self')::boolean $f$;
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

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'LBR Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'LBR Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'LBR Gym C', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 4), 'LBR Gym D', pg_temp.id(0, 1), 'active', 'Africa/Douala');
create temp table cfg as
  select date_trunc('month', private.gym_today(pg_temp.id(1, 1)))::date as cur,
         (date_trunc('month', private.gym_today(pg_temp.id(1, 1))) - interval '1 month')::date as prev;
create function pg_temp.cur() returns date language sql as $f$ select cur from cfg $f$;
create function pg_temp.prev() returns date language sql as $f$ select prev from cfg $f$;
-- The last day of the previous month, and the day before it.
create function pg_temp.prev_last() returns date language sql as $f$ select (cur - 1) from cfg $f$;

insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'lbr-' || n || '@x.example', now() from generate_series(1, 400) n;

-- Gym A: members 101..143 ranked, 150 and 152 never visit, 151 is the month-boundary member, 160 deactivated (28 visits).
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, 1), pg_temp.id(2, n), 'member'::member_role, 'F' || n || ' Surname', date '2026-01-05', case when n = 160 then now() end
from generate_series(101, 160) n where n <= 143 or n in (150, 151, 152, 160);
-- User 161 is a GymOS Support person with a live assignment to gym A (the fixture of weekly_goal.negative.test.sql): a real support members row, 28 visits.
insert into private.support_accounts (user_id, activated_at) values (pg_temp.id(2, 161), now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values (pg_temp.id(9, 1), pg_temp.id(2, 161), pg_temp.id(1, 1), 'active', now());
select private.support_set_membership(pg_temp.id(9, 1), true);
-- Gym C: three members and an owner (the small gym). Gym D: the label cases.
insert into members (id, gym_id, user_id, role, name, join_date) values
  (pg_temp.m(201), pg_temp.id(1, 3), pg_temp.id(2, 201), 'member', 'C1 Alpha', date '2026-01-05'),
  (pg_temp.m(202), pg_temp.id(1, 3), pg_temp.id(2, 202), 'member', 'C2 Bravo', date '2026-01-05'),
  (pg_temp.m(203), pg_temp.id(1, 3), pg_temp.id(2, 203), 'member', 'C3 Charlie', date '2026-01-05'),
  (pg_temp.m(204), pg_temp.id(1, 3), pg_temp.id(2, 204), 'owner', 'C4 Delta', date '2026-01-05'),
  (pg_temp.m(301), pg_temp.id(1, 4), pg_temp.id(2, 301), 'member', 'CHANTAL NJOH', date '2026-01-05'),
  (pg_temp.m(302), pg_temp.id(1, 4), pg_temp.id(2, 302), 'member', 'MADONNA', date '2026-01-05'),
  (pg_temp.m(303), pg_temp.id(1, 4), pg_temp.id(2, 303), 'member', 'Jean Paul Eyenga Mbarga', date '2026-01-05'),
  (pg_temp.m(304), pg_temp.id(1, 4), pg_temp.id(2, 304), 'member', '  LUC   ATANGANA  ', date '2026-01-05'),
  (pg_temp.m(305), pg_temp.id(1, 4), pg_temp.id(2, 305), 'member', 'ÉLODIE ÉKOTTO', date '2026-01-05'),
  (pg_temp.m(306), pg_temp.id(1, 4), pg_temp.id(2, 306), 'member', 'jean pierre', date '2026-01-05');

-- Names are stored in capitals by the 0159 trigger; two names are set with it off so the test can see that the function itself never changes case.
alter table members disable trigger uppercase_member_text;
update members set name = 'Jean Paul Eyenga Mbarga' where id = pg_temp.m(303);
update members set name = 'jean pierre' where id = pg_temp.m(306);
alter table members enable trigger uppercase_member_text;

-- Every member has chosen on the first-open notice (visible); the flag is the one the two writers switch.
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_notice_seen_at = now() where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 3), pg_temp.id(1, 4));
select set_config('app.leaderboard_write', 'off', true);

-- Visits of gym A for the previous month: the position table in the header.
create function pg_temp.vis(n int) returns int language sql immutable as $f$
  select case when n between 101 and 109 then 29 - (n - 100)
              when n in (110, 111, 112) then 19
              when n between 113 and 129 then 131 - n
              when n between 130 and 143 then 1
              when n in (160, 161) then 28 end $f$;
create function pg_temp.off(n int) returns int language sql immutable as $f$
  select case n when 112 then 0 when 110 then 5 when 111 then 10 when 160 then 0 when 161 then 0 else n end $f$;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 1), mm.id,
       ((pg_temp.prev() + (d - 1)) + time '08:00' + pg_temp.off(n) * interval '1 minute') at time zone 'Africa/Douala',
       ((pg_temp.prev() + (d - 1)) + time '08:20' + pg_temp.off(n) * interval '1 minute') at time zone 'Africa/Douala',
       'manual', pg_temp.prev() + (d - 1)
from generate_series(101, 161) n, generate_series(1, 28) d, members mm
where pg_temp.vis(n) is not null and d <= pg_temp.vis(n) and mm.user_id = pg_temp.id(2, n) and mm.gym_id = pg_temp.id(1, 1);
-- Member 117 (position 17, 14 visits): a second check-in on day 1 and a voided check-in on day 20 (no further day).
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
values (pg_temp.id(1, 1), pg_temp.m(117), ((pg_temp.prev()) + time '18:00') at time zone 'Africa/Douala', ((pg_temp.prev()) + time '18:30') at time zone 'Africa/Douala', 'manual', pg_temp.prev());
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day, voided_at, voided_by, void_reason)
values (pg_temp.id(1, 1), pg_temp.m(117), ((pg_temp.prev() + 19) + time '09:00') at time zone 'Africa/Douala', ((pg_temp.prev() + 19) + time '09:30') at time zone 'Africa/Douala', 'void', pg_temp.prev() + 19,
        now(), pg_temp.id(2, 101), 'entered by mistake');

-- ============================================================================
-- Shape, grants, source scans
-- ============================================================================
select is((select pronargs::int from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure), 1, 'gym_leaderboard takes one argument (the month; no member id to forge)');
select is((select pg_get_function_result('public.gym_leaderboard(date)'::regprocedure)),
  'TABLE("position" integer, rank integer, label text, is_anonymous boolean, visits integer, is_self boolean, is_tied boolean, visits_behind integer, ranked_total integer, self_ranked boolean)',
  'the result columns are exactly the allow-list, in order');
select is((select provolatile::text from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure), 's', 'gym_leaderboard is STABLE');
select is((select prosecdef from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure), true, 'SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure), array['search_path=public'], 'search_path is pinned');
select is((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.gym_leaderboard(date)', 'execute')), array['authenticated'], 'EXECUTE for authenticated only');
select ok(not has_function_privilege('public', 'public.gym_leaderboard(date)', 'execute'), 'and PUBLIC is revoked');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'leaderboard'), 0, 'no leaderboard function is a support capability');
select is((select count(*)::int from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure and prosrc ~* '(^|[^a-z_])(insert|update|delete)([^a-z_]|$)'), 0, 'the body has no INSERT, UPDATE or DELETE');
select is((select count(*)::int from pg_proc where oid = 'public.gym_leaderboard(date)'::regprocedure and (prosrc ~* 'supervisor' or prosrc ~* 'attendance_events' or prosrc ~* 'current_date')), 0, 'the body names no supervisor, reads attendance_counted (never attendance_events) and does not use current_date');

-- ============================================================================
-- The board of a caller at position 17 of 43 (previous month)
-- ============================================================================
select pg_temp.claims(117, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,16,17,18', 'position 17: rows 1 to 10, the position above, the caller and the position below');
select is(pg_temp.f(pg_temp.prev(), 17, 'is_self'), 'true', 'the caller''s row is flagged');
select is((select count(*)::int from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where (e->>'is_self')::boolean), 1, 'and only that row');
select is(pg_temp.f(pg_temp.prev(), 17, 'visits'), '14', 'the caller has 14 visits: two check-ins on a day count once and the voided one counts for nothing');
select is(pg_temp.f(pg_temp.prev(), 17, 'rank'), '17', 'rank 17');
select is(pg_temp.f(pg_temp.prev(), 17, 'visits_behind'), '1', 'visits_behind = the position above (15) minus the caller (14)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where e->>'visits_behind' is not null), 1, 'visits_behind is set on the caller''s row only');
select is(pg_temp.f(pg_temp.prev(), 16, 'visits') || ',' || pg_temp.f(pg_temp.prev(), 18, 'visits'), '15,13', 'the neighbours hold 15 and 13 visits');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), '43', 'ranked_total is 43 on every row (the deactivated member and the support row are not ranked)');
select is((select string_agg(distinct e->>'self_ranked', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), 'true', 'self_ranked is true on every row');
select is(pg_temp.f(pg_temp.prev(), 1, 'label'), 'F101 S.', 'position 1 is member 101 (the deactivated and the support member with 28 visits are not on the board)');
select is(pg_temp.f(pg_temp.prev(), 1, 'visits'), '28', 'with 28 visits');
select is(pg_temp.f(pg_temp.prev(), 5, 'label') || ' ' || pg_temp.f(pg_temp.prev(), 5, 'visits'), 'F105 S. 24', 'position 5 is member 105 with 24 visits');

-- ============================================================================
-- Boundaries: positions 1, 9, 10, 11, 12, 13 and the last
-- ============================================================================
select pg_temp.claims(101, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10', 'position 1: rows 1 to 10 only (the neighbour below is already in the list)');
select is(pg_temp.f(pg_temp.prev(), 1, 'visits_behind') is null, true, 'first: visits_behind is NULL');
select pg_temp.claims(109, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10', 'position 9: rows 1 to 10 only');
select is(pg_temp.f(pg_temp.prev(), 9, 'visits_behind'), '1', 'position 9 is one visit behind position 8');
select pg_temp.claims(112, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,11', 'position 10: rows 1 to 10 and the neighbour below (11)');
select is(pg_temp.f(pg_temp.prev(), 10, 'is_self'), 'true', 'member 112 is at position 10: of the three tied at 19 visits it reached 19 first');
select is(pg_temp.f(pg_temp.prev(), 10, 'rank') || ',' || pg_temp.f(pg_temp.prev(), 10, 'is_tied') || ',' || pg_temp.f(pg_temp.prev(), 11, 'rank') || ',' || pg_temp.f(pg_temp.prev(), 11, 'is_tied'), '10,true,10,true', 'ties share rank 10 and are flagged tied');
select is(pg_temp.f(pg_temp.prev(), 10, 'visits_behind'), '1', 'position 10 is one visit behind position 9 (20 against 19)');
select is(pg_temp.f(pg_temp.prev(), 11, 'label'), 'F110 S.', 'position 11 is member 110 (second to reach 19)');
select pg_temp.claims(110, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,11,12', 'position 11: rows 1 to 10, the one above is in the list, the caller and the one below');
select is(pg_temp.f(pg_temp.prev(), 11, 'visits_behind'), '0', 'level with the position above: visits_behind 0');
select pg_temp.claims(111, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,11,12,13', 'position 12: rows 1 to 13');
select is(pg_temp.f(pg_temp.prev(), 12, 'label') || ',' || pg_temp.f(pg_temp.prev(), 12, 'visits_behind'), 'F111 S.,0', 'position 12 is member 111 (last to reach 19), level with the one above');
select pg_temp.claims(113, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,12,13,14', 'position 13: rows 1 to 10, a gap (position 11 is not returned), then 12, 13, 14');
select is(pg_temp.f(pg_temp.prev(), 13, 'visits_behind'), '1', 'position 13 (18 visits) is one behind position 12 (19)');
select pg_temp.claims(143, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,42,43', 'the last position: rows 1 to 10, the one above and the caller');
select is(pg_temp.f(pg_temp.prev(), 43, 'rank') || ',' || pg_temp.f(pg_temp.prev(), 43, 'is_tied') || ',' || pg_temp.f(pg_temp.prev(), 43, 'visits_behind'), '30,true,0', 'the fourteen members on 1 visit share rank 30 and are tied; the last is level with the one above');
select is(pg_temp.f(pg_temp.prev(), 42, 'label'), 'F142 S.', 'ties on 1 visit are ordered by the time the count was reached (member 142 before 143)');
select pg_temp.claims(130, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10,29,30,31', 'position 30 (first of the tie at 1 visit): neighbours 29 and 31');
select is(pg_temp.f(pg_temp.prev(), 30, 'visits_behind'), '1', 'one visit behind position 29 (2 against 1)');
select is(pg_temp.f(pg_temp.prev(), 30, 'rank'), '30', 'rank 30');

-- Competition rank over visits alone
select pg_temp.claims(101, 1, 'member');
select is(pg_temp.f(pg_temp.prev(), 9, 'rank'), '9', 'ranks before the tie are the positions');
select is(pg_temp.f(pg_temp.prev(), 9, 'is_tied'), 'false', 'a member alone on a count is not tied');

-- The tie across position 10 shows exactly the first 10 positions by the order
select is(pg_temp.f(pg_temp.prev(), 10, 'label'), 'F112 S.', 'position 10 of a caller at position 1 is the first of the three tied members to reach 19 (112)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where (e->>'position')::int > 10), 0, 'and neither of the other two tied members is returned');

-- Two viewers of the same gym see identical top-10 rows apart from is_self and visits_behind
create temp table top_101 as select (e - 'is_self' - 'visits_behind') as j, (e->>'position')::int as p from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where (e->>'position')::int <= 10;
select pg_temp.claims(135, 1, 'member');
create temp table top_135 as select (e - 'is_self' - 'visits_behind') as j, (e->>'position')::int as p from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where (e->>'position')::int <= 10;
select is((select count(*)::int from top_101 a join top_135 b using (p) where a.j = b.j), 10, 'two viewers of one gym see the same ten rows (apart from is_self and visits_behind)');

-- ============================================================================
-- Unranked caller
-- ============================================================================
select pg_temp.claims(150, 1, 'member');
select is(pg_temp.poslist(pg_temp.prev()), '1,2,3,4,5,6,7,8,9,10', 'an unranked caller gets the top 10 and no neighbours');
select is((select count(*)::int from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e where (e->>'is_self')::boolean), 0, 'no row is the caller''s');
select is((select string_agg(distinct e->>'self_ranked', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), 'false', 'self_ranked is false');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), '43', 'ranked_total is still 43');

-- ============================================================================
-- The month boundary and the current month (member 151: the last day of the previous month and the first of the current one)
-- ============================================================================
reset role;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  (pg_temp.id(1, 1), pg_temp.m(151), (pg_temp.prev_last() + time '23:30') at time zone 'Africa/Douala', (pg_temp.prev_last() + time '23:50') at time zone 'Africa/Douala', 'manual', pg_temp.prev_last()),
  (pg_temp.id(1, 1), pg_temp.m(151), (pg_temp.cur() + time '00:10') at time zone 'Africa/Douala', (pg_temp.cur() + time '00:30') at time zone 'Africa/Douala', 'manual', pg_temp.cur());
-- The current month: 101 three days, 102 two days, 103 one day (07:00 on day 1, after 151's 00:10).
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 1), pg_temp.m(n), ((pg_temp.cur() + (d - 1)) + time '07:00') at time zone 'Africa/Douala', ((pg_temp.cur() + (d - 1)) + time '07:20') at time zone 'Africa/Douala', 'manual', pg_temp.cur() + (d - 1)
from (values (101, 3), (102, 2), (103, 1)) v(n, c), generate_series(1, 3) d where d <= v.c;

select pg_temp.claims(151, 1, 'member');
select is(pg_temp.f(pg_temp.prev(), 44, 'is_self'), 'true', 'the last day of the previous month counts in the previous month (member 151 is now position 44 of 44, after the others who reached 1 visit earlier)');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), '44', 'the previous month ranks 44');
select is(pg_temp.poslist(pg_temp.cur()), '1,2,3,4', 'the current month: four members ranked, all shown');
select is(pg_temp.f(pg_temp.cur(), 3, 'is_self') || ',' || pg_temp.f(pg_temp.cur(), 3, 'visits') || ',' || pg_temp.f(pg_temp.cur(), 3, 'rank') || ',' || pg_temp.f(pg_temp.cur(), 3, 'visits_behind'), 'true,1,3,1',
  'the first day of the current month counts in the current month: 1 visit, rank 3 (00:10 is before 103''s 07:00 the same day), one behind the member above');
select is(pg_temp.f(pg_temp.cur(), 4, 'label') || ',' || pg_temp.f(pg_temp.cur(), 4, 'is_tied') || ',' || pg_temp.f(pg_temp.cur(), 4, 'rank'), 'F103 S.,true,3', 'the other member on 1 visit is tied at rank 3 and second in the order');
select is(pg_temp.f(pg_temp.cur(), 1, 'visits') || pg_temp.f(pg_temp.cur(), 2, 'visits'), '32', 'the current month is ranked on its own visits (3 and 2)');
select pg_temp.claims(117, 1, 'member');
select is(pg_temp.jb(pg_temp.cur())::text like '%"is_self": true%', false, 'a caller with no visit this month has no row of their own in the current month');
select is((select string_agg(distinct e->>'self_ranked', ',') from jsonb_array_elements(pg_temp.jb(pg_temp.cur())) e), 'false', 'and self_ranked is false there');

-- ============================================================================
-- Fewer than 3 ranked: one row, no name, no own row, no neighbours; both months
-- ============================================================================
select pg_temp.claims(201, 3, 'member');
select is(pg_temp.jb(pg_temp.cur()),
  jsonb_build_array(jsonb_build_object('position', null, 'rank', null, 'label', null, 'is_anonymous', false, 'visits', null, 'is_self', false, 'is_tied', false, 'visits_behind', null, 'ranked_total', 0, 'self_ranked', false)),
  '0 ranked: exactly one row with position, rank, label and visits NULL, ranked_total 0, self_ranked false');
select is(jsonb_array_length(pg_temp.jb(pg_temp.prev())), 1, '0 ranked in the previous month: one row as well');
reset role;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  (pg_temp.id(1, 3), pg_temp.m(202), (pg_temp.cur() + time '09:00') at time zone 'Africa/Douala', (pg_temp.cur() + time '09:30') at time zone 'Africa/Douala', 'manual', pg_temp.cur()),
  (pg_temp.id(1, 3), pg_temp.m(202), (pg_temp.prev() + time '09:00') at time zone 'Africa/Douala', (pg_temp.prev() + time '09:30') at time zone 'Africa/Douala', 'manual', pg_temp.prev());
select pg_temp.claims(201, 3, 'member');
select is(pg_temp.selfrow(pg_temp.cur(), 'x'), null, 'one ranked (another member): no own row for the unranked caller');
select is((pg_temp.jb(pg_temp.cur())->0->>'ranked_total') || ',' || (pg_temp.jb(pg_temp.cur())->0->>'self_ranked') || ',' || jsonb_array_length(pg_temp.jb(pg_temp.cur())), '1,false,1', '1 ranked and the caller is not: ranked_total 1, self_ranked false, one row');
select is((pg_temp.jb(pg_temp.prev())->0->>'ranked_total') || ',' || jsonb_array_length(pg_temp.jb(pg_temp.prev())), '1,1', 'the same in the previous month');
select pg_temp.claims(202, 3, 'member');
select is((pg_temp.jb(pg_temp.cur())->0->>'ranked_total') || ',' || (pg_temp.jb(pg_temp.cur())->0->>'self_ranked') || ',' || (pg_temp.jb(pg_temp.cur())->0->>'label' is null) || ',' || (pg_temp.jb(pg_temp.cur())->0->>'visits' is null) || ',' || (pg_temp.jb(pg_temp.cur())->0->>'is_self'),
  '1,true,true,true,false', 'the only ranked member: ranked_total 1, self_ranked true, and still no label, no visits, is_self false (no name, no own row)');
reset role;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  (pg_temp.id(1, 3), pg_temp.m(201), (pg_temp.cur() + time '10:00') at time zone 'Africa/Douala', (pg_temp.cur() + time '10:30') at time zone 'Africa/Douala', 'manual', pg_temp.cur()),
  (pg_temp.id(1, 3), pg_temp.m(201), (pg_temp.prev() + time '10:00') at time zone 'Africa/Douala', (pg_temp.prev() + time '10:30') at time zone 'Africa/Douala', 'manual', pg_temp.prev());
select pg_temp.claims(203, 3, 'member');
select is((pg_temp.jb(pg_temp.cur())->0->>'ranked_total') || ',' || (pg_temp.jb(pg_temp.cur())->0->>'self_ranked') || ',' || jsonb_array_length(pg_temp.jb(pg_temp.cur())), '2,false,1', '2 ranked, caller unranked: one row, ranked_total 2, nothing to tell the two apart');
select is((pg_temp.jb(pg_temp.prev())->0->>'ranked_total') || ',' || jsonb_array_length(pg_temp.jb(pg_temp.prev())), '2,1', 'the rule applies to the previous month too');
select pg_temp.claims(201, 3, 'member');
select is((pg_temp.jb(pg_temp.cur())->0->>'self_ranked') || ',' || (pg_temp.jb(pg_temp.cur())->0->>'label' is null), 'true,true', '2 ranked, the caller one of them: self_ranked true and still no label');
reset role;
-- The third ranked row is the Owner of the gym: a staff row with counted visits ranks (eligibility is the epic's literal rule: not deactivated, not support).
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day) values
  (pg_temp.id(1, 3), pg_temp.m(204), (pg_temp.cur() + time '11:00') at time zone 'Africa/Douala', (pg_temp.cur() + time '11:30') at time zone 'Africa/Douala', 'manual', pg_temp.cur());
select pg_temp.claims(203, 3, 'member');
select is(pg_temp.poslist(pg_temp.cur()), '1,2,3', '3 ranked: the board shows (the staff row with a counted visit is ranked: a decision recorded in decisions.md)');
select is((pg_temp.jb(pg_temp.cur())->0->>'label') || ',' || (pg_temp.jb(pg_temp.cur())->1->>'label') || ',' || (pg_temp.jb(pg_temp.cur())->2->>'label'), 'C2 B.,C1 A.,C4 D.', 'ordered by the time each reached the one visit (09:00, 10:00, 11:00)');

-- ============================================================================
-- The label rule
-- ============================================================================
reset role;
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 4), pg_temp.m(n), (pg_temp.cur() + time '06:00' + (n - 300) * interval '1 minute') at time zone 'Africa/Douala', (pg_temp.cur() + time '06:30' + (n - 300) * interval '1 minute') at time zone 'Africa/Douala', 'manual', pg_temp.cur()
from generate_series(301, 306) n;
select pg_temp.claims(301, 4, 'member');
select is(pg_temp.f(pg_temp.cur(), 1, 'label'), 'CHANTAL N.', 'first token, a space, the initial of the last token and a period, in the stored capitals');
select is(pg_temp.f(pg_temp.cur(), 2, 'label'), 'MADONNA', 'a single-token name stands alone: no period, no initial');
select is(pg_temp.f(pg_temp.cur(), 3, 'label'), 'Jean M.', 'four tokens: the first and the initial of the LAST');
select is(pg_temp.f(pg_temp.cur(), 4, 'label'), 'LUC A.', 'surrounding and repeated spaces do not matter');
select is(pg_temp.f(pg_temp.cur(), 5, 'label'), 'ÉLODIE É.', 'an accented initial is one character');
select is(pg_temp.f(pg_temp.cur(), 6, 'label'), 'jean p.', 'the capitalisation is the one stored (no upper-casing)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.jb(pg_temp.cur())) e where (e->>'is_anonymous')::boolean), 0, 'nobody is anonymous in this gym (every member chose on the notice)');
select is(pg_temp.selfrow(pg_temp.cur(), 'label'), 'CHANTAL N.', 'the caller''s own row carries the label as others see it');

-- The preview of the member's own label (my_leaderboard_settings().own_label, the notice and the Profile helper) is a second copy of the rule: for every
-- name shape it equals the label the same member has on the board (one token, four tokens, padded spaces, an accented initial, the stored case).
create function pg_temp.own(p_n int) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.claims(p_n, 4, 'member');
  set local role authenticated;
  select s.own_label into v from public.my_leaderboard_settings() s;
  reset role;
  return v;
end $f$;
select is((select array_agg(pg_temp.own(n) order by n) from generate_series(301, 306) n),
  array['CHANTAL N.', 'MADONNA', 'Jean M.', 'LUC A.', 'ÉLODIE É.', 'jean p.'], 'own_label: every name shape previews the label the rule gives (one token alone, last-token initial, trimmed, accented, stored case)');
select pg_temp.claims(301, 4, 'member');
select is((select array_agg(pg_temp.own(n) order by n) from generate_series(301, 306) n),
  (select array_agg(e->>'label' order by (e->>'position')::int) from jsonb_array_elements(pg_temp.jb(pg_temp.cur())) e), 'and each own_label equals the label the board shows other members for that member');

-- ============================================================================
-- The tie rule: equal visits are ordered by the time the member REACHED the count, the earliest check-in of their last (Nth) distinct visit day.
-- Gym E: P has 5 visits; A and B tie on 3. A started first (day 1 at 06:00 against 11:00) but reached 3 later (day 3 at 10:00 against 09:00), so B is
-- position 2. Ordering by the first day, by the month's earliest check-in, or by the last day descending would put A first.
-- ============================================================================
reset role;
insert into gyms (id, name, tier_id, status, timezone) values (pg_temp.id(1, 5), 'LBR Gym E', pg_temp.id(0, 1), 'active', 'Africa/Douala');
insert into members (id, gym_id, user_id, role, name, join_date) values
  (pg_temp.m(351), pg_temp.id(1, 5), pg_temp.id(2, 351), 'member', 'XP Prime', date '2026-01-05'),
  (pg_temp.m(352), pg_temp.id(1, 5), pg_temp.id(2, 352), 'member', 'XA Alpha', date '2026-01-05'),
  (pg_temp.m(353), pg_temp.id(1, 5), pg_temp.id(2, 353), 'member', 'XB Bravo', date '2026-01-05');
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_notice_seen_at = now() where gym_id = pg_temp.id(1, 5);
select set_config('app.leaderboard_write', 'off', true);
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select pg_temp.id(1, 5), pg_temp.m(v.n), ((pg_temp.prev() + v.d) + v.t) at time zone 'Africa/Douala', ((pg_temp.prev() + v.d) + v.t + interval '20 minutes') at time zone 'Africa/Douala', 'manual', pg_temp.prev() + v.d
from (values (351, 0, time '08:00'), (351, 1, time '08:00'), (351, 2, time '08:00'), (351, 3, time '08:00'), (351, 4, time '08:00'),
             (352, 0, time '06:00'), (352, 1, time '08:00'), (352, 2, time '10:00'),
             (353, 0, time '11:00'), (353, 1, time '08:00'), (353, 2, time '09:00')) v(n, d, t);
select pg_temp.claims(351, 5, 'member');
select is((select string_agg(e->>'label', ',' order by (e->>'position')::int) from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), 'XP P.,XB B.,XA A.',
  'tie on 3 visits: B reached the count first (day 3 at 09:00 against 10:00) so B is position 2, although A checked in first on day 1');
select is((select string_agg((e->>'rank') || ':' || (e->>'is_tied'), ',' order by (e->>'position')::int) from jsonb_array_elements(pg_temp.jb(pg_temp.prev())) e), '1:false,2:true,2:true',
  'the two share rank 2 and are tied; the order between them is the reached-at time only');

-- ============================================================================
-- Month validation (after the caller is known to be a live member)
-- ============================================================================
select pg_temp.claims(117, 1, 'member');
select is(pg_temp.jb(pg_temp.cur() + 14)->>'error', '22023:invalid_month', 'a month that is not the first of a month is refused (22023 invalid_month)');
select is(pg_temp.jb(null)->>'error', '22023:invalid_month', 'a NULL month is refused');
select is(pg_temp.jb((pg_temp.prev() - interval '1 month')::date)->>'error', '22023:invalid_month', 'two months back is refused');
select is(pg_temp.jb((pg_temp.cur() + interval '1 month')::date)->>'error', '22023:invalid_month', 'next month is refused');
select is(pg_temp.jb((pg_temp.cur() + interval '5 years')::date)->>'error', '22023:invalid_month', 'a month years ahead is refused');
select is(pg_temp.jb(pg_temp.cur())->>'error', null, 'the current month is accepted');
select is(pg_temp.jb(pg_temp.prev())->>'error', null, 'the previous month is accepted');
-- A caller who is not a live member learns nothing about months: an empty result, no error, even for a bad month.
select pg_temp.claims(1, 1, 'owner');
select is(pg_temp.jb(date '2020-01-15')::text, '[]', 'a caller with no member row gets an empty result even for an invalid month (no month probing)');

-- ============================================================================
-- The month bound follows private.gym_today (the gym's clock), not the database clock: the day is replaced inside this transaction
-- by a fixed one, far from today. A body using current_date would accept the real current month and refuse the stubbed one.
-- ============================================================================
create or replace function private.gym_today(p_gym_id uuid) returns date language sql stable as $f$ select date '2031-01-15' $f$;
select pg_temp.claims(117, 1, 'member');
select is(pg_temp.jb(date '2031-01-01')->>'error', null, 'clock 2031-01-15: the gym''s current month (2031-01-01) is accepted');
select is(pg_temp.jb(date '2030-12-01')->>'error', null, 'and the previous month (2030-12-01)');
select is(pg_temp.jb(pg_temp.cur())->>'error', '22023:invalid_month', 'the real current month is refused (it is before the gym''s previous month)');
select is(pg_temp.jb(date '2031-02-01')->>'error', '22023:invalid_month', 'the month after the gym''s current month is refused');
select is(pg_temp.jb(date '2030-11-01')->>'error', '22023:invalid_month', 'two months before the gym''s current month is refused');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_visit_days(date '2031-01-01')$$), '0', 'my_visit_days: the gym''s current month (2031-01-01) is accepted');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_visit_days(date '2031-02-01')$$), '22023:invalid_month', 'my_visit_days: the month after the gym''s current month is refused');
create or replace function private.gym_today(p_gym_id uuid) returns date language sql stable as $f$ select date '2020-06-15' $f$;
select is(pg_temp.asrole('authenticated', format('select count(*)::text from public.my_visit_days(%L)', pg_temp.cur())), '22023:invalid_month', 'clock 2020-06-15: my_visit_days refuses the real current month (a body using current_date would accept it)');
select is(pg_temp.asrole('authenticated', $$select count(*)::text from public.my_visit_days(date '2020-06-01')$$), '0', 'and accepts the gym''s own current month (2020-06-01)');
select is(pg_temp.jb(date '2020-06-01')->>'error', null, 'gym_leaderboard accepts the gym''s own current month under that clock too');

select * from finish();
rollback;
