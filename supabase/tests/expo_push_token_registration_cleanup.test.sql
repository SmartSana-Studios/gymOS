-- Story 6.1: Expo Push Token Registration & Cleanup. Tests
-- `device_push_tokens` RLS (0042_expo_push_token_registration_cleanup.sql)
-- and `private.cleanup_invalid_device_push_token()`.
--
-- This is the first RLS test file in this codebase with no gym-scoping
-- dimension at all -- only `auth.users`/`users` rows are seeded (no
-- `gyms`/`members`/`tiers` fixtures needed), and sessions are simulated the
-- same way `coach_portal_member_detail_session_notes.test.sql` does, but
-- with only `sub`/`role` claims (no `gym_id`/`app_role` needed, since RLS
-- here never reads either). Cross-user-denial assertions use the CTE
-- `returning` pattern (`rls_tenant_isolation.test.sql`,
-- `users_self_service_rls.test.sql`), not a follow-up SELECT, which would
-- return zero rows from lack of RLS visibility rather than proving denial.
--
-- The cross-user privacy regression (section (g)) is this file's single
-- most important test, same weight every prior epic's central RLS test
-- carries -- a wrong policy here leaks one member's push token association
-- to another account's queries.

begin;
select plan(22);

-- `handle_new_user()` (0003_members_and_users.sql's `on_auth_user_created`
-- trigger) auto-inserts a bare `public.users` row on every `auth.users`
-- insert -- no separate `public.users` insert needed.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000016021'), -- User A
  ('00000000-0000-0000-0000-000000016022'); -- User B

-- ============================================================================
-- (a) As User A: insert own row succeeds, and is visible to their own SELECT.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000016021","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016021', 'ExponentPushToken[AAA111]', 'ios')$$,
  'User A can INSERT their own device_push_tokens row'
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021'),
  1,
  'User A''s own SELECT sees the row they just inserted'
);

-- ============================================================================
-- (b) As User B: insert own row succeeds (separate token).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000016022","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016022', 'ExponentPushToken[BBB222]', 'android')$$,
  'User B can INSERT their own device_push_tokens row'
);

-- ============================================================================
-- (c) As User A: cross-user denial -- cannot see, insert-as, update, or
-- select User B's row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000016021","role":"authenticated"}',
  true
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016022'),
  0,
  'User A cannot SELECT User B''s row, even scoped by user_id'
);

select throws_like(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016022', 'ExponentPushToken[CCC333]', 'ios')$$,
  '%row-level security%',
  'User A attempting to INSERT a row with user_id = User B''s id is denied (WITH CHECK failure)'
);

with attempted as (
  update device_push_tokens set platform = 'android'
  where user_id = '00000000-0000-0000-0000-000000016022'
  returning id
)
select is(
  (select count(*)::int from attempted), 0,
  'User A attempting to UPDATE User B''s row (by user_id) affects zero rows'
);

-- ============================================================================
-- (d) As User A: updating their own row succeeds; direct deletion is denied at
-- the table-privilege boundary. The only delete path is the cleanup function.
-- ============================================================================
with updated as (
  update device_push_tokens set platform = 'android'
  where user_id = '00000000-0000-0000-0000-000000016021'
  returning id
)
select is((select count(*)::int from updated), 1, 'User A can UPDATE their own row');

select is(
  (select platform from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021'),
  'android'::device_platform,
  'the platform change actually persisted'
);

select ok(
  not has_table_privilege('authenticated', 'public.device_push_tokens', 'DELETE'),
  'authenticated has no direct DELETE privilege on device_push_tokens'
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021'),
  1,
  'User A''s row remains available only to the service-role cleanup path'
);

-- ============================================================================
-- (e) (user_id, expo_push_token) upsert behavior: two `insert ... on conflict
-- do update` calls with the same pair leave exactly one row.
-- ============================================================================
select lives_ok(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016021', 'ExponentPushToken[AAA111]', 'android')
    on conflict (user_id, expo_push_token) do update
      set updated_at = '2000-01-01 00:00:00+00'::timestamptz$$,
  'a repeated upsert on the same (user_id, expo_push_token) pair does not raise'
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021' and expo_push_token = 'ExponentPushToken[AAA111]'),
  1,
  'the repeated upsert leaves exactly one row for the same (user_id, expo_push_token) pair'
);

-- The upsert explicitly attempts to write a stale timestamp. The BEFORE UPDATE
-- trigger must replace it, proving the trigger ran without relying on time
-- advancing inside this transaction (`now()` is transaction-stable).
select ok(
  (select updated_at > '2000-01-01 00:00:00+00'::timestamptz from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021' and expo_push_token = 'ExponentPushToken[AAA111]'),
  'the updated_at trigger replaces an explicitly stale timestamp during upsert'
);

-- ============================================================================
-- (f) device_platform enum: inserting a value outside ('ios', 'android') fails.
-- ============================================================================
select throws_like(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016021', 'ExponentPushToken[DDD444]', 'windows')$$,
  '%invalid input value for enum device_platform%',
  'inserting a platform value outside (''ios'', ''android'') fails'
);

reset role;

-- ============================================================================
-- (g) private.cleanup_invalid_device_push_token(): called as service_role
-- (matching how other private-schema SECURITY DEFINER functions are
-- exercised in this codebase's test files), deletes the matching row
-- regardless of which user owns it -- this is the actual point of the
-- function. A call with a non-matching token is a no-op.
-- ============================================================================
set local role service_role;

select lives_ok(
  $$select private.cleanup_invalid_device_push_token('ExponentPushToken[BBB222]')$$,
  'private.cleanup_invalid_device_push_token() does not raise when called by service_role against a token owned by a different user (User B)'
);

select is(
  (select count(*)::int from device_push_tokens where expo_push_token = 'ExponentPushToken[BBB222]'),
  0,
  'private.cleanup_invalid_device_push_token() deleted User B''s row even though the caller is not User B'
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021'),
  1,
  'User A''s unrelated row is untouched by the cleanup call targeting User B''s token'
);

select lives_ok(
  $$select private.cleanup_invalid_device_push_token('ExponentPushToken[does-not-exist]')$$,
  'private.cleanup_invalid_device_push_token() does not raise for a non-matching token'
);

select is(
  (select count(*)::int from device_push_tokens),
  1,
  'private.cleanup_invalid_device_push_token() is a true no-op for a non-matching token -- row count unchanged'
);

reset role;

-- ============================================================================
-- (h) Cross-user privacy regression (this file's single most important
-- test): re-seed both users' tokens, confirm each session's SELECT never
-- returns the other's row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000016022","role":"authenticated"}',
  true
);
select lives_ok(
  $$insert into device_push_tokens (user_id, expo_push_token, platform)
    values ('00000000-0000-0000-0000-000000016022', 'ExponentPushToken[EEE555]', 'ios')$$,
  'User B can re-insert a fresh token after the cleanup test above'
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016021'),
  0,
  'FR-055-equivalent regression: User B''s own query sees zero rows for User A''s row'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000016021","role":"authenticated"}',
  true
);

select is(
  (select count(*)::int from device_push_tokens where user_id = '00000000-0000-0000-0000-000000016022'),
  0,
  'the reverse holds too: User A''s own query sees zero rows for User B''s row'
);

reset role;
select * from finish();
rollback;
