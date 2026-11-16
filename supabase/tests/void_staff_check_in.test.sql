-- Story 27.3: public.void_staff_check_in (migration 0175), the same-day undo of a staff entry.
--
-- Proves: the signature and privileges, who may void (Manager, Supervisor, Owner; Receptionist, Coach, member, anon, another gym refused),
-- the effect of a void on an open and on a closed visit, the one-open slot freed at once (the member's own scan is accepted), the counts
-- (attendance_counted, member_visit_days, occupancy) dropping the visit, every coded refusal (invalid_reason, attendance_not_found,
-- already_voided, not_staff_entry, not_same_day, later_visit_relies with and without later_is_staff_entry) changing nothing, the session
-- an entry consumed going back to Unused ("unconsume") with its original usable_until, the payment untouched, the stamp reversed, an entry
-- that consumed nothing releasing nothing, the stamp-key consequence (a re-consumed session earns no second stamp), the lock order, the
-- three updaters reading the open row with voided_at is null (the 27.2 deferral), and GymOS Support (step-up, proxy, "GymOS Support").
--
-- Fixture ids: 00000000-0000-0000-0000-00000027[55-58]xx. Gyms 2755nn: 01 A (non-charging), 02 C (charging, loyalty on), 03 B.

begin;
select plan(114);

create function pg_temp.g(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002755' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.u(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002756' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.m(n int) returns uuid language sql immutable as $f$ select ('00000000-0000-0000-0000-0000002757' || lpad(to_hex(n), 2, '0'))::uuid $f$;
create function pg_temp.claims(p_user uuid, p_gym uuid, p_app_role text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'gym_id', p_gym, 'app_role', p_app_role)::text, true);
end $f$;
create function pg_temp.sup_claims(p_gym uuid, p_aal text default 'aal2') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000275808', 'role', 'authenticated', 'aal', p_aal,
                      'session_id', '00000000-0000-0000-0000-0000002758a1', 'app_role', 'support', 'gym_id', p_gym)::text, true);
end $f$;
create function pg_temp.sci(p_member uuid) returns jsonb language plpgsql as $f$
declare r record;
begin
  select * into r from public.staff_check_in(p_member);
  return jsonb_strip_nulls(to_jsonb(r));
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;
create function pg_temp.void(p_att uuid, p_reason text) returns jsonb language plpgsql as $f$
declare r record;
begin
  select * into r from public.void_staff_check_in(p_att, p_reason);
  return jsonb_strip_nulls(to_jsonb(r));
exception when others then
  return jsonb_build_object('error', sqlstate || ':' || sqlerrm);
end $f$;
create function pg_temp.err(stmt text) returns text language plpgsql as $f$
begin execute stmt; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
-- one text value of a statement, or its error (so a broken updater fails an assertion instead of aborting the file)
create function pg_temp.val(stmt text) returns text language plpgsql as $f$
declare v text;
begin execute stmt into v; return v; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.run(stmt text) returns void language plpgsql as $f$
begin execute stmt; exception when others then null; end $f$;
create function pg_temp.first_of(p_member uuid) returns uuid language sql security definer as $f$
  select id from attendance_events where member_id = p_member order by checked_in_at asc, created_at asc limit 1 $f$;
-- the latest attendance row of a member (as postgres)
create function pg_temp.att(p_member uuid) returns uuid language sql security definer as $f$
  select id from attendance_events where member_id = p_member order by checked_in_at desc, created_at desc limit 1 $f$;
create function pg_temp.gt(n int) returns date language sql security definer as $f$ select private.gym_today(pg_temp.g(n)) $f$;

-- ---- fixtures ---------------------------------------------------------------------------------------------------
insert into tiers (id, name, monthly_price, annual_price, member_cap) values ('00000000-0000-0000-0000-000000275501', 'VSC Tier', 6000, 60000, null);
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee, timezone, capacity,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  (pg_temp.g(1), 'VSC Gym A', '00000000-0000-0000-0000-000000275501', 'active', false, 0, 'Africa/Douala', 3, false, null, null, null),
  (pg_temp.g(2), 'VSC Gym C', '00000000-0000-0000-0000-000000275501', 'active', true,  0, 'Africa/Douala', 30, true, 3, 3, 1),
  (pg_temp.g(3), 'VSC Gym B', '00000000-0000-0000-0000-000000275501', 'active', false, 0, 'Africa/Douala', 30, false, null, null, null);

insert into auth.users (id, email, email_confirmed_at) select pg_temp.u(n), 'vsc-' || n || '@x.example', now() from generate_series(1, 120) n;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000275808', 'vsc-support@gymosapps.com', now());

-- Staff: 01 receptionist A, 02 manager A, 03 supervisor A, 04 owner A, 05 coach A, 06 manager A (to be deactivated), 07 manager B,
-- 08 receptionist C, 09 manager C, 0a owner C.
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(s.n), s.gym, pg_temp.u(s.n), s.role::member_role, 'VSC Staff ' || s.n, '+2376002755' || lpad(s.n::text, 2, '0')
from (values
  (1, pg_temp.g(1), 'receptionist'), (2, pg_temp.g(1), 'manager'), (3, pg_temp.g(1), 'supervisor'), (4, pg_temp.g(1), 'owner'),
  (5, pg_temp.g(1), 'coach'), (6, pg_temp.g(1), 'manager'), (7, pg_temp.g(3), 'manager'),
  (8, pg_temp.g(2), 'receptionist'), (9, pg_temp.g(2), 'manager'), (10, pg_temp.g(2), 'owner')
) as s(n, gym, role);

-- Members of A (20-39): 20 open void, 21 closed void, 22 scan row, 23 earlier day, 24 double void, 25 reasons, 26 supervisor target, 27 owner target,
-- 28 receptionist-refused, 29 other-gym attempt, 2a scan after void (also the member who scans), 2b updaters check_out, 2c check_out_member,
-- 2d auto-timeout job, 2e support void, 2f counts/occupancy, 30 History, 31 deactivated manager attempt, 32 support refusal.
-- Members of C (40-): 40 paid void, 41 free void, 42 covered entry, 43 later staff, 44 later scan, 45 charging-off equivalent not needed.
insert into members (id, gym_id, user_id, role, name, phone)
select pg_temp.m(n), case when n >= 64 then pg_temp.g(2) else pg_temp.g(1) end, pg_temp.u(n), 'member', 'VSC Member ' || n, '+2376012755' || lpad(n::text, 2, '0')
from generate_series(32, 80) n where n not in (65);

create function pg_temp.mem(label text) returns uuid language sql immutable as $f$
  select pg_temp.m(case label
    when 'open' then 32 when 'closed' then 33 when 'scan' then 34 when 'earlier' then 35 when 'double' then 36 when 'reasons' then 37
    when 'supv' then 38 when 'own' then 39 when 'recep' then 40 when 'other' then 41 when 'rescan' then 42
    when 'co1' then 43 when 'co2' then 44 when 'co3' then 45 when 'counts' then 46 when 'hist' then 47 when 'deactm' then 48
    when 'sup_ok' then 49 when 'sup_nostep' then 50 when 'sup_bound' then 51 when 'o1' then 52 when 'o2' then 53 when 'o3' then 54
    when 'paid' then 64 when 'free' then 66 when 'covered' then 67 when 'later_staff' then 68 when 'later_scan' then 69 
    end) $f$;

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000275801', pg_temp.g(1), 'VSC Monthly A', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000275802', pg_temp.g(2), 'VSC PPS C',     'pay_per_session', 2000,  'XAF', 'monthly', null);
insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date)
select m.gym_id, m.id,
       case when m.gym_id = pg_temp.g(1) then '00000000-0000-0000-0000-000000275801' else '00000000-0000-0000-0000-000000275802' end::uuid,
       'active', current_date - 5, case when m.gym_id = pg_temp.g(1) then current_date + 25 end
from members m where m.role = 'member' and m.id::text like '00000000-0000-0000-0000-0000002757%';

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
create temp table sess (label text primary key, id uuid);
insert into sess select 'paid', pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('paid'));
insert into sess select 'free', pg_temp.mk_free(pg_temp.g(2), pg_temp.mem('free'));
insert into sess select 'covered', pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('covered'));
insert into sess select 'later_staff', pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('later_staff'));
insert into sess select 'later_scan', pg_temp.mk_paid(pg_temp.g(2), pg_temp.mem('later_scan'));
update guest_sessions set usable_until = timestamptz '2099-01-01 12:00:00+00' where id = (select id from sess where label = 'paid');

-- Support (live for gym A) as in the other support suites.
insert into private.support_accounts (user_id, activated_at) values ('00000000-0000-0000-0000-000000275808', now());
select set_config('gymos.allow_support_setter', 'on', true);
update gyms set allow_gymos_support = true where id = pg_temp.g(1);
select set_config('gymos.allow_support_setter', 'off', true);
insert into public.support_assignments (id, support_user_id, gym_id, state, activated_at)
values ('00000000-0000-0000-0000-000000275861', '00000000-0000-0000-0000-000000275808', pg_temp.g(1), 'active', now());
insert into auth.sessions (id, user_id, created_at, updated_at) values ('00000000-0000-0000-0000-0000002758a1', '00000000-0000-0000-0000-000000275808', now(), now());
insert into private.support_session_state (session_id, user_id, started_at, last_seen_at)
values ('00000000-0000-0000-0000-0000002758a1', '00000000-0000-0000-0000-000000275808', now(), now());
select private.support_set_membership('00000000-0000-0000-0000-000000275861', true);

-- ============================================================================
-- (1) Shape and privileges
-- ============================================================================
select is(pg_get_function_arguments('public.void_staff_check_in(uuid, text)'::regprocedure), 'p_attendance_id uuid, p_reason text', 'void_staff_check_in(p_attendance_id, p_reason)');
select is((select prosecdef from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure), true, 'SECURITY DEFINER');
select is(has_function_privilege('anon', 'public.void_staff_check_in(uuid, text)', 'EXECUTE'), false, 'anon cannot execute it');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.void_staff_check_in(uuid, text)'::regprocedure and a.grantee = 0), 0, 'PUBLIC has no EXECUTE');
select ok((select position('for no key update' in prosrc) > 0
              and position('for no key update' in prosrc) < position('select x.* into ae' in prosrc)
              and position('select x.* into ae' in prosrc) < position('from guest_sessions gs' in prosrc)
              and position('from guest_sessions gs' in prosrc) < position('on_session_refunded_after_consumption' in prosrc)
           from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure),
          'lock order in the body (AD-29): the member, then the attendance row, then guest_sessions, then loyalty through the reversal hook');
select ok((select position('on_session_refunded_after_consumption' in prosrc) < position('consumed_at = null' in prosrc) from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure),
          'the stamp reversal runs BEFORE consumed_at is cleared (it returns early once the column is null)');
select ok((select prosrc !~* 'dirty_from' from pg_proc where oid = 'public.void_staff_check_in(uuid, text)'::regprocedure), 'the void never sets dirty_from (Epic 30 amends it)');

-- ============================================================================
-- (2) Entries to void: staff check-ins through the real function
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('open')) ->> 'outcome', 'checked_in', 'fixture: staff entry, open');
select is(pg_temp.sci(pg_temp.mem('closed')) ->> 'outcome', 'checked_in', 'fixture: staff entry, will be closed');
select is(pg_temp.sci(pg_temp.mem('double')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the double void');
select is(pg_temp.sci(pg_temp.mem('reasons')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the reason limits');
select is(pg_temp.sci(pg_temp.mem('supv')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the Supervisor');
select is(pg_temp.sci(pg_temp.mem('own')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the Owner');
select is(pg_temp.sci(pg_temp.mem('recep')) ->> 'outcome', 'checked_in', 'fixture: staff entry the Receptionist will fail to void');
select is(pg_temp.sci(pg_temp.mem('other')) ->> 'outcome', 'checked_in', 'fixture: staff entry another gym will fail to void');
select is(pg_temp.sci(pg_temp.mem('rescan')) ->> 'outcome', 'checked_in', 'fixture: staff entry, then the member scans after the void');
select is(pg_temp.sci(pg_temp.mem('counts')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the counts');
select is(pg_temp.sci(pg_temp.mem('hist')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the member History');
select is(pg_temp.sci(pg_temp.mem('deactm')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the deactivated manager');
select is(pg_temp.sci(pg_temp.mem('sup_nostep')) ->> 'outcome', 'checked_in', 'fixture: staff entry for support without a step-up');
select is(pg_temp.sci(pg_temp.mem('sup_ok')) ->> 'outcome', 'checked_in', 'fixture: staff entry for support');
select is(pg_temp.sci(pg_temp.mem('sup_bound')) ->> 'outcome', 'checked_in', 'fixture: staff entry for the bound grant');
reset role;
-- close 'closed' by a manual check-out (as the Receptionist would)
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select pg_temp.run($$select check_out_member('00000000-0000-0000-0000-000000275721')$$);
reset role;
select is((select checkout_type from attendance_events where member_id = pg_temp.mem('closed')), 'manual', 'fixture: the closed visit was checked out manually');

-- A scan row (source qr), and a staff row of yesterday (gym-local), both inserted directly.
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source)
values (pg_temp.g(1), pg_temp.mem('scan'), now() - interval '2 hours', now() - interval '1 hour', 'manual', 'qr');
insert into attendance_events (gym_id, member_id, checked_in_at, checked_out_at, checkout_type, source, entered_by)
values (pg_temp.g(1), pg_temp.mem('earlier'), now() - interval '30 hours', now() - interval '29 hours', 'manual', 'staff', pg_temp.u(2));
select ok((select visit_day < pg_temp.gt(1) from attendance_events where member_id = pg_temp.mem('earlier')), 'fixture: the earlier-day row sits on an earlier gym-local day');

-- ============================================================================
-- (3) Who may void
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('recep')), 'wrong member selected') ->> 'error', 'P0001:permission denied', 'a Receptionist cannot void');
select pg_temp.claims(pg_temp.u(5), pg_temp.g(1), 'coach');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('recep')), 'wrong member selected') ->> 'error', 'P0001:permission denied', 'a Coach cannot void');
select pg_temp.claims(pg_temp.u(32), pg_temp.g(1), 'member');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('recep')), 'wrong member selected') ->> 'error', 'P0001:permission denied', 'a member cannot void');
reset role;
set local role anon;
select throws_ok($$ select * from public.void_staff_check_in('00000000-0000-0000-0000-000000275721', 'wrong member selected') $$, '42501', null, 'anon cannot call it');
reset role;
set local role authenticated;
select pg_temp.claims(pg_temp.u(7), pg_temp.g(3), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('other')), 'wrong member selected'), '{"outcome":"attendance_not_found"}'::jsonb, 'another gym''s Manager meets attendance_not_found');
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void('00000000-0000-0000-0000-00000027ffff', 'wrong member selected'), '{"outcome":"attendance_not_found"}'::jsonb, 'a missing id is the identical answer (no oracle)');
reset role;
select is((select count(*)::int from attendance_events where voided_at is not null and member_id in (pg_temp.mem('recep'), pg_temp.mem('other'))), 0, 'no refused caller voided anything');
select set_config('request.jwt.claims', '{}', true);
update members set deactivated_at = now() where id = pg_temp.m(6);
set local role authenticated;
select pg_temp.claims(pg_temp.u(6), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('deactm')), 'wrong member selected') ->> 'error', 'P0001:permission denied', 'a deactivated Manager is refused on the next call although the token says manager');
reset role;

-- ============================================================================
-- (4) Coded refusals change nothing
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('reasons')), 'abcd'), '{"outcome":"invalid_reason"}'::jsonb, 'a 4 character reason is invalid_reason');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('reasons')), '    abcd    '), '{"outcome":"invalid_reason"}'::jsonb, 'a reason of 4 characters after trimming is invalid_reason');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('reasons')), repeat('x', 301)), '{"outcome":"invalid_reason"}'::jsonb, 'a 301 character reason is invalid_reason');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('reasons')), '      '), '{"outcome":"invalid_reason"}'::jsonb, 'a blank reason is invalid_reason');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('reasons')), null), '{"outcome":"invalid_reason"}'::jsonb, 'a null reason is invalid_reason');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('scan')), 'wrong member selected') - 'attendance_id', '{"outcome":"not_staff_entry"}'::jsonb, 'a scan row is not_staff_entry (a scan can never be voided)');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('earlier')), 'wrong member selected') - 'attendance_id', '{"outcome":"not_same_day"}'::jsonb, 'a row of an earlier gym-local day is not_same_day');
reset role;
select is((select count(*)::int from attendance_events where voided_at is not null and member_id in (pg_temp.mem('reasons'), pg_temp.mem('scan'), pg_temp.mem('earlier'))), 0, 'none of the refusals voided anything');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and gym_id = pg_temp.g(1)), 0, 'and none audited a void');

-- ============================================================================
-- (5) A void, open and closed
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('open')), '  wrong member selected  ') - 'attendance_id' - 'voided_at',
          '{"outcome":"voided","session_released":false,"stamp_removed":false}'::jsonb, 'a Manager voids an open staff entry; nothing consumed, nothing released');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('closed')), 'entered on the wrong person') ->> 'outcome', 'voided', 'a Manager voids a closed staff entry');
select pg_temp.claims(pg_temp.u(3), pg_temp.g(1), 'supervisor');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('supv')), 'wrong member selected') ->> 'outcome', 'voided', 'a Supervisor voids');
select pg_temp.claims(pg_temp.u(4), pg_temp.g(1), 'owner');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('own')), 'wrong member selected') ->> 'outcome', 'voided', 'an Owner voids');
reset role;
select is((select (voided_at = now())::text || ':' || (voided_by = pg_temp.u(2))::text || ':' || void_reason || ':' || (checked_out_at = now())::text || ':' || checkout_type
           from attendance_events where member_id = pg_temp.mem('open')),
          'true:true:wrong member selected:true:void', 'an open visit: voided_at, voided_by, the trimmed reason, checked_out_at = now() and checkout_type void');
select is((select checkout_type || ':' || (checked_out_at is not null)::text || ':' || (voided_at is not null)::text from attendance_events where member_id = pg_temp.mem('closed')),
          'manual:true:true', 'a closed visit keeps its check-out time and type; only the void columns are set');
select is((select count(*)::int from attendance_counted where member_id in (pg_temp.mem('open'), pg_temp.mem('closed'))), 0, 'voided visits drop out of attendance_counted');
select is((select count(*)::int from member_visit_days where member_id in (pg_temp.mem('open'), pg_temp.mem('closed'))), 0, 'and out of member_visit_days');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and target_entity_id = pg_temp.mem('open')::text and actor_id = pg_temp.u(2)
            and metadata ->> 'reason' = 'wrong member selected' and (metadata ->> 'original_checked_in_at') is not null
            and (metadata ->> 'session_released')::boolean = false and (metadata ->> 'stamp_removed')::boolean = false), 1,
          'one staff_check_in_voided audit row: actor, original entry time, reason');
select is((select count(*)::int from front_desk_alerts where member_id in (pg_temp.mem('open'), pg_temp.mem('closed'), pg_temp.mem('supv'), pg_temp.mem('own'))), 0, 'a void raises no front-desk alert');
select is((select count(*)::int from notifications where member_id = pg_temp.mem('open')), 0, 'the member is not notified');

-- a double void: one row, one audit row, the second answer is already_voided
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('double')), 'wrong member selected') ->> 'outcome', 'voided', 'double: the first void');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('double')), 'wrong member selected again') - 'attendance_id', '{"outcome":"already_voided"}'::jsonb, 'double: the second is already_voided');
reset role;
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and target_entity_id = pg_temp.mem('double')::text), 1, 'double: one audit row');
select is((select void_reason from attendance_events where member_id = pg_temp.mem('double')), 'wrong member selected', 'double: the first reason stands');

-- the slot is free at once: the member's own scan is accepted
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('rescan')), 'wrong member selected') ->> 'outcome', 'voided', 'rescan: voided');
select pg_temp.claims(pg_temp.u(42), pg_temp.g(1), 'member');
select ok((select (public.check_in()).id is not null), 'rescan: the member''s own scan is accepted immediately (the one-open slot is free)');
reset role;
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('rescan') and source = 'qr' and checked_out_at is null and voided_at is null), 1, 'rescan: one live open scan row beside the voided one');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('rescan') and voided_at is not null), 1, 'rescan: the voided row is still there');

-- occupancy and History
create temp table open_before as select count(*)::int as n from attendance_counted where gym_id = pg_temp.g(1) and checked_out_at is null;
set local role authenticated;
select pg_temp.claims(pg_temp.u(46), pg_temp.g(1), 'member');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('counts')), 1, 'before the void the member sees the visit in their History');
reset role;
set local role authenticated;
select pg_temp.claims(pg_temp.u(2), pg_temp.g(1), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('counts')), 'wrong member selected') ->> 'outcome', 'voided', 'counts: voided');
select pg_temp.claims(pg_temp.u(46), pg_temp.g(1), 'member');
select is((select count(*)::int from attendance_events where member_id = pg_temp.mem('counts')), 0, 'after the void the visit disappears from the member''s own History');
reset role;
select is((select count(*)::int from attendance_counted where gym_id = pg_temp.g(1) and checked_out_at is null), (select n - 1 from open_before),
          'occupancy (the open count the band reads) drops by the one voided visit');

-- ============================================================================
-- (6) The session an entry consumed (gym C, charging, loyalty on, threshold 3)
-- ============================================================================
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('paid')) ->> 'outcome', 'checked_in', 'paid: staff entry consumes the paid session');
select is(pg_temp.sci(pg_temp.mem('free')) ->> 'outcome', 'checked_in', 'free: staff entry consumes the free session');
select is(pg_temp.sci(pg_temp.mem('covered')) ->> 'outcome', 'checked_in', 'covered: first entry consumes the session');
select is(pg_temp.sci(pg_temp.mem('later_staff')) ->> 'outcome', 'checked_in', 'later_staff: first entry consumes the session');
select is(pg_temp.sci(pg_temp.mem('later_scan')) ->> 'outcome', 'checked_in', 'later_scan: first entry consumes the session');
reset role;
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mem('paid') and event_type = 'stamp_earned'), 1, 'paid: the entry earned its stamp');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mem('paid')), 1, 'paid: one stamp on the counter');

set local role authenticated;
select pg_temp.claims(pg_temp.u(9), pg_temp.g(2), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('paid')), 'wrong member selected') - 'attendance_id' - 'voided_at',
          '{"outcome":"voided","session_released":true,"stamp_removed":true}'::jsonb, 'paid: the void gives the session back and removes the stamp');
reset role;
select is((select consumed_at is null and covered_day is null and covered_attendance_id is null and voided_at is null and usable_until = timestamptz '2099-01-01 12:00:00+00'
           from guest_sessions where id = (select id from sess where label = 'paid')), true,
          'paid: the session is Unused again (consumed_at, covered_day, covered_attendance_id cleared), still not voided, with its original usable_until');
select is((select count(*)::int from payments where member_id = pg_temp.mem('paid') and status = 'verified' and voided_at is null)
          + (select count(*)::int from refunds where gym_id = pg_temp.g(2)), 1, 'paid: the desk payment is untouched and no refund was written');
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mem('paid') and event_type = 'stamp_reversed'), 1, 'paid: a stamp_reversed was appended');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mem('paid')), 0, 'paid: the counter is back at 0');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and target_entity_id = pg_temp.mem('paid')::text
            and (metadata ->> 'session_released')::boolean and (metadata ->> 'stamp_removed')::boolean), 1, 'paid: the void audit row says what it gave back');

-- the stamp-key consequence: the released session consumed again earns no second stamp
set local role authenticated;
select pg_temp.claims(pg_temp.u(64), pg_temp.g(2), 'member');
select ok((select (public.check_in()).id is not null), 'paid: the member''s scan consumes the released session again');
reset role;
select is((select count(*)::int from loyalty_events where member_id = pg_temp.mem('paid') and event_type = 'stamp_earned'), 1, 'stamp key: still one stamp_earned for the session (unique on origin_id and event_type)');
select is((select guest_stamps from loyalty_progress where member_id = pg_temp.mem('paid')), 0, 'stamp key: the re-consumed session earned no second stamp, the counter stays 0');
select is((select covered_attendance_id = (select id from attendance_events where member_id = pg_temp.mem('paid') and source = 'qr') from guest_sessions where id = (select id from sess where label = 'paid')), true,
          'the scan links the session to its own attendance row (covered_attendance_id is set for a scan too)');

-- the free session
set local role authenticated;
select pg_temp.claims(pg_temp.u(9), pg_temp.g(2), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('free')), 'wrong member selected') - 'attendance_id' - 'voided_at',
          '{"outcome":"voided","session_released":true,"stamp_removed":false}'::jsonb, 'free: the void gives the free session back; there was no stamp to remove');
reset role;
select is((select consumed_at is null and covered_attendance_id is null and loyalty_grant_id is not null and voided_at is null from guest_sessions where member_id = pg_temp.mem('free')), true,
          'free: back to Unused, still the granted free session (never revoked)');

-- The visits of one member on one day: a transaction has one now(), so the first visits are checked out and back-dated to give the day a
-- real order (a production member's two visits are two transactions).
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select pg_temp.run($$select check_out_member('00000000-0000-0000-0000-000000275743')$$);
select pg_temp.run($$select check_out_member('00000000-0000-0000-0000-000000275744')$$);
select pg_temp.run($$select check_out_member('00000000-0000-0000-0000-000000275745')$$);
reset role;
update attendance_events set checked_in_at = checked_in_at - interval '3 hours', checked_out_at = checked_out_at - interval '2 hours'
where member_id in (pg_temp.mem('covered'), pg_temp.mem('later_staff'), pg_temp.mem('later_scan')) and source = 'staff';

-- an entry that consumed nothing: the second visit of the day is covered by the first
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('covered')) ->> 'outcome', 'checked_in', 'covered: the second entry the same day is covered by the day''s session');
reset role;
select is((select count(*)::int from guest_sessions where member_id = pg_temp.mem('covered') and covered_attendance_id is not null), 1, 'covered: only the first entry is linked to the session');
set local role authenticated;
select pg_temp.claims(pg_temp.u(9), pg_temp.g(2), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('covered')), 'wrong member selected') - 'attendance_id' - 'voided_at',
          '{"outcome":"voided","session_released":false,"stamp_removed":false}'::jsonb, 'covered: voiding the covered second entry succeeds and releases nothing');
reset role;
select is((select consumed_at is not null from guest_sessions where member_id = pg_temp.mem('covered')), true, 'covered: the session stays consumed by the first entry');

-- a later same-day visit relies on the entry's session
set local role authenticated;
select pg_temp.claims(pg_temp.u(8), pg_temp.g(2), 'receptionist');
select is(pg_temp.sci(pg_temp.mem('later_staff')) ->> 'outcome', 'checked_in', 'later_staff: a second, staff-entered visit the same day (covered)');
select pg_temp.claims(pg_temp.u(69), pg_temp.g(2), 'member');
select ok((select (public.check_in()).id is not null), 'later_scan: the member scans in for a second visit the same day (covered)');
select pg_temp.claims(pg_temp.u(9), pg_temp.g(2), 'manager');
select is(pg_temp.void(pg_temp.first_of(pg_temp.mem('later_staff')), 'wrong member selected') - 'attendance_id',
          '{"outcome":"later_visit_relies","later_is_staff_entry":true}'::jsonb, 'later_visit_relies, later visit was a staff entry: the modal says "Void the later check-in first"');
select is(pg_temp.void(pg_temp.first_of(pg_temp.mem('later_scan')), 'wrong member selected') - 'attendance_id',
          '{"outcome":"later_visit_relies","later_is_staff_entry":false}'::jsonb, 'later_visit_relies, later visit was a scan: later_is_staff_entry is false (the end of the road)');
reset role;
select is((select count(*)::int from attendance_events where member_id in (pg_temp.mem('later_staff'), pg_temp.mem('later_scan')) and voided_at is not null), 0, 'a refused void changed nothing');
select is((select count(*)::int from guest_sessions where member_id in (pg_temp.mem('later_staff'), pg_temp.mem('later_scan')) and consumed_at is not null and covered_attendance_id is not null), 2, 'the sessions are still consumed and linked');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and target_entity_id in (pg_temp.mem('later_staff')::text, pg_temp.mem('later_scan')::text)), 0, 'and nothing was audited');
-- void the later staff entry first, then the first one
set local role authenticated;
select pg_temp.claims(pg_temp.u(9), pg_temp.g(2), 'manager');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('later_staff')), 'wrong member selected') ->> 'outcome', 'voided', 'later_staff: voiding the later check-in first works (it released nothing)');
select is(pg_temp.void(pg_temp.first_of(pg_temp.mem('later_staff')), 'wrong member selected again') ->> 'session_released', 'true', 'later_staff: then the first entry can be voided and gives the session back');
reset role;

-- ============================================================================
-- (7) The three updaters read the open row with voided_at is null (the 27.2 deferral)
--     A voided open row sits beside a live one; each updater must close the live one and leave the voided one alone.
-- ============================================================================
insert into attendance_events (id, gym_id, member_id, checked_in_at, voided_at, voided_by, void_reason, source, entered_by) values
  ('00000000-0000-0000-0000-0000002759b1', pg_temp.g(1), pg_temp.mem('o1'), now() - interval '9 hours', now() - interval '8 hours', pg_temp.u(2), 'wrong member selected', 'staff', pg_temp.u(2)),
  ('00000000-0000-0000-0000-0000002759b2', pg_temp.g(1), pg_temp.mem('o2'), now() - interval '9 hours', now() - interval '8 hours', pg_temp.u(2), 'wrong member selected', 'staff', pg_temp.u(2)),
  ('00000000-0000-0000-0000-0000002759b3', pg_temp.g(1), pg_temp.mem('o3'), now() - interval '40 hours', now() - interval '39 hours', pg_temp.u(2), 'wrong member selected', 'staff', pg_temp.u(2));
insert into attendance_events (id, gym_id, member_id, checked_in_at) values
  ('00000000-0000-0000-0000-0000002759c1', pg_temp.g(1), pg_temp.mem('o1'), now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-0000002759c2', pg_temp.g(1), pg_temp.mem('o2'), now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-0000002759c3', pg_temp.g(1), pg_temp.mem('o3'), now() - interval '30 hours');

-- check_out() (the member)
set local role authenticated;
select pg_temp.claims(pg_temp.u(52), pg_temp.g(1), 'member');
select is(pg_temp.val($$select (public.check_out()).id::text$$), '00000000-0000-0000-0000-0000002759c1', 'check_out() closes the LIVE open row, not the voided one');
reset role;
select is((select checked_out_at is null from attendance_events where id = '00000000-0000-0000-0000-0000002759b1'), true, 'check_out(): the voided open row is left alone');
-- check_out_member() (staff)
set local role authenticated;
select pg_temp.claims(pg_temp.u(1), pg_temp.g(1), 'receptionist');
select is(pg_temp.val($$select (public.check_out_member('00000000-0000-0000-0000-000000275735')).id::text$$), '00000000-0000-0000-0000-0000002759c2', 'check_out_member() closes the LIVE open row, not the voided one');
reset role;
select is((select checked_out_at is null from attendance_events where id = '00000000-0000-0000-0000-0000002759b2'), true, 'check_out_member(): the voided open row is left alone');
-- the auto-timeout job
select run_check_in_auto_timeout_job();
select is((select checkout_type || ':' || (checked_out_at is not null)::text from attendance_events where id = '00000000-0000-0000-0000-0000002759c3'), 'auto:true', 'the auto-timeout job closes the stale LIVE row');
select is((select checked_out_at is null and checkout_type is null from attendance_events where id = '00000000-0000-0000-0000-0000002759b3'), true, 'the auto-timeout job leaves the stale VOIDED open row alone');
select is((select status from job_runs where job_name = 'check_in_auto_timeout' order by started_at desc limit 1), 'success', 'the job ran clean');

-- ============================================================================
-- (8) GymOS Support
-- ============================================================================
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.void(pg_temp.att(pg_temp.mem('sup_nostep')), 'wrong member selected') ->> 'error',
          'P0001:step_up_required: support_void_staff_check_in needs a valid single-use step-up for this subject', 'support without a step-up: step_up_required');
reset role;
select is((select voided_at is null from attendance_events where member_id = pg_temp.mem('sup_nostep')), true, 'nothing was voided');
select private.stepup_issue('00000000-0000-0000-0000-000000275808', 'support_void_staff_check_in', pg_temp.att(pg_temp.mem('sup_bound'))::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.void(pg_temp.att(pg_temp.mem('sup_ok')), 'wrong member selected') ->> 'error',
          'P0001:step_up_required: support_void_staff_check_in needs a valid single-use step-up for this subject', 'a grant bound to another attendance row does not cover this one');
reset role;
select private.stepup_issue('00000000-0000-0000-0000-000000275808', 'support_void_staff_check_in', pg_temp.att(pg_temp.mem('sup_ok'))::text);
set local role authenticated;
select pg_temp.sup_claims(pg_temp.g(1));
select is(pg_temp.void(pg_temp.att(pg_temp.mem('sup_ok')), 'wrong member selected') ->> 'outcome', 'voided', 'support with its step-up voids');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('sup_ok')), 'wrong member selected') ->> 'error',
          'P0001:step_up_required: support_void_staff_check_in needs a valid single-use step-up for this subject', 'the grant is single use');
select pg_temp.sup_claims(pg_temp.g(1), 'aal1');
select is(pg_temp.void(pg_temp.att(pg_temp.mem('sup_bound')), 'wrong member selected') ->> 'error', 'P0001:permission denied', 'an AAL1 support session is refused');
reset role;
select is((select voided_by = (select id from users where support_proxy_gym_id = pg_temp.g(1)) from attendance_events where member_id = pg_temp.mem('sup_ok')), true, 'voided_by is the per-gym proxy');
select is((select count(*)::int from audit_log where action_type = 'staff_check_in_voided' and target_entity_id = pg_temp.mem('sup_ok')::text and actor_display_name = 'GymOS Support'
            and actor_id = (select id from users where support_proxy_gym_id = pg_temp.g(1))), 1, 'the audit row shows "GymOS Support"');
select is((select count(*)::int from attendance_events where voided_by = '00000000-0000-0000-0000-000000275808' or entered_by = '00000000-0000-0000-0000-000000275808'), 0,
          'no raw attendance row holds the real support identity');
select is((select count(*)::int from audit_log where action_type like 'staff_check_in%' and (actor_id = '00000000-0000-0000-0000-000000275808' or metadata::text like '%275808%')), 0,
          'no staff-check-in audit row holds the real support identity');
select is((select void_reason from attendance_events where member_id = pg_temp.mem('sup_ok')), 'wrong member selected', 'support''s void carries its reason');

select * from finish();
rollback;
