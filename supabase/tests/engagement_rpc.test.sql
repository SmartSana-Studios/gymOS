-- Story 30.3 (FR-219, FR-220, NFR-029): public.my_engagement() and public.open_engagement() (migration 0186).
--
-- Proves: no argument; STABLE and VOLATILE; SECURITY DEFINER with a pinned search_path; the grants (authenticated only: not anon, PUBLIC or
-- service_role); that the view family shares one row type (pg_get_function_result); that my_engagement() is the view row of the caller's own
-- member row at now() and writes nothing (row counts AND contents), while open_engagement() settles, returns the row it settled and writes
-- nothing the second time; the caller matrix (member, Owner, Receptionist, support, a deactivated member, a member of a suspended gym, a
-- caller with no gym, anon): no row from the read, 42501 from the settle, and nothing written for anyone; two members of one gym each see
-- only their own row; every plan state gets a row (Pay-per-session, monthly, awaiting the fee, grace_period, expired); and none of it is a
-- support capability.
--
-- The wrappers read the real clock, so what they return is compared with the `_at` forms at now() (the same transaction, the same instant),
-- never with a literal date. The settle that open_engagement() performs has real facts to write because the fixture visits are in March 2026
-- and the epoch is 2026-03-02.
--
-- Fixture ids: 00000000-0000-0000-0039-00000000nnnn. Gym 1001 (A, active), 1002 (S, suspended), users 2xxx, members 3xxx.

begin;
select plan(63);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0039-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- One statement run as a database role, returning its first value (the count of rows for the callers below) or sqlstate:message.
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

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'RP Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'RP Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'RP Gym S', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'rp-' || n || '@x.example', now() from generate_series(1, 30) n;
-- 1 owner, 2 receptionist, 3 support person (a user with NO member row: support is never a member), 4 deactivated member, 5 member of the suspended gym,
-- 10 member with a stale visit, 11 member with a visit today, 12 PPS, 13 monthly, 14 awaiting fee (no subscription), 15 grace, 16 expired.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(n), pg_temp.id(1, case when n = 5 then 2 else 1 end), pg_temp.id(2, n),
       (case n when 1 then 'owner' when 2 then 'receptionist' else 'member' end)::member_role,
       'RP Member ' || n, date '2026-01-05', case when n = 4 then now() end
from generate_series(1, 20) n where n <> 3;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.id(4, 1), pg_temp.id(1, 1), 'RP Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  (pg_temp.id(4, 2), pg_temp.id(1, 1), 'RP PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select pg_temp.id(1, 1), pg_temp.m(s.n), (case when s.n = 12 then pg_temp.id(4, 2) else pg_temp.id(4, 1) end), s.status::subscription_status, date '2026-01-05',
       case when s.n = 12 then null else date '2030-01-01' end
from (values (10, 'active'), (11, 'active'), (12, 'active'), (13, 'active'), (15, 'grace_period'), (16, 'expired')) s(n, status);

create function pg_temp.visit(p_n int, p_day date) returns void language plpgsql as $f$
begin
  insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
  select m.gym_id, m.id, (p_day + time '10:00') at time zone 'Africa/Douala', (p_day + time '10:30') at time zone 'Africa/Douala', 'manual', p_day
  from members m where m.id = pg_temp.m(p_n);
end $f$;
create function pg_temp.today() returns date language sql stable as $f$ select private.gym_today(pg_temp.id(1, 1)) $f$;
select pg_temp.visit(10, date '2026-03-03');
select pg_temp.visit(10, date '2026-03-04');
select pg_temp.visit(11, pg_temp.today());
select pg_temp.visit(5, date '2026-03-03');

-- ============================================================================
-- Dark (first: the epoch cannot be unset once a week fact exists): nothing is settled and `enabled` is false
-- ============================================================================
select pg_temp.claims(10, 1, 'member');
select is((select enabled::text || '|' || needs_settle::text || '|' || at_risk_weekly::text from public.my_engagement()), 'false|false|false', 'dark: enabled, needs_settle and at_risk_weekly are all false');
select is((select enabled from public.open_engagement()), false, 'dark: open_engagement returns the disabled row');
select is((select count(*)::int from engagement_facts) + (select count(*)::int from engagement_state), 0, 'dark: and wrote nothing at all');

update platform_engagement_config set release_week_start = date '2026-03-02';

-- ============================================================================
-- Shape, grants, one row type
-- ============================================================================
select is((select pronargs::int from pg_proc where oid = 'public.my_engagement()'::regprocedure), 0, 'my_engagement takes no argument (no member id to forge)');
select is((select pronargs::int from pg_proc where oid = 'public.open_engagement()'::regprocedure), 0, 'open_engagement takes no argument');
select is((select provolatile::text from pg_proc where oid = 'public.my_engagement()'::regprocedure), 's', 'my_engagement is STABLE (provolatile = s)');
select is((select provolatile::text from pg_proc where oid = 'public.open_engagement()'::regprocedure), 'v', 'open_engagement is VOLATILE');
select is((select prosecdef from pg_proc where oid = 'public.my_engagement()'::regprocedure), true, 'my_engagement is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.open_engagement()'::regprocedure), true, 'open_engagement is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.my_engagement()'::regprocedure), array['search_path=public'], 'my_engagement pins its search_path');
select is((select proconfig from pg_proc where oid = 'public.open_engagement()'::regprocedure), array['search_path=public'], 'open_engagement pins its search_path');
select is(
  (select count(*)::int from unnest(array['public.my_engagement()', 'public.open_engagement()']) f, unnest(array['anon', 'service_role', 'public']) r
   where has_function_privilege(r, to_regprocedure(f), 'execute')),
  0, 'neither is executable by anon, service_role or PUBLIC');
select is(
  (select count(*)::int from unnest(array['public.my_engagement()', 'public.open_engagement()']) f where has_function_privilege('authenticated', to_regprocedure(f), 'execute')),
  2, 'both are executable by authenticated');
select is(
  (select count(distinct pg_get_function_result(f::regprocedure))::int
   from unnest(array['public.my_engagement()', 'public.open_engagement()', 'private.engagement_state_view(uuid)', 'private.engagement_state_view_at(uuid, timestamptz)',
                     'private.open_engagement_at(uuid, timestamptz)']) f),
  1, 'the view, its `_at` form, open_engagement_at and the public pair return the same column list');
select is((select pg_get_function_result('public.my_engagement()'::regprocedure) ~ '^TABLE\(enabled boolean, gym_today date, week_start date, week_end date, in_release_week boolean, goal smallint'), true, 'and it starts with the AC columns');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'engagement'), 0, 'none of the new functions is a support capability');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ 'engagement' and p.proname not in ('set_weekly_goal', 'my_engagement', 'open_engagement')), 0,
          'the public pair is the only addition to the public engagement functions');

-- ============================================================================
-- my_engagement(): the caller's own row, written by nobody
-- ============================================================================
create temp table snap_state as select * from engagement_state;
create temp table snap_facts as select * from engagement_facts;
create function pg_temp.same_tables() returns boolean language sql stable as $f$
  select (select count(*) from (select * from engagement_state except select * from snap_state) x) = 0
     and (select count(*) from (select * from snap_state except select * from engagement_state) x) = 0
     and (select count(*) from (select * from engagement_facts except select * from snap_facts) x) = 0
     and (select count(*) from (select * from snap_facts except select * from engagement_facts) x) = 0
$f$;

select pg_temp.claims(10, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'a live member gets exactly one row');
select is((select to_jsonb(v) from public.my_engagement() v), (select to_jsonb(v) from private.engagement_state_view_at(pg_temp.m(10), now()) v),
          'it is the view row of the caller''s own member row at now()');
select is((select needs_settle from public.my_engagement()), true, 'member 10 has closed weeks to settle (needs_settle)');
select is((select streak_weeks from public.my_engagement()), 0, 'and nothing is settled yet');
select is(pg_temp.same_tables(), true, 'my_engagement wrote nothing: engagement_state and engagement_facts are identical before and after, contents included');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(10)), 0, 'no fact exists for the caller');
select is((select enabled from public.my_engagement()), true, 'enabled is true with the epoch set');

-- ============================================================================
-- open_engagement(): settles, returns the settled row, writes nothing twice
-- ============================================================================
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '1', 'a live member gets exactly one row from open_engagement');
select cmp_ok((select count(*)::int from engagement_facts where member_id = pg_temp.m(10)), '>', 0, 'and the closed weeks are now settled (week facts exist)');
select is((select to_jsonb(v) from public.open_engagement() v), (select to_jsonb(v) from private.open_engagement_at(pg_temp.m(10), now()) v),
          'open_engagement is open_engagement_at(member, now())');
select is((select needs_settle from public.open_engagement()), false, 'after settling needs_settle is false');
select is((select has_settled_week from public.my_engagement()), true, 'and the settled week is in the fold');
select is((select to_jsonb(v) from public.my_engagement() v), (select to_jsonb(v) from public.open_engagement() v), 'my_engagement then returns exactly what open_engagement returned');
create temp table snap_state2 as select * from engagement_state;
create temp table snap_facts2 as select * from engagement_facts;
select is((select count(*)::int from public.open_engagement()), 1, 'calling it a second time returns the row again');
select is(
  (select count(*) from (select * from engagement_state except select * from snap_state2) x)
  + (select count(*) from (select * from snap_state2 except select * from engagement_state) x)
  + (select count(*) from (select * from engagement_facts except select * from snap_facts2) x)
  + (select count(*) from (select * from snap_facts2 except select * from engagement_facts) x),
  0::bigint, 'and wrote nothing the second time (updated_at included)');
select is((select count(*)::int from engagement_facts where member_id <> pg_temp.m(10)), 0, 'no other member was settled');

-- ============================================================================
-- Two members of one gym each see only their own row
-- ============================================================================
select pg_temp.claims(11, 1, 'member');
select is((select visited_today::text || '|' || visits_this_week::text from public.my_engagement()), 'true|1', 'member 11 sees their own visit today');
select pg_temp.claims(10, 1, 'member');
select is((select visited_today::text || '|' || visits_this_week::text from public.my_engagement()), 'false|0', 'member 10 sees theirs (no visit this week) and not member 11''s');
select is((select count(*)::int from public.my_engagement()), 1, 'one row, not a row per member of the gym');

-- ============================================================================
-- The caller matrix: no row from the read, 42501 from the settle, nothing written
-- ============================================================================
create temp table snap_state3 as select * from engagement_state;
create temp table snap_facts3 as select * from engagement_facts;
select pg_temp.claims(1, 1, 'owner');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'an Owner gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%', 'and is refused by open_engagement (42501)');
select pg_temp.claims(2, 1, 'receptionist');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'a Receptionist gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%', 'and is refused by open_engagement');
select pg_temp.claims(3, 1, 'support');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'GymOS Support gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%', 'and is refused by open_engagement');
select pg_temp.claims(4, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'a deactivated member gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%', 'and is refused by open_engagement');
select pg_temp.claims(5, 2, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'a member of a suspended gym gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%is not active%', 'and open_engagement raises the load-bearing `is not active` phrase');
select pg_temp.claims(10, 0, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'a caller with no gym in the session gets no row');
select alike(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '42501:%', 'and is refused by open_engagement');
select pg_temp.claims(10, 2, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '0', 'a member whose token names another gym gets no row (the member row is resolved for the token''s gym)');
select pg_temp.claims(10, 1, 'member');
select is(pg_temp.asrole('anon', 'select count(*)::text from public.my_engagement()'), '42501:permission denied for function my_engagement', 'anon cannot execute my_engagement');
select is(pg_temp.asrole('anon', 'select count(*)::text from public.open_engagement()'), '42501:permission denied for function open_engagement', 'anon cannot execute open_engagement');
select is(pg_temp.asrole('service_role', 'select count(*)::text from public.my_engagement()'), '42501:permission denied for function my_engagement', 'service_role cannot execute my_engagement');
select is(pg_temp.asrole('service_role', 'select count(*)::text from public.open_engagement()'), '42501:permission denied for function open_engagement', 'service_role cannot execute open_engagement');
select is(
  (select count(*) from (select * from engagement_state except select * from snap_state3) x) + (select count(*) from (select * from snap_state3 except select * from engagement_state) x)
  + (select count(*) from (select * from engagement_facts except select * from snap_facts3) x) + (select count(*) from (select * from snap_facts3 except select * from engagement_facts) x),
  0::bigint, 'no engagement row was written for any refused caller');
select is((select count(*)::int from engagement_facts where member_id = pg_temp.m(5)), 0, 'the suspended gym''s member was never settled');

-- ============================================================================
-- Every plan state gets a row; an expired member has at_risk_weekly false
-- ============================================================================
select pg_temp.claims(12, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'a Pay-per-session member gets a row');
select pg_temp.claims(13, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'a member on a monthly plan gets a row');
select pg_temp.claims(14, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'a member awaiting the registration fee (no subscription) gets a row');
select is((select at_risk_weekly from public.my_engagement()), false, 'with at_risk_weekly false (no plan behaves as expired)');
select pg_temp.claims(15, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'a grace_period member gets a row');
select pg_temp.claims(16, 1, 'member');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.my_engagement()'), '1', 'an expired member gets a row');
select is((select at_risk_weekly from public.my_engagement()), false, 'with at_risk_weekly false');
select is(pg_temp.asrole('authenticated', 'select count(*)::text from public.open_engagement()'), '1', 'and may open (settle) like any member');

select * from finish();
rollback;
