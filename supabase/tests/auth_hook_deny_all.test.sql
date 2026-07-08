-- AC #3: "the claims hook is misconfigured or a claim is missing... access defaults
-- to deny-all (fails closed)." Covers both a missing gym_id claim and a malformed one.

begin;
select plan(8);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000002', 'Hustle', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000c1', 'Deny-All Gym', '00000000-0000-0000-0000-000000000002', 30);

-- Case 1: claims present, but no gym_id/app_role key at all (e.g. a user with no
-- active membership -- the hook leaves the claim absent, not the hook being "off").
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select private.gym_id() $$,
  'private.gym_id() does not raise when the gym_id claim is entirely absent'
);

select is(
  private.gym_id(), null,
  'private.gym_id() returns NULL when the gym_id claim is absent'
);

select lives_ok(
  $$ select * from gyms $$,
  'querying gyms does not raise when gym_id claim is absent'
);

select is(
  (select count(*) from gyms)::int, 0,
  'no gym_id claim -> 0 rows visible, not an error (fails closed)'
);

-- Case 2: claims present with a malformed (non-UUID) gym_id value.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","gym_id":"not-a-valid-uuid","app_role":"owner"}',
  true
);

select lives_ok(
  $$ select private.gym_id() $$,
  'private.gym_id() does not raise on a malformed gym_id claim'
);

select is(
  private.gym_id(), null,
  'private.gym_id() returns NULL (not an error) for a malformed gym_id claim'
);

select lives_ok(
  $$ select * from gyms $$,
  'querying gyms does not raise when gym_id claim is malformed'
);

select is(
  (select count(*) from gyms)::int, 0,
  'malformed gym_id claim -> 0 rows visible, not an error (fails closed)'
);

select * from finish();
rollback;
