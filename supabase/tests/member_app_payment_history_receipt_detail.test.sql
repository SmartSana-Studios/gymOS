-- Story 4.9: Member App -- Payment History & Receipt Detail. Tests the two
-- new RLS policies from 0038_member_app_payment_history_receipt_detail.sql:
-- `member_read_own_payments` (payments) and `member_read_gym_staff_members`
-- (members). Session-simulation conventions match
-- member_app_home_screen_status_display.test.sql (`set local role
-- authenticated` + `set_config('request.jwt.claims', ...)` per simulated
-- session; every assertion here runs under a real RLS-scoped role, none
-- bypass RLS via `reset role`).

begin;
select plan(12);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009801', 'Payment History Test Tier', 5000, 50000, 200);

insert into gyms (id, name, tier_id) values
  ('00000000-0000-0000-0000-000000009811', 'Payment History Test Gym A', '00000000-0000-0000-0000-000000009801'),
  ('00000000-0000-0000-0000-000000009812', 'Payment History Test Gym B', '00000000-0000-0000-0000-000000009801');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009821'), -- Member A (own-row read)
  ('00000000-0000-0000-0000-000000009822'), -- Member B (other-member negative test, same gym)
  ('00000000-0000-0000-0000-000000009823'), -- Owner (staff-name lookup + regression)
  ('00000000-0000-0000-0000-000000009824'), -- Manager (staff-name lookup)
  ('00000000-0000-0000-0000-000000009825'), -- Receptionist (staff-name lookup)
  ('00000000-0000-0000-0000-000000009826'), -- Coach (excluded from staff-name lookup)
  ('00000000-0000-0000-0000-000000009827'); -- Gym B member (cross-gym negative test)

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009841', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009821', 'member', 'Payment History Member A'),
  ('00000000-0000-0000-0000-000000009842', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009822', 'member', 'Payment History Member B'),
  ('00000000-0000-0000-0000-000000009843', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009823', 'owner', 'Payment History Owner'),
  ('00000000-0000-0000-0000-000000009844', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009824', 'manager', 'Payment History Manager'),
  ('00000000-0000-0000-0000-000000009845', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009825', 'receptionist', 'Payment History Receptionist'),
  ('00000000-0000-0000-0000-000000009846', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009826', 'coach', 'Payment History Coach'),
  ('00000000-0000-0000-0000-000000009847', '00000000-0000-0000-0000-000000009812', '00000000-0000-0000-0000-000000009827', 'member', 'Payment History Gym B Member');

-- paymentA1: Member A's own payment, subscription_id left null (the common
-- case per the story's Scope Notes/docs.md entry -- also doubles as the
-- data-shape sanity check, assertion (l) below).
insert into payments (id, gym_id, member_id, amount, currency, method, status) values
  ('00000000-0000-0000-0000-000000009861', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009841', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009862', '00000000-0000-0000-0000-000000009811', '00000000-0000-0000-0000-000000009842', 3000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009863', '00000000-0000-0000-0000-000000009812', '00000000-0000-0000-0000-000000009847', 2000, 'XAF', 'cash', 'pending');

-- ============================================================================
-- (a)-(c) member_read_own_payments: Member A can select its own payments row
-- and only its own row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009821","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"member"}',
  true
);

select lives_ok(
  $$select * from payments where gym_id = '00000000-0000-0000-0000-000000009811'$$,
  'a member-claim session can select from payments for its own gym'
);

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000009811'),
  1,
  'member A sees exactly its own payments row, not member B''s'
);

select is(
  (select member_id from payments where gym_id = '00000000-0000-0000-0000-000000009811' limit 1),
  '00000000-0000-0000-0000-000000009841'::uuid,
  'the visible payments row belongs to member A, the calling member'
);

-- ============================================================================
-- (l) data-shape sanity check: a payment row with subscription_id is null is
-- still selectable under RLS, with no join failure/error -- verified under
-- member A's own member-claim session (still active from (a)-(c) above), not
-- the superuser/bypass-RLS role, since the point is to prove the RLS policy
-- itself tolerates the null join, not just that the row exists.
-- ============================================================================
select is(
  (select subscription_id from payments where id = '00000000-0000-0000-0000-000000009861'),
  null::uuid,
  'a payment row with a null subscription_id is selectable under RLS without error'
);

-- ============================================================================
-- (d) row-ownership, not just gym-scoping: member A cannot select member B's
-- payment even filtering by its id directly (same gym).
-- ============================================================================
select is(
  (select count(*)::int from payments where id = '00000000-0000-0000-0000-000000009862'),
  0,
  'member A cannot select member B''s payments row even filtering by its id directly'
);

-- ============================================================================
-- (e) tenant isolation: member A cannot select a payment in a different gym.
-- ============================================================================
select is(
  (select count(*)::int from payments where id = '00000000-0000-0000-0000-000000009863'),
  0,
  'member A cannot select a payments row belonging to a different gym'
);

-- ============================================================================
-- (f)-(h) member_read_gym_staff_members: member A can resolve an
-- owner/manager/receptionist's name in its own gym (needed for the
-- receipt's "Recorded by" field), for each of the 3 roles the policy grants.
-- ============================================================================
select is(
  (select name from members where user_id = '00000000-0000-0000-0000-000000009823'),
  'Payment History Owner',
  'member A can resolve the owner''s name via member_read_gym_staff_members'
);

select is(
  (select name from members where user_id = '00000000-0000-0000-0000-000000009824'),
  'Payment History Manager',
  'member A can resolve the manager''s name via member_read_gym_staff_members'
);

select is(
  (select name from members where user_id = '00000000-0000-0000-0000-000000009825'),
  'Payment History Receptionist',
  'member A can resolve the receptionist''s name via member_read_gym_staff_members'
);

-- ============================================================================
-- (i)-(j) member_read_gym_staff_members is scoped to exactly 3 roles --
-- a coach's row and another member's row stay invisible.
-- ============================================================================
select is(
  (select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000009826'),
  0,
  'member A cannot resolve the coach''s name -- role excluded from member_read_gym_staff_members'
);

select is(
  (select count(*)::int from members where id = '00000000-0000-0000-0000-000000009842'),
  0,
  'member A still cannot select member B''s members row -- self_read_own_membership stays own-row-only, unaffected by this story'
);

-- ============================================================================
-- (k) regression: gym_staff_read_own_payments (0030) still passes unaffected
-- -- an owner-claim session still reads all of its gym's payments.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009823","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009811","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payments where gym_id = '00000000-0000-0000-0000-000000009811'),
  2,
  'an owner-claim session still sees both gym A payments rows -- gym_staff_read_own_payments (0030) unaffected'
);

select * from finish();
rollback;
