-- Story 4.7 review follow-up: Tests 0036_open_payment_method.sql --
-- payment_method enum -> open text widening, plus the two review-finding
-- CHECK constraints added alongside it (payments_method_not_blank_check,
-- payments_method_length_check) and the reason length cap
-- (payments_reason_length_check). Uses confirm_renewal() (0035/0036) as the
-- real write path, mirroring inline_renewal_panel.test.sql's own
-- session-simulation conventions.

begin;
select plan(5);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009201', 'Open Payment Method Test Tier', 5000, 50000, 10);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000009211', 'Open Payment Method Gym', '00000000-0000-0000-0000-000000009201', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009221'), -- Owner
  ('00000000-0000-0000-0000-000000009222'); -- Renewal Member's user

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000009241', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009221', 'owner', 'Open Payment Method Gym Owner'),
  ('00000000-0000-0000-0000-000000009242', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009222', 'member', 'Open Payment Method Renewal Member');

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000009251', '00000000-0000-0000-0000-000000009211', 'Open Payment Method Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

-- created_at backdated for the same reason inline_renewal_panel.test.sql's
-- fixtures are: avoids a same-transaction created_at tie against a row
-- confirm_renewal() inserts later.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000009261', '00000000-0000-0000-0000-000000009211', '00000000-0000-0000-0000-000000009242', '00000000-0000-0000-0000-000000009251', 'grace_period', current_date - 40, current_date - 10, now() - interval '1 day');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

-- ============================================================================
-- (a) A method value outside the old 3-value closed set is now accepted --
-- proves the enum removal actually widened what can be recorded (e.g. a
-- future non-Cameroon TaraMoney operator normalized by mapTaraMoneyVendor()).
-- ============================================================================
select lives_ok(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009242', 'wave_money', 'Renewal via a non-enumerated operator')$$,
  'a method value outside the old closed enum is accepted -- payment_method is now open text'
);

select is(
  (select method from payments
   where subscription_id = (select id from subscriptions where member_id = '00000000-0000-0000-0000-000000009242' order by created_at desc limit 1)),
  'wave_money',
  'the recorded method matches the passed open-text value exactly'
);

reset role;

-- ============================================================================
-- (b) Review-finding backstop: a blank method is rejected by the new
-- payments_method_not_blank_check constraint, not silently accepted now that
-- the enum's implicit "always some real label" guarantee is gone.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009211","app_role":"owner"}',
  true
);

select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009242', '', 'Blank method attempt')$$,
  '%payments_method_not_blank_check%',
  'a blank method is rejected by the new not-blank CHECK constraint'
);

-- ============================================================================
-- (c) Review-finding backstop: a method longer than 40 chars is rejected by
-- the new payments_method_length_check constraint.
-- ============================================================================
select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009242', repeat('x', 41), 'Overlong method attempt')$$,
  '%payments_method_length_check%',
  'a method longer than 40 characters is rejected by the new length CHECK constraint'
);

-- ============================================================================
-- (d) Review-finding backstop: a reason longer than 200 chars is rejected by
-- the new payments_reason_length_check constraint -- the DB-level backstop
-- for confirmRenewalSchema's matching 200-char Zod cap, called directly (not
-- through the TS Zod layer) to prove it holds independently.
-- ============================================================================
select throws_like(
  $$select confirm_renewal('00000000-0000-0000-0000-000000009242', 'cash', repeat('x', 201))$$,
  '%payments_reason_length_check%',
  'a reason longer than 200 characters is rejected by the new length CHECK constraint'
);

reset role;

select * from finish();
rollback;
