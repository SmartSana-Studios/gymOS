-- Story 20.1: loyalty program setting and ledger foundation (migration 0117),
-- denial paths. Positive paths: loyalty_foundation.test.sql.
--
-- Pins revert silently, so every denial is paired with a positive control.
-- The suspended gym is seeded suspended in its INSERT (a bare UPDATE of
-- gyms.status is silently reverted).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000391xx.

begin;
select plan(65);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000039101', 'LYN Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000039111', 'LYN Gym A',         '00000000-0000-0000-0000-000000039101', 'active'),
  ('00000000-0000-0000-0000-000000039112', 'LYN Gym B',         '00000000-0000-0000-0000-000000039101', 'active'),
  ('00000000-0000-0000-0000-000000039113', 'LYN Gym Suspended', '00000000-0000-0000-0000-000000039101', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000039121'), -- owner A
  ('00000000-0000-0000-0000-000000039122'), -- supervisor A
  ('00000000-0000-0000-0000-000000039123'), -- manager A
  ('00000000-0000-0000-0000-000000039124'), -- receptionist A
  ('00000000-0000-0000-0000-000000039125'), -- coach A
  ('00000000-0000-0000-0000-000000039126'), -- member A1
  ('00000000-0000-0000-0000-000000039127'), -- owner B
  ('00000000-0000-0000-0000-000000039128'), -- owner of suspended gym
  ('00000000-0000-0000-0000-000000039129'), -- super admin
  ('00000000-0000-0000-0000-00000003912a'), -- member A2
  ('00000000-0000-0000-0000-00000003912b'); -- member of suspended gym

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000039131', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039121', 'owner',        'LYN Owner A',        current_date),
  ('00000000-0000-0000-0000-000000039132', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039122', 'supervisor',   'LYN Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000039133', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039123', 'manager',      'LYN Manager A',      current_date),
  ('00000000-0000-0000-0000-000000039134', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039124', 'receptionist', 'LYN Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000039135', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039125', 'coach',        'LYN Coach A',        current_date),
  ('00000000-0000-0000-0000-000000039136', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039126', 'member',       'LYN Member A1',      current_date),
  ('00000000-0000-0000-0000-000000039137', '00000000-0000-0000-0000-000000039112', '00000000-0000-0000-0000-000000039127', 'owner',        'LYN Owner B',        current_date),
  ('00000000-0000-0000-0000-000000039138', '00000000-0000-0000-0000-000000039113', '00000000-0000-0000-0000-000000039128', 'owner',        'LYN Owner Suspended', current_date),
  ('00000000-0000-0000-0000-00000003913a', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-00000003912a', 'member',       'LYN Member A2',      current_date),
  ('00000000-0000-0000-0000-00000003913b', '00000000-0000-0000-0000-000000039113', '00000000-0000-0000-0000-00000003912b', 'member',       'LYN Member Suspended', current_date);

-- ============================================================================
-- set_loyalty_program(): role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"manager"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'a manager cannot set the program');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"receptionist"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'a receptionist cannot set the program');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"coach"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'a coach cannot set the program');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"member"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'a member cannot set the program');

-- A forged app_role claim must not matter: the role comes from the members row.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'a member with a forged owner claim is refused (role read from members)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'no gym_id claim: refused');

-- Owner of gym B cannot reach gym A: the gym comes from the claim, and the
-- setter takes no gym argument.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%permission denied%', 'owner B with a gym A claim has no gym A membership: refused');

-- Suspended gym.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039113","app_role":"owner"}', true);
select throws_like($$ select set_loyalty_program(true, 5, 6, 7) $$, '%is not active%', 'a suspended gym cannot change the program');

-- Invalid values (owner A, active gym).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select throws_like($$ select set_loyalty_program(null, 5, 6, 7) $$,  '%invalid_value%', 'NULL enabled is rejected');
select throws_like($$ select set_loyalty_program(true, null, 6, 7) $$, '%invalid_value%', 'enable with N null is rejected');
select throws_like($$ select set_loyalty_program(true, 5, null, 7) $$, '%invalid_value%', 'enable with K null is rejected');
select throws_like($$ select set_loyalty_program(true, 5, 6, null) $$, '%invalid_value%', 'enable with R null is rejected');
select throws_like($$ select set_loyalty_program(true, 1, 6, 7) $$,  '%invalid_value%', 'N = 1 is rejected');
select throws_like($$ select set_loyalty_program(true, 51, 6, 7) $$, '%invalid_value%', 'N = 51 is rejected');
select throws_like($$ select set_loyalty_program(true, 5, 2, 7) $$,  '%invalid_value%', 'K = 2 is rejected');
select throws_like($$ select set_loyalty_program(true, 5, 25, 7) $$, '%invalid_value%', 'K = 25 is rejected');
select throws_like($$ select set_loyalty_program(true, 5, 6, 0) $$,  '%invalid_value%', 'R = 0 is rejected');
select throws_like($$ select set_loyalty_program(true, 5, 6, 31) $$, '%invalid_value%', 'R = 31 is rejected');
reset role;

select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039111'),
  '(f,,,)',
  'every refused call left gym A unchanged'
);

select is(
  (select count(*)::int from audit_log where action_type = 'loyalty_program_changed'),
  0,
  'refused calls wrote no audit rows'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select lives_ok($$ select set_loyalty_program(true, 5, 6, 7) $$, 'positive control: owner A can set the program');
reset role;

select is(
  (select array_agg(loyalty_enabled order by name) from gyms
   where id in ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039112', '00000000-0000-0000-0000-000000039113')),
  array[true, false, false],
  'only gym A changed; gym B and the suspended gym stay off'
);

-- ============================================================================
-- Direct writes to the four columns are pinned, for every writer.
-- ============================================================================
update gyms set loyalty_enabled = false, loyalty_guest_threshold = 9, loyalty_renewal_threshold = 9, loyalty_reward_days = 9
where id = '00000000-0000-0000-0000-000000039111';
select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039111'),
  '(t,5,6,7)',
  'a postgres-role UPDATE of the four columns is pinned too'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
update gyms set loyalty_enabled = false, loyalty_guest_threshold = 9, name = 'LYN Gym A Renamed'
where id = '00000000-0000-0000-0000-000000039111';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000039111'), 'LYN Gym A Renamed',
  'positive control: the owner''s direct gym UPDATE landed (name changed)');
select is(
  (select row(loyalty_enabled, loyalty_guest_threshold)::text from gyms where id = '00000000-0000-0000-0000-000000039111'),
  '(t,5)',
  'owner direct UPDATE of the loyalty columns is pinned to the old values'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039129","role":"authenticated","app_role":"super_admin"}', true);
update gyms set loyalty_enabled = true, loyalty_guest_threshold = 3, loyalty_renewal_threshold = 4, loyalty_reward_days = 5,
  name = 'LYN Gym B Renamed' where id = '00000000-0000-0000-0000-000000039112';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000039112'), 'LYN Gym B Renamed',
  'positive control: the super admin direct gym UPDATE landed (name changed)');
select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039112'),
  '(f,,,)',
  'a super admin direct UPDATE of the loyalty columns is pinned');

set local role service_role;
update gyms set loyalty_enabled = true, loyalty_guest_threshold = 3, loyalty_renewal_threshold = 4, loyalty_reward_days = 5,
  name = 'LYN Gym B Service' where id = '00000000-0000-0000-0000-000000039112';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000039112'), 'LYN Gym B Service',
  'positive control: the service_role direct gym UPDATE landed (name changed)');
select is(
  (select row(loyalty_enabled, loyalty_guest_threshold, loyalty_renewal_threshold, loyalty_reward_days)::text
   from gyms where id = '00000000-0000-0000-0000-000000039112'),
  '(f,,,)',
  'a service_role direct UPDATE of the loyalty columns is pinned');

-- The CHECKs hold even for a writer holding the GUC.
select set_config('app.loyalty_program_update_bypass', 'true', true);
select throws_ok(
  $$ update gyms set loyalty_enabled = true where id = '00000000-0000-0000-0000-000000039112' $$,
  '23514', null, 'enabling without N, K, R violates the CHECK');
select throws_ok(
  $$ update gyms set loyalty_guest_threshold = 1 where id = '00000000-0000-0000-0000-000000039111' $$,
  '23514', null, 'N = 1 violates the CHECK');
select throws_ok(
  $$ update gyms set loyalty_renewal_threshold = 25 where id = '00000000-0000-0000-0000-000000039111' $$,
  '23514', null, 'K = 25 violates the CHECK');
select throws_ok(
  $$ update gyms set loyalty_reward_days = 0 where id = '00000000-0000-0000-0000-000000039111' $$,
  '23514', null, 'R = 0 violates the CHECK');
select set_config('app.loyalty_program_update_bypass', 'false', true);

-- ============================================================================
-- Ledger and progress: no client write path of any kind.
-- ============================================================================
insert into loyalty_events (id, gym_id, member_id, event_type, counter, origin_id) values
  ('00000000-0000-0000-0000-0000000391e1', '00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039136', 'stamp_earned', 'guest', gen_random_uuid());
insert into loyalty_progress (gym_id, member_id, guest_stamps, guest_last_event_at) values
  ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039136', 1, now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select throws_ok($$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
   values ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039136', 'stamp_earned', 'guest', gen_random_uuid()) $$,
  '42501', null, 'an owner cannot insert a ledger row');
select throws_ok($$ update loyalty_events set event_type = 'lapse' $$, '42501', null, 'an owner cannot update the ledger');
select throws_ok($$ delete from loyalty_events $$, '42501', null, 'an owner cannot delete from the ledger');
select throws_ok($$ truncate loyalty_events $$, '42501', null, 'an owner cannot truncate the ledger');
select throws_ok($$ insert into loyalty_progress (gym_id, member_id, guest_stamps)
   values ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-00000003913a', 99) $$,
  '42501', null, 'an owner cannot insert a progress row (no manual balance)');
select throws_ok($$ update loyalty_progress set guest_stamps = 99 $$, '42501', null, 'an owner cannot edit a balance');
select throws_ok($$ delete from loyalty_progress $$, '42501', null, 'an owner cannot delete a progress row');
select throws_ok($$ truncate loyalty_progress $$, '42501', null, 'an owner cannot truncate progress');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"member"}', true);
select throws_ok($$ update loyalty_progress set guest_stamps = 99 $$, '42501', null, 'a member cannot edit their balance');
select is((select count(*)::int from loyalty_progress), 1, 'positive control: the member reads their own progress row');
select is((select count(*)::int from loyalty_events), 1, 'positive control: the member reads their own ledger row');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000003912a","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"member"}', true);
select is((select count(*)::int from loyalty_progress), 0, 'another member of the gym does not see that row');
select is((select count(*)::int from loyalty_events), 0, 'another member of the gym does not see that ledger row');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"coach"}', true);
select is((select count(*)::int from loyalty_progress), 0, 'a coach does not see progress rows (matches guest_sessions)');
reset role;

set local role service_role;
select throws_ok($$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
   values ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039136', 'stamp_earned', 'guest', gen_random_uuid()) $$,
  '42501', null, 'service_role cannot insert a ledger row either');
select throws_ok($$ update loyalty_progress set guest_stamps = 99 $$, '42501', null, 'service_role cannot edit a balance');
select throws_ok($$ truncate loyalty_events $$, '42501', null, 'service_role cannot truncate the ledger');
reset role;

select is((select guest_stamps from loyalty_progress where member_id = '00000000-0000-0000-0000-000000039136'), 1,
  'the balance is unchanged after every refused write');

-- ============================================================================
-- Duplicate event: the exactly-once key.
-- ============================================================================
select throws_ok($$ insert into loyalty_events (gym_id, member_id, event_type, counter, origin_id)
   select gym_id, member_id, event_type, counter, origin_id from loyalty_events where id = '00000000-0000-0000-0000-0000000391e1' $$,
  '23505', null, 'a second (origin_id, event_type) insert fails');

-- ============================================================================
-- effective_loyalty(): denials.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"member"}', true);
select lives_ok($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, 'positive control: a member reads their own loyalty');
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-00000003913a') $$, '%permission denied%',
  'a member cannot read another member');
select throws_like($$ select effective_loyalty(gen_random_uuid()) $$, '%permission denied%', 'an unknown member id is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-00000003913a') $$, '%permission denied%',
  'a forged owner claim on a member does not unlock another member');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"coach"}', true);
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, '%permission denied%',
  'a coach cannot read a member loyalty object');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039127","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039112","app_role":"owner"}', true);
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, '%permission denied%',
  'staff of gym B cannot read a gym A member');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, '%permission denied%',
  'no gym_id claim: refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039111","app_role":"owner"}', true);
select lives_ok($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, 'positive control: owner A reads a gym A member');
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-00000003913b') $$, '%permission denied%',
  'owner A cannot read a member of the suspended gym (other gym)');

-- Suspended gym: the owner is authorized, the result is JSON null.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000039128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000039113","app_role":"owner"}', true);
select is(
  effective_loyalty('00000000-0000-0000-0000-00000003913b'),
  'null'::jsonb,
  'a suspended gym returns JSON null (not a SQL NULL)'
);
reset role;

set local role service_role;
select throws_like($$ select effective_loyalty('00000000-0000-0000-0000-000000039136') $$, '%permission denied%',
  'service_role has no caller identity and is refused');
reset role;

select is(
  (select count(*)::int from loyalty_events), 1,
  'effective_loyalty wrote nothing to the ledger');

-- ============================================================================
-- FK type check: a stamp row cannot back a grant even for the table owner.
-- ============================================================================
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000039111', '00000000-0000-0000-0000-000000039136',
             '00000000-0000-0000-0000-0000000391e1', now() + interval '60 days') $$,
  '23503', null, 'loyalty_grant_id must reference a reward_granted row');

select * from finish();
rollback;
