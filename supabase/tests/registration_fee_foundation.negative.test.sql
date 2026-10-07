-- Story 18.1: registration fee foundation (migration 0098), denial paths.
-- Positive paths: registration_fee_foundation.test.sql.
--
-- Every denial is paired with a positive control (a write in the same
-- statement or session that DOES land), because the pins revert silently:
-- an unchanged value would otherwise be indistinguishable from a statement
-- that never ran.
--
-- The suspended gym is seeded suspended in its INSERT -- a bare UPDATE of
-- gyms.status is silently reverted by protect_super_admin_only_gym_columns.
--
-- Fixture ids: 00000000-0000-0000-0000-0000000311xx.

begin;
select plan(26);

insert into tiers (id, name, monthly_price, annual_price, member_cap) values
  ('00000000-0000-0000-0000-000000031101', 'RegFee Neg Tier', 6000, 60000, null);

insert into gyms (id, name, tier_id, status, registration_fee) values
  ('00000000-0000-0000-0000-000000031111', 'RegFee Neg Gym A',         '00000000-0000-0000-0000-000000031101', 'active',    5000),
  ('00000000-0000-0000-0000-000000031112', 'RegFee Neg Gym B',         '00000000-0000-0000-0000-000000031101', 'active',    7000),
  ('00000000-0000-0000-0000-000000031113', 'RegFee Neg Gym Suspended', '00000000-0000-0000-0000-000000031101', 'suspended', 3000);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000031121'), -- owner A
  ('00000000-0000-0000-0000-000000031122'), -- supervisor A
  ('00000000-0000-0000-0000-000000031123'), -- manager A
  ('00000000-0000-0000-0000-000000031124'), -- receptionist A
  ('00000000-0000-0000-0000-000000031125'), -- coach A
  ('00000000-0000-0000-0000-000000031126'), -- awaiting member A
  ('00000000-0000-0000-0000-000000031127'), -- owner B
  ('00000000-0000-0000-0000-000000031128'), -- owner of suspended gym
  ('00000000-0000-0000-0000-000000031129'), -- super admin
  ('00000000-0000-0000-0000-00000003112a'); -- member inserted by manager

insert into members (id, gym_id, user_id, role, name, join_date) values
  ('00000000-0000-0000-0000-000000031131', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031121', 'owner',        'Neg Owner A',        current_date),
  ('00000000-0000-0000-0000-000000031132', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031122', 'supervisor',   'Neg Supervisor A',   current_date),
  ('00000000-0000-0000-0000-000000031133', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031123', 'manager',      'Neg Manager A',      current_date),
  ('00000000-0000-0000-0000-000000031134', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031124', 'receptionist', 'Neg Receptionist A', current_date),
  ('00000000-0000-0000-0000-000000031135', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031125', 'coach',        'Neg Coach A',        current_date),
  ('00000000-0000-0000-0000-000000031136', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-000000031126', 'member',       'Neg Awaiting Member', current_date),
  ('00000000-0000-0000-0000-000000031137', '00000000-0000-0000-0000-000000031112', '00000000-0000-0000-0000-000000031127', 'owner',        'Neg Owner B',        current_date),
  ('00000000-0000-0000-0000-000000031138', '00000000-0000-0000-0000-000000031113', '00000000-0000-0000-0000-000000031128', 'owner',        'Neg Owner Suspended', current_date);

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031136'),
  null,
  'fixture sanity: the member of fee gym A is awaiting'
);

-- ============================================================================
-- Schema constraint.
-- ============================================================================
select throws_ok(
  $$ insert into gyms (id, name, tier_id, registration_fee)
     values ('00000000-0000-0000-0000-000000031119', 'Negative Fee Gym', '00000000-0000-0000-0000-000000031101', -1) $$,
  '23514',
  null,
  'gyms.registration_fee rejects a negative amount at the column'
);

-- ============================================================================
-- set_registration_fee(): role matrix.
-- ============================================================================
set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"manager"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'a manager cannot set the registration fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031124","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"receptionist"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'a receptionist cannot set the registration fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031125","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"coach"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'a coach cannot set the registration fee');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"member"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'a member cannot set the registration fee');

-- No gym-scoped session at all.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031121","role":"authenticated","app_role":"owner"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'an owner claim with no gym_id cannot set the registration fee');

-- gym_id present but NO app_role claim: the role comparison is NULL, which
-- must fail closed rather than skip the raise.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%permission denied%', 'a claim with a gym_id but no app_role cannot set the registration fee');

-- Amount validation, positive control for the role gate (owner passes it).
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"owner"}', true);
select throws_like($$ select set_registration_fee(-1) $$, '%invalid_amount%', 'a negative amount is rejected');
select throws_like($$ select set_registration_fee(null) $$, '%invalid_amount%', 'a NULL amount is rejected');

-- Cross-gym: the RPC takes no gym argument; owner A changes only gym A.
select lives_ok($$ select set_registration_fee(6000) $$, 'positive control: owner A can set the fee');

-- Suspended gym.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031128","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031113","app_role":"owner"}', true);
select throws_like($$ select set_registration_fee(1000) $$, '%is not active%', 'a suspended gym cannot change its fee');

reset role;

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031112'),
  7000,
  'cross-gym: owner A''s change did not touch gym B'
);

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031113'),
  3000,
  'the suspended gym''s fee is unchanged'
);

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031111'),
  6000,
  'only the permitted owner call changed gym A (denied callers left 5000 -> 6000 as the single change)'
);

-- ============================================================================
-- Direct writes are pinned.
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031121","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"owner"}', true);

update gyms set registration_fee = 99999, name = 'Neg Gym A Renamed' where id = '00000000-0000-0000-0000-000000031111';

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000031111'),
  'Neg Gym A Renamed',
  'positive control: the owner''s direct gym UPDATE did land (name changed)'
);
select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031111'),
  6000,
  'owner direct UPDATE of gyms.registration_fee is pinned to its old value'
);

-- Super admin is pinned too: set_registration_fee is the only write path.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031129","role":"authenticated","app_role":"super_admin"}', true);
update gyms set registration_fee = 88888, name = 'Neg Gym B Renamed' where id = '00000000-0000-0000-0000-000000031112';
reset role;

select is(
  (select name from gyms where id = '00000000-0000-0000-0000-000000031112'),
  'Neg Gym B Renamed',
  'positive control: the super admin direct gym UPDATE did land (name changed)'
);

select is(
  (select registration_fee from gyms where id = '00000000-0000-0000-0000-000000031112'),
  7000,
  'a super admin direct UPDATE of gyms.registration_fee is pinned as well'
);

-- Staff direct write of the members column (manager policy covers role=member rows).
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"manager"}', true);

update members set registration_fee_settled_at = now(), name = 'Neg Awaiting Renamed'
where id = '00000000-0000-0000-0000-000000031136';

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000031136'),
  'Neg Awaiting Renamed',
  'positive control: the manager''s direct members UPDATE did land (name changed)'
);
select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031136'),
  null,
  'a manager cannot settle a member by direct UPDATE'
);

-- Manager INSERT of a member while the fee is on: client-supplied value ignored.
insert into members (id, gym_id, user_id, role, name, join_date, registration_fee_settled_at)
values ('00000000-0000-0000-0000-000000031139', '00000000-0000-0000-0000-000000031111', '00000000-0000-0000-0000-00000003112a', 'member', 'Neg Manager Created', current_date, now());

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031139'),
  null,
  'a manager-inserted member awaits even when the INSERT supplied a settled value'
);

-- Self-update by the awaiting member.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031126","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"member"}', true);

update members set registration_fee_settled_at = now(), goal = 'get strong'
where user_id = '00000000-0000-0000-0000-000000031126' and gym_id = '00000000-0000-0000-0000-000000031111';

select is(
  (select goal from members where id = '00000000-0000-0000-0000-000000031136'),
  'get strong',
  'positive control: the member''s own onboarding-field UPDATE did land'
);
select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031136'),
  null,
  'a member cannot settle themselves by direct UPDATE'
);

reset role;

-- The pin is keyed on the calling role, so a SECURITY DEFINER function called
-- from an authenticated session must still be able to write the column (the
-- path 18.2-18.4's RPCs will use). A throwaway definer function proves it
-- end to end, called under a manager JWT for an awaiting member.
create function pg_temp.settle_for_test(p_member_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update members set registration_fee_settled_at = now() where id = p_member_id;
end;
$$;
grant execute on function pg_temp.settle_for_test(uuid) to authenticated;

select is(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031136'),
  null,
  'precondition: the member is still awaiting before the definer write'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000031123","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000031111","app_role":"manager"}', true);
select pg_temp.settle_for_test('00000000-0000-0000-0000-000000031136');
reset role;

select isnt(
  (select registration_fee_settled_at from members where id = '00000000-0000-0000-0000-000000031136'),
  null,
  'a SECURITY DEFINER function called from an authenticated manager session can write registration_fee_settled_at (not pinned)'
);

select * from finish();
rollback;
