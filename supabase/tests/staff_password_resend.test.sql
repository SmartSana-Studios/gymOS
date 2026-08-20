-- Story 9.2 (AC #4): staff_account_for_reset() -- Owner/Supervisor-only
-- ceiling, gym-scoped lookup, deactivated targets rejected. Session-
-- simulation shape copied verbatim from
-- staff_creation_role_ceiling_enforcement.test.sql.

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000018001', 'Staff Password Resend Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000018011', 'Staff Password Resend Gym A', '00000000-0000-0000-0000-000000018001', 30),
  ('00000000-0000-0000-0000-000000018012', 'Staff Password Resend Gym B', '00000000-0000-0000-0000-000000018001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000018021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000018022'), -- Gym A supervisor
  ('00000000-0000-0000-0000-000000018023'), -- Gym A manager
  ('00000000-0000-0000-0000-000000018024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000018025'), -- Gym A member
  ('00000000-0000-0000-0000-000000018026'), -- Gym A deactivated receptionist
  ('00000000-0000-0000-0000-000000018027'), -- Gym A active receptionist
  ('00000000-0000-0000-0000-000000018028'), -- Gym B owner
  ('00000000-0000-0000-0000-000000018029'), -- Gym B manager (cross-gym target)
  ('00000000-0000-0000-0000-000000018030'); -- Gym A second supervisor (ceiling target)

insert into members (id, gym_id, user_id, role, name, phone, deactivated_at) values
  ('00000000-0000-0000-0000-000000018071', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018021', 'owner', 'Resend Gym A Owner', '+237600000021', null),
  ('00000000-0000-0000-0000-000000018072', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018022', 'supervisor', 'Resend Gym A Supervisor', '+237600000022', null),
  ('00000000-0000-0000-0000-000000018073', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018023', 'manager', 'Resend Gym A Manager', '+237600000023', null),
  ('00000000-0000-0000-0000-000000018074', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018024', 'coach', 'Resend Gym A Coach', '+237600000024', null),
  ('00000000-0000-0000-0000-000000018075', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018025', 'member', 'Resend Gym A Member', '+237600000025', null),
  ('00000000-0000-0000-0000-000000018076', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018026', 'receptionist', 'Resend Gym A Deactivated Receptionist', '+237600000026', now()),
  ('00000000-0000-0000-0000-000000018077', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018027', 'receptionist', 'Resend Gym A Active Receptionist', '+237600000027', null),
  ('00000000-0000-0000-0000-000000018078', '00000000-0000-0000-0000-000000018012', '00000000-0000-0000-0000-000000018028', 'owner', 'Resend Gym B Owner', '+237600000028', null),
  ('00000000-0000-0000-0000-000000018079', '00000000-0000-0000-0000-000000018012', '00000000-0000-0000-0000-000000018029', 'manager', 'Resend Gym B Manager', '+237600000029', null),
  ('00000000-0000-0000-0000-000000018080', '00000000-0000-0000-0000-000000018011', '00000000-0000-0000-0000-000000018030', 'supervisor', 'Resend Gym A Second Supervisor', '+237600000030', null);

-- ============================================================================
-- (a) Owner can reset a Manager's password -- row returned, audit_log
-- written with action_type = 'staff_password_reset'.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"owner"}',
  true
);

select results_eq(
  $$select user_id, phone, name from staff_account_for_reset('00000000-0000-0000-0000-000000018073')$$,
  $$values ('00000000-0000-0000-0000-000000018023'::uuid, '+237600000023'::text, 'Resend Gym A Manager'::text)$$,
  'an owner-claim session can reset a Manager''s password and gets back the target user_id/phone/name'
);

reset role;

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_password_reset'
     and target_entity_id = '00000000-0000-0000-0000-000000018073'
     and metadata->>'target_name' = 'Resend Gym A Manager'),
  1,
  'an audit_log row was written with action_type = staff_password_reset'
);

-- ============================================================================
-- (b) Owner can reset any non-member staff role's password, including a
-- Supervisor's or another Owner-eligible target -- Owner has no
-- target-role ceiling (only Supervisor does, tested in (c) below).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018072')$$,
  'an owner-claim session can reset a Supervisor''s password'
);

select lives_ok(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018077')$$,
  'an owner-claim session can reset a Receptionist''s password'
);

select lives_ok(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018074')$$,
  'an owner-claim session can reset a Coach''s password'
);

-- ============================================================================
-- (c) Supervisor can reset a Manager/Coach's password, but is rejected by
-- the target-role ceiling when targeting an Owner or another Supervisor
-- (code-review finding, 2026-08-19 -- mirrors create_staff_member()'s own
-- Owner/Supervisor exclusion for Supervisor-initiated actions).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018073')$$,
  'a supervisor-claim session can reset a Manager''s password'
);

select lives_ok(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018074')$$,
  'a supervisor-claim session can reset a Coach''s password'
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018071')$$,
  '%staff_account_for_reset: caller is not authorized to reset a password for role owner%',
  'a supervisor-claim session cannot reset an Owner''s password (target-role ceiling)'
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018080')$$,
  '%staff_account_for_reset: caller is not authorized to reset a password for role supervisor%',
  'a supervisor-claim session cannot reset another Supervisor''s password (target-role ceiling)'
);

-- ============================================================================
-- (d) Manager, Coach, Receptionist, plain Member callers are all rejected
-- outright.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"manager"}',
  true
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018074')$$,
  '%staff_account_for_reset: caller is not authorized to reset staff passwords%',
  'a manager-claim session cannot reset any staff password'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"coach"}',
  true
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018073')$$,
  '%staff_account_for_reset: caller is not authorized to reset staff passwords%',
  'a coach-claim session cannot reset any staff password'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"member"}',
  true
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018073')$$,
  '%staff_account_for_reset: caller is not authorized to reset staff passwords%',
  'a plain member-claim session cannot reset any staff password'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018073')$$,
  '%staff_account_for_reset: caller is not authorized to reset staff passwords%',
  'a receptionist-claim session cannot reset any staff password'
);

-- ============================================================================
-- (e) A deactivated target is rejected even for an Owner caller -- a
-- deactivated account must not be silently reactivated by a password reset.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000018021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000018011","app_role":"owner"}',
  true
);

select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018076')$$,
  '%staff_account_for_reset: target not found or not eligible%',
  'an owner-claim session cannot reset a deactivated staff member''s password'
);

-- ============================================================================
-- (f) A cross-gym target is rejected even for an Owner caller.
-- ============================================================================
select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018079')$$,
  '%staff_account_for_reset: target not found or not eligible%',
  'an owner-claim session cannot reset a staff member''s password in a different gym'
);

-- ============================================================================
-- (g) Targeting a plain Member row is rejected (role != 'member' filter).
-- ============================================================================
select throws_like(
  $$select * from staff_account_for_reset('00000000-0000-0000-0000-000000018075')$$,
  '%staff_account_for_reset: target not found or not eligible%',
  'an owner-claim session cannot reset a plain member''s password via this RPC'
);

select * from finish();
rollback;
