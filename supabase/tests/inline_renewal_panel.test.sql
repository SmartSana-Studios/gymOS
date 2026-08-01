-- Story 4.7: Inline Renewal Panel. Tests `confirm_renewal()`
-- (0035_inline_renewal_panel.sql) -- a SECURITY DEFINER RPC, not a raw
-- RLS-policy-gated INSERT, so most assertions call the function directly
-- under a simulated session, mirroring manual_renewal_reset.test.sql's own
-- session-simulation conventions (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role). Table-state assertions after each call use `reset role`
-- first (audit_log/payments/subscriptions have no gym-staff SELECT policy
-- broad enough to read back every field asserted here -- the connecting/
-- superuser role bypasses RLS entirely to inspect real committed state,
-- same convention as manual_renewal_reset.test.sql's own closing checks).

begin;
select plan(31);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009001', 'Inline Renewal Test Tier', 5000, 50000, 10);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009011', 'Inline Renewal Gym A', '00000000-0000-0000-0000-000000009001', 30),
  ('00000000-0000-0000-0000-000000009012', 'Inline Renewal Gym B', '00000000-0000-0000-0000-000000009001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009022'), -- Gym A manager
  ('00000000-0000-0000-0000-000000009023'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000009024'), -- Gym A coach
  ('00000000-0000-0000-0000-000000009025'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009026'), -- Gym A member-role session (own account)
  ('00000000-0000-0000-0000-000000009027'), -- Renewal Member's user
  ('00000000-0000-0000-0000-000000009028'), -- Deactivated Member's user
  ('00000000-0000-0000-0000-000000009029'); -- No-Subscription Member's user

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009021', 'owner', 'Inline Renewal Gym A Owner'),
  ('00000000-0000-0000-0000-000000009042', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009022', 'manager', 'Inline Renewal Gym A Manager'),
  ('00000000-0000-0000-0000-000000009043', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009023', 'receptionist', 'Inline Renewal Gym A Receptionist'),
  ('00000000-0000-0000-0000-000000009044', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009024', 'coach', 'Inline Renewal Gym A Coach'),
  ('00000000-0000-0000-0000-000000009045', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009025', 'owner', 'Inline Renewal Gym B Owner'),
  ('00000000-0000-0000-0000-000000009046', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009026', 'member', 'Inline Renewal Gym A Member Session'),
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009027', 'member', 'Renewal Member'),
  ('00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009028', 'member', 'Deactivated Member'),
  ('00000000-0000-0000-0000-000000009053', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009029', 'member', 'No Subscription Member');

update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000009052';

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009011', 'Inline Renewal Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- Renewal Member: existing grace_period subscription. created_at is
-- explicitly backdated -- same reasoning as manual_renewal_reset.test.sql's
-- own fixture comment: `now()` is frozen for this whole transaction, so a
-- fixture row and a row inserted later by confirm_renewal() would otherwise
-- tie on created_at, making the "most recent subscription" `order by
-- created_at desc limit 1` pattern resolve ambiguously within this test
-- only (each real renewal is its own transaction in production).
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009071', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009061', 'grace_period', current_date - 40, current_date - 10, now() - interval '1 day');

-- Deactivated Member: existing expired subscription on the same plan.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009072', '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009061', 'expired', current_date - 40, current_date - 10, now() - interval '1 day');

-- No Subscription Member: deliberately zero subscription rows -- exercises
-- confirm_renewal()'s own defensive "no existing subscription" guard.

-- ============================================================================
-- (a) An owner-claim session confirms a cash renewal for Renewal Member --
-- full field-level verification of the subscription insert, payment insert,
-- and audit log write.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', 'Cash payment collected at front desk')$$,
  'an owner-claim session can confirm a renewal for Renewal Member'
);

reset role;

select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000009051'),
  2,
  'Renewal Member now has 2 subscription rows -- confirm_renewal inserted a new one rather than mutating the old'
);

select is(
  (select status::text from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  'active',
  'the new (most recent) subscription row is active'
);

select is(
  (select start_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  current_date,
  'the new row''s start_date is today'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  current_date + 30,
  'the new row''s expiry_date is today + the plan''s duration_days (30)'
);

select is(
  (select plan_id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  '00000000-0000-0000-0000-000000009061',
  'the renewal reuses the same plan_id as the member''s prior subscription'
);

select is(
  (select status::text from subscriptions where id = '00000000-0000-0000-0000-000000009071'),
  'grace_period',
  'the prior subscription row is untouched -- still grace_period, history preserved'
);

select is(
  (select count(*)::int from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  1,
  'exactly one new payments row is linked to the new subscription'
);

select is(
  (select status::text from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  'verified',
  'the new payment is inserted directly as verified -- bypasses the pending Verification Queue'
);

select is(
  (select amount from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  15000,
  'the new payment''s amount matches the plan''s price'
);

select is(
  (select currency from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  'XAF',
  'the new payment''s currency matches the plan''s currency'
);

select is(
  (select method::text from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  'cash',
  'the new payment''s method matches the passed p_method'
);

select is(
  (select actor_id from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  '00000000-0000-0000-0000-000000009021',
  'the new payment''s actor_id is the calling owner, derived from auth.uid(), not client-supplied'
);

select is(
  (select member_id from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  '00000000-0000-0000-0000-000000009051',
  'the new payment''s member_id is Renewal Member'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'renewal_confirmed'
     and target_entity_id = '00000000-0000-0000-0000-000000009051'
     and target_entity_type = 'member'),
  1,
  'exactly one audit_log row was written for this renewal, target scoped to the member'
);

select is(
  (select metadata->>'payment_id' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  (select id::text from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1)),
  'audit_log metadata.payment_id matches the new payment row'
);

select is(
  (select metadata->>'subscription_id' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  (select id::text from subscriptions where member_id = '00000000-0000-0000-0000-000000009051' order by created_at desc limit 1),
  'audit_log metadata.subscription_id matches the new subscription row'
);

select is(
  (select metadata->>'amount' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  '15000',
  'audit_log metadata.amount matches the plan''s price'
);

select is(
  (select metadata->>'currency' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  'XAF',
  'audit_log metadata.currency matches the plan''s currency'
);

select is(
  (select metadata->>'new_expiry_date' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009051'),
  (current_date + 30)::text,
  'audit_log metadata.new_expiry_date matches the new subscription''s expiry_date'
);

-- ============================================================================
-- (b) A manager-claim session can also confirm a renewal -- and renewing an
-- already-active member is explicitly allowed, not rejected (matches
-- renew_subscription()'s own precedent).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"manager"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'bank_transfer', 'Manager override renewal')$$,
  'a manager-claim session can confirm a renewal for Renewal Member again, even though it is already active'
);

-- ============================================================================
-- (c) A receptionist-claim session can renew too -- this story's actual new
-- capability (payments RLS INSERT normally requires status pending/
-- processing; this function's own self-check + SECURITY DEFINER bypass is
-- what grants receptionist a way to write a verified payment).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"receptionist"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'manual_momo', 'Receptionist collected mobile money payment')$$,
  'a receptionist-claim session can confirm a renewal for Renewal Member'
);

reset role;
select is(
  (select count(*)::int from subscriptions where member_id = '00000000-0000-0000-0000-000000009051'),
  4,
  'Renewal Member has 4 subscription rows after 3 renewals (1 original + 3 renewals)'
);

-- ============================================================================
-- (d) A coach-claim session is denied.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"coach"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', 'Coach attempted renewal')$$,
  '%permission denied%',
  'a coach-claim session cannot call confirm_renewal()'
);

-- ============================================================================
-- (e) A member-claim session (an ordinary member's own login) is denied.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"member"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', 'Member attempted self-renewal')$$,
  '%permission denied%',
  'a member-claim session cannot call confirm_renewal()'
);

-- ============================================================================
-- (f) Cross-tenant: a Gym B owner-claim session cannot renew a Gym A member,
-- even though owner is otherwise a write-capable role.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009012","app_role":"owner"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', 'Cross-tenant renewal attempt')$$,
  '%not found%',
  'a Gym B owner-claim session cannot renew Gym A''s Renewal Member -- gym-scoped lookup reports not-found, not permission-denied, avoiding cross-tenant member-existence enumeration'
);

-- ============================================================================
-- (g) A deactivated member cannot be renewed.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009011","app_role":"owner"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009052', 'cash', 'Attempted renewal of deactivated member')$$,
  '%is deactivated and cannot be renewed%',
  'a deactivated member cannot be renewed'
);

-- ============================================================================
-- (h) Empty / whitespace-only reason is rejected -- the DB-level backstop,
-- called directly (not through the TS Zod layer) to prove it works
-- independently.
-- ============================================================================
select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', '')$$,
  '%reason is required%',
  'an empty reason is rejected'
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009051', 'cash', '   ')$$,
  '%reason is required%',
  'a whitespace-only reason is rejected'
);

-- ============================================================================
-- (i) A member with zero subscription rows cannot be renewed.
-- ============================================================================
select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009053', 'cash', 'Attempted renewal with no prior subscription')$$,
  '%has no existing subscription to renew%',
  'a member with no existing subscription cannot be renewed'
);

-- ============================================================================
-- (j) A nonexistent member_id is rejected.
-- ============================================================================
select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009999', 'cash', 'Nonexistent member')$$,
  '%not found%',
  'a nonexistent member_id is rejected'
);

select * from finish();
rollback;
