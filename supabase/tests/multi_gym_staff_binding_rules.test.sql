-- Story 9.4: Multi-Gym Staff Binding Rules (FR-091/FR-092). Tests
-- `create_staff_member()`'s new find-active-binding-and-replace logic
-- (0064_multi_gym_staff_binding_rules.sql) and the target-role ceiling fix
-- applied to both `create_staff_member()` and `update_staff_role()` in the
-- same migration. Session-simulation shape copied from
-- `staff_creation_role_ceiling_enforcement.test.sql`. Unlike every prior
-- staff test file, this one needs two gyms (AC #1's cross-gym scenario).

begin;
select plan(29);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000020001', 'Multi-Gym Binding Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000020011', 'Multi-Gym Binding Gym A', '00000000-0000-0000-0000-000000020001', 30),
  ('00000000-0000-0000-0000-000000020012', 'Multi-Gym Binding Gym B', '00000000-0000-0000-0000-000000020001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000020021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000020022'), -- Gym A supervisor
  ('00000000-0000-0000-0000-000000020023'), -- Gym B owner
  ('00000000-0000-0000-0000-000000020101'), -- multi-gym person: active Gym A coach (AC #1 fixture)
  ('00000000-0000-0000-0000-000000020102'), -- same-gym replace target: active Gym A receptionist (AC #2 fixture)
  ('00000000-0000-0000-0000-000000020103'), -- promote-existing-member target: active Gym A plain member
  ('00000000-0000-0000-0000-000000020104'); -- existing Gym A supervisor (target-ceiling fixture)

insert into members (id, gym_id, user_id, role, name, phone, deactivated_at) values
  ('00000000-0000-0000-0000-000000020071', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020021', 'owner', 'Multi-Gym Binding Gym A Owner', '+237600020021', null),
  ('00000000-0000-0000-0000-000000020072', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020022', 'supervisor', 'Multi-Gym Binding Gym A Supervisor', '+237600020022', null),
  ('00000000-0000-0000-0000-000000020077', '00000000-0000-0000-0000-000000020012', '00000000-0000-0000-0000-000000020023', 'owner', 'Multi-Gym Binding Gym B Owner', '+237600020023', null),
  ('00000000-0000-0000-0000-000000020073', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020101', 'coach', 'Multi-Gym Person (Gym A Coach)', '+237600020101', null),
  ('00000000-0000-0000-0000-000000020074', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020102', 'receptionist', 'Same-Gym Replace Target', '+237600020102', null),
  ('00000000-0000-0000-0000-000000020075', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020103', 'member', 'Promote-Existing-Member Target', '+237600020103', null),
  ('00000000-0000-0000-0000-000000020076', '00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020104', 'supervisor', 'Existing Gym A Supervisor #2', '+237600020104', null);

-- ============================================================================
-- (a) AC #1: a phone (user_id) with an existing active binding at Gym A is
-- granted a role at Gym B -- a SEPARATE binding is created, Gym A's row is
-- untouched.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020012","app_role":"owner"}',
  true
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000020101', 'Multi Gym Manager', '+237600020199', 'manager')$$,
  'AC #1: a Gym B owner-claim session can grant a role at Gym B to a person already active at Gym A'
);

reset role;

select is(
  (select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000020101' and deactivated_at is null),
  2,
  'AC #1: the person now holds two independent active bindings, one per gym'
);

select is(
  (select role::text from members where user_id = '00000000-0000-0000-0000-000000020101' and gym_id = '00000000-0000-0000-0000-000000020011'),
  'coach',
  'AC #1: Gym A''s existing binding is untouched'
);

select is(
  (select role::text from members where user_id = '00000000-0000-0000-0000-000000020101' and gym_id = '00000000-0000-0000-0000-000000020012'),
  'manager',
  'AC #1: the new Gym B binding has the granted role'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_created'
     and target_entity_id = (select id::text from members where user_id = '00000000-0000-0000-0000-000000020101' and gym_id = '00000000-0000-0000-0000-000000020012')
     and metadata->>'target_role' = 'manager'),
  1,
  'AC #1: the new Gym B binding is audit-logged as staff_created (an insert, not a replace)'
);

-- ============================================================================
-- (b) AC #2: a phone already bound to a role at Gym A is assigned a
-- DIFFERENT role at Gym A via create_staff_member() (the Add Staff form,
-- not update_staff_role()) -- the role REPLACES the prior binding, not a
-- second row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"owner"}',
  true
);

-- Phone deliberately differs from the fixture's original '+237600020102' --
-- p_phone is the identity phone that resolved this user_id in the first
-- place (this gym's own members.phone snapshot can drift from it over time,
-- e.g. if it was set long before a later phone change elsewhere), so the
-- replace-in-place branch must refresh it too (review finding).
select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000020102', 'Replaced Manager', '+237600020188', 'manager')$$,
  'AC #2: an owner-claim session can replace an existing same-gym binding''s role via create_staff_member()'
);

reset role;

select is(
  (select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000020102' and gym_id = '00000000-0000-0000-0000-000000020011' and deactivated_at is null),
  1,
  'AC #2: exactly one active row still exists for that user at that gym -- no duplicate'
);

select is(
  (select role::text from members where user_id = '00000000-0000-0000-0000-000000020102' and gym_id = '00000000-0000-0000-0000-000000020011'),
  'manager',
  'AC #2: the existing row''s role was replaced in place'
);

select is(
  (select phone from members where user_id = '00000000-0000-0000-0000-000000020102' and gym_id = '00000000-0000-0000-0000-000000020011'),
  '+237600020188',
  'AC #2 (review finding): the existing row''s phone was refreshed to match the resolving p_phone, not left stale'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_role_updated'
     and target_entity_id = (select id::text from members where user_id = '00000000-0000-0000-0000-000000020102')
     and metadata->>'previous_role' = 'receptionist'
     and metadata->>'new_role' = 'manager'
     and metadata->>'replaced_via' = 'create_staff_member'),
  1,
  'AC #2: the replacement is audit-logged as staff_role_updated, not staff_created, with previous/new role metadata'
);

-- ============================================================================
-- (c) The promote-existing-member case (mechanically covered by the same
-- code path as AC #2, per story Dev Notes -- deferred-work.md's story-9-1
-- entry): a plain gym Member is "added as staff" via the same form.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000020103', 'Promoted Coach', '+237600020103', 'coach')$$,
  'promote-existing-member: an owner-claim session can promote an existing plain Member to a staff role via create_staff_member()'
);

reset role;

select is(
  (select count(*)::int from members where user_id = '00000000-0000-0000-0000-000000020103' and gym_id = '00000000-0000-0000-0000-000000020011' and role = 'coach' and deactivated_at is null),
  1,
  'promote-existing-member: the same row was updated in place (role = coach), not a new row'
);

select is(
  (select metadata->>'previous_role' from audit_log
   where action_type = 'staff_role_updated'
     and target_entity_id = (select id::text from members where user_id = '00000000-0000-0000-0000-000000020103')),
  'member',
  'promote-existing-member: the audit metadata records previous_role = member'
);

-- ============================================================================
-- (d) Self-target guard: an Owner's own phone number resolves to their own
-- active binding -- rejected outright, no name-only carve-out (unlike
-- update_staff_role()'s self-edit path).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"owner"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000020021', 'Self Attempt', '+237600020021', 'manager')$$,
  '%create_staff_member: cannot replace your own binding%',
  'self-target guard: an owner-claim session cannot replace their own binding via create_staff_member()'
);

reset role;

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000020071'),
  'owner',
  'self-target guard: the caller''s own row is unchanged after the rejected attempt'
);

-- ============================================================================
-- (e) The pre-existing p_role ceiling still applies on the replace path
-- unchanged: a Supervisor cannot replace anyone's binding with p_role =
-- 'supervisor' (the *new*-role ceiling, unrelated to the target-role
-- ceiling in (f)/(g) below).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"supervisor"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000020104', 'Rejected New Role', '+237600020104', 'supervisor')$$,
  '%create_staff_member: caller is not authorized to create staff with role supervisor%',
  'new-role ceiling still applies on the replace path: a supervisor-claim session cannot assign role=supervisor to anyone'
);

-- ============================================================================
-- (f)/(g) NEW target-role ceiling (security fix found while writing this
-- suite -- see docs/decisions.md): the ceiling check above only ever
-- constrained the *new* role being assigned, never the target's *current*
-- role. A Supervisor assigning p_role = 'manager' (within their own
-- allowlist) to an existing Owner's or Supervisor's own binding would
-- otherwise succeed, demoting them.
-- ============================================================================
select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000020104', 'Rejected Target Ceiling', '+237600020104', 'manager')$$,
  '%create_staff_member: caller is not authorized to replace a staff member with role supervisor%',
  'target-role ceiling: a supervisor-claim session cannot replace an existing Supervisor''s binding, even with an otherwise-permitted new role'
);

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000020076'),
  'supervisor',
  'target-role ceiling: the existing Supervisor''s row is unchanged after the rejected attempt'
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000020021', 'Rejected Owner Target', '+237600020021', 'manager')$$,
  '%create_staff_member: caller is not authorized to replace a staff member with role owner%',
  'target-role ceiling: a supervisor-claim session cannot replace an existing Owner''s binding'
);

reset role;

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000020071'),
  'owner',
  'target-role ceiling: the Owner''s row is unchanged after the rejected attempt'
);

-- ============================================================================
-- (h) The identical target-role ceiling gap, fixed the same way in
-- update_staff_role() (0063, Story 9.3) by this same migration.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"supervisor"}',
  true
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000020071', 'Rejected Owner Edit', 'manager')$$,
  '%update_staff_role: caller is not authorized to edit a staff member with role owner%',
  'update_staff_role() target-role ceiling: a supervisor-claim session cannot edit an existing Owner''s role'
);

select throws_like(
  $$select update_staff_role('00000000-0000-0000-0000-000000020076', 'Rejected Supervisor Edit', 'manager')$$,
  '%update_staff_role: caller is not authorized to edit a staff member with role supervisor%',
  'update_staff_role() target-role ceiling: a supervisor-claim session cannot edit an existing Supervisor''s role'
);

reset role;

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000020071'),
  'Multi-Gym Binding Gym A Owner',
  'update_staff_role() target-role ceiling: the Owner''s row is unchanged after the rejected attempt'
);

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000020076'),
  'supervisor',
  'update_staff_role() target-role ceiling: the Supervisor''s row is unchanged after the rejected attempt'
);

-- ============================================================================
-- (i) Regression: the new target-role ceiling does not block a legitimate
-- edit of a non-owner/non-supervisor target, or an Owner's own name-only
-- self-edit (the self-edit carve-out both guards correctly skip).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000020021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000020011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000020073', 'Renamed Coach', 'manager')$$,
  'regression: an owner-claim session can still edit a Coach target normally after the target-role ceiling fix'
);

select lives_ok(
  $$select update_staff_role('00000000-0000-0000-0000-000000020071', 'Renamed Owner', 'owner')$$,
  'regression: an owner-claim session can still perform a name-only self-edit (target-role ceiling correctly skips the self-edit case)'
);

reset role;

select is(
  (select role::text from members where id = '00000000-0000-0000-0000-000000020073'),
  'manager',
  'regression: the Coach target''s role was updated as expected'
);

select is(
  (select name from members where id = '00000000-0000-0000-0000-000000020071'),
  'Renamed Owner',
  'regression: the Owner''s own name-only self-edit still succeeds'
);

-- ============================================================================
-- (j) Race-window backstop (defensive, not the primary path): a direct SQL
-- insert bypassing create_staff_member() entirely still hits the
-- pre-existing unique index for a (gym_id, user_id) pair that already has
-- an active row -- confirms the DB-level invariant this whole story is
-- built around is still enforced, independent of the RPC's own new
-- check-then-branch logic.
-- ============================================================================
select throws_like(
  $$insert into members (gym_id, user_id, role, name, phone) values ('00000000-0000-0000-0000-000000020011', '00000000-0000-0000-0000-000000020102', 'coach', 'Race Window Insert', '+237600020102')$$,
  '%idx_members_active_gym_user%',
  'race-window backstop: a raw insert bypassing the RPC still violates idx_members_active_gym_user for an existing active (gym_id, user_id) pair'
);

select * from finish();
rollback;
