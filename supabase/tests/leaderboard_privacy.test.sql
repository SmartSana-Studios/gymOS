-- Story 30.6 (FR-227, FR-228, NFR-001, NFR-027): leaderboard privacy, one block per read path (migration 0188).
--
--   path 1  public.gym_leaderboard(current month)       as viewer V of gym A
--   path 2  public.gym_leaderboard(previous month)      as viewer V of gym A (the second tab)
--   path 3  public.my_leaderboard_settings()
--   path 4  the Home card's use of gym_leaderboard(current month): a member who has NOT seen the notice reads only their own standing
--
-- Fixture, gym A: V (visible, the viewer), M1 (hidden), M2 (notice unseen), M3 (visible), M4 (deactivated, with visits), M5 (a GymOS Support
-- row, with visits). Ranked in each month: M1 (4 visits), M2 (3), M3 (2), V (1). M4 and M5 hold 5 visits and would top the board.
-- Gym B has its own three ranked members (BEATRICE, BENOIT, BERENICE); gym S is suspended.
--
-- Proved per path: M1 and M2 appear as 'Anonymous' with their rank and visits intact; M3 by label; M4 and M5 not at all; no result contains a
-- name token of M1, M2, M4 or M5 or the id or user id of any member; flipping M1 to visible changes only M1's label on V's next call (nothing
-- is stored or cached); a viewer of gym B never receives a gym A row and the other way round; every caller who is not a live member of an
-- active gym gets an empty result; and the function bodies are read-only.
--
-- Fixture ids: 00000000-0000-0000-0041-nnnnnnnnnnnn.

begin;
select plan(58);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0041-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
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
create function pg_temp.settings() returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role authenticated;
  begin
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from public.my_leaderboard_settings() r;
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return v;
end $f$;
-- The result of a call as a role that may not be allowed to call it: the row count, or sqlstate:message.
create function pg_temp.rowcount(p_role text, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', p_role);
  begin
    execute 'select count(*)::text from ' || p_sql into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;
-- Forbidden strings in a result: name tokens of the members who must never be named, and every member id and user id of the fixture.
create function pg_temp.leaks(p_txt text) returns int language sql as $f$
  select (select count(*)::int from unnest(array['ZEBULON', 'QUARTZ', 'YOLANDE', 'PRISM', 'WILHELM', 'NICKEL', 'GYMOS']) t where upper(p_txt) like '%' || t || '%')
       + (select count(*)::int from members m where p_txt like '%' || m.id::text || '%' or p_txt like '%' || m.user_id::text || '%') $f$;
-- One row of a board by position, as jsonb.
create function pg_temp.row_at(p_board jsonb, p_pos int) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_board) e where (e->>'position')::int = p_pos $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'LBP Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'LBP Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'LBP Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'LBP Gym S (suspended)', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
create temp table cfg as
  select date_trunc('month', private.gym_today(pg_temp.id(1, 1)))::date as cur,
         (date_trunc('month', private.gym_today(pg_temp.id(1, 1))) - interval '1 month')::date as prev;
create function pg_temp.cur() returns date language sql as $f$ select cur from cfg $f$;
create function pg_temp.prev() returns date language sql as $f$ select prev from cfg $f$;

insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'lbp-' || n || '@x.example', now() from generate_series(1, 40) n;
-- Gym A: 1 viewer V, 2 M1, 3 M2, 4 M3, 5 M4 (deactivated), 6 owner, 7 manager, 8 supervisor, 9 receptionist, 10 coach, 11 M5 (support, below).
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at) values
  (pg_temp.m(1), pg_temp.id(1, 1), pg_temp.id(2, 1), 'member', 'VALERIE UMBER', date '2026-01-05', null),
  (pg_temp.m(2), pg_temp.id(1, 1), pg_temp.id(2, 2), 'member', 'ZEBULON QUARTZ', date '2026-01-05', null),
  (pg_temp.m(3), pg_temp.id(1, 1), pg_temp.id(2, 3), 'member', 'YOLANDE PRISM', date '2026-01-05', null),
  (pg_temp.m(4), pg_temp.id(1, 1), pg_temp.id(2, 4), 'member', 'XAVIER OPAL', date '2026-01-05', null),
  (pg_temp.m(5), pg_temp.id(1, 1), pg_temp.id(2, 5), 'member', 'WILHELM NICKEL', date '2026-01-05', now()),
  (pg_temp.m(6), pg_temp.id(1, 1), pg_temp.id(2, 6), 'owner', 'OLIVIA OWNER', date '2026-01-05', null),
  (pg_temp.m(7), pg_temp.id(1, 1), pg_temp.id(2, 7), 'manager', 'MARCEL MANAGER', date '2026-01-05', null),
  (pg_temp.m(8), pg_temp.id(1, 1), pg_temp.id(2, 8), 'supervisor', 'SANDRA SUPER', date '2026-01-05', null),
  (pg_temp.m(9), pg_temp.id(1, 1), pg_temp.id(2, 9), 'receptionist', 'REMI RECEPTION', date '2026-01-05', null),
  (pg_temp.m(10), pg_temp.id(1, 1), pg_temp.id(2, 10), 'coach', 'COLETTE COACH', date '2026-01-05', null),
  (pg_temp.m(20), pg_temp.id(1, 2), pg_temp.id(2, 20), 'member', 'BEATRICE BELL', date '2026-01-05', null),
  (pg_temp.m(21), pg_temp.id(1, 2), pg_temp.id(2, 21), 'member', 'BENOIT BARRE', date '2026-01-05', null),
  (pg_temp.m(22), pg_temp.id(1, 2), pg_temp.id(2, 22), 'member', 'BERENICE BOUTIN', date '2026-01-05', null),
  (pg_temp.m(30), pg_temp.id(1, 3), pg_temp.id(2, 30), 'member', 'SUSPENDED MEMBER', date '2026-01-05', null);
-- M5: a GymOS Support person with a live assignment to gym A, a session, and a real support members row.
insert into private.support_accounts (user_id, activated_at) values (pg_temp.id(2, 11), now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values (pg_temp.id(9, 1), pg_temp.id(2, 11), pg_temp.id(1, 1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.id(8, 1), pg_temp.id(2, 11), now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values (pg_temp.id(8, 1), pg_temp.id(2, 11), now(), now());
select private.support_set_membership(pg_temp.id(9, 1), true);

-- Preferences. Everyone has chosen on the notice except M2; M1 is hidden. (The flag is the one the two writers switch.)
select set_config('app.leaderboard_write', 'on', true);
update member_preferences set leaderboard_notice_seen_at = now() where gym_id in (pg_temp.id(1, 1), pg_temp.id(1, 2), pg_temp.id(1, 3)) and member_id <> pg_temp.m(3);
update member_preferences set leaderboard_hidden = true where member_id = pg_temp.m(2);
select set_config('app.leaderboard_write', 'off', true);

-- Visits, in both months: day 1..v of the month.
create function pg_temp.visit_rows(p_month date, p_gym int, p_member uuid, p_days int) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select pg_temp.id(1, p_gym), p_member, ((p_month + (d - 1)) + time '08:00') at time zone 'Africa/Douala', ((p_month + (d - 1)) + time '08:30') at time zone 'Africa/Douala', 'manual', p_month + (d - 1)
  from generate_series(1, p_days) d;
end $f$;
select pg_temp.visit_rows(mo, 1, pg_temp.m(n), v) from (values (2, 4), (3, 3), (4, 2), (1, 1)) x(n, v), (select cur as mo from cfg union all select prev from cfg) mm;
-- M4 (deactivated) and M5 (the support row) hold five visits each, more than anyone: they would be on top if they were ranked.
select pg_temp.visit_rows(mo, 1, mid, 5)
from (select pg_temp.m(5) as mid union all select id from members where user_id = pg_temp.id(2, 11) and gym_id = pg_temp.id(1, 1)) x,
     (select cur as mo from cfg union all select prev from cfg) mm;
-- Gym B: three ranked members with distinct counts, in both months.
select pg_temp.visit_rows(mo, 2, pg_temp.m(n), v) from (values (20, 3), (21, 2), (22, 1)) x(n, v), (select cur as mo from cfg union all select prev from cfg) mm;
-- Gym S (suspended) holds a member with visits.
select pg_temp.visit_rows(pg_temp.cur(), 3, pg_temp.m(30), 2);


create function pg_temp.at(p_board jsonb, p_pos int, p_key text) returns text language sql as $f$
  select e->>p_key from jsonb_array_elements(p_board) e where (e->>'position')::int = p_pos $f$;
-- Does a text hold any of these tokens (case-insensitive)?
create function pg_temp.has_any(p_txt text, p_tokens text[]) returns boolean language sql as $f$
  select exists (select 1 from unnest(p_tokens) t where upper(p_txt) like '%' || upper(t) || '%') $f$;
-- A call as one authenticated user; the board and the settings, as text.
create function pg_temp.both(p_n int, p_gym int, p_app_role text) returns text language plpgsql as $f$
begin
  perform pg_temp.claims(p_n, p_gym, p_app_role);
  return pg_temp.jb(pg_temp.cur())::text || '|' || pg_temp.jb(pg_temp.prev())::text || '|' || pg_temp.settings()::text;
end $f$;
-- As a member: set_leaderboard_visibility / mark_leaderboard_notice_seen.
create function pg_temp.act(p_sql text) returns text language plpgsql as $f$
begin
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return 'ok';
end $f$;

-- ============================================================================
-- Static: the two reads are read-only and STABLE; neither is a support capability
-- ============================================================================
select is((select array_agg(p.proname::text || ':' || p.provolatile::text order by p.proname) from pg_proc p where p.oid in ('public.gym_leaderboard(date)'::regprocedure, 'public.my_leaderboard_settings()'::regprocedure)),
  array['gym_leaderboard:s', 'my_leaderboard_settings:s'], 'both reads are STABLE');
select is((select count(*)::int from pg_proc p where p.oid in ('public.gym_leaderboard(date)'::regprocedure, 'public.my_leaderboard_settings()'::regprocedure)
            and (p.prosrc ~* '(^|[^a-z_])(insert|update|delete|truncate)([^a-z_]|$)' or p.prosrc ~* 'supervisor' or p.prosrc ~* 'set_config')), 0,
  'neither body has an INSERT, UPDATE, DELETE or set_config, and neither names the supervisor role');
select is((select count(*)::int from private.support_capabilities where object_name in ('gym_leaderboard', 'my_leaderboard_settings', 'set_leaderboard_visibility', 'mark_leaderboard_notice_seen')), 0, 'none of the four is registered as a support capability');

-- ============================================================================
-- Path 1: gym_leaderboard(current month), viewer V of gym A
-- ============================================================================
select pg_temp.claims(1, 1, 'member');
create temp table b_cur as select pg_temp.jb(pg_temp.cur()) as j;
select is(jsonb_array_length((select j from b_cur)), 4, 'path 1: four rows: M1, M2, M3 and the viewer (M4 and M5 are not on the board)');
select is(pg_temp.at((select j from b_cur), 1, 'label') || ',' || pg_temp.at((select j from b_cur), 1, 'is_anonymous') || ',' || pg_temp.at((select j from b_cur), 1, 'rank') || ',' || pg_temp.at((select j from b_cur), 1, 'visits'),
  'Anonymous,true,1,4', 'path 1: M1 (hidden) is Anonymous with rank 1 and 4 visits intact');
select is(pg_temp.at((select j from b_cur), 2, 'label') || ',' || pg_temp.at((select j from b_cur), 2, 'is_anonymous') || ',' || pg_temp.at((select j from b_cur), 2, 'rank') || ',' || pg_temp.at((select j from b_cur), 2, 'visits'),
  'Anonymous,true,2,3', 'path 1: M2 (notice unseen) is Anonymous with rank 2 and 3 visits intact');
select is(pg_temp.at((select j from b_cur), 3, 'label') || ',' || pg_temp.at((select j from b_cur), 3, 'is_anonymous') || ',' || pg_temp.at((select j from b_cur), 3, 'visits'),
  'XAVIER O.,false,2', 'path 1: M3 (visible) is shown by label');
select is(pg_temp.at((select j from b_cur), 4, 'label') || ',' || pg_temp.at((select j from b_cur), 4, 'is_self'), 'VALERIE U.,true', 'path 1: the viewer''s own row carries the label as others see it');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements((select j from b_cur)) e), '4', 'path 1: ranked_total counts M1, M2, M3 and the viewer only');
select is(pg_temp.leaks((select j::text from b_cur)), 0, 'path 1: no name token of M1, M2, M4 or M5 and no member id or user id in the result');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements((select j from b_cur)) e) z),
  array['is_anonymous', 'is_self', 'is_tied', 'label', 'position', 'rank', 'ranked_total', 'self_ranked', 'visits', 'visits_behind'], 'path 1: the keys are exactly the allow-list');

-- Two viewers of one gym see the same rows apart from is_self and visits_behind
select pg_temp.claims(4, 1, 'member');
create temp table b_cur_m3 as select pg_temp.jb(pg_temp.cur()) as j;
select is((select jsonb_agg(e - 'is_self' - 'visits_behind' order by (e->>'position')::int) from jsonb_array_elements((select j from b_cur_m3)) e),
          (select jsonb_agg(e - 'is_self' - 'visits_behind' order by (e->>'position')::int) from jsonb_array_elements((select j from b_cur)) e),
          'path 1: M3 and V receive identical rows apart from is_self and visits_behind');
select is(pg_temp.at((select j from b_cur_m3), 3, 'label'), 'XAVIER O.', 'path 1: M3 sees their own row as others do (visible)');

-- Flipping M1 to visible changes only M1's label on V's next call (nothing is stored or cached)
select pg_temp.claims(2, 1, 'member');
select is(pg_temp.act('select public.set_leaderboard_visibility(false)'), 'ok', 'M1 chooses to be visible');
select pg_temp.claims(1, 1, 'member');
create temp table b_cur_flip as select pg_temp.jb(pg_temp.cur()) as j;
select is(pg_temp.at((select j from b_cur_flip), 1, 'label') || ',' || pg_temp.at((select j from b_cur_flip), 1, 'is_anonymous'), 'ZEBULON Q.,false', 'path 1: V''s next call shows M1 by label');
select is((select jsonb_agg(e order by (e->>'position')::int) from jsonb_array_elements((select j from b_cur_flip)) e where (e->>'position')::int > 1),
          (select jsonb_agg(e order by (e->>'position')::int) from jsonb_array_elements((select j from b_cur)) e where (e->>'position')::int > 1),
          'path 1: every other row is unchanged');
select is(pg_temp.at((select j from b_cur_flip), 1, 'rank') || pg_temp.at((select j from b_cur_flip), 1, 'visits'), '14', 'path 1: and M1''s rank and visits are unchanged');
select pg_temp.claims(2, 1, 'member');
select is(pg_temp.act('select public.set_leaderboard_visibility(true)'), 'ok', 'M1 hides again');
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.jb(pg_temp.cur()), (select j from b_cur), 'path 1: V''s next call is back to the original board: a hide leaves no name behind');

-- ============================================================================
-- Path 2: gym_leaderboard(previous month), viewer V
-- ============================================================================
create temp table b_prev as select pg_temp.jb(pg_temp.prev()) as j;
select is(jsonb_array_length((select j from b_prev)), 4, 'path 2: four rows in the previous month too');
select is(pg_temp.at((select j from b_prev), 1, 'label') || pg_temp.at((select j from b_prev), 2, 'label'), 'AnonymousAnonymous', 'path 2: M1 and M2 are Anonymous');
select is(pg_temp.at((select j from b_prev), 1, 'rank') || pg_temp.at((select j from b_prev), 1, 'visits') || pg_temp.at((select j from b_prev), 2, 'rank') || pg_temp.at((select j from b_prev), 2, 'visits'), '1423', 'path 2: with rank and visits intact');
select is(pg_temp.at((select j from b_prev), 3, 'label'), 'XAVIER O.', 'path 2: M3 by label');
select is(pg_temp.leaks((select j::text from b_prev)), 0, 'path 2: no name token of M1, M2, M4 or M5 and no id in the result');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements((select j from b_prev)) e), '4', 'path 2: M4 and M5 are not ranked');

-- ============================================================================
-- Path 3: my_leaderboard_settings()
-- ============================================================================
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.settings(), jsonb_build_array(jsonb_build_object('hidden', false, 'notice_seen', true, 'own_label', 'VALERIE U.')), 'path 3: V reads their own settings and the preview of their own label');
select is(pg_temp.has_any(pg_temp.settings()::text, array['ZEBULON', 'YOLANDE', 'XAVIER', 'WILHELM', 'GYMOS', 'BEATRICE']), false, 'path 3: no other member''s name');
select is(pg_temp.leaks(pg_temp.settings()::text), 0, 'path 3: no member id or user id');
select pg_temp.claims(2, 1, 'member');
select is(pg_temp.settings(), jsonb_build_array(jsonb_build_object('hidden', true, 'notice_seen', true, 'own_label', 'ZEBULON Q.')), 'path 3: M1 (hidden) reads hidden true and the preview of their own label (the label as if visible)');
select pg_temp.claims(3, 1, 'member');
select is(pg_temp.settings(), jsonb_build_array(jsonb_build_object('hidden', false, 'notice_seen', false, 'own_label', 'YOLANDE P.')), 'path 3: M2 (notice unseen) reads notice_seen false');
select is(pg_temp.has_any(pg_temp.settings()::text, array['ZEBULON', 'XAVIER', 'VALERIE', 'WILHELM', 'GYMOS']), false, 'path 3: and no one else''s name');
select is((select array_agg(k order by k) from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(pg_temp.settings()) e) z), array['hidden', 'notice_seen', 'own_label'], 'path 3: the keys are exactly hidden, notice_seen, own_label');

-- ============================================================================
-- Path 4: the Home card's use of gym_leaderboard, by a member who has NOT seen the notice (M2)
-- ============================================================================
select pg_temp.claims(3, 1, 'member');
create temp table b_home as select pg_temp.jb(pg_temp.cur()) as j;
select is((select e->>'rank' || ',' || (e->>'ranked_total') || ',' || (e->>'visits_behind') || ',' || (e->>'self_ranked') from jsonb_array_elements((select j from b_home)) e where (e->>'is_self')::boolean), '2,4,1,true',
  'path 4: M2 still sees their own rank 2 of 4 and one visit behind, although the notice is unseen');
select is((select e->>'label' || ',' || (e->>'is_anonymous') from jsonb_array_elements((select j from b_home)) e where (e->>'is_self')::boolean), 'Anonymous,true', 'path 4: the server marks M2 Anonymous (the card never shows a name)');
select is(pg_temp.leaks((select j::text from b_home)), 0, 'path 4: nothing of M1, M2, M4 or M5 by name and no id reaches the device');
select is(pg_temp.has_any((select j::text from b_home), array['XAVIER', 'VALERIE']), true, 'path 4: control: M3''s and V''s labels are in the same result (they chose to be named), so the scan is live');

-- ============================================================================
-- No cross-gym rows
-- ============================================================================
select pg_temp.claims(20, 2, 'member');
create temp table b_gym_b as select pg_temp.jb(pg_temp.cur()) as j, pg_temp.jb(pg_temp.prev()) as jp, pg_temp.settings() as s;
select is((select string_agg(e->>'label', ',' order by (e->>'position')::int) from jsonb_array_elements((select j from b_gym_b)) e), 'BEATRICE B.,BENOIT B.,BERENICE B.', 'gym B: a viewer of gym B sees gym B''s three ranked members');
select is(pg_temp.has_any((select j::text || jp::text || s::text from b_gym_b), array['VALERIE', 'UMBER', 'ZEBULON', 'YOLANDE', 'XAVIER', 'OPAL', 'WILHELM', 'GYMOS', '"Anonymous"']), false, 'gym B: no gym A name, and no Anonymous row (none of them is hidden)');
select is((select string_agg(distinct e->>'ranked_total', ',') from jsonb_array_elements((select j from b_gym_b)) e), '3', 'gym B: ranked_total is gym B''s');
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.has_any(pg_temp.jb(pg_temp.cur())::text || pg_temp.jb(pg_temp.prev())::text, array['BEATRICE', 'BENOIT', 'BERENICE', 'BELL', 'BARRE', 'BOUTIN', 'SUSPENDED']), false, 'gym A: a viewer of gym A never sees a gym B or gym S row');

-- ============================================================================
-- Callers who are not a live member of an active gym get an empty result (both reads, both months)
-- ============================================================================
select is(pg_temp.both(6, 1, 'owner'), '[]|[]|[]', 'an Owner gets an empty result');
select is(pg_temp.both(7, 1, 'manager'), '[]|[]|[]', 'a Manager gets an empty result');
select is(pg_temp.both(8, 1, 'supervisor'), '[]|[]|[]', 'a Supervisor gets an empty result');
select is(pg_temp.both(9, 1, 'receptionist'), '[]|[]|[]', 'a Receptionist gets an empty result');
select is(pg_temp.both(10, 1, 'coach'), '[]|[]|[]', 'a Coach gets an empty result');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 11), 'role', 'authenticated', 'aal', 'aal2', 'session_id', pg_temp.id(8, 1), 'app_role', 'support', 'gym_id', pg_temp.id(1, 1))::text, true);
select is(pg_temp.jb(pg_temp.cur())::text || '|' || pg_temp.jb(pg_temp.prev())::text || '|' || pg_temp.settings()::text, '[]|[]|[]', 'a GymOS Support session (with its own members row and visits) gets an empty result');
select is(pg_temp.both(5, 1, 'member'), '[]|[]|[]', 'a deactivated member whose token still says member gets an empty result');
select is(pg_temp.both(30, 3, 'member'), '[]|[]|[]', 'a member of a suspended gym gets an empty result');
select is(pg_temp.both(6, 1, 'member'), '[]|[]|[]', 'an Owner holding a forged member claim gets an empty result (the role is read live)');
select is(pg_temp.both(20, 1, 'member'), '[]|[]|[]', 'a member of gym B presenting gym A''s claim gets an empty result');
select is(pg_temp.both(1, 0, 'member'), '[]|[]|[]', 'a member with no gym claim gets an empty result');
select is(pg_temp.both(40, 1, 'member'), '[]|[]|[]', 'a user with no members row gets an empty result');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.rowcount('anon', 'public.gym_leaderboard(date ''2026-01-01'')'), '42501:permission denied for function gym_leaderboard', 'anon cannot execute gym_leaderboard');
select is(pg_temp.rowcount('anon', 'public.my_leaderboard_settings()'), '42501:permission denied for function my_leaderboard_settings', 'anon cannot execute my_leaderboard_settings');
select is(pg_temp.rowcount('service_role', 'public.gym_leaderboard(date ''2026-01-01'')'), '42501:permission denied for function gym_leaderboard', 'service_role cannot execute it either');

-- ============================================================================
-- After M2 chooses on the notice, V's next call names M2 (and only M2's row changed)
-- ============================================================================
select pg_temp.claims(3, 1, 'member');
select is(pg_temp.act('select public.mark_leaderboard_notice_seen()'), 'ok', 'M2 chooses on the notice (Show my name)');
select pg_temp.claims(1, 1, 'member');
select is(pg_temp.at(pg_temp.jb(pg_temp.cur()), 2, 'label'), 'YOLANDE P.', 'V''s next call shows M2 by label');
select is((select jsonb_agg(e order by (e->>'position')::int) from jsonb_array_elements(pg_temp.jb(pg_temp.cur())) e where (e->>'position')::int <> 2),
          (select jsonb_agg(e order by (e->>'position')::int) from jsonb_array_elements((select j from b_cur)) e where (e->>'position')::int <> 2), 'and no other row changed');

select * from finish();
rollback;
