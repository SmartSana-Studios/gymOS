-- Story 20.3: loyalty subscriber rule (migration 0119), denial paths. The hook,
-- the verifying function and the ledger have no client-callable write surface;
-- nothing a client does moves a subscriber balance or an expiry date.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000501xx.

begin;
select plan(17);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000051001', 'SRN Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000051011', 'SRN Gym', '00000000-0000-0000-0000-000000051001', 'active', true, 0, true, 3, 3, 7),
  ('00000000-0000-0000-0000-000000051012', 'SRN Other Gym', '00000000-0000-0000-0000-000000051001', 'active', true, 0, true, 3, 3, 7);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000051021'), -- owner of gym
  ('00000000-0000-0000-0000-000000051022'), -- member of gym
  ('00000000-0000-0000-0000-000000051023'); -- owner of the other gym

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000051031', '00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051021', 'owner',  'SRN Owner',  current_date),
  ('00000000-0000-0000-0000-000000051032', '00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051022', 'member', 'SRN Member', current_date),
  ('00000000-0000-0000-0000-000000051033', '00000000-0000-0000-0000-000000051012', '00000000-0000-0000-0000-000000051023', 'owner',  'SRN Owner 2', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000051041', '00000000-0000-0000-0000-000000051011', 'SRN Monthly', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-0000000501a1', '00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051032',
   '00000000-0000-0000-0000-000000051041', 'active', current_date - 60, (now() at time zone 'Africa/Douala')::date, now() - interval '60 days');

insert into loyalty_progress (gym_id, member_id, subscriber_stamps, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051032', 2, now() - interval '5 days');

-- A processing renewal payment awaiting the webhook.
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-0000000501b1', '00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051032',
   15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');

-- Owner of the gym: no direct hook, no verifying function, no ledger write.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051011","app_role":"owner"}', true);
select throws_ok(
  $$ select private.award_renewal_stamp('00000000-0000-0000-0000-0000000501b1') $$,
  '42501', null, 'owner cannot call the hook');
select throws_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-0000000501b1', 0) $$,
  '42501', null, 'owner cannot call complete_verified_payment');
select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051032', 'stamp_earned', 'subscriber', gen_random_uuid()) $$,
  '42501', null, 'owner cannot insert a subscriber ledger event');
select throws_ok(
  $$ update loyalty_progress set subscriber_stamps = 24 where member_id = '00000000-0000-0000-0000-000000051032' $$,
  '42501', null, 'owner cannot update a subscriber counter');

-- Staff of another gym cannot renew this gym's member.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051012","app_role":"owner"}', true);
select throws_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051032', 'cash', 'cross gym') $$,
  'P0001', null, 'cross-gym confirm_renewal finds no member');

-- The member cannot renew themselves through the staff function, nor touch counters.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051011","app_role":"member"}', true);
select throws_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051032', 'cash', 'self') $$,
  'P0001', 'permission denied', 'member cannot call confirm_renewal');
select throws_ok(
  $$ select private.award_renewal_stamp('00000000-0000-0000-0000-0000000501b1') $$,
  '42501', null, 'member cannot call the hook');
update subscriptions set expiry_date = expiry_date + 30 where member_id = '00000000-0000-0000-0000-000000051032';
reset role;

set local role anon;
select throws_ok(
  $$ select private.award_renewal_stamp('00000000-0000-0000-0000-0000000501b1') $$,
  '42501', null, 'anon cannot call the hook');
select throws_ok(
  $$ select complete_verified_payment('00000000-0000-0000-0000-0000000501b1', 0) $$,
  '42501', null, 'anon cannot call complete_verified_payment');
reset role;

set local role service_role;
select throws_ok(
  $$ select private.award_renewal_stamp('00000000-0000-0000-0000-0000000501b1') $$,
  '42501', null, 'service_role cannot call the hook');
reset role;

-- Nothing the denied attempts did moved a balance.
select is(
  (select subscriber_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000051032'),
  2, 'the counter is untouched by every denied attempt');
select is(
  (select count(*)::int from loyalty_events), 0, 'no ledger event was written');
select is(
  (select expiry_date from subscriptions where id = '00000000-0000-0000-0000-0000000501a1'),
  (now() at time zone 'Africa/Douala')::date, 'a member update did not move the expiry date');

-- Role gate (private.current_member_role()): a supervisor row passes, and a JWT
-- claiming owner for a caller whose members.role is member is refused.
insert into auth.users (id) values ('00000000-0000-0000-0000-000000051026');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000051036', '00000000-0000-0000-0000-000000051011', '00000000-0000-0000-0000-000000051026', 'supervisor', 'SRN Supervisor', current_date);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051011","app_role":"owner"}', true);
select throws_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051032', 'cash', 'forged claim') $$,
  'P0001', 'permission denied', 'a JWT app_role of owner does not help a caller whose members.role is member');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051011","app_role":"supervisor"}', true);
select lives_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051032', 'cash', 'supervisor renewal') $$,
  'a supervisor can confirm a renewal');
reset role;

-- A suspended gym cannot confirm renewals (11.8 gate kept).
-- (seeded suspended at insert: a status UPDATE is silently reverted by a trigger)
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000051013', 'SRN Suspended Gym', '00000000-0000-0000-0000-000000051001', 'suspended', true, 0, true, 3, 3, 7);
insert into auth.users (id) values ('00000000-0000-0000-0000-000000051024'), ('00000000-0000-0000-0000-000000051025');
insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000051034', '00000000-0000-0000-0000-000000051013', '00000000-0000-0000-0000-000000051024', 'owner', 'SRN Susp Owner', current_date),
  ('00000000-0000-0000-0000-000000051035', '00000000-0000-0000-0000-000000051013', '00000000-0000-0000-0000-000000051025', 'member', 'SRN Susp Member', current_date);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051013","app_role":"owner"}', true);
select throws_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051035', 'cash', 'suspended') $$,
  'P0001', 'confirm_renewal: gym 00000000-0000-0000-0000-000000051013 is not active',
  'confirm_renewal still refuses a suspended gym');
-- Role resolves before the gate: a member of a suspended gym is told they lack
-- authorization, not that the gym is suspended (2026-09-09 status-probe rule).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000051025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000051013","app_role":"member"}', true);
select throws_ok(
  $$ select confirm_renewal('00000000-0000-0000-0000-000000051035', 'cash', 'suspended probe') $$,
  'P0001', 'permission denied', 'a member of a suspended gym gets permission denied, not the gym status');
reset role;

select * from finish();
rollback;
