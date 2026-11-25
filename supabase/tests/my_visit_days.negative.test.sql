-- Story 30.5 (NFR-027): refusals for public.my_visit_days(date) and public.my_first_visit_day() (migration 0187). Positive paths, the month
-- filter and the timezone case live in my_visit_days.test.sql.
--
-- Covers BOTH functions for an Owner, Manager, Supervisor, Receptionist, Coach, a GymOS Support session, an anonymous caller (the privilege
-- fails), service_role, a caller with no gym claim, a deactivated member whose token still says member, a member of a suspended gym and a member
-- of gym B presenting gym A's token: each gets no row (NULL from my_first_visit_day), never an error, even when the month passed is invalid
-- (a wrong caller learns nothing, not even about months); nothing is written for anyone; and the positive control returns days in the very
-- same setup. Every non-member fixture row HAS attendance in March, so an empty answer is the gate, not an absence of data.
--
-- Fixtures: a gym is seeded `status = 'suspended'` IN ITS INSERT (an UPDATE of gyms.status silently reverts).
-- Fixture ids: 00000000-0000-0000-0041-00000000nnnn.

begin;
select plan(38);

create function pg_temp.id(p_kind int, p_n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0041-' || lpad((p_kind * 1000 + p_n)::text, 12, '0'))::uuid $f$;
create function pg_temp.m(p_n int) returns uuid language sql immutable as $f$ select pg_temp.id(3, p_n) $f$;
create function pg_temp.claims(p_n int, p_gym int, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(2, p_n), 'role', 'authenticated', 'gym_id', case when p_gym > 0 then pg_temp.id(1, p_gym) end, 'app_role', p_app_role)::text, true);
end $f$;
-- Rows my_visit_days(p_month) returns as `role`, or sqlstate:message.
create function pg_temp.rows_as(p_role text, p_month date) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', p_role);
  begin
    select count(*)::text into v from public.my_visit_days(p_month);
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;
-- my_first_visit_day() as `role`: the date, 'null', or sqlstate:message.
create function pg_temp.first_as(p_role text) returns text language plpgsql as $f$
declare v text;
begin
  execute format('set local role %I', p_role);
  begin
    select coalesce(public.my_first_visit_day()::text, 'null') into v;
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return v;
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values (pg_temp.id(0, 1), 'MVN Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, timezone) values
  (pg_temp.id(1, 1), 'MVN Gym A', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 2), 'MVN Gym B', pg_temp.id(0, 1), 'active', 'Africa/Douala'),
  (pg_temp.id(1, 3), 'MVN Gym C (suspended)', pg_temp.id(0, 1), 'suspended', 'Africa/Douala');
insert into auth.users (id, email, email_confirmed_at) select pg_temp.id(2, n), 'mvn-' || n || '@x.example', now() from generate_series(1, 20) n;

-- 1 owner A, 2 manager A, 3 supervisor A, 4 receptionist A, 5 coach A, 6 support A, 7 member A (control), 8 deactivated member A,
-- 9 member of suspended gym C, 10 member B.
insert into members (id, gym_id, user_id, role, name, join_date, deactivated_at)
select pg_temp.m(s.n), pg_temp.id(1, s.gym), pg_temp.id(2, s.n), s.role::member_role, 'MVN ' || s.n, date '2026-01-05', case when s.n = 8 then now() else null end
from (values (1, 1, 'owner'), (2, 1, 'manager'), (3, 1, 'supervisor'), (4, 1, 'receptionist'), (5, 1, 'coach'),
             (7, 1, 'member'), (8, 1, 'member'), (9, 3, 'member'), (10, 2, 'member')) as s(n, gym, role);

-- A GymOS Support person with a live assignment to gym A (the fixture of weekly_goal.negative.test.sql): a real support membership row.
insert into private.support_accounts (user_id, activated_at) values (pg_temp.id(2, 6), now());
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values (pg_temp.id(9, 1), pg_temp.id(2, 6), pg_temp.id(1, 1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.id(9, 2), pg_temp.id(2, 6), now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at) values (pg_temp.id(9, 2), pg_temp.id(2, 6), now(), now());
select private.support_set_membership(pg_temp.id(9, 1), true);

-- Every member row (staff included, the deactivated one, the suspended gym's member, gym B's member) has a counted visit on 5 March 2026, so
-- an empty answer below is the gate and never a lack of data. Member 7 (the control) also has the 6th.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
select m.gym_id, m.id, timestamptz '2026-03-05 10:00+01', timestamptz '2026-03-05 10:30+01', 'manual', date '2026-03-05' from members m where m.id in (select pg_temp.m(n) from generate_series(1, 10) n);
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, visit_day)
values (pg_temp.id(1, 1), pg_temp.m(7), timestamptz '2026-03-06 10:00+01', timestamptz '2026-03-06 10:30+01', 'manual', date '2026-03-06');

create temp table events_before as select * from attendance_events;

-- ============================================================================
-- Positive control: a live member is served in the very same setup
-- ============================================================================
select pg_temp.claims(7, 1, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '2', 'control: a live member of an active gym reads their two days');
select is(pg_temp.first_as('authenticated'), '2026-03-05', 'control: and their first visit day');
select pg_temp.claims(10, 2, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '1', 'control: a live member of gym B reads their own day in gym B');

-- ============================================================================
-- Not a live member: no row, NULL, no error (an invalid month too: nothing is learnt about months)
-- ============================================================================
select pg_temp.claims(1, 1, 'owner');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'an Owner gets no row');
select is(pg_temp.rows_as('authenticated', date '2026-03-15'), '0', 'and no invalid_month error for a bad month');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');
select pg_temp.claims(2, 1, 'manager');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a Manager gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');
select pg_temp.claims(3, 1, 'supervisor');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a Supervisor gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');
select pg_temp.claims(4, 1, 'receptionist');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a Receptionist gets no row');
select is(pg_temp.rows_as('authenticated', date '2099-01-01'), '0', 'and no error for a month in the far future');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');
select pg_temp.claims(5, 1, 'coach');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a Coach gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- GymOS Support: a support row resolves to no live member role, exactly like a user with no membership.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(2, 6), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', pg_temp.id(9, 2), 'app_role', 'support', 'gym_id', pg_temp.id(1, 1))::text, true);
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a GymOS Support session gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- A deactivated member whose token still says member: the live row decides.
select pg_temp.claims(8, 1, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a deactivated member gets no row');
select is(pg_temp.rows_as('authenticated', date '2026-03-15'), '0', 'and no error for a bad month');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- A member of a suspended gym, who has a visit on record.
select pg_temp.claims(9, 3, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a member of a suspended gym gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- No gym in the session.
select pg_temp.claims(7, 0, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a caller with no gym in the session gets no row');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- A member of gym B presenting gym A's claim, and a member of gym A presenting gym B's: the member row is resolved for the token's gym.
select pg_temp.claims(10, 1, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a member of gym B whose token names gym A gets no row (never gym A''s days)');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');
select pg_temp.claims(7, 2, 'member');
select is(pg_temp.rows_as('authenticated', date '2026-03-01'), '0', 'a member of gym A whose token names gym B gets no row (never gym B''s days)');
select is(pg_temp.first_as('authenticated'), 'null', 'and no first visit day');

-- ============================================================================
-- Anon and service_role cannot execute either function
-- ============================================================================
select pg_temp.claims(7, 1, 'member');
select is(pg_temp.rows_as('anon', date '2026-03-01'), '42501:permission denied for function my_visit_days', 'anon cannot execute my_visit_days');
select is(pg_temp.first_as('anon'), '42501:permission denied for function my_first_visit_day', 'anon cannot execute my_first_visit_day');
select is(pg_temp.rows_as('service_role', date '2026-03-01'), '42501:permission denied for function my_visit_days', 'service_role cannot execute my_visit_days');
select is(pg_temp.first_as('service_role'), '42501:permission denied for function my_first_visit_day', 'service_role cannot execute my_first_visit_day');

-- ============================================================================
-- Nothing written, nothing registered, no parameter that names a member
-- ============================================================================
select is(
  (select count(*) from (select * from attendance_events except select * from events_before) x)
  + (select count(*) from (select * from events_before except select * from attendance_events) x),
  0::bigint, 'attendance_events is identical before and after every call above');
select is((select count(*)::int from private.support_capabilities where object_name ~ 'visit_day'), 0, 'neither function is a support capability');
select is((select count(*)::int from pg_proc where oid in ('public.my_visit_days(date)'::regprocedure, 'public.my_first_visit_day()'::regprocedure) and proargnames::text ~ 'member|user|gym'), 0, 'neither takes a member, user or gym parameter');
select is((select array_agg(proname::text order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname ~ 'visit_day'), array['my_first_visit_day', 'my_visit_days']::text[], 'these are the only public visit-day functions');
select is(
  (select count(*)::int from pg_proc p where p.oid in ('public.my_visit_days(date)'::regprocedure, 'public.my_first_visit_day()'::regprocedure)
     and position('current_member_role' in p.prosrc) > 0
     and position('current_member_role' in p.prosrc) < position('current_gym_status()' in p.prosrc)),
  2, 'both check the live role BEFORE the gym status');
select is(
  (select count(*)::int from pg_proc p where p.oid = 'public.my_visit_days(date)'::regprocedure
     and position('current_gym_status()' in p.prosrc) < position('invalid_month' in p.prosrc)),
  1, 'my_visit_days refuses a month only after the caller is known to be a live member of an active gym');

select * from finish();
rollback;
