-- Story 4.3: Manual Payment Entry & Verification Queue -- exercises the new
-- gym_staff_verify_own_payments UPDATE policy and the tightened
-- gym_staff_insert_own_payments INSERT policy (0031 migration). Session-
-- simulation conventions match payments_rls_and_renewal.test.sql (Story
-- 4.2) -- a **new** file, not an edit to that one (already shipped/reviewed
-- for Story 4.2; this story's migration is 0031, its own test file).

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009301', 'Payments Queue Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009311', 'Payments Queue Test Gym A', '00000000-0000-0000-0000-000000009301', 30),
  ('00000000-0000-0000-0000-000000009312', 'Payments Queue Test Gym B', '00000000-0000-0000-0000-000000009301', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009321'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009322'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009323'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009324'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009325'), -- Gym A member-role session
  ('00000000-0000-0000-0000-000000009326'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009327'), -- Gym A payer's own user
  ('00000000-0000-0000-0000-000000009328'); -- Gym B payer's own user

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009341', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009321', 'owner', 'Payments Queue Gym A Owner'),
  ('00000000-0000-0000-0000-000000009342', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009322', 'manager', 'Payments Queue Gym A Manager'),
  ('00000000-0000-0000-0000-000000009343', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009323', 'receptionist', 'Payments Queue Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009344', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009324', 'coach', 'Payments Queue Gym A Coach'),
  ('00000000-0000-0000-0000-000000009345', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009325', 'member', 'Payments Queue Gym A Member Session'),
  ('00000000-0000-0000-0000-000000009346', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009326', 'owner', 'Payments Queue Gym B Owner'),
  ('00000000-0000-0000-0000-000000009351', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009327', 'member', 'Payments Queue Gym A Payer'),
  ('00000000-0000-0000-0000-000000009352', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009328', 'member', 'Payments Queue Gym B Payer');

-- Pending fixture rows, inserted as service_role (bypasses RLS -- this
-- story's own INSERT policy is exercised separately, Section E below) so
-- Sections A-D start from a known-good pending state regardless of the
-- INSERT policy's own outcome.
reset role;
insert into payments (id, gym_id, member_id, amount, currency, method, status) values
  ('00000000-0000-0000-0000-000000009401', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 10000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009402', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 12000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009403', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 15000, 'XAF', 'bank_transfer', 'pending'),
  ('00000000-0000-0000-0000-000000009404', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009352', 8000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009405', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 9000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009406', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 9500, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009408', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 11000, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009409', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 11500, 'XAF', 'cash', 'pending'),
  ('00000000-0000-0000-0000-000000009410', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 13000, 'XAF', 'manual_momo', 'pending');

-- ============================================================================
-- Section A: gym_staff_verify_own_payments -- owner/manager/receptionist can
-- UPDATE a pending row in their own gym to verified/flagged (AC #3).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select lives_ok(
  $$ update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009401' $$,
  'an owner-claim session can UPDATE a pending payment in their own gym to verified'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009401'),
  'verified',
  'the payment transitions to verified'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"manager"}',
  true
);

select lives_ok(
  $$ update payments set status = 'flagged' where id = '00000000-0000-0000-0000-000000009402' $$,
  'a manager-claim session can UPDATE a pending payment in their own gym to flagged'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009402'),
  'flagged',
  'the payment transitions to flagged'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$ update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009403' $$,
  'a receptionist-claim session can UPDATE a pending payment in their own gym to verified -- this story''s actual new capability'
);

select is(
  (select status::text from payments where id = '00000000-0000-0000-0000-000000009403'),
  'verified',
  'the payment transitions to verified'
);

-- ============================================================================
-- Section B: cross-gym / non-staff-role UPDATEs affect 0 rows (USING clause
-- excludes them -- no exception, just no match).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

with upd as (
  update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009404' returning 1
)
select is(
  (select count(*)::int from upd),
  0,
  'a Gym A owner-claim session cannot UPDATE Gym B''s pending payment -- 0 rows affected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009324","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"coach"}',
  true
);

with upd as (
  update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009405' returning 1
)
select is(
  (select count(*)::int from upd),
  0,
  'a coach-claim session cannot UPDATE a pending payment -- no matching policy, 0 rows affected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009325","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"member"}',
  true
);

with upd as (
  update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009406' returning 1
)
select is(
  (select count(*)::int from upd),
  0,
  'a member-claim session cannot UPDATE a pending payment -- no matching policy, 0 rows affected'
);

-- ============================================================================
-- Section C: idempotency -- an already-verified row is invisible to the
-- USING clause's `status = 'pending'` guard, so a repeat verify affects 0
-- rows (this is AC #3's "queue count updates" backed by a real idempotency
-- assertion, same discipline as Story 4.2's complete_verified_payment test).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

with upd as (
  update payments set status = 'verified' where id = '00000000-0000-0000-0000-000000009401' returning 1
)
select is(
  (select count(*)::int from upd),
  0,
  'a second UPDATE attempt on an already-verified payment affects 0 rows -- idempotency guard'
);

-- ============================================================================
-- Section D: the WITH CHECK clause rejects an UPDATE that would set status
-- to anything other than verified/flagged (e.g. back to pending, or to
-- processing) -- the USING clause matches (row is currently pending, gym
-- and role match), but the resulting row fails the check, raising.
-- ============================================================================
select throws_like(
  $$ update payments set status = 'pending' where id = '00000000-0000-0000-0000-000000009408' $$,
  '%row-level security%',
  'an UPDATE attempting to set status back to pending is rejected by the WITH CHECK clause'
);

select throws_like(
  $$ update payments set status = 'processing' where id = '00000000-0000-0000-0000-000000009409' $$,
  '%row-level security%',
  'an UPDATE attempting to set status to processing is rejected by the WITH CHECK clause'
);

-- ============================================================================
-- Section E: tightened gym_staff_insert_own_payments -- pending/processing
-- inserts stay allowed (this story's own path + Story 4.2's regression
-- guard), verified/flagged inserts are now rejected (the new hardening).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009323","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 5000, 'XAF', 'cash', 'pending') $$,
  'a receptionist-claim session can INSERT a pending payment -- this story''s own manual-payment path'
);

select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 5000, 'XAF', 'mtn_momo', 'processing') $$,
  'a receptionist-claim session can still INSERT a processing payment -- Story 4.2''s automated-payment path, regression guard'
);

select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 5000, 'XAF', 'cash', 'verified') $$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a payment directly as verified -- the new hardening'
);

select throws_like(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status) values ('00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', 5000, 'XAF', 'cash', 'flagged') $$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a payment directly as flagged -- the new hardening'
);

-- ============================================================================
-- Section F: a pending row belonging to another gym stays invisible to a
-- cross-gym session (existing gym_staff_read_own_payments policy from 0030,
-- exercised again here with a pending-status row specifically -- that
-- policy's own test only used processing/verified rows).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009326","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009312","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from payments where id = '00000000-0000-0000-0000-000000009410'),
  0,
  'a Gym B owner-claim session sees 0 rows for Gym A''s pending payment -- cross-gym read deny'
);

select * from finish();
rollback;
