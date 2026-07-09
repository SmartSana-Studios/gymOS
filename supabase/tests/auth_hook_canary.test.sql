-- AC #2: "a known test tenant logs in... a pgTAP canary test asserts they see a
-- non-zero, correctly-scoped row count."
--
-- auth.jwt() reads current_setting('request.jwt.claims', true) (confirmed via
-- pg_get_functiondef on this local instance), so set_config(...) + `set local role`
-- is the correct way to simulate an authenticated session's JWT claims in pgTAP.

begin;
select plan(8);

-- Seed: one tier, two gyms, two auth users (triggers handle_new_user -> public.users),
-- one membership each, in different gyms.
insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000001', 'Canary Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-0000000000a1', 'Canary Gym A', '00000000-0000-0000-0000-000000000001', 30),
  ('00000000-0000-0000-0000-0000000000a2', 'Canary Gym B', '00000000-0000-0000-0000-000000000001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');

insert into members (id, gym_id, user_id, role, name) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'owner', 'User One'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'owner', 'User Two');

-- Exercise custom_access_token_hook() itself directly (as postgres, its owner, before
-- switching role below -- EXECUTE is revoked from authenticated/anon/public). Every
-- other assertion in this suite simulates the hook's *output* by hand-crafting
-- request.jwt.claims; these two instead prove the hook's own lookup/injection logic
-- produces that output for a real membership row.
select is(
  (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-0000000000b1',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'gym_id')::uuid,
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'custom_access_token_hook() itself injects the correct gym_id claim for user 1'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-0000000000b1',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'app_role',
  'owner',
  'custom_access_token_hook() itself injects the correct app_role claim for user 1'
);

-- User 1's session
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000a1","app_role":"owner"}',
  true
);

select lives_ok(
  $$ select private.gym_id() $$,
  'private.gym_id() does not raise a permission error as the authenticated role'
);

select is(
  private.gym_id(), '00000000-0000-0000-0000-0000000000a1'::uuid,
  'private.gym_id() resolves to the correct gym for user 1'
);

select is(
  (select count(*) from gyms)::int, 1,
  'user 1 sees exactly one gym (their own), not zero, not both -- literally AC #2'
);

select is(
  (select id from gyms limit 1), '00000000-0000-0000-0000-0000000000a1'::uuid,
  'the one gym user 1 sees is their own gym, not gym B'
);

-- User 2's session -- proves this is scoped per-session, not a fluke of seed order
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000a2","app_role":"owner"}',
  true
);

select is(
  (select count(*) from gyms)::int, 1,
  'user 2 also sees exactly one gym'
);

select is(
  (select id from gyms limit 1), '00000000-0000-0000-0000-0000000000a2'::uuid,
  'the one gym user 2 sees is gym B, not gym A -- cross-tenant isolation holds'
);

select * from finish();
rollback;
