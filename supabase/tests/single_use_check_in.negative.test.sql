-- Story 28.2: single-use consumption at check-in (migration 0178), refusals and guards. Positive paths live in single_use_check_in.test.sql.
--
-- Covers: the consume function's signature, default and privileges (no 3-argument form left, a 3-argument call still works through the
-- default), invalid kinds, the pinned class guard (and the exempt-member decision), the callers source scan, check_in()'s unchanged return type,
-- the concurrent-equivalent backstops (one open visit, one session per attendance row, the whole_day one-per-day index, the deferred visit
-- constraint), a denied scan with only an expired or voided session, a whole_day void that still refuses with a later same-day visit, and tenant
-- isolation (another gym's staff, member and caller cannot read, void, check in or consume).
--
-- Fixture ids: 00000000-0000-0000-0000-00000028[31-34]xx. Gyms 2831nn: 1 single_use, 2 whole_day, 3 another gym (single_use).

begin;
select plan(49);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002831' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002832' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002833' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.p(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002834' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;

insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000283101', 'SUN Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity, session_validity, checkin_timeout_hours) values
  (pg_temp.g(1), 'SUN Gym 1', '00000000-0000-0000-0000-000000283101', 'active', true, 0, 'Africa/Douala', 30, 'single_use', 8),
  (pg_temp.g(2), 'SUN Gym 2', '00000000-0000-0000-0000-000000283101', 'active', true, 0, 'Africa/Douala', 30, 'whole_day', 8),
  (pg_temp.g(3), 'SUN Gym 3', '00000000-0000-0000-0000-000000283101', 'active', true, 0, 'Africa/Douala', 30, 'single_use', 8);
insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'sun-' || n || '@x.example', now() from generate_series(1, 60) n;

-- Staff: 1 receptionist G1, 2 manager G1, 3 receptionist G2, 4 manager G2, 5 manager G3, 6 owner G3.
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'SUN Staff ' || s.n, current_date
from (values (1, pg_temp.g(1), 'receptionist'), (2, pg_temp.g(1), 'manager'), (3, pg_temp.g(2), 'receptionist'), (4, pg_temp.g(2), 'manager'),
             (5, pg_temp.g(3), 'manager'), (6, pg_temp.g(3), 'owner')) as s(n, gym, role);
-- Members: 10 G1 (two sessions), 11 G1 (monthly), 12 G1 (expired session only), 13 G1 (voided session only), 14 G1 (backstops), 15 G1 (class),
-- 16 G2 (class), 17 G3, 18 G1 (isolation target), 19 G2 (whole_day void).
insert into members (id, gym_id, user_id, role, name, join_date)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), 'member', 'SUN Member ' || s.n, current_date
from (values (10, pg_temp.g(1)), (11, pg_temp.g(1)), (12, pg_temp.g(1)), (13, pg_temp.g(1)), (14, pg_temp.g(1)), (15, pg_temp.g(1)),
             (16, pg_temp.g(2)), (17, pg_temp.g(3)), (18, pg_temp.g(1)), (19, pg_temp.g(2))) as s(n, gym);
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  (pg_temp.p(1), pg_temp.g(1), 'SUN PPS 1',    'pay_per_session', 2000,  'XAF', 'monthly', null),
  (pg_temp.p(2), pg_temp.g(2), 'SUN PPS 2',    'pay_per_session', 2000,  'XAF', 'monthly', null),
  (pg_temp.p(3), pg_temp.g(3), 'SUN PPS 3',    'pay_per_session', 2000,  'XAF', 'monthly', null),
  (pg_temp.p(4), pg_temp.g(1), 'SUN Monthly 1', 'monthly',        15000, 'XAF', 'monthly', 30);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id,
       case when m.id = pg_temp.m(11) then pg_temp.p(4)
            when m.gym_id = pg_temp.g(1) then pg_temp.p(1) when m.gym_id = pg_temp.g(2) then pg_temp.p(2) else pg_temp.p(3) end,
       'active', current_date, case when m.id = pg_temp.m(11) then current_date + 30 end
from members m where m.role = 'member' and m.id::text like '00000000-0000-0000-0000-0000002833%';

create function pg_temp.mk_paid(p_gym uuid, p_member uuid, p_usable_until timestamptz default null, p_voided boolean default false) returns uuid
language plpgsql security definer as $mk$
declare v_payment uuid; v_session uuid;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session') returning id into v_payment;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until, created_at, voided_at)
  values (p_gym, p_member, v_payment, coalesce(p_usable_until, now() + interval '30 days'), now() - interval '10 days', case when p_voided then now() end)
  returning id into v_session;
  return v_session;
end $mk$;
create function pg_temp.consumed(p_member uuid) returns int language sql security definer as $f$
  select count(*)::int from guest_sessions where member_id = p_member and consumed_at is not null $f$;
create function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.scan(p_member int, p_gym int) returns text language plpgsql as $f$
declare r attendance_events;
begin
  perform pg_temp.claims(pg_temp.u(p_member), pg_temp.g(p_gym), 'member');
  set local role authenticated;
  begin
    r := check_in();
  exception when others then
    reset role;
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  return case when r.id is null then 'denied' else 'in' end;
end $f$;
create function pg_temp.sci(p_member int, p_staff int, p_gym int, p_role text) returns jsonb language plpgsql as $f$
declare r record;
begin
  perform pg_temp.claims(pg_temp.u(p_staff), pg_temp.g(p_gym), p_role);
  set local role authenticated;
  begin
    select * into r from public.staff_check_in(pg_temp.m(p_member));
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return jsonb_strip_nulls(to_jsonb(r));
end $f$;
create function pg_temp.void(p_att uuid, p_staff int, p_gym int, p_role text) returns jsonb language plpgsql as $f$
declare r record;
begin
  perform pg_temp.claims(pg_temp.u(p_staff), pg_temp.g(p_gym), p_role);
  set local role authenticated;
  begin
    select * into r from public.void_staff_check_in(p_att, 'wrong member selected');
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
  end;
  reset role;
  return jsonb_strip_nulls(to_jsonb(r));
end $f$;
create function pg_temp.checkout(p_member uuid) returns void language sql security definer as $f$
  update attendance_events set checked_out_at = now(), checkout_type = 'manual' where member_id = p_member and checked_out_at is null $f$;

-- ============================================================================
-- Signature, default and privileges.
-- ============================================================================
select is(to_regprocedure('private.consume_guest_session(uuid, uuid, timestamptz)'), null, 'the 3-argument consume function no longer exists (no ambiguity with the default)');
select is(pg_get_function_arguments('private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure),
          'p_member_id uuid, p_gym_id uuid, p_receipt_at timestamp with time zone, p_kind text DEFAULT ''visit''::text', 'the consume function takes p_kind text default visit');
select is(pg_get_function_result('private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure),
          'TABLE(outcome text, session_created_at timestamp with time zone, session_id uuid)', 'the consume function keeps its three result columns');
select is(has_function_privilege('anon', 'private.consume_guest_session(uuid, uuid, timestamptz, text)', 'EXECUTE')
          or has_function_privilege('authenticated', 'private.consume_guest_session(uuid, uuid, timestamptz, text)', 'EXECUTE'), false, 'anon and authenticated cannot execute the consume function');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = 'private.consume_guest_session(uuid, uuid, timestamptz, text)'::regprocedure and a.grantee = 0), 0, 'PUBLIC has no EXECUTE on the consume function');
select is(pg_get_function_result('public.check_in(timestamptz, uuid)'::regprocedure), 'attendance_events', 'check_in() still returns attendance_events (the denial contract is null)');
select is(pg_get_function_arguments('public.check_in(timestamptz, uuid)'::regprocedure),
          'p_scanned_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_scan_id uuid DEFAULT NULL::uuid', 'check_in() keeps its arguments');

-- A 3-argument call still works through the default.
select is((select outcome from private.consume_guest_session(pg_temp.m(11), pg_temp.g(1), now())), 'exempt', 'a 3-argument call still works (default visit): a monthly member is exempt');

-- ============================================================================
-- Kinds.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(15));
select is(pg_temp.err($$ select * from private.consume_guest_session('$$ || pg_temp.m(15) || $$', '$$ || pg_temp.g(1) || $$', now(), 'class') $$),
          'P0001:class_single_use_unsupported', 'class in a single_use gym raises class_single_use_unsupported (Story 28.3 replaces this case)');
select is(pg_temp.consumed(pg_temp.m(15)), 0, 'the class guard consumed nothing');
select is(pg_temp.err($$ select * from private.consume_guest_session('$$ || pg_temp.m(15) || $$', '$$ || pg_temp.g(1) || $$', now(), 'booking') $$),
          'P0001:consume_guest_session: invalid kind booking', 'an unknown kind raises');
select is(pg_temp.err($$ select * from private.consume_guest_session('$$ || pg_temp.m(15) || $$', '$$ || pg_temp.g(1) || $$', now(), null) $$),
          'P0001:consume_guest_session: invalid kind <NULL>', 'a null kind raises');
select is((select outcome from private.consume_guest_session(pg_temp.m(11), pg_temp.g(1), now(), 'class')), 'exempt',
          'class for an exempt member in a single_use gym consumes nothing and does not raise (nothing is being consumed)');
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.m(16));
select is((select outcome from private.consume_guest_session(pg_temp.m(16), pg_temp.g(2), now(), 'class')), 'consumed', 'class in a whole_day gym still consumes');
select is((select validity_mode || ':' || covered_kind from guest_sessions where member_id = pg_temp.m(16) and consumed_at is not null), 'whole_day:day',
          'class in a whole_day gym writes a day row exactly as before');

-- ============================================================================
-- The callers of the consume function: record_check_in and mark_class_attendance, nothing else.
-- ============================================================================
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f' and n.nspname in ('public', 'private') and p.proname <> 'consume_guest_session'
             and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'consume_guest_session\s*\('),
          'private.record_check_in, public.mark_class_attendance', 'only record_check_in and mark_class_attendance call the consume function (source scan)');
select ok((select position('''class''' in prosrc) > 0 from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure), 'mark_class_attendance passes the class kind');
select ok((select prosrc !~ 'consume_guest_session\(v_member_id, v_gym_id, now\(\)\)' from pg_proc where oid = 'public.mark_class_attendance(uuid)'::regprocedure),
          'mark_class_attendance no longer relies on the default kind');

-- ============================================================================
-- Backstops behind the member lock (pgTAP runs one session; scripts/single-use-race.sh proves the real interleaving).
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(14));
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(14));
select is(pg_temp.scan(14, 1), 'in', 'backstops: the member checks in');
select is(pg_temp.scan(14, 1), 'error:P0001:check_in: member ' || pg_temp.m(14) || ' already has an open check-in', 'backstops: a second scan is rejected "already has an open check-in"');
select throws_ok(
  format($q$ insert into attendance_events (gym_id, member_id, checked_in_at, source) values (%L, %L, now(), 'qr') $q$, pg_temp.g(1), pg_temp.m(14)),
  '23505', null, 'backstops: the open-check-in partial unique index refuses a second open row');
select is(pg_temp.consumed(pg_temp.m(14)), 1, 'backstops: one session consumed');
-- unique (covered_attendance_id): a second session cannot cover the same attendance row.
select throws_ok(
  $$ update guest_sessions set consumed_at = now(), validity_mode = 'single_use', covered_kind = 'visit',
            covered_attendance_id = (select covered_attendance_id from guest_sessions where member_id = '00000000-0000-0000-0000-00000028330e' and consumed_at is not null)
     where member_id = '00000000-0000-0000-0000-00000028330e' and consumed_at is null $$,
  '23505', null, 'backstops: unique (covered_attendance_id) refuses a second session on the same attendance row');
-- Two single_use visit rows for one member the same day are allowed (the one-per-day index covers whole_day rows only), whole_day rows are not.
select pg_temp.checkout(pg_temp.m(14));
select is(pg_temp.scan(14, 1), 'in', 'backstops: after a check-out the same member checks in again, a second visit row');
select is(pg_temp.consumed(pg_temp.m(14)), 2, 'backstops: two consumed single_use rows the same day');
create function pg_temp.mk_day_row(p_member uuid) returns void language plpgsql security definer as $mk$
declare v_grant uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id) values (pg_temp.g(1), p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind, covered_day)
  values (pg_temp.g(1), p_member, v_grant, now() + interval '1 day', now(), 'whole_day', 'day', private.gym_local_date(pg_temp.g(1), now()));
end $mk$;
select lives_ok($$ select pg_temp.mk_day_row('00000000-0000-0000-0000-00000028330e') $$, 'backstops: one whole_day day row for the day is accepted');
select throws_ok($$ select pg_temp.mk_day_row('00000000-0000-0000-0000-00000028330e') $$, '23505', null, 'backstops: a second whole_day row for the same day is refused by the index');

-- The deferred visit constraint: a consumed visit row with no attendance id fails at commit.
create function pg_temp.mk_bare_visit(p_member uuid) returns void language plpgsql security definer as $mk$
declare v_grant uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id) values (pg_temp.g(1), p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until, consumed_at, validity_mode, covered_kind)
  values (pg_temp.g(1), p_member, v_grant, now() + interval '1 day', now(), 'single_use', 'visit');
end $mk$;
select lives_ok($$ select pg_temp.mk_bare_visit('00000000-0000-0000-0000-00000028330a') $$, 'deferred constraint: the insert itself is accepted (checked at commit)');
select throws_ok($$ set constraints guest_sessions_visit_has_attendance immediate $$, '23514', null, 'deferred constraint: a consumed visit row without an attendance id fails when checked');

-- ============================================================================
-- Denied scans.
-- ============================================================================
-- Rewind the failed transaction state: the constraint above stays in error only inside its own statement; remove the bare row and defer again.
delete from guest_sessions where member_id = '00000000-0000-0000-0000-00000028330a';
set constraints guest_sessions_visit_has_attendance deferred;

select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(12), now() - interval '1 minute');
select is(pg_temp.scan(12, 1), 'denied', 'an expired session is not usable: the scan is denied');
select is((select count(*)::int from session_attempts where member_id = pg_temp.m(12) and source = 'check_in'), 1, 'expired session: one attempt');
select is((select count(*)::int from attendance_events where member_id = pg_temp.m(12)), 0, 'expired session: no attendance row');
select is((select count(*)::int from attendance_counted where member_id = pg_temp.m(12)) + (select count(*)::int from member_visit_days where member_id = pg_temp.m(12)), 0,
          'engagement: a denied scan adds neither a counted row nor a visit day');
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(13), null, true);
select is(pg_temp.scan(13, 1), 'denied', 'a voided (refunded) session is not usable: the scan is denied');
select is(pg_temp.consumed(pg_temp.m(13)), 0, 'voided session: nothing consumed');

-- ============================================================================
-- Whole_day void keeps its later-visit guard.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.m(19));
create temp table vkeep (att uuid);
select is(pg_temp.sci(19, 3, 2, 'receptionist') ->> 'outcome', 'checked_in', 'whole_day void: the first staff entry (covered by the day row)');
insert into vkeep select id from attendance_events where member_id = pg_temp.m(19);
-- one transaction means one now(): order the two entries by insertion time explicitly
update attendance_events set created_at = now() - interval '1 hour' where id in (select att from vkeep);
select pg_temp.checkout(pg_temp.m(19));
select is(pg_temp.sci(19, 3, 2, 'receptionist') ->> 'outcome', 'checked_in', 'whole_day void: a later staff entry the same day (covered)');
select is(pg_temp.void((select att from vkeep), 4, 2, 'manager') - 'attendance_id', '{"outcome":"later_visit_relies","later_is_staff_entry":true}'::jsonb,
          'whole_day void: the entry that consumed the day row is refused while a later same-day visit exists');

-- ============================================================================
-- Tenant isolation.
-- ============================================================================
select pg_temp.mk_paid(pg_temp.g(1), pg_temp.m(18));
select is(pg_temp.sci(18, 1, 1, 'receptionist') ->> 'outcome', 'checked_in', 'isolation: fixture, a staff entry in gym 1');
create temp table ikeep (att uuid);
insert into ikeep select id from attendance_events where member_id = pg_temp.m(18);
select is(pg_temp.void((select att from ikeep), 5, 3, 'manager') ->> 'outcome', 'attendance_not_found', 'isolation: another gym''s manager cannot void gym 1''s entry');
select is((select voided_at from attendance_events where id = (select att from ikeep)), null, 'isolation: the entry is untouched');
select is(pg_temp.sci(10, 5, 3, 'manager') ->> 'outcome', 'member_not_found', 'isolation: another gym''s staff cannot check in gym 1''s member');
select is(pg_temp.consumed(pg_temp.m(10)), 0, 'isolation: nothing consumed for gym 1''s member');

create function pg_temp.visible_sessions(p_user uuid, p_gym uuid, p_role text) returns int language plpgsql as $f$
declare n int;
begin
  perform pg_temp.claims(p_user, p_gym, p_role);
  set local role authenticated;
  select count(*)::int into n from guest_sessions where member_id = pg_temp.m(18);
  reset role;
  return n;
end $f$;
select is(pg_temp.visible_sessions(pg_temp.u(6), pg_temp.g(3), 'owner'), 0, 'isolation: another gym''s owner reads none of gym 1''s sessions');
select is(pg_temp.visible_sessions(pg_temp.u(17), pg_temp.g(3), 'member'), 0, 'isolation: another gym''s member reads none of them either');
select is(pg_temp.scan(18, 3), 'error:P0001:permission denied', 'isolation: a gym 1 member presenting gym 3 claims cannot check in at gym 3');

create function pg_temp.call_consume(p_role text) returns text language plpgsql as $f$
begin
  perform pg_temp.claims(pg_temp.u(6), pg_temp.g(3), 'owner');
  execute 'set local role ' || p_role;
  begin
    perform * from private.consume_guest_session(pg_temp.m(18), pg_temp.g(1), now());
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end $f$;
select is(pg_temp.call_consume('authenticated'), '42501', 'isolation: an authenticated caller cannot call the consume function');
select is(pg_temp.call_consume('anon'), '42501', 'isolation: anon cannot call the consume function');
select is(pg_temp.consumed(pg_temp.m(18)), 1, 'isolation: gym 1''s member still has exactly the one session consumed by their own entry');

select * from finish();
rollback;
