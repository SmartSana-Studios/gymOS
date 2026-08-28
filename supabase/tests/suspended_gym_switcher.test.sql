-- Story 11.4 code review follow-up: list_own_active_gym_memberships()
-- (0074). Proves the exact gap this RPC closes -- a multi-gym staff
-- member/Owner whose *currently claimed* gym is suspended can still see
-- every gym they belong to (needed for the suspended screens' switcher),
-- even though the ordinary RLS-scoped `members` query is blocked for every
-- row while the session's current gym status isn't 'active'
-- (tenant_active_gate, 0073, gates on the caller's claimed gym, not each
-- row's own gym_id).

begin;
select plan(5);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000009971', 'Switcher Test Tier', 8000, 80000, 40);

insert into gyms (id, name, tier_id, status, saas_billing_status, capacity) values
  ('00000000-0000-0000-0000-000000009972', 'Switcher Test Gym (suspended)', '00000000-0000-0000-0000-000000009971', 'suspended', 'suspended', 30),
  ('00000000-0000-0000-0000-000000009973', 'Switcher Test Gym (active)', '00000000-0000-0000-0000-000000009971', 'active', 'active', 30),
  ('00000000-0000-0000-0000-000000009974', 'Switcher Test Gym (formerly worked at)', '00000000-0000-0000-0000-000000009971', 'active', 'active', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009981'), -- multi-gym user: manager at the suspended gym, owner at the active one
  ('00000000-0000-0000-0000-000000009982'); -- a different user, single-gym at the suspended gym (must not leak into the multi-gym user's result)

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0000-000000009991', '00000000-0000-0000-0000-000000009972', '00000000-0000-0000-0000-000000009981', 'manager', 'Multi-Gym User (suspended gym)', null),
  ('00000000-0000-0000-0000-000000009992', '00000000-0000-0000-0000-000000009973', '00000000-0000-0000-0000-000000009981', 'owner', 'Multi-Gym User (active gym)', null),
  ('00000000-0000-0000-0000-000000009993', '00000000-0000-0000-0000-000000009972', '00000000-0000-0000-0000-000000009982', 'owner', 'Single-Gym Owner', null),
  -- A deactivated binding at a third gym for the *same* multi-gym user --
  -- must not appear in the result (mirrors switch_active_gym()'s own
  -- deactivated_at is null guard).
  ('00000000-0000-0000-0000-000000009994', '00000000-0000-0000-0000-000000009974', '00000000-0000-0000-0000-000000009981', 'coach', 'Multi-Gym User (deactivated binding)', now());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009981","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009972","app_role":"manager"}',
  true
);

-- The point of this whole function: current_gym_status() for this session
-- is 'suspended' (the claimed gym), so a direct members query is fully
-- blocked -- confirms the premise the RPC exists to work around.
select is((select count(*) from members where user_id = '00000000-0000-0000-0000-000000009981')::int, 0, 'premise check: a direct members query is blocked for every row while the current claimed gym is suspended, even for the caller''s own row at the healthy second gym');

select is(
  (select count(*) from list_own_active_gym_memberships())::int,
  2,
  'list_own_active_gym_memberships() still returns both of the caller''s active memberships (suspended gym + healthy gym) despite the RLS block above'
);

select is(
  (select gym_id from list_own_active_gym_memberships() where gym_id = '00000000-0000-0000-0000-000000009973'),
  '00000000-0000-0000-0000-000000009973'::uuid,
  'the healthy second gym''s membership is present, with the correct gym_id -- this is the exact row the suspended screen''s switcher needs'
);

select is((select count(*) from list_own_active_gym_memberships() where gym_id = '00000000-0000-0000-0000-000000009974')::int, 0, 'the caller''s own deactivated binding at a third gym is excluded, matching switch_active_gym()''s deactivated_at is null guard');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009982","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000009972","app_role":"owner"}',
  true
);

select is(
  (select count(*) from list_own_active_gym_memberships())::int,
  1,
  'a different, single-gym caller only ever sees their own one membership row -- the multi-gym user''s rows above never leak in'
);

reset role;

select * from finish();
rollback;
