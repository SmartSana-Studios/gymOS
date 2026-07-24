-- Story 3.3: QR Code Generation & Gym Token Validation. No new migration or
-- RLS policy is added by this story (Scope Note #3) -- the mobile app's
-- "wrong QR" detection relies entirely on the pre-existing "read own gym"
-- policy (0009_auth_hook_gym_claims.sql), which already scopes any SELECT
-- against `gyms` to `id = private.gym_id()` regardless of any other filter
-- in the query. This file proves that scoping alone gives the mobile
-- client the exact behavior AC #2 needs: a member session querying by its
-- own gym's real token gets a match, and querying by *any* other token --
-- whether it belongs to a real, different gym or to no gym at all --
-- returns zero rows, indistinguishably. Session-simulation convention
-- matches gym_settings_rls.test.sql.

begin;
select plan(4);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000006001', 'Checkin Token Test Tier', 5000, 50000, 30);

-- Explicit gym_token literals (overriding the default gen_random_uuid())
-- so the assertions below can compare against known values directly,
-- instead of re-querying gym_token through a subquery that would itself be
-- subject to the same RLS policy under test -- see the Gym B assertion.
insert into gyms (id, name, tier_id, capacity, gym_token) values
  ('00000000-0000-0000-0000-000000006011', 'Checkin Token Gym A', '00000000-0000-0000-0000-000000006001', 30, '11111111-1111-1111-1111-111111111111'),
  ('00000000-0000-0000-0000-000000006012', 'Checkin Token Gym B', '00000000-0000-0000-0000-000000006001', 30, '22222222-2222-2222-2222-222222222222');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000006021'); -- Gym A member

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000006031', '00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006021', 'member', 'Gym A Member');

-- ============================================================================
-- A Gym-A-member session querying by Gym A's own real gym_token gets
-- exactly 1 row -- the mobile client's "match" case.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from gyms where gym_token = '11111111-1111-1111-1111-111111111111'),
  1,
  'a member session querying by its own gym''s real gym_token gets exactly 1 row'
);

-- ============================================================================
-- Sanity check: Gym B's seeded gym_token is genuinely in place, verified as
-- the connecting role (bypassing RLS) -- so the next assertion's "0 rows"
-- result can only be explained by RLS scoping, not by the token literal
-- being wrong.
-- ============================================================================
reset role;
select is(
  (select count(*)::int from gyms where gym_token = '22222222-2222-2222-2222-222222222222'),
  1,
  'sanity check: Gym B''s seeded gym_token genuinely exists (verified as the connecting role, bypassing RLS)'
);

-- ============================================================================
-- The same Gym-A session querying by Gym B's real (but foreign) gym_token
-- gets 0 rows -- RLS hides Gym B's row entirely, regardless of the token
-- matching. Uses Gym B's token as a literal (seeded above) rather than a
-- subquery against `gyms`, since that subquery would itself run under the
-- Gym-A session's RLS scope and always return NULL -- which would make
-- this assertion vacuously true regardless of whether cross-tenant scoping
-- actually works.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000006021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000006011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from gyms where gym_token = '22222222-2222-2222-2222-222222222222'),
  0,
  'the same session querying by Gym B''s real, foreign gym_token gets 0 rows -- not distinguishable from a nonexistent token'
);

-- ============================================================================
-- The same session querying by a syntactically-plausible but nonexistent
-- token also gets 0 rows -- proves the "foreign real token" and "garbage
-- token" cases are indistinguishable from this session's point of view.
-- ============================================================================
select is(
  (select count(*)::int from gyms where gym_token = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  0,
  'the same session querying by a nonexistent gym_token gets 0 rows'
);

select * from finish();
rollback;
