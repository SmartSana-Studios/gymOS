-- Story 1.16: list_super_admins() (migration 0087). Session-simulation
-- conventions match gym_data_escalation_rls.test.sql/payment_providers_rls.
-- test.sql. All fixture rows are seeded up front as the connecting role.
--
-- Fixture: three Super Admins (one with a seeded `super_admin_provisioned`
-- audit_log row so `since` has something real to resolve, one with none so
-- the null case is covered) and one non-Super-Admin authenticated user, who
-- must never appear in the RPC's own output regardless of caller.

begin;
select plan(7);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000004001'), -- Super Admin caller
  ('00000000-0000-0000-0000-000000004002'), -- Super Admin, provisioned via audit_log row
  ('00000000-0000-0000-0000-000000004003'), -- Super Admin, no audit_log row (pre-1.12 hand-written SQL case)
  ('00000000-0000-0000-0000-000000004004'), -- non-Super-Admin authenticated user
  ('00000000-0000-0000-0000-000000004005'); -- Super Admin, 2 matching audit_log rows (code review follow-up)

update users set display_name = 'Caller Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000004001';
update users set display_name = 'Provisioned Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000004002';
update users set display_name = 'Legacy Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000004003';
update users set display_name = 'Regular User', is_super_admin = false
  where id = '00000000-0000-0000-0000-000000004004';
update users set display_name = 'Multi Row Admin', is_super_admin = true
  where id = '00000000-0000-0000-0000-000000004005';

insert into audit_log (actor_id, actor_display_name, action_type, target_entity_id, target_entity_type)
values (
  '00000000-0000-0000-0000-000000004002',
  'Provisioned Admin',
  'super_admin_provisioned',
  '00000000-0000-0000-0000-000000004002',
  'users'
);

-- Multi-row case: `since` must resolve to the MOST RECENT matching row
-- (`order by a.created_at desc limit 1`), not the first/oldest one -- e.g. a
-- provisioning row followed by a later promotion-shaped row for the same
-- user. Explicit `created_at` values, oldest first, so the "most recent
-- wins" behavior is actually exercised rather than accidentally passing on
-- insertion order.
insert into audit_log (actor_id, actor_display_name, action_type, target_entity_id, target_entity_type, created_at)
values (
  '00000000-0000-0000-0000-000000004005',
  'Multi Row Admin',
  'super_admin_provisioned',
  '00000000-0000-0000-0000-000000004005',
  'users',
  now() - interval '2 days'
);
insert into audit_log (actor_id, actor_display_name, action_type, target_entity_id, target_entity_type, created_at)
values (
  '00000000-0000-0000-0000-000000004001',
  'Caller Admin',
  'super_admin_promoted',
  '00000000-0000-0000-0000-000000004005',
  'users',
  now() - interval '1 day'
);

-- ============================================================================
-- A non-Super-Admin authenticated session is rejected outright (the
-- function's own `raise exception`, not an empty result set) -- distinguishes
-- "not authorized" from "no rows", same discipline the escalation RPCs'
-- own tests already assert (gym_data_escalation_ttl_revocation.test.sql).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000004004","role":"authenticated"}',
  true
);

select throws_ok(
  $$select * from list_super_admins()$$,
  'permission denied',
  'list_super_admins() rejects a non-Super-Admin session'
);

-- ============================================================================
-- A Super Admin session sees exactly the seeded Super Admin rows.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000004001","role":"authenticated","app_role":"super_admin"}',
  true
);

select is(
  (
    select count(*)::int from list_super_admins()
    where id in (
      '00000000-0000-0000-0000-000000004001',
      '00000000-0000-0000-0000-000000004002',
      '00000000-0000-0000-0000-000000004003'
    )
  ),
  3,
  'a super_admin caller sees all 3 seeded Super Admin rows'
);

select is(
  (select count(*)::int from list_super_admins() where id = '00000000-0000-0000-0000-000000004004'),
  0,
  'a super_admin caller does not see the non-Super-Admin user'
);

select is(
  (select display_name from list_super_admins() where id = '00000000-0000-0000-0000-000000004001'),
  'Caller Admin',
  'the caller''s own row is returned with the expected display_name, confirming real row-level content, not a miscount'
);

-- ============================================================================
-- `since` resolves from the seeded audit_log row -- and is null when none
-- exists, not `users.created_at` (Correction 2 in this story's Dev Notes).
-- ============================================================================
select is(
  (select since from list_super_admins() where id = '00000000-0000-0000-0000-000000004002'),
  (
    select created_at from audit_log
    where target_entity_id = '00000000-0000-0000-0000-000000004002'
      and action_type = 'super_admin_provisioned'
  ),
  'since resolves from the seeded audit_log row for a provisioned Super Admin'
);

select is(
  (select since from list_super_admins() where id = '00000000-0000-0000-0000-000000004003'),
  null,
  'since is null for a Super Admin with no matching audit_log row'
);

select is(
  (select since from list_super_admins() where id = '00000000-0000-0000-0000-000000004005'),
  (
    select max(created_at) from audit_log
    where target_entity_id = '00000000-0000-0000-0000-000000004005'
      and action_type in ('super_admin_provisioned', 'super_admin_promoted')
  ),
  'since resolves to the most recent of 2+ matching audit_log rows, not the oldest'
);

select * from finish();
rollback;
