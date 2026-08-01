-- Story 4.8: Subscriptions Page & Manual Renewal. Tests
-- `subscriptions_current` (the codebase's first `create view`) and
-- `confirm_renewal()`'s new `p_backdate` parameter
-- (0037_subscriptions_page_manual_renewal.sql). Mirrors
-- inline_renewal_panel.test.sql's/open_payment_method.test.sql's own
-- session-simulation conventions (`set local role authenticated` +
-- `set_config('request.jwt.claims', ...)`, fixtures seeded up front as the
-- connecting role, `reset role` before reading back committed state that no
-- gym-staff SELECT policy is broad enough to cover).

begin;
select plan(25);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009301', 'Subscriptions Page Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009311', 'Subscriptions Page Gym A', '00000000-0000-0000-0000-000000009301', 30),
  ('00000000-0000-0000-0000-000000009312', 'Subscriptions Page Gym B', '00000000-0000-0000-0000-000000009301', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009321'), -- Gym A owner
  ('00000000-0000-0000-0000-000000009322'), -- Gym B owner
  ('00000000-0000-0000-0000-000000009331'), -- Multi Sub Member's user
  ('00000000-0000-0000-0000-000000009332'), -- Grace Period Member's user
  ('00000000-0000-0000-0000-000000009333'), -- Expired Member's user
  ('00000000-0000-0000-0000-000000009334'), -- Active Member's user
  ('00000000-0000-0000-0000-000000009335'), -- Expiring Soon Member's user
  ('00000000-0000-0000-0000-000000009336'), -- Pay Per Session Member's user
  ('00000000-0000-0000-0000-000000009337'), -- Plain Renewal Member's user
  ('00000000-0000-0000-0000-000000009338'); -- Deeply Expired Member's user

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000009341', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009321', 'owner', 'Subscriptions Page Gym A Owner', current_date),
  ('00000000-0000-0000-0000-000000009342', '00000000-0000-0000-0000-000000009312', '00000000-0000-0000-0000-000000009322', 'owner', 'Subscriptions Page Gym B Owner', current_date),
  ('00000000-0000-0000-0000-000000009351', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009331', 'member', 'Multi Sub Member', '2020-01-01'),
  ('00000000-0000-0000-0000-000000009352', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009332', 'member', 'Grace Period Member', current_date),
  ('00000000-0000-0000-0000-000000009353', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009333', 'member', 'Expired Member', current_date),
  ('00000000-0000-0000-0000-000000009354', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009334', 'member', 'Active Member', current_date),
  ('00000000-0000-0000-0000-000000009355', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009335', 'member', 'Expiring Soon Member', current_date),
  ('00000000-0000-0000-0000-000000009356', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009336', 'member', 'Pay Per Session Member', current_date),
  ('00000000-0000-0000-0000-000000009357', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009337', 'member', 'Plain Renewal Member', current_date),
  ('00000000-0000-0000-0000-000000009358', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009338', 'member', 'Deeply Expired Member', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009361', '00000000-0000-0000-0000-000000009311', 'Sub Test Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000009362', '00000000-0000-0000-0000-000000009311', 'Sub Test Pay Per Session', 'pay_per_session', 5000, 'XAF', 'monthly', null);

-- Multi Sub Member: two historical subscription rows -- proves
-- subscriptions_current's `distinct on (member_id) ... order by created_at
-- desc` returns only the latest one, not both. created_at explicitly
-- staggered (not just backdated once) so the two rows don't tie.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009371', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', '00000000-0000-0000-0000-000000009361', 'expired', current_date - 100, current_date - 70, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000009372', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009351', '00000000-0000-0000-0000-000000009361', 'active', current_date - 10, current_date + 20, now() - interval '1 day');

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009373', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009352', '00000000-0000-0000-0000-000000009361', 'grace_period', current_date - 35, current_date - 5, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009374', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009353', '00000000-0000-0000-0000-000000009361', 'expired', current_date - 50, current_date - 20, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009375', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009354', '00000000-0000-0000-0000-000000009361', 'active', current_date - 10, current_date + 20, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009376', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009355', '00000000-0000-0000-0000-000000009361', 'expiring_soon', current_date - 27, current_date + 3, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009377', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009356', '00000000-0000-0000-0000-000000009362', 'grace_period', current_date - 10, null, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000009378', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009357', '00000000-0000-0000-0000-000000009361', 'grace_period', current_date - 40, current_date - 10, now() - interval '1 day'),
  -- Deeply Expired Member: expired 100 days ago on the 30-day plan, so a
  -- back-dated renewal (start_date = current_date - 100, expiry_date =
  -- current_date - 70) would still land in the past -- proves the "back-dated
  -- renewal would still be expired" guard actually rejects this case.
  ('00000000-0000-0000-0000-000000009379', '00000000-0000-0000-0000-000000009311', '00000000-0000-0000-0000-000000009358', '00000000-0000-0000-0000-000000009361', 'expired', current_date - 130, current_date - 100, now() - interval '1 day');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

-- ============================================================================
-- (a) `subscriptions_current`: exactly one row per member -- proves the
-- `distinct on (member_id) ... order by created_at desc` pattern collapses
-- Multi Sub Member's two historical subscription rows to just the latest,
-- and that the resolved columns (member_name, plan_name, plan_type,
-- join_date, status) come from the correct (newest) row.
-- ============================================================================
select is(
  (select count(*)::int from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  1,
  'subscriptions_current has exactly one row for Multi Sub Member, despite two historical subscription rows'
);

select is(
  (select status::text from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  'active',
  'subscriptions_current resolves to the newest (active) subscription, not the older expired one'
);

select is(
  (select member_name from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  'Multi Sub Member',
  'subscriptions_current.member_name resolves correctly via the members join'
);

select is(
  (select plan_name from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  'Sub Test Monthly',
  'subscriptions_current.plan_name resolves correctly via the plans join'
);

select is(
  (select plan_type::text from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  'monthly',
  'subscriptions_current.plan_type resolves correctly via the plans join'
);

select is(
  (select join_date from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  '2020-01-01'::date,
  'subscriptions_current.join_date resolves correctly via the members join'
);

reset role;

-- ============================================================================
-- (b) Tenant isolation -- the highest-priority assertion in this file. A Gym
-- B owner-claim session must see zero rows for Gym A's member/subscription
-- data through subscriptions_current, proving `security_invoker = true` is
-- actually enforcing RLS through the view rather than silently bypassing it
-- (an owner-privileged migration-role view would otherwise leak this data
-- to any authenticated caller).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009322","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009312","app_role":"owner"}',
  true
);

select is(
  (select count(*)::int from subscriptions_current where member_id = '00000000-0000-0000-0000-000000009351'),
  0,
  'a Gym B owner-claim session sees 0 rows for Gym A''s Multi Sub Member via subscriptions_current'
);

select is(
  (select count(*)::int from subscriptions_current where gym_id = '00000000-0000-0000-0000-000000009311'),
  0,
  'a Gym B owner-claim session sees 0 rows even when explicitly filtering subscriptions_current by Gym A''s own gym_id -- RLS enforces isolation regardless of the client-supplied filter'
);

reset role;

-- ============================================================================
-- (c) confirm_renewal() with p_backdate omitted: regression check --
-- identical behavior to 0036's version (start_date = today, backdated =
-- false in the audit metadata).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009357', 'cash', 'Baseline renewal, no backdate')$$,
  'an owner-claim session can confirm a renewal for Plain Renewal Member with p_backdate omitted'
);

reset role;

select is(
  (select status::text from subscriptions where member_id = '00000000-0000-0000-0000-000000009357' order by created_at desc limit 1),
  'active',
  'the new (most recent) subscription row is active'
);

select is(
  (select start_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009357' order by created_at desc limit 1),
  current_date,
  'p_backdate omitted -- the new row''s start_date is today, matching 0036''s pre-existing behavior'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009357' order by created_at desc limit 1),
  current_date + 30,
  'p_backdate omitted -- the new row''s expiry_date is today + the plan''s duration_days'
);

select is(
  (select metadata->>'backdated' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009357'),
  'false',
  'audit_log metadata.backdated is false when p_backdate was omitted'
);

-- ============================================================================
-- (d) confirm_renewal(..., p_backdate := true) on a grace_period member: new
-- start_date is the prior subscription's own expiry_date, new expiry_date is
-- that plus the plan's duration_days.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009352', 'cash', 'Back-dated renewal for grace_period member', true)$$,
  'an owner-claim session can confirm a back-dated renewal for a grace_period member'
);

reset role;

select is(
  (select start_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009352' order by created_at desc limit 1),
  current_date - 5,
  'grace_period back-date: the new row''s start_date equals the prior subscription''s own expiry_date'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009352' order by created_at desc limit 1),
  current_date - 5 + 30,
  'grace_period back-date: the new row''s expiry_date is the back-dated start_date + the plan''s duration_days'
);

select is(
  (select metadata->>'backdated' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009352'),
  'true',
  'audit_log metadata.backdated is true for a back-dated renewal'
);

select is(
  (select metadata->>'start_date' from audit_log where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000009352'),
  (current_date - 5)::text,
  'audit_log metadata.start_date matches the actually-inserted back-dated start_date'
);

-- ============================================================================
-- (e) confirm_renewal(..., p_backdate := true) on an expired member: same
-- behavior as (d).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009353', 'cash', 'Back-dated renewal for expired member', true)$$,
  'an owner-claim session can confirm a back-dated renewal for an expired member'
);

reset role;

select is(
  (select start_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009353' order by created_at desc limit 1),
  current_date - 20,
  'expired back-date: the new row''s start_date equals the prior subscription''s own expiry_date'
);

select is(
  (select expiry_date from subscriptions where member_id = '00000000-0000-0000-0000-000000009353' order by created_at desc limit 1),
  current_date - 20 + 30,
  'expired back-date: the new row''s expiry_date is the back-dated start_date + the plan''s duration_days'
);

-- ============================================================================
-- (f) confirm_renewal(..., p_backdate := true) is rejected for an active
-- member, an expiring_soon member, and a member whose prior subscription has
-- a null expiry_date (pay_per_session).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009321","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009311","app_role":"owner"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009354', 'cash', 'Back-date attempt on active member', true)$$,
  '%back-dating is only available for grace_period or expired subscriptions%',
  'back-dating an active member''s renewal is rejected'
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009355', 'cash', 'Back-date attempt on expiring_soon member', true)$$,
  '%back-dating is only available for grace_period or expired subscriptions%',
  'back-dating an expiring_soon member''s renewal is rejected'
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009356', 'cash', 'Back-date attempt with null prior expiry_date', true)$$,
  '%cannot back-date a subscription with no expiry date%',
  'back-dating a member whose prior subscription has a null expiry_date (pay_per_session) is rejected'
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009358', 'cash', 'Back-date attempt that would still land in the past', true)$$,
  '%back-dated renewal would still be expired%',
  'back-dating a member expired long enough that the back-dated expiry_date is still in the past is rejected'
);

reset role;

select * from finish();
rollback;
