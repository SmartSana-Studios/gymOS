-- Story 28.1: session validity setting (migration 0177), denial paths. Positive paths: session_validity.test.sql.
--
-- Every denial is followed by a read-back proving nothing changed. The suspended gym is seeded suspended in its INSERT (a bare UPDATE of
-- gyms.status is silently reverted).
--
-- Fixture ids: 00000000-0000-0000-0000-0000002802xx.

begin;
select plan(22);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000280201', 'Validity Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000280211', 'Val Neg Gym A', '00000000-0000-0000-0000-000000280201', 'active'),
  ('00000000-0000-0000-0000-000000280212', 'Val Neg Gym B', '00000000-0000-0000-0000-000000280201', 'active');
insert into gyms (id, name, tier_id, status) values
  ('00000000-0000-0000-0000-000000280213', 'Val Neg Gym Suspended', '00000000-0000-0000-0000-000000280201', 'suspended');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000280221'), -- owner A
  ('00000000-0000-0000-0000-000000280222'), -- manager A
  ('00000000-0000-0000-0000-000000280223'), -- receptionist A
  ('00000000-0000-0000-0000-000000280224'), -- coach A
  ('00000000-0000-0000-0000-000000280225'), -- member A
  ('00000000-0000-0000-0000-000000280226'), -- owner B
  ('00000000-0000-0000-0000-000000280227'), -- owner of the suspended gym
  ('00000000-0000-0000-0000-000000280228'), -- super admin
  ('00000000-0000-0000-0000-000000280229'); -- deactivated owner A2 (null role)

update users set is_super_admin = true where id = '00000000-0000-0000-0000-000000280228';

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000280231', '00000000-0000-0000-0000-000000280211', '00000000-0000-0000-0000-000000280221', 'owner',        'ValN Owner A',         current_date),
  ('00000000-0000-0000-0000-000000280232', '00000000-0000-0000-0000-000000280211', '00000000-0000-0000-0000-000000280222', 'manager',      'ValN Manager A',       current_date),
  ('00000000-0000-0000-0000-000000280233', '00000000-0000-0000-0000-000000280211', '00000000-0000-0000-0000-000000280223', 'receptionist', 'ValN Receptionist A',  current_date),
  ('00000000-0000-0000-0000-000000280234', '00000000-0000-0000-0000-000000280211', '00000000-0000-0000-0000-000000280224', 'coach',        'ValN Coach A',         current_date),
  ('00000000-0000-0000-0000-000000280235', '00000000-0000-0000-0000-000000280211', '00000000-0000-0000-0000-000000280225', 'member',       'ValN Member A',        current_date),
  ('00000000-0000-0000-0000-000000280236', '00000000-0000-0000-0000-000000280212', '00000000-0000-0000-0000-000000280226', 'owner',        'ValN Owner B',         current_date),
  ('00000000-0000-0000-0000-000000280237', '00000000-0000-0000-0000-000000280213', '00000000-0000-0000-0000-000000280227', 'owner',        'ValN Owner Suspended', current_date);

-- ============================================================================
-- Roles that may not set it.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280222","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"manager"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a manager is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280223","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"receptionist"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a receptionist is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280224","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"coach"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a coach is refused');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"member"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a member is refused');

-- Staff of another gym, naming this gym.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280226","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280212","app_role":"owner"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'the owner of another gym naming this gym is refused');

-- No gym-scoped session, not a super admin.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280221","role":"authenticated"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a caller with no gym claim is refused');

-- A caller whose membership no longer exists: the claims name a gym and a role, but private.current_member_role() is null.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280229","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"owner"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a caller with a null role (claims of an owner, no live membership) is refused');

-- Super Admin: refused (A4), with and without a gym id of their own.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280228","role":"authenticated","app_role":"super_admin"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a super admin is refused (assumption A4)');
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280213', 'single_use') $$,
  'P0001', 'permission denied', 'a super admin is refused for a suspended gym too');

-- A forged super_admin claim changes nothing.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280225","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"super_admin"}', true);
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  'P0001', 'permission denied', 'a forged super_admin claim is refused');

-- Suspended gym: its own owner is refused.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280227","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280213","app_role":"owner"}', true);
select throws_like(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280213', 'single_use') $$,
  '%is not active%', 'the owner of a suspended gym is refused');

-- ============================================================================
-- Invalid values, by an allowed caller.
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000280221","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000280211","app_role":"owner"}', true);
select throws_like(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'weekly') $$,
  '%invalid_session_validity%', 'an unknown code is refused');
select throws_like(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'Single use') $$,
  '%invalid_session_validity%', 'a label is not a code');
select throws_like(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', null) $$,
  '%invalid_session_validity%', 'a null value is refused');
select throws_ok(
  $$ select set_session_validity(null, 'single_use') $$,
  'P0001', 'permission denied', 'a null gym id is refused');
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-0000002802ff', 'single_use') $$,
  'P0001', 'permission denied', 'an unknown gym id is refused (it is not the caller''s gym)');

-- Anonymous callers cannot reach either function at all.
reset role;
set local role anon;
select throws_ok(
  $$ select set_session_validity('00000000-0000-0000-0000-000000280211', 'single_use') $$,
  '42501', null, 'anon has no EXECUTE on set_session_validity');
select throws_ok(
  $$ select * from get_session_validity_settings() $$,
  '42501', null, 'anon has no EXECUTE on get_session_validity_settings');
reset role;

-- ============================================================================
-- Nothing changed, nothing audited.
-- ============================================================================
select is(
  (select count(*)::int from gyms where id in (
     '00000000-0000-0000-0000-000000280211',
     '00000000-0000-0000-0000-000000280212',
     '00000000-0000-0000-0000-000000280213') and session_validity <> 'whole_day'),
  0,
  'every refusal left every gym at whole_day'
);

select is(
  (select count(*)::int from audit_log where action_type = 'session_validity_changed'),
  0,
  'no refusal wrote an audit row'
);

select ok(
  not exists (
    select 1 from pg_proc p
    where p.proname in ('set_session_validity', 'get_session_validity_settings')
      and pg_get_functiondef(p.oid) like '%app_role%'
  ),
  'neither function reads the JWT app_role claim (19.1 lint)'
);

select ok(
  not exists (
    select 1 from pg_proc p
    where p.proname = 'set_session_validity'
      and pg_get_functiondef(p.oid) like '%is_super_admin%'
  ),
  'set_session_validity has no Super Admin branch (A4)'
);

select * from finish();
rollback;
