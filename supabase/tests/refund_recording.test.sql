-- Story 4.5: Refund Recording. Coverage for the `refunds` table's RLS
-- policies (0033_refund_recording.sql) -- INSERT is owner/manager-only,
-- gated by an `exists` clause requiring the target payment to belong to the
-- caller's own gym, be `verified`, and the refund amount not exceed the
-- payment's own amount; SELECT mirrors `gym_staff_read_own_payments`'s
-- owner/manager/receptionist list. Mirrors
-- payment_reconciliation_job.test.sql's fixture-seeding style.

begin;
select plan(13);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009901', 'Refund Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009911', 'Refund Test Gym A', '00000000-0000-0000-0000-000000009901', 30),
  ('00000000-0000-0000-0000-000000009912', 'Refund Test Gym B', '00000000-0000-0000-0000-000000009901', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009921'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009922'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009923'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009924'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009926'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009961'); -- Gym A payer

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009941', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009921', 'owner', 'Refund Gym A Owner'),
  ('00000000-0000-0000-0000-000000009942', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009922', 'manager', 'Refund Gym A Manager'),
  ('00000000-0000-0000-0000-000000009943', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009923', 'receptionist', 'Refund Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009944', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009924', 'coach', 'Refund Gym A Coach'),
  ('00000000-0000-0000-0000-000000009946', '00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009926', 'owner', 'Refund Gym B Owner'),
  ('00000000-0000-0000-0000-000000009961', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 'member', 'Refund Gym A Payer');

-- ============================================================================
-- payments fixtures. p_owner_ok/p_manager_ok: verified, refunded by owner/
-- manager respectively (also reused for the uniqueness/second-refund test).
-- p_receptionist_denied/p_coach_denied: verified, targeted by a denied
-- INSERT attempt from a non-owner/manager role. p_crossgym: verified, lives
-- in Gym B. p_exceed: verified, targeted by an over-amount refund attempt.
-- p_pending: not verified, targeted by a status-gated refund attempt.
-- ============================================================================
insert into payments (id, gym_id, member_id, amount, currency, method, status) values
  ('00000000-0000-0000-0000-000000009801', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009802', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009803', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009804', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009805', '00000000-0000-0000-0000-000000009912', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009806', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'verified'),
  ('00000000-0000-0000-0000-000000009807', '00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009961', 5000, 'XAF', 'cash', 'pending');

-- ============================================================================
-- Owner: successful INSERT against a verified, own-gym payment.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select lives_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009801', 3000, 'Member disputed the charge', '00000000-0000-0000-0000-000000009921') $$,
  'owner can INSERT a refund against their own gym''s verified payment'
);

select is(
  (select amount from refunds where payment_id = '00000000-0000-0000-0000-000000009801'),
  3000,
  'the inserted refund carries the submitted amount'
);

-- Second refund attempt against the same, already-refunded payment --
-- refunds.payment_id is unique, proving "at most one refund per payment."
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009801', 1000, 'Second attempt at the same payment', '00000000-0000-0000-0000-000000009921') $$,
  '%duplicate key%',
  'a second refund INSERT against an already-refunded payment fails the refunds.payment_id unique constraint'
);

-- Amount exceeding the original payment's own amount -- the RLS `with
-- check`'s own `amount <= p.amount` clause is the real, uncircumventable
-- gate (services/payments.ts#recordRefund's check is a friendly duplicate).
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009804', 6000, 'Refund amount exceeds original payment', '00000000-0000-0000-0000-000000009921') $$,
  '%row-level security%',
  'an owner cannot INSERT a refund whose amount exceeds the original payment''s own amount'
);

-- A not-yet-verified (pending) payment has nothing to refund.
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009807', 5000, 'Refund against a pending payment', '00000000-0000-0000-0000-000000009921') $$,
  '%row-level security%',
  'an owner cannot INSERT a refund against a payment that is not yet verified'
);

-- A cross-gym payment_id -- the target payment belongs to Gym B, not this
-- owner's own Gym A -- fails the exists clause's own p.gym_id = gym_id
-- condition.
select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009805', 5000, 'Cross-gym payment id attempt', '00000000-0000-0000-0000-000000009921') $$,
  '%row-level security%',
  'an owner cannot INSERT a refund whose payment_id belongs to a different gym'
);

-- ============================================================================
-- Manager: also allowed to INSERT.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009922","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"manager"}',
  true
);

select lives_ok(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009802', 5000, 'Manager-recorded refund', '00000000-0000-0000-0000-000000009922') $$,
  'manager can INSERT a refund against their own gym''s verified payment'
);

-- ============================================================================
-- Receptionist and coach: excluded from the INSERT policy (this story's own
-- user story is "As a Manager or Owner", narrower than payment recording's
-- owner/manager/receptionist).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009923","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"receptionist"}',
  true
);

select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009803', 5000, 'Receptionist attempts a refund', '00000000-0000-0000-0000-000000009923') $$,
  '%row-level security%',
  'a receptionist-claim session cannot INSERT a refund -- narrower than gym_staff_insert_own_payments'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009924","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"coach"}',
  true
);

select throws_like(
  $$ insert into refunds (gym_id, payment_id, amount, reason, actor_id) values ('00000000-0000-0000-0000-000000009911', '00000000-0000-0000-0000-000000009806', 5000, 'Coach attempts a refund', '00000000-0000-0000-0000-000000009924') $$,
  '%row-level security%',
  'a coach-claim session cannot INSERT a refund'
);

-- ============================================================================
-- SELECT: owner/manager/receptionist see their own gym's 2 refund rows
-- (payment_owner_ok + payment_manager_ok, from above); coach and a
-- cross-gym session see 0.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009921","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from refunds),
  2,
  'an owner-claim session sees exactly its own gym''s 2 refund rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009923","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"receptionist"}',
  true
);

select is(
  (select count(*)::int from refunds),
  2,
  'a receptionist-claim session sees the same 2 refund rows (staff-read, not gated to owner/manager)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009924","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009911","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from refunds),
  0,
  'a coach-claim session sees 0 refunds -- no AC/FR gives Coach refund visibility, same as payments/payment_discrepancies'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009926","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009912","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from refunds),
  0,
  'a Gym B owner-claim session sees 0 rows for Gym A''s refunds -- cross-gym read deny'
);

select * from finish();
rollback;
