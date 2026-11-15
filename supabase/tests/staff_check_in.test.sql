-- Story 27.3: public.staff_check_in (migration 0175). The database half of AD-30 R1 to R9.
--
-- Proves: the signature (no time parameter, no scan id), privileges, the role and gym matrix (Receptionist, Manager, Supervisor and Owner
-- succeed; Coach, member, anon refused; another gym's staff and another gym's member get the same member_not_found as a missing id; a
-- deactivated or role-changed staff member is refused on the next call), every outcome code of the I/O matrix with its audit row, that a
-- rejection returns normally and commits its audit row, that no front_desk_alerts row exists for any outcome, the R5 attempt row and the
-- Guest-sessions counts, the session consumed and linked by an entry, the stale-open handling, a double submit, GymOS Support (step-up,
-- single use, bound to the member, proxy actor, "GymOS Support" and no real identity, every refusal of a not-live caller) and that the
-- gym record_check_in checks is the gym the support caller acts on (the 27.2 deferral). The void is void_staff_check_in.test.sql; the
-- Daily Log read is list_attendance_log.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[50-53]xx. Gyms 2750nn: 01 A (non-charging), 02 C (charging), 03 S (suspended),
-- 04 B (the other gym), 05 O (occupancy, capacity 3).

begin;
select plan(100);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002750' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002751' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002752' || lpad(to_hex(n), 2, '0'))::uuid $f$;

create function pg_temp.gt(n int) returns date language sql security definer as $f$ select private.gym_today(pg_temp.g(n)) $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text default 'receptionist') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.sup_claims(p_gym uuid, p_aal text default 'aal2', p_session text default '00000000-0000-0000-0000-0000002754a1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000275408', 'role', 'authenticated', 'aal', p_aal, 'session_id', p_session,
                      'app_role', 'support', 'gym_id', p_gym)::text, true);
end $f$;
-- The coded result of staff_check_in as jsonb (nulls stripped), or the error. Runs as the caller (SECURITY INVOKER).
create function pg_temp.sci(p_member uuid) returns jsonb language plpgsql as $f$
declare r record;
begin
  select * into r from public.staff_check_in(p_member);
  return jsonb_strip_nulls(to_jsonb(r));
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;
create function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000275001', 'SCI Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, grace_period_days, capacity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  (pg_temp.g(1), 'SCI Gym A', '00000000-0000-0000-0000-000000275001', 'active',    false, 0, 'Africa/Douala', 3, 30, false, null, null, null),
  (pg_temp.g(2), 'SCI Gym C', '00000000-0000-0000-0000-000000275001', 'active',    true,  0, 'Africa/Douala', 3, 30, false, null, null, null),
  (pg_temp.g(3), 'SCI Gym S', '00000000-0000-0000-0000-000000275001', 'suspended', false, 0, 'Africa/Douala', 3, 30, false, null, null, null),
  (pg_temp.g(4), 'SCI Gym B', '00000000-0000-0000-0000-000000275001', 'active',    false, 0, 'Africa/Douala', 3, 30, false, null, null, null),
  (pg_temp.g(5), 'SCI Gym O', '00000000-0000-0000-0000-000000275001', 'active',    false, 0, 'Africa/Douala', 3, 3,  false, null, null, null);

insert into auth.users (id, email, email_confirmed_at)
select pg_temp.u(n), 'sci-' || n || '@x.example', now() from generate_series(1, 80) n;
-- the support person is user 08 of the 2754 block, not of the 2751 block
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000275408', 'sci-support@gymosapps.com', now());

-- Staff of A: 01 receptionist, 02 manager, 03 supervisor, 04 owner, 05 coach, 0a staff to be deactivated, 0b staff to be demoted.
-- 06 is the member who scans. Staff of B: 07. Staff of S: 09. Staff of C: 0c receptionist, 0d owner. Staff of O: 0e receptionist.
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'SCI Staff ' || s.n, '+2376002750' || lpad(s.n::text, 2, '0')
from (values
  (1, pg_temp.g(1), 'receptionist'), (2, pg_temp.g(1), 'manager'), (3, pg_temp.g(1), 'supervisor'), (4, pg_temp.g(1), 'owner'),
  (5, pg_temp.g(1), 'coach'), (10, pg_temp.g(1), 'receptionist'), (11, pg_temp.g(1), 'receptionist'),
  (7, pg_temp.g(4), 'receptionist'), (9, pg_temp.g(3), 'receptionist'),
  (12, pg_temp.g(2), 'receptionist'), (13, pg_temp.g(2), 'owner'), (14, pg_temp.g(5), 'receptionist')
) as s(n, gym, role);

-- Members. A: 20 active, 21 expiring, 22 grace, 23 expired (5 days), 24 expired today, 25 deactivated, 26 fee due (no plan, unsettled),
-- 27 no plan (settled), 28 already inside, 29 stale open, 2a pay-per-session at the non-charging gym, 2b, 2c, 2d active (role matrix),
-- 2e support member, 2f support second member, 30 stepup-bound member, 31 scan after check-out, 06 the scanning member.
-- C: 40 PPS with a paid session, 41 PPS with no session (R5), 42 PPS with a free session, 43 PPS on a 0 XAF plan, 44 PPS deactivated with
-- a paid session, 45 PPS scanning (no session), 46 PPS with a paid session (linked consumption). B: 50. S: 51. O: 52, 53, 54.
insert into members (id, gym_id, user_id, role, name, phone, deactivated_at)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), 'member', 'SCI Member ' || s.n, '+2376012750' || lpad(s.n::text, 2, '0'),
       case when s.n in (37, 68) then now() - interval '1 day' end
from (values
  (6, pg_temp.g(1)), (32, pg_temp.g(1)), (33, pg_temp.g(1)), (34, pg_temp.g(1)), (35, pg_temp.g(1)), (36, pg_temp.g(1)), (37, pg_temp.g(1)),
  (38, pg_temp.g(1)), (39, pg_temp.g(1)), (40, pg_temp.g(1)), (41, pg_temp.g(1)), (42, pg_temp.g(1)), (43, pg_temp.g(1)), (44, pg_temp.g(1)),
  (45, pg_temp.g(1)), (46, pg_temp.g(1)), (47, pg_temp.g(1)), (48, pg_temp.g(1)), (49, pg_temp.g(1)),
  (64, pg_temp.g(2)), (65, pg_temp.g(2)), (66, pg_temp.g(2)), (67, pg_temp.g(2)), (68, pg_temp.g(2)), (69, pg_temp.g(2)), (70, pg_temp.g(2)),
  (80, pg_temp.g(4)), (81 - 30, pg_temp.g(3)), (82 - 30, pg_temp.g(5)), (83 - 30, pg_temp.g(5)), (84 - 30, pg_temp.g(5))
) as s(n, gym);
-- readable aliases for the numbers above
create function pg_temp.mem(label text) returns uuid language sql immutable as $f$
  select pg_temp.m(case label
    when 'active' then 32 when 'expiring' then 33 when 'grace' then 34 when 'expired5' then 35 when 'expired0' then 36 when 'deactivated' then 37
    when 'feedue' then 38 when 'noplan' then 39 when 'inside' then 40 when 'stale' then 41 when 'ppsA' then 42
    when 'mgr_target' then 43 when 'sup_target' then 44 when 'own_target' then 45 when 'support1' then 46 when 'support2' then 47
    when 'bound' then 48 when 'dbl' then 49
    when 'pps_paid' then 64 when 'pps_none' then 65 when 'pps_free' then 66 when 'pps_zero' then 67 when 'pps_deact' then 68 when 'pps_scan' then 69 when 'pps_link' then 70
    when 'b_member' then 80 when 's_member' then 51 when 'o1' then 52 when 'o2' then 53 when 'o3' then 54
    when 'self' then 6 end) $f$;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000275301', pg_temp.g(1), 'SCI Monthly A',  'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000275302', pg_temp.g(1), 'SCI PPS A',      'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000275303', pg_temp.g(2), 'SCI PPS C',      'pay_per_session', 2000,  'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000275304', pg_temp.g(2), 'SCI PPS Zero C', 'pay_per_session', 0,     'XAF', 'monthly', null),
  ('00000000-0000-0000-0000-000000275305', pg_temp.g(4), 'SCI Monthly B',  'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000275306', pg_temp.g(3), 'SCI Monthly S',  'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000275307', pg_temp.g(5), 'SCI Monthly O',  'monthly',         15000, 'XAF', 'monthly', 30);

-- Subscriptions. Statuses are inserted directly (the lifecycle job is not run). Dates are relative to the GYM's today.
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id, s.plan::uuid, s.status::subscription_status, current_date - 40, s.expiry
from (values
  ('active',     'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('expiring',   'expiring_soon', '00000000-0000-0000-0000-000000275301', current_date + 2),
  ('grace',      'grace_period',  '00000000-0000-0000-0000-000000275301', pg_temp.gt(1) - 2),
  ('expired5',   'expired',  '00000000-0000-0000-0000-000000275301', pg_temp.gt(1) - 5),
  ('expired0',   'expired',  '00000000-0000-0000-0000-000000275301', pg_temp.gt(1)),
  ('deactivated','active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('inside',     'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('stale',      'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('ppsA',       'active',   '00000000-0000-0000-0000-000000275302', null),
  ('mgr_target', 'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('sup_target', 'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('own_target', 'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('support1',   'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('support2',   'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('bound',      'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('dbl',        'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('self',       'active',   '00000000-0000-0000-0000-000000275301', current_date + 25),
  ('pps_paid',   'active',   '00000000-0000-0000-0000-000000275303', null),
  ('pps_none',   'active',   '00000000-0000-0000-0000-000000275303', null),
  ('pps_free',   'active',   '00000000-0000-0000-0000-000000275303', null),
  ('pps_zero',   'active',   '00000000-0000-0000-0000-000000275304', null),
  ('pps_deact',  'active',   '00000000-0000-0000-0000-000000275303', null),
  ('pps_scan',   'active',   '00000000-0000-0000-0000-000000275303', null),
  ('pps_link',   'active',   '00000000-0000-0000-0000-000000275303', null),
  ('b_member',   'active',   '00000000-0000-0000-0000-000000275305', current_date + 25),
  ('s_member',   'active',   '00000000-0000-0000-0000-000000275306', current_date + 25),
  ('o1',         'active',   '00000000-0000-0000-0000-000000275307', current_date + 25),
  ('o2',         'active',   '00000000-0000-0000-0000-000000275307', current_date + 25),
  ('o3',         'active',   '00000000-0000-0000-0000-000000275307', current_date + 25)
) as s(label, status, plan, expiry)
join members m on m.id = pg_temp.mem(s.label);

-- A fee-due member (no plan, fee unsettled) and a member with no plan (settled). The trigger settles at insert (fee 0); clear 'feedue'.
update members set registration_fee_settled_at = null where id = pg_temp.mem('feedue');

-- Open rows: 'inside' 10 minutes ago, 'stale' 20 hours ago (the timeout is 8 hours).
insert into attendance_events (gym_id, member_id, checked_in_at) values
  (pg_temp.g(1), pg_temp.mem('inside'), now() - interval '10 minutes'),
  (pg_temp.g(1), pg_temp.mem('stale'),  now() - interval '20 hours');

-- Paid and free sessions (a verified session payment and a session row, or a ledger grant row and a free session).
create function pg_temp.mk_paid(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_payment uuid; v_session uuid;
begin
  insert into payments (gym_id, member_id, subscription_id, amount, currency, method, status, purpose)
  values (p_gym, p_member, null, 2000, 'XAF', 'cash', 'verified', 'session') returning id into v_payment;
  insert into guest_sessions (gym_id, member_id, payment_id, usable_until)
  values (p_gym, p_member, v_payment, now() + interval '30 days') returning id into v_session;
  return v_session;
end $mk$;
create function pg_temp.mk_free(p_gym uuid, p_member uuid) returns uuid language plpgsql security definer as $mk$
declare v_grant uuid; v_session uuid;
begin
  insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
  values (p_gym, p_member, 'reward_granted', 'guest', gen_random_uuid()) returning id into v_grant;
  insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
  values (p_gym, p_member, v_grant, now() + interval '30 days') returning id into v_session;
  return v_session;
end $mk$;
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('pps_paid'));
select pg_temp.mk_free(pg_temp.g(2), pg_temp.mem('pps_free'));
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('pps_deact'));
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('pps_link'));
update members set deactivated_at = now() - interval '1 day' where id = pg_temp.mem('pps_deact');

-- A deactivated staff member (10) and a staff member whose role changes (11) are deactivated / demoted AFTER the first successful call.

-- Support: a live support person for gym A (assigned, switch on, aal2 session), a second member of the pair for gym S (suspended).
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000275408', now());
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id in (pg_temp.g(1), pg_temp.g(2), pg_temp.g(3));
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at) values
  ('00000000-0000-0000-0000-000000275461', '00000000-0000-0000-0000-000000275408', pg_temp.g(1), 'active', now()),
  ('00000000-0000-0000-0000-000000275462', '00000000-0000-0000-0000-000000275408', pg_temp.g(3), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000002754a1', '00000000-0000-0000-0000-000000275408', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000002754a1', '00000000-0000-0000-0000-000000275408', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000275461', true);
select private.support_set_membership('00000000-0000-0000-0000-000000275462', true);

-- ============================================================================
-- (1) Shape, privileges, registry, body proofs
-- ============================================================================
select is((select pg_get_function_arguments('public.staff_check_in(uuid)'::regprocedure)), 'p_member_id uuid',
          'staff_check_in takes only the member id: no time, no date, no scan id (entry cannot be dated)');
select is((select prosecdef from pg_proc where oid = 'public.staff_check_in(uuid)'::regprocedure), true, 'staff_check_in is SECURITY DEFINER');
select is((select has_function_privilege('anon', 'public.staff_check_in(uuid)', 'EXECUTE')), false, 'anon cannot execute staff_check_in');
select is((select has_function_privilege('authenticated', 'public.staff_check_in(uuid)', 'EXECUTE')), true, 'authenticated can execute staff_check_in');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.staff_check_in(uuid)'::regprocedure and a.grantee = 0), 0, 'PUBLIC has no EXECUTE on staff_check_in');
select is((select count(*)::int from private.support_capabilities where kind = 'rpc' and capability = 'attendance'
            and object_name in ('staff_check_in', 'void_staff_check_in', 'list_attendance_log')), 3, 'the three RPCs are registered for support in the same migration');
select ok((select prosrc like '%private.record_check_in(%' and prosrc like '%support_stepup_require(''support_staff_check_in'', p_member_id::text)%'
                  and prosrc like '%support_rpc_gym_id(''staff_check_in'')%' and prosrc ~ 'current_gym_status\(\)\s+is\s+distinct\s+from\s+''active'''
           from pg_proc where oid = 'public.staff_check_in(uuid)'::regprocedure),
          'the body calls record_check_in, the step-up, takes the gym from support_rpc_gym_id and carries the status guard');
select ok((select prosrc !~* 'insert\s+into\s+(public\.)?attendance_events' from pg_proc where oid = 'public.staff_check_in(uuid)'::regprocedure),
          'staff_check_in itself inserts no attendance row (record_check_in is the only inserter)');

-- ============================================================================
-- (2) Role and gym matrix
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('active')) ->> 'outcome', 'checked_in', 'a Receptionist checks an Active member in (R1)');
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.sci(pg_temp.mem('mgr_target')) ->> 'outcome', 'checked_in', 'a Manager checks a member in');
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'supervisor');
select is(pg_temp.sci(pg_temp.mem('sup_target')) ->> 'outcome', 'checked_in', 'a Supervisor checks a member in');
select pg_temp.claims(pg_temp.u(4), pg_temp.g(1), 'owner');
select is(pg_temp.sci(pg_temp.mem('own_target')) ->> 'outcome', 'checked_in', 'an Owner checks a member in');
select pg_temp.claims(pg_temp.u(5), pg_temp.g(1), 'coach');
select is(pg_temp.sci(pg_temp.mem('dbl')) ->> 'error', 'P0001:permission denied', 'a Coach is refused');
select pg_temp.claims(pg_temp.u(6), pg_temp.g(1), 'member');
select is(pg_temp.sci(pg_temp.mem('dbl')) ->> 'error', 'P0001:permission denied', 'a member is refused');
reset role;
set local role anon;
select throws_ok($$ select * from public.staff_check_in('00000000-0000-0000-0000-000000275232') $$, '42501', null, 'anon cannot call staff_check_in');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('dbl')), 0, 'the refused callers wrote nothing');

-- another gym's staff: the same coded answer as a missing id, nothing written
set local role authenticated;
select pg_temp.claims(pg_temp.u(7), pg_temp.g(4), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('dbl')), '{"outcome":"member_not_found"}'::jsonb, 'another gym''s staff meets member_not_found for this gym''s member');
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('b_member')), '{"outcome":"member_not_found"}'::jsonb, 'this gym''s staff meets member_not_found for another gym''s member');
select is(pg_temp.sci('00000000-0000-0000-0000-00000027ffff'), '{"outcome":"member_not_found"}'::jsonb, 'a missing id gives the identical answer (no existence oracle)');
select is(pg_temp.sci(pg_temp.m(5)), '{"outcome":"member_not_found"}'::jsonb, 'a staff row is not a member to check in');
reset role;
select is((select count(*)::int from attendance_events where member_id in (pg_temp.mem('dbl'), pg_temp.mem('b_member'))), 0, 'none of those wrote an attendance row');

-- deactivated and role-changed staff are refused on the next call (live resolution)
set local role authenticated;
select pg_temp.claims(pg_temp.u(10), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('dbl')) ->> 'outcome', 'checked_in', 'staff 10 works while active');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set deactivated_at = now() where id = pg_temp.m(10);
update members set role = 'coach' where id = pg_temp.m(11);
set local role authenticated;
select pg_temp.claims(pg_temp.u(10), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('active')) ->> 'error', 'P0001:permission denied', 'a deactivated staff member is refused on the next call');
select pg_temp.claims(pg_temp.u(11), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('active')) ->> 'error', 'P0001:permission denied', 'a role-changed staff member (now a Coach) is refused though the token still says receptionist');
reset role;

-- who entered it: the caller, source staff, the instant is now(), the gym-local day, the member counted
select is((select ae.source || ':' || (ae.entered_by = pg_temp.u(1))::text || ':' || (ae.checked_in_at = now())::text || ':' || (ae.visit_day = private.gym_today(ae.gym_id))::text
           from attendance_events ae where ae.member_id = pg_temp.mem('active')),
          'staff:true:true:true', 'R1 row: source staff, entered_by the Receptionist, checked_in_at = now(), visit_day the gym-local day');
select is((select count(*)::int from attendance_counted where member_id = pg_temp.mem('active')), 1, 'the visit counts in attendance_counted');
select is((select count(*)::int from member_visit_days where member_id = pg_temp.mem('active') and visit_day = pg_temp.gt(1)), 1, 'the visit is a member_visit_days day');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in' and target_entity_id = pg_temp.mem('active')::text
            and actor_id = pg_temp.u(1) and metadata ->> 'outcome' = 'checked_in'), 1, 'one staff_check_in audit row: actor, member, outcome');

-- ============================================================================
-- (3) The outcome codes (R1 to R9) and their audit rows
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('expiring')) - 'attendance_id' - 'checked_in_at',
          jsonb_build_object('outcome', 'checked_in_expiring_soon', 'member_status', 'expiring_soon', 'expiry_date', current_date + 2),
          'R2: expiring soon is let in with its expiry date');
select is(pg_temp.sci(pg_temp.mem('grace')) - 'attendance_id' - 'checked_in_at',
          jsonb_build_object('outcome', 'checked_in_grace_period', 'member_status', 'grace_period', 'expiry_date', pg_temp.gt(1) - 2,
                             'grace_ends_on', pg_temp.gt(1) - 2 + 3),
          'R3: grace period is let in; grace_ends_on is the expiry plus the gym''s grace days');
select is(pg_temp.sci(pg_temp.mem('expired5')),
          jsonb_build_object('outcome', 'rejected_expired', 'member_status', 'expired', 'expiry_date', pg_temp.gt(1) - 5, 'days_since_expiry', 5),
          'R4: expired is rejected with the days since expiry');
select is(pg_temp.sci(pg_temp.mem('expired0')),
          jsonb_build_object('outcome', 'rejected_expired', 'member_status', 'expired', 'expiry_date', pg_temp.gt(1), 'days_since_expiry', 0),
          'R4 today variant: days_since_expiry is 0 when the membership expired today');
select is(pg_temp.sci(pg_temp.mem('inside')) - 'attendance_id' - 'since',
          jsonb_build_object('outcome', 'already_checked_in', 'member_status', 'active', 'expiry_date', current_date + 25),
          'R7: a member already inside is told so');
select is(pg_temp.sci(pg_temp.mem('deactivated')) ->> 'outcome', 'refused_deactivated', 'R8: deactivated');
select is(pg_temp.sci(pg_temp.mem('feedue')) ->> 'outcome', 'refused_registration_fee_due', 'R8: no plan and the registration fee unsettled');
select is(pg_temp.sci(pg_temp.mem('noplan')) ->> 'outcome', 'refused_no_plan', 'R8: no plan, fee settled');
select is(pg_temp.sci(pg_temp.mem('ppsA')) - 'attendance_id' - 'checked_in_at', '{"outcome":"checked_in","member_status":"active"}'::jsonb,
          'a Pay-per-session member at a gym with charging off is R1 with no session step (FR-156)');
reset role;

select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('expiring')), 1, 'R2 wrote its row');
select is((select count(*)::int from attendance_events where member_id in (pg_temp.mem('expired5'), pg_temp.mem('expired0'), pg_temp.mem('deactivated'),
            pg_temp.mem('feedue'), pg_temp.mem('noplan'))), 0, 'no attendance row for R4 and R8');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('inside')), 1, 'R7 wrote nothing: still the one open row');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in' and target_entity_id = pg_temp.mem('inside')::text), 0, 'R7 is not audited (a no-op is not an event)');
select is((select array_agg(metadata ->> 'outcome' order by target_entity_id) from audit_log where action_type = 'staff_check_in'
            and target_entity_id in (pg_temp.mem('expiring')::text, pg_temp.mem('grace')::text)),
          array['checked_in_with_warning', 'checked_in_with_warning'], 'R2 and R3 audit rows say "with a warning"');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_rejected' and target_entity_id = pg_temp.mem('expired5')::text
            and actor_id = pg_temp.u(1) and metadata ->> 'reason' = 'expired' and metadata ->> 'outcome' = 'rejected_expired'), 1,
          'R4: one staff_check_in_rejected audit row, committed (the function returned normally), with the reason code');
select is((select array_agg(metadata ->> 'reason' order by metadata ->> 'reason') from audit_log where action_type = 'staff_check_in_rejected'
            and target_entity_id in (pg_temp.mem('deactivated')::text, pg_temp.mem('feedue')::text, pg_temp.mem('noplan')::text)),
          array['deactivated', 'no_plan', 'registration_fee_due'], 'R8: one rejection audit row per refusal, each with its reason code');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_rejected'), 5, 'five rejections so far (two R4, three R8), none for R7 or an accepted entry');

-- R5 and the sessions, at the charging gym C
set local role authenticated;
select pg_temp.claims(pg_temp.u(12), pg_temp.g(2), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('pps_none')) - 'attendance_id', '{"outcome":"session_required","member_status":"active","session_amount":2000}'::jsonb,
          'R5: a Pay-per-session member with no usable session is asked for the session amount');
select is(pg_temp.sci(pg_temp.mem('pps_none')) ->> 'outcome', 'session_required', 'R5 again: every refusal is evidence (a second attempt)');
select is(pg_temp.sci(pg_temp.mem('pps_zero')) ->> 'outcome', 'checked_in', 'a Pay-per-session member on a 0 XAF plan is R1 (FR-156)');
select is(pg_temp.sci(pg_temp.mem('pps_deact')) ->> 'outcome', 'refused_deactivated', 'a deactivated member with a paid session is refused');
select is(pg_temp.sci(pg_temp.mem('pps_paid')) ->> 'outcome', 'checked_in', 'a Pay-per-session member with a paid session is checked in (it consumes that session)');
select is(pg_temp.sci(pg_temp.mem('pps_free')) ->> 'outcome', 'checked_in', 'a Pay-per-session member with a free session is checked in');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('pps_none')), 0, 'R5 wrote no attendance row');
select is((select count(*)::int from session_attempts where member_id = pg_temp.mem('pps_none') and source = 'staff' and scan_id is null), 2,
          'R5 wrote one session_attempts row per refusal, source staff');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_rejected' and target_entity_id = pg_temp.mem('pps_none')::text
            and metadata ->> 'reason' = 'no_paid_session' and (metadata ->> 'session_amount')::int = 2000), 2, 'R5: one staff_check_in_rejected row per refusal');
select is((select count(*)::int from audit_log where action_type = 'session_attempt_blocked' and target_entity_id = pg_temp.mem('pps_none')::text), 2,
          'R5: the existing trigger audit (session_attempt_blocked) is kept beside it, as for a scan');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mem('pps_deact') and consumed_at is not null), 0, 'a refused deactivated member consumed nothing');
select is((select count(*)::int from guest_sessions gs join attendance_events ae on ae.id = gs.covered_attendance_id
            where gs.member_id = pg_temp.mem('pps_paid') and gs.consumed_at is not null and ae.source = 'staff' and ae.entered_by = pg_temp.u(12)), 1,
          'the paid session was consumed and linked (covered_attendance_id) to the staff row');
select is((select count(*)::int from guest_sessions gs join attendance_events ae on ae.id = gs.covered_attendance_id
            where gs.member_id = pg_temp.mem('pps_free') and gs.consumed_at is not null and gs.loyalty_grant_id is not null), 1, 'the free session was consumed and linked too');
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mem('pps_zero')), 0, 'the 0 XAF plan consumed no session (none exists)');

-- the Guest-sessions card: one scan attempt and one staff attempt are both counted (AD-31)
select is((select count(*)::int from session_attempts where gym_id = pg_temp.g(2) and source = 'staff'), 2, 'baseline: two staff attempts at gym C');
set local role authenticated;
select pg_temp.claims(pg_temp.u(69), pg_temp.g(2), 'member');
select ok((select (public.check_in()).id is null), 'a Pay-per-session member with no session scans and is refused (a null row)');
reset role;
select is((select count(*)::int from session_attempts where member_id = pg_temp.mem('pps_scan') and source = 'check_in'), 1, 'the scan wrote one attempt with source check_in');
set local role authenticated;
select pg_temp.claims(pg_temp.u(13), pg_temp.g(2), 'owner');
select is((select blocked_count from guest_sessions_summary('today')), 3::bigint, 'the card counts the scan attempt and both staff attempts');
select is((select array_agg(source order by source) from (select distinct source from list_session_attempts('today', 50, 0)) q), array['check_in', 'staff'],
          'the Blocked attempts list shows both sources (the dashboard renders staff as "Desk check-in")');
reset role;

-- no front_desk_alerts row for any staff outcome, accepted or rejected (the scan above is the one that alerts)
select is((select count(*)::int from front_desk_alerts where member_id in (
             pg_temp.mem('active'), pg_temp.mem('expiring'), pg_temp.mem('grace'), pg_temp.mem('expired5'), pg_temp.mem('expired0'), pg_temp.mem('inside'),
             pg_temp.mem('deactivated'), pg_temp.mem('feedue'), pg_temp.mem('noplan'), pg_temp.mem('ppsA'), pg_temp.mem('pps_none'), pg_temp.mem('pps_zero'),
             pg_temp.mem('pps_deact'), pg_temp.mem('pps_paid'), pg_temp.mem('pps_free'))), 0,
          'no front_desk_alerts row of any kind for any staff outcome (accepted, rejected, R5, R7, R8)');
select is((select count(*)::int from front_desk_alerts where member_id = pg_temp.mem('pps_scan') and kind = 'session_required'), 1, 'the scan path still raises its alert (unchanged)');

-- ============================================================================
-- (4) R9, the stale open row, a double submit, check-out
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(9), pg_temp.g(3), 'receptionist');
select alike(pg_temp.sci(pg_temp.mem('s_member')) ->> 'error', 'P0001:staff_check_in: gym % is not active', 'R9: a suspended gym raises the shipped gym-not-active exception');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('s_member')) + (select count(*)::int from audit_log where target_entity_id = pg_temp.mem('s_member')::text), 0,
          'R9 wrote nothing at all');

set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('stale')) ->> 'outcome', 'checked_in', 'a stale open check-in (older than the gym timeout) is auto-closed and the member is checked in (FR-044, AD-22)');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('stale') and checkout_type = 'auto' and checked_out_at is not null), 1, 'the stale row was closed as auto');
select is((select count(*)::int from audit_log where action_type = 'attendance_stale_check_in_auto_closed' and metadata ->> 'member_id' = pg_temp.mem('stale')::text), 1, 'the stale close is audited as for a scan');

-- double submit: one row, the second answer is R7 with the same attendance id and since
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('dbl')) ->> 'outcome', 'already_checked_in', 'the member was already checked in by staff 10 earlier: a repeat is R7');
select is((pg_temp.sci(pg_temp.mem('dbl')) ->> 'attendance_id')::uuid, (select id from attendance_events where member_id = pg_temp.mem('dbl')), 'the repeat names the row that exists');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('dbl') and checked_out_at is null), 1, 'a double submit leaves exactly one open row');

-- check-out of a staff entry is unchanged
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.err($$select check_out_member('00000000-0000-0000-0000-000000275220')$$), 'ok', 'check_out_member closes a staff entry as it closes a scan');
reset role;
select is((select checkout_type from attendance_events where member_id = pg_temp.m(32)), 'manual', 'closed as manual');

-- occupancy rises by one with a staff entry
select is(private.gym_occupancy_band(pg_temp.g(5)), 'low', 'gym O is low with nobody in');
set local role authenticated;
select pg_temp.claims(pg_temp.u(14), pg_temp.g(5), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('o1')) ->> 'outcome', 'checked_in', 'a staff entry at gym O');
reset role;
select is(private.gym_occupancy_band(pg_temp.g(5)), 'medium', 'member_occupancy_band rises: 1 of 3 is medium');

-- ============================================================================
-- (5) GymOS Support
-- ============================================================================
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support1')) ->> 'error',
          'P0001:step_up_required: support_staff_check_in needs a valid single-use step-up for this subject', 'support without a step-up: the coded step_up_required');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('support1')) + (select count(*)::int from audit_log where target_entity_id = pg_temp.mem('support1')::text), 0,
          'a refused step-up writes nothing');
select private.stepup_issue('00000000-0000-0000-0000-000000275408', 'support_staff_check_in', pg_temp.mem('bound')::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support1')) ->> 'error', 'P0001:step_up_required: support_staff_check_in needs a valid single-use step-up for this subject',
          'a grant bound to another member does not cover this one');
reset role;
select private.stepup_issue('00000000-0000-0000-0000-000000275408', 'support_staff_check_in', pg_temp.mem('support1')::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support1')) ->> 'outcome', 'checked_in', 'support with its step-up checks the member in');
select is(pg_temp.sci(pg_temp.mem('support1')) ->> 'error', 'P0001:step_up_required: support_staff_check_in needs a valid single-use step-up for this subject', 'the grant is single use');
reset role;
select is((select ae.source || ':' || (ae.entered_by = (select id from users where support_proxy_gym_id = pg_temp.g(1)))::text
           from attendance_events ae where ae.member_id = pg_temp.mem('support1')), 'staff:true', 'entered_by is the per-gym proxy, not the support person');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in' and target_entity_id = pg_temp.mem('support1')::text
            and actor_display_name = 'GymOS Support' and actor_id = (select id from users where support_proxy_gym_id = pg_temp.g(1))), 1,
          'the audit row names "GymOS Support" and the proxy');
select is((select count(*)::int from support_action_identity i join audit_log a on a.id = i.subject_id and i.subject_table = 'audit_log'
            where a.action_type = 'staff_check_in' and a.target_entity_id = pg_temp.mem('support1')::text and i.real_user_id = '00000000-0000-0000-0000-000000275408'), 1,
          'the real person is recorded in the private identity table through the audit row (the gym never sees it)');
select is((select count(*)::int from attendance_events where entered_by = '00000000-0000-0000-0000-000000275408' or voided_by = '00000000-0000-0000-0000-000000275408'), 0,
          'the raw attendance rows hold no real support identity');
select is((select count(*)::int from audit_log where action_type like 'staff_check_in%' and (actor_id = '00000000-0000-0000-0000-000000275408' or metadata::text like '%275408%')), 0,
          'no staff_check_in audit row carries the real support identity');
select is((select array_agg(distinct (u.display_name)) from attendance_events ae join users u on u.id = ae.entered_by where ae.member_id = pg_temp.mem('support1')), array['GYMOS SUPPORT'],
          'the only name behind the entry is the proxy''s');
select is((select (gym_id = pg_temp.g(1))::text from attendance_events where member_id = pg_temp.mem('support1')), 'true',
          'the gym the support caller acted on is the gym of the live session (support_rpc_gym_id, never a parameter)');

-- every refusal of a support caller that is not live, and the gym status the status guard reads is the support gym's
select private.stepup_issue('00000000-0000-0000-0000-000000275408', 'support_staff_check_in', pg_temp.mem('support2')::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1), 'aal1');
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'error', 'P0001:permission denied', 'an AAL1 support session is refused');
select pg_temp.sup_claims(pg_temp.g(4));
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'error', 'P0001:permission denied', 'a support person not assigned to the gym is refused');
select pg_temp.sup_claims(pg_temp.g(1), 'aal2', '00000000-0000-0000-0000-0000002754a9');
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'error', 'P0001:permission denied', 'a session the gate has never seen is refused');
select pg_temp.sup_claims(pg_temp.g(3));
select is(pg_temp.sci(pg_temp.mem('s_member')) ->> 'error', 'P0001:permission denied', 'a support caller at a suspended gym is refused (the live gate denies a suspended gym; no write)');
reset role;
select is((select count(*)::int from attendance_events where member_id in (pg_temp.mem('support2'), pg_temp.mem('s_member'))), 0, 'none of those refusals wrote a row');
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'error', 'P0001:permission denied', 'the Owner''s switch off refuses support on the next request');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
update public.support_assignments set state = 'suspended' where id = '00000000-0000-0000-0000-000000275461';
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'error', 'P0001:permission denied', 'a revoked (no longer active) assignment is refused');
reset role;
update public.support_assignments set state = 'active' where id = '00000000-0000-0000-0000-000000275461';
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.sci(pg_temp.mem('support2')) ->> 'outcome', 'checked_in', 'restored: the same grant still works (it was not spent by the refusals)');
reset role;

-- the stored proof of the 27.2 deferral: the gym status private.record_check_in reads and the gym staff_check_in acts on are one value
select ok((select position('support_rpc_gym_id' in prosrc) > 0 and pg_get_function_arguments(oid) not like '%gym%' from pg_proc where oid = 'public.staff_check_in(uuid)'::regprocedure),
          'staff_check_in has no gym parameter: the gym is resolved server-side, so record_check_in''s session-gym status check is that gym');

select * from finish();
rollback;
