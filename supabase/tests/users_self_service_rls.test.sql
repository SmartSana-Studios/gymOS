-- Story 1.10: Bilingual (EN/FR) Platform Foundation. New RLS policies from
-- 0015_users_self_service_language_preference.sql -- self_read_own_user,
-- self_update_own_language, plus the protect_self_managed_user_columns
-- trigger. Session-simulation conventions match dashboard_shell_self_read_rls.test.sql:
-- fixture rows seeded up front as the connecting role, then
-- `set local role authenticated` + `set_config('request.jwt.claims', ...)`
-- per simulated session. Cross-tenant-denial assertions use the CTE
-- `returning` pattern (rls_tenant_isolation.test.sql), not a follow-up
-- SELECT, which would return NULL from lack of RLS visibility rather than
-- proving denial (Story 1.9's Debug Log already hit this mistake once).

begin;
select plan(18);

-- `handle_new_user()` (0003_members_and_users.sql's `on_auth_user_created`
-- trigger) auto-inserts a bare `public.users` row on every `auth.users`
-- insert -- UPDATE the fixture fields onto that row rather than a second
-- INSERT, which would collide on the primary key.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000005021'), -- session A
  ('00000000-0000-0000-0000-000000005022'); -- session B

update users set phone = '+237600000021', display_name = 'User A', preferred_language = 'en', is_super_admin = false
  where id = '00000000-0000-0000-0000-000000005021';
update users set phone = '+237600000022', display_name = 'User B', preferred_language = 'en', is_super_admin = false
  where id = '00000000-0000-0000-0000-000000005022';

-- ============================================================================
-- Self-read: a session sees exactly its own users row, not another user's.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000005021","role":"authenticated"}',
  true
);

select is(
  (select count(*) from users where id = '00000000-0000-0000-0000-000000005021')::int, 1,
  'a session can SELECT its own users row'
);

select is(
  (select count(*) from users where id = '00000000-0000-0000-0000-000000005022')::int, 0,
  'a session cannot SELECT another user''s row'
);

-- ============================================================================
-- Self-update: a session can change its own preferred_language.
-- ============================================================================
with updated as (
  update users set preferred_language = 'fr'
  where id = '00000000-0000-0000-0000-000000005021'
  returning id
)
select is((select count(*) from updated)::int, 1, 'a session can UPDATE its own preferred_language');

select is(
  (select preferred_language from users where id = '00000000-0000-0000-0000-000000005021'),
  'fr',
  'the preferred_language change actually persisted'
);

-- ============================================================================
-- Column-guard trigger: a self-update that also tries to flip
-- is_super_admin/phone/created_at in the same statement is matched/returned
-- (the row update succeeds at the row level), but those three columns stay
-- pinned to their prior values -- protect_self_managed_user_columns fires
-- transparently, not as a rejected UPDATE. Asserted via a re-SELECT, since
-- the trigger's pin-back isn't visible in a plain RETURNING clause on its
-- own inputs. `display_name` is deliberately included in the same UPDATE
-- but is NOT pinned (Story 2.6 removed it from the trigger's deny-list --
-- MA-05 profile setup is the first code to self-write it) -- asserted below
-- as a positive "this now persists" case, not a regression.
-- ============================================================================
update users
set preferred_language = 'en', is_super_admin = true, phone = '+237699999999',
    display_name = 'Attempted Rename', created_at = now() + interval '1 year'
where id = '00000000-0000-0000-0000-000000005021';

select is(
  (select is_super_admin from users where id = '00000000-0000-0000-0000-000000005021'),
  false,
  'a self-update attempting to also set is_super_admin=true is silently pinned back to its prior value'
);

select is(
  (select phone from users where id = '00000000-0000-0000-0000-000000005021'),
  '+237600000021',
  'a self-update attempting to also change phone is silently pinned back to its prior value'
);

select is(
  (select display_name from users where id = '00000000-0000-0000-0000-000000005021'),
  'Attempted Rename',
  'Story 2.6: a self-update changing display_name now actually persists -- no longer pinned back'
);

-- photo_url (Story 2.6's other new self-writable column, alongside
-- display_name) was never in the trigger's pin-back list to begin with --
-- asserted explicitly rather than assumed, since member_onboarding_rls.test.sql
-- defers this exact coverage to this file (Review finding, 2026-07-17: that
-- claim was previously false -- no assertion here actually covered it).
update users set photo_url = 'https://example.com/photo.jpg'
where id = '00000000-0000-0000-0000-000000005021';

select is(
  (select photo_url from users where id = '00000000-0000-0000-0000-000000005021'),
  'https://example.com/photo.jpg',
  'Story 2.6: a self-update setting photo_url actually persists'
);

-- `now()` is frozen for the whole test transaction, so comparing directly
-- against `now()` would spuriously pass/fail depending on fixture-insert
-- timing -- compare against a bound well short of the "+1 year" value the
-- update attempted instead (same technique as Story 1.9's equivalent
-- created_at assertion, tiers_and_gym_lifecycle_rls.test.sql).
select ok(
  (select created_at from users where id = '00000000-0000-0000-0000-000000005021') < now() + interval '6 months',
  'a self-update attempting to also change created_at is silently pinned back to its prior value'
);

-- ============================================================================
-- Story 1.11: must_change_password defaults true, and a self-update can flip
-- it to false WITHOUT being reverted by protect_self_managed_user_columns
-- (0016_owner_must_change_password.sql added it to the trigger's allow-list
-- alongside preferred_language) -- this is the one regression this story
-- could most easily introduce silently, so it's asserted explicitly rather
-- than assumed.
-- ============================================================================
select is(
  (select must_change_password from users where id = '00000000-0000-0000-0000-000000005021'),
  true,
  'must_change_password defaults to true on insert'
);

with updated as (
  update users set must_change_password = false
  where id = '00000000-0000-0000-0000-000000005021'
  returning id
)
select is((select count(*) from updated)::int, 1, 'a session can UPDATE its own must_change_password');

select is(
  (select must_change_password from users where id = '00000000-0000-0000-0000-000000005021'),
  false,
  'the must_change_password change actually persisted -- not silently reverted by the trigger'
);

-- Regression check: the trigger's allow-list extension (Task 1) didn't
-- accidentally loosen the existing phone/is_super_admin protections when
-- the same statement also touches must_change_password. display_name is
-- intentionally excluded from this "still pinned" check (Story 2.6 -- see
-- above).
update users
set must_change_password = true, is_super_admin = true, phone = '+237699999998',
    display_name = 'Attempted Rename 2'
where id = '00000000-0000-0000-0000-000000005021';

select is(
  (select is_super_admin from users where id = '00000000-0000-0000-0000-000000005021'),
  false,
  'a self-update also setting is_super_admin=true alongside must_change_password is still pinned back'
);

select is(
  (select phone from users where id = '00000000-0000-0000-0000-000000005021'),
  '+237600000021',
  'a self-update also setting phone alongside must_change_password is still pinned back'
);

select is(
  (select display_name from users where id = '00000000-0000-0000-0000-000000005021'),
  'Attempted Rename 2',
  'Story 2.6: display_name still persists (not pinned) even alongside a must_change_password change'
);

-- ============================================================================
-- Cross-user: a session cannot UPDATE a different user's row at all (0 rows
-- affected via RETURNING, not an error).
-- ============================================================================
with updated as (
  update users set preferred_language = 'fr'
  where id = '00000000-0000-0000-0000-000000005022'
  returning id
)
select is((select count(*) from updated)::int, 0, 'a session cannot UPDATE a different user''s row');

-- ============================================================================
-- Story 1.12 AC #2 regression guard: provision-super-admin.mjs's promote
-- path does a service-role UPDATE ... SET is_super_admin = true against an
-- arbitrary user's row. protect_self_managed_user_columns's `auth.uid() =
-- new.id` guard (0015_users_self_service_language_preference.sql:32-46)
-- must never fire for it -- service_role has no request.jwt.claims / session
-- at all (auth.uid() is null, matching this suite's sibling convention,
-- audit_log_immutable.test.sql:36-38), unlike the `authenticated`-role
-- self-updates simulated above, which deliberately keep a `sub` claim to
-- prove the opposite (pinned-back) case. This is the one regression this
-- story could most easily ship silently: a future edit to that trigger
-- tightening its guard beyond the current check could break the CLI script
-- without any application-level test catching it.
-- ============================================================================
-- Clear the `sub` claim left over from the `authenticated`-role assertions
-- above (transaction-scoped via set_config's is_local=true, so it survives
-- the role switch on its own) -- a real service-role request never carries
-- a session/sub claim at all, and leaving the old one in place would let
-- `auth.uid() = new.id` spuriously evaluate true for this same user id,
-- masking the very case this regression guard exists to catch.
select set_config('request.jwt.claims', '{}', true);
set local role service_role;

with promoted as (
  update users set is_super_admin = true
  where id = '00000000-0000-0000-0000-000000005021'
  returning id
)
select is(
  (select count(*) from promoted)::int, 1,
  'a service-role UPDATE can set is_super_admin on an arbitrary user row'
);

select is(
  (select is_super_admin from users where id = '00000000-0000-0000-0000-000000005021'),
  true,
  'the service-role is_super_admin write actually persisted -- not reverted by protect_self_managed_user_columns'
);

select * from finish();
rollback;
