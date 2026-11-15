-- Story 27.3: public.list_attendance_log (migration 0175), the Daily Log read that returns voided rows.
--
-- Proves: the signature and privileges, who reads it (Receptionist, Manager, Supervisor, Owner and live GymOS Support; Coach, member,
-- another gym's staff and a deactivated staff member get a uniform empty result, anon is refused), tenant isolation, the window and the
-- member filter, voided rows returned with their void data, the Entry label (staff name, "GymOS Support" for the proxy, null when the name
-- cannot be resolved, null for a scan), the voidable flag (a staff entry of today, not voided) and the two booleans the Void modal needs
-- (consumed_session, earned_stamp: only for a voidable row), a suspended gym raising, no real support identity in any output column, the
-- raw attendance_events row a staff client can select (entered_by holds only the proxy, voided rows hidden by the 0173 policy), and that
-- attendance_events is not in the Realtime publication.
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[59-5b]xx. Gyms 2759nn: 01 A, 02 C (charging, loyalty on), 03 B, 04 S (suspended).

begin;
select plan(41);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002759' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000275a' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-000000275b' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.proxy(p_gym uuid) returns uuid language sql security definer as $f$ select id from users where support_proxy_gym_id = p_gym $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.sup_claims(p_gym uuid, p_aal text default 'aal2') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000275ab1', 'role', 'authenticated', 'aal', p_aal,
                      'session_id', '00000000-0000-0000-0000-000000275ba1', 'app_role', 'support', 'gym_id', p_gym)::text, true);
end $f$;
create function pg_temp.sci(p_member uuid) returns jsonb language plpgsql as $f$
declare r record;
begin
  select * into r from public.staff_check_in(p_member);
  return jsonb_strip_nulls(to_jsonb(r));
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;
-- the log of a window as one jsonb array (ordered as returned), or the error
create function pg_temp.log(p_from timestamptz, p_to timestamptz, p_member uuid default null) returns jsonb language plpgsql as $f$
begin
  return coalesce((select jsonb_agg(to_jsonb(l)) from (select * from public.list_attendance_log(p_from, p_to, p_member)) l), '[]'::jsonb);
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000275901', 'LAL Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  (pg_temp.g(1), 'LAL Gym A', '00000000-0000-0000-0000-000000275901', 'active',    false, 0, 'Africa/Douala', 30, false, null, null, null),
  (pg_temp.g(2), 'LAL Gym C', '00000000-0000-0000-0000-000000275901', 'active',    true,  0, 'Africa/Douala', 30, true, 3, 3, 1),
  (pg_temp.g(3), 'LAL Gym B', '00000000-0000-0000-0000-000000275901', 'active',    false, 0, 'Africa/Douala', 30, false, null, null, null),
  (pg_temp.g(4), 'LAL Gym S', '00000000-0000-0000-0000-000000275901', 'suspended', false, 0, 'Africa/Douala', 30, false, null, null, null);
insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'lal-' || n || '@x.example', now() from generate_series(1, 90) n;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000275ab1', 'lal-support@gymosapps.com', now());

-- Staff: 01 receptionist A, 02 manager A, 03 coach A, 04 supervisor A, 05 owner A, 06 manager A to be deactivated, 07 manager B,
-- 08 receptionist C, 09 receptionist S, 0a former staff of A (deactivated, a name that must still resolve).
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, s.nm, '+2376002759' || lpad(s.n::text, 2, '0')
from (values
  (1, pg_temp.g(1), 'receptionist', 'Aicha Mballa'), (2, pg_temp.g(1), 'manager', 'Brice Nkoa'), (3, pg_temp.g(1), 'coach', 'Coach Cyril'),
  (4, pg_temp.g(1), 'supervisor', 'Sylvie Eto'), (5, pg_temp.g(1), 'owner', 'Olivier Tchoua'), (6, pg_temp.g(1), 'manager', 'Marc Fotso'),
  (7, pg_temp.g(3), 'manager', 'Bella Bassong'), (8, pg_temp.g(2), 'receptionist', 'Carine Daga'), (9, pg_temp.g(4), 'receptionist', 'Sandra Essomba'),
  (10, pg_temp.g(1), 'receptionist', 'Former Fabrice')
) as s(n, gym, role, nm);
update members set deactivated_at = now() - interval '2 days' where id = pg_temp.m(10);

-- Members: A 20-2f, C 30-33, B 40, S 50.
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(n), case when n between 32 and 47 then pg_temp.g(1) when n between 48 and 51 then pg_temp.g(2) when n = 64 then pg_temp.g(3) else pg_temp.g(4) end,
       pg_temp.u(n), 'member', 'LAL Member ' || n, '+2376012759' || lpad(n::text, 2, '0')
from generate_series(32, 80) n where n in (32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,64,80);
create function pg_temp.mem(label text) returns uuid language sql immutable as $f$
  select pg_temp.m(case label
    when 'scan' then 32 when 'open' then 33 when 'voided' then 34 when 'earlier' then 35 when 'support' then 36 when 'unresolved' then 37
    when 'former' then 38 when 'sup_voided' then 39 when 'paid' then 48 when 'free' then 49 when 'plain_c' then 50 when 'b' then 64 when 's' then 80 end) $f$;
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000275a01', pg_temp.g(1), 'LAL Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000275a02', pg_temp.g(2), 'LAL PPS C',   'pay_per_session', 2000, 'XAF', 'monthly', null);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id, case when m.gym_id = pg_temp.g(2) then '00000000-0000-0000-0000-000000275a02' else '00000000-0000-0000-0000-000000275a01' end::uuid,
       'active', current_date - 5, case when m.gym_id = pg_temp.g(2) then null else current_date + 25 end
from members m where m.role = 'member' and m.gym_id in (pg_temp.g(1), pg_temp.g(2));

-- Display names: staff 02 has a users.display_name; 04 has none and resolves from its members row; user 55 has neither (unresolved).
update users set display_name = 'Brice Nkoa' where id = pg_temp.u(2);
update users set display_name = null where id in (pg_temp.u(4), pg_temp.u(10), pg_temp.u(55));

-- Rows of gym A. Explicit instants, all within the gym-local day of now() except 'earlier' (about 40 hours ago).
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by) values
  ('00000000-0000-0000-0000-000000275c01', pg_temp.g(1), pg_temp.mem('scan'),       now() - interval '1 millisecond',  now(), 'manual', 'qr', null),
  ('00000000-0000-0000-0000-000000275c02', pg_temp.g(1), pg_temp.mem('open'),       now() - interval '2 milliseconds', null,  null,     'staff', pg_temp.u(2)),
  ('00000000-0000-0000-0000-000000275c03', pg_temp.g(1), pg_temp.mem('earlier'),    now() - interval '40 hours',       now() - interval '39 hours', 'manual', 'staff', pg_temp.u(2)),
  ('00000000-0000-0000-0000-000000275c05', pg_temp.g(1), pg_temp.mem('unresolved'), now() - interval '4 milliseconds', now(), 'manual', 'staff', pg_temp.u(55)),
  ('00000000-0000-0000-0000-000000275c06', pg_temp.g(1), pg_temp.mem('former'),     now() - interval '5 milliseconds', now(), 'manual', 'staff', pg_temp.u(10));
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by, voided_at, voided_by, void_reason) values
  ('00000000-0000-0000-0000-000000275c04', pg_temp.g(1), pg_temp.mem('voided'),     now() - interval '3 milliseconds', now(), 'void', 'staff', pg_temp.u(2), now(), pg_temp.u(4), 'wrong member selected');
-- A support entry and a support void: the actor columns hold the per-gym proxy, never the support person.
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by, voided_at, voided_by, void_reason)
select '00000000-0000-0000-0000-000000275c07', pg_temp.g(1), pg_temp.mem('sup_voided'), now() - interval '7 milliseconds', now(), 'void', 'staff', p.id, now(), p.id, 'entered on the wrong person'
from users p where p.support_proxy_gym_id = pg_temp.g(1);
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by)
select '00000000-0000-0000-0000-000000275c08', pg_temp.g(1), pg_temp.mem('support'), now() - interval '6 milliseconds', null, null, 'staff', p.id
from users p where p.support_proxy_gym_id = pg_temp.g(1);
-- Another gym's row, and a suspended gym's.
insert into attendance_events (id, gym_id, member_id, checked_in_at, checked_out_at, checkout_type) values
  ('00000000-0000-0000-0000-000000275c09', pg_temp.g(3), pg_temp.mem('b'), now() - interval '1 millisecond', now(), 'manual');

-- Gym C: real staff entries (paid session with a stamp, free session, and a plain one with nothing consumed).
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
select pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('paid'));
select pg_temp.mk_free(pg_temp.g(2), pg_temp.mem('free'));
-- 'plain_c' has no session and the gym charges: give it an Active monthly plan instead so it is exempt
update subscriptions set plan_id = '00000000-0000-0000-0000-000000275a01', expiry_date = current_date + 25 where member_id = pg_temp.mem('plain_c');
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select pg_temp.sci(pg_temp.mem('paid'));
select pg_temp.sci(pg_temp.mem('free'));
select pg_temp.sci(pg_temp.mem('plain_c'));
reset role;

-- Support (live for gym A).
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000275ab1', now());
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values ('00000000-0000-0000-0000-000000275b61', '00000000-0000-0000-0000-000000275ab1', pg_temp.g(1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-000000275ba1', '00000000-0000-0000-0000-000000275ab1', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-000000275ba1', '00000000-0000-0000-0000-000000275ab1', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000275b61', true);

-- ============================================================================
-- (1) Shape and privileges
-- ============================================================================
select is(pg_get_function_arguments('public.list_attendance_log(timestamptz, timestamptz, uuid)'::regprocedure),
          'p_from timestamp with time zone, p_to timestamp with time zone, p_member_id uuid DEFAULT NULL::uuid', 'list_attendance_log(p_from, p_to, p_member_id default null)');
select is((select prosecdef from pg_proc where oid = 'public.list_attendance_log(timestamptz, timestamptz, uuid)'::regprocedure), true, 'SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.list_attendance_log(timestamptz, timestamptz, uuid)', 'EXECUTE'), false, 'anon cannot execute it');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.list_attendance_log(timestamptz, timestamptz, uuid)'::regprocedure and a.grantee = 0), 0, 'PUBLIC has no EXECUTE');
select is((select count(*)::int from private.support_capabilities where kind = 'rpc' and object_name = 'list_attendance_log'), 1, 'registered for support');

-- ============================================================================
-- (2) Who reads it
-- ============================================================================
create function pg_temp.n(p jsonb) returns int language sql immutable as $f$ select case when jsonb_typeof(p) = 'array' then jsonb_array_length(p) else -1 end $f$;
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 8, 'a Receptionist reads gym A''s log: eight rows (scan, open, voided, earlier, unresolved, former, support, support-voided)');
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 8, 'a Manager reads the same');
select pg_temp.claims(pg_temp.u(4), pg_temp.g(1), 'supervisor');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 8, 'a Supervisor reads the same');
select pg_temp.claims(pg_temp.u(5), pg_temp.g(1), 'owner');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 8, 'an Owner reads the same');
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'coach');
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'a Coach gets a uniform empty result');
select pg_temp.claims(pg_temp.u(32), pg_temp.g(1), 'member');
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'a member gets a uniform empty result');
select pg_temp.claims(pg_temp.u(7), pg_temp.g(3), 'manager');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 1, 'another gym''s Manager sees only their own gym''s row (tenant isolation)');
select pg_temp.claims(pg_temp.u(7), pg_temp.g(1), 'manager');
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'another gym''s Manager claiming gym A gets an empty result');
reset role;
set local role anon;
select throws_ok($$ select * from public.list_attendance_log(now() - interval '1 day', now() + interval '1 day') $$, '42501', null, 'anon cannot call it');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set deactivated_at = now() where id = pg_temp.m(6);
set local role authenticated;
select pg_temp.claims(pg_temp.u(6), pg_temp.g(1), 'manager');
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'a deactivated Manager gets an empty result on the next call');
select pg_temp.claims(pg_temp.u(9), pg_temp.g(4), 'receptionist');
select alike(pg_temp.log(now() - interval '3 days', now() + interval '1 day') ->> 'error', 'P0001:list_attendance_log: gym % is not active', 'a suspended gym raises the shipped gym-not-active exception');
reset role;

-- ============================================================================
-- (3) The window, the filter, the order, the fields
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.n(pg_temp.log(now() - interval '50 hours', now() - interval '30 hours')), 1, 'the window bounds the rows (only the row of about 40 hours ago)');
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('open'))), 1, 'p_member_id narrows to one member');
select is((select array_agg(l.attendance_id order by l.checked_in_at desc, l.attendance_id) = array_agg(l.attendance_id) from list_attendance_log(now() - interval '3 days', now() + interval '1 day') l),
          true, 'newest first');
select is((select count(*)::int from list_attendance_log(now() - interval '3 days', now() + interval '1 day') l where l.attendance_id = '00000000-0000-0000-0000-000000275c09'), 0, 'another gym''s row is never returned');
select is((select to_jsonb(l) - 'member_id' - 'attendance_id' - 'checked_in_at' - 'checked_out_at' - 'visit_day' - 'voided_at' from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('scan')) l),
          jsonb_build_object('member_name', 'LAL MEMBER 32', 'checkout_type', 'manual', 'source', 'qr', 'entered_by_label', null, 'voided_by_label', null, 'void_reason', null,
                             'voidable', false, 'consumed_session', null, 'earned_stamp', null),
          'a scan: source qr, no Entry label, not voidable, no session flags');
select is((select (to_jsonb(l) ->> 'entered_by_label') || '|' || (to_jsonb(l) ->> 'voidable') || '|' || coalesce(to_jsonb(l) ->> 'consumed_session', '-') || '|' || coalesce(to_jsonb(l) ->> 'earned_stamp', '-')
           from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('open')) l),
          (select display_name from users where id = pg_temp.u(2)) || '|true|false|false', 'a staff entry of today, not voided: the staff name, voidable, the session flags computed (nothing consumed)');
select is((select (to_jsonb(l) ->> 'voidable') || '|' || coalesce(to_jsonb(l) ->> 'consumed_session', '-') from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('earlier')) l),
          'false|-', 'a staff entry of an earlier day is not voidable and carries no session flags');
select is((select (to_jsonb(l) ->> 'voidable') || '|' || (to_jsonb(l) ->> 'voided_by_label') || '|' || (to_jsonb(l) ->> 'void_reason') || '|' || coalesce(to_jsonb(l) ->> 'earned_stamp', '-')
           from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('voided')) l),
          'false|' || (select m.name from members m where m.id = pg_temp.m(4)) || '|wrong member selected|-',
          'a voided row is returned (the 0173 policies hide it from the base table), not voidable, with the voided-by name and the reason (the name resolves from the members row when users.display_name is empty)');
select is((select (to_jsonb(l) ->> 'entered_by_label') from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('former')) l),
          (select m.name from members m where m.id = pg_temp.m(10)), 'a former (deactivated) staff member''s name still resolves');
select is((select (to_jsonb(l) ->> 'source') || '|' || coalesce(to_jsonb(l) ->> 'entered_by_label', 'null') from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('unresolved')) l),
          'staff|null', 'a name that cannot be resolved is null: the row stays, the client shows "By staff"');
select is((select (to_jsonb(l) ->> 'entered_by_label') from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('support')) l),
          'GymOS Support', 'a support entry reads "GymOS Support"');
select is((select (to_jsonb(l) ->> 'entered_by_label') || '|' || (to_jsonb(l) ->> 'voided_by_label') from list_attendance_log(now() - interval '3 days', now() + interval '1 day', pg_temp.mem('sup_voided')) l),
          'GymOS Support|GymOS Support', 'a support entry voided by support: both labels read "GymOS Support"');
reset role;

-- the session flags of a voidable entry at the charging gym
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select is((select (to_jsonb(l) ->> 'consumed_session') || '|' || (to_jsonb(l) ->> 'earned_stamp') from list_attendance_log(now() - interval '1 day', now() + interval '1 day', pg_temp.mem('paid')) l),
          'true|true', 'a paid session consumed and a stamp earned: both booleans true');
select is((select (to_jsonb(l) ->> 'consumed_session') || '|' || (to_jsonb(l) ->> 'earned_stamp') from list_attendance_log(now() - interval '1 day', now() + interval '1 day', pg_temp.mem('free')) l),
          'true|false', 'a free session consumed: consumed_session true, no stamp');
select is((select (to_jsonb(l) ->> 'consumed_session') || '|' || (to_jsonb(l) ->> 'earned_stamp') from list_attendance_log(now() - interval '1 day', now() + interval '1 day', pg_temp.mem('plain_c')) l),
          'false|false', 'an entry that consumed nothing: both false');
reset role;

-- ============================================================================
-- (4) GymOS Support: reads the log, and no real identity appears anywhere in it
-- ============================================================================
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.n(pg_temp.log(now() - interval '3 days', now() + interval '1 day')), 8, 'a live support session reads the log (support has no attendance_events policy: this RPC is its only way)');
select is((select count(*)::int from list_attendance_log(now() - interval '3 days', now() + interval '1 day') l
            where to_jsonb(l)::text ~* '(275ab1|lal-support|gymosapps)'), 0, 'no output column of any row holds the real support identity (id or email)');
select pg_temp.sup_claims(pg_temp.g(1), 'aal1');
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'an AAL1 support session gets a uniform empty result');
select pg_temp.sup_claims(pg_temp.g(3));
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'a support person not assigned to gym B gets a uniform empty result');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = false where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.log(now() - interval '3 days', now() + interval '1 day'), '[]'::jsonb, 'the Owner''s switch off empties it on the next request');
reset role;
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);

-- ============================================================================
-- (5) The raw row a staff client can select, and Realtime
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is((select entered_by = pg_temp.proxy(pg_temp.g(1)) from attendance_events where member_id = pg_temp.mem('support')), true,
          'the raw attendance_events row of a support entry holds only the per-gym proxy id');
select is((select count(*)::int from attendance_events where member_id in (pg_temp.mem('voided'), pg_temp.mem('sup_voided'))), 0, 'a staff client selecting the base table never sees a voided row (the 0173 policy)');
select is((select count(*)::int from attendance_counted where member_id in (pg_temp.mem('voided'), pg_temp.mem('sup_voided'))), 0, 'nor through attendance_counted');
reset role;
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'attendance_events'), 0,
          'attendance_events is not in the Realtime publication: no payload exists (it would carry entered_by and would not deliver an update for a row the policy hides)');
select is((select array_agg(tablename::text order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'), array['front_desk_alerts', 'payments']::text[],
          'the publication still holds exactly front_desk_alerts and payments');

select * from finish();
rollback;
