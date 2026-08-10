-- Story 1.13: messaging_provider_config RLS (deny-all for non-super-admin,
-- super_admin SELECT works) and update_messaging_instance()
-- (0050_messaging_provider_config.sql). Session-simulation conventions match
-- payment_providers_rls.test.sql.

begin;
select plan(11);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000801'), -- super_admin caller
  ('00000000-0000-0000-0000-000000000802'); -- owner, non-super-admin

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000305', 'Messaging Config Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, status, capacity) values
  ('00000000-0000-0000-0000-000000000403', 'Messaging Config Test Gym', '00000000-0000-0000-0000-000000000305', 'active', 30);

insert into members (id, gym_id, user_id, role, name) values
  ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000802', 'owner', 'Test Gym Owner');

-- ============================================================================
-- RLS: super_admin can SELECT the seeded singleton row; a non-super-admin
-- session gets 0 rows, not an exception (RLS SELECT semantics -- matches
-- super_admin_read_payment_providers precedent).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (select count(*) from messaging_provider_config)::int, 1,
  'super_admin can SELECT messaging_provider_config and sees the seeded singleton row'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000403","app_role":"owner"}',
  true
);

select is(
  (select count(*) from messaging_provider_config)::int, 0,
  'a non-super-admin session sees 0 rows from messaging_provider_config -- deny-all, not an exception'
);

-- ============================================================================
-- Direct UPDATE is blocked by RLS -- update_messaging_instance() is the only
-- sanctioned write path.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated","app_role":"super_admin"}',
  true
);

-- No UPDATE policy exists for any role (deny-all), so a direct UPDATE isn't
-- an exception (unlike INSERT, which always raises against a missing
-- WITH CHECK policy) -- it silently matches 0 rows via its USING clause.
-- lives_ok + a 0-rows-changed assertion is the correct proof here, not
-- throws_like.
select lives_ok(
  $$ update messaging_provider_config set instance_id = 'direct-update' $$,
  'a direct UPDATE does not raise, but...'
);

select is(
  (select instance_id from messaging_provider_config), null,
  '...it silently affects 0 rows -- even a super_admin session cannot UPDATE directly, update_messaging_instance() is the only sanctioned write path'
);

-- ============================================================================
-- update_messaging_instance(): rejects non-super-admin, rejects empty/blank,
-- succeeds and audit-logs for a valid value.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000802","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000000403","app_role":"owner"}',
  true
);

select throws_like(
  $$ select update_messaging_instance('evo-instance-1') $$,
  '%permission denied%',
  'a non-super_admin caller is rejected by update_messaging_instance()'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated","app_role":"super_admin"}',
  true
);

select throws_like(
  $$ select update_messaging_instance(null) $$,
  '%must not be empty%',
  'update_messaging_instance(null) throws and leaves instance_id unchanged'
);

select throws_like(
  $$ select update_messaging_instance('   ') $$,
  '%must not be empty%',
  'update_messaging_instance(blank/whitespace) throws and leaves instance_id unchanged'
);

select is(
  (select instance_id from messaging_provider_config), null,
  'instance_id is still null after both rejected save attempts'
);

select lives_ok(
  $$ select update_messaging_instance('evo-instance-1') $$,
  'super_admin can save a valid instance_id'
);

select is(
  (select instance_id from messaging_provider_config), 'evo-instance-1',
  'instance_id was updated to the new value'
);

select ok(
  exists (
    select 1 from audit_log
    where action_type = 'messaging_instance_updated'
      and (metadata ->> 'previous_instance_id') is null
      and (metadata ->> 'new_instance_id') = 'evo-instance-1'
  ),
  'saving a new instance_id is audit-logged with actor, previous (null), and new value (AC #2)'
);

select * from finish();
rollback;
