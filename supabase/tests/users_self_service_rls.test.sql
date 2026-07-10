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
select plan(7);

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
-- is_super_admin/phone in the same statement is matched/returned (the row
-- update succeeds at the row level), but those two columns stay pinned to
-- their prior values -- protect_self_managed_user_columns fires
-- transparently, not as a rejected UPDATE. Asserted via a re-SELECT, since
-- the trigger's pin-back isn't visible in a plain RETURNING clause on its
-- own inputs.
-- ============================================================================
update users
set preferred_language = 'en', is_super_admin = true, phone = '+237699999999'
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

select * from finish();
rollback;
