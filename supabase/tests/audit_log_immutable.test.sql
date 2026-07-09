-- AC #1/#2: "no role -- including Super Admin and service_role -- has UPDATE or
-- DELETE grants on it, enforced at the grant level beneath RLS" / "any migration,
-- script, or application code that attempts an UPDATE or DELETE... fails."
--
-- The critical distinction this file tests: service_role bypasses RLS entirely in
-- Supabase (BYPASSRLS), so a test that only proved RLS blocks UPDATE/DELETE would
-- pass for the wrong reason and miss a service_role bypass entirely. Every
-- UPDATE/DELETE assertion below must fail with "permission denied" (the grant-level
-- REVOKE), not a row-count-filtered no-op -- that is what "beneath RLS" means and
-- is the actual thing this migration adds beyond RLS alone.
--
-- Also covers AC #3 (record shape) via log_audit_event(), the canonical write path
-- (0007_audit_log.sql): the system/no-session case (actor_id null, caller-supplied
-- label), the authenticated-session case (actor derived from auth.uid(), never
-- caller-supplied), tenant-isolation on p_gym_id (with a Super Admin exemption),
-- and that gym/user deletion is never blocked by this append-only table
-- (on delete set null).

begin;
select plan(27);

insert into tiers (id, name, monthly_price, annual_price, member_cap)
values ('00000000-0000-0000-0000-000000000004', 'Audit Test Tier', 5000, 50000, 30);

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000e1', 'Audit Gym', '00000000-0000-0000-0000-000000000004', 30);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e2');
update public.users set display_name = 'Real Display Name' where id = '00000000-0000-0000-0000-0000000000e2';

-- ---------------------------------------------------------------------------
-- log_audit_event(): system/no-session caller. Runs as service_role, NOT the
-- default connecting role (postgres, a superuser) -- postgres bypasses the
-- EXECUTE grant entirely, which would prove nothing about whether the actual
-- production system-caller (pg_cron runs as service_role) can call this
-- function at all. service_role has no request.jwt.claims set either, so
-- auth.uid() is null for it too -- this is a legitimate system-caller
-- simulation, not just a role-bypass shortcut.
-- ---------------------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$ select log_audit_event('job_failure', null, null, null, '{}'::jsonb, 'system:subscription_lifecycle_cron') $$,
  'log_audit_event() succeeds for a system caller (service_role, no session)'
);

select is(
  (select actor_id from audit_log where action_type = 'job_failure'),
  null,
  'system-caller record has a null actor_id (no auth.uid() session to derive one from)'
);

select is(
  (select actor_display_name from audit_log where action_type = 'job_failure'),
  'system:subscription_lifecycle_cron',
  'system-caller record uses the caller-supplied label as actor_display_name'
);

select is(
  (select metadata from audit_log where action_type = 'job_failure'),
  '{}'::jsonb,
  'metadata round-trips correctly when explicitly passed as {} (see the DEFAULT-clause-specific test further below for the truly-omitted case)'
);

-- Isolate action_type's own NOT NULL violation: pass an explicit system label
-- so actor_display_name resolves non-null and only action_type's constraint
-- can fire. Without this, both actor_display_name and action_type end up
-- NULL (coalesce(null, 'system:' || null) = null), and Postgres's
-- column-order constraint check raises on actor_display_name first --
-- silently proving nothing about action_type specifically.
select throws_like(
  $$ select log_audit_event(null, null, null, null, '{}'::jsonb, 'system:test_isolation') $$,
  '%not-null constraint%',
  'log_audit_event() raises (not-null violation) rather than silently swallowing a missing action_type'
);

reset role;

-- ---------------------------------------------------------------------------
-- log_audit_event(): authenticated session -- actor derived from auth.uid(),
-- never caller-supplied (spoofing prevention)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000e1","app_role":"owner"}',
  true
);

select isnt(
  log_audit_event('member_deactivated', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'members', '{"reason":"test"}'::jsonb),
  null,
  'log_audit_event() returns a non-null id for an authenticated caller writing to their own gym'
);

-- Switch back to a role that can read past deny-all RLS to inspect the row --
-- authenticated cannot SELECT audit_log at all (zero read policies, by design).
reset role;

select is(
  (select actor_id from audit_log where action_type = 'member_deactivated'),
  '00000000-0000-0000-0000-0000000000e2'::uuid,
  'authenticated-session record''s actor_id is derived from auth.uid(), matching the session'
);

select is(
  (select actor_display_name from audit_log where action_type = 'member_deactivated'),
  'Real Display Name',
  'authenticated-session record''s actor_display_name is looked up from public.users, not caller-supplied'
);

select is(
  (select gym_id from audit_log where action_type = 'member_deactivated'),
  '00000000-0000-0000-0000-0000000000e1'::uuid,
  'gym_id passes through as given when it matches the caller''s own gym'
);

-- ---------------------------------------------------------------------------
-- Regression: a real session whose users.display_name happens to be NULL
-- (nullable column, never set) must still keep actor_id populated -- an
-- earlier draft of log_audit_event() incorrectly nulled actor_id whenever
-- display_name resolved to NULL, misattributing a genuine user's action to
-- "system" purely because their profile was incomplete. Fixed before this
-- story's first commit; kept here so it can't silently regress.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e4');
-- Deliberately no `update public.users set display_name = ...` for this user.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}',
  true
);

select isnt(
  log_audit_event('coach_assignment_changed'),
  null,
  'log_audit_event() succeeds for a session whose users.display_name is NULL'
);

reset role;

select is(
  (select actor_id from audit_log where action_type = 'coach_assignment_changed'),
  '00000000-0000-0000-0000-0000000000e4'::uuid,
  'actor_id stays populated even when the session user has no display_name set (the bug this regression test guards)'
);

select is(
  (select actor_display_name from audit_log where action_type = 'coach_assignment_changed'),
  'Unknown User',
  'actor_display_name falls back to a generic label, not the system:<action_type> label, for a real session with no display_name'
);

-- This call genuinely omits p_metadata (unlike the job_failure call above,
-- which passed '{}'::jsonb explicitly) -- this is the one assertion that
-- actually exercises the DEFAULT clause itself.
select is(
  (select metadata from audit_log where action_type = 'coach_assignment_changed'),
  '{}'::jsonb,
  'metadata genuinely defaults to {} when the parameter is omitted entirely'
);

-- ---------------------------------------------------------------------------
-- Tenant isolation on p_gym_id: a regular authenticated caller may not write
-- an audit record into a gym they don't belong to; Super Admin is exempt.
-- ---------------------------------------------------------------------------

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000e5', 'Other Gym', '00000000-0000-0000-0000-000000000004', 30);

-- e2 belongs to gym e1 (per its earlier claims above) -- passing gym e5 must
-- be rejected, not silently accepted.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","gym_id":"00000000-0000-0000-0000-0000000000e1","app_role":"owner"}',
  true
);

select throws_like(
  $$ select log_audit_event('member_deactivated', '00000000-0000-0000-0000-0000000000e5') $$,
  '%does not match%',
  'log_audit_event() rejects a p_gym_id that does not belong to the authenticated caller'
);

-- Super Admin: app_role = super_admin, no gym_id claim (matches the real
-- claims hook's shape for Super Admin sessions, Story 1.3) -- their
-- escalated cross-gym access is itself a legitimate, audit-logged action
-- (FR-072), so p_gym_id must pass through unchecked.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","app_role":"super_admin"}',
  true
);

select isnt(
  log_audit_event('super_admin_gym_escalation', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e5', 'gym'),
  null,
  'log_audit_event() succeeds for a Super Admin session writing to a gym they are not a member of'
);

reset role;

select is(
  (select gym_id from audit_log where action_type = 'super_admin_gym_escalation'),
  '00000000-0000-0000-0000-0000000000e5'::uuid,
  'Super Admin''s p_gym_id passes through unchecked, unlike a regular authenticated caller'
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement at the grant level (the actual point of this story)
-- ---------------------------------------------------------------------------

-- Explicit role switch: `reset role` above returned us to the connecting
-- session's default role (postgres, a superuser that trivially bypasses every
-- grant check) -- this test is meaningless unless it actually runs as
-- service_role, since postgres inserting proves nothing about service_role's
-- own table grant.
set local role service_role;

select lives_ok(
  $$ insert into audit_log (actor_display_name, action_type) values ('Direct Insert', 'test_direct_insert') $$,
  'service_role can INSERT into audit_log directly (table grant + RLS bypass)'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);

select throws_like(
  $$ insert into audit_log (actor_display_name, action_type) values ('Sneaky Insert', 'test_sneaky_insert') $$,
  '%permission denied%',
  'authenticated cannot INSERT into audit_log directly, bypassing log_audit_event() -- fails at the grant level (no table-level INSERT grant, checked before RLS), not the RLS layer, since this migration deliberately does not grant INSERT to authenticated at all'
);

select throws_like(
  $$ update audit_log set action_type = 'tampered' where true $$,
  '%permission denied%',
  'authenticated UPDATE on audit_log fails at the grant level (permission denied, not RLS-filtered)'
);

select throws_like(
  $$ delete from audit_log where true $$,
  '%permission denied%',
  'authenticated DELETE on audit_log fails at the grant level for the same reason (AC #2, symmetric with the UPDATE case above)'
);

set local role service_role;

select throws_like(
  $$ update audit_log set action_type = 'tampered' where true $$,
  '%permission denied%',
  'service_role UPDATE on audit_log fails at the grant level -- service_role bypasses RLS but NOT the grant-level REVOKE, which is the whole point of AC #1'
);

select throws_like(
  $$ delete from audit_log where true $$,
  '%permission denied%',
  'service_role DELETE on audit_log fails at the grant level for the same reason'
);

-- ---------------------------------------------------------------------------
-- on delete set null: deleting a referenced gym or user must never be
-- blocked by this append-only table -- the audit record survives with its
-- FK columns nulled, not with a foreign-key-violation error.
-- ---------------------------------------------------------------------------

-- Explicit reset before seeding: the previous block left the role as
-- service_role, which lacks INSERT on auth.users (a Supabase-managed system
-- table) -- seeding must run as the default postgres/superuser role, same
-- discipline as every other seed insert in this file.
reset role;

insert into gyms (id, name, tier_id, capacity)
values ('00000000-0000-0000-0000-0000000000e8', 'Deletable Gym', '00000000-0000-0000-0000-000000000004', 30);

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e9');

set local role service_role;

insert into audit_log (gym_id, actor_id, actor_display_name, action_type)
values ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e9', 'Throwaway Actor', 'on_delete_test');

reset role;

select lives_ok(
  $$ delete from gyms where id = '00000000-0000-0000-0000-0000000000e8' $$,
  'deleting a gym referenced by an audit_log row does not raise a foreign-key violation'
);

select lives_ok(
  $$ delete from auth.users where id = '00000000-0000-0000-0000-0000000000e9' $$,
  'deleting a user referenced by an audit_log row does not raise a foreign-key violation'
);

select is(
  (select gym_id from audit_log where action_type = 'on_delete_test'),
  null,
  'audit_log.gym_id is set to null, not blocked, once the referenced gym is deleted'
);

select is(
  (select actor_id from audit_log where action_type = 'on_delete_test'),
  null,
  'audit_log.actor_id is set to null, not blocked, once the referenced user is deleted'
);

select is(
  (select actor_display_name from audit_log where action_type = 'on_delete_test'),
  'Throwaway Actor',
  'the record''s evidentiary content (actor_display_name) survives the FK going null'
);

select * from finish();
rollback;
