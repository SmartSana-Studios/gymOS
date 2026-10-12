-- Story 20.2: loyalty guest rule (migration 0118), denial paths. The hook and
-- the ledger have no client-callable surface; nothing a client does moves a
-- balance.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000401xx.

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000041001', 'GRN Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000041011', 'GRN Gym', '00000000-0000-0000-0000-000000041001', 'active', true, 0, true, 3, 3, 1);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000041021'), -- owner
  ('00000000-0000-0000-0000-000000041022'); -- member

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000041031', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041021', 'owner',  'GRN Owner',  current_date),
  ('00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041022', 'member', 'GRN Member', current_date);

insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032', 1, now());

-- A paid session someone tries to "consume" through the hook as a client.
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000410a1', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032',
   null, 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until, consumed_at, covered_day) values
  ('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032',
   '00000000-0000-0000-0000-0000000410a1', now() + interval '10 days', now(), current_date);

-- The hook is not callable by any client role.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000041021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000041011","app_role":"owner"}', true);
select throws_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011') $$,
  '42501', null, 'owner cannot call the hook');

-- No client write path on the ledger or the counters.
select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032', 'stamp_earned', 'guest', gen_random_uuid()) $$,
  '42501', null, 'owner cannot insert a ledger event');
select throws_ok(
  $$ update loyalty_progress set guest_stamps = 50 where member_id = '00000000-0000-0000-0000-000000041032' $$,
  '42501', null, 'owner cannot update a counter');
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032', gen_random_uuid(), now() + interval '60 days') $$,
  '42501', null, 'owner cannot insert a free session');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000041022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000041011","app_role":"member"}', true);
select throws_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011') $$,
  '42501', null, 'member cannot call the hook');
select throws_ok(
  $$ update loyalty_progress set guest_stamps = 50 where member_id = '00000000-0000-0000-0000-000000041032' $$,
  '42501', null, 'member cannot update their own counter');
select throws_ok(
  $$ delete from loyalty_events $$,
  '42501', null, 'member cannot delete ledger events');
reset role;

set local role service_role;
select throws_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011') $$,
  '42501', null, 'service_role cannot call the hook');
select throws_ok(
  $$ update loyalty_progress set guest_stamps = 50 $$,
  '42501', null, 'service_role cannot update a counter');
reset role;

set local role anon;
select throws_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011') $$,
  '42501', null, 'anon cannot call the hook');
reset role;

-- Defensive guards: wrong member or wrong gym for the session earns nothing.
select lives_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041031', '00000000-0000-0000-0000-000000041011') $$,
  'hook with a mismatched member returns quietly');
select is(
  (select count(*)::int from loyalty_events), 0,
  'mismatched member wrote no event');
select is(
  (select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000041032'),
  1, 'the counter is untouched by every denied attempt');

-- A different gym id for a valid consumed session and member earns nothing.
insert into gyms (id, name, tier_id, status, charge_guests_per_session, registration_fee,
                  loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days) values
  ('00000000-0000-0000-0000-000000041012', 'GRN Gym 2', '00000000-0000-0000-0000-000000041001', 'active', true, 0, true, 2, 3, 1);
select lives_ok(
  $$ select private.on_session_consumed('00000000-0000-0000-0000-0000000410b1', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041012') $$,
  'hook with a mismatched gym returns quietly');
select is(
  (select count(*)::int from loyalty_events) + (select count(*)::int from loyalty_progress where gym_id = '00000000-0000-0000-0000-000000041012'),
  0, 'mismatched gym wrote no event and no progress row');

-- A never-consumed session never stamps.
insert into payments (id, gym_id, member_id, subscription_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000410a2', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032',
   null, 2000, 'XAF', 'cash', 'verified', 'session');
insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until) values
  ('00000000-0000-0000-0000-0000000410b2', '00000000-0000-0000-0000-000000041011', '00000000-0000-0000-0000-000000041032',
   '00000000-0000-0000-0000-0000000410a2', now() + interval '10 days');
select private.on_session_consumed('00000000-0000-0000-0000-0000000410b2', '00000000-0000-0000-0000-000000041032', '00000000-0000-0000-0000-000000041011');
select is(
  (select count(*)::int from loyalty_events), 0,
  'an unconsumed session earns nothing');

select * from finish();
rollback;
