-- Story 22.3: live authorization in the database. Every role gate reads the live
-- membership (deactivation and role change take effect on the next statement,
-- whatever the token still claims); a NULL role denies in every rewritten
-- function; a suspended gym is still refused; payments reject a member of
-- another gym; Super Admin also needs the live users.is_super_admin flag.
begin;
select plan(86);

-- Helper functions (rolled back with the transaction). SECURITY INVOKER, so the
-- dynamic statement runs as the simulated caller.
create function public.zz_as(p_sub uuid, p_gym uuid, p_role text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'role', 'authenticated',
      'gym_id', p_gym, 'app_role', p_role))::text, true);
end $$;

-- NULL when the statement succeeds, otherwise the exact error message (denials are pinned per function).
create function public.zz_err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

grant execute on function public.zz_as(uuid, uuid, text), public.zz_err(text) to authenticated;

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000022001', 'Live Auth Tier', 5000, 50000, 50);

insert into gyms (id, name, tier_id, capacity, status, saas_billing_status) values
  ('00000000-0000-0000-0000-000000022101', 'Live Auth Gym', '00000000-0000-0000-0000-000000022001', 30, 'active', 'active'),
  ('00000000-0000-0000-0000-000000022102', 'Live Auth Gym Two', '00000000-0000-0000-0000-000000022001', 30, 'active', 'active'),
  ('00000000-0000-0000-0000-000000022103', 'Live Auth Suspended Gym', '00000000-0000-0000-0000-000000022001', 30, 'suspended', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000022201'), -- owner
  ('00000000-0000-0000-0000-000000022202'), -- supervisor
  ('00000000-0000-0000-0000-000000022203'), -- manager
  ('00000000-0000-0000-0000-000000022204'), -- receptionist
  ('00000000-0000-0000-0000-000000022205'), -- coach
  ('00000000-0000-0000-0000-000000022206'), -- member
  ('00000000-0000-0000-0000-000000022207'), -- owner of the suspended gym
  ('00000000-0000-0000-0000-000000022208'), -- no membership anywhere
  ('00000000-0000-0000-0000-000000022209'), -- Gym Two member (cross-gym payment)
  ('00000000-0000-0000-0000-000000022210'); -- super admin

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000022301', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022201', 'owner', 'LA Owner'),
  ('00000000-0000-0000-0000-000000022302', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022202', 'supervisor', 'LA Supervisor'),
  ('00000000-0000-0000-0000-000000022303', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022203', 'manager', 'LA Manager'),
  ('00000000-0000-0000-0000-000000022304', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022204', 'receptionist', 'LA Receptionist'),
  ('00000000-0000-0000-0000-000000022305', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022205', 'coach', 'LA Coach'),
  ('00000000-0000-0000-0000-000000022306', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022206', 'member', 'LA Member'),
  ('00000000-0000-0000-0000-000000022307', '00000000-0000-0000-0000-000000022103', '00000000-0000-0000-0000-000000022207', 'owner', 'LA Suspended Owner'),
  ('00000000-0000-0000-0000-000000022309', '00000000-0000-0000-0000-000000022102', '00000000-0000-0000-0000-000000022209', 'member', 'LA Gym Two Member');

insert into coach_assignments (id, gym_id, member_id, coach_id)
values ('00000000-0000-0000-0000-000000022401', '00000000-0000-0000-0000-000000022101',
        '00000000-0000-0000-0000-000000022306', '00000000-0000-0000-0000-000000022305');

insert into payments (id, gym_id, member_id, amount, currency, method, status) values
  ('00000000-0000-0000-0000-000000022501', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022306', 5000, 'XAF', 'cash', 'verified');

-- ============================================================================
-- Per role: live, role changed, deactivated. One read policy and one write RPC.
--   read  : payments (owner/supervisor/manager/receptionist), assigned members (coach)
--   write : set_registration_fee (owner, supervisor), assign_coach (manager),
--           record_registration_fee (receptionist), add_session_note (coach)
-- ============================================================================
-- Each block: sees the row and passes the role gate while live; after the member
-- row's role changes the gates use the NEW role; after deactivation gym_id() and
-- current_member_role() are NULL and the policy returns 0 rows.

-- ---- owner -----------------------------------------------------------------
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022101', 'owner');
select is((select count(*)::int from payments), 1, 'owner live: reads payments');
select ok(coalesce(zz_err($$ select set_registration_fee(1000) $$), '') !~ '(permission denied|not authorized|not a member|not a coach)', 'owner live: passes set_registration_fee gate');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022301';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022101', 'owner');
select is(private.current_member_role()::text, 'receptionist', 'owner token, receptionist row: live role is receptionist');
select is(zz_err($$ select set_registration_fee(2000) $$), 'permission denied', 'owner demoted to receptionist: set_registration_fee refused although the token says owner');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'owner', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022301';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022101', 'owner');
select is((select count(*)::int from payments), 0, 'owner deactivated: payments read returns 0 rows');
select is(zz_err($$ select set_registration_fee(3000) $$), 'permission denied', 'owner deactivated: set_registration_fee refused');
select ok(private.gym_id() is null and private.current_member_role() is null, 'owner deactivated: gym_id() and current_member_role() are NULL');
reset role;

-- ---- supervisor ------------------------------------------------------------
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022202', '00000000-0000-0000-0000-000000022101', 'supervisor');
select is((select count(*)::int from payments), 1, 'supervisor live: reads payments');
select ok(coalesce(zz_err($$ select set_registration_fee(1000) $$), '') !~ '(permission denied|not authorized|not a member|not a coach)', 'supervisor live: passes set_registration_fee gate');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022302';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022202', '00000000-0000-0000-0000-000000022101', 'supervisor');
select is(zz_err($$ select set_registration_fee(2000) $$), 'permission denied', 'supervisor demoted: set_registration_fee refused although the token says supervisor');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'supervisor', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022302';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022202', '00000000-0000-0000-0000-000000022101', 'supervisor');
select is((select count(*)::int from payments), 0, 'supervisor deactivated: payments read returns 0 rows');
select is(zz_err($$ select set_registration_fee(3000) $$), 'permission denied', 'supervisor deactivated: set_registration_fee refused');
reset role;

-- ---- manager ---------------------------------------------------------------
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022203', '00000000-0000-0000-0000-000000022101', 'manager');
select is((select count(*)::int from payments), 1, 'manager live: reads payments');
select ok(coalesce(zz_err($$ select assign_coach('00000000-0000-0000-0000-000000022306', '00000000-0000-0000-0000-000000022305') $$), '') !~ '(permission denied|not authorized|not a member|not a coach)', 'manager live: passes assign_coach gate');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022303';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022203', '00000000-0000-0000-0000-000000022101', 'manager');
select is(zz_err($$ select assign_coach('00000000-0000-0000-0000-000000022306', '00000000-0000-0000-0000-000000022305') $$), 'permission denied', 'manager demoted to receptionist: assign_coach refused although the token says manager');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'manager', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022303';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022203', '00000000-0000-0000-0000-000000022101', 'manager');
select is((select count(*)::int from payments), 0, 'manager deactivated: payments read returns 0 rows');
select is(zz_err($$ select assign_coach('00000000-0000-0000-0000-000000022306', '00000000-0000-0000-0000-000000022305') $$), 'permission denied', 'manager deactivated: assign_coach refused');
reset role;

-- ---- receptionist ----------------------------------------------------------
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022204', '00000000-0000-0000-0000-000000022101', 'receptionist');
select is((select count(*)::int from payments), 1, 'receptionist live: reads payments');
select ok(coalesce(zz_err($$ select record_registration_fee('00000000-0000-0000-0000-000000022306', 'cash', null) $$), '') !~ '(permission denied|not authorized|not a member|not a coach)', 'receptionist live: passes record_registration_fee gate');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'coach' where id = '00000000-0000-0000-0000-000000022304';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022204', '00000000-0000-0000-0000-000000022101', 'receptionist');
select is((select count(*)::int from payments), 0, 'receptionist re-roled to coach: payments read returns 0 rows although the token says receptionist');
select is(zz_err($$ select record_registration_fee('00000000-0000-0000-0000-000000022306', 'cash', null) $$), 'permission denied', 'receptionist re-roled to coach: record_registration_fee refused');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022304';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022204', '00000000-0000-0000-0000-000000022101', 'receptionist');
select is((select count(*)::int from payments), 0, 'receptionist deactivated: payments read returns 0 rows');
select is(zz_err($$ select record_registration_fee('00000000-0000-0000-0000-000000022306', 'cash', null) $$), 'permission denied', 'receptionist deactivated: record_registration_fee refused');
reset role;

-- ---- coach -----------------------------------------------------------------
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022205', '00000000-0000-0000-0000-000000022101', 'coach');
select is((select count(*)::int from members where id = '00000000-0000-0000-0000-000000022306'), 1, 'coach live: reads the assigned member');
select ok(coalesce(zz_err($$ select add_session_note('00000000-0000-0000-0000-000000022306', 'note') $$), '') !~ '(permission denied|not authorized|not a member|not a coach)', 'coach live: passes add_session_note gate');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022305';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022205', '00000000-0000-0000-0000-000000022101', 'coach');
select is(zz_err($$ select add_session_note('00000000-0000-0000-0000-000000022306', 'note') $$), 'permission denied', 'coach re-roled to receptionist: add_session_note refused although the token says coach');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'coach', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022305';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022205', '00000000-0000-0000-0000-000000022101', 'coach');
select is((select count(*)::int from members where id = '00000000-0000-0000-0000-000000022306'), 0, 'coach deactivated: assigned-member read returns 0 rows');
select is(zz_err($$ select add_session_note('00000000-0000-0000-0000-000000022306', 'note') $$), 'permission denied', 'coach deactivated: add_session_note refused');
reset role;

-- ============================================================================
-- Member: unchanged. Own payment row stays visible.
-- ============================================================================
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022206', '00000000-0000-0000-0000-000000022101', 'member');
select is((select count(*)::int from payments), 1, 'member: reads own payment');
select is(private.current_member_role()::text, 'member', 'member: live role is member');
reset role;

-- ============================================================================
-- Suspended gym: an active session of a suspended gym is still denied by the
-- existing gate (one policy, one RPC). gym_id() itself is not folded with status.
-- ============================================================================
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022207', '00000000-0000-0000-0000-000000022103', 'owner');
select is(private.gym_id(), '00000000-0000-0000-0000-000000022103'::uuid, 'suspended gym: gym_id() still resolves (an owner must reach billing)');
select is((select count(*)::int from members where gym_id = '00000000-0000-0000-0000-000000022103' and id <> '00000000-0000-0000-0000-000000022307'), 0, 'suspended gym: tenant_active_gate hides other members rows');
select throws_like($$ select set_registration_fee(1000) $$, '%is not active%', 'suspended gym: set_registration_fee refused by the active-gym guard');
reset role;

-- ============================================================================
-- gym_id(): foreign gym claim, malformed claim, no membership.
-- ============================================================================
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022102', 'owner');
select is(private.gym_id(), null::uuid, 'gym_id(): a claim for a gym the user has no membership in is NULL');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000022206","role":"authenticated","gym_id":"not-a-uuid","app_role":"member"}', true);
select lives_ok($$ select private.gym_id() $$, 'gym_id(): a malformed claim does not raise');
select is(private.gym_id(), null::uuid, 'gym_id(): a malformed claim is NULL');
reset role;

-- ============================================================================
-- NULL role: a caller with no membership row is denied by every rewritten function.
-- ============================================================================
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022208', '00000000-0000-0000-0000-000000022101', 'owner');
select is(private.current_member_role()::text, null, 'NULL role: caller with no membership has no live role');
select is(zz_err($$ select renew_subscription(gen_random_uuid(), 'x') $$), 'permission denied', 'NULL role: renew_subscription denied');
select is(zz_err($$ select check_out() $$), 'permission denied', 'NULL role: check_out denied');
select is(zz_err($$ select check_out_member(gen_random_uuid()) $$), 'permission denied', 'NULL role: check_out_member denied');
select is(zz_err($$ select check_in() $$), 'permission denied', 'NULL role: check_in denied');
select is(zz_err($$ select assign_coach(gen_random_uuid(), gen_random_uuid()) $$), 'permission denied', 'NULL role: assign_coach denied');
select is(zz_err($$ select add_session_note(gen_random_uuid(), 'x') $$), 'permission denied', 'NULL role: add_session_note denied');
select is(zz_err($$ select edit_session_note(gen_random_uuid(), 'x') $$), 'permission denied', 'NULL role: edit_session_note denied');
select is(zz_err($$ select connect_gym_payment_credentials('a', 'b', 'c', 'd') $$), 'permission denied', 'NULL role: connect_gym_payment_credentials denied');
select is(zz_err($$ select disconnect_gym_payment_credentials('a') $$), 'permission denied', 'NULL role: disconnect_gym_payment_credentials denied');
select is(zz_err($$ select initiate_member_payment() $$), 'permission denied', 'NULL role: initiate_member_payment denied');
select is(zz_err($$ select set_registration_fee(1) $$), 'permission denied', 'NULL role: set_registration_fee denied');
select is(zz_err($$ select record_registration_fee(gen_random_uuid(), 'cash', null) $$), 'permission denied', 'NULL role: record_registration_fee denied');
select is(zz_err($$ select waive_registration_fee(gen_random_uuid(), 'x') $$), 'permission denied', 'NULL role: waive_registration_fee denied');
select is(zz_err($$ select create_staff_member(gen_random_uuid(), 'n', 'p', 'coach') $$), 'create_staff_member: caller has no gym-scoped session', 'NULL role: create_staff_member denied');
select is(zz_err($$ select update_staff_role(gen_random_uuid(), 'n', 'coach') $$), 'update_staff_role: caller has no gym-scoped session', 'NULL role: update_staff_role denied');
select is(zz_err($$ select materialize_class_sessions(gen_random_uuid(), false) $$), 'permission denied', 'NULL role: materialize_class_sessions denied');
select is(zz_err($$ select create_class('c', null, gen_random_uuid(), 10, 'one_off', now() + interval '2 days', null, null, null) $$), 'permission denied', 'NULL role: create_class denied');
select is(zz_err($$ select update_class(gen_random_uuid(), 'c', null, gen_random_uuid(), 10, 'one_off', now() + interval '2 days', null, null, null) $$), 'permission denied', 'NULL role: update_class denied');
select is(zz_err($$ select book_class_session(gen_random_uuid()) $$), 'book_class_session: caller is not a member', 'NULL role: book_class_session denied');
select is(zz_err($$ select cancel_class_booking(gen_random_uuid()) $$), 'cancel_class_booking: caller is not a member', 'NULL role: cancel_class_booking denied');
select is(zz_err($$ select mark_class_attendance(gen_random_uuid()) $$), 'mark_class_attendance: permission denied', 'NULL role: mark_class_attendance denied');
select is(zz_err($$ select * from list_bookable_class_sessions() $$), 'list_bookable_class_sessions: caller is not a member', 'NULL role: list_bookable_class_sessions denied');
select is(zz_err($$ select * from list_my_class_bookings() $$), 'list_my_class_bookings: caller is not a member', 'NULL role: list_my_class_bookings denied');
select is(zz_err($$ select member_occupancy_band() $$), 'permission denied', 'NULL role: member_occupancy_band denied');
select is(zz_err($$ select initiate_registration_fee_payment(gen_random_uuid()) $$), 'permission denied', 'NULL role: initiate_registration_fee_payment denied');
select is(zz_err($$ select void_registration_fee_payment(gen_random_uuid(), 'x') $$), 'permission denied', 'NULL role: void_registration_fee_payment denied');
select is(zz_err($$ select log_audit_event('x', '00000000-0000-0000-0000-000000022101') $$), 'log_audit_event: p_gym_id does not match the caller''s own gym', 'NULL role: log_audit_event refuses a gym the caller has no live membership in');
select is(zz_err($$ select * from private.guest_sessions_period('today') $$), 'guest_sessions: permission denied', 'NULL role: guest_sessions_period denied');
reset role;

-- ============================================================================
-- Cross-gym payment: refused for service role and for staff, insert and update.
-- ============================================================================
select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status)
     values ('00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022309', 100, 'XAF', 'cash', 'pending') $$,
  '%does not belong to gym%', 'cross-gym payment: insert of another gym''s member is refused');
select throws_like(
  $$ update payments set member_id = '00000000-0000-0000-0000-000000022309' where id = '00000000-0000-0000-0000-000000022501' $$,
  '%does not belong to gym%', 'cross-gym payment: moving a payment to another gym''s member is refused');

-- ============================================================================
-- Super Admin: claim AND live flag.
-- ============================================================================
update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000022210';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022210', null, 'super_admin');
select ok(private.is_super_admin(), 'super admin: claim and live flag true');
select cmp_ok((select count(*)::int from gyms), '>=', 3, 'super admin: reads every gym');
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
update users set is_super_admin = false where id = '00000000-0000-0000-0000-000000022210';
reset role;
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022210', null, 'super_admin');
select ok(not private.is_super_admin(), 'super admin: flag false with a stale claim is denied');
select is((select count(*)::int from gyms), 0, 'super admin: flag false, gyms are not readable');
reset role;


-- ============================================================================
-- Added after review: stale claims, storage policy, payment trigger, gym_id move,
-- multi-gym user, direct helper assertions.
-- ============================================================================
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000022211'), -- live owner (storage policy)
  ('00000000-0000-0000-0000-000000022212'), -- live receptionist (payment trigger)
  ('00000000-0000-0000-0000-000000022213'), -- live manager (payment trigger)
  ('00000000-0000-0000-0000-000000022214'); -- multi-gym user
insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000022311', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022211', 'owner', 'LA Owner Two'),
  ('00000000-0000-0000-0000-000000022312', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022212', 'receptionist', 'LA Receptionist Two'),
  ('00000000-0000-0000-0000-000000022313', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022213', 'manager', 'LA Manager Two'),
  ('00000000-0000-0000-0000-000000022314', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022214', 'manager', 'LA Multi Gym A'),
  ('00000000-0000-0000-0000-000000022315', '00000000-0000-0000-0000-000000022102', '00000000-0000-0000-0000-000000022214', 'manager', 'LA Multi Gym B');
insert into storage.objects (bucket_id, name) values ('gym-logos', '00000000-0000-0000-0000-000000022101/logo.png');
insert into payments (id, gym_id, member_id, amount, currency, method, status) values
  ('00000000-0000-0000-0000-000000022502', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022306', 5000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000022503', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022306', 5000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000022504', '00000000-0000-0000-0000-000000022101', '00000000-0000-0000-0000-000000022306', 5000, 'XAF', 'cash', 'pending');

-- (a) log_audit_event: deactivated owner and no-membership caller, stale gym claim, p_gym_id = that gym.
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022101', 'owner');
select throws_like($$ select log_audit_event('x', '00000000-0000-0000-0000-000000022101') $$, '%does not match%', 'log_audit_event: a deactivated owner with a stale gym claim cannot write into that gym');
select zz_as('00000000-0000-0000-0000-000000022208', '00000000-0000-0000-0000-000000022101', 'owner');
select throws_like($$ select log_audit_event('x', '00000000-0000-0000-0000-000000022101') $$, '%does not match%', 'log_audit_event: a caller with no membership and a stale gym claim cannot write into that gym');
reset role;

-- (b) storage.objects owner_*_own_gym_logo: live owner, then demoted, then deactivated.
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022211', '00000000-0000-0000-0000-000000022101', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'gym-logos'), 1, 'logo policy: live owner reads the gym logo object');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'receptionist' where id = '00000000-0000-0000-0000-000000022311';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022211', '00000000-0000-0000-0000-000000022101', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'gym-logos'), 0, 'logo policy: owner demoted to receptionist no longer reads the logo although the token says owner');
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'owner', deactivated_at = now() where id = '00000000-0000-0000-0000-000000022311';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022211', '00000000-0000-0000-0000-000000022101', 'owner');
select is((select count(*)::int from storage.objects where bucket_id = 'gym-logos'), 0, 'logo policy: deactivated owner no longer reads the logo');
reset role;

-- (c) protect_payment_columns_on_staff_verify: pins for a live receptionist/manager, not for a demoted caller.
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022212', '00000000-0000-0000-0000-000000022101', 'receptionist');
update payments set amount = 1, method = 'bank_transfer', member_id = '00000000-0000-0000-0000-000000022306', status = 'verified'
  where id = '00000000-0000-0000-0000-000000022502';
reset role;
select is((select amount::text || '/' || method::text || '/' || status::text from payments where id = '00000000-0000-0000-0000-000000022502'), '5000/cash/verified',
  'payment trigger: a live receptionist verifies but amount and method stay pinned');
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022213', '00000000-0000-0000-0000-000000022101', 'manager');
update payments set amount = 1, method = 'bank_transfer', status = 'verified' where id = '00000000-0000-0000-0000-000000022503';
reset role;
select is((select amount::text || '/' || method::text from payments where id = '00000000-0000-0000-0000-000000022503'), '5000/cash',
  'payment trigger: a live manager verifies but amount and method stay pinned');
-- demoted: token says receptionist, live role supervisor (still passes the update policy, not in the trigger list)
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set role = 'supervisor' where id = '00000000-0000-0000-0000-000000022312';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022212', '00000000-0000-0000-0000-000000022101', 'receptionist');
update payments set amount = 1, status = 'verified' where id = '00000000-0000-0000-0000-000000022504';
reset role;
select is((select amount from payments where id = '00000000-0000-0000-0000-000000022504'), 1,
  'payment trigger: reads the live role, so a caller demoted from receptionist is not pinned by the receptionist rule (supervisor is outside the trigger list, pre-existing)');

-- (d) payments_member_same_gym on UPDATE of gym_id.
select throws_like(
  $$ update payments set gym_id = '00000000-0000-0000-0000-000000022102' where id = '00000000-0000-0000-0000-000000022501' $$,
  '%does not belong to gym%', 'cross-gym payment: moving a payment to another gym with its member is refused');

-- (e) multi-gym user: claim gym A deactivated, still active in gym B.
reset role;
select set_config('request.jwt.claims', '{}', true);
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000022314';
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022214', '00000000-0000-0000-0000-000000022101', 'manager');
select ok(private.gym_id() is null and private.current_member_role() is null, 'multi-gym: claim for the deactivated gym A resolves to nothing');
select is((select count(*)::int from payments), 0, 'multi-gym: claim for the deactivated gym A reads no payments');
select zz_as('00000000-0000-0000-0000-000000022214', '00000000-0000-0000-0000-000000022102', 'manager');
select is(private.gym_id(), '00000000-0000-0000-0000-000000022102'::uuid, 'multi-gym: claim for the active gym B resolves');
select is(private.current_member_role()::text, 'manager', 'multi-gym: claim for the active gym B resolves its live role');
reset role;

-- (f) helpers directly: deactivated token, flag-off Super Admin.
set local role authenticated;
select zz_as('00000000-0000-0000-0000-000000022201', '00000000-0000-0000-0000-000000022101', 'owner');
select is(private.gym_id(), null::uuid, 'helpers: gym_id() is NULL for a deactivated token');
select zz_as('00000000-0000-0000-0000-000000022210', null, 'super_admin');
select is(private.is_super_admin(), false, 'helpers: is_super_admin() is false for a super_admin claim with the live flag off');
reset role;

select * from finish();
rollback;
