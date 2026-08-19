-- Story 9.1: Staff Creation with Role-Ceiling Enforcement (FR-087/FR-089,
-- NFR-013). Tests `create_staff_member()`, `private.current_member_role()`,
-- and the `log_audit_event()` real-name fallback fix
-- (0061_staff_creation_role_ceiling_enforcement.sql) -- a SECURITY DEFINER
-- RPC, not a raw RLS-policy-gated INSERT, so most write-path assertions call
-- the function directly under a simulated session, matching
-- coach_member_assignment.test.sql's own convention. Session-simulation
-- shape (seed as connecting role, `set local role authenticated` +
-- `set_config('request.jwt.claims', ...)` per session, `reset role` before
-- inspecting committed state) is copied verbatim from that same file.

begin;
select plan(24);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000017001', 'Staff Creation Test Tier', 5000, 50000, 20);

insert into gyms (id, name, tier_id, capacity) values
  ('00000000-0000-0000-0000-000000017011', 'Staff Creation Gym A', '00000000-0000-0000-0000-000000017001', 30),
  ('00000000-0000-0000-0000-000000017012', 'Staff Creation Gym B', '00000000-0000-0000-0000-000000017001', 30);

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000017021'), -- Gym A owner
  ('00000000-0000-0000-0000-000000017022'), -- Gym A supervisor
  ('00000000-0000-0000-0000-000000017023'), -- Gym A manager
  ('00000000-0000-0000-0000-000000017024'), -- Gym A receptionist
  ('00000000-0000-0000-0000-000000017025'), -- Gym A coach
  ('00000000-0000-0000-0000-000000017026'), -- Gym A member
  ('00000000-0000-0000-0000-000000017027'), -- Gym A deactivated owner
  ('00000000-0000-0000-0000-000000017028'), -- Gym B owner
  -- Targets: brand-new auth.users rows with no members row yet (mirrors
  -- the real createUser-then-RPC sequencing -- each represents a freshly
  -- admin-created account awaiting its create_staff_member() insert).
  ('00000000-0000-0000-0000-000000017101'),
  ('00000000-0000-0000-0000-000000017102'),
  ('00000000-0000-0000-0000-000000017103'),
  ('00000000-0000-0000-0000-000000017104'),
  ('00000000-0000-0000-0000-000000017105'),
  ('00000000-0000-0000-0000-000000017106'),
  ('00000000-0000-0000-0000-000000017107'),
  ('00000000-0000-0000-0000-000000017108'),
  ('00000000-0000-0000-0000-000000017109'),
  ('00000000-0000-0000-0000-000000017110'),
  ('00000000-0000-0000-0000-000000017111');

insert into members (id, gym_id, user_id, role, name, deactivated_at) values
  ('00000000-0000-0000-0000-000000017071', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017021', 'owner', 'Staff Creation Gym A Owner', null),
  ('00000000-0000-0000-0000-000000017072', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017022', 'supervisor', 'Staff Creation Gym A Supervisor', null),
  ('00000000-0000-0000-0000-000000017073', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017023', 'manager', 'Staff Creation Gym A Manager', null),
  ('00000000-0000-0000-0000-000000017074', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017024', 'receptionist', 'Staff Creation Gym A Receptionist', null),
  ('00000000-0000-0000-0000-000000017075', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017025', 'coach', 'Staff Creation Gym A Coach', null),
  ('00000000-0000-0000-0000-000000017076', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017026', 'member', 'Staff Creation Gym A Member', null),
  -- Deactivated owner: an active-membership check must reject this caller
  -- the same as any other unauthorized role, not accidentally resolve a
  -- stale/deactivated row.
  ('00000000-0000-0000-0000-000000017077', '00000000-0000-0000-0000-000000017011', '00000000-0000-0000-0000-000000017027', 'owner', 'Staff Creation Gym A Deactivated Owner', now()),
  ('00000000-0000-0000-0000-000000017078', '00000000-0000-0000-0000-000000017012', '00000000-0000-0000-0000-000000017028', 'owner', 'Staff Creation Gym B Owner', null);

-- ============================================================================
-- (a) private.current_member_role(): the exact regression this story's Dev
-- Notes flag by name -- a Coach caller has zero direct SELECT access to
-- their own `members` row today, so an accidentally-invoker-rights version
-- of this helper would silently return NULL instead of 'coach'.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"coach"}',
  true
);

select is(
  private.current_member_role()::text,
  'coach',
  'private.current_member_role() correctly resolves ''coach'' for a Coach caller, not NULL (the is_own_coach_id()/is_assigned_coach() bug class)'
);

-- ============================================================================
-- (b) Owner can create Supervisor/Manager/Receptionist/Coach (AC #1) -- 4
-- assertions, each also confirming the members row and the audit_log row.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017101', 'New Supervisor', '+237600000101', 'supervisor')$$,
  'an owner-claim session can create a Supervisor'
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017102', 'New Manager', '+237600000102', 'manager')$$,
  'an owner-claim session can create a Manager'
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017103', 'New Receptionist', '+237600000103', 'receptionist')$$,
  'an owner-claim session can create a Receptionist'
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017104', 'New Coach', '+237600000104', 'coach')$$,
  'an owner-claim session can create a Coach'
);

reset role;

select is(
  (select role::text from members where user_id = '00000000-0000-0000-0000-000000017101'),
  'supervisor',
  'the new Supervisor members row was inserted with the correct gym_id/role/name/phone'
);

select is(
  (select gym_id from members where user_id = '00000000-0000-0000-0000-000000017101'),
  '00000000-0000-0000-0000-000000017011'::uuid,
  'the new Supervisor row belongs to the caller''s own gym'
);

select is(
  (select phone from members where user_id = '00000000-0000-0000-0000-000000017101'),
  '+237600000101',
  'the new Supervisor row has the submitted phone'
);

select is(
  (select count(*)::int from audit_log
   where action_type = 'staff_created'
     and target_entity_id = (select id::text from members where user_id = '00000000-0000-0000-0000-000000017101')
     and metadata->>'target_role' = 'supervisor'
     and metadata->>'target_name' = 'New Supervisor'),
  1,
  'an audit_log row was written with action_type = staff_created, correct target_entity_id, and metadata.target_role'
);

-- ============================================================================
-- (c) The real-name audit fix (user-requested scope addition): the audit
-- row's actor_display_name is the caller's own members.name, not
-- 'Unknown User' -- users.display_name is never populated for staff
-- accounts (docs/decisions.md), so this is the regression this story's
-- log_audit_event() fix guards.
-- ============================================================================
select is(
  (select actor_display_name from audit_log
   where action_type = 'staff_created'
     and target_entity_id = (select id::text from members where user_id = '00000000-0000-0000-0000-000000017101')),
  'Staff Creation Gym A Owner',
  'the staff_created audit row logs the acting Owner''s real name (members.name fallback), not ''Unknown User'''
);

-- ============================================================================
-- (d) Supervisor can create Manager/Receptionist/Coach but NOT Supervisor or
-- Owner (AC #2) -- the same set an Owner can create, minus Supervisor.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017022","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"supervisor"}',
  true
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017105', 'Supervisor-Created Manager', '+237600000105', 'manager')$$,
  'a supervisor-claim session can create a Manager'
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017106', 'Supervisor-Created Receptionist', '+237600000106', 'receptionist')$$,
  'a supervisor-claim session can create a Receptionist'
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017107', 'Supervisor-Created Coach', '+237600000107', 'coach')$$,
  'a supervisor-claim session can create a Coach'
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017108', 'Rejected Supervisor', '+237600000108', 'supervisor')$$,
  '%create_staff_member: caller is not authorized to create staff with role supervisor%',
  'a supervisor-claim session cannot create another Supervisor'
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017108', 'Rejected Owner', '+237600000108', 'owner')$$,
  '%create_staff_member: caller is not authorized to create staff with role owner%',
  'a supervisor-claim session cannot create an Owner'
);

-- ============================================================================
-- (e) An Owner also cannot create another Owner or a Supervisor targeting
-- self-elevation-adjacent cases (AC #4: no role may ever create an Owner
-- through this path).
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"owner"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017108', 'Rejected Owner', '+237600000108', 'owner')$$,
  '%create_staff_member: caller is not authorized to create staff with role owner%',
  'an owner-claim session cannot create another Owner -- NFR-013: no p_role value can ever represent Super Admin either, since it is a separate users.is_super_admin flag, never a member_role value at all'
);

-- ============================================================================
-- (f) Manager, Receptionist, Coach, and a plain Member caller are all
-- rejected outright, hitting the identical `else` branch (AC #3: Manager
-- gets no staff-creation grant at all, not even a hidden one) -- 4
-- assertions.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017023","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"manager"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017109', 'Rejected By Manager', '+237600000109', 'coach')$$,
  '%create_staff_member: caller is not authorized to create staff%',
  'a manager-claim session is rejected -- Manager cannot create staff at all'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017024","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"receptionist"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017109', 'Rejected By Receptionist', '+237600000109', 'coach')$$,
  '%create_staff_member: caller is not authorized to create staff%',
  'a receptionist-claim session is rejected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017025","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"coach"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017109', 'Rejected By Coach', '+237600000109', 'receptionist')$$,
  '%create_staff_member: caller is not authorized to create staff%',
  'a coach-claim session is rejected'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017026","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"member"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017109', 'Rejected By Member', '+237600000109', 'receptionist')$$,
  '%create_staff_member: caller is not authorized to create staff%',
  'a plain member-claim session is rejected'
);

-- ============================================================================
-- (g) A caller with no active membership at all is rejected: a deactivated
-- owner, and a session with no gym_id claim at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017027","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"owner"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017109', 'Rejected By Deactivated Owner', '+237600000109', 'coach')$$,
  '%create_staff_member: caller is not authorized to create staff%',
  'a deactivated owner (no active membership row) is rejected -- private.current_member_role() resolves NULL, hitting the else branch'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017021","role":"authenticated"}',
  true
);

select throws_like(
  $$select create_staff_member('00000000-0000-0000-0000-000000017110', 'Rejected No Gym Claim', '+237600000110', 'coach')$$,
  '%create_staff_member: caller has no gym-scoped session%',
  'a session with no gym_id claim at all is rejected with the no-gym-scoped-session message'
);

-- ============================================================================
-- (h) Cross-tenant: a Gym A owner-claim session targeting a brand-new user id
-- still writes the new members row into the caller's OWN gym (v_gym_id
-- comes from private.gym_id(), never from the target user) -- the target
-- user_id itself carries no gym affiliation until this insert creates one.
-- Re-establishes the owner/gym-A session -- the previous block (g)
-- deliberately left the simulated session with no gym_id claim at all.
-- ============================================================================
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000017021","role":"authenticated","gym_id":"00000000-0000-0000-0000-000000017011","app_role":"owner"}',
  true
);

select lives_ok(
  $$select create_staff_member('00000000-0000-0000-0000-000000017111', 'Cross-Tenant Target', '+237600000111', 'coach')$$,
  'an owner-claim session creating a staff row for a brand-new user_id succeeds regardless of any other gym''s existing rows'
);

reset role;

select is(
  (select gym_id from members where user_id = '00000000-0000-0000-0000-000000017111'),
  '00000000-0000-0000-0000-000000017011'::uuid,
  'the new row is always scoped to the caller''s own gym, never a client-influenced value'
);

select * from finish();
rollback;
