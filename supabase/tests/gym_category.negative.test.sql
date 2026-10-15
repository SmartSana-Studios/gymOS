-- Story 21.1: gym category (migration 0123), denial paths. Positive paths:
-- gym_category.test.sql.
--
-- Every denial is followed by a read-back proving nothing changed. The
-- suspended gym is seeded suspended in its INSERT (a bare UPDATE of
-- gyms.status is silently reverted).
--
-- Fixture ids: 00000000-0000-0000-0000-0000002102xx.

begin;
select plan(18);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000210201', 'Category Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, category) values
  ('00000000-0000-0000-0000-000000210211', 'Cat Neg Gym A',         '00000000-0000-0000-0000-000000210201', 'active',    'gym'),
  ('00000000-0000-0000-0000-000000210212', 'Cat Neg Gym B',         '00000000-0000-0000-0000-000000210201', 'active',    'gym'),
  ('00000000-0000-0000-0000-000000210213', 'Cat Neg Gym Suspended', '00000000-0000-0000-0000-000000210201', 'suspended', 'gym');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000210221'), -- owner A
  ('00000000-0000-0000-0000-000000210222'), -- manager A
  ('00000000-0000-0000-0000-000000210223'), -- receptionist A
  ('00000000-0000-0000-0000-000000210224'), -- coach A
  ('00000000-0000-0000-0000-000000210225'), -- member A
  ('00000000-0000-0000-0000-000000210226'), -- owner B
  ('00000000-0000-0000-0000-000000210227'), -- owner of the suspended gym
  ('00000000-0000-0000-0000-000000210228'); -- super admin

update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000210228';

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000210231', '00000000-0000-0000-0000-000000210211', '00000000-0000-0000-0000-000000210221', 'owner',        'CatN Owner A',        current_date),
  ('00000000-0000-0000-0000-000000210232', '00000000-0000-0000-0000-000000210211', '00000000-0000-0000-0000-000000210222', 'manager',      'CatN Manager A',      current_date),
  ('00000000-0000-0000-0000-000000210233', '00000000-0000-0000-0000-000000210211', '00000000-0000-0000-0000-000000210223', 'receptionist', 'CatN Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000210234', '00000000-0000-0000-0000-000000210211', '00000000-0000-0000-0000-000000210224', 'coach',        'CatN Coach A',        current_date),
  ('00000000-0000-0000-0000-000000210235', '00000000-0000-0000-0000-000000210211', '00000000-0000-0000-0000-000000210225', 'member',       'CatN Member A',       current_date),
  ('00000000-0000-0000-0000-000000210236', '00000000-0000-0000-0000-000000210212', '00000000-0000-0000-0000-000000210226', 'owner',        'CatN Owner B',        current_date),
  ('00000000-0000-0000-0000-000000210237', '00000000-0000-0000-0000-000000210213', '00000000-0000-0000-0000-000000210227', 'owner',        'CatN Owner Suspended', current_date);

-- ============================================================================
-- Roles that may not set the category.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"manager"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'a manager is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"receptionist"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'a front desk receptionist is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"coach"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'a coach is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"member"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'a member is refused');

-- Staff of another gym, naming this gym.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210212","app_role":"owner"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'the owner of another gym is refused');

-- No gym-scoped session and not a super admin.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210221","role":"authenticated"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'a caller with no gym claim is refused');

-- A forged super_admin claim is not enough: the check is a live users read.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"super_admin"}', true);
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  'P0001', 'permission denied', 'an app_role claim of super_admin without users.is_super_admin is refused');

-- Suspended gym: its own owner is refused.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210227","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210213","app_role":"owner"}', true);
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210213', 'yoga_studio') $$,
  '%is not active%', 'the owner of a suspended gym is refused');

-- ============================================================================
-- Invalid values, by an allowed caller.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000210211","app_role":"owner"}', true);
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'spa') $$,
  '%invalid_category%', 'an unknown code is refused');
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'Gym') $$,
  '%invalid_category%', 'a label (wrong case) is not a code');
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', null) $$,
  '%invalid_category%', 'a null category is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000210228","role":"authenticated","app_role":"super_admin"}', true);
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'spa') $$,
  '%invalid_category%', 'an unknown code is refused for a super admin too');
select throws_like(
  $$ select set_gym_category('00000000-0000-0000-0000-0000002102ff', 'gym') $$,
  '%gym not found%', 'an unknown gym id is refused for a super admin');
select throws_like(
  $$ select set_gym_category(null, 'gym') $$,
  '%gym not found%', 'a null gym id is refused for a super admin');

-- Anonymous callers cannot reach the function at all.
reset role;
set local role anon;
select throws_ok(
  $$ select set_gym_category('00000000-0000-0000-0000-000000210211', 'yoga_studio') $$,
  '42501', null, 'anon has no EXECUTE on set_gym_category');
reset role;

-- ============================================================================
-- Nothing changed, nothing audited.
-- ============================================================================
select is(
  (select count(*)::int from gyms where id in (
     '00000000-0000-0000-0000-000000210211',
     '00000000-0000-0000-0000-000000210212',
     '00000000-0000-0000-0000-000000210213') and category <> 'gym'),
  0,
  'every refusal left every category at gym'
);

select is(
  (select count(*)::int from audit_log where action_type = 'gym_category_changed'),
  0,
  'no refusal wrote an audit row'
);

select ok(
  not exists (
    select 1 from pg_proc p
    where p.proname = 'set_gym_category'
      and pg_get_functiondef(p.oid) like '%app_role%'
  ),
  'set_gym_category never reads the JWT app_role claim (19.1 lint)'
);

select * from finish();
rollback;
