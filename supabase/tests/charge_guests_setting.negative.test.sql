-- Story 19.3: charge-guests setting, session record and plan-type rules
-- (migration 0107), denial paths. Positive paths: charge_guests_setting.test.sql.
--
-- Pins revert silently, so every denial is paired with a positive control.
-- The suspended gym is seeded suspended in its INSERT (a bare UPDATE of
-- gyms.status is silently reverted).
--
-- Fixture ids: 00000000-0000-0000-0000-0000000321xx.

begin;
select plan(49);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000032101', 'GC Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000032111', 'GC Neg Gym A',         '00000000-0000-0000-0000-000000032101', 'active'),
  ('00000000-0000-0000-0000-000000032112', 'GC Neg Gym B',         '00000000-0000-0000-0000-000000032101', 'active'),
  ('00000000-0000-0000-0000-000000032113', 'GC Neg Gym Suspended', '00000000-0000-0000-0000-000000032101', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000032121'), -- owner A
  ('00000000-0000-0000-0000-000000032122'), -- supervisor A
  ('00000000-0000-0000-0000-000000032123'), -- manager A
  ('00000000-0000-0000-0000-000000032124'), -- receptionist A
  ('00000000-0000-0000-0000-000000032125'), -- coach A
  ('00000000-0000-0000-0000-000000032126'), -- member A
  ('00000000-0000-0000-0000-000000032127'), -- owner B
  ('00000000-0000-0000-0000-000000032128'), -- owner of suspended gym
  ('00000000-0000-0000-0000-000000032129'); -- super admin

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000032131', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032121', 'owner',        'GCN Owner A',        current_date),
  ('00000000-0000-0000-0000-000000032132', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032122', 'supervisor',   'GCN Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000032133', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032123', 'manager',      'GCN Manager A',      current_date),
  ('00000000-0000-0000-0000-000000032134', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032124', 'receptionist', 'GCN Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000032135', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032125', 'coach',        'GCN Coach A',        current_date),
  ('00000000-0000-0000-0000-000000032136', '00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032126', 'member',       'GCN Member A',       current_date),
  ('00000000-0000-0000-0000-000000032137', '00000000-0000-0000-0000-000000032112', '00000000-0000-0000-0000-000000032127', 'owner',        'GCN Owner B',        current_date),
  ('00000000-0000-0000-0000-000000032138', '00000000-0000-0000-0000-000000032113', '00000000-0000-0000-0000-000000032128', 'owner',        'GCN Owner Suspended', current_date);

insert into plans (id, gym_id, name, plan_type, price, currency, billing_interval, duration_days) values
  ('00000000-0000-0000-0000-000000032141', '00000000-0000-0000-0000-000000032111', 'GCN Monthly (has subs)', 'monthly',         15000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000032142', '00000000-0000-0000-0000-000000032111', 'GCN Monthly (no subs)',  'monthly',         12000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000032143', '00000000-0000-0000-0000-000000032112', 'GCN B Monthly',         'monthly',         10000, 'XAF', 'monthly', 30),
  ('00000000-0000-0000-0000-000000032144', '00000000-0000-0000-0000-000000032113', 'GCN Suspended Monthly', 'monthly',         8000,  'XAF', 'monthly', 30);

insert into subscriptions (gym_id, member_id, plan_id, status, start_date, expiry_date) values
  ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032136', '00000000-0000-0000-0000-000000032141', 'active', current_date, current_date + 30);

-- ============================================================================
-- set_guest_charging(): role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"manager"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'a manager cannot set the flag');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"receptionist"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'a receptionist cannot set the flag');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"coach"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'a coach cannot set the flag');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"member"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'a member cannot set the flag');

-- A forged app_role claim must not matter: the role comes from the members row.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"owner"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'a member with a forged owner claim is refused (role read from members)');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032121","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%permission denied%', 'no gym_id claim: refused');

-- Suspended gym.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032113","app_role":"owner"}', true);
select throws_like($$ select set_guest_charging(true) $$, '%is not active%', 'a suspended gym cannot change the flag');

-- Invalid value, positive control for the gates above.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"owner"}', true);
select throws_like($$ select set_guest_charging(null) $$, '%invalid_value%', 'a NULL value is rejected');
select lives_ok($$ select set_guest_charging(true) $$, 'positive control: owner A can set the flag');
reset role;

select is(
  (select array_agg(charge_guests_per_session order by name) from gyms
   where id in ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032112', '00000000-0000-0000-0000-000000032113')),
  array[true, false, false],
  'only gym A changed; gym B and the suspended gym stay off'
);

select is(
  (select count(*)::int from audit_log where action_type = 'guest_charging_changed'),
  1,
  'refused calls wrote no audit rows'
);

-- ============================================================================
-- guest_charging_impact(): role gate.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"manager"}', true);
select throws_like($$ select guest_charging_impact() $$, '%permission denied%', 'a manager cannot read the impact count');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"receptionist"}', true);
select throws_like($$ select guest_charging_impact() $$, '%permission denied%', 'a receptionist cannot read the impact count');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"member"}', true);
select throws_like($$ select guest_charging_impact() $$, '%permission denied%', 'a member cannot read the impact count');
reset role;

-- ============================================================================
-- Direct writes to the flag are pinned, for every writer.
-- ============================================================================
update gyms set charge_guests_per_session = false where id = '00000000-0000-0000-0000-000000032111';
select is(
  (select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032111'),
  true,
  'a postgres-role UPDATE of the flag is pinned too'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"owner"}', true);
update gyms set charge_guests_per_session = false, name = 'GC Neg Gym A Renamed' where id = '00000000-0000-0000-0000-000000032111';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000032111'), 'GC Neg Gym A Renamed',
  'positive control: the owner''s direct gym UPDATE landed (name changed)');
select is((select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032111'), true,
  'owner direct UPDATE of the flag is pinned to its old value');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032129","role":"authenticated","app_role":"super_admin"}', true);
update gyms set charge_guests_per_session = true, name = 'GC Neg Gym B Renamed' where id = '00000000-0000-0000-0000-000000032112';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000032112'), 'GC Neg Gym B Renamed',
  'positive control: the super admin direct gym UPDATE landed (name changed)');
select is((select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032112'), false,
  'a super admin direct UPDATE of the flag is pinned');

set local role service_role;
update gyms set charge_guests_per_session = true, name = 'GC Neg Gym B Service' where id = '00000000-0000-0000-0000-000000032112';
reset role;
select is((select name from gyms where id = '00000000-0000-0000-0000-000000032112'), 'GC Neg Gym B Service',
  'positive control: the service_role direct gym UPDATE landed (name changed)');
select is((select charge_guests_per_session from gyms where id = '00000000-0000-0000-0000-000000032112'), false,
  'a service_role direct UPDATE of the flag is pinned');

-- ============================================================================
-- update_plan_pricing(): role, suspension, lock, scope.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"receptionist"}', true);
select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032142', 'monthly', 13000, 30, 'monthly', null) $$,
  '%permission denied%', 'a receptionist cannot change plan pricing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"coach"}', true);
select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032142', 'monthly', 13000, 30, 'monthly', null) $$,
  '%permission denied%', 'a coach cannot change plan pricing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"member"}', true);
select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032142', 'monthly', 13000, 30, 'monthly', null) $$,
  '%permission denied%', 'a member cannot change plan pricing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032113","app_role":"owner"}', true);
select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032144', 'monthly', 9000, 30, 'monthly', null) $$,
  '%is not active%', 'a suspended gym cannot change plan pricing');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"manager"}', true);

select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032143', 'monthly', 1, 30, 'monthly', null) $$,
  '%plan_not_found%', 'a plan of another gym is not found');

select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032141', 'class_only', 15000, 30, 'monthly', null) $$,
  'plan_type_locked%', 'a type change on a plan with subscriptions is refused with plan_type_locked');

select throws_ok(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032141', 'class_only', 15000, 30, 'monthly', null) $$,
  '23514', null, 'plan_type_locked carries the check_violation SQLSTATE');

select throws_ok(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032142', 'pay_per_session', 2000, 30, 'monthly', null) $$,
  '23514', null, 'a type change with an incoherent shape is rejected by the 0017 CHECK');

select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032142', 'monthly', -5, 30, 'monthly', null) $$,
  '%invalid_input%', 'a negative price is rejected');

select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032141', 'monthly', 16000, 30, 'monthly', null, '   ') $$,
  '%invalid_input%', 'a blank name is rejected');

select throws_like(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032141', 'class_only', 15000, 30, 'monthly', null, 'Refused Rename') $$,
  'plan_type_locked%', 'a refused edit that carries a new name is still refused');

select lives_ok(
  $$ select update_plan_pricing('00000000-0000-0000-0000-000000032141', 'monthly', 16000, 30, 'monthly', null) $$,
  'positive control: a same-type price change on a plan with subscriptions succeeds');
reset role;

select isnt(
  (select name from plans where id = '00000000-0000-0000-0000-000000032141'),
  'Refused Rename',
  'the refused edit left the name unchanged');

select is(
  (select row(plan_type::text, price)::text from plans where id = '00000000-0000-0000-0000-000000032141'),
  '(monthly,16000)',
  'the locked plan kept its type and took the new price');

select is(
  (select row(plan_type::text, price)::text from plans where id = '00000000-0000-0000-0000-000000032142'),
  '(monthly,12000)',
  'the refused calls left the unused plan unchanged');

select is(
  (select count(*)::int from audit_log where action_type in ('plan_type_changed', 'plan_price_changed')),
  1,
  'only the successful price change was audited');

-- ============================================================================
-- Client writes to session payments and guest_sessions are rejected.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"manager"}', true);

select throws_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032136', 2000, 'XAF', 'cash', 'pending', 'session') $$,
  '42501', null, 'a direct client insert of a session payment is rejected by RLS');

select lives_ok(
  $$ insert into payments (gym_id, member_id, amount, currency, method, status, purpose)
     values ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032136', 15000, 'XAF', 'cash', 'pending', 'subscription') $$,
  'positive control: the same insert with purpose subscription is allowed');

select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032136',
             '00000000-0000-0000-0000-000000032199', now() + interval '7 days') $$,
  '42501', null, 'a client cannot insert a guest_sessions row');

select throws_ok($$ update guest_sessions set voided_at = now() $$, '42501', null, 'a client cannot update guest_sessions');
select throws_ok($$ delete from guest_sessions $$, '42501', null, 'a client cannot delete from guest_sessions');
reset role;

set local role service_role;
select throws_ok(
  $$ insert into guest_sessions (gym_id, member_id, loyalty_grant_id, usable_until)
     values ('00000000-0000-0000-0000-000000032111', '00000000-0000-0000-0000-000000032136',
             '00000000-0000-0000-0000-000000032199', now() + interval '7 days') $$,
  '42501', null, 'service_role cannot insert a guest_sessions row either');
reset role;

-- ============================================================================
-- platform_session_config
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000032121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000032111","app_role":"owner"}', true);
select is((select count(*)::int from platform_session_config), 0, 'a gym owner sees no config row');
update platform_session_config set paid_session_validity_days = 99;
select throws_ok(
  $$ insert into platform_session_config (paid_session_validity_days, free_session_validity_days, loyalty_idle_reset_days) values (1, 1, 1) $$,
  '42501', null, 'no client role can insert a second config row');
reset role;

select is((select paid_session_validity_days from platform_session_config), 7,
  'a gym owner''s UPDATE of the config touched nothing');

select throws_ok(
  $$ update platform_session_config set free_session_validity_days = 0 $$,
  '23514', null, 'a non-positive validity is rejected by the CHECK');

select throws_ok(
  $$ insert into platform_session_config (paid_session_validity_days, free_session_validity_days, loyalty_idle_reset_days) values (1, 1, 1) $$,
  '23505', null, 'even the table owner cannot create a second config row');

-- ============================================================================
-- anon cannot execute any of the new functions.
-- ============================================================================
select ok(
  not has_function_privilege('anon', 'public.set_guest_charging(boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.guest_charging_impact()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_plan_pricing(uuid, plan_type, integer, integer, billing_interval, integer, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.protect_charge_guests_per_session()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.protect_plan_type_and_price()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.audit_platform_session_config_update()', 'EXECUTE'),
  'anon holds EXECUTE on none of the new functions'
);

select * from finish();
rollback;
