-- Dates in this file are the gym-local day (Africa/Douala, the default gym timezone), the day subscriptions now start on (0157).
-- Story 20.7 (0121): an early renewal carries the remaining days. Covers
-- confirm_renewal (staff) and complete_verified_payment (Tara), the edge cases in
-- the story's matrix, the loyalty interaction and the deliberate non-change of
-- renew_subscription. Session conventions follow inline_renewal_panel.test.sql.
begin;
select plan(19);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000207001', 'Carry Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity, loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000207011', 'Carry Gym', '00000000-0000-0000-0000-000000207001', 30, true, 4, 3, 10);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000207021'), -- owner
  ('00000000-0000-0000-0000-000000207031'), -- early (staff)
  ('00000000-0000-0000-0000-000000207032'), -- rewarded days present
  ('00000000-0000-0000-0000-000000207033'), -- on expiry day
  ('00000000-0000-0000-0000-000000207034'), -- lapsed
  ('00000000-0000-0000-0000-000000207035'), -- back-dated
  ('00000000-0000-0000-0000-000000207036'), -- pay per session
  ('00000000-0000-0000-0000-000000207037'), -- early via Tara
  ('00000000-0000-0000-0000-000000207038'); -- manual reset

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000207041', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207021', 'owner', 'Carry Owner'),
  ('00000000-0000-0000-0000-000000207051', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207031', 'member', 'Early Staff'),
  ('00000000-0000-0000-0000-000000207052', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207032', 'member', 'Rewarded Days'),
  ('00000000-0000-0000-0000-000000207053', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207033', 'member', 'Expiry Day'),
  ('00000000-0000-0000-0000-000000207054', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207034', 'member', 'Lapsed'),
  ('00000000-0000-0000-0000-000000207055', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207035', 'member', 'Backdated'),
  ('00000000-0000-0000-0000-000000207056', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207036', 'member', 'Pay Per Session'),
  ('00000000-0000-0000-0000-000000207057', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207037', 'member', 'Early Tara'),
  ('00000000-0000-0000-0000-000000207058', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207038', 'member', 'Manual Reset');

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000207061', '00000000-0000-0000-0000-000000207011', 'Carry Monthly', 'monthly', 15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000207062', '00000000-0000-0000-0000-000000207011', 'Carry PPS', 'pay_per_session', 2000, 'XAF', 'monthly', null);

-- One existing subscription per member; created_at backdated so the renewal's row is newest.
insert into subscriptions (id, gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000207071', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207051', '00000000-0000-0000-0000-000000207061', 'expiring_soon', (now() at time zone 'Africa/Douala')::date - 20, (now() at time zone 'Africa/Douala')::date + 10, now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207072', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207052', '00000000-0000-0000-0000-000000207061', 'active',        (now() at time zone 'Africa/Douala')::date - 20, (now() at time zone 'Africa/Douala')::date + 40, now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207073', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207053', '00000000-0000-0000-0000-000000207061', 'expiring_soon', (now() at time zone 'Africa/Douala')::date - 30, (now() at time zone 'Africa/Douala')::date,      now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207074', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207054', '00000000-0000-0000-0000-000000207061', 'expired',       (now() at time zone 'Africa/Douala')::date - 35, (now() at time zone 'Africa/Douala')::date - 5,  now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207075', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207055', '00000000-0000-0000-0000-000000207061', 'expired',       (now() at time zone 'Africa/Douala')::date - 35, (now() at time zone 'Africa/Douala')::date - 5,  now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207076', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207056', '00000000-0000-0000-0000-000000207062', 'active',        (now() at time zone 'Africa/Douala')::date - 20, null,              now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207077', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207057', '00000000-0000-0000-0000-000000207061', 'expiring_soon', (now() at time zone 'Africa/Douala')::date - 20, (now() at time zone 'Africa/Douala')::date + 10, now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000207078', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207058', '00000000-0000-0000-0000-000000207061', 'active',        (now() at time zone 'Africa/Douala')::date - 20, (now() at time zone 'Africa/Douala')::date + 10, now() - interval '30 days');

-- ---------------------------------------------------------------------------
-- Staff renewals
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000207021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000207011","app_role":"owner"}', true);

select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207051', 'cash', 'early renewal')$$, 'early staff renewal succeeds');
select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207052', 'cash', 'renewal with reward days')$$, 'renewal with rewarded days succeeds');
select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207053', 'cash', 'on expiry day')$$, 'renewal on the expiry day succeeds');
select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207054', 'cash', 'lapsed')$$, 'renewal of a lapsed subscription succeeds');
select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207055', 'cash', 'backdated', true)$$, 'back-dated renewal succeeds');
select lives_ok($$select confirm_renewal('00000000-0000-0000-0000-000000207056', 'cash', 'pay per session')$$, 'pay-per-session renewal succeeds');
select lives_ok($$select renew_subscription('00000000-0000-0000-0000-000000207058', 'manual reset')$$, 'manual reset succeeds');

reset role;

create or replace function pg_temp.latest(p_member uuid) returns subscriptions language sql as
$$ select s from subscriptions s where s.member_id = p_member order by s.created_at desc, s.id desc limit 1 $$;

select is((pg_temp.latest('00000000-0000-0000-0000-000000207051')).expiry_date, (now() at time zone 'Africa/Douala')::date + 40,
  'early: remaining 10 days carried -> expiry old + 30');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207051')).start_date, (now() at time zone 'Africa/Douala')::date,
  'early: start_date stays today');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207052')).expiry_date, (now() at time zone 'Africa/Douala')::date + 70,
  'rewarded days: a period holding 40 days left (30 + 10 free) carries all of it');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207053')).expiry_date, (now() at time zone 'Africa/Douala')::date + 30,
  'on the expiry day: nothing to carry, today + 30');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207054')).expiry_date, (now() at time zone 'Africa/Douala')::date + 30,
  'lapsed: starts from today, as before');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207055')).expiry_date, (now() at time zone 'Africa/Douala')::date - 5 + 30,
  'back-dated: old expiry + 30, as before');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207056')).expiry_date, null,
  'pay-per-session keeps a null expiry');
select is((pg_temp.latest('00000000-0000-0000-0000-000000207058')).expiry_date, (now() at time zone 'Africa/Douala')::date + 30,
  'renew_subscription (manual reset) deliberately still starts from today');

select is(
  (select (metadata ->> 'carried_days')::int from audit_log
   where action_type = 'renewal_confirmed' and target_entity_id = '00000000-0000-0000-0000-000000207051'),
  10, 'the audit row records carried_days = 10');

select is(
  (select count(*)::int from loyalty_progress where member_id = '00000000-0000-0000-0000-000000207051'),
  0, 'an early renewal earns no loyalty stamp, even with the carry');

-- ---------------------------------------------------------------------------
-- Tara renewal (webhook completion)
-- ---------------------------------------------------------------------------
insert into payments (id, gym_id, member_id, amount, currency, method, status, provider, purpose) values
  ('00000000-0000-0000-0000-000000207081', '00000000-0000-0000-0000-000000207011', '00000000-0000-0000-0000-000000207057', 15000, 'XAF', 'mobile_money', 'processing', 'taramoney', 'subscription');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select complete_verified_payment('00000000-0000-0000-0000-000000207081', 0);
reset role;

select is((pg_temp.latest('00000000-0000-0000-0000-000000207057')).expiry_date, (now() at time zone 'Africa/Douala')::date + 40,
  'Tara early renewal carries the remaining 10 days');
select is(
  (select (metadata ->> 'carried_days')::int from audit_log
   where action_type = 'subscription_payment_renewal' and target_entity_id = '00000000-0000-0000-0000-000000207057'),
  10, 'the Tara audit row records carried_days = 10');

select * from finish();
rollback;
