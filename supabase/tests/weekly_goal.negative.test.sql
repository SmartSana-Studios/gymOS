-- Story 30.1: refusals for set_weekly_goal(smallint) and my_weekly_goal() (migration 0184). Positive paths and the history trigger live in
-- weekly_goal.test.sql.
--
-- Covers: an Owner, Manager, Supervisor, Receptionist, Coach, a GymOS Support session, an anonymous caller, a caller with no gym claim, a deactivated
-- member whose token still says member, a member of a suspended gym, an Owner holding a forged member claim and a member of gym B presenting gym A's
-- claim: writes refused, reads return no row, and no member_weekly_goals row appears for anyone. The privilege matrix, the direct table refusals and the
-- source scans (no support registration, no forbidden names, the exact suspension guard text).
--
-- Fixtures: a gym is seeded `status = 'suspended'` IN ITS INSERT (an UPDATE of gyms.status silently reverts). Every member has a real members row.
-- Fixture ids: 00000000-0000-0000-0030-0000000003xx.

begin;
select plan(53);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000003' || lpad(to_hex(16 + n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000032' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0030-0000000033' || lpad(to_hex(n), 2, '0'))::uuid $f$;

create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

-- set_weekly_goal(4) as `role`: the goal returned, or sqlstate:message.
create function pg_temp.setg(p_role text, p_n int) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', p_role);
  begin
    select r.goal::text into v from set_weekly_goal(4::smallint) r;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return coalesce(v, 'null');
end $f$;

-- Rows my_weekly_goal() returns as `role`, or the error.
create function pg_temp.myg(p_role text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', p_role);
  begin
    select count(*)::text into v from my_weekly_goal();
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

create function pg_temp.as_user(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform pg_temp.claims(pg_temp.u(p_n), case when p_gym is null then null else pg_temp.g(p_gym) end, p_app_role);
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0030-000000000301', 'WGN Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.g(1), 'WGN Gym A', '00000000-0000-0000-0030-000000000301', 'active', 'Africa/Douala'),
  (pg_temp.g(2), 'WGN Gym B', '00000000-0000-0000-0030-000000000301', 'active', 'Africa/Douala'),
  (pg_temp.g(3), 'WGN Gym C (suspended)', '00000000-0000-0000-0030-000000000301', 'suspended', 'Africa/Douala');

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'wgn-' || n || '@x.example', now() from generate_series(1, 20) n;

-- 1 owner A, 2 manager A, 3 supervisor A, 4 receptionist A, 5 coach A, 6 support A, 7 member A (control), 8 deactivated member A,
-- 9 member of suspended gym C, 10 member B, 11 member A with history (read control).
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(s.n), pg_temp.g(s.gym), pg_temp.u(s.n), s.role::member_role, 'WGN ' || s.n, current_date, case when s.n = 8 then now() else null end
from (values (1, 1, 'owner'), (2, 1, 'manager'), (3, 1, 'supervisor'), (4, 1, 'receptionist'), (5, 1, 'coach'),
             (7, 1, 'member'), (8, 1, 'member'), (9, 3, 'member'), (10, 2, 'member'), (11, 1, 'member')) as s(n, gym, role);

-- A GymOS Support person with a live assignment to gym A (the fixture of coach_picker.negative.test.sql): a real support membership row.
insert into private.support_accounts (user_id, activated_at) values (pg_temp.u(6), now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values ('00000000-0000-0000-0030-000000000391', pg_temp.u(6), pg_temp.g(1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0030-0000000003f1', pg_temp.u(6), now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values ('00000000-0000-0000-0030-0000000003f1', pg_temp.u(6), now(), now());
select private.support_set_membership('00000000-0000-0000-0030-000000000391', true);

-- Member 9 had a goal before the gym was suspended; member 11 has a pending goal (read control).
alter table member_weekly_goals disable trigger member_weekly_goals_history_guard;
insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values
  (pg_temp.m(9), pg_temp.g(3), (date_trunc('week', now() at time zone 'Africa/Douala') - interval '7 days')::date, 5),
  (pg_temp.m(11), pg_temp.g(1), (date_trunc('week', now() at time zone 'Africa/Douala') + interval '7 days')::date, 6);
alter table member_weekly_goals enable trigger member_weekly_goals_history_guard;

create temp table goals_before as select * from member_weekly_goals;

-- ============================================================================
-- Positive control: a live member is served in the very same setup
-- ============================================================================
select pg_temp.as_user(7, 1, 'member');
select is(pg_temp.setg('authenticated', 7), '4', 'control: a live member of an active gym can set a goal');
select is(pg_temp.myg('authenticated'), '1', 'control: and reads one row');
select pg_temp.as_user(11, 1, 'member');
select is(pg_temp.myg('authenticated'), '1', 'control: a member with a pending goal reads one row');
delete from member_weekly_goals where member_id = pg_temp.m(7);
create temp table goals_base as select * from member_weekly_goals;

-- ============================================================================
-- Not a live member: writes refused, reads empty
-- ============================================================================
select pg_temp.as_user(1, 1, 'owner');
select is(pg_temp.setg('authenticated', 1), '42501:permission denied', 'an Owner cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');
select pg_temp.as_user(2, 1, 'manager');
select is(pg_temp.setg('authenticated', 2), '42501:permission denied', 'a Manager cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');
select pg_temp.as_user(3, 1, 'supervisor');
select is(pg_temp.setg('authenticated', 3), '42501:permission denied', 'a Supervisor cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');
select pg_temp.as_user(4, 1, 'receptionist');
select is(pg_temp.setg('authenticated', 4), '42501:permission denied', 'a Receptionist cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');
select pg_temp.as_user(5, 1, 'coach');
select is(pg_temp.setg('authenticated', 5), '42501:permission denied', 'a Coach cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- GymOS Support: a support row resolves to no live non-support role, exactly like a user with no membership.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(6), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', '00000000-0000-0000-0030-0000000003f1', 'app_role', 'support', 'gym_id', pg_temp.g(1))::text, true);
select is(pg_temp.setg('authenticated', 6), '42501:permission denied', 'a GymOS Support session cannot set a goal');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- A deactivated member whose token still says member: the live role decides.
select pg_temp.as_user(8, 1, 'member');
select is(pg_temp.setg('authenticated', 8), '42501:permission denied', 'a deactivated member is refused');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- A member of a suspended gym, who already has a goal row.
select pg_temp.as_user(9, 3, 'member');
select is(pg_temp.setg('authenticated', 9), '42501:permission denied: gym ' || pg_temp.g(3) || ' is not active', 'a member of a suspended gym is refused, with the phrase isGymSuspendedError reads');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row, although a goal row exists');

-- An Owner presenting a forged member claim: the role is read live.
select pg_temp.as_user(1, 1, 'member');
select is(pg_temp.setg('authenticated', 1), '42501:permission denied', 'an Owner with a forged member claim is refused');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- A member of gym B presenting gym A's claim.
select pg_temp.as_user(10, 1, 'member');
select is(pg_temp.setg('authenticated', 10), '42501:permission denied', 'a member of gym B naming gym A is refused');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- No gym claim at all, and an empty one.
select pg_temp.as_user(7, null, 'member');
select is(pg_temp.setg('authenticated', 7), '42501:permission denied', 'a member with no gym claim is refused');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(7), 'role', 'authenticated', 'gym_id', '', 'app_role', 'member')::text, true);
select is(pg_temp.setg('authenticated', 7), '42501:permission denied', 'a member with an empty gym claim is refused');

-- A user with no members row at all.
select pg_temp.as_user(12, 1, 'member');
select is(pg_temp.setg('authenticated', 12), '42501:permission denied', 'a user with no membership is refused');
select is(pg_temp.myg('authenticated'), '0', 'and reads no row');

-- Anonymous
select set_config('request.jwt.claims', '', true);
select is(pg_temp.setg('anon', 0), '42501:permission denied for function set_weekly_goal', 'anon is refused set_weekly_goal at the privilege');
select is(pg_temp.myg('anon'), '42501:permission denied for function my_weekly_goal', 'anon is refused my_weekly_goal at the privilege');
select is(pg_temp.setg('service_role', 0), '42501:permission denied for function set_weekly_goal', 'service_role is refused too (authenticated only)');
select pg_temp.as_user(7, 1, 'member');
select is(pg_temp.setg('anon', 7), '42501:permission denied for function set_weekly_goal', 'anon with a member''s claims is still refused');

-- ============================================================================
-- Nothing was written, for anyone
-- ============================================================================
select is(
  (select count(*)::int from (select * from member_weekly_goals except select * from goals_base) d),
  0,
  'no member_weekly_goals row appeared for anyone'
);
select is(
  (select count(*)::int from (select * from goals_base except select * from member_weekly_goals) d),
  0,
  'and no row changed or went'
);
select is((select count(*)::int from member_weekly_goals where member_id in (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), pg_temp.m(6), pg_temp.m(8), pg_temp.m(10))), 0,
  'staff, the support row, the deactivated member and gym B''s member hold no goal row');

-- ============================================================================
-- Direct table access
-- ============================================================================
select pg_temp.as_user(7, 1, 'member');
select is((select pg_temp.setg('authenticated', 7)), '4', 'control: the member can still call the function');
delete from member_weekly_goals where member_id = pg_temp.m(7);
create function pg_temp.direct(p_role text, p_sql text) returns text language plpgsql as $f$
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'allowed';
end $f$;
select is(pg_temp.direct('authenticated', 'select * from member_weekly_goals'), '42501', 'a member cannot select the table');
select is(pg_temp.direct('authenticated', format($$insert into member_weekly_goals (member_id, gym_id, effective_week, goal) values (%L, %L, date '2099-01-05', 4)$$, pg_temp.m(7), pg_temp.g(1))), '42501', 'cannot insert');
select is(pg_temp.direct('authenticated', 'update member_weekly_goals set goal = 1'), '42501', 'cannot update');
select is(pg_temp.direct('authenticated', 'delete from member_weekly_goals'), '42501', 'cannot delete');
select pg_temp.as_user(1, 1, 'owner');
select is(pg_temp.direct('authenticated', 'select * from member_weekly_goals'), '42501', 'an Owner cannot select the table');
select is(pg_temp.direct('authenticated', 'update member_weekly_goals set goal = 1'), '42501', 'cannot update');
select is(pg_temp.direct('anon', 'select * from member_weekly_goals'), '42501', 'anon cannot select the table');
select is(pg_temp.direct('service_role', 'select * from member_weekly_goals'), '42501', 'service_role cannot select the table');
select is(pg_temp.direct('service_role', 'delete from member_weekly_goals'), '42501', 'service_role cannot delete');

-- ============================================================================
-- Privileges and source scans
-- ============================================================================
select is(
  (select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'public.set_weekly_goal(smallint)', 'execute')),
  array['authenticated'],
  'set_weekly_goal is executable by authenticated only'
);
select is(
  (select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'public.my_weekly_goal()', 'execute')),
  array['authenticated'],
  'my_weekly_goal is executable by authenticated only'
);
select ok(not has_function_privilege('public', 'public.set_weekly_goal(smallint)', 'execute'), 'and PUBLIC is revoked');
select ok(
  (select prosrc from pg_proc where oid = 'public.set_weekly_goal(smallint)'::regprocedure) like '%private.current_gym_status() is distinct from ''active''%',
  'set_weekly_goal carries the exact suspension guard text'
);
select ok(
  (select prosrc from pg_proc where oid = 'public.set_weekly_goal(smallint)'::regprocedure) !~* 'attendance_events',
  'set_weekly_goal reads no attendance'
);
select is(
  (select count(*)::int from pg_proc p
   where p.oid in ('public.set_weekly_goal(smallint)'::regprocedure, 'public.my_weekly_goal()'::regprocedure, 'private.member_weekly_goals_history_guard()'::regprocedure,
                   'private.audit_platform_engagement_config_update()'::regprocedure, 'private.gym_local_week_bounds(text,timestamptz)'::regprocedure, 'private.week_start_of(date)'::regprocedure)
     and (p.prosrc ~* 'support_rpc_' or p.prosrc ~* '''supervisor'''
          or p.proname ~ '^(list_coach_|get_coach_|list_picker_)')),
  0,
  'no new function body names support_rpc_ or ''supervisor'', and no name starts list_coach_, get_coach_ or list_picker_'
);
select is(
  (select count(*)::int from private.support_capabilities where object_name in ('set_weekly_goal', 'my_weekly_goal', 'member_weekly_goals', 'platform_engagement_config')),
  0,
  'nothing new is registered in private.support_capabilities'
);
select is((select count(*)::int from private.support_capabilities), 50, 'and the allow-list still holds its 50 objects');

select * from finish();
rollback;
