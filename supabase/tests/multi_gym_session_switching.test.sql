-- Story 9.6: Multi-Gym Session Switching. Tests custom_access_token_hook()'s
-- new active_gym_id override/fallback logic, switch_active_gym()'s
-- validation, and the new "read gyms of own active memberships" RLS policy
-- (all 0065_multi_gym_session_switching.sql).
--
-- Session-simulation shape copied from auth_hook_canary.test.sql (direct hook
-- invocation as postgres, its owner) and multi_gym_staff_binding_rules.test.sql
-- (set_config-based authenticated-session simulation for RPC calls).
--
-- created_at is pinned explicitly on each membership row (rather than left to
-- its `now()` default) because Postgres's `now()` is constant for the whole
-- transaction -- every row inserted in this test would otherwise tie on
-- created_at, making the hook's "most recently created" fallback
-- non-deterministic (it would silently fall through to its id-desc tie-break
-- instead of the ordering this suite actually needs to prove).

begin;
select plan(16);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000030001', 'Session Switch Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000030011', 'Session Switch Gym A', '00000000-0000-0000-0000-000000030001', 30),
  ('00000000-0000-0000-0000-000000030012', 'Session Switch Gym B', '00000000-0000-0000-0000-000000030001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000030021'), -- multi-gym user: active at both Gym A and Gym B
  ('00000000-0000-0000-0000-000000030022'); -- single-gym user: active at Gym A only

-- Multi-gym user's Gym A binding is the OLDER row; Gym B is the NEWER row --
-- so the pre-existing "most recently created" fallback resolves to Gym B
-- unless active_gym_id overrides it.
insert into members (id, gym_id, user_id, role, name, created_at) values
  ('00000000-0000-0000-0000-000000030031', '00000000-0000-0000-0000-000000030011', '00000000-0000-0000-0000-000000030021', 'coach', 'Multi-Gym User (Gym A Coach)', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000030032', '00000000-0000-0000-0000-000000030012', '00000000-0000-0000-0000-000000030021', 'manager', 'Multi-Gym User (Gym B Manager)', now());

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000030033', '00000000-0000-0000-0000-000000030011', '00000000-0000-0000-0000-000000030022', 'member', 'Single-Gym User');

-- ============================================================================
-- (a) active_gym_id override: hook resolves to active_gym_id's gym/role when
-- set and still valid, even when a newer membership exists elsewhere --
-- proves override, not coincidence (Gym B is objectively the more-recent row).
-- ============================================================================

update users set active_gym_id = '00000000-0000-0000-0000-000000030011' where id = '00000000-0000-0000-0000-000000030021';

select is(
  (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'gym_id')::uuid,
  '00000000-0000-0000-0000-000000030011'::uuid,
  'active_gym_id override: hook resolves to the preferred Gym A, not the objectively more-recent Gym B'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'app_role',
  'coach',
  'active_gym_id override: hook resolves to Gym A''s role (coach), not Gym B''s (manager)'
);

-- ============================================================================
-- (b) NULL active_gym_id: hook falls back to most-recent-created -- the
-- pre-existing default behavior must not change for anyone who's never
-- switched.
-- ============================================================================

update users set active_gym_id = null where id = '00000000-0000-0000-0000-000000030021';

select is(
  (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'gym_id')::uuid,
  '00000000-0000-0000-0000-000000030012'::uuid,
  'NULL active_gym_id: hook falls back to the most-recently-created binding (Gym B), unchanged regression'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'app_role',
  'manager',
  'NULL active_gym_id: hook falls back to Gym B''s role (manager)'
);

-- ============================================================================
-- (c) Stale active_gym_id (points at a since-deactivated binding): graceful
-- fallback to most-recent-created, not deny-all. A stale preference must
-- never lock the user out.
-- ============================================================================

update users set active_gym_id = '00000000-0000-0000-0000-000000030011' where id = '00000000-0000-0000-0000-000000030021';
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000030031';

select is(
  (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'gym_id')::uuid,
  '00000000-0000-0000-0000-000000030012'::uuid,
  'stale active_gym_id (deactivated binding): hook gracefully falls back to Gym B, not deny-all'
);

select isnt(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' -> 'gym_id',
  'null'::jsonb,
  'stale active_gym_id: gym_id claim is present (not absent/deny-all) after graceful fallback'
);

-- Restore Gym A's membership to active and clear the stale preference, so the
-- RPC/RLS sections below start from a clean two-active-gyms state.
update members set deactivated_at = null where id = '00000000-0000-0000-0000-000000030031';
update users set active_gym_id = null where id = '00000000-0000-0000-0000-000000030021';

-- ============================================================================
-- (d) switch_active_gym(): succeeds and persists active_gym_id when the
-- caller holds an active binding at the target gym.
-- ============================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000030021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000030012","app_role":"manager"}',
  true
);

select lives_ok(
  $$select switch_active_gym('00000000-0000-0000-0000-000000030011')$$,
  'switch_active_gym(): succeeds when the caller holds an active binding at the target gym'
);

reset role;

select is(
  (select active_gym_id from users where id = '00000000-0000-0000-0000-000000030021'),
  '00000000-0000-0000-0000-000000030011'::uuid,
  'switch_active_gym(): persists active_gym_id to the target gym'
);

-- Hook now reflects the switch immediately (this is the exact mechanism
-- refreshSession() relies on app-side, verified hands-on in Task 1).
select is(
  (public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000030021',
      'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000030021', 'role', 'authenticated')
    )
  ) -> 'claims' ->> 'gym_id')::uuid,
  '00000000-0000-0000-0000-000000030011'::uuid,
  'switch_active_gym(): the hook immediately reflects the newly-chosen gym on next invocation'
);

-- ============================================================================
-- (e) switch_active_gym(): rejects when the caller has no active binding at
-- the target gym -- literal AC #4, server-side, not merely UI-hidden.
-- ============================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000030022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000030011","app_role":"member"}',
  true
);

select throws_like(
  $$select switch_active_gym('00000000-0000-0000-0000-000000030012')$$,
  '%switch_active_gym: caller has no active membership at target gym%',
  'switch_active_gym(): rejects a single-gym user attempting to switch to a gym they hold no binding at'
);

reset role;

select is(
  (select active_gym_id from users where id = '00000000-0000-0000-0000-000000030022'),
  null,
  'switch_active_gym(): the rejected caller''s active_gym_id is unchanged (still NULL)'
);

-- Also reject a deactivated-binding target directly via the RPC (not just the
-- hook's own graceful-fallback path above) -- deactivate Gym A's binding for
-- the multi-gym user again and confirm the RPC itself rejects a switch to it.
update members set deactivated_at = now() where id = '00000000-0000-0000-0000-000000030031';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000030021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000030011","app_role":"coach"}',
  true
);

select throws_like(
  $$select switch_active_gym('00000000-0000-0000-0000-000000030011')$$,
  '%switch_active_gym: caller has no active membership at target gym%',
  'switch_active_gym(): rejects a switch to a gym whose binding has since been deactivated'
);

reset role;

-- Restore for the RLS section below.
update members set deactivated_at = null where id = '00000000-0000-0000-0000-000000030031';

-- ============================================================================
-- (f) New gyms RLS policy: a multi-gym user can select every gym they hold
-- an active binding at (not just the claims-current one); a single-gym user
-- still sees exactly one -- literal AC #1's data-layer precondition.
-- ============================================================================

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000030021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000030011","app_role":"coach"}',
  true
);

select is(
  (select count(*)::int from gyms where id in ('00000000-0000-0000-0000-000000030011', '00000000-0000-0000-0000-000000030012')),
  2,
  'gyms RLS: a multi-gym user can read both gyms they hold active bindings at'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000030022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000030011","app_role":"member"}',
  true
);

select is(
  (select count(*)::int from gyms where id in ('00000000-0000-0000-0000-000000030011', '00000000-0000-0000-0000-000000030012')),
  1,
  'gyms RLS: a single-gym user sees exactly one of the two gyms (their own), not both'
);

select is(
  (select id from gyms where id in ('00000000-0000-0000-0000-000000030011', '00000000-0000-0000-0000-000000030012')),
  '00000000-0000-0000-0000-000000030011'::uuid,
  'gyms RLS: the one gym the single-gym user sees is their own (Gym A), not Gym B'
);

reset role;

-- ============================================================================
-- (g) Direct RPC call rejection is structural, not merely UI-hidden: confirm
-- the anon role (no session at all) cannot execute switch_active_gym() --
-- EXECUTE was revoked from public/anon in the migration.
-- ============================================================================

set local role anon;

select throws_ok(
  $$select switch_active_gym('00000000-0000-0000-0000-000000030011')$$,
  '42501',
  null,
  'switch_active_gym(): EXECUTE is revoked from anon -- structurally unreachable without an authenticated session'
);

reset role;

select * from finish();
rollback;
