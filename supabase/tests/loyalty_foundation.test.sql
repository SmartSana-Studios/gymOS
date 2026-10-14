-- Story 20.1: loyalty program setting and ledger foundation (migration 0117),
-- positive paths. Denial paths live in loyalty_foundation.negative.test.sql.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000390xx.

begin;
select plan(56);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000039001', 'Loyalty Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000039011', 'Loyalty Gym A', '00000000-0000-0000-0000-000000039001', 'active'),
  ('00000000-0000-0000-0000-000000039012', 'Loyalty Gym B', '00000000-0000-0000-0000-000000039001', 'active');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000039021'), -- owner A
  ('00000000-0000-0000-0000-000000039022'), -- supervisor A
  ('00000000-0000-0000-0000-000000039023'), -- manager A
  ('00000000-0000-0000-0000-000000039024'), -- receptionist A
  ('00000000-0000-0000-0000-000000039025'), -- M1: subscriber (365-day plan)
  ('00000000-0000-0000-0000-000000039026'), -- M2: pay-per-session guest
  ('00000000-0000-0000-0000-000000039027'), -- two-gym member
  ('00000000-0000-0000-0000-000000039028'), -- owner B
  ('00000000-0000-0000-0000-00000003902a'); -- M3: no progress row

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000039031', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039021', 'owner',        'LY Owner A',        current_date),
  ('00000000-0000-0000-0000-000000039032', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039022', 'supervisor',   'LY Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000039033', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039023', 'manager',      'LY Manager A',      current_date),
  ('00000000-0000-0000-0000-000000039034', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039024', 'receptionist', 'LY Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000039035', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039025', 'member',       'LY Subscriber',     current_date),
  ('00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039026', 'member',       'LY Guest',          current_date),
  ('00000000-0000-0000-0000-000000039037', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039027', 'member',       'LY Two-gym A',      current_date),
  ('00000000-0000-0000-0000-000000039038', '00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039027', 'member',       'LY Two-gym B',      current_date),
  ('00000000-0000-0000-0000-000000039039', '00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039028', 'owner',        'LY Owner B',        current_date),
  ('00000000-0000-0000-0000-00000003903a', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003902a', 'member',       'LY Plain Member',   current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000039041', '00000000-0000-0000-0000-000000039011', 'LY Annual',  'monthly',         90000, 'XAF', 'monthly', 365),
  ('00000000-0000-0000-0000-000000039042', '00000000-0000-0000-0000-000000039011', 'LY PPS',     'pay_per_session', 2000,  'XAF', 'monthly', null);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039035', '00000000-0000-0000-0000-000000039041', 'active', current_date, current_date + 365),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-000000039042', 'active', current_date, null);

-- ============================================================================
-- Defaults: every gym is off, nothing configured.
-- ============================================================================
select is(
  (select count(*)::int from gyms where loyalty_enabled or loyalty_guest_threshold is not null
     or loyalty_renewal_threshold is not null or loyalty_reward_days is not null),
  0,
  'every gym starts off with N, K, R unset'
);

-- ============================================================================
-- set_loyalty_program(): owner enables, audit row, no-op writes nothing.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"owner"}', true);
select lives_ok($$ select set_loyalty_program(true, 5, 6, 7) $$, 'owner can enable the program');
reset role;

select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039011'),
  '(t,5,6,7)',
  'the four columns hold the enabled values'
);

select is(
  (select metadata from audit_log
   where action_type = 'loyalty_program_changed' and gym_id = '00000000-0000-0000-0000-000000039011'
   order by created_at desc limit 1),
  '{"old": {"enabled": false, "guest_threshold": null, "renewal_threshold": null, "reward_days": null},
    "new": {"enabled": true, "guest_threshold": 5, "renewal_threshold": 6, "reward_days": 7}}'::jsonb,
  'one audit row records old and new of all four values'
);

select is(
  (select loyalty_enabled from gyms where id = '00000000-0000-0000-0000-000000039012'),
  false,
  'gym B is untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"owner"}', true);
select set_loyalty_program(true, 5, 6, 7);
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_program_changed' and gym_id = '00000000-0000-0000-0000-000000039011'),
  1,
  'an unchanged call writes no second audit row'
);

-- Supervisor disables: values kept.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"supervisor"}', true);
select lives_ok($$ select set_loyalty_program(false, null, null, null) $$, 'supervisor can disable the program');
reset role;

select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039011'),
  '(f,5,6,7)',
  'disable switches off and keeps N, K, R'
);

select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_program_changed' and gym_id = '00000000-0000-0000-0000-000000039011'),
  2,
  'the disable added one audit row'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"supervisor"}', true);
select set_loyalty_program(false, 2, 3, 1);
reset role;

select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_program_changed' and gym_id = '00000000-0000-0000-0000-000000039011'),
  2,
  'disabling an already-off program (any N/K/R passed) writes nothing'
);

select is(
  (select row(loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039011'),
  '(5,6,7)',
  'disable ignores the N, K, R arguments'
);

-- Re-enable with the boundary values.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"owner"}', true);
select lives_ok($$ select set_loyalty_program(true, 2, 3, 1) $$, 'lower boundary values are accepted');
select lives_ok($$ select set_loyalty_program(true, 50, 24, 30) $$, 'upper boundary values are accepted');
select lives_ok($$ select set_loyalty_program(true, 5, 6, 7) $$, 'back to 5/6/7');
reset role;

-- ============================================================================
-- Schema shape.
-- ============================================================================
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'loyalty_events'),
  array['id','gym_id','member_id','event_type','counter','origin_id','occurred_at','details'],
  'loyalty_events has the pinned column set'
);

select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'loyalty_progress'),
  array['gym_id','member_id','guest_stamps','subscriber_stamps','guest_last_event_at','subscriber_last_event_at'],
  'loyalty_progress has the pinned column set'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.loyalty_events'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.loyalty_progress'::regclass),
  'RLS is enabled on both tables'
);

select ok(
  has_table_privilege('authenticated', 'public.loyalty_events', 'SELECT')
  and has_table_privilege('service_role', 'public.loyalty_progress', 'SELECT')
  and not has_table_privilege('authenticated', 'public.loyalty_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.loyalty_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.loyalty_events', 'DELETE')
  and not has_table_privilege('authenticated', 'public.loyalty_events', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.loyalty_events', 'INSERT')
  and not has_table_privilege('service_role', 'public.loyalty_events', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.loyalty_progress', 'INSERT')
  and not has_table_privilege('authenticated', 'public.loyalty_progress', 'UPDATE')
  and not has_table_privilege('service_role', 'public.loyalty_progress', 'DELETE')
  and not has_table_privilege('service_role', 'public.loyalty_progress', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.loyalty_events', 'SELECT'),
  'both tables are SELECT-only for authenticated and service_role, nothing for anon'
);

-- ============================================================================
-- Ledger: exactly-once key and the grant FK.
-- ============================================================================
insert into loyalty_events (id, gym_id, member_id, event_type, counter, origin_id) values
  ('00000000-0000-0000-0000-0000000390e1', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'stamp_earned',   'guest', '00000000-0000-0000-0000-0000000390f1'),
  ('00000000-0000-0000-0000-0000000390e2', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'reward_granted', 'guest', '00000000-0000-0000-0000-0000000390f1');

select is(
  (select count(*)::int from loyalty_events where origin_id = '00000000-0000-0000-0000-0000000390f1'),
  2,
  'one origin can carry different event types'
);

select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'stamp_earned', 'guest', '00000000-0000-0000-0000-0000000390f1') $$,
  '23505', null, 'a duplicate (origin_id, event_type) is refused'
);

insert into guest_sessions (id, gym_id, member_id, loyalty_grant_id, usable_until, created_at) values
  ('00000000-0000-0000-0000-0000000390a1', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036',
   '00000000-0000-0000-0000-0000000390e2', now() + interval '30 days', now());

select is(
  (select loyalty_grant_event_type from guest_sessions where id = '00000000-0000-0000-0000-0000000390a1'),
  'reward_granted',
  'a grant session carries the generated event type'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036',
             '00000000-0000-0000-0000-0000000390e1', now() + interval '30 days') $$,
  '23503', null, 'a grant pointing at a stamp_earned row is refused by the composite FK'
);

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036',
             gen_random_uuid(), now() + interval '30 days') $$,
  '23503', null, 'a grant pointing at no ledger row is refused'
);

select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'bogus', 'guest', gen_random_uuid()) $$,
  '23514', null, 'an unknown event type is refused'
);

select throws_ok(
  $$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
     values ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'lapse', 'bogus', gen_random_uuid()) $$,
  '23514', null, 'an unknown counter is refused'
);

-- ============================================================================
-- effective_loyalty(): windows applied at read time, sessions, shape.
-- ============================================================================
insert into loyalty_progress (gym_id, member_id, guest_stamps, subscriber_stamps, guest_last_event_at, subscriber_last_event_at) values
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 4, 2, now() - interval '91 days', now() - interval '89 days'),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039035', 4, 3, now() - interval '89 days', now() - interval '200 days');

insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000390b1', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 2000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-0000000390b2', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 2000, 'XAF', 'cash', 'verified', 'session');

insert into guest_sessions (id, gym_id, member_id, payment_id, usable_until, voided_at) values
  ('00000000-0000-0000-0000-0000000390a2', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-0000000390b1', now() + interval '3 days', null),
  ('00000000-0000-0000-0000-0000000390a3', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-0000000390b2', now() + interval '3 days', now());

-- Negative fixtures for M2: none of these may appear in free_sessions or
-- paid_sessions (consumed, expired, voided, other gym).
insert into payments (id, gym_id, member_id, amount, currency, method, status, purpose) values
  ('00000000-0000-0000-0000-0000000390c1', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 2000, 'XAF', 'cash', 'verified', 'session'),
  ('00000000-0000-0000-0000-0000000390c2', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 2000, 'XAF', 'cash', 'verified', 'session');

insert into loyalty_events (id, gym_id, member_id, event_type, counter, origin_id) values
  ('00000000-0000-0000-0000-0000000390e3', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'reward_granted', 'guest', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000390e4', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'reward_granted', 'guest', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000390e5', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', 'reward_granted', 'guest', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000390e6', '00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039036', 'reward_granted', 'guest', gen_random_uuid());

insert into guest_sessions (gym_id, member_id, payment_id, loyalty_grant_id, usable_until, consumed_at, covered_day, voided_at) values
  -- free: consumed
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', null, '00000000-0000-0000-0000-0000000390e3', now() + interval '30 days', now(), current_date - 1, null),
  -- free: expired
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', null, '00000000-0000-0000-0000-0000000390e4', now() - interval '1 day', null, null, null),
  -- free: voided
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', null, '00000000-0000-0000-0000-0000000390e5', now() + interval '30 days', null, null, now()),
  -- free: usable but in another gym
  ('00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039036', null, '00000000-0000-0000-0000-0000000390e6', now() + interval '30 days', null, null, null),
  -- paid: consumed
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-0000000390c1', null, now() + interval '3 days', now(), current_date - 2, null),
  -- paid: expired
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039036', '00000000-0000-0000-0000-0000000390c2', null, now() - interval '1 day', null, null, null);

-- Window fixtures: short plan, and latest-subscription selection both ways.
insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000039043', '00000000-0000-0000-0000-000000039011', 'LY Monthly 30', 'monthly', 15000, 'XAF', 'monthly', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000003902b'), -- short plan
  ('00000000-0000-0000-0000-00000003902c'), -- older 365, newer 30
  ('00000000-0000-0000-0000-00000003902d'), -- older 30, newer 365
  ('00000000-0000-0000-0000-00000003902e'), -- owner of suspended gym
  ('00000000-0000-0000-0000-00000003902f'); -- member of suspended gym

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000039013', 'Loyalty Gym Suspended', '00000000-0000-0000-0000-000000039001', 'suspended');

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-00000003903b', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003902b', 'member', 'LY Short Plan',    current_date),
  ('00000000-0000-0000-0000-00000003903c', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003902c', 'member', 'LY Downgraded',    current_date),
  ('00000000-0000-0000-0000-00000003903d', '00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003902d', 'member', 'LY Upgraded',      current_date),
  ('00000000-0000-0000-0000-00000003903e', '00000000-0000-0000-0000-000000039013', '00000000-0000-0000-0000-00000003902e', 'owner',  'LY Owner Suspended', current_date),
  ('00000000-0000-0000-0000-00000003903f', '00000000-0000-0000-0000-000000039013', '00000000-0000-0000-0000-00000003902f', 'member', 'LY Member Suspended', current_date);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date, created_at) values
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003903b', '00000000-0000-0000-0000-000000039043', 'active',  current_date,      current_date + 30,  now()),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003903c', '00000000-0000-0000-0000-000000039041', 'expired', current_date - 60, current_date - 30,  now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003903c', '00000000-0000-0000-0000-000000039043', 'active',  current_date,      current_date + 30,  now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003903d', '00000000-0000-0000-0000-000000039043', 'expired', current_date - 60, current_date - 30,  now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-00000003903d', '00000000-0000-0000-0000-000000039041', 'active',  current_date,      current_date + 365, now() - interval '1 day');

insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id) values
  ('00000000-0000-0000-0000-000000039013', '00000000-0000-0000-0000-00000003903f', 'stamp_earned', 'guest', gen_random_uuid());
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000039013', '00000000-0000-0000-0000-00000003903f', 1, now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"member"}', true);

select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039036')->>'guest_stamps')::int,
  0,
  'guest counter reads 0 when the last event is 91 days old'
);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039036')->>'subscriber_stamps')::int,
  2,
  'subscriber counter stays live inside the 90-day window on a pay-per-session plan'
);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039036')->>'subscriber_window_days')::int,
  90,
  'a plan with no duration falls back to the platform idle window'
);
select is(
  jsonb_array_length(effective_loyalty('00000000-0000-0000-0000-000000039036')->'free_sessions'),
  1,
  'one usable free session is listed'
);
select is(
  jsonb_array_length(effective_loyalty('00000000-0000-0000-0000-000000039036')->'paid_sessions'),
  1,
  'the voided paid session is not listed, the usable one is'
);
select is(
  (select jsonb_agg(e->>'id') from jsonb_array_elements(effective_loyalty('00000000-0000-0000-0000-000000039036')->'free_sessions') e),
  '["00000000-0000-0000-0000-0000000390a1"]'::jsonb,
  'free_sessions holds only the usable free session (consumed, expired, voided and other-gym ones are absent)'
);
select is(
  (select jsonb_agg(e->>'id') from jsonb_array_elements(effective_loyalty('00000000-0000-0000-0000-000000039036')->'paid_sessions') e),
  '["00000000-0000-0000-0000-0000000390a2"]'::jsonb,
  'paid_sessions holds only the usable paid session (voided, consumed and expired ones are absent)'
);
select ok(
  (effective_loyalty('00000000-0000-0000-0000-000000039036')->'free_sessions'->0) ? 'usable_until',
  'a session entry carries usable_until'
);
select is(
  (effective_loyalty('00000000-0000-0000-0000-000000039036')->>'enabled')::boolean,
  true,
  'enabled reflects the gym setting'
);
select is(
  (effective_loyalty('00000000-0000-0000-0000-000000039036') - 'free_sessions' - 'paid_sessions'),
  '{"enabled": true, "guest_stamps": 0, "subscriber_stamps": 2, "guest_threshold": 5, "renewal_threshold": 6,
    "reward_days": 7, "guest_window_days": 90, "subscriber_window_days": 90}'::jsonb,
  'the object carries the full field set'
);
reset role;

-- Subscriber window: 365 + grace 3 = 368.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"member"}', true);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039035')->>'subscriber_window_days')::int,
  368,
  'subscriber window is plan duration plus the gym grace period'
);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039035')->>'subscriber_stamps')::int,
  3,
  'a subscriber event 200 days ago is still live inside the 368-day window'
);
reset role;

update loyalty_progress set subscriber_last_event_at = now() - interval '369 days'
where member_id = '00000000-0000-0000-0000-000000039035';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"member"}', true);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-000000039035')->>'subscriber_stamps')::int,
  0,
  'a subscriber event 369 days ago reads 0'
);
reset role;

select is(
  (select subscriber_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000039035'),
  3,
  'the read never writes: the stored counter is unchanged'
);

-- A member with no progress row reads zeros; staff can read any member of the gym.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"receptionist"}', true);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-00000003903a')->>'guest_stamps')::int,
  0,
  'a receptionist reads a member with no progress row as zero'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"manager"}', true);
select lives_ok($$ select effective_loyalty('00000000-0000-0000-0000-000000039035') $$, 'a manager can read a member of the gym');
reset role;

-- ============================================================================
-- Window floor and latest-subscription selection (read as owner A).
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"owner"}', true);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-00000003903b')->>'subscriber_window_days')::int,
  90,
  'a 30-day plan plus grace 3 is floored at the 90-day idle window'
);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-00000003903c')->>'subscriber_window_days')::int,
  90,
  'older 365-day, newer 30-day subscription: the newest decides (90, not 368)'
);
select is(
  (select effective_loyalty('00000000-0000-0000-0000-00000003903d')->>'subscriber_window_days')::int,
  368,
  'older 30-day, newer 365-day subscription: the newest decides (368)'
);
reset role;

-- ============================================================================
-- Suspended gym: restrictive tenant_active_gate hides both tables.
-- ============================================================================
select is(
  (select count(*)::int from loyalty_events where gym_id = '00000000-0000-0000-0000-000000039013')
  + (select count(*)::int from loyalty_progress where gym_id = '00000000-0000-0000-0000-000000039013'),
  2,
  'positive control: the suspended gym fixture rows exist (seen as table owner)'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003902e","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039013","app_role":"owner"}', true);
select is(
  (select count(*)::int from loyalty_events) + (select count(*)::int from loyalty_progress),
  0,
  'the owner of a suspended gym reads no ledger or progress rows'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003902f","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039013","app_role":"member"}', true);
select is(
  (select count(*)::int from loyalty_events) + (select count(*)::int from loyalty_progress),
  0,
  'a member of a suspended gym reads none of their own ledger or progress rows'
);
reset role;

-- ============================================================================
-- Isolation: each gym's staff and the two-gym member see only that gym's rows.
-- ============================================================================
insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id) values
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039037', 'stamp_earned', 'guest', gen_random_uuid()),
  ('00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039038', 'stamp_earned', 'guest', gen_random_uuid());
insert into loyalty_progress (gym_id, member_id, guest_stamps) values
  ('00000000-0000-0000-0000-000000039011', '00000000-0000-0000-0000-000000039037', 1),
  ('00000000-0000-0000-0000-000000039012', '00000000-0000-0000-0000-000000039038', 1);

-- Staff read roles can all SELECT their own gym's rows (member 039037: one
-- ledger row, one progress row).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"manager"}', true);
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000039037')
  + (select count(*)::int from loyalty_progress where member_id = '00000000-0000-0000-0000-000000039037'),
  2, 'a manager reads the gym''s ledger and progress rows');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"supervisor"}', true);
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000039037')
  + (select count(*)::int from loyalty_progress where member_id = '00000000-0000-0000-0000-000000039037'),
  2, 'a supervisor reads the gym''s ledger and progress rows');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"receptionist"}', true);
select is(
  (select count(*)::int from loyalty_events where member_id = '00000000-0000-0000-0000-000000039037')
  + (select count(*)::int from loyalty_progress where member_id = '00000000-0000-0000-0000-000000039037'),
  2, 'a receptionist reads the gym''s ledger and progress rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"owner"}', true);
select is((select count(*)::int from loyalty_events where gym_id = '00000000-0000-0000-0000-000000039012'), 0,
  'staff of gym A sees no gym B ledger rows');
select ok((select count(*)::int from loyalty_events) >= 3, 'staff of gym A sees gym A ledger rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039028","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039012","app_role":"owner"}', true);
select is((select count(*)::int from loyalty_progress where gym_id = '00000000-0000-0000-0000-000000039011'), 0,
  'staff of gym B sees no gym A progress rows');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039011","app_role":"member"}', true);
select is(
  (select array_agg(member_id::text order by member_id) from loyalty_progress),
  array['00000000-0000-0000-0000-000000039037'],
  'the two-gym member sees only their own gym A row while active in gym A'
);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039012","app_role":"member"}', true);
select is(
  (select array_agg(member_id::text order by member_id) from loyalty_events),
  array['00000000-0000-0000-0000-000000039038'],
  'the two-gym member sees only their gym B ledger row while active in gym B'
);
reset role;

select ok(
  not has_function_privilege('anon', 'public.set_loyalty_program(boolean, integer, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.effective_loyalty(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.protect_loyalty_program_columns()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_loyalty_program(boolean, integer, integer, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.effective_loyalty(uuid)', 'EXECUTE'),
  'anon holds EXECUTE on none of the new functions, authenticated on the two RPCs'
);

select * from finish();
rollback;
